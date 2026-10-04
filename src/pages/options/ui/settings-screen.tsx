import { SettingsPanel, panelStyles } from '@/widgets/settings-panel';
import type { OptionsScreenProps } from '../model/contracts';

export default function SettingsScreen({ store, section, onNotify }: OptionsScreenProps) {
  return (
    <>
      <style>{panelStyles}</style>
      <SettingsPanel
        store={store}
        embedded
        section={section}
        onEnabledChange={async (enabled) => {
          await store.flush();
          if (store.getSnapshot().error) throw new Error(store.getSnapshot().error);
          const previous = store.getSnapshot().settings.enabled;
          store.update({ enabled });
          await store.flush();
          const error = store.getSnapshot().error;
          if (error) {
            store.update({ enabled: previous });
            await store.flush();
            throw new Error(error);
          }
          onNotify('변경했습니다. 열려 있는 뷰어를 새로고침하면 적용됩니다.');
        }}
      />
    </>
  );
}
