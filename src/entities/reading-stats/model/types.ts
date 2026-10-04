export const STATS_CHANNEL = 'unp.reading-stats.v1';
export const STATS_KEYS = {
  meta: 'unp.reading-stats.v1.meta',
  days: 'unp.reading-stats.v1.days',
  episodes: 'unp.reading-stats.v1.episodes',
} as const;
export const STATS_BYTE_LIMIT = 2 * 1024 * 1024;
export const STATS_REPORT_INTERVAL = 15_000;
export const STATS_IDLE_LIMIT = 5 * 60_000;
export const STATS_SESSION_LIFETIME = 48 * 60 * 60_000;

export interface ReadingStatsSnapshot {
  ready: boolean;
  enabled: boolean;
  epoch: string;
  error: string;
  startedAt: number | null;
  totalMs: number;
  todayMs: number;
  activeDays: number;
  episodeCount: number;
  daily: Record<string, number>;
}

export const emptyStats: ReadingStatsSnapshot = {
  ready: false,
  enabled: true,
  epoch: '',
  error: '',
  startedAt: null,
  totalMs: 0,
  todayMs: 0,
  activeDays: 0,
  episodeCount: 0,
  daily: {},
};

/** Deltas have a durable sequence number, so an acknowledged report can be retried safely. */
export interface ReadingStatsReport {
  epoch: string;
  sessionId: string;
  startedAt: number;
  sequence: number;
  episodeId: string;
  daily: Record<string, number>;
}

export type ReadingStatsCommand =
  | { action: 'read' | 'reset' | 'retry' }
  | { action: 'set-enabled'; enabled: boolean }
  | { action: 'report'; report: ReadingStatsReport };

export interface ReadingStatsSource {
  getSnapshot(): ReadingStatsSnapshot;
  subscribe(listener: () => void): () => void;
  report(report: ReadingStatsReport): Promise<ReadingStatsSnapshot>;
}

export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
