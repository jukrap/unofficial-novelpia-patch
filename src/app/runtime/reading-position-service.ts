import { AutomaticPositionWriter, POSITION_MESSAGE, positionEpisode } from '@/entities/reader';
import { chromeStorage } from '@/shared/platform/storage';

export function installReadingPositionService(storage = chromeStorage().local) {
  const writer = new AutomaticPositionWriter(storage);
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== POSITION_MESSAGE
    )
      return;
    const position = 'anchor' in message ? message.anchor : null;
    const episodeId = positionEpisode(position);
    let allowed = false;
    try {
      const url = new URL(sender.url ?? '');
      allowed =
        sender.id === chrome.runtime.id &&
        (sender.frameId === undefined || sender.frameId === 0) &&
        !!episodeId &&
        // Native episode links can end with a slash; query/hash never identify
        // a different episode. Keep the path and message episode strictly bound.
        /^\/viewer\/(\d+)\/?$/.exec(url.pathname)?.[1] === episodeId &&
        ((url.protocol === 'https:' &&
          ['novelpia.com', 'www.novelpia.com'].includes(url.hostname)) ||
          (import.meta.env.MODE === 'e2e' && url.hostname === '127.0.0.1'));
    } catch {
      /* An invalid sender has no reading position to save. */
    }
    if (!allowed) {
      respond({
        ok: false,
        error: '현재 회차 주소를 확인하지 못했습니다. 뷰어를 새로고침해 주세요.',
      });
      return;
    }
    void writer.write(position, 'progress' in message ? message.progress : undefined).then(
      (completed) => respond({ ok: true, completed }),
      (error: unknown) =>
        respond({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : '읽던 위치를 저장하지 못했습니다. 다시 시도해 주세요.',
        })
    );
    return true;
  });
}
