import { describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../../../../tests/helpers/storage';
import { ReadingStatsService } from './service';
import { STATS_KEYS, type ReadingStatsReport } from './types';

const timestamp = new Date(2026, 9, 4, 12).getTime();
const newReport = (epoch: string, extra: Partial<ReadingStatsReport> = {}): ReadingStatsReport => ({
  epoch,
  sessionId: crypto.randomUUID(),
  startedAt: timestamp,
  sequence: 1,
  episodeId: '1234',
  daily: { '2026-10-04': 15000 },
  ...extra,
});

describe('local reading statistics service', () => {
  it('persists unique episodes and deduplicates concurrent reports and worker restarts', async () => {
    const db = memoryStorage();
    const service = new ReadingStatsService(db.port, { now: () => timestamp });
    const first = await service.execute({ action: 'read' });
    expect(first).toMatchObject({ ready: true, enabled: true, startedAt: null, totalMs: 0 });
    const report = newReport(first.epoch);
    await Promise.all([
      service.execute({ action: 'report', report }),
      service.execute({ action: 'report', report }),
      service.execute({
        action: 'report',
        report: newReport(first.epoch, { daily: { '2026-10-04': 5000 } }),
      }),
    ]);
    const restarted = new ReadingStatsService(db.port, { now: () => timestamp });
    expect(await restarted.execute({ action: 'report', report })).toMatchObject({
      totalMs: 20000,
      episodeCount: 1,
      activeDays: 1,
    });
    expect(
      await restarted.execute({
        action: 'report',
        report: {
          ...report,
          sequence: 2,
          episodeId: '5678',
          daily: { '2026-10-03': 5000, '2026-10-04': 1000 },
        },
      })
    ).toMatchObject({ totalMs: 26000, todayMs: 21000, episodeCount: 2, activeDays: 2 });
    expect(db.syncData).toEqual({});
    expect(Object.keys(db.localData).sort()).toEqual(Object.values(STATS_KEYS).sort());
  });

  it('keeps deletion and disabling final when old reports arrive later', async () => {
    const db = memoryStorage();
    const service = new ReadingStatsService(db.port, { now: () => timestamp });
    const initial = await service.execute({ action: 'read' });
    const report = newReport(initial.epoch);
    await service.execute({ action: 'report', report });
    const disabled = await service.execute({ action: 'set-enabled', enabled: false });
    expect(disabled.epoch).not.toBe(initial.epoch);
    expect(
      await service.execute({ action: 'report', report: { ...report, sequence: 2 } })
    ).toMatchObject({ enabled: false, totalMs: 15000 });
    const reset = await service.execute({ action: 'reset' });
    expect(reset).toMatchObject({ enabled: false, totalMs: 0, episodeCount: 0, startedAt: null });
    expect(await service.execute({ action: 'report', report })).toMatchObject({
      totalMs: 0,
      episodeCount: 0,
    });
    const enabled = await service.execute({ action: 'set-enabled', enabled: true });
    expect(
      await service.execute({ action: 'report', report: newReport(enabled.epoch) })
    ).toMatchObject({ totalMs: 15000, episodeCount: 1 });
  });

  it('preserves stored totals and pauses durably on storage failure until explicit retry', async () => {
    const db = memoryStorage();
    const service = new ReadingStatsService(db.port, { now: () => timestamp });
    const initial = await service.execute({ action: 'read' });
    const report = newReport(initial.epoch);
    await service.execute({ action: 'report', report });
    const save = db.port.local.set;
    db.port.local.set = vi.fn(async (items) => {
      if (STATS_KEYS.days in items) throw new Error('QUOTA_BYTES exceeded');
      return save(items);
    });
    const failed = await service.execute({ action: 'report', report: { ...report, sequence: 2 } });
    expect(failed.totalMs).toBe(15000);
    expect(failed.error).toContain('통계');
    const restarted = new ReadingStatsService(db.port, { now: () => timestamp });
    expect((await restarted.execute({ action: 'read' })).error).toBe(failed.error);
    db.port.local.set = save;
    const retry = await restarted.execute({ action: 'retry' });
    expect(retry.error).toBe('');
    expect(retry.epoch).not.toBe(initial.epoch);
    expect(
      await restarted.execute({ action: 'report', report: newReport(retry.epoch) })
    ).toMatchObject({ totalMs: 30000 });
  });

  it('enforces the byte budget without deleting data and can reset a damaged document', async () => {
    const db = memoryStorage();
    const service = new ReadingStatsService(db.port, { now: () => timestamp, byteLimit: 300 });
    const initial = await service.execute({ action: 'read' });
    const failed = await service.execute({ action: 'report', report: newReport(initial.epoch) });
    expect(failed).toMatchObject({ totalMs: 0, episodeCount: 0 });
    expect(failed.error).toContain('저장 공간');
    await db.port.local.set({ [STATS_KEYS.meta]: { version: 99 }, [STATS_KEYS.episodes]: [42] });
    const damaged = new ReadingStatsService(db.port);
    expect((await damaged.execute({ action: 'read' })).error).not.toBe('');
    expect(db.localData[STATS_KEYS.episodes]).toEqual([42]);
    expect(await damaged.execute({ action: 'reset' })).toMatchObject({
      error: '',
      totalMs: 0,
      episodeCount: 0,
    });
  });

  it('keeps unique IDs without rewriting them for ordinary time reports', async () => {
    const db = memoryStorage();
    const service = new ReadingStatsService(db.port, { now: () => timestamp });
    const initial = await service.execute({ action: 'read' });
    await db.port.local.set({ [STATS_KEYS.episodes]: [1234, 5678] });
    const restarted = new ReadingStatsService(db.port, { now: () => timestamp });
    const current = await restarted.execute({ action: 'read' });
    const save = vi.spyOn(db.port.local, 'set');
    const report = newReport(current.epoch);
    expect(await restarted.execute({ action: 'report', report })).toMatchObject({
      episodeCount: 2,
      error: '',
    });
    expect(save.mock.calls.every(([items]) => !(STATS_KEYS.episodes in items))).toBe(true);
    expect(initial.epoch).toBe(current.epoch);
  });

  it('rejects malformed payloads and expired or out-of-order sessions', async () => {
    const db = memoryStorage();
    const service = new ReadingStatsService(db.port, { now: () => timestamp });
    const initial = await service.execute({ action: 'read' });
    await expect(
      service.execute({
        action: 'report',
        report: newReport(initial.epoch, { daily: { '2026-99-99': 100 } }),
      })
    ).rejects.toThrow();
    for (const report of [
      newReport(initial.epoch, { sequence: 2 }),
      newReport(initial.epoch, { startedAt: timestamp - 3 * 86400000 }),
    ]) {
      expect(await service.execute({ action: 'report', report })).toMatchObject({
        totalMs: 0,
        episodeCount: 0,
      });
    }
  });

  it('accepts already-issued deltas after a backward clock adjustment and still rejects replay', async () => {
    let wall = timestamp;
    const db = memoryStorage();
    const service = new ReadingStatsService(db.port, { now: () => wall });
    const initial = await service.execute({ action: 'read' });
    const report = newReport(initial.epoch);
    await service.execute({ action: 'report', report });
    wall -= 3600000;
    const issued = { ...report, sequence: 2 };
    expect(await service.execute({ action: 'report', report: issued })).toMatchObject({
      totalMs: 30000,
    });
    expect(await service.execute({ action: 'report', report: issued })).toMatchObject({
      totalMs: 30000,
    });
    wall += 3600000;
    expect(
      await service.execute({ action: 'report', report: { ...report, sequence: 3 } })
    ).toMatchObject({ totalMs: 45000 });
  });
});
