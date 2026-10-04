import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectFontFile } from './parse-font';

type Table = { tag: string; data: Uint8Array };

function writeTag(data: Uint8Array, offset: number, tag: string) {
  [...tag].forEach((char, index) => {
    data[offset + index] = char.charCodeAt(0);
  });
}

function names(entries: { id: number; value: string; language?: number }[]): Table {
  const headerLength = 6 + entries.length * 12;
  const data = new Uint8Array(
    headerLength + entries.reduce((length, entry) => length + entry.value.length * 2, 0)
  );
  const view = new DataView(data.buffer);
  view.setUint16(2, entries.length);
  view.setUint16(4, headerLength);
  let position = 0;
  entries.forEach((entry, index) => {
    const offset = 6 + index * 12;
    view.setUint16(offset, 3);
    view.setUint16(offset + 2, 1);
    view.setUint16(offset + 4, entry.language ?? 0x409);
    view.setUint16(offset + 6, entry.id);
    view.setUint16(offset + 8, entry.value.length * 2);
    view.setUint16(offset + 10, position);
    for (let i = 0; i < entry.value.length; i++) {
      view.setUint16(headerLength + position, entry.value.charCodeAt(i));
      position += 2;
    }
  });
  return { tag: 'name', data };
}

function weightTable(weight: number, italic = false): Table {
  const data = new Uint8Array(68);
  const view = new DataView(data.buffer);
  view.setUint16(4, weight);
  view.setUint16(6, 5);
  view.setUint16(62, italic ? 1 : 0);
  return { tag: 'OS/2', data };
}

function axisTable(min: number, initial: number, max: number, tag = 'wght'): Table {
  const data = new Uint8Array(36);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x10000);
  view.setUint16(4, 16);
  view.setUint16(6, 2);
  view.setUint16(8, 1);
  view.setUint16(10, 20);
  view.setUint16(14, 8);
  writeTag(data, 16, tag);
  view.setInt32(20, min * 65536);
  view.setInt32(24, initial * 65536);
  view.setInt32(28, max * 65536);
  view.setUint16(34, 256);
  return { tag: 'fvar', data };
}

const baseNames = [
  { id: 1, value: 'Synthetic Regular' },
  { id: 4, value: 'Synthetic Regular' },
  { id: 16, value: 'Synthetic' },
  { id: 256, value: 'Weight' },
];

function sfnt(tables: Table[], format: 'ttf' | 'otf' = 'ttf') {
  const headerLength = 12 + tables.length * 16;
  const data = new Uint8Array(
    headerLength +
      tables.reduce((length, table) => length + Math.ceil(table.data.length / 4) * 4, 0)
  );
  const view = new DataView(data.buffer);
  view.setUint32(0, format === 'ttf' ? 0x10000 : 0x4f54544f);
  view.setUint16(4, tables.length);
  let position = headerLength;
  tables.forEach((table, index) => {
    const offset = 12 + index * 16;
    writeTag(data, offset, table.tag);
    view.setUint32(offset + 8, position);
    view.setUint32(offset + 12, table.data.length);
    data.set(table.data, position);
    position += Math.ceil(table.data.length / 4) * 4;
  });
  return data;
}

function woff(tables: Table[]) {
  const headerLength = 44 + tables.length * 20;
  const data = new Uint8Array(
    headerLength +
      tables.reduce((length, table) => length + Math.ceil(table.data.length / 4) * 4, 0)
  );
  const view = new DataView(data.buffer);
  writeTag(data, 0, 'wOFF');
  view.setUint32(4, 0x10000);
  view.setUint32(8, data.length);
  view.setUint16(12, tables.length);
  view.setUint32(16, sfnt(tables).length);
  let position = headerLength;
  tables.forEach((table, index) => {
    const offset = 44 + index * 20;
    writeTag(data, offset, table.tag);
    view.setUint32(offset + 4, position);
    view.setUint32(offset + 8, table.data.length);
    view.setUint32(offset + 12, table.data.length);
    data.set(table.data, position);
    position += Math.ceil(table.data.length / 4) * 4;
  });
  return data;
}

