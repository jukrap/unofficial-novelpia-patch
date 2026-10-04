import { z } from 'zod';
import type { StoragePort } from '@/shared/platform/storage';
import {
  emptyStats,
  localDateKey,
  STATS_BYTE_LIMIT,
  STATS_KEYS,
  STATS_SESSION_LIFETIME,
  type ReadingStatsCommand,
  type ReadingStatsSnapshot,
} from './types';

// Build the background-only validators on service creation, so importing the slice's client
// does not execute schema construction or retain this implementation in management bundles.
function createStatsSchemas() {
  const identifier = z.string().uuid();
  const day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const [year = 0, month = 0, date = 0] = value.split('-').map(Number);
      return localDateKey(new Date(year, month - 1, date).getTime()) === value;
    });
  const daysSchema = z.record(day, z.number().finite().nonnegative());
  const metaSchema = z.object({
    version: z.literal(1),
    enabled: z.boolean(),
    epoch: identifier,
    startedAt: z.number().finite().nullable(),
    paused: z.string(),
    sessions: z.record(
      identifier,
      z.object({
        sequence: z.number().int().positive(),
        startedAt: z.number().finite(),
      })
    ),
  });
  const episodesSchema = z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
  const reportSchema = z.object({
    epoch: identifier,
    sessionId: identifier,
    startedAt: z.number().finite(),
    sequence: z.number().int().positive(),
    episodeId: z
      .string()
      .regex(/^\d{1,15}$/)
      .refine((id) => Number(id) > 0),
    daily: daysSchema.refine(
      (value) => Object.keys(value).length <= 4 && Object.values(value).every((ms) => ms <= 60_000)
    ),
  });
  const commandSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('read') }),
    z.object({ action: z.literal('reset') }),
    z.object({ action: z.literal('retry') }),
    z.object({ action: z.literal('set-enabled'), enabled: z.boolean() }),
    z.object({ action: z.literal('report'), report: reportSchema }),
  ]);
  return { metaSchema, daysSchema, episodesSchema, commandSchema };
}
type Meta = z.infer<ReturnType<typeof createStatsSchemas>['metaSchema']>;

/** The background owns this service; readers and management screens never write its keys. */
export class ReadingStatsService {
  private schemas = createStatsSchemas();
  private meta: Meta | undefined;
  private days: Record<string, number> = {};
  private episodes: number[] = [];
  private episodeSet = new Set<number>();
  private queue: Promise<unknown> = Promise.resolve();
  private error = '';

  constructor(
    private storage: StoragePort,
    private options: { now?: () => number; byteLimit?: number } = {}
  ) {}

  private now() {
    return (this.options.now ?? Date.now)();
  }

  private fresh(enabled = true): Meta {
    return {
      version: 1,
      enabled,
      epoch: crypto.randomUUID(),
      startedAt: null,
      paused: '',
      sessions: {},
    };
  }

  private async load() {
    const raw = await this.storage.local.get(Object.values(STATS_KEYS));
    if (raw[STATS_KEYS.meta] === undefined) {
      if (raw[STATS_KEYS.days] !== undefined || raw[STATS_KEYS.episodes] !== undefined)
        throw new Error('통계 기록을 확인하지 못했습니다. 다시 시도하거나 통계만 삭제해 주세요.');
      const meta = this.fresh();
      await this.storage.local.set({ [STATS_KEYS.meta]: meta });
      this.meta = meta;
      this.days = {};
      this.episodes = [];
    } else {
      const meta = this.schemas.metaSchema.parse(raw[STATS_KEYS.meta]);
      const days = this.schemas.daysSchema.parse(raw[STATS_KEYS.days] ?? {});
      const episodes = this.schemas.episodesSchema.parse(raw[STATS_KEYS.episodes] ?? []);
      this.meta = meta;
      this.days = days;
      this.episodes = [...new Set(episodes)];
    }
    this.episodeSet = new Set(this.episodes);
    this.error = '';
  }

  private snapshot(): ReadingStatsSnapshot {
    if (!this.meta)
      return { ...emptyStats, ready: true, error: this.error || '통계를 불러오지 못했습니다.' };
    return {
      ready: true,
      enabled: this.meta.enabled,
      epoch: this.meta.epoch,
      error: this.error || this.meta.paused,
      startedAt: this.meta.startedAt,
      totalMs: Object.values(this.days).reduce((sum, ms) => sum + ms, 0),
      todayMs: this.days[localDateKey(this.now())] ?? 0,
      activeDays: Object.values(this.days).filter((ms) => ms > 0).length,
      episodeCount: this.episodes.length,
      daily: { ...this.days },
    };
  }

