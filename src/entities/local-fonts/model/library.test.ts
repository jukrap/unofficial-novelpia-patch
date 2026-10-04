import { describe, expect, it } from 'vitest';
import { FONT_STORAGE_LIMIT, userFontWeights, type UserFontFace } from '@/shared/model/user-font';
import { fontReferences, validateFamily, validateLibrary, type FontRecord } from './library';

function face(weight: number, overrides: Partial<UserFontFace> = {}): UserFontFace {
  return {
    id: `face-${weight}`,
    fileName: `example-${weight}.woff2`,
    size: 1024,
    weight,
    minWeight: weight,
    maxWeight: weight,
    style: 'normal',
    variable: false,
    ...overrides,
  };
}

function font(faces: UserFontFace[] = [face(400)], id = 'font-one'): FontRecord {
  return { id, family: 'Example', displayName: '예시 글꼴', revision: 'r1', faces, blobs: {} };
}

describe('registered family validation', () => {
  it('requires a regular upright face, including when only italic files were selected', () => {
    expect(() => validateFamily(font([]))).toThrow('기본 글꼴 파일');
    expect(() => validateFamily(font([face(400, { style: 'italic' })]))).toThrow('기본 글꼴 파일');
    expect(() => validateFamily(font([face(400)]))).not.toThrow();
  });

  it('accepts different weights and same-weight italic/upright files', () => {
    const family = font([face(400), face(700), face(400, { id: 'italic', style: 'italic' })]);
    expect(() => validateFamily(family)).not.toThrow();
  });

  it('rejects same-style overlapping files and identifies both file names', () => {
    const family = font([face(400), face(400, { id: 'other-file', fileName: 'other.woff2' })]);
    expect(() => validateFamily(family)).toThrow('example-400.woff2와 other.woff2');
  });

  it('rejects a static face inside a variable range and overlapping variable endpoints', () => {
    expect(() =>
      validateFamily(
        font([face(400, { minWeight: 100, maxWeight: 900, variable: true }), face(700)])
      )
    ).toThrow('두께가 겹칩니다');
    expect(() =>
      validateFamily(
        font([
          face(400, { minWeight: 100, maxWeight: 500, variable: true }),
          face(700, { minWeight: 500, maxWeight: 900, variable: true }),
        ])
      )
    ).toThrow('두께가 겹칩니다');
  });

  it('accepts disjoint variable ranges and overlapping ranges with different styles', () => {
    expect(() =>
      validateFamily(
        font([
          face(400, { minWeight: 100, maxWeight: 499, variable: true }),
          face(700, { minWeight: 500, maxWeight: 900, variable: true }),
          face(400, {
            id: 'italic',
            minWeight: 100,
            maxWeight: 900,
            style: 'italic',
            variable: true,
          }),
        ])
      )
    ).not.toThrow();
  });

  it('caps a single family at 24 files', () => {
    const faces = Array.from({ length: 25 }, (_, index) => face(100 + index));
    expect(() => validateFamily(font(faces.slice(0, 24)))).not.toThrow();
    expect(() => validateFamily(font(faces))).toThrow('24개');
  });

  it('rejects families with no normal weight selectable by the reader', () => {
    for (const faces of [
      [face(950)],
      [face(50, { minWeight: 1, maxWeight: 99, variable: true })],
      [face(950, { minWeight: 901, maxWeight: 1000, variable: true })],
      [face(950), face(400, { style: 'italic' })],
    ]) {
      expect(() => validateFamily(font(faces))).toThrow();
    }
  });
});

describe('font storage limits', () => {
  it('accepts exactly 100MiB and rejects another byte without requiring binary allocations', () => {
    const faces = [100, 200, 300, 400, 500].map((weight) =>
      face(weight, { size: FONT_STORAGE_LIMIT / 5 })
    );
    const family = font(faces);
    expect(() => validateLibrary([family])).not.toThrow();
    expect(() => validateLibrary([family, font([face(600, { size: 1 })], 'font-two')])).toThrow(
      '100MiB'
    );
  });

  it('validates each family and limits the number of registered families', () => {
    const records = Array.from({ length: 101 }, (_, index) => font([face(400)], `font-${index}`));
    expect(() => validateLibrary(records.slice(0, 100))).not.toThrow();
    expect(() => validateLibrary(records)).toThrow('100종');
    expect(() => validateLibrary([font([face(400, { style: 'italic' })])])).toThrow(
      '기본 글꼴 파일'
    );
  });
});

describe('font references for removal', () => {
  it('finds current reading settings and every referencing saved preset', () => {
    expect(
      fontReferences(
        {
          'unp.reader.v1': { data: { fontFamily: 'font-one' } },
          'unp.preset.v1.a': { name: '밤에 읽기', settings: { fontFamily: 'font-one' } },
          'unp.preset.v1.b': { name: '넓은 본문', settings: { fontFamily: 'font-one' } },
          'unp.preset.v1.c': { name: '다른 글꼴', settings: { fontFamily: 'font-other' } },
        },
        'font-one'
      )
    ).toEqual(['현재 읽기 설정', '밤에 읽기', '넓은 본문']);
  });

  it('keeps a referencing preset protected even if its display name is absent', () => {
    expect(
      fontReferences(
        {
          'unp.preset.v1.a': { settings: { fontFamily: 'font-one' } },
        },
        'font-one'
      )
    ).toEqual(['내 프리셋']);
  });

  it('ignores unrelated settings, malformed entries and the preset index', () => {
    expect(
      fontReferences(
        {
          'unp.reader.v1': { data: { fontFamily: 'font-other' } },
          'unp.preset.v1.index': { ids: ['a', 'b'] },
          'unp.preset.v1.a': null,
          'unp.preset.v1.b': 'invalid',
          unrelated: { name: 'Unrelated', settings: { fontFamily: 'font-one' } },
        },
        'font-one'
      )
    ).toEqual([]);
    expect(fontReferences({}, 'font-one')).toEqual([]);
  });
});

describe('reader-compatible weight choices', () => {
  it('sorts/deduplicates actual upright weights without adding italic-only or assumed weights', () => {
    expect(
      userFontWeights(font([face(700), face(350), face(350), face(400, { style: 'italic' })]))
    ).toEqual([350, 700]);
  });

  it('keeps actual variable endpoints/default and only supported hundred steps', () => {
    expect(
      userFontWeights(font([face(460.5, { minWeight: 250.5, maxWeight: 825.25, variable: true })]))
    ).toEqual([250.5, 300, 400, 460.5, 500, 600, 700, 800, 825.25]);
  });

  it('intersects wide variable ranges with 100~900 and does not clamp static files to invented weights', () => {
    expect(
      userFontWeights(font([face(400, { minWeight: 1, maxWeight: 1000, variable: true })]))
    ).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(userFontWeights(font([face(1), face(1000)]))).toEqual([]);
  });

  it('preserves narrow ranges without a hundred-step value and exact boundary faces', () => {
    expect(
      userFontWeights(font([face(455, { minWeight: 450, maxWeight: 460, variable: true })]))
    ).toEqual([450, 455, 460]);
    expect(userFontWeights(font([face(100), face(900)]))).toEqual([100, 900]);
  });
});