describe('local font metadata', () => {
  it.each([
    ['4Regular', 400],
    ['7Bold', 700],
  ] as const)(
    'reads the bundled OFL WOFF2 %s, grouping faces by preferred family',
    async (file, weight) => {
      const data = readFileSync(`public/fonts/Freesentation-${file}.woff2`);
      await expect(inspectFontFile(`${file}.woff2`, data)).resolves.toMatchObject({
        family: '프리젠테이션',
        weight,
        minWeight: weight,
        maxWeight: weight,
        style: 'normal',
        variable: false,
      });
    }
  );

  it.each(['ttf', 'otf', 'woff'] as const)(
    'reads name/OS2 metadata in %s without inventing extra weights',
    async (format) => {
      const tables = [names(baseNames), weightTable(550, true)];
      const data = format === 'woff' ? woff(tables) : sfnt(tables, format);
      await expect(inspectFontFile(`example.${format}`, data)).resolves.toEqual({
        family: 'Synthetic',
        fullName: 'Synthetic Regular',
        weight: 550,
        minWeight: 550,
        maxWeight: 550,
        variable: false,
        style: 'italic',
      });
    }
  );

  it('uses the Korean preferred name and falls back to a legacy name only when needed', async () => {
    const localized = [...baseNames, { id: 16, value: '한글 글꼴', language: 0x412 }];
    await expect(
      inspectFontFile('korean.ttf', sfnt([names(localized), weightTable(400)]))
    ).resolves.toMatchObject({ family: '한글 글꼴' });
    await expect(
      inspectFontFile('legacy.ttf', sfnt([names([{ id: 1, value: 'Legacy' }]), weightTable(700)]))
    ).resolves.toMatchObject({ family: 'Legacy', fullName: 'Legacy' });
  });

  it('reads the actual variable default and range, including values outside the current UI range', async () => {
    const data = sfnt([names(baseNames), weightTable(400), axisTable(1, 460.5, 1000)]);
    await expect(inspectFontFile('variable.ttf', data)).resolves.toMatchObject({
      weight: 460.5,
      minWeight: 1,
      maxWeight: 1000,
      variable: true,
    });
  });

  it('does not treat a non-weight variation axis as a weight range', async () => {
    const data = sfnt([names(baseNames), weightTable(500), axisTable(8, 12, 72, 'opsz')]);
    await expect(inspectFontFile('optical.ttf', data)).resolves.toMatchObject({
      weight: 500,
      minWeight: 500,
      maxWeight: 500,
      variable: false,
    });
  });

  it.each([
    [500, 400, 900],
    [100, 950, 900],
    [0, 400, 900],
    [100, 400, 1001],
  ])('rejects invalid variable ranges %s/%s/%s', async (min, initial, max) => {
    const data = sfnt([names(baseNames), weightTable(400), axisTable(min, initial, max)]);
    await expect(inspectFontFile('invalid.ttf', data)).rejects.toThrow('두께 범위');
  });

  it.each([0, 1001])(
    'does not infer an invalid OS/2 weight (%s) from the font name',
    async (weight) => {
      const data = sfnt([names(baseNames), weightTable(weight)]);
      await expect(inspectFontFile('regular.ttf', data)).rejects.toThrow('두께 정보');
    }
  );

  it('rejects missing required metadata and damaged fvar tables', async () => {
    await expect(inspectFontFile('no-weight.ttf', sfnt([names(baseNames)]))).rejects.toThrow(
      '두께 정보'
    );
    await expect(
      inspectFontFile('no-name.ttf', sfnt([names([]), weightTable(400)]))
    ).rejects.toThrow('이름');
    await expect(
      inspectFontFile(
        'broken-variable.ttf',
        sfnt([names(baseNames), weightTable(400), { tag: 'fvar', data: new Uint8Array([1]) }])
      )
    ).rejects.toThrow('지원 범위');
  });
});

describe('local font file boundaries', () => {
  it('rejects empty, non-font, truncated, unsupported and collection files', async () => {
    await expect(inspectFontFile('empty.ttf', new Uint8Array())).rejects.toThrow('손상');
    await expect(inspectFontFile('fake.woff', new Uint8Array(50))).rejects.toThrow('형식');
    await expect(inspectFontFile('other.txt', new Uint8Array(50))).rejects.toThrow('TTF');
    for (const name of ['collection.ttc', 'collection.otc', 'old.dfont']) {
      await expect(inspectFontFile(name, new Uint8Array(50))).rejects.toThrow('개별 글꼴');
    }
    const disguised = new Uint8Array(50);
    writeTag(disguised, 0, 'ttcf');
    await expect(inspectFontFile('collection.ttf', disguised)).rejects.toThrow('개별 글꼴');
    const data = sfnt([names(baseNames), weightTable(400)]);
    await expect(inspectFontFile('truncated.ttf', data.slice(0, 20))).rejects.toThrow('손상');
  });

  it('rejects files over 20MiB before decoding', async () => {
    await expect(
      inspectFontFile('large.ttf', new Uint8Array(20 * 1024 * 1024 + 1))
    ).rejects.toThrow('20MiB');
  });

  it('rejects out-of-file table pointers and duplicate tags', async () => {
    const data = sfnt([names(baseNames), weightTable(400)]);
    new DataView(data.buffer).setUint32(20, data.length + 1);
    await expect(inspectFontFile('pointer.ttf', data)).rejects.toThrow('손상');
    await expect(
      inspectFontFile('duplicate.ttf', sfnt([names(baseNames), names(baseNames), weightTable(400)]))
    ).rejects.toThrow('중복');
  });

  it('rejects both a large WOFF header size and forged small header with large table size', async () => {
    const data = woff([names(baseNames), weightTable(400)]);
    const view = new DataView(data.buffer);
    view.setUint32(16, 64 * 1024 * 1024 + 1);
    await expect(inspectFontFile('large.woff', data)).rejects.toThrow('64MiB');
    view.setUint32(16, 1024);
    view.setUint32(44 + 12, 64 * 1024 * 1024 + 1);
    await expect(inspectFontFile('forged.woff', data)).rejects.toThrow('64MiB');
  });

  it('bounds transformed WOFF2 data before Brotli decompression', async () => {
    const data = new Uint8Array(57);
    const view = new DataView(data.buffer);
    writeTag(data, 0, 'wOF2');
    view.setUint32(4, 0x10000);
    view.setUint32(8, data.length);
    view.setUint16(12, 1);
    view.setUint32(16, 1000);
    view.setUint32(20, 1);
    // glyf: original length 1, transformed length 64MiB + 1 (UIntBase128).
    data.set([10, 1, 0xa0, 0x80, 0x80, 1], 48);
    await expect(inspectFontFile('transformed.woff2', data)).rejects.toThrow('64MiB');
  });
});
