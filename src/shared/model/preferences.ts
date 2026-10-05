import { z } from 'zod';
import { DEFAULT_SETTINGS } from '@/shared/config/base-settings';
import { NATIVE_READING_DEFAULTS } from '@/shared/config/native-defaults';
import { PAGE_GAP_MAX } from '@/shared/config/reader-layout';
import type { Settings } from './types';

const color = z.string().regex(/^#[\da-f]{6}$/i, '6자리 HEX 색상을 입력해 주세요.');
const imageUrl = z
  .string()
  .max(4096)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'http 또는 https 이미지 주소를 입력해 주세요.');
export const settingsSchema = z.object({
  enabled: z.boolean(),
  readingMode: z.enum(['scroll', 'page']).nullable(),
  spreadMode: z.enum(['auto', 'single']),
  pageGap: z.number().min(0).max(PAGE_GAP_MAX),
  pageNavigationPlacement: z.enum(['reserved', 'fixed', 'overlay']),
  readerHeightPercent: z.number().min(40).max(100),
  readingSurfaces: z.enum(['default', 'translucent', 'opaque', 'theme']),
  maxWidth: z.number().min(200).max(1500),
  horizontalPadding: z.number().min(0).max(300),
  verticalPadding: z.number().min(0).max(500),
  fontFamily: z.string().min(1).max(120),
  fontSize: z.number().min(8).max(50),
  fontWeight: z.number().min(100).max(900),
  forceBold: z.boolean(),
  enhanceBoldTextStyle: z.enum(['none', 'shadow', 'highlight', 'border']),
  letterSpacing: z.number().min(-5).max(20),
  lineHeight: z.number().min(50).max(400),
  paragraphSpacing: z.number().min(-50).max(100),
  paragraphGap: z.number().min(0).max(100),
  wordBreakMode: z.enum(['normal', 'keep-all', 'break-all']),
  backgroundType: z.enum(['color', 'image']),
  backgroundColor: color,
  backgroundImage: imageUrl,
  backgroundImageSource: z.enum(['url', 'file', 'builtin']),
  backgroundAssetId: z.string().min(1).max(160).nullable(),
  backgroundImageFade: z.boolean(),
  pageEffect: z.enum(['none', 'slide', 'fade', 'paper', 'fold']),
  overlayColor: color,
  overlayOpacity: z.number().min(0).max(100),
  textColor: color,
  textAreaBackgroundColor: color,
  textAreaOpacity: z.number().min(0).max(100),
  darkMode: z.boolean(),
  autoRecommend: z.boolean(),
  recommendDelay: z.number().min(20).max(300),
});
export const defaults: Settings = {
  ...DEFAULT_SETTINGS,
  ...NATIVE_READING_DEFAULTS,
  maxWidth: 880,
  paragraphGap: 1,
  enabled: true,
  // Older settings inherit the native mode once, rather than silently switching it.
  readingMode: null,
  spreadMode: 'auto',
  pageGap: 20,
  pageNavigationPlacement: 'overlay',
  readerHeightPercent: 100,
  readingSurfaces: 'theme',
  backgroundImageSource: 'url',
  backgroundAssetId: null,
  backgroundImageFade: true,
  pageEffect: 'slide',
};
export function normalizeSettings(input: unknown): { settings: Settings; issues: string[] } {
  const settings = { ...defaults };
  const issues: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { settings, issues: ['설정 데이터 형식을 확인해 주세요.'] };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (!(key in input)) continue;
    const result = settingsSchema.shape[key].safeParse((input as Record<string, unknown>)[key]);
    if (result.success) Object.assign(settings, { [key]: result.data });
    else issues.push(key);
  }
  return { settings, issues };
}
export function visualSettings(settings: Settings): Settings {
  return { ...settings, autoRecommend: false };
}
/** Presets change reading appearance, never extension state or recommendation consent. */
export const PRESET_SETTING_KEYS = [
  'readingMode',
  'spreadMode',
  'pageEffect',
  'pageNavigationPlacement',
  'maxWidth',
  'horizontalPadding',
  'verticalPadding',
  'pageGap',
  'readerHeightPercent',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'forceBold',
  'enhanceBoldTextStyle',
  'letterSpacing',
  'lineHeight',
  'paragraphSpacing',
  'paragraphGap',
  'wordBreakMode',
  'backgroundType',
  'backgroundColor',
  'backgroundImage',
  'backgroundImageSource',
  'backgroundAssetId',
  'overlayColor',
  'overlayOpacity',
  'textColor',
  'textAreaBackgroundColor',
  'textAreaOpacity',
  'readingSurfaces',
  'darkMode',
] as const satisfies readonly (keyof Settings)[];

const READING_MODE_KEYS: readonly (keyof Settings)[] = [
  'readingMode',
  'spreadMode',
  'pageEffect',
  'pageNavigationPlacement',
];

export function applyPresetSettings(current: Settings, preset: Partial<Settings>): Settings {
  const next = { ...current };
  for (const key of PRESET_SETTING_KEYS)
    if (
      preset[key] !== undefined &&
      !(preset.readingMode == null && READING_MODE_KEYS.includes(key))
    )
      Object.assign(next, { [key]: preset[key] });
  return next;
}

export function presetSettingsEqual(a: Partial<Settings>, b: Partial<Settings>): boolean {
  return PRESET_SETTING_KEYS.every((key) => {
    // Old presets never owned these options. Ignore their default-filled snapshots.
    if (b.readingMode == null && READING_MODE_KEYS.includes(key)) return true;
    const left = a[key] ?? defaults[key];
    const right = b[key] ?? defaults[key];
    return key.endsWith('Color') && typeof left === 'string' && typeof right === 'string'
      ? left.toUpperCase() === right.toUpperCase()
      : left === right;
  });
}
export type { Settings, Preset, LegacySettings } from './types';
