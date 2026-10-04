import { z } from 'zod';
import { observableState } from '@/shared/model/observable-state';
import {
  applyPresetSettings,
  defaults,
  normalizeSettings,
  settingsSchema,
  visualSettings,
  type Preset,
  type Settings,
} from '@/shared/model/preferences';
import { checkSyncSize, type StoragePort } from '@/shared/platform/storage';
import { builtInPresets, findPreset, legacyBuiltInPresets } from '../config/catalog';
import { PresetConflictError, presetRevision, type PresetDraft } from './draft';

export { builtInPresets, legacyBuiltInPresets, findPreset } from '../config/catalog';
export { createPresetDraft, presetRevision, PresetConflictError, type PresetDraft } from './draft';
export {
  PRESET_SETTING_KEYS,
  applyPresetSettings,
  presetSettingsEqual,
} from '@/shared/model/preferences';

const INDEX = 'unp.presetIndex.v1';
const key = (id: string) => `unp.preset.v1.${id}`;
const presetSchema = z.object({
  id: z.string().min(1).max(180),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000),
  isDefault: z.boolean(),
  createdAt: z.number().finite(),
  settings: settingsSchema,
});
export interface PresetSnapshot {
  presets: Preset[];
  selectedId: string | null;
  error: string;
}
export interface PresetSaveOptions {
  expectedRevision?: string;
}

function readState(raw: Record<string, unknown>): Omit<PresetSnapshot, 'error'> {
  const index = raw[INDEX] as { schemaVersion?: number; ids?: unknown; selectedId?: unknown };
  if (index?.schemaVersion !== 1 || !Array.isArray(index.ids))
    throw new Error('프리셋 버전을 확인해 주세요.');
  const presets: Preset[] = [];
  for (const id of index.ids) {
    const source = raw[key(String(id))] as Record<string, unknown> | null | undefined;
    // New optional features must not make existing schema 1 user presets disappear.
    // Fill missing keys only; explicitly malformed saved values still fail validation.
    const parsed = presetSchema.safeParse(
      source &&
        typeof source.settings === 'object' &&
        source.settings &&
        !Array.isArray(source.settings)
        ? { ...source, settings: { ...defaults, ...source.settings } }
        : source
    );
    if (parsed.success && !presets.some((preset) => preset.id === parsed.data.id))
      presets.push(parsed.data);
  }
  return {
    presets,
    selectedId: typeof index.selectedId === 'string' ? index.selectedId : null,
  };
}

