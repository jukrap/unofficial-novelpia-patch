import type { SettingsStore } from '@/entities/settings';
import type { NativeState } from '@/shared/model/native-protocol';
import type { StoragePort } from '@/shared/platform/storage';

/** Shared settings own the choice; the native adapter still performs the actual switch. */
export function storedReadingMode({
  settings,
  storage,
  nativeState,
  canApply,
  apply,
  onError,
}: {
  settings: SettingsStore;
  storage: StoragePort;
  nativeState: () => NativeState | undefined;
  canApply: () => boolean;
  apply: (mode: 'scroll' | 'page') => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const key = `unp.native-reading-mode.v1.${location.origin}`;
  let pending: Promise<void> | null = null;
  let restoring: Promise<boolean> | null = null;
  const persist = async () => {
    // Another edit may arrive while storage is writing. A native reload must not
    // discard that newer revision (for example, a page-layout change).
    do {
      await settings.flush();
      if (settings.getSnapshot().status === 'error') throw new Error(settings.getSnapshot().error);
    } while (settings.getSnapshot().status === 'saving');
  };
  const sync = (): Promise<void> => {
    if (pending) return pending;
    const native = nativeState();
    if (!canApply() || !native?.available) return Promise.resolve();
    const mode = settings.getSnapshot().settings.readingMode;
    if (mode === null) {
      settings.update({ readingMode: native.mode });
      return settings.flush();
    }
    if (mode === native.mode) return Promise.resolve();
    let succeeded = false;
    pending = (async () => {
      await persist();
      if (!canApply()) return;
      // Snapshot before awaiting: another tab must save this same original value
      // before it can change the shared native preference.
      const value = localStorage.getItem('viewer_paging');
      const saved = await storage.local.get(key);
      if (!(key in saved)) await storage.local.set({ [key]: { value } });
      await persist();
      const target = settings.getSnapshot().settings.readingMode;
      if (canApply() && target && target !== nativeState()?.mode) await apply(target);
      succeeded = true;
    })()
      .catch(onError)
      .finally(() => {
        pending = null;
        if (
          succeeded &&
          canApply() &&
          settings.getSnapshot().settings.readingMode !== nativeState()?.mode
        )
          void sync();
      });
    return pending;
  };
  const restore = () =>
    (restoring ??= (async () => {
      await pending;
      const saved = (await storage.local.get(key))[key] as { value?: unknown } | undefined;
      if (!saved || (saved.value !== null && typeof saved.value !== 'string')) return false;
      const changed = localStorage.getItem('viewer_paging') !== saved.value;
      if (saved.value === null) localStorage.removeItem('viewer_paging');
      else localStorage.setItem('viewer_paging', saved.value);
      await storage.local.remove(key);
      return changed;
    })().catch((error) => {
      restoring = null;
      throw error;
    }));
  return { sync, restore };
}
