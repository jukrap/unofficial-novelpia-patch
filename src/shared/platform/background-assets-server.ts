import {
  BACKGROUND_FILE_LIMIT,
  BACKGROUND_STORAGE_LIMIT,
  backgroundAssetReferences,
  validateBackgroundFile,
  validateImageSignature,
  type BackgroundAssetInfo,
} from './background-asset-policy';

interface AssetRecord extends Omit<BackgroundAssetInfo, 'references'> {
  blob: Blob;
}
const CHANNEL = 'unp.background-assets.v1';
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('unp-background-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
    request.onerror = () => reject(new Error('이미지 보관함을 열지 못했습니다.'));
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
function allImages(db: IDBDatabase): Promise<AssetRecord[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction('images').objectStore('images').getAll();
    request.onsuccess = () => resolve(request.result as AssetRecord[]);
    request.onerror = () => reject(new Error('등록 이미지를 읽지 못했습니다.'));
  });
}
function encode(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 32768)
    result += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(result);
}
function allowedSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    if (url.protocol === 'chrome-extension:' && url.host === chrome.runtime.id) return true;
    if (
      url.protocol === 'https:' &&
      ['novelpia.com', 'www.novelpia.com'].includes(url.hostname) &&
      url.pathname.startsWith('/viewer/')
    )
      return true;
    return import.meta.env.MODE === 'e2e' && url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}
async function dispatch(message: Record<string, unknown>): Promise<unknown> {
  const db = await openDatabase();
  if (message.action === 'list') {
    const [images, raw] = await Promise.all([allImages(db), chrome.storage.sync.get(null)]);
    return images.map(({ blob: _blob, ...info }) => ({
      ...info,
      references: backgroundAssetReferences(raw, info.id),
    }));
  }
  if (typeof message.id !== 'string' || !/^[a-z\d-]{36}$/i.test(message.id))
    throw new Error('이미지 참조를 확인해 주세요.');
  const id = message.id;
  if (message.action === 'read') {
    const record = await new Promise<AssetRecord | undefined>((resolve, reject) => {
      const request = db.transaction('images').objectStore('images').get(id);
      request.onsuccess = () => resolve(request.result as AssetRecord | undefined);
      request.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    });
    if (!record) throw new Error('이 브라우저에 이미지가 없습니다. 이미지 다시 등록이 필요합니다.');
    return { type: record.type, data: encode(new Uint8Array(await record.blob.arrayBuffer())) };
  }
  if (message.action === 'remove') {
    const references = backgroundAssetReferences(await chrome.storage.sync.get(null), id);
    if (references.length)
      throw new Error(
        `${references.join(', ')}에서 사용 중입니다. 먼저 다른 배경을 선택해 주세요.`
      );
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite');
      transaction.objectStore('images').delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(new Error('이미지를 삭제하지 못했습니다.'));
    });
    return null;
  }
  if (message.action !== 'write') throw new Error('지원하지 않는 이미지 작업입니다.');
  if (
    typeof message.data !== 'string' ||
    message.data.length > Math.ceil(BACKGROUND_FILE_LIMIT / 3) * 4 ||
    typeof message.type !== 'string' ||
    typeof message.name !== 'string'
  )
    throw new Error('이미지 파일을 확인해 주세요.');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(message.data), (character) => character.charCodeAt(0));
  } catch {
    throw new Error('이미지 파일을 읽지 못했습니다.');
  }
  validateBackgroundFile({ type: message.type, size: bytes.byteLength });
  validateImageSignature(bytes, message.type);
  const record: AssetRecord = {
    id,
    name:
      [...message.name]
        .filter((character) => character.charCodeAt(0) >= 32)
        .join('')
        .slice(0, 160) || '배경 이미지',
    type: message.type,
    size: bytes.byteLength,
    createdAt: Date.now(),
    blob: new Blob([bytes], { type: message.type }),
  };
  // Count and insert inside one write transaction so parallel tabs cannot exceed the limit.
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('images', 'readwrite');
    const store = transaction.objectStore('images');
    const request = store.getAll();
    let full = false;
    request.onsuccess = () => {
      const used = (request.result as AssetRecord[]).reduce(
        (total, image) => total + (image.id === id ? 0 : image.size),
        0
      );
      if (used + record.size > BACKGROUND_STORAGE_LIMIT) {
        full = true;
        transaction.abort();
      } else store.put(record);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        new Error(
          full
            ? '이미지 보관함은 100MiB까지 사용할 수 있습니다. 사용하지 않는 이미지를 정리해 주세요.'
            : '이미지를 보관하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.'
        )
      );
  });
  const { blob: _blob, ...info } = record;
  return { ...info, references: [] };
}
export function installBackgroundAssetService(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as Record<string, unknown>).channel !== CHANNEL
    )
      return;
    if (!allowedSender(sender)) {
      sendResponse({ ok: false, error: '이 화면에서 이미지 보관함을 사용할 수 없습니다.' });
      return;
    }
    void dispatch(message as Record<string, unknown>).then(
      (data) => sendResponse({ ok: true, data }),
      (error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    );
    return true;
  });
}
