import { PresetManager, panelStyles } from '@/widgets/settings-panel';
import { PresetData } from './deferred-screen';
import type { OptionsScreenProps } from '../model/contracts';

export default function PresetScreen({
  store,
  loadPresets,
  onNotify,
  actionTarget,
}: OptionsScreenProps) {
  return (
    <>
      <style>{panelStyles}</style>
      <PresetData load={loadPresets}>
        {(presets) => (
          <PresetManager
            store={store}
            presets={presets}
            onNotify={onNotify}
            actionTarget={actionTarget}
          />
        )}
      </PresetData>
    </>
  );
}
