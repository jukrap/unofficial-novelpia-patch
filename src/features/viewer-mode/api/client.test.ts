import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getViewerModeStatus, setViewerMode, subscribeViewerMode } from './client';

describe('viewer mode popup client', () => {
  const sendMessage = vi.fn();
  type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
  const addListener = vi.fn<(listener: Listener) => void>();
  const removeListener = vi.fn<(listener: Listener) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension', sendMessage },
      storage: { onChanged: { addListener, removeListener } },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not infer that an unrelated tab is a reader', async () => {
    sendMessage.mockResolvedValue({ connected: false, enabled: true, darkMode: false });
    await expect(getViewerModeStatus()).resolves.toEqual({
      connected: false,
      enabled: true,
      darkMode: false,
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'unp:viewer-mode-status' });
  });

  it('rejects a stale or incomplete background response', async () => {
    sendMessage.mockResolvedValue({ enabled: true });
    await expect(getViewerModeStatus()).rejects.toThrow('뷰어 상태를 불러오지 못했습니다');
  });

  it('submits the desired boolean to the background before reporting success', async () => {
    sendMessage.mockResolvedValue({ ok: true, connected: true });
    await expect(setViewerMode(false)).resolves.toEqual({ ok: true, connected: true });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'unp:viewer-mode-set', enabled: false });
  });

  it('preserves a storage failure so the switch can stay at its previous value', async () => {
    sendMessage.mockResolvedValue({ ok: false, connected: true, error: '저장 공간이 부족합니다.' });
    await expect(setViewerMode(false)).rejects.toThrow('저장 공간이 부족합니다.');
  });

  it.each([
    new Error('Extension context invalidated.'),
    new Error('Could not establish connection. Receiving end does not exist.'),
  ])('handles an invalidated popup context: %s', async (error) => {
    sendMessage.mockRejectedValue(error);
    await expect(setViewerMode(true)).rejects.toThrow('팝업을 닫았다 다시 열어 주세요');
  });

  it('catches synchronous Chrome failures as well as rejected promises', async () => {
    sendMessage.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    await expect(getViewerModeStatus()).rejects.toThrow('확장 연결이 종료되었습니다');
  });

  it('refreshes only for synced settings and detaches on popup close', () => {
    const callback = vi.fn();
    const stop = subscribeViewerMode(callback);
    const listener = addListener.mock.calls[0]![0];
    listener({}, 'local');
    expect(callback).not.toHaveBeenCalled();
    listener({}, 'sync');
    expect(callback).toHaveBeenCalledOnce();
    stop();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });

  it('does not crash the React effect when the extension is replaced during subscription', () => {
    addListener.mockImplementationOnce(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(() => subscribeViewerMode(vi.fn())()).not.toThrow();
  });
});
