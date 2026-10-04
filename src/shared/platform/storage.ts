export interface StorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
export interface StoragePort {
  sync: StorageArea;
  local: StorageArea;
  listen(
    callback: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
  ): () => void;
}
export function hasExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

export function chromeStorage(isValid: () => boolean = hasExtensionContext): StoragePort {
  // Chrome can throw synchronously after an update, even from promise-based APIs.
  // Keep the StoragePort promise contract so callers' existing failure paths run.
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!isValid()) throw new Error('확장 연결이 종료되었습니다. 이 페이지를 새로고침해 주세요.');
    try {
      return await operation();
    } catch (error) {
      isValid(); // Notify the content lifecycle if invalidation raced the call.
      throw error;
    }
  };
  const area = (name: 'sync' | 'local'): StorageArea => ({
    get: (keys) => run(() => chrome.storage[name].get(keys)),
    set: (items) => run(() => chrome.storage[name].set(items)),
    remove: (keys) => run(() => chrome.storage[name].remove(keys)),
  });
  return {
    sync: area('sync'),
    local: area('local'),
    listen(callback) {
      if (!isValid()) return () => {};
      try {
        chrome.storage.onChanged.addListener(callback);
      } catch (error) {
        if (isValid()) throw error;
        return () => {};
      }
      let listening = true;
      return () => {
        if (!listening) return;
        listening = false;
        // The browser already detached extension events from an invalid context.
        if (!hasExtensionContext()) return;
        try {
          chrome.storage.onChanged.removeListener(callback);
        } catch (error) {
          if (hasExtensionContext()) throw error;
        }
      };
    },
  };
}
export function checkSyncSize(
  items: Record<string, unknown>,
  existing: Record<string, unknown> = {}
): void {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (Object.entries(items).some(([key, value]) => bytes(key) + bytes(value) > 7900))
    throw new Error('설정 항목이 동기화 용량을 초과합니다. 백업 파일로 보관해 주세요.');
  if (bytes({ ...existing, ...items }) > 98000)
    throw new Error('동기화 저장 공간이 부족합니다. 백업 후 불필요한 프리셋을 정리해 주세요.');
}
