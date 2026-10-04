import type { Settings } from '@/shared/model/preferences';
import type { StorageArea } from './storage';

export const STARTUP_KEY = 'unp.startup.v1';
export type StartupTheme = Pick<
  Settings,
  | 'enabled'
  | 'backgroundColor'
  | 'textColor'
  | 'textAreaBackgroundColor'
  | 'darkMode'
  | 'textAreaOpacity'
  | 'readingSurfaces'
>;
export function startupTheme(value: unknown): StartupTheme | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.enabled !== 'boolean' ||
    typeof v.darkMode !== 'boolean' ||
    !['backgroundColor', 'textColor', 'textAreaBackgroundColor'].every(
      (k) => typeof v[k] === 'string' && /^#[\da-f]{6}$/i.test(v[k] as string)
    )
  )
    return null;
  return {
    enabled: v.enabled,
    darkMode: v.darkMode,
    backgroundColor: v.backgroundColor as string,
    textColor: v.textColor as string,
    textAreaBackgroundColor: v.textAreaBackgroundColor as string,
    textAreaOpacity:
      typeof v.textAreaOpacity === 'number' && Number.isFinite(v.textAreaOpacity)
        ? Math.max(0, Math.min(100, v.textAreaOpacity))
        : 100,
    readingSurfaces: ['default', 'translucent', 'opaque', 'theme'].includes(
      String(v.readingSurfaces)
    )
      ? (v.readingSurfaces as StartupTheme['readingSurfaces'])
      : 'default',
  };
}
export async function cacheStartup(area: StorageArea, settings: Settings) {
  const theme = startupTheme(settings)!;
  await area
    .set({
      [STARTUP_KEY]: theme,
    })
    .catch(() => {});
}
