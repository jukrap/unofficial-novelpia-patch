import { describe, expect, it, vi } from 'vitest';
import { DecodedImageCache, type DecodedImageResource } from './decoded-image-cache';

function resource(url: string, bytes = 4): DecodedImageResource {
  return { url, bytes, dispose: vi.fn() };
}

describe('decoded image session cache', () => {
  it('restores a decoded resource synchronously across unmounts without reloading it', async () => {
    const cache = new DecodedImageCache();
    const image = resource('https://example.test/paper.png');
    const load = vi.fn().mockResolvedValue(image);
    const first = await cache.acquire('paper', load);
    expect(first.reused).toBe(false);
    first.release();
    const reopened = cache.acquireReady('paper');
    expect(reopened).toMatchObject({ url: image.url, reused: true });
    const concurrent = await cache.acquire('paper', load);
    expect(concurrent.reused).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    reopened!.release();
    concurrent.release();
    expect(image.dispose).not.toHaveBeenCalled();
    cache.clear();
    expect(image.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate another consumer when one pending preview is cancelled', async () => {
    const cache = new DecodedImageCache();
    const firstController = new AbortController();
    let complete!: (image: DecodedImageResource) => void;
    let loadingSignal: AbortSignal | undefined;
    const load = vi.fn((signal: AbortSignal) => {
      loadingSignal = signal;
      return new Promise<DecodedImageResource>((resolve) => {
        complete = resolve;
      });
    });
    const first = cache.acquire('shared', load, firstController.signal);
    const second = cache.acquire('shared', load);
    await Promise.resolve();
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadingSignal?.aborted).toBe(false);
    complete(resource('blob:shared'));
    const remaining = await second;
    expect(remaining.url).toBe('blob:shared');
    expect(load).toHaveBeenCalledTimes(1);
    remaining.release();
    cache.clear();
  });

  it('cancels the unused load and disposes a late result instead of caching it', async () => {
    const cache = new DecodedImageCache();
    const controller = new AbortController();
    let complete!: (image: DecodedImageResource) => void;
    let loadingSignal: AbortSignal | undefined;
    const pending = cache.acquire(
      'old',
      (signal) => {
        loadingSignal = signal;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
      controller.signal
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadingSignal?.aborted).toBe(true);
    const old = resource('blob:old');
    complete(old);
    await Promise.resolve();
    await Promise.resolve();
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(cache.acquireReady('old')).toBeNull();
  });

  it('allows an error to be retried and never stores it as a ready entry', async () => {
    const cache = new DecodedImageCache();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(resource('https://example.test/retry.png'));
    await expect(cache.acquire('retry', load)).rejects.toThrow('offline');
    expect(cache.acquireReady('retry')).toBeNull();
    const retried = await cache.acquire('retry', load);
    expect(retried.reused).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
    retried.release();
    cache.clear();
  });

  it('bounds idle resources without revoking an active image, and respects deletion', async () => {
    const cache = new DecodedImageCache(1);
    const a = resource('blob:a'),
      b = resource('blob:b'),
      c = resource('blob:c');
    const active = await cache.acquire('a', async () => a);
    const second = await cache.acquire('b', async () => b);
    second.release();
    const third = await cache.acquire('c', async () => c);
    third.release();
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(a.dispose).not.toHaveBeenCalled();
    cache.invalidate('a');
    expect(cache.acquireReady('a')).toBeNull();
    expect(a.dispose).not.toHaveBeenCalled();
    active.release();
    active.release();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    cache.clear();
    expect(c.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps only the newest large idle image when its decoded footprint exceeds the budget', async () => {
    const cache = new DecodedImageCache(8, 10);
    const first = resource('first', 8),
      second = resource('second', 20);
    (await cache.acquire('first', async () => first)).release();
    (await cache.acquire('second', async () => second)).release();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    cache.clear();
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });
});
