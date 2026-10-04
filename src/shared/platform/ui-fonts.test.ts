import { afterEach, expect, it, vi } from 'vitest';
import { installUiFonts, loadUiFonts } from './ui-fonts';

function fonts() {
  const requests: { resolve: () => void; reject: () => void }[] = [];
  vi.stubGlobal('chrome', {
    runtime: { getURL: (file: string) => `chrome-extension://test/${file}` },
  });
  vi.stubGlobal(
    'FontFace',
    class {
      load() {
        return new Promise<void>((resolve, reject) => {
          requests.push({ resolve, reject: () => reject(new Error('Font unavailable')) });
        });
      }
    }
  );
  const doc = document.implementation.createHTMLDocument();
  const registered = new Set<FontFace>();
  Object.defineProperty(doc, 'fonts', { value: registered });
  return { doc, requests, registered };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('starts all UI faces in parallel and waits for every face before revealing', async () => {
  vi.useFakeTimers();
  const { doc, requests, registered } = fonts();
  const release = installUiFonts(doc);
  const complete = vi.fn();
  const loading = loadUiFonts(doc).then(complete);
  expect(requests).toHaveLength(4);
  requests.slice(0, 3).forEach((request) => request.resolve());
  await vi.advanceTimersByTimeAsync(100);
  expect(complete).not.toHaveBeenCalled();
  requests[3]!.resolve();
  await loading;
  expect(complete).toHaveBeenCalledWith(true);
  expect(vi.getTimerCount()).toBe(0);
  release();
  expect(registered.size).toBe(0);
});

it('falls back after the deadline and ignores late font completion', async () => {
  vi.useFakeTimers();
  const { doc, requests } = fonts();
  const release = installUiFonts(doc);
  const complete = vi.fn();
  const loading = loadUiFonts(doc).then(complete);
  await vi.advanceTimersByTimeAsync(1500);
  await loading;
  expect(complete).toHaveBeenCalledExactlyOnceWith(false);
  requests.forEach((request) => request.resolve());
  await vi.advanceTimersByTimeAsync(1);
  expect(complete).toHaveBeenCalledExactlyOnceWith(false);
  expect(vi.getTimerCount()).toBe(0);
  release();
});

it('falls back immediately on failure and does not keep a pending timeout', async () => {
  vi.useFakeTimers();
  const { doc, requests, registered } = fonts();
  const release = installUiFonts(doc);
  const otherConsumer = installUiFonts(doc);
  const loading = loadUiFonts(doc);
  requests[0]!.reject();
  await expect(loading).resolves.toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  requests.slice(1).forEach((request) => request.reject());
  await vi.advanceTimersByTimeAsync(1);
  release();
  expect(registered.size).toBe(4);
  otherConsumer();
  expect(registered.size).toBe(0);
});

it('keeps unavailable font registration usable with the system fallback', async () => {
  const { doc, registered } = fonts();
  vi.stubGlobal(
    'FontFace',
    class {
      constructor() {
        throw new Error('Unavailable');
      }
    }
  );
  const release = installUiFonts(doc);
  await expect(loadUiFonts(doc)).resolves.toBe(false);
  expect(registered.size).toBe(0);
  release();
});
