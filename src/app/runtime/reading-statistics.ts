import { ReadingStatsClient, ReadingStatsTracker } from '@/entities/reading-stats';
import { inputIsBusy, type ReaderEngine } from '@/entities/reader';
import type { StoragePort } from '@/shared/platform/storage';

/** Observe reading activity without coupling aggregation to page layout or React. */
export function trackReadingStatistics(
  storage: StoragePort,
  getReader: () => ReaderEngine | null,
  isEnabled: () => boolean
) {
  let stopped = false;
  let suspended = false;
  const client = new ReadingStatsClient(storage);
  const tracker = new ReadingStatsTracker(client, () => {
    const reader = getReader();
    const roots = reader?.roots;
    const frame = reader?.getSnapshot().readingFrame;
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        !!element.getClientRects().length &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    };
    const blocked = [
      ...document.querySelectorAll(
        '#theme_box,#comment_box,#list_box,.modal.show,.basic-modal-background,.banner-modal-background,[role="dialog"]'
      ),
    ].some(visible);
    return {
      ready:
        !stopped &&
        !suspended &&
        isEnabled() &&
        reader?.getSnapshot().presentationReady === true &&
        !!frame &&
        !!roots?.body.querySelector('[data-unp-line]') &&
        visible(roots.body),
      episodeId: roots?.episodeId ?? '',
      visible: !document.hidden && !suspended,
      focused: document.hasFocus(),
      blocked,
      incognito: chrome.extension?.inIncognitoContext === true,
    };
  });
  const refresh = () => tracker.refresh();
  const focus = () => tracker.activity();
  const activity = (event: Event) => {
    if (!event.isTrusted || !isEnabled()) return;
    if (event instanceof KeyboardEvent) {
      if (
        ![
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'PageUp',
          'PageDown',
          'Home',
          'End',
          ' ',
        ].includes(event.key) ||
        inputIsBusy(event)
      )
        return;
    } else {
      const roots = getReader()?.roots;
      const path = event.composedPath();
      const reading = roots && path.includes(roots.box);
      const navigation = path.some(
        (target) => target instanceof HTMLElement && target.id === 'unp-navigation-host'
      );
      if ((!reading && !navigation) || (reading && inputIsBusy(event))) return;
    }
    tracker.activity();
  };
  const hide = () => {
    suspended = true;
    tracker.refresh();
    void tracker.flush();
  };
  const show = () => {
    suspended = false;
    tracker.activity();
  };
  window.addEventListener('focus', focus);
  window.addEventListener('blur', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  for (const event of ['wheel', 'pointerdown', 'touchmove', 'keydown'])
    window.addEventListener(event, activity, { capture: true, passive: true });
  void client
    .initialize()
    .then(() => {
      if (!stopped) tracker.start();
    })
    .catch(() => {});
  return () => {
    if (stopped) return;
    tracker.dispose();
    stopped = true;
    client.dispose();
    window.removeEventListener('focus', focus);
    window.removeEventListener('blur', refresh);
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
    for (const event of ['wheel', 'pointerdown', 'touchmove', 'keydown'])
      window.removeEventListener(event, activity, true);
  };
}
