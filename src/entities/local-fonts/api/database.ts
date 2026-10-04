import type { FontRecord } from '../model/library';
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('unp-user-fonts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('fonts', { keyPath: 'id' });
    request.onerror = () => reject(new Error('글꼴 보관함을 열지 못했습니다.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  }));
}
export async function readFonts(): Promise<FontRecord[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('fonts').objectStore('fonts').getAll();
    request.onsuccess = () => resolve(request.result as FontRecord[]);
    request.onerror = () => reject(new Error('등록 글꼴을 읽지 못했습니다.'));
  });
}
/** Validation and all writes share one transaction, including concurrent settings windows. */
export async function changeFonts(
  change: (records: FontRecord[]) => { put?: FontRecord[]; remove?: string[] }
) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('fonts', 'readwrite');
    const store = transaction.objectStore('fonts');
    let failure: unknown;
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const next = change(request.result as FontRecord[]);
        next.put?.forEach((font) => store.put(font));
        next.remove?.forEach((id) => store.delete(id));
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        failure ||
          new Error('글꼴을 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.')
      );
  });
}
