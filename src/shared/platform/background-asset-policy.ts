export const BACKGROUND_FILE_LIMIT = 10 * 1024 * 1024;
export const BACKGROUND_STORAGE_LIMIT = 100 * 1024 * 1024;
export const BACKGROUND_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export interface BackgroundAssetInfo {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  references: string[];
}
export function validateBackgroundFile(file: Pick<File, 'type' | 'size'>): void {
  if (!(BACKGROUND_MIME_TYPES as readonly string[]).includes(file.type))
    throw new Error('JPEG, PNG, WebP 이미지를 선택해 주세요.');
  if (file.size <= 0 || file.size > BACKGROUND_FILE_LIMIT)
    throw new Error('이미지는 파일당 10MiB까지 등록할 수 있습니다.');
}
export function validateImageSignature(bytes: Uint8Array, type: string): void {
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  const matches =
    (type === 'image/png' && png.every((value, index) => bytes[index] === value)) ||
    (type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (type === 'image/webp' &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP');
  if (!matches) throw new Error('이미지 파일의 형식을 확인해 주세요.');
}
/** Only live settings and saved presets count; migration/recovery copies are historical. */
export function backgroundAssetReferences(raw: Record<string, unknown>, id: string): string[] {
  const references: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const settings = key === 'unp.reader.v1' ? item.data : item.settings;
    if (key !== 'unp.reader.v1' && !key.startsWith('unp.preset.v1.')) continue;
    if (!settings || typeof settings !== 'object') continue;
    // Keep a selected file safe even when the user temporarily changes to a solid background.
    if ((settings as Record<string, unknown>).backgroundAssetId !== id) continue;
    references.push(key === 'unp.reader.v1' ? '현재 읽기 설정' : String(item.name || '내 프리셋'));
  }
  return references;
}
