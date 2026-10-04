import { chromeStorage, type StoragePort } from '@/shared/platform/storage';
import { ReadingStatsService } from '../model/service';
import { STATS_CHANNEL } from '../model/types';

function originOf(sender: chrome.runtime.MessageSender): 'extension' | 'reader' | null {
  if (sender.id !== chrome.runtime.id || !sender.url || sender.tab?.incognito) return null;
  try {
    const url = new URL(sender.url);
    if (url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id)
      return 'extension';
    if (sender.frameId !== undefined && sender.frameId !== 0) return null;
    if (
      url.protocol === 'https:' &&
      ['novelpia.com', 'www.novelpia.com'].includes(url.hostname) &&
      /^\/viewer\/\d+\/?$/.test(url.pathname)
    )
      return 'reader';
    if (import.meta.env.MODE === 'e2e' && url.hostname === '127.0.0.1') return 'reader';
  } catch {
    /* Ignore unrelated callers. */
  }
  return null;
}

export function installReadingStatsService(storage: StoragePort = chromeStorage()): () => void {
  const service = new ReadingStatsService(storage);
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (response: unknown) => void
  ) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as Record<string, unknown>).channel !== STATS_CHANNEL
    )
      return;
    const origin = originOf(sender);
    const command = message as Record<string, unknown>;
    if (!origin || (origin === 'reader' && !['read', 'report'].includes(String(command.action)))) {
      reply({ ok: false, error: '이 화면에서 통계를 변경할 수 없습니다.' });
      return;
    }
    void service.execute(command).then(
      (snapshot) => reply({ ok: true, snapshot }),
      (cause: unknown) =>
        reply({
          ok: false,
          error: cause instanceof Error ? cause.message : '통계를 처리하지 못했습니다.',
        })
    );
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
