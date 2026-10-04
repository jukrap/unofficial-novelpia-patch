import { PageFlip } from 'page-flip/dist/js/page-flip.module.js';
import type { PageSnapshot } from './page-snapshot';

export function playPaperEffect(
  host: HTMLElement,
  from: PageSnapshot,
  to: PageSnapshot,
  direction: 1 | -1,
  folded: boolean,
  complete: () => void
): () => void {
  const width = from.view.width / from.columns;
  const book = document.createElement('div');
  book.style.cssText = `position:absolute;inset:0;width:${from.view.width}px;height:${from.view.height}px;pointer-events:none;margin:0;padding:0;border:0;`;
  const layout = document.createElement('style');
  // Upstream uses auto/static offsets and its wrapper CSS selector is misspelled.
  // Fix both wrappers at the captured origin before PageFlip measures its bounds.
  layout.textContent =
    '[data-unp-page-effect] :is(.stf__wrapper,.stf__block){position:absolute!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;box-sizing:border-box!important}';
  host.append(layout);
  host.append(book);
  const ordered = direction === 1 ? [from, to] : [to, from];
  const pages = ordered.flatMap((snapshot) =>
    snapshot.pages.map((content, column) => {
      const page = document.createElement('div');
      page.dataset.density = folded ? 'soft' : 'hard';
      if (column === 1) content.style.left = `${snapshot.gap / 2}px`;
      page.append(content);
      return page;
    })
  );
  const flip = new PageFlip(book, {
    width,
    height: from.view.height,
    size: 'fixed',
    startPage: direction === 1 ? 0 : from.columns,
    usePortrait: from.columns === 1,
    autoSize: false,
    showCover: false,
    drawShadow: true,
    maxShadowOpacity: folded ? 0.28 : 0.2,
    flippingTime: folded ? 460 : 360,
    useMouseEvents: false,
    clickEventForward: false,
    showPageCorners: false,
    disableFlipByClick: true,
    mobileScrollSupport: false,
  });
  let disposed = false;
  let started = false;
  let frame = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    clearTimeout(deadline);
    flip.off('init');
    flip.off('changeState');
    flip.destroy();
  };
  flip.on('init', () => {
    if (disposed) return;
    frame = requestAnimationFrame(() => {
      if (disposed) return;
      started = true;
      if (direction === 1) flip.flipNext('bottom');
      else flip.flipPrev('bottom');
    });
  });
  flip.on('changeState', ({ data }) => {
    if (started && data === 'read') {
      // The library dispatches this event from inside its render frame.
      frame = requestAnimationFrame(() => complete());
    }
  });
  try {
    flip.loadFromHTML(pages);
    deadline = setTimeout(complete, 700);
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}
