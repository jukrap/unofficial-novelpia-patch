import { useSyncExternalStore } from 'react';
import { SettingsPanel, type PanelProps } from '@/widgets/settings-panel';
import type { ReaderEngine } from '@/entities/reader';
import { MotionRoot } from '@/shared/ui/motion-root';
export function ViewerPanel({ engine, ...props }: PanelProps & { engine: ReaderEngine | null }) {
  // The panel only needs status; scrolling should update the navigation, not every setting.
  const error = useSyncExternalStore(
    engine?.subscribe ?? emptySubscribe,
    () => engine?.getSnapshot().error ?? ''
  );
  const fontStatus = useSyncExternalStore(
    engine?.subscribe ?? emptySubscribe,
    () => engine?.getSnapshot().fontStatus ?? ''
  );
  const backgroundError = useSyncExternalStore(
    engine?.subscribe ?? emptySubscribe,
    () => engine?.getSnapshot().backgroundError ?? ''
  );
  return (
    <MotionRoot>
      <SettingsPanel
        {...props}
        reader={{ error, fontStatus, backgroundError }}
        onRetryFont={engine?.retryFont}
      />
    </MotionRoot>
  );
}
const emptySubscribe = () => () => {};
