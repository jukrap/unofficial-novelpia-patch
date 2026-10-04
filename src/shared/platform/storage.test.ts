import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromeStorage } from './storage';

afterEach(() => vi.unstubAllGlobals());

function api() {
  const area = {
    get: vi.fn().mockResolvedValue({ value: 1 }),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const runtime: { id?: string } = { id: 'test-extension' };
  const onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
  vi.stubGlobal('chrome', { runtime, storage: { sync: area, local: area, onChanged } });
  return { area, runtime, onChanged };
}

describe('Chrome storage context lifetime', () => {
  it('turns synchronous API throws into rejections and notifies the lifecycle', async () => {
    const { area, runtime } = api();
    const invalidated = vi.fn();
    const port = chromeStorage(() => {
      if (!runtime.id) invalidated();
      return !!runtime.id;
    });
    area.set.mockImplementation(() => {
      delete runtime.id;
      throw new Error('Extension context invalidated.');
    });
    let result: Promise<void> | undefined;
    expect(() => {
      result = port.local.set({ position: 12 });
    }).not.toThrow();
    await expect(result).rejects.toThrow('Extension context invalidated.');
    expect(invalidated).toHaveBeenCalledOnce();
  });

  it('does not call dead APIs and cleanup remains safe and idempotent', async () => {
    const { area, runtime, onChanged } = api();
    const port = chromeStorage();
    const stop = port.listen(vi.fn());
    expect(onChanged.addListener).toHaveBeenCalledOnce();
    delete runtime.id;
    await expect(port.sync.get(null)).rejects.toThrow('새로고침');
    await expect(port.local.set({ value: 2 })).rejects.toThrow('새로고침');
    await expect(port.local.remove('value')).rejects.toThrow('새로고침');
    expect(area.get).not.toHaveBeenCalled();
    expect(area.set).not.toHaveBeenCalled();
    expect(area.remove).not.toHaveBeenCalled();
    expect(() => {
      stop();
      stop();
      port.listen(vi.fn())();
    }).not.toThrow();
    expect(onChanged.removeListener).not.toHaveBeenCalled();
    expect(onChanged.addListener).toHaveBeenCalledOnce();
  });

  it('preserves normal storage failures and removes live listeners once', async () => {
    const { area, onChanged } = api();
    const port = chromeStorage();
    await expect(port.sync.get('value')).resolves.toEqual({ value: 1 });
    const quota = new Error('QUOTA_BYTES exceeded');
    area.set.mockRejectedValue(quota);
    await expect(port.sync.set({ value: 2 })).rejects.toBe(quota);
    const callback = vi.fn();
    const stop = port.listen(callback);
    stop();
    stop();
    expect(onChanged.removeListener).toHaveBeenCalledExactlyOnceWith(callback);
  });

  it('finishes cleanup when context invalidation races listener removal', () => {
    const { runtime, onChanged } = api();
    const stop = chromeStorage().listen(vi.fn());
    onChanged.removeListener.mockImplementation(() => {
      delete runtime.id;
      throw new Error('Extension context invalidated.');
    });
    expect(stop).not.toThrow();
    expect(stop).not.toThrow();
    expect(onChanged.removeListener).toHaveBeenCalledOnce();
  });
});
