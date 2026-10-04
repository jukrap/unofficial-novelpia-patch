import { FONT_STORAGE_LIMIT, userFontWeights, type UserFont } from '@/shared/model/user-font';

export interface FontRecord extends UserFont {
  blobs: Record<string, Blob>;
}
export function validateFamily(font: UserFont) {
  const normal = font.faces.filter((face) => face.style === 'normal');
  if (!normal.length)
    throw new Error(`${font.displayName}: 기울임이 아닌 기본 글꼴 파일도 추가해 주세요.`);
  if (!userFontWeights(font).length)
    throw new Error(`${font.displayName}: 이 뷰어에서 조절할 수 있는 두께(100~900)가 없습니다.`);
  if (font.faces.length > 24) throw new Error('한 글꼴에는 파일을 24개까지 등록할 수 있습니다.');
  for (let i = 0; i < font.faces.length; i++) {
    const face = font.faces[i]!;
    for (const other of font.faces.slice(i + 1)) {
      if (
        face.style === other.style &&
        face.minWeight <= other.maxWeight &&
        other.minWeight <= face.maxWeight
      )
        throw new Error(
          `${font.displayName}: ${face.fileName}와 ${other.fileName}의 두께가 겹칩니다. 사용할 파일 하나만 남겨 주세요.`
        );
    }
  }
}
export function validateLibrary(records: FontRecord[]) {
  if (records.length > 100) throw new Error('사용자 글꼴은 100종까지 등록할 수 있습니다.');
  const size = records.reduce(
    (sum, font) => sum + font.faces.reduce((n, face) => n + face.size, 0),
    0
  );
  if (size > FONT_STORAGE_LIMIT)
    throw new Error(
      '글꼴 보관함의 100MiB 한도를 넘습니다. 사용하지 않는 글꼴을 먼저 삭제해 주세요.'
    );
  records.forEach(validateFamily);
}
export function fontReferences(raw: Record<string, unknown>, id: string): string[] {
  const names: string[] = [];
  const settings = raw['unp.reader.v1'] as { data?: { fontFamily?: string } } | undefined;
  if (settings?.data?.fontFamily === id) names.push('현재 읽기 설정');
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('unp.preset.') || !value || typeof value !== 'object') continue;
    const preset = value as { name?: string; settings?: { fontFamily?: string } };
    if (preset.settings?.fontFamily === id) names.push(preset.name || '내 프리셋');
  }
  return names;
}
