import { DEFAULT_PRESETS } from '@/shared/config/legacy-presets';
import { DEFAULT_SETTINGS } from '@/shared/config/base-settings';
import { defaults, visualSettings, type Preset } from '@/shared/model/preferences';

/** Read-only compatibility catalog. Do not expose it as another browsing category. */
export const legacyBuiltInPresets: Preset[] = DEFAULT_PRESETS.map((preset) => ({
  ...preset,
  settings: visualSettings({
    ...defaults,
    paragraphGap: 0,
    readingSurfaces: 'default',
    ...preset.settings,
  }),
}));

// Updating the neutral starting point must not silently restyle the other nine themes.
const themeDefaults = {
  ...defaults,
  ...DEFAULT_SETTINGS,
  paragraphGap: 0,
  readingSurfaces: 'default' as const,
};

export const builtInPresets: Preset[] = [
  {
    id: 'preset_builtin_basic',
    name: '기본',
    description: '노벨피아 기본에 맞춘 노토 산스 KR 18px',
    isDefault: true,
    createdAt: 0,
    settings: { ...defaults },
  },
  {
    id: 'preset_builtin_paper',
    name: '종이',
    description: '따뜻한 바탕, 마루 부리 20px',
    isDefault: true,
    createdAt: 0,
    settings: {
      ...themeDefaults,
      fontFamily: 'MaruBuri',
      fontSize: 20,
      maxWidth: 800,
      horizontalPadding: 30,
      verticalPadding: 20,
      lineHeight: 180,
      paragraphSpacing: 12,
      backgroundColor: '#F7F3E8',
      textAreaBackgroundColor: '#FFFDF7',
      textColor: '#3D352C',
    },
  },
  {
    id: 'preset_builtin_dark',
    name: '어두움',
    description: '어두운 바탕, 밝은 글씨 18px',
    isDefault: true,
    createdAt: 0,
    settings: {
      ...themeDefaults,
      darkMode: true,
      backgroundColor: '#17171B',
      textAreaBackgroundColor: '#242429',
      textColor: '#E8E6EE',
    },
  },
  {
    id: 'preset_builtin_large_text',
    name: '큰 글씨',
    description: '기본 글꼴 24px, 넓은 줄 간격',
    isDefault: true,
    createdAt: 0,
    settings: {
      ...themeDefaults,
      fontSize: 24,
      maxWidth: 950,
      horizontalPadding: 30,
      verticalPadding: 25,
      lineHeight: 180,
      paragraphSpacing: 16,
    },
  },
  {
    id: 'preset_builtin_contrast',
    name: '고대비',
    description: '흰 바탕, 선명한 검정 글씨 20px',
    isDefault: true,
    createdAt: 0,
    settings: {
      ...themeDefaults,
      fontSize: 20,
      lineHeight: 170,
      backgroundColor: '#FFFFFF',
      textAreaBackgroundColor: '#FFFFFF',
      textColor: '#111111',
    },
  },
  {
    id: 'preset_builtin_gray_paper',
    name: '회색 종이',
    description: '차분한 회색 바탕, 기본 글꼴 20px',
    isDefault: true,
    createdAt: 0,
    settings: {
      ...themeDefaults,
      fontSize: 20,
      maxWidth: 820,
      lineHeight: 175,
      backgroundColor: '#E4E5E7',
      textAreaBackgroundColor: '#F0F0F1',
      textColor: '#303238',
    },
  },
  {
    id: 'preset_builtin_sepia',
    name: '세피아',
    description: '갈색 종이 바탕, 마루 부리 20px',
    isDefault: true,
    createdAt: 0,
    settings: {
      ...themeDefaults,
      fontFamily: 'MaruBuri',
      fontSize: 20,
      maxWidth: 800,
      lineHeight: 180,
      backgroundColor: '#D7C3A4',
      textAreaBackgroundColor: '#EBDDCA',
      textColor: '#48382B',
    },
  },
  {
    id: 'preset_builtin_deep_purple',
    name: '짙은 보라',
    description: '보랏빛 어두운 바탕, 기본 글꼴 20px',
    isDefault: true,
    createdAt: 0,
    settings: {
      ...themeDefaults,
      darkMode: true,
      fontSize: 20,
      maxWidth: 840,
      lineHeight: 175,
      backgroundColor: '#211B2D',
      textAreaBackgroundColor: '#2D253A',
      textColor: '#EDE5F7',
    },
  },
  {
    id: 'preset_builtin_narrow',
    name: '좁은 본문',
    description: '짧게 이어지는 한 줄, 기본 글꼴 18px',
    isDefault: true,
    createdAt: 0,
    settings: { ...themeDefaults, maxWidth: 640, lineHeight: 175 },
  },
  {
    id: 'preset_builtin_wide',
    name: '넓은 본문',
    description: '넓은 본문, 마루 부리 22px',
    isDefault: true,
    createdAt: 0,
    settings: {
      ...themeDefaults,
      fontFamily: 'MaruBuri',
      fontSize: 22,
      maxWidth: 1050,
      lineHeight: 175,
    },
  },
];

export function findPreset(id: string | null, users: readonly Preset[] = []): Preset | undefined {
  return (
    users.find((preset) => preset.id === id) ??
    builtInPresets.find((preset) => preset.id === id) ??
    legacyBuiltInPresets.find((preset) => preset.id === id)
  );
}