function indexOf(state: Omit<PresetSnapshot, 'error'>) {
  return {
    schemaVersion: 1,
    ids: state.presets.map((preset) => preset.id),
    selectedId: state.selectedId,
  };
}
export class PresetStore {
  readonly state = observableState<PresetSnapshot>({ presets: [], selectedId: null, error: '' });
  private get snapshot() {
    return this.state.getState();
  }
  private stop = () => {};
  private queue: Promise<unknown> = Promise.resolve();
  private busy = 0;
  private pendingReload = false;
  private writable = false;
  constructor(private storage: StoragePort) {}
  getSnapshot = this.state.getState;
  isReady = () => this.writable;
  subscribe = this.state.subscribe;
  private publish(patch: Partial<PresetSnapshot>) {
    this.state.setState(patch);
  }
  async initialize() {
    try {
      const raw = await this.storage.sync.get(null);
      if (!raw[INDEX]) {
        const old = Array.isArray(raw['unp.presets.v4'])
          ? raw['unp.presets.v4']
          : raw.novolpiaPatchPresets;
        const presets: Preset[] = [];
        const issues: string[] = [];
        if (Array.isArray(old))
          for (const value of old) {
            const normalized = normalizeSettings(value?.settings);
            const parsed = presetSchema.safeParse({
              ...value,
              settings: visualSettings(normalized.settings),
            });
            if (
              parsed.success &&
              !parsed.data.isDefault &&
              !presets.some((p) => p.id === parsed.data.id)
            )
              presets.push(parsed.data);
            else if (!value?.isDefault)
              issues.push('읽을 수 없는 프리셋을 원본 백업에 보관했습니다.');
          }
        await this.storage.local.set({ 'unp.migration.presets.v1': { legacy: old ?? null } });
        const selected = raw['unp.currentPresetId.v4'] ?? raw.currentPresetId;
        const migrated = {
          presets,
          selectedId: typeof selected === 'string' ? selected : null,
        };
        await this.write(
          migrated,
          {
            ...Object.fromEntries(presets.map((preset) => [key(preset.id), preset])),
            [INDEX]: indexOf(migrated),
          },
          raw
        );
        await this.reload(await this.storage.sync.get(null));
        this.publish({ error: issues.join(' ') });
        await this.storage.local.set({ 'unp.migration.presets.complete.v1': true });
      } else await this.reload(raw);
      this.writable = true;
      this.stop = this.storage.listen((changes, area) => {
        if (
          area === 'sync' &&
          (changes[INDEX] || Object.keys(changes).some((k) => k.startsWith('unp.preset.v1.')))
        ) {
          if (this.busy) {
            this.pendingReload = true;
            return;
          }
          void this.storage.sync
            .get(null)
            .then((raw) => this.reload(raw))
            .catch((error) => this.publish({ error: String(error) }));
        }
      });
    } catch (error) {
      this.publish({ error: String(error) });
    }
  }
  private async reload(raw: Record<string, unknown>) {
    this.publish(readState(raw));
  }
  private async write(
    next: Omit<PresetSnapshot, 'error'>,
    items: Record<string, unknown>,
    raw: Record<string, unknown>
  ) {
    try {
      checkSyncSize(items, raw);
      await this.storage.sync.set(items);
    } catch (error) {
      await this.storage.local.set({ 'unp.presets.recovery.v1': next }).catch(() => {});
      throw error;
    }
    this.publish({ ...next, error: '' });
  }
  async select(id: string | null) {
    return this.enqueue(async () => {
      const raw = await this.storage.sync.get(null);
      const current = readState(raw);
      if (id && !findPreset(id, current.presets)) throw new Error('프리셋을 찾을 수 없습니다.');
      const next = { ...current, selectedId: id };
      await this.write(next, { [INDEX]: indexOf(next) }, raw);
    });
  }
  async save(
    name: string,
    description: string,
    settings: Settings,
    id?: string,
    options: PresetSaveOptions = {}
  ) {
    const observed = this.snapshot.presets.find((preset) => preset.id === id);
    const expectedRevision =
      options.expectedRevision ?? (observed ? presetRevision(observed) : undefined);
    return this.enqueue(async () => {
      if ([...builtInPresets, ...legacyBuiltInPresets].some((preset) => preset.id === id))
        throw new Error('기본 프리셋은 새 프리셋으로 저장해 주세요.');
      const raw = await this.storage.sync.get(null);
      const current = readState(raw);
      const original = current.presets.find((preset) => preset.id === id);
      // Chrome storage has no atomic CAS. This detects completed edits, not every concurrent
      // write arriving between this read and set (including synchronization from another device).
      if (id && (!original || expectedRevision !== presetRevision(original)))
        throw new PresetConflictError(original ?? null);
      const parsed = presetSchema.parse({
        id: id ?? crypto.randomUUID(),
        name,
        description,
        isDefault: false,
        createdAt: original?.createdAt ?? Date.now(),
        settings: visualSettings(applyPresetSettings(defaults, settings)),
      });
      if (current.presets.some((p) => p.id !== parsed.id && p.name === parsed.name))
        throw new Error('같은 이름의 프리셋이 있습니다.');
      const next = {
        ...current,
        presets: original
          ? current.presets.map((preset) => (preset.id === original.id ? parsed : preset))
          : [...current.presets, parsed],
      };
      // Only the edited item is written. An unrelated preset or selection must not be overwritten.
      const items: Record<string, unknown> = { [key(parsed.id)]: parsed };
      if (!original) items[INDEX] = indexOf(next);
      await this.write(next, items, raw);
      return parsed;
    });
  }
  saveDraft(draft: PresetDraft) {
    return this.save(draft.name, draft.description, draft.settings, draft.id, {
      expectedRevision: draft.sourceRevision ?? undefined,
    });
  }
  async remove(id: string, options: PresetSaveOptions = {}) {
    const observed = this.snapshot.presets.find((preset) => preset.id === id);
    const expectedRevision =
      options.expectedRevision ?? (observed ? presetRevision(observed) : undefined);
    return this.enqueue(async () => {
      const raw = await this.storage.sync.get(null);
      const current = readState(raw);
      const original = current.presets.find((preset) => preset.id === id);
      if (!original || expectedRevision !== presetRevision(original))
        throw new PresetConflictError(original ?? null);
      const next = {
        presets: current.presets.filter((preset) => preset.id !== id),
        selectedId: current.selectedId === id ? null : current.selectedId,
      };
      // The logical deletion and selection change share one write. Physical cleanup is optional.
      await this.write(next, { [INDEX]: indexOf(next), [key(id)]: null }, raw);
      await this.storage.sync.remove(key(id)).catch(() => {});
    });
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.writable)
      return Promise.reject(
        new Error('프리셋을 읽지 못해 변경할 수 없습니다. 백업 또는 확장 버전을 확인해 주세요.')
      );
    this.busy++;
    const next = this.queue.then(operation).finally(async () => {
      this.busy--;
      if (!this.busy && this.pendingReload) {
        this.pendingReload = false;
        await this.storage.sync
          .get(null)
          .then((raw) => this.reload(raw))
          .catch((error) => this.publish({ error: String(error) }));
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }
  export(settings: Settings) {
    return JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        settings: visualSettings(settings),
        presets: this.snapshot.presets.map((p) => ({
          ...p,
          settings: visualSettings({ ...defaults, ...p.settings }),
        })),
        selectedId: this.snapshot.selectedId,
      },
      null,
      2
    );
  }
  async importBackup(text: string) {
    return this.enqueue(async () => {
      const incoming = this.parseImport(text);
      const raw = await this.storage.sync.get(null);
      const existing = readState(raw);
      const used = new Set(existing.presets.map((p) => p.name));
      const create = (name: string, description: string, settings: Settings): Preset => {
        const base = name.trim().slice(0, 70) || '가져온 프리셋';
        let unique = base;
        for (let n = 2; used.has(unique); n++) unique = `${base} (${n})`;
        used.add(unique);
        return {
          id: crypto.randomUUID(),
          name: unique,
          description,
          settings: visualSettings(settings),
          isDefault: false,
          createdAt: Date.now(),
        };
      };
      const added = incoming.presets.map((p) =>
        create(p.name, p.description, { ...defaults, ...p.settings })
      );
      const current = create('가져온 설정', '백업에서 가져온 독서 설정', incoming.settings);
      const presets = [...existing.presets, ...added, current];
      const items = Object.fromEntries([...added, current].map((p) => [key(p.id), p]));
      const batch = {
        ...items,
        [INDEX]: { schemaVersion: 1, ids: presets.map((p) => p.id), selectedId: current.id },
      };
      // Validate the entire batch before writing so failed imports do not leave partial presets.
      await this.write({ presets, selectedId: current.id }, batch, raw);
      return incoming.settings;
    });
  }
  parseImport(text: string): { settings: Settings; presets: Preset[] } {
    if (text.length > 2_000_000) throw new Error('백업 파일이 너무 큽니다.');
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('설정 JSON 객체가 필요합니다.');
    if ('schemaVersion' in raw && raw.schemaVersion !== 1)
      throw new Error('지원하지 않는 백업 버전입니다.');
    const source = raw.settings ?? raw;
    if (!source || typeof source !== 'object' || !Object.keys(source).some((k) => k in defaults))
      throw new Error('독서 설정이 없는 파일입니다.');
    const parsed = normalizeSettings(source);
    if (parsed.issues.length) throw new Error(`잘못된 설정: ${parsed.issues.join(', ')}`);
    if ('presets' in raw && !Array.isArray(raw.presets))
      throw new Error('프리셋 목록 형식이 잘못되었습니다.');
    const presets = Array.isArray(raw.presets)
      ? raw.presets.map((p) =>
          presetSchema.parse({ ...p, settings: visualSettings({ ...defaults, ...p.settings }) })
        )
      : [];
    return { settings: visualSettings(parsed.settings), presets };
  }
  dispose() {
    this.stop();
    this.state.dispose();
  }
}
