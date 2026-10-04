import {
  localDateKey,
  STATS_IDLE_LIMIT,
  STATS_REPORT_INTERVAL,
  STATS_SESSION_LIFETIME,
  type ReadingStatsSource,
  type ReadingStatsReport,
} from './types';

export interface ReadingStatsContext {
  ready: boolean;
  episodeId: string | null;
  visible: boolean;
  focused: boolean;
  blocked: boolean;
  incognito: boolean;
}
export interface ReadingStatsClock {
  wallNow?: () => number;
  monotonicNow?: () => number;
}

/** No DOM or reader-engine dependencies: the application supplies eligibility and trusted activity. */
export class ReadingStatsTracker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private stop = () => {};
  private running = false;
  private active = false;
  private epoch = '';
  private episode = '';
  private sessionId = '';
  private sessionStart = 0;
  private sequence = 0;
  private lastMono = 0;
  private lastWall = 0;
  private lastActivity = 0;
  private lastReport = 0;
  private pending: Record<string, number> = {};
  private reportQueue: Promise<unknown> = Promise.resolve();
  private wasEligible = false;

  constructor(
    private source: ReadingStatsSource,
    private getContext: () => ReadingStatsContext,
    private clock: ReadingStatsClock = {}
  ) {}
  private wallNow() {
    return (this.clock.wallNow ?? Date.now)();
  }
  private monoNow() {
    return (this.clock.monotonicNow ?? (() => performance.now()))();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastMono = this.lastActivity = this.lastReport = this.monoNow();
    this.lastWall = this.wallNow();
    this.stop = this.source.subscribe(() => this.refresh());
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 1000);
  }

  private begin(episode: string, now: number) {
    this.episode = episode;
    this.pending = {};
    this.renewSession(now);
    this.active = true;
    // The first report records an opened episode even before a full reading second passes.
    void this.flush(true);
  }

  private renewSession(now: number) {
    this.sessionId = crypto.randomUUID();
    this.sessionStart = this.wallNow();
    this.sequence = 0;
    this.lastReport = now;
  }

  private addTime(start: number, end: number, elapsed: number) {
    // A wall-clock adjustment must not manufacture elapsed time or an artificial range of days.
    if (end < start || Math.abs(end - start - elapsed) > 2000) {
      const day = localDateKey(end);
      this.pending[day] = (this.pending[day] ?? 0) + elapsed;
      return;
    }
    let position = start;
    while (position < end) {
      const date = new Date(position);
      const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
      const stop = Math.min(end, midnight);
      const key = localDateKey(position);
      this.pending[key] = (this.pending[key] ?? 0) + elapsed * ((stop - position) / (end - start));
      position = stop;
    }
    if (end === start) {
      const key = localDateKey(end);
      this.pending[key] = (this.pending[key] ?? 0) + elapsed;
    }
  }

  refresh = () => {
    if (!this.running) return;
    const snapshot = this.source.getSnapshot();
    const context = this.getContext();
    const now = this.monoNow();
    const wall = this.wallNow();
    const elapsed = now - this.lastMono;
    if (snapshot.epoch !== this.epoch || !snapshot.enabled || snapshot.error) {
      this.epoch = snapshot.epoch;
      this.pending = {};
      this.active = false;
      this.wasEligible = false;
      this.sessionId = '';
    }
    const eligible =
      snapshot.ready &&
      snapshot.enabled &&
      !snapshot.error &&
      !!snapshot.epoch &&
      context.ready &&
      !!context.episodeId &&
      /^\d{1,15}$/.test(context.episodeId) &&
      context.visible &&
      context.focused &&
      !context.blocked &&
      !context.incognito;
    // Opening the reader or returning to it grants an idle interval without requiring a page turn.
    if (eligible && !this.wasEligible) this.lastActivity = now;
    const current = eligible && now - this.lastActivity < STATS_IDLE_LIMIT;
    // A delayed timer after sleep/freeze is not evidence that the person kept reading.
    if (this.active && elapsed > 0 && elapsed <= 5000) {
      const accepted = Math.min(
        elapsed,
        Math.max(0, this.lastActivity + STATS_IDLE_LIMIT - this.lastMono)
      );
      if (accepted > 0)
        this.addTime(
          this.lastWall,
          accepted === elapsed ? wall : this.lastWall + accepted,
          accepted
        );
    }
    if (this.active && Math.abs(wall - this.lastWall - elapsed) > 2000) {
      // The clock can move in either direction. Preserve measured deltas but give subsequent
      // reports a current session timestamp, rather than repeatedly sending a future/expired one.
      this.renewSession(now);
      void this.flush(true);
    }
    const changedEpisode = this.episode !== context.episodeId;
    if (
      this.active &&
      (!current || changedEpisode || wall - this.sessionStart >= STATS_SESSION_LIFETIME / 2)
    ) {
      void this.flush();
      this.active = false;
    }
    this.lastMono = now;
    this.lastWall = wall;
    this.wasEligible = !!eligible;
    if (current && !this.active) this.begin(context.episodeId!, now);
    if (this.active && now - this.lastReport >= STATS_REPORT_INTERVAL) void this.flush();
  };

  activity = () => {
    this.refresh();
    this.lastActivity = this.monoNow();
    this.refresh();
  };

  flush(force = false): Promise<unknown> {
    if (!this.sessionId || (!force && !Object.values(this.pending).some((ms) => ms > 0)))
      return this.reportQueue;
    const report: ReadingStatsReport = {
      epoch: this.epoch,
      sessionId: this.sessionId,
      startedAt: this.sessionStart,
      sequence: ++this.sequence,
      episodeId: this.episode,
      daily: this.pending,
    };
    this.pending = {};
    this.lastReport = this.monoNow();
    this.reportQueue = this.reportQueue
      .then(async () => {
        const snapshot = this.source.getSnapshot();
        if (!snapshot.enabled || snapshot.error || snapshot.epoch !== report.epoch) return;
        await this.source.report(report);
      })
      .catch(() => {
        /* Reading remains available if an extension context closes. */
      });
    return this.reportQueue;
  }

  dispose() {
    if (!this.running) return;
    this.refresh();
    void this.flush();
    this.running = false;
    clearInterval(this.timer);
    this.stop();
  }
}
