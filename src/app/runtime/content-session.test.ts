import { afterEach, expect, it, vi } from 'vitest';
import { startContentSession, type ViewerSession } from './content-session';
import type { ViewerPreparation } from './bootstrap';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const preparation: ViewerPreparation = {
    claim: vi.fn(),
    handoffPaint: vi.fn(),
    reveal: vi.fn(),
    dispose: vi.fn(),
    revealed: false,
  };
  const reader: ViewerSession = { ready: Promise.resolve(), stop: vi.fn() };
  const startViewer = vi.fn(() => reader);
  const load = vi.fn(async (_attempt: number) => ({ startViewer }));
  const valid = vi.fn(() => true);
  const bodyReady = vi.fn(async () => {});
  const start = () => {
    const session = startContentSession({ valid, load, bodyReady, preparation });
    cleanups.push(session.dispose);
    return session;
  };
  return { start, reader, startViewer, load, valid, preparation, bodyReady };
}

it('recovers from a failed module entry with a new attempt and never duplicates a running reader', async () => {
  const s = setup();
  s.load.mockRejectedValueOnce(new Error('temporarily unavailable'));
  const session = s.start();
  await vi.advanceTimersByTimeAsync(301);
  expect(s.load.mock.calls.map(([attempt]) => attempt)).toEqual([0, 1]);
  expect(s.startViewer).toHaveBeenCalledTimes(1);
  session.wake();
  session.wake();
  await vi.advanceTimersByTimeAsync(10000);
  expect(s.startViewer).toHaveBeenCalledTimes(1);
  expect(s.preparation.dispose).toHaveBeenCalledOnce();
});

it('retires a failed settings initialization before starting another reader', async () => {
  const s = setup();
  const stop = vi.fn();
  s.startViewer.mockImplementationOnce(() => ({
    ready: Promise.reject(new Error('storage unavailable')),
    stop,
  }));
  s.start();
  await vi.advanceTimersByTimeAsync(301);
  expect(stop).toHaveBeenCalledOnce();
  expect(s.startViewer).toHaveBeenCalledTimes(2);
});

it('limits failures, releases protection and does not poll forever on focus', async () => {
  const s = setup();
  s.load.mockRejectedValue(new Error('missing bundle'));
  const session = s.start();
  await vi.advanceTimersByTimeAsync(20000);
  session.wake();
  await vi.advanceTimersByTimeAsync(20000);
  expect(s.load).toHaveBeenCalledTimes(4);
  expect(s.startViewer).not.toHaveBeenCalled();
  expect(s.preparation.dispose).toHaveBeenCalled();
});

it('a restored tab can wake one pending retry without overlapping imports', async () => {
  const s = setup();
  s.load.mockRejectedValueOnce(new Error('sleeping'));
  const session = s.start();
  await vi.advanceTimersByTimeAsync(1);
  session.wake();
  session.wake();
  await vi.advanceTimersByTimeAsync(400);
  expect(s.load).toHaveBeenCalledTimes(2);
  expect(s.startViewer).toHaveBeenCalledOnce();
});

it('does not mount late imports or retry after extension invalidation', async () => {
  const s = setup();
  let resolve!: (runtime: { startViewer: typeof s.startViewer }) => void;
  s.load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const session = s.start();
  s.valid.mockReturnValue(false);
  session.dispose();
  resolve({ startViewer: s.startViewer });
  await vi.advanceTimersByTimeAsync(20000);
  session.wake();
  expect(s.startViewer).not.toHaveBeenCalled();
  expect(s.load).toHaveBeenCalledOnce();
});

it('cancels a retry and disposes an in-flight reader on teardown', async () => {
  const s = setup();
  let reject!: (error: Error) => void;
  s.reader.ready = new Promise((_done, fail) => {
    reject = fail;
  });
  const session = s.start();
  await vi.advanceTimersByTimeAsync(1);
  session.dispose();
  reject(new Error('context invalidated'));
  await vi.advanceTimersByTimeAsync(10000);
  expect(s.load).toHaveBeenCalledOnce();
  expect(s.reader.stop).toHaveBeenCalled();
});
