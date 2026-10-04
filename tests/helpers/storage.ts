import type { StorageArea, StoragePort } from '../../src/shared/platform/storage';
export function memoryStorage(seed: Record<string, unknown> = {}) {
  const syncData = structuredClone(seed);
  const localData: Record<string, unknown> = {};
  const listeners = new Set<
    (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
  >();
  let failure = false;
  const area = (data: Record<string, unknown>, name: string): StorageArea => ({
    async get(keys) {
      return structuredClone(
        keys === null
          ? data
          : Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys])
                .filter((k) => k in data)
                .map((k) => [k, data[k]])
            )
      );
    },
    async set(items) {
      if (name === 'sync' && failure) throw new Error('QUOTA_BYTES exceeded');
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
        data[key] = structuredClone(value);
      }
      listeners.forEach((fn) => fn(changes, name));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  });
  const port: StoragePort = {
    sync: area(syncData, 'sync'),
    local: area(localData, 'local'),
    listen(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return {
    port,
    syncData,
    localData,
    fail(value = true) {
      failure = value;
    },
  };
}
