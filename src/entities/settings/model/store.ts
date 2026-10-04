import {
  defaults,
  normalizeSettings,
  settingsSchema,
  type Settings,
} from '@/shared/model/preferences';
import { checkSyncSize, type StoragePort } from '@/shared/platform/storage';
import { cacheStartup } from '@/shared/platform/startup';
import { observableState } from '@/shared/model/observable-state';

export const SETTINGS_KEY = 'unp.reader.v1';
export interface SettingsSnapshot {
  settings: Settings;
  status: 'loading' | 'saved' | 'saving' | 'error';
  error: string;
  migrationIssues: string[];
  needsEffectMigration: boolean;
}
export class SettingsStore {
  readonly state = observableState<SettingsSnapshot>({
    settings: { ...defaults },
    status: 'loading',
    error: '',
    migrationIssues: [],
    needsEffectMigration: false,
  });
  private get snapshot() {
    return this.state.getState();
  }
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue = Promise.resolve();
  private revision = 0;
  private writable = false;
  private savedRevision = 0;
  private observation = 0;
  private unlisten: () => void = () => {};
  constructor(private storage: StoragePort) {}
  getSnapshot = this.state.getState;
  subscribe = this.state.subscribe;
  private publish(patch: Partial<SettingsSnapshot>) {
    this.state.setState(patch);
  }
  async initialize() {
    try {
      const raw = await this.storage.sync.get([
        SETTINGS_KEY,
        'unp.settings.v4',
        'novolpiaPatchSettings',
      ]);
      const stored = raw[SETTINGS_KEY] as
        | { schemaVersion?: number; data?: unknown; pendingPageEffectMigration?: boolean }
        | undefined;
      if (stored && stored.schemaVersion !== 1)
        throw new Error('새 버전의 설정입니다. 확장프로그램을 업데이트해 주세요.');
      const legacy: Record<string, unknown> = {};
      const migrationIssues: string[] = [];
      for (const source of [raw.novolpiaPatchSettings, raw['unp.settings.v4']]) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
        for (const key of Object.keys(defaults) as (keyof Settings)[]) {
          if (!(key in source)) continue;
          const parsed = settingsSchema.shape[key].safeParse(
            (source as Record<string, unknown>)[key]
          );
          if (parsed.success) legacy[key] = parsed.data;
          else migrationIssues.push(key);
        }
      }
      const result = normalizeSettings(
        stored?.data ?? { ...defaults, ...legacy, autoRecommend: false }
      );
      this.writable = true;
      this.publish({
        settings: result.settings,
        status: 'saved',
        needsEffectMigration:
          stored?.pendingPageEffectMigration === true ||
          (!!(stored || Object.keys(legacy).length) &&
            !(stored?.data && typeof stored.data === 'object' && 'pageEffect' in stored.data)),
        migrationIssues: [...new Set([...migrationIssues, ...result.issues])],
      });
      if (!stored) {
        await this.storage.local.set({ 'unp.migration.settings.v1': raw });
        await this.storage.sync.set({
          [SETTINGS_KEY]: {
            schemaVersion: 1,
            data: result.settings,
            ...(this.snapshot.needsEffectMigration ? { pendingPageEffectMigration: true } : {}),
          },
        });
        const verified = await this.storage.sync.get(SETTINGS_KEY);
        const document = verified[SETTINGS_KEY] as
          | { schemaVersion?: number; data?: unknown }
          | undefined;
        const checked = settingsSchema.safeParse(document?.data);
        if (
          document?.schemaVersion !== 1 ||
          !checked.success ||
          (Object.keys(defaults) as (keyof Settings)[]).some(
            (key) => checked.data[key] !== result.settings[key]
          )
        )
          throw new Error('설정 이전 후 저장 검증에 실패했습니다.');
        await this.storage.local.set({ 'unp.migration.settings.complete.v1': true });
      }
      this.unlisten = this.storage.listen((changes, area) => {
        if (area !== 'sync' || !changes[SETTINGS_KEY]) return;
        this.observation++;
        this.receive(changes[SETTINGS_KEY].newValue);
      });
      // Close the initial get/listen gap. A newer notification or local edit wins over this read.
      const observation = this.observation;
      const revision = this.revision;
      const latest = await this.storage.sync.get(SETTINGS_KEY);
      if (observation === this.observation && revision === this.revision)
        this.receive(latest[SETTINGS_KEY]);
      await cacheStartup(this.storage.local, this.snapshot.settings);
    } catch (error) {
      this.publish({ status: 'error', error: String(error) });
    }
  }
  private receive(raw: unknown) {
    const value = raw as
      | { schemaVersion?: number; data?: unknown; pendingPageEffectMigration?: boolean }
      | undefined;
    if (value && value.schemaVersion !== 1) {
      this.writable = false;
      this.publish({
        status: 'error',
        error: '새 버전의 설정입니다. 확장프로그램을 업데이트해 주세요.',
      });
      return;
    }
    // Keep local unsaved edits, including a failed save awaiting retry.
    if (this.revision !== this.savedRevision) return;
    if (value?.schemaVersion === 1) {
      const normalized = normalizeSettings(value.data);
      if (!normalized.issues.length) {
        this.publish({
          settings: normalized.settings,
          status: 'saved',
          error: '',
          ...(value.pendingPageEffectMigration === true
            ? { needsEffectMigration: true }
            : value.data && typeof value.data === 'object' && 'pageEffect' in value.data
              ? { needsEffectMigration: false }
              : {}),
        });
        void cacheStartup(this.storage.local, normalized.settings);
      }
    }
  }
  update(patch: Partial<Settings>) {
    if (!this.writable) return;
    const result = settingsSchema.safeParse({ ...this.snapshot.settings, ...patch });
    if (!result.success) {
      this.publish({ error: result.error.issues[0]?.message ?? '설정값을 확인해 주세요.' });
      return;
    }
    this.revision++;
    this.publish({
      settings: result.data,
      status: 'saving',
      error: '',
      ...(patch.pageEffect !== undefined ? { needsEffectMigration: false } : {}),
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, 200);
  }
  async flush() {
    clearTimeout(this.timer);
    if (
      !this.writable ||
      (this.revision === this.savedRevision && this.snapshot.status !== 'error')
    )
      return this.queue;
    const revision = this.revision;
    const data = { ...this.snapshot.settings };
    const pendingPageEffectMigration = this.snapshot.needsEffectMigration;
    this.queue = this.queue.then(async () => {
      try {
        const item = {
          [SETTINGS_KEY]: {
            schemaVersion: 1,
            data,
            ...(pendingPageEffectMigration ? { pendingPageEffectMigration: true } : {}),
          },
        };
        checkSyncSize(item, await this.storage.sync.get(null));
        await this.storage.sync.set(item);
        await cacheStartup(this.storage.local, data);
        this.savedRevision = revision;
        if (this.revision === revision) this.publish({ status: 'saved', error: '' });
      } catch (error) {
        await this.storage.local.set({ 'unp.settings.recovery.v1': data }).catch(() => {});
        if (this.revision === revision)
          this.publish({ status: 'error', error: `저장하지 못했습니다. ${String(error)}` });
      }
    });
    return this.queue;
  }
  dispose() {
    clearTimeout(this.timer);
    this.observation++;
    this.unlisten();
    this.state.dispose();
  }
}
export { defaults };
export type { Settings };
