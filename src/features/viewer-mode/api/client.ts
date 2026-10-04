import type { ViewerModeRequest, ViewerModeSetResult, ViewerModeStatus } from '../model/types';

const CONNECTION_ERROR = '확장 연결이 종료되었습니다. 팝업을 닫았다 다시 열어 주세요.';

async function request(message: ViewerModeRequest): Promise<unknown> {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) throw new Error(CONNECTION_ERROR);
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/context invalidated|receiving end|establish connection/i.test(message))
      throw new Error(CONNECTION_ERROR, { cause: error });
    throw error instanceof Error ? error : new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export async function getViewerModeStatus(): Promise<ViewerModeStatus> {
  const result = await request({ type: 'unp:viewer-mode-status' });
  if (
    !isRecord(result) ||
    typeof result.connected !== 'boolean' ||
    typeof result.enabled !== 'boolean' ||
    typeof result.darkMode !== 'boolean'
  ) {
    throw new Error(
      isRecord(result) && typeof result.error === 'string'
        ? result.error
        : '뷰어 상태를 불러오지 못했습니다. 다시 시도해 주세요.'
    );
  }
  return { connected: result.connected, enabled: result.enabled, darkMode: result.darkMode };
}

export async function setViewerMode(
  enabled: boolean
): Promise<Extract<ViewerModeSetResult, { ok: true }>> {
  const result = await request({ type: 'unp:viewer-mode-set', enabled });
  if (!isRecord(result) || result.ok !== true || typeof result.connected !== 'boolean')
    throw new Error(
      isRecord(result) && typeof result.error === 'string'
        ? result.error
        : '뷰어 설정을 저장하지 못했습니다. 다시 시도해 주세요.'
    );
  return { ok: true, connected: result.connected };
}

/** Refresh only while the popup is open; no settings store or editing UI is loaded. */
export function subscribeViewerMode(callback: () => void): () => void {
  const listener = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync') callback();
  };
  try {
    chrome.storage.onChanged.addListener(listener);
  } catch {
    // The status request provides an actionable error if the context closed here.
    return () => {};
  }
  return () => {
    if (!chrome.runtime?.id) return;
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      // An extension reload already detached listeners from the old popup.
    }
  };
}
