import { FONTS } from '@/shared/config/fontData';
import type { FontData } from '@/shared/model/catalog';
import {
  USER_FONT_CHANNEL,
  USER_FONT_REVISION,
  userFontWeights,
  type UserFont,
  type FontInspection,
  type FontWrite,
} from '@/shared/model/user-font';

let fonts: UserFont[] = [];
let catalog: FontData[] = FONTS;
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
let ready = false;
let generation = 0;
let listening = false;
export const getUserFonts = () => fonts;
export const getFontCatalog = () => catalog;
export function subscribeFonts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
async function request<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const response = (await chrome.runtime.sendMessage({
    channel: USER_FONT_CHANNEL,
    action,
    ...data,
  })) as { ok: boolean; data?: T; error?: string } | undefined;
  if (!response?.ok)
    throw new Error(
      response?.error || '글꼴 보관함에 연결하지 못했습니다. 확장과 페이지를 새로고침해 주세요.'
    );
  return response.data as T;
}
export async function refreshUserFonts() {
  const token = ++generation;
  let timeout: ReturnType<typeof setTimeout>;
  const next = await Promise.race([
    request<UserFont[]>('list'),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('글꼴 보관함 응답이 늦습니다. 다시 시도해 주세요.')),
        2000
      );
    }),
  ]).finally(() => clearTimeout(timeout));
  if (token !== generation) return;
  receive(next);
}
function receive(next: UserFont[]) {
  ready = true;
  if (JSON.stringify(next) === JSON.stringify(fonts)) return;
  fonts = next;
  catalog = [
    FONTS[0]!,
    ...next.map((font): FontData => ({
      name: font.id,
      displayName: font.displayName,
      category: 'System',
      description: '이 브라우저에 등록한 글꼴',
      urls: [],
      localRevision: font.revision,
      metadata: {
        weights: userFontWeights(font),
        variableFont: font.faces.some((face) => face.variable),
        publisher: '',
        license: '',
      },
    })),
    ...FONTS.slice(1),
  ];
  listeners.forEach((listener) => listener());
}
export function initializeUserFonts(): Promise<void> {
  if (!listening) {
    listening = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[USER_FONT_REVISION]) void refreshUserFonts().catch(() => {});
    });
  }
  if (ready) return Promise.resolve();
  loading ??= refreshUserFonts().finally(() => {
    loading = undefined;
  });
  return loading;
}
export function encodeFontBytes(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length; i += 32768)
    value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}
export const inspectUserFont = (name: string, data: string) =>
  request<FontInspection>('inspect', { name, data });
export async function saveUserFonts(writes: FontWrite[]) {
  const next = await request<UserFont[]>('save', { writes });
  ++generation;
  receive(next);
}
export async function removeUserFont(id: string, expectedRevision: string) {
  const next = await request<UserFont[]>('remove', { id, expectedRevision });
  ++generation;
  receive(next);
}
/** Read a single face at a time so large families stay below Chrome's message size limit. */
export async function readUserFontFace(
  id: string,
  revision: string,
  faceId: string
): Promise<ArrayBuffer> {
  const data = await request<string>('read', { id, revision, faceId });
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0)).buffer;
}
