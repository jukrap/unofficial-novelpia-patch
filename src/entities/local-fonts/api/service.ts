import { z } from 'zod';
import {
  USER_FONT_CHANNEL,
  USER_FONT_REVISION,
  FONT_FILE_LIMIT,
  FONT_BATCH_LIMIT,
  type FontInspection,
  type UserFont,
} from '@/shared/model/user-font';
import { fontReferences, validateLibrary, type FontRecord } from '../model/library';
import { changeFonts, readFonts } from './database';

const fileSchema = z.object({
  name: z.string().min(1).max(250),
  data: z.string().max(Math.ceil(FONT_FILE_LIMIT / 3) * 4),
});
const idSchema = z.string().regex(/^unp-local-[a-f0-9]{32}$/);
const writeSchema = z.object({
  id: idSchema,
  expectedRevision: z.string().nullable(),
  displayName: z.string().trim().min(1).max(80),
  keep: z.array(z.string()).max(24),
  files: z.array(fileSchema).max(24),
});
async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
async function inspect(
  file: z.infer<typeof fileSchema>
): Promise<{ info: FontInspection; blob: Blob }> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
  } catch {
    throw new Error('글꼴 파일을 읽지 못했습니다.');
  }
  const { inspectFontFile } = await import('../lib/parse-font');
  const parsed = await inspectFontFile(file.name, bytes);
  // Stable across browsers and backups; display-name edits do not change references.
  const [id, familyHash] = await Promise.all([
    digest(bytes),
    digest(new TextEncoder().encode(parsed.family.normalize('NFKC').toLowerCase().trim())),
  ]);
  return {
    info: {
      ...parsed,
      id,
      familyId: `unp-local-${familyHash.slice(0, 32)}`,
      fileName: file.name,
      size: bytes.length,
    },
    blob: new Blob([bytes]),
  };
}
function metadata({ blobs: _blobs, ...font }: FontRecord): UserFont {
  return font;
}
function encode(bytes: Uint8Array) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 32768)
    value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}
