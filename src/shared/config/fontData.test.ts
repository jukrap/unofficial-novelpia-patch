import { describe, expect, it } from 'vitest';
import { FONTS } from './fontData';

const additions: [string, number[]][] = [
  ['Freesentation', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
  ['MuseumCulturalFoundationClassic', [300, 500, 700]],
  ['KimJeongCheolHandwriting', [300, 400, 700]],
  ['Yeongdo', [400, 700, 900]],
  ['JeonjuWanpanbon', [300, 400, 700]],
  ['IncheonEducation', [400]],
  ['NexonMaplestory', [300, 700]],
  ['RoundedFixedsys', [400]],
  ['Shilla', [500, 700]],
  ['PyeojinGothic', [300, 400, 500, 600, 700, 800, 900]],
  ['Soonbatang', [300, 500, 700]],
];

describe('reading font catalog', () => {
  it('preserves saved font IDs and adds each requested family once', () => {
    const originalIds = [
      'system-ui',
      'Noto Sans KR',
      'Pretendard',
      'IBM Plex Sans KR',
      'NanumSquare Neo',
      '42dot Sans',
      'Jua',
      'Noto Serif KR',
      'Hahmlet',
      'Nanum Myeongjo',
      'MaruBuri',
      'RIDIBatang',
      'Hakgyoansim Butpen',
      'J Gaegujaengyi',
      'Yeon Sung',
    ];
    const ids = FONTS.map((font) => font.name);
    expect(ids).toHaveLength(26);
    expect(new Set(ids).size).toBe(26);
    expect(ids).toEqual(expect.arrayContaining([...originalIds, ...additions.map(([id]) => id)]));
  });

  it.each(additions)('loads all supported %s faces from the first resource', (id, weights) => {
    const font = FONTS.find((candidate) => candidate.name === id)!;
    expect(font.metadata.weights).toEqual(weights);
    expect(font.metadata.variableFont).toBe(false);
    expect(font.urls).toHaveLength(1);
    const css = font.urls[0]!.css!;
    const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => match[1]!);
    expect(faces).toHaveLength(weights.length);
    expect(faces.map((face) => Number(/font-weight:\s*(\d+)/.exec(face)?.[1]))).toEqual(weights);
    for (const face of faces) {
      expect(face).toContain(`font-family: '${id}';`);
      expect(face).toMatch(/src: url\('https:\/\/cdn\.jsdelivr\.net\/[^']+\.woff2?'\)/);
      expect(face).toContain('font-display: swap;');
    }
    expect(css).not.toContain('UNP UI');
  });

  it('groups categories, pins reading choices, and sorts the remaining Korean names', () => {
    const groups = Object.fromEntries(
      ['System', 'Sans', 'Serif', 'Calligraphy', 'Display'].map((category) => [
        category,
        FONTS.filter((font) => font.category === category).map((font) => font.name),
      ])
    );
    expect(FONTS.map((font) => font.name)).toEqual(Object.values(groups).flat());
    expect(groups).toEqual({
      System: ['system-ui'],
      Sans: [
        'Freesentation',
        'Pretendard',
        'Noto Sans KR',
        '42dot Sans',
        'NanumSquare Neo',
        'PyeojinGothic',
        'IBM Plex Sans KR',
      ],
      Serif: [
        'MaruBuri',
        'RIDIBatang',
        'MuseumCulturalFoundationClassic',
        'Nanum Myeongjo',
        'Noto Serif KR',
        'Soonbatang',
        'JeonjuWanpanbon',
        'Hahmlet',
      ],
      Calligraphy: [
        'KimJeongCheolHandwriting',
        'Yeon Sung',
        'IncheonEducation',
        'Hakgyoansim Butpen',
        'J Gaegujaengyi',
      ],
      Display: ['RoundedFixedsys', 'NexonMaplestory', 'Shilla', 'Yeongdo', 'Jua'],
    });
  });
});
