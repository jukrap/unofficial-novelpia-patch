import { DEFAULT_PRESETS } from '@/shared/config/legacy-presets';
import { defaults, visualSettings, type Preset, type Settings } from '@/shared/model/preferences';
import { previousBuiltInPresets } from './previous-catalog';

/** A new gallery never reinterprets a previously selected built-in ID. */
export const legacyBuiltInPresets: Preset[] = [
  ...DEFAULT_PRESETS.map((preset) => ({
    ...preset,
    settings: visualSettings({
      ...defaults,
      paragraphGap: 0,
      readingSurfaces: 'default',
      ...preset.settings,
    }),
  })),
  ...previousBuiltInPresets.slice(1),
];

function preset(id: string, name: string, description: string, values: Partial<Settings>): Preset {
  return {
    id: `preset_builtin_${id}`,
    name,
    description,
    isDefault: true,
    createdAt: 0,
    settings: { ...defaults, ...values },
  };
}
const night = {
  darkMode: true,
  backgroundColor: '#171B21',
  textAreaBackgroundColor: '#242B33',
  textColor: '#E7E9ED',
};
const image = (id: string): Partial<Settings> => ({
  backgroundType: 'image',
  backgroundImageSource: 'builtin',
  backgroundAssetId: id,
  backgroundImage: '',
  overlayOpacity: 0,
});

export const builtInPresets: Preset[] = [
  preset('basic', '기본', '화면을 채우는 익숙한 읽기 환경', {}),
  preset('paper_v2', '종이', '큰 안쪽 여백, 높이를 조금 줄인 책 형태', {
    fontFamily: 'MaruBuri',
    fontSize: 20,
    lineHeight: 185,
    paragraphGap: 4,
    maxWidth: 680,
    readerHeightPercent: 90,
    horizontalPadding: 48,
    verticalPadding: 44,
    pageGap: 36,
    backgroundColor: '#E8E2D6',
    textAreaBackgroundColor: '#FFF9EC',
    textColor: '#3D352C',
  }),
  preset('dark_v2', '어두움', '낮은 밝기 차이, 여유 있는 야간 독서창', {
    ...night,
    fontFamily: 'Freesentation',
    fontSize: 20,
    lineHeight: 185,
    maxWidth: 760,
    readerHeightPercent: 85,
    horizontalPadding: 36,
    verticalPadding: 32,
  }),
  preset('large_text_v2', '큰 글씨', '넓고 높은 본문, 26px 글자', {
    fontFamily: 'Freesentation',
    fontSize: 26,
    lineHeight: 190,
    maxWidth: 1080,
    readerHeightPercent: 100,
    horizontalPadding: 44,
    verticalPadding: 32,
    backgroundColor: '#EDEEF1',
    textAreaBackgroundColor: '#FFFFFF',
    textColor: '#1E2024',
  }),
  preset('narrow_v2', '좁은 본문', '짧은 한 줄, 화면 높이를 충분히 활용', {
    fontSize: 20,
    lineHeight: 185,
    maxWidth: 520,
    readerHeightPercent: 100,
    horizontalPadding: 20,
    verticalPadding: 12,
    pageGap: 28,
    backgroundColor: '#ECEEF1',
    textAreaBackgroundColor: '#FFFFFF',
  }),
  preset('wide_v2', '넓은 본문', '큰 모니터에서 넓은 한 쪽으로 읽기', {
    fontSize: 20,
    lineHeight: 180,
    maxWidth: 1360,
    readerHeightPercent: 100,
    horizontalPadding: 64,
    verticalPadding: 24,
    backgroundColor: '#E5E7EA',
    textAreaBackgroundColor: '#F9FAFC',
    textColor: '#2B3038',
  }),
  preset('warm_stone', '밝은 돌빛', '로우 폴리 배경 · 여백이 큰 밝은 책', {
    ...image('warm-stone'),
    fontFamily: 'MaruBuri',
    fontSize: 20,
    lineHeight: 185,
    maxWidth: 720,
    readerHeightPercent: 82,
    horizontalPadding: 56,
    verticalPadding: 48,
    pageGap: 36,
    backgroundColor: '#E8E5DE',
    textAreaBackgroundColor: '#FFFCF4',
    textAreaOpacity: 94,
    textColor: '#3D382F',
  }),
  preset('pale_sage', '옅은 녹색', '로우 폴리 배경 · 작고 차분한 독서창', {
    ...image('pale-sage'),
    fontSize: 20,
    lineHeight: 185,
    maxWidth: 620,
    readerHeightPercent: 68,
    horizontalPadding: 32,
    verticalPadding: 36,
    pageGap: 36,
    backgroundColor: '#DCE3DE',
    textAreaBackgroundColor: '#F6FAF6',
    textAreaOpacity: 94,
    textColor: '#293C32',
  }),
  preset('deep_slate', '짙은 청회색', '로우 폴리 배경 · 폭이 좁고 여백이 깊은 두 쪽', {
    ...night,
    ...image('deep-slate'),
    fontFamily: 'Freesentation',
    fontSize: 20,
    lineHeight: 180,
    maxWidth: 560,
    readerHeightPercent: 90,
    horizontalPadding: 60,
    verticalPadding: 64,
    pageGap: 28,
    backgroundColor: '#252E37',
    textAreaBackgroundColor: '#151D25',
    textAreaOpacity: 86,
  }),
  preset('muted_plum', '차분한 보라', '로우 폴리 배경 · 낮고 넓은 독서창', {
    ...night,
    ...image('muted-plum'),
    fontFamily: 'Freesentation',
    fontSize: 22,
    lineHeight: 185,
    maxWidth: 980,
    readerHeightPercent: 60,
    horizontalPadding: 72,
    verticalPadding: 40,
    backgroundColor: '#302C39',
    textAreaBackgroundColor: '#201C28',
    textAreaOpacity: 88,
    textColor: '#EEE9F2',
  }),
];

export function findPreset(id: string | null, users: readonly Preset[] = []): Preset | undefined {
  return (
    users.find((preset) => preset.id === id) ??
    builtInPresets.find((preset) => preset.id === id) ??
    legacyBuiltInPresets.find((preset) => preset.id === id)
  );
}
