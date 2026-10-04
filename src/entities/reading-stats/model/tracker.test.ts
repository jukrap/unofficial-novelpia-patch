import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../../../../tests/helpers/storage';
import { ReadingStatsService } from './service';
import { ReadingStatsTracker, type ReadingStatsContext } from './tracker';
import {
  type ReadingStatsReport,
  type ReadingStatsSnapshot,
  type ReadingStatsSource,
} from './types';

function harness(initialTime = new Date(2026, 9, 4, 12).getTime()) {
  let wall = initialTime;
  let mono = 0;
  let snapshot: ReadingStatsSnapshot;
  const listeners = new Set<() => void>();
  const reports: ReadingStatsReport[] = [];
  const db = memoryStorage();
  const service = new ReadingStatsService(db.port, { now: () => wall });
  const context: ReadingStatsContext = {
    ready: true,
    episodeId: '1',
    visible: true,
    focused: true,
    blocked: false,
    incognito: false,
  };
  const source: ReadingStatsSource = {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async report(report) {
      reports.push(report);
      snapshot = await service.execute({ action: 'report', report });
      listeners.forEach((fn) => fn());
      return snapshot;
    },
  };
  const tracker = new ReadingStatsTracker(source, () => context, {
    wallNow: () => wall,
    monotonicNow: () => mono,
  });
  return {
    tracker,
    context,
    reports,
    source,
    service,
    async start() {
      snapshot = await service.execute({ action: 'read' });
      tracker.start();
      await tracker.flush();
    },
    async tick(seconds: number, flush = true) {
      for (let i = 0; i < seconds; i++) {
        wall += 1000;
        mono += 1000;
        tracker.refresh();
      }
      if (flush) await tracker.flush();
    },
    async jump(milliseconds: number) {
      wall += milliseconds;
      mono += milliseconds;
      tracker.refresh();
      await tracker.flush();
    },
    async wallJump(milliseconds: number) {
      wall += milliseconds;
      mono += 1000;
      tracker.refresh();
      await tracker.flush();
    },
    async publish(value: ReadingStatsSnapshot) {
      snapshot = value;
      listeners.forEach((fn) => fn());
      await tracker.flush();
    },
  };
}

describe('reading time observation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts only when the first foreground body appears and excludes hidden, blocked and incognito time', async () => {
    const h = harness();
    h.context.ready = false;
    await h.start();
    await h.tick(15);
    expect(h.source.getSnapshot().episodeCount).toBe(0);
    h.context.ready = true;
    h.tracker.refresh();
    await h.tick(15);
    expect(h.source.getSnapshot()).toMatchObject({ episodeCount: 1, totalMs: 15000 });
    for (const key of ['visible', 'focused', 'blocked', 'incognito'] as const) {
      const original = h.context[key];
      h.context[key] = !original;
      h.tracker.refresh();
      await h.tick(30);
      expect(h.source.getSnapshot().totalMs).toBe(15000);
      h.context[key] = original;
      h.tracker.refresh();
    }
    h.tracker.dispose();
    await h.tracker.flush();
    expect(h.source.getSnapshot().episodeCount).toBe(1);
  });

  it('stops after five minutes idle, resumes on activity, and ignores sleep gaps', async () => {
    const h = harness();
    await h.start();
    await h.tick(360);
    expect(h.source.getSnapshot().totalMs).toBe(300000);
    h.tracker.activity();
    await h.tick(15);
    expect(h.source.getSnapshot().totalMs).toBe(315000);
    await h.jump(60 * 60000);
    expect(h.source.getSnapshot().totalMs).toBe(315000);
    h.tracker.activity();
    await h.tick(1);
    expect(h.source.getSnapshot().totalMs).toBe(316000);
    h.tracker.dispose();
  });

  it('splits time at local midnight and counts a re-opened episode only once', async () => {
    const h = harness(new Date(2026, 9, 4, 23, 59, 58).getTime());
    await h.start();
    await h.tick(5);
    expect(h.source.getSnapshot()).toMatchObject({
      totalMs: 5000,
      activeDays: 2,
      daily: { '2026-10-04': 2000, '2026-10-05': 3000 },
    });
    h.context.episodeId = '2';
    h.tracker.refresh();
    await h.tick(1);
    h.context.episodeId = '1';
    h.tracker.refresh();
    await h.tick(1);
    expect(h.source.getSnapshot().episodeCount).toBe(2);
    h.tracker.dispose();
  });

  it('uses monotonic duration across wall-clock changes and stops stale work after reset or disable', async () => {
    const h = harness();
    await h.start();
    await h.tick(2);
    await h.wallJump(3600000);
    expect(h.source.getSnapshot().totalMs).toBe(3000);
    await h.publish(await h.service.execute({ action: 'set-enabled', enabled: false }));
    await h.tick(30);
    expect(h.source.getSnapshot().totalMs).toBe(3000);
    await h.publish(await h.service.execute({ action: 'reset' }));
    await h.tick(30);
    expect(h.source.getSnapshot().totalMs).toBe(0);
    await h.publish(await h.service.execute({ action: 'set-enabled', enabled: true }));
    await h.tick(5);
    expect(h.source.getSnapshot().totalMs).toBe(5000);
    h.tracker.dispose();
  });

  it('continues counting after moving the clock backward and restoring it without reloading', async () => {
    const h = harness();
    await h.start();
    await h.tick(15);
    expect(h.source.getSnapshot().totalMs).toBe(15000);
    await h.wallJump(-3600000);
    await h.tick(30);
    expect(h.source.getSnapshot().totalMs).toBe(46000);
    await h.wallJump(3600000);
    await h.tick(30);
    expect(h.source.getSnapshot()).toMatchObject({ totalMs: 77000, episodeCount: 1, error: '' });
    expect(new Set(h.reports.map((report) => report.sessionId)).size).toBe(3);
    h.tracker.dispose();
  });

  it('retains unreported seconds when a clock correction replaces the session', async () => {
    const h = harness();
    await h.start();
    await h.tick(8, false);
    expect(h.source.getSnapshot().totalMs).toBe(0);
    await h.wallJump(-3600000);
    expect(h.source.getSnapshot().totalMs).toBe(9000);
    await h.wallJump(3 * 86400000);
    await h.tick(5);
    expect(h.source.getSnapshot().totalMs).toBe(15000);
    h.tracker.dispose();
  });

  it('does not lose monotonic elapsed time during a small backward clock correction', async () => {
    const h = harness();
    await h.start();
    await h.wallJump(-500);
    await h.tick(1);
    expect(h.source.getSnapshot().totalMs).toBe(2000);
    h.tracker.dispose();
  });
});
