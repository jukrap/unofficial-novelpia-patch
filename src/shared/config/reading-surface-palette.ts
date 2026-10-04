import type { Settings } from '@/shared/model/preferences';

export type ReadingSurfaceSettings = Pick<
  Settings,
  'readingSurfaces' | 'darkMode' | 'textColor' | 'textAreaBackgroundColor'
>;

function rgba(hex: string, opacity: number) {
  return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${opacity})`;
}

/** Shared by the first-paint cache and the runtime; null leaves native paint intact. */
export function readingSurfacePalette(settings: ReadingSurfaceSettings) {
  if (settings.readingSurfaces === 'default') return null;
  const theme = settings.darkMode
    ? { paper: '#24212a', ink: '#f1edf7', border: '#797082' }
    : { paper: '#ffffff', ink: '#292630', border: '#bab9c6' };
  const themed = settings.readingSurfaces === 'theme';
  const ink = themed ? theme.ink : settings.textColor;
  return {
    ink,
    paper: rgba(
      themed ? theme.paper : settings.textAreaBackgroundColor,
      settings.readingSurfaces === 'translucent' ? 0.8 : 1
    ),
    border: themed ? theme.border : rgba(ink, 0.24),
  };
}