async function notify() {
  // IndexedDB is authoritative. Notification failure must not report a committed write as failed.
  await chrome.storage.local.set({ [USER_FONT_REVISION]: crypto.randomUUID() }).catch(() => {});
}
async function dispatch(message: Record<string, unknown>) {
  if (message.action === 'list') return (await readFonts()).map(metadata);
  if (message.action === 'inspect') return (await inspect(fileSchema.parse(message))).info;
  if (message.action === 'read') {
    const id = idSchema.parse(message.id);
    const font = (await readFonts()).find((item) => item.id === id);
    if (!font)
      throw new Error(
        '이 브라우저에 등록되지 않은 글꼴입니다. 사용자 글꼴에서 같은 파일을 다시 등록해 주세요.'
      );
    if (font.revision !== message.revision)
      throw new Error('글꼴이 변경되었습니다. 다시 시도해 주세요.');
    const blob = typeof message.faceId === 'string' ? font.blobs[message.faceId] : undefined;
    if (!blob) throw new Error('글꼴 파일을 찾지 못했습니다.');
    return encode(new Uint8Array(await blob.arrayBuffer()));
  }
  if (message.action === 'remove') {
    let remaining: UserFont[] = [];
    const id = idSchema.parse(message.id);
    const references = fontReferences(await chrome.storage.sync.get(null), id);
    if (references.length)
      throw new Error(
        `${references.join(', ')}에서 사용 중입니다. 먼저 다른 글꼴을 선택해 주세요.`
      );
    await changeFonts((records) => {
      const current = records.find((font) => font.id === id);
      if (current?.revision !== message.expectedRevision)
        throw new Error('다른 창에서 글꼴이 변경되었습니다. 목록을 새로고침해 주세요.');
      remaining = records.filter((font) => font.id !== id).map(metadata);
      return { remove: [id] };
    });
    await notify();
    return remaining;
  }
  if (message.action !== 'save') throw new Error('지원하지 않는 글꼴 작업입니다.');
  const writes = z.array(writeSchema).min(1).max(24).parse(message.writes);
  if (new Set(writes.map((write) => write.id)).size !== writes.length)
    throw new Error('같은 글꼴이 중복되었습니다.');
  if (
    writes.reduce(
      (sum, write) => sum + write.files.reduce((size, file) => size + file.data.length * 0.75, 0),
      0
    ) >
    FONT_BATCH_LIMIT + 64
  )
    throw new Error('한 번에 등록하는 파일은 총 32MiB 이하여야 합니다. 나누어 추가해 주세요.');
  const prepared: (Omit<z.infer<typeof writeSchema>, 'files'> & {
    files: Awaited<ReturnType<typeof inspect>>[];
  })[] = [];
  for (const write of writes) {
    const files = [];
    for (const file of write.files) files.push(await inspect(file));
    if (files.some((file) => file.info.familyId !== write.id))
      throw new Error('서로 다른 글꼴의 파일을 하나로 묶을 수 없습니다.');
    prepared.push({ ...write, files });
  }
  let committed: UserFont[] = [];
  await changeFonts((records) => {
    const put = prepared.map((write): FontRecord => {
      const old = records.find((font) => font.id === write.id);
      if ((old?.revision ?? null) !== write.expectedRevision)
        throw new Error('다른 창에서 글꼴이 변경되었습니다. 초안을 취소하고 다시 열어 주세요.');
      const faces = (old?.faces ?? []).filter((face) => write.keep.includes(face.id));
      const blobs: Record<string, Blob> = {};
      for (const face of faces) blobs[face.id] = old!.blobs[face.id]!;
      for (const { info, blob } of write.files) {
        if (!faces.some((face) => face.id === info.id)) {
          const { family: _family, familyId: _familyId, fullName: _fullName, ...face } = info;
          faces.push(face);
          blobs[face.id] = blob;
        }
      }
      return {
        id: write.id,
        family: old?.family ?? write.files[0]?.info.family ?? '',
        displayName: write.displayName,
        revision: crypto.randomUUID(),
        faces: faces.sort((a, b) => a.weight - b.weight),
        blobs,
      };
    });
    const next = [...records.filter((font) => !put.some((next) => next.id === font.id)), ...put];
    validateLibrary(next);
    committed = next.map(metadata);
    return { put };
  });
  await notify();
  return committed;
}
function senderAccess(sender: chrome.runtime.MessageSender): 'manage' | 'read' | null {
  if (sender.id !== chrome.runtime.id || !sender.url) return null;
  try {
    const url = new URL(sender.url);
    if (url.protocol === 'chrome-extension:' && url.host === chrome.runtime.id) return 'manage';
    if (
      (url.protocol === 'https:' &&
        ['novelpia.com', 'www.novelpia.com'].includes(url.hostname) &&
        /^\/viewer\//.test(url.pathname)) ||
      (import.meta.env.MODE === 'e2e' && url.hostname === '127.0.0.1')
    )
      return 'read';
  } catch {
    /* Invalid sender URLs are rejected. */
  }
  return null;
}
export function installUserFontService() {
  let mutations = Promise.resolve<unknown>(null);
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('channel' in message) ||
      message.channel !== USER_FONT_CHANNEL
    )
      return;
    const request = message as Record<string, unknown>;
    const access = senderAccess(sender);
    if (!access || (access === 'read' && !['list', 'read'].includes(String(request.action)))) {
      respond({ ok: false, error: '글꼴 관리는 확장 설정 페이지에서 실행해 주세요.' });
      return;
    }
    const mutating = ['save', 'remove', 'inspect'].includes(String(request.action));
    const work = mutating ? mutations.then(() => dispatch(request)) : dispatch(request);
    if (mutating) mutations = work.catch(() => {});
    void work.then(
      (data) => respond({ ok: true, data }),
      (error: unknown) =>
        respond({
          ok: false,
          error:
            error instanceof z.ZodError
              ? '글꼴 입력 형식을 확인해 주세요.'
              : error instanceof Error
                ? error.message
                : '글꼴 작업에 실패했습니다.',
        })
    );
    return true;
  });
}
