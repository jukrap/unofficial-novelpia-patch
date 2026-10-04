import { createRoot } from 'react-dom/client';
import { OptionsPage, optionsStyles } from '@/pages/options';
import { SettingsStore } from '@/entities/settings';
import { ReadingStatsClient } from '@/entities/reading-stats';
import type { PresetStore } from '@/entities/preset';
import { chromeStorage } from '@/shared/platform/storage';
import { uiThemeStyles } from '@/shared/ui/theme-styles';
import { installUiFonts } from '@/shared/platform/ui-fonts';
import { initializeUserFonts } from '@/shared/platform/user-fonts';

const releaseUiFonts = installUiFonts();
const style = document.createElement('style');
style.textContent = uiThemeStyles + optionsStyles;
document.head.append(style);
const storage = chromeStorage();
const settings = new SettingsStore(storage);
const stats = new ReadingStatsClient(storage);
let presets: PresetStore | undefined;
let loadingPresets: Promise<PresetStore> | undefined;
let disposed = false;
const loadPresets = () => {
  loadingPresets ??= import('@/entities/preset')
    .then(async (module) => {
      const next = new module.PresetStore(storage);
      await next.initialize();
      if (disposed || !next.isReady()) {
        next.dispose();
        throw new Error(next.getSnapshot().error || '프리셋 저장소를 불러오지 못했습니다.');
      }
      presets = next;
      return next;
    })
    .catch((error: unknown) => {
      loadingPresets = undefined;
      throw error;
    });
  return loadingPresets;
};
window.addEventListener('pagehide', (event) => {
  void settings.flush();
  if (event.persisted) return;
  releaseUiFonts();
  disposed = true;
  settings.dispose();
  stats.dispose();
  presets?.dispose();
});
void stats.initialize();
void initializeUserFonts().catch(() => {});
void settings.initialize().then(() => {
  const root = document.getElementById('app')!;
  root.removeAttribute('aria-busy');
  createRoot(root).render(<OptionsPage store={settings} stats={stats} loadPresets={loadPresets} />);
});
