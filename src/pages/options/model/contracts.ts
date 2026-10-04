import type { SettingsStore } from '@/entities/settings';
import type { PresetStore } from '@/entities/preset';
import type { ReadingStatsClient } from '@/entities/reading-stats';
import type { SettingsSection } from '@/shared/config/settings-sections';

export interface OptionsContext {
  store: SettingsStore;
  stats: ReadingStatsClient;
  loadPresets: () => Promise<PresetStore>;
}
export interface OptionsScreenProps extends OptionsContext {
  onNotify: (message: string) => void;
  actionTarget: HTMLElement | null;
  section: SettingsSection;
}
