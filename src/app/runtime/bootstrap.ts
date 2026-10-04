import { STARTUP_KEY, startupTheme, type StartupTheme } from '@/shared/platform/startup';
import { chromeStorage } from '@/shared/platform/storage';
import { readingSurfacePalette } from '@/shared/config/reading-surface-palette';
import { animateBook } from '@/shared/lib/loading-motion';
import { initialReadingLines, revealReading } from './reading-reveal';

export interface ViewerPreparation {
  claim(theme: StartupTheme): void;
  handoffPaint(): void;
  reveal(animate?: boolean): void | Promise<void>;
  dispose(): void;
  readonly revealed: boolean;
}

/** Protect fiction and its paper while their final geometry is being prepared. */
export function prepareViewer(): ViewerPreparation {
  const sheet = document.createElement('style');
  sheet.id = 'unp-first-layout';
  const guard = `${initialReadingLines},#unp-navigation-host{visibility:hidden!important}
    :is(#novel_text,#novel_drawing,#novel_drawing_page,#novel_drawing_page_c){background-color:transparent!important;background-image:none!important}`;
  let stopped = false;
  let claimed = false;
  let handedOff = false;
  let theme: StartupTheme | null = null;
  let loader: HTMLElement | undefined;
  let loaderMotion: ReturnType<typeof animateBook> | undefined;
  let revealMotion: ReturnType<typeof revealReading> | undefined;
  let alphaRoot: HTMLElement | undefined;
  let previousAlpha = '';
  let previousAlphaPriority = '';
  let loaderDue = false;
  let emptyTimer: ReturnType<typeof setTimeout> | undefined;
  const failureTimer = window.setTimeout(cleanup, 2500);
  const showTimer = window.setTimeout(() => {
    loaderDue = true;
    sync();
  }, 150);
  const paint = () => {
    let colors = '';
    if (theme && !handedOff) {
      colors = `#novel_box{background-color:${theme.backgroundColor}!important}`;
      const surface = readingSurfacePalette(theme);
      if (surface)
        colors += `#load_bar>div{color:${surface.ink}!important;background-color:${surface.paper}!important;background-image:none!important;border-color:${surface.border}!important}`;
    }
    sheet.textContent = `${colors}\n${guard}`;
  };
  function sync() {
    if (stopped) return;
    const root = document.documentElement;
    if (root && !alphaRoot) {
      alphaRoot = root;
      previousAlpha = root.style.getPropertyValue('--unp-initial-alpha');
      previousAlphaPriority = root.style.getPropertyPriority('--unp-initial-alpha');
      root.style.setProperty('--unp-initial-alpha', '0');
    }
    if (root && !sheet.isConnected) root.append(sheet);
    if (root && !root.hasAttribute('data-unp-preparing')) root.dataset.unpPreparing = '';
    const nativeLoader = document.getElementById('load_bar');
    const nativeStyle = nativeLoader && getComputedStyle(nativeLoader);
    const nativeVisible = !!(
      nativeLoader?.getClientRects().length &&
      nativeStyle?.display !== 'none' &&
      nativeStyle?.visibility !== 'hidden' &&
      nativeStyle?.opacity !== '0'
    );
    // A live native request may take longer than our boot watchdog. Once that
    // request stops advertising progress, a missing/invalid reader must fail open.
    if (claimed && !handedOff && !nativeVisible && document.readyState !== 'loading')
      emptyTimer ??= setTimeout(cleanup, 2500);
    else {
      clearTimeout(emptyTimer);
      emptyTimer = undefined;
    }
    const text = document.getElementById('novel_text');
    if (!loaderDue || nativeVisible || !text) {
      loaderMotion?.cancel();
      loader?.remove();
      return;
    }
    if (!loader) {
      loader = document.createElement('span');
      loader.id = 'unp-reader-loading';
      loader.setAttribute('role', 'status');
      loader.setAttribute('aria-label', '본문 준비 중');
      loader.style.cssText =
        'position:fixed;top:100px;left:50%;transform:translateX(-50%);pointer-events:none;z-index:2;color:#8463f5;padding:12px';
      loader.innerHTML =
        '<svg width="28" height="24" viewBox="0 0 28 24" aria-hidden="true"><path d="M14 5C10 2 5 2 2 4v16c4-2 8-2 12 1 4-3 8-3 12-1V4c-4-2-8-2-12 1Zm0 0v16" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
    }
    if (!loader.isConnected) {
      text.append(loader);
      loaderMotion = animateBook(loader.querySelector('svg')!);
    }
  }
  const observer = new MutationObserver(sync);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  });
  paint();
  sync();
  document.addEventListener('DOMContentLoaded', sync);
  void chromeStorage()
    .local.get(STARTUP_KEY)
    .then((raw) => {
      if (stopped || claimed) return;
      theme = startupTheme(raw[STARTUP_KEY]);
      if (theme && !theme.enabled) return cleanup();
      paint();
      sync();
    })
    .catch(() => {
      if (!claimed) cleanup();
    });
  function cleanup() {
    if (stopped) return;
    stopped = true;
    clearTimeout(failureTimer);
    clearTimeout(showTimer);
    clearTimeout(emptyTimer);
    document.removeEventListener('DOMContentLoaded', sync);
    observer.disconnect();
    sheet.remove();
    loaderMotion?.cancel();
    loader?.remove();
    if (previousAlpha)
      alphaRoot?.style.setProperty('--unp-initial-alpha', previousAlpha, previousAlphaPriority);
    else alphaRoot?.style.removeProperty('--unp-initial-alpha');
    document.documentElement?.removeAttribute('data-unp-preparing');
  }
  return {
    get revealed() {
      return stopped;
    },
    claim(value) {
      if (stopped) return;
      claimed = true;
      clearTimeout(failureTimer);
      theme = value;
      if (!theme.enabled) return cleanup();
      paint();
      sync();
    },
    handoffPaint() {
      if (stopped || handedOff) return;
      handedOff = true;
      clearTimeout(emptyTimer);
      emptyTimer = undefined;
      paint();
    },
    reveal(animate = false) {
      if (stopped) return revealMotion?.finished;
      cleanup();
      if (animate) {
        revealMotion = revealReading();
        return revealMotion.finished;
      }
    },
    dispose() {
      cleanup();
      revealMotion?.cancel();
    },
  };
}