  private async save(meta: Meta, days: Record<string, number>, episodes: number[], reset = false) {
    const document = {
      [STATS_KEYS.meta]: meta,
      [STATS_KEYS.days]: days,
      [STATS_KEYS.episodes]: episodes,
    };
    if (
      new TextEncoder().encode(JSON.stringify(document)).byteLength >
      (this.options.byteLimit ?? STATS_BYTE_LIMIT)
    )
      throw new Error('통계 저장 공간이 가득 찼습니다. 통계를 삭제하면 다시 기록할 수 있습니다.');
    await this.storage.local.set({
      [STATS_KEYS.meta]: meta,
      ...(reset || days !== this.days ? { [STATS_KEYS.days]: days } : {}),
      ...(reset || episodes !== this.episodes ? { [STATS_KEYS.episodes]: episodes } : {}),
    });
    this.meta = meta;
    this.days = days;
    if (episodes !== this.episodes) this.episodeSet = new Set(episodes);
    this.episodes = episodes;
    this.error = '';
  }

  private async fail(cause: unknown) {
    this.error =
      cause instanceof Error && !(cause instanceof z.ZodError)
        ? cause.message
        : '통계 기록을 확인하지 못했습니다. 다시 시도하거나 통계만 삭제해 주세요.';
    if (!this.error.includes('통계'))
      this.error = '통계를 저장하지 못했습니다. 다시 시도해 주세요.';
    // A small pause marker can still fit when another local key has exhausted the quota.
    if (this.meta) {
      const paused = { ...this.meta, epoch: crypto.randomUUID(), paused: this.error, sessions: {} };
      this.meta = paused;
      await this.storage.local.set({ [STATS_KEYS.meta]: paused }).catch(() => {});
    }
    return this.snapshot();
  }

  execute(input: ReadingStatsCommand | unknown): Promise<ReadingStatsSnapshot> {
    const command = this.schemas.commandSchema.safeParse(input);
    if (!command.success) return Promise.reject(new Error('지원하지 않는 통계 작업입니다.'));
    const operation = this.queue.then(async () => {
      try {
        if (command.data.action === 'reset') {
          if (!this.meta) await this.load().catch(() => {});
          await this.save(this.fresh(this.meta?.enabled ?? true), {}, [], true);
          return this.snapshot();
        }
        if (!this.meta || command.data.action === 'retry') await this.load();
        const meta = this.meta!;
        if (command.data.action === 'retry') {
          await this.save(
            { ...meta, epoch: crypto.randomUUID(), paused: '', sessions: {} },
            this.days,
            this.episodes
          );
        } else if (command.data.action === 'set-enabled') {
          await this.save(
            { ...meta, enabled: command.data.enabled, epoch: crypto.randomUUID(), sessions: {} },
            this.days,
            this.episodes
          );
        } else if (command.data.action === 'report') {
          const report = command.data.report;
          if (!meta.enabled || this.error || meta.paused || report.epoch !== meta.epoch)
            return this.snapshot();
          const now = this.now();
          const previous = meta.sessions[report.sessionId];
          // A known session may have sent this delta before the user adjusted the system clock.
          // Its persisted sequence remains authoritative; only unknown sessions need an age check.
          if (
            !previous &&
            (report.startedAt > now + 60_000 || report.startedAt < now - STATS_SESSION_LIFETIME)
          )
            return this.snapshot();
          if ((previous?.sequence ?? 0) >= report.sequence) return this.snapshot();
          // Each tracker sends reports in order. A missing first report must not invent a session.
          if (
            report.sequence !== (previous?.sequence ?? 0) + 1 ||
            (previous && previous.startedAt !== report.startedAt)
          )
            return this.snapshot();
          const sessions = Object.fromEntries(
            Object.entries(meta.sessions).filter(
              ([, value]) => value.startedAt >= now - STATS_SESSION_LIFETIME
            )
          );
          sessions[report.sessionId] = { sequence: report.sequence, startedAt: report.startedAt };
          const days = { ...this.days };
          for (const [date, ms] of Object.entries(report.daily))
            if (ms > 0) days[date] = (days[date] ?? 0) + ms;
          const episode = Number(report.episodeId);
          const unseen = !this.episodeSet.has(episode);
          const episodes = unseen ? [...this.episodes, episode] : this.episodes;
          await this.save({ ...meta, sessions, startedAt: meta.startedAt ?? now }, days, episodes);
        }
        return this.snapshot();
      } catch (cause) {
        return this.fail(cause);
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
