import { afterEach, expect, it, vi } from 'vitest';
import type { FontLoader, ReaderEngine, ReaderState } from '@/entities/reader';
import { FirstDisplay } from './first-display';
import type { ViewerPreparation } from './bootstrap';

const active: FirstDisplay[] = [];
function fixture() {
  vi.useFakeTimers();
  const preparation = {
    revealed: false as boolean,
    claim: vi.fn(),
    handoffPaint: vi.fn(),
    reveal: vi.fn(() => {
      preparation.revealed = true;
    }),
    dispose: vi.fn(),
  } satisfies ViewerPreparation;
  const fonts = { loadReading: vi.fn(async () => {}) } as unknown as FontLoader;
  const gate = new FirstDisplay(preparation, fonts);
  active.push(gate);
  const listeners = new Set<() => void>();
  let state = {
    readingFrame: null,
    presentationReady: false,
    fontLoadState: 'loading',
    backgroundStatus: 'loading',
    error: '',
  } as ReaderState;
  const reader = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    present: vi.fn(() => {
      state = { ...state, presentationReady: true };
    }),
  } as unknown as ReaderEngine;
  const update = (patch: Partial<ReaderState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  return { preparation, gate, reader, update };
}
const frame = { left: 0, top: 0, width: 800, height: 600 } as ReaderState['readingFrame'];
afterEach(() => {
  active.splice(0).forEach((gate) => gate.dispose());
  vi.useRealTimers();
});
it('starts its resource deadline at the first layout, not while native content is still absent', async () => {
  const { gate, reader, update, preparation } = fixture();
  gate.attach(reader, Promise.resolve());
  await vi.advanceTimersByTimeAsync(6000);
  expect(preparation.reveal).not.toHaveBeenCalled();
  update({ readingFrame: frame });
  await vi.advanceTimersByTimeAsync(2999);
  expect(preparation.reveal).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(preparation.reveal).toHaveBeenCalledOnce();
  expect(reader.present).toHaveBeenCalledOnce();
});
it('reveals early only after resources, restored position and the final layout frames', async () => {
  const { gate, reader, update, preparation } = fixture();
  let restore!: () => void;
  gate.attach(
    reader,
    new Promise<void>((resolve) => {
      restore = resolve;
    })
  );
  update({ readingFrame: frame, fontLoadState: 'ready', backgroundStatus: 'ready' });
  await vi.advanceTimersByTimeAsync(150);
  expect(preparation.reveal).not.toHaveBeenCalled();
  restore();
  await vi.advanceTimersByTimeAsync(40);
  expect(preparation.handoffPaint).toHaveBeenCalled();
  expect(preparation.reveal).toHaveBeenCalledOnce();
});
it('does not re-hide or re-reveal after a late image or font finishes', async () => {
  const { gate, reader, update, preparation } = fixture();
  gate.attach(reader, Promise.resolve());
  update({ readingFrame: frame });
  await vi.advanceTimersByTimeAsync(3000);
  update({ fontLoadState: 'ready', backgroundStatus: 'ready' });
  await vi.advanceTimersByTimeAsync(40);
  expect(preparation.reveal).toHaveBeenCalledOnce();
});
it('cancels a scheduled reveal if a newer resource starts loading', async () => {
  const { gate, reader, update, preparation } = fixture();
  gate.attach(reader, Promise.resolve());
  update({ readingFrame: frame, fontLoadState: 'ready', backgroundStatus: 'ready' });
  await vi.advanceTimersByTimeAsync(17);
  update({ backgroundStatus: 'loading' });
  await vi.advanceTimersByTimeAsync(100);
  expect(preparation.reveal).not.toHaveBeenCalled();
  update({ backgroundStatus: 'error' });
  await vi.advanceTimersByTimeAsync(40);
  expect(preparation.reveal).toHaveBeenCalledOnce();
});
it('does not hold a fallback font after a resource has already failed', async () => {
  const { gate, reader, update, preparation } = fixture();
  gate.attach(reader, Promise.resolve());
  update({ readingFrame: frame, fontLoadState: 'error', backgroundStatus: 'error' });
  await vi.advanceTimersByTimeAsync(40);
  expect(preparation.reveal).toHaveBeenCalledOnce();
});
it('cancels deadline and queued work on extension disposal', async () => {
  const { gate, reader, update, preparation } = fixture();
  gate.attach(reader, Promise.resolve());
  update({ readingFrame: frame });
  gate.dispose();
  await vi.advanceTimersByTimeAsync(5000);
  expect(preparation.reveal).not.toHaveBeenCalled();
  expect(preparation.dispose).toHaveBeenCalledOnce();
});
