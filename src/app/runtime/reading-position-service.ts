import { AutomaticPositionWriter, POSITION_MESSAGE, positionEpisode } from '@/entities/reader';
import { chromeStorage } from '@/shared/platform/storage';

export function installReadingPositionService() {
  const writer = new AutomaticPositionWriter(chromeStorage().local);
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
        !!episodeId &&
        url.pathname === `/viewer/${episodeId}` &&
        ((url.protocol === 'https:' &&
          ['novelpia.com', 'www.novelpia.com'].includes(url.hostname)) ||
          (import.meta.env.MODE === 'e2e' && url.hostname === '127.0.0.1'));
    } catch {
      /* An invalid sender has no reading position to save. */
    }
    if (!allowed) {
      respond({ ok: false });
      return;
    }
    void writer.write(position, 'progress' in message ? message.progress : undefined).then(
      (completed) => respond({ ok: true, completed }),
      () => respond({ ok: false })
    );
    return true;
  });
}
