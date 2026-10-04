import type { SettingsStore } from '@/entities/settings';
import type { PresetStore } from '@/entities/preset';
import type { Settings } from '@/shared/model/preferences';
import type { NativeOption, NativeState } from '@/shared/model/native-protocol';
import type { ReaderState } from '@/entities/reader';
import type { SettingsSection } from '@/shared/config/settings-sections';
export type NavigationGuard = (action: () => void) => void;
export interface PanelProps {
  store: SettingsStore;
  presets?: PresetStore;
  native?: NativeState;
  reader?: Pick<ReaderState, 'error' | 'fontStatus' | 'backgroundError'>;
  onNative?: (option: NativeOption, value: boolean | 'scroll' | 'page') => Promise<void>;
  onClose?: () => void;
  onPreview?: (font: string) => void;
  onRetryFont?: () => void;
  onBookmark?: () => Promise<boolean>;
  onRestoreBookmark?: () => void;
  bookmarkAvailable?: boolean;
  onChange?: (patch: Partial<Settings>) => void;
  onEnabledChange?: (enabled: boolean) => Promise<void>;
  recommendationStatus?: string;
  connectionError?: string;
  embedded?: boolean;
  section?: SettingsSection;
}
