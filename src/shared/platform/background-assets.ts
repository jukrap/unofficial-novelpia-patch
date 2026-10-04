import type { Settings } from '@/shared/model/preferences';
import {
  validateBackgroundFile,
  validateImageSignature,
  type BackgroundAssetInfo,
} from './background-asset-policy';
import { DecodedImageCache, type DecodedImageLease } from './decoded-image-cache';

export type { BackgroundAssetInfo } from './background-asset-policy';
const CHANNEL = 'unp.background-assets.v1';
interface PendingAsset {
  file: File;
  id: string;
  saved?: Promise<void>;
}
const pendingAssets = new Map<string, PendingAsset>();
const blobCache = new Map<string, Promise<Blob>>();
const decodedImages = new DecodedImageCache();

async function request<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const result = (await chrome.runtime.sendMessage({ channel: CHANNEL, action, ...data })) as
    { ok: true; data: T } | { ok: false; error: string } | undefined;
  if (!result?.ok)
    throw new Error(
      result?.error || '이미지 보관함에 연결하지 못했습니다. 확장을 새로고침해 주세요.'
    );
  return result.data;
}
function abortError() {
  return new DOMException('이미지 불러오기를 취소했습니다.', 'AbortError');
}
export function decodeBackgroundImage(
  url: string,
  signal?: AbortSignal
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const image = new Image();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = '';
        reject(error);
      } else resolve(image);
    };
    const abort = () => finish(abortError());
    const timeout = setTimeout(
      () => finish(new Error('이미지 응답이 늦습니다. 다시 시도해 주세요.')),
      15000
    );
    signal?.addEventListener('abort', abort, { once: true });
    image.onerror = () =>
      finish(new Error('이미지를 불러오지 못했습니다. 주소나 파일을 확인해 주세요.'));
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight)
        return finish(new Error('읽을 수 없는 이미지 파일입니다.'));
      if (typeof image.decode !== 'function') return finish();
      void image.decode().then(
        () => finish(),
        () => finish(new Error('이미지를 표시하지 못했습니다.'))
      );
    };
    image.src = url;
  });
}
function encode(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 32768)
    result += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(result);
}
/** Creates an in-memory draft. It never writes IndexedDB or Chrome storage. */
export async function stageBackgroundAsset(file: File): Promise<string> {
  validateBackgroundFile(file);
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  validateImageSignature(header, file.type);
  const url = URL.createObjectURL(file);
  try {
    await decodeBackgroundImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const id = crypto.randomUUID();
  const pendingId = `pending:${id}`;
  pendingAssets.set(pendingId, { id, file });
  return pendingId;
}
export function pendingBackgroundAsset(id: string | null): BackgroundAssetInfo | undefined {
  const asset = id ? pendingAssets.get(id) : undefined;
  return asset
    ? {
        id: id!,
        name: asset.file.name,
        size: asset.file.size,
        type: asset.file.type,
        createdAt: 0,
        references: [],
      }
    : undefined;
}
/** Idempotent: a failed preset save can retry without adding a duplicate image. */
export async function commitBackgroundAsset(settings: Settings): Promise<Settings> {
  const pendingId = settings.backgroundAssetId;
  if (!pendingId?.startsWith('pending:')) return settings;
  const asset = pendingAssets.get(pendingId);
  if (!asset) throw new Error('임시 이미지가 없습니다. 파일을 다시 선택해 주세요.');
  asset.saved ??= asset.file
    .arrayBuffer()
    .then(async (buffer) => {
      await request('write', {
        id: asset.id,
        name: asset.file.name,
        type: asset.file.type,
        data: encode(new Uint8Array(buffer)),
      });
    })
    .catch((error: unknown) => {
      asset.saved = undefined;
      throw error;
    });
  await asset.saved;
  return { ...settings, backgroundAssetId: asset.id };
}
export function discardBackgroundAsset(settings: Pick<Settings, 'backgroundAssetId'>): void {
  if (settings.backgroundAssetId?.startsWith('pending:')) {
    pendingAssets.delete(settings.backgroundAssetId);
    decodedImages.invalidate(`file:${settings.backgroundAssetId}`);
  }
}
/** Undo an image write when its owning preset could not be saved; keep the draft usable. */
export async function rollbackBackgroundAsset(
  settings: Pick<Settings, 'backgroundAssetId'>
): Promise<void> {
  const asset = settings.backgroundAssetId
    ? pendingAssets.get(settings.backgroundAssetId)
    : undefined;
  if (!asset?.saved) return;
  await asset.saved;
  await removeBackgroundAsset(asset.id);
  asset.saved = undefined;
}
export function listBackgroundAssets(): Promise<BackgroundAssetInfo[]> {
  return request<BackgroundAssetInfo[]>('list');
}
export async function removeBackgroundAsset(id: string): Promise<void> {
  await request('remove', { id });
  blobCache.delete(id);
  decodedImages.invalidate(`file:${id}`);
}
function readAsset(id: string): Promise<Blob> {
  const pending = pendingAssets.get(id);
  if (pending) return Promise.resolve(pending.file);
  if (id.startsWith('pending:'))
    return Promise.reject(new Error('임시 이미지를 다시 선택해 주세요.'));
  let blob = blobCache.get(id);
  if (!blob) {
    blob = request<{ type: string; data: string }>('read', { id })
      .then(({ type, data }) => {
        const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
        return new Blob([bytes], { type });
      })
      .catch((error: unknown) => {
        blobCache.delete(id);
        throw error;
      });
    blobCache.set(id, blob);
    if (blobCache.size > 5) blobCache.delete(blobCache.keys().next().value!);
  }
  return blob;
}
export interface ResolvedBackgroundImage {
  url: string;
  reused?: boolean;
  release(): void;
}
type ImageSettings = Pick<
  Settings,
  'backgroundType' | 'backgroundImageSource' | 'backgroundAssetId' | 'backgroundImage'
>;
export function backgroundImageKey(settings: ImageSettings): string | null {
  if (settings.backgroundType !== 'image') return null;
  return settings.backgroundImageSource === 'file'
    ? settings.backgroundAssetId
      ? `file:${settings.backgroundAssetId}`
      : null
    : settings.backgroundImage
      ? `url:${settings.backgroundImage}`
      : null;
}
/** Acquire only from an already decoded resource, without a loading state or another decode. */
export function acquireCachedBackgroundImage(settings: ImageSettings): DecodedImageLease | null {
  const key = backgroundImageKey(settings);
  return key ? decodedImages.acquireReady(key) : null;
}
/** A consumer releases its lease; the bounded session cache owns any retained object URL. */
export async function resolveBackgroundImage(
  settings: ImageSettings,
  signal?: AbortSignal
): Promise<ResolvedBackgroundImage | null> {
  if (signal?.aborted) throw abortError();
  const key = backgroundImageKey(settings);
  if (!key) return null;
  return decodedImages.acquire(
    key,
    (loadingSignal) => loadDecodedBackground(settings, loadingSignal),
    signal
  );
}
async function loadDecodedBackground(settings: ImageSettings, signal: AbortSignal) {
  let url = settings.backgroundImage;
  let local = false;
  if (settings.backgroundImageSource === 'file') {
    const blob = await readAsset(settings.backgroundAssetId!);
    if (signal?.aborted) throw abortError();
    url = URL.createObjectURL(blob);
    local = true;
  } else {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error('http 또는 https 이미지 주소를 입력해 주세요.');
  }
  let released = false;
  const release = () => {
    if (local && !released) URL.revokeObjectURL(url);
    released = true;
  };
  try {
    const image = await decodeBackgroundImage(url, signal);
    if (signal?.aborted) throw abortError();
    return {
      url,
      bytes: image.naturalWidth * image.naturalHeight * 4,
      dispose: () => {
        image.src = '';
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
