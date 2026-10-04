import { SettingsStore } from '@/entities/settings';
import { chromeStorage, type StoragePort } from '@/shared/platform/storage';

interface ViewerConnection {
  documentKey: string;
}
interface ModeTabs {
  current(): Promise<number | undefined>;
  probe(tabId: number): Promise<ViewerConnection | null>;
  change(tabId: number, documentKey: string, enabled: boolean): Promise<void>;
}

const tabs: ModeTabs = {
  async current() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id;
  },
  async probe(tabId) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { type: 'unp:viewer-mode-probe' });
      return reply?.viewer === true && typeof reply.documentKey === 'string' ? reply : null;
    } catch {
      // A normal page, an old content script, or a closed tab has no receiver.
      return null;
    }
  },
  async change(tabId, documentKey, enabled) {
    const reply = await chrome.tabs.sendMessage(tabId, {
      type: 'unp:viewer-mode-change',
      documentKey,
      enabled,
    });
    if (reply?.ok !== true)
      throw new Error(reply?.error || '뷰어에 연결하지 못했습니다. 회차를 새로고침해 주세요.');
  },
};

/** The background owns a command even if its originating popup closes. */
export function createViewerModeService(storage: StoragePort, port: ModeTabs = tabs) {
  let queue: Promise<unknown> = Promise.resolve();
  const connection = async () => {
    const tabId = await port.current();
    const target = tabId === undefined ? null : await port.probe(tabId);
    return target && tabId !== undefined ? { tabId, ...target } : null;
  };
  const withStore = async <T>(task: (store: SettingsStore) => Promise<T>) => {
    const store = new SettingsStore(storage);
    try {
      await store.initialize();
      if (store.getSnapshot().status === 'error') throw new Error(store.getSnapshot().error);
      return await task(store);
    } finally {
      store.dispose();
    }
  };
  return {
    async status() {
      const [settings, target] = await Promise.all([
        withStore(async (store) => store.getSnapshot().settings),
        connection(),
      ]);
      return { connected: !!target, enabled: settings.enabled, darkMode: settings.darkMode };
    },
    setEnabled(enabled: boolean) {
      const result = queue.then(async () => {
        const target = await connection();
        if (target) {
          // Never reload by tab ID here: that tab may navigate after the probe.
          // The matching document saves/restores its state and reloads itself.
          await port.change(target.tabId, target.documentKey, enabled);
        } else {
          await withStore(async (store) => {
            store.update({ enabled });
            await store.flush();
            if (store.getSnapshot().status === 'error') throw new Error(store.getSnapshot().error);
          });
        }
        return { ok: true as const, connected: !!target };
      });
      queue = result.catch(() => {});
      return result;
    },
  };
}

export function installViewerModeService(storage = chromeStorage()) {
  const service = createViewerModeService(storage);
  const origin = chrome.runtime.getURL('');
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response: unknown) => void
  ) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    if (!['unp:viewer-mode-status', 'unp:viewer-mode-set'].includes(String(message.type))) return;
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(origin)) {
      respond({ ok: false, connected: false, error: '확장 설정 화면에서만 변경할 수 있습니다.' });
      return;
    }
    const action =
      message.type === 'unp:viewer-mode-status'
        ? service.status()
        : 'enabled' in message && typeof message.enabled === 'boolean'
          ? service.setEnabled(message.enabled)
          : Promise.reject(new Error('뷰어 사용 여부를 확인해 주세요.'));
    void action.then(respond, (error: unknown) =>
      respond({
        ok: false,
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
