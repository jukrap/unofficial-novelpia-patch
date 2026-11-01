import { beforeEach, expect, it, vi } from 'vitest';
import { SettingsStore } from '@/entities/settings';
import type { NativeState } from '@/shared/model/native-protocol';
import { memoryStorage } from '../../../tests/helpers/storage';
import { storedReadingMode } from './reading-mode';

beforeEach(() => localStorage.clear());
async function setup(mode: 'scroll' | 'page') {
  const db = memoryStorage();
  const settings = new SettingsStore(db.port);
  await settings.initialize();
  const native = { mode, available: true } as NativeState;
  const apply = vi.fn(async (next: 'scroll' | 'page') => {
    native.mode = next;
    localStorage.setItem('viewer_paging', next === 'page' ? '1' : '0');
  });
  const onError = vi.fn();
  const controller = storedReadingMode({
    settings,
    storage: db.port,
    nativeState: () => native,
    canApply: () => true,
    apply,
    onError,
  });
  return { db, settings, native, apply, onError, controller };
}
it('adopts an old native choice once and stores it independently of later native values', async () => {
  const f = await setup('page');
  await f.controller.sync();
  expect(f.settings.getSnapshot().settings.readingMode).toBe('page');
  expect(f.apply).not.toHaveBeenCalled();
  f.native.mode = 'scroll';
  await f.controller.sync();
  expect(f.apply).toHaveBeenCalledWith('page');
  expect(f.db.syncData['unp.reader.v1']).toMatchObject({ data: { readingMode: 'page' } });
  f.settings.dispose();
});
it.each([null, '0'])(
  'restores the original native preference %s after several extension switches',
  async (original) => {
    if (original !== null) localStorage.setItem('viewer_paging', original);
    const f = await setup('scroll');
    f.settings.update({ readingMode: 'page' });
    await f.controller.sync();
    f.settings.update({ readingMode: 'scroll' });
    await f.controller.sync();
    f.settings.update({ readingMode: 'page' });
    await f.controller.sync();
    expect(await f.controller.restore()).toBe(true);
    expect(localStorage.getItem('viewer_paging')).toBe(original);
    expect(
      Object.keys(f.db.localData).filter((key) => key.startsWith('unp.native-reading-mode.'))
    ).toEqual([]);
    f.settings.dispose();
  }
);
it('does not reload or alter the native preference when the shared setting cannot be saved', async () => {
  const f = await setup('scroll');
  f.db.fail();
  f.settings.update({ readingMode: 'page' });
  await f.controller.sync();
  expect(f.onError).toHaveBeenCalledOnce();
  expect(f.apply).not.toHaveBeenCalled();
  expect(localStorage.getItem('viewer_paging')).toBeNull();
  f.db.fail(false);
  await f.controller.sync();
  expect(f.apply).toHaveBeenCalledWith('page');
  f.settings.dispose();
});

it('finishes newer layout edits before switching while an earlier save is pending', async () => {
  const f = await setup('scroll');
  const originalSet = f.db.port.sync.set;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = vi.spyOn(f.db.port.sync, 'set').mockImplementationOnce(async (items) => {
    await gate;
    await originalSet(items);
  });
  f.settings.update({ readingMode: 'page' });
  const applying = f.controller.sync();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  f.settings.update({ spreadMode: 'single', pageGap: 120 });
  f.apply.mockImplementationOnce(async () => {
    expect(f.db.syncData['unp.reader.v1']).toMatchObject({
      data: { readingMode: 'page', spreadMode: 'single', pageGap: 120 },
    });
    f.native.mode = 'page';
  });
  release();
  await applying;
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.onError).not.toHaveBeenCalled();
  f.settings.dispose();
});
