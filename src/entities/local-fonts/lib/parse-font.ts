import type { Font } from 'fontkit';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_TABLES = 4095;
const SFNT_SIGNATURES = new Set([0x00010000, 0x4f54544f, 0x74727565]);
const WOFF = 0x774f4646;
const WOFF2 = 0x774f4632;
const COLLECTION = 0x74746366;

export interface InspectedFont {
  family: string;
  fullName: string;
  weight: number;
  minWeight: number;
  maxWeight: number;
  style: 'normal' | 'italic';
  variable: boolean;
}

class FontFileError extends Error {}

function invalid(message = '글꼴 파일이 손상되었거나 필요한 정보를 읽을 수 없습니다.'): never {
  throw new FontFileError(message);
}

function expandedSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 0) invalid();
  if (size > MAX_EXPANDED_BYTES) {
    invalid('압축을 푼 글꼴 크기가 64MiB를 넘습니다. 더 작은 글꼴 파일을 선택해 주세요.');
  }
}

function checkHeader(name: string, data: Uint8Array) {
  if (data.byteLength > MAX_FILE_BYTES) {
    invalid('글꼴 파일은 하나당 20MiB까지 등록할 수 있습니다.');
  }
  if (/\.(ttc|otc|dfont)$/i.test(name)) {
    invalid(
      '여러 글꼴이 묶인 TTC·OTC·dfont 파일은 지원하지 않습니다. 개별 글꼴 파일을 선택해 주세요.'
    );
  }
  if (!/\.(ttf|otf|woff|woff2)$/i.test(name)) {
    invalid('TTF, OTF, WOFF, WOFF2 글꼴 파일을 선택해 주세요.');
  }
  if (data.byteLength < 12) invalid();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const signature = view.getUint32(0);
  if (signature === COLLECTION) {
    invalid('여러 글꼴이 묶인 파일은 지원하지 않습니다. 개별 글꼴 파일을 선택해 주세요.');
  }
  const compressed = signature === WOFF || signature === WOFF2;
  if (!compressed && !SFNT_SIGNATURES.has(signature))
    invalid('지원하지 않는 글꼴 파일 형식입니다.');
  const headerSize = signature === WOFF ? 44 : signature === WOFF2 ? 48 : 12;
  if (data.byteLength < headerSize) invalid();
  if (compressed) {
    const flavor = view.getUint32(4);
    if (flavor === COLLECTION) {
      invalid('여러 글꼴이 묶인 WOFF 파일은 지원하지 않습니다. 개별 글꼴 파일을 선택해 주세요.');
    }
    if (!SFNT_SIGNATURES.has(flavor) || view.getUint32(8) !== data.byteLength) invalid();
    expandedSize(view.getUint32(16));
  }
  const tableCount = view.getUint16(compressed ? 12 : 4);
  if (!tableCount || tableCount > MAX_TABLES) invalid('글꼴 파일의 내부 목록이 올바르지 않습니다.');
  const entrySize = signature === WOFF ? 20 : signature === WOFF2 ? 2 : 16;
  if (headerSize + entrySize * tableCount > data.byteLength) invalid();
  return { signature, tableCount, view };
}

/** Check lengths before asking fontkit for any lazily decoded/decompressed table. */
function checkTables(font: Font, data: Uint8Array, header: ReturnType<typeof checkHeader>) {
  const tables = Object.values(font.directory.tables);
  if (tables.length !== header.tableCount)
    invalid('글꼴 파일에 중복되거나 손상된 내부 목록이 있습니다.');
  let expanded = 12 + tables.length * 16;
  let transformed = 0;
  for (const table of tables) {
    expandedSize(table.length);
    expanded += Math.ceil(table.length / 4) * 4;
    expandedSize(expanded);
    if (header.signature === WOFF2) {
      const length = table.transformLength ?? table.length;
      expandedSize(length);
      transformed += length;
      expandedSize(transformed);
    } else {
      const offset = table.offset;
      const length = table.compLength ?? table.length;
      if (
        offset === undefined ||
        offset < font.stream.pos ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > table.length ||
        offset + length > data.byteLength
      ) {
        invalid();
      }
    }
  }
  if (header.signature === WOFF2) {
    const compressed = header.view.getUint32(20);
    if (!compressed || font.stream.pos + compressed > data.byteLength) invalid();
  }
  if (!font.directory.tables.name || !font.directory.tables['OS/2']) {
    invalid('이름 또는 두께 정보가 없는 글꼴입니다. 다른 배포 파일을 선택해 주세요.');
  }
}

function cleanName(value: string | null) {
  return (
    value
      ?.replace(/\p{Cc}/gu, '')
      .trim()
      .normalize('NFC') || null
  );
}

function validWeight(value: number) {
  return Number.isFinite(value) && value >= 1 && value <= 1000;
}

function metadata(font: Font): InspectedFont {
  // Name ID 16 groups static faces whose legacy family name includes their weight.
  const family =
    cleanName(font.getName('preferredFamily', 'ko')) ?? cleanName(font.getName('fontFamily', 'ko'));
  if (!family) invalid('글꼴 이름을 읽을 수 없습니다. 다른 배포 파일을 선택해 주세요.');
  const fullName = cleanName(font.getName('fullName', 'ko')) ?? family;
  const os2 = font['OS/2'];
  if (!os2 || !validWeight(os2.usWeightClass)) {
    invalid('글꼴의 두께 정보가 올바르지 않습니다. 지원 두께를 자동으로 확인할 수 없습니다.');
  }
  const fvar = font.fvar;
  if (font.directory.tables.fvar && !fvar) invalid('가변 글꼴의 지원 범위를 읽을 수 없습니다.');
  const weightAxes = fvar?.axis.filter((axis) => axis.axisTag === 'wght') ?? [];
  if (weightAxes.length > 1) invalid('가변 글꼴의 두께 축이 중복되어 있습니다.');
  const axis = weightAxes[0];
  const weight = axis?.defaultValue ?? os2.usWeightClass;
  const minWeight = axis?.minValue ?? weight;
  const maxWeight = axis?.maxValue ?? weight;
  if (
    ![weight, minWeight, maxWeight].every(validWeight) ||
    minWeight > weight ||
    weight > maxWeight
  ) {
    invalid('가변 글꼴의 두께 범위가 올바르지 않습니다.');
  }
  return {
    family,
    fullName,
    weight,
    minWeight,
    maxWeight,
    style:
      os2.fsSelection.italic || os2.fsSelection.oblique || font.post?.italicAngle
        ? 'italic'
        : 'normal',
    variable: Boolean(axis && minWeight < maxWeight),
  };
}

/** Inspect metadata only. The caller must also let FontFace validate the font before saving. */
export async function inspectFontFile(name: string, data: Uint8Array): Promise<InspectedFont> {
  try {
    const header = checkHeader(name, data);
    const { create } = await import('fontkit');
    const font = create(data);
    checkTables(font, data, header);
    return metadata(font);
  } catch (error) {
    if (error instanceof FontFileError) throw error;
    invalid();
  }
}
