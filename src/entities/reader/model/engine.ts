import type { Settings } from '@/shared/model/preferences';
import type { NativeClient } from '@/shared/platform/native';
import { emphasisHighlight, emphasisShadow } from '@/shared/config/emphasis';
import { captureAnchor, rangeForAnchor, type ReadingAnchor } from './anchor';
import { pageGeometry, countPages, COLUMN_GAP, type Geometry } from '../lib/geometry';
import { fontFamily, FontLoader, effectiveWeight, authorWeight } from '../lib/fonts';
import { StyleLedger } from '../lib/ledger';
import { readingBlocks, inputIsBusy, protectedSelector, type ReaderRoots } from '../lib/site';
import { readingGestureIntent, readingKeyIntent, ResumeSession } from './resume';
import { PageEffects, shouldAnimatePageTurn } from '../ui/page-effects';
import { capturePageSnapshot, containsPageService, containsPageCover } from '../ui/page-snapshot';
import { ReaderBackground, type ReaderBackgroundStatus } from '../ui/background-layer';
import { ReadingViewport, readingViewport, frameOf, type ReaderFrame } from '../ui/viewport';

export interface ReaderState {
  mode: 'scroll' | 'page';
  page: number;
  pages: number;
  columns: 1 | 2;
  progress: number;
  scrollRange: number;
  serviceInset: number;
  error: string;
  fontStatus: string;
  fontLoadState: 'idle' | 'loading' | 'ready' | 'error';
  presentationReady: boolean;
  backgroundStatus: ReaderBackgroundStatus;
  backgroundError: string;
  readingFrame: ReaderFrame | null;
  viewportFrame: ReaderFrame | null;
}
// Native option callbacks can replace a body's lines between animation frames.
// Already-owned reading roots keep their palette and typography for those new
// lines immediately; protected service content is never matched by this fallback.
const readingLine = `:is([data-unp-line],[data-unp-reader]>.line[data-line]:not(${protectedSelector}):not(:has(${protectedSelector})))`;
const emphasisSelector = `:is(${readingLine}:is(b,strong,[data-unp-emphasis]),${readingLine} :is(b,strong,[data-unp-emphasis]))`;
const css = `
${readingLine} { display:block !important; font-family:var(--unp-font) !important;font-size:var(--unp-size) !important;font-weight:var(--unp-weight) !important;line-height:var(--unp-line-height) !important;letter-spacing:var(--unp-letter) !important;word-break:var(--unp-word) !important;overflow-wrap:anywhere;color:var(--unp-color) !important;margin:0 !important;min-height:0; }
[data-unp-line]+br{display:none !important}
${readingLine}[data-unp-empty]{height:1px !important;margin-bottom:var(--unp-paragraph) !important;min-height:0 !important;line-height:0 !important}
[data-unp-paragraph]{padding-bottom:var(--unp-paragraph-gap) !important}
[data-unp-line] img{max-width:100%;object-fit:contain}
[data-unp-reader="page"] [data-unp-line] img{max-height:var(--unp-page-height)}
${emphasisSelector}{font-weight:var(--unp-author-weight) !important}
[data-unp-bold="shadow"] ${emphasisSelector}{text-shadow:var(--unp-bold-shadow)}
[data-unp-bold="highlight"] ${emphasisSelector}{background:var(--unp-bold-highlight);border-radius:3px;box-decoration-break:clone}
[data-unp-bold="border"] ${emphasisSelector}{border-block:2px solid currentColor;box-decoration-break:clone}
[data-unp-transition] [data-unp-line]{opacity:0 !important}
`;
const rgba = (hex: string, opacity: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${opacity / 100})`;
export class ReaderEngine {
  private ledger = new StyleLedger();
  private fonts: FontLoader;
  private ownsFonts: boolean;
  private sheet = document.createElement('style');
  private extent = document.createElement('span');
  private sentinel = document.createElement('span');
  private blocks: HTMLElement[] = [];
  private emphasis = new Set<HTMLElement>();
  private effects = new PageEffects();
  private nativeAnimation = true;
  private background: ReaderBackground;
  private viewport: ReadingViewport;
  private resize: ResizeObserver;
  private mutations: MutationObserver;
  private frame = 0;
  private disposed = false;
  private geometry: Geometry | null = null;
  private state: ReaderState;
  private settings: Settings;
  private anchor: ReadingAnchor | null = null;
  private initialAnchor: ReadingAnchor | null = null;
  private initialPage: number | null = null;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private fontKey = '';
  private fontText = '';
  private syncing = false;
  private needsSync = false;
  private bottomInset = 64;
  private serviceInset = 0;
  private serviceRegion: HTMLElement | null = null;
  private serviceFlowSize = '';
  private serviceResize = new ResizeObserver(() => this.measureServiceRegion());
  private preserveEnd = false;
  private endIntent = false;
  private resume = new ResumeSession();
  private originalTextPadding: number;
  constructor(
    readonly roots: ReaderRoots,
    settings: Settings,
    private native: NativeClient,
    private saveAnchor: (anchor: ReadingAnchor) => void,
    resources?: { fonts: FontLoader }
  ) {
    this.fonts = resources?.fonts ?? new FontLoader();
    this.ownsFonts = !resources;
    this.settings = settings;
    this.originalTextPadding = parseFloat(getComputedStyle(roots.text).paddingBottom) || 0;
    this.state = {
      mode: roots.mode,
      page: 1,
      pages: 1,
      columns: 1,
      progress: 0,
      scrollRange: 0,
      serviceInset: 0,
      error: '',
      fontStatus: '',
      fontLoadState: 'idle',
      presentationReady: false,
      backgroundStatus: 'idle',
      backgroundError: '',
      readingFrame: null,
      viewportFrame: null,
    };
    this.viewport = new ReadingViewport(roots.box);
    this.background = new ReaderBackground(
      roots.box,
      settings,
      (backgroundStatus, backgroundError) => this.publish({ backgroundStatus, backgroundError })
    );
    this.sheet.textContent = css;
    this.sheet.dataset.unpReaderStyle = '';
    document.head.append(this.sheet);
    for (const el of [this.extent, this.sentinel]) {
      el.dataset.unpMeasure = '';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText =
        'position:absolute;width:1px;height:1px;pointer-events:none;opacity:0;top:0';
    }
    this.extent.dataset.unpExtent = '';
    this.resize = new ResizeObserver(() => {
      this.viewport.changed();
      this.cancelTransitions();
      this.schedule();
    });
    this.resize.observe(roots.box);
    this.mutations = new MutationObserver((records) => {
      if (
        records.some(
          (r) =>
            r.type === 'characterData' ||
            [...r.addedNodes, ...r.removedNodes].some(
              (n) => !(n instanceof HTMLElement && n.hasAttribute('data-unp-measure'))
            )
        )
      ) {
        this.cancelTransitions();
        this.schedule();
      }
    });
    this.mutations.observe(roots.body, { childList: true, subtree: true, characterData: true });
    roots.box.addEventListener('scroll', this.onScroll, { passive: true });
    roots.pageContainer?.addEventListener('scroll', this.onScroll, { passive: true });
    roots.body.addEventListener('load', this.onLoad, true);
    document.fonts?.addEventListener('loadingdone', this.onLoad);
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('click', this.onClick, true);
    window.addEventListener('resize', this.onLoad);
    window.addEventListener('wheel', this.onGesture, { passive: true, capture: true });
    window.addEventListener('pointerdown', this.onGesture, { passive: true, capture: true });
    window.addEventListener('touchstart', this.onGesture, { passive: true, capture: true });
    this.schedule();
  }
  getSnapshot = () => this.state;
  present() {
    if (!this.state.presentationReady) this.publish({ presentationReady: true });
  }
  setAnimation(enabled: boolean) {
    // Native callbacks remain supported; settings.pageEffect owns the selected effect.
    if (!enabled && this.nativeAnimation !== enabled) this.cancelTransitions();
    this.nativeAnimation = enabled;
  }
  setBottomInset(inset: number) {
    const next = Math.max(64, Math.ceil(inset));
    if (next !== this.bottomInset) {
      this.cancelTransitions();
      this.bottomInset = next;
      this.schedule();
    }
  }
  private onGesture = (event: Event) => {
    if (!readingGestureIntent(event, this.roots, this.serviceRegion)) return;
    this.initialAnchor = null;
    this.initialPage = null;
    this.endIntent = false;
    this.resume.userIntent();
    // The site's fixed recommendation is a sibling of the scroll viewport. A vertical
    // wheel over it otherwise cannot reach the reader. Preserve its clicks/horizontal scroll.
    if (
      this.roots.mode === 'scroll' &&
      event instanceof WheelEvent &&
      event.deltaY < 0 &&
      Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
      event.target instanceof Element &&
      this.serviceRegion?.contains(event.target) &&
      !this.roots.box.contains(event.target)
    ) {
      let target: Element | null = event.target;
      while (target && target !== this.serviceRegion) {
        if (
          /auto|scroll/.test(getComputedStyle(target).overflowY) &&
          target.scrollHeight > target.clientHeight &&
          target.scrollTop > 0
        )
          return;
        target = target.parentElement;
      }
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? this.roots.box.clientHeight
            : 1;
      this.roots.box.scrollBy({ top: event.deltaY * unit, behavior: 'instant' });
    }
  };
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(patch: Partial<ReaderState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  getAnchor() {
    // A non-text page has no persistable text anchor. In particular, do not save
    // text from a native callback that is about to be corrected back to its page.
    if (this.initialPage !== null) return null;
    return this.initialAnchor ?? captureAnchor(this.roots) ?? this.anchor;
  }
  getResumeAnchor() {
    return this.resume.canSave ? this.getAnchor() : null;
  }
  restore(anchor: ReadingAnchor | null, explicit = false) {
    if (anchor?.episodeId === this.roots.episodeId) {
      this.cancelTransitions();
      if (explicit) this.resume.userIntent();
      this.endIntent = false;
      this.initialAnchor = anchor;
      this.initialPage = null;
      this.anchor = anchor;
      this.schedule();
      if (explicit) this.persistSoon();
    }
  }
  beginResume() {
    this.cancelTransitions();
    clearTimeout(this.saveTimer);
    this.initialAnchor = null;
    this.initialPage = null;
    this.endIntent = false;
    this.preserveEnd = false;
    return this.resume.begin();
  }
  completeResume(ticket: number, anchor: ReadingAnchor | null, readSucceeded = true) {
    if (this.disposed) return;
    const result = this.resume.complete(ticket, anchor, readSucceeded);
    if (!result) return;
    if (result.anchor) this.restore(result.anchor);
    else if (result.saveCurrent) this.persistSoon();
  }
  flushPosition() {
    clearTimeout(this.saveTimer);
    const anchor = this.getResumeAnchor();
    if (anchor) this.saveAnchor(anchor);
  }
  refreshServiceRegion() {
    const region = document.querySelector<HTMLElement>('.curation-wrapper');
    if (region === this.serviceRegion) return;
    this.serviceResize.disconnect();
    this.serviceRegion = region;
    this.serviceFlowSize = '';
    if (region) this.serviceResize.observe(region);
    this.measureServiceRegion();
  }
  private measureServiceRegion() {
    if (!this.serviceRegion || this.disposed) return;
    const rect = this.serviceRegion.getBoundingClientRect();
    const position = getComputedStyle(this.serviceRegion).position;
    // An in-flow recommendation can appear at the old end and push following
    // content into another column. Recount on its size/visibility change too,
    // without changing the site's display condition or adding a fixed inset.
    if (position === 'static' || position === 'relative') {
      if (!this.roots.body.contains(this.serviceRegion)) return;
      const size = `${rect.width}/${rect.height}`;
      if (size === this.serviceFlowSize) return;
      this.serviceFlowSize = size;
      this.pendingServiceLayout = true;
      if (!this.effects.afterCurrent(this.finishServiceLayout)) this.schedule();
      return;
    }
    if (!rect.height || position !== 'fixed') return;
    const box = this.roots.box;
    const frame = this.state.viewportFrame;
    const fullBottom = frame ? frame.top + frame.height : box.getBoundingClientRect().bottom;
    const needed = Math.max(0, Math.ceil(fullBottom - rect.top + 12));
    // Keep the reservation while hidden, but follow a visible recommendation's
    // responsive size in both directions. Retaining its mobile height after a
    // desktop resize would permanently shrink the available reading viewport.
    if (needed === this.serviceInset) return;
    this.preserveEnd =
      this.roots.mode === 'page'
        ? this.state.page + this.state.columns > this.state.pages
        : box.scrollHeight - box.clientHeight - box.scrollTop <= 110;
    this.serviceInset = needed;
    this.pendingServiceLayout = true;
    this.endIntent ||= this.preserveEnd;
    this.publish({ serviceInset: needed });
    // A newly shown fixed recommendation can shrink the paper. Its service hole
    // is immediate, but keep the current snapshot and paper geometry in agreement
    // until the turn finishes (or is cancelled by a new user action).
    if (!this.effects.afterCurrent(this.finishServiceLayout)) this.schedule();
  }
  private pendingServiceLayout = false;
  private finishServiceLayout = () => {
    this.pendingServiceLayout = false;
    this.layout();
  };
  private cancelTransitions() {
    this.effects.cancel();
  }
  update(settings: Settings) {
    this.cancelTransitions();
    this.anchor = this.getAnchor();
    this.settings = settings;
    this.schedule();
  }
  retryFont = () => {
    if (this.disposed) return;
    this.fontKey = '';
    // Native lists can hide the reading viewport while the themebox stays open.
    // Font recovery must not depend on the next measurable reader layout.
    this.loadFont();
  };
  private fontRequest = 0;
  private loadFont() {
    const s = this.settings;
    const key = `${s.fontFamily}/${effectiveWeight(s)}/${authorWeight(s)}/${s.fontSize}/${this.fontText}`;
    if (this.fontKey === key) return;
    this.fontKey = key;
    const request = ++this.fontRequest;
    this.publish({
      fontStatus: '글꼴 확인 중…',
      fontLoadState: this.fonts.isReadingReady(s, this.fontText) ? 'ready' : 'loading',
    });
    void this.fonts.loadReading(s, this.fontText).then(
      () => {
        if (!this.disposed && this.fontKey === key && request === this.fontRequest) {
          this.publish({ fontStatus: '글꼴 적용됨', fontLoadState: 'ready' });
          this.schedule();
        }
      },
      (error: unknown) => {
        if (!this.disposed && this.fontKey === key && request === this.fontRequest)
          this.publish({ fontStatus: String(error), fontLoadState: 'error' });
      }
    );
  }
  private onLoad = (event?: Event) => {
    if (event?.type === 'resize') this.viewport.invalidate();
    this.cancelTransitions();
    this.schedule();
  };
  private schedule() {
    if (!this.disposed && !this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.layout();
      });
  }
  private layout() {
    if (this.disposed) return;
    if (this.effects.isLive && this.effects.afterCurrent(this.finishServiceLayout)) return;
    if (this.pendingServiceLayout && this.effects.afterCurrent(this.finishServiceLayout)) return;
    this.pendingServiceLayout = false;
    const { box, text, body, pageContainer, mode } = this.roots;
    // Native lists/comments hide the reader. Do not revive it or lay it out at zero size.
    if (!box.getClientRects().length || getComputedStyle(box).display === 'none') {
      this.viewport.invalidate();
      if (this.state.readingFrame) this.publish({ readingFrame: null });
      return;
    }
    const s = this.settings;
    this.blocks = readingBlocks(body);
    if (!this.blocks.length) return;
    // FontFaceSet uses this local character set to select unicode-range subsets.
    // It is never persisted or sent as a request payload.
    this.fontText = [...new Set(this.blocks.map((block) => block.textContent ?? '').join(''))]
      .sort()
      .join('');
    this.loadFont();
    const atStart = (mode === 'page' ? (pageContainer?.scrollLeft ?? 0) : box.scrollTop) <= 1;
    const previous =
      this.initialPage !== null ? null : (this.initialAnchor ?? (atStart ? null : this.anchor));
    this.preserveEnd ||= this.endIntent;
    try {
      if (mode === 'page') {
        // Only the column viewport moves in page mode. Native overflow:scroll on
        // the outer box otherwise adds a second scrollbar and fractional panning.
        // Apply before measuring so classic scrollbars cannot change the page width.
        this.ledger.set(box, 'overflow-x', 'clip');
        this.ledger.set(box, 'overflow-y', 'clip');
        // Layout containment keeps margins inside without owning display: the
        // site's list/comment routes must be able to hide this viewport normally.
        this.ledger.set(box, 'contain', 'layout');
        box.scrollLeft = box.scrollTop = 0;
      } else {
        this.ledger.set(box, 'overflow-x', 'hidden');
        box.scrollLeft = 0;
      }
      this.viewport.changed();
      const fullHeight = this.viewport.measure();
      const reading = readingViewport(
        fullHeight,
        s.readerHeightPercent,
        this.bottomInset,
        this.serviceInset,
        s.pageNavigationPlacement === 'overlay',
        mode
      );
      if (mode === 'scroll') {
        this.viewport.applyScroll(reading.top, reading.height);
        box.dataset.unpViewport = '';
      }
      const availableWidth = Math.max(0, box.clientWidth - 40);
      const availableHeight = reading.height;
      const geometry =
        mode === 'page'
          ? pageGeometry(
              availableWidth,
              availableHeight,
              s.maxWidth,
              s.horizontalPadding,
              s.verticalPadding,
              s.fontSize,
              s.lineHeight,
              s.spreadMode,
              s.pageGap
            )
          : null;
      body.dataset.unpReader = mode;
      body.dataset.unpBold = s.enhanceBoldTextStyle;
      const properties: Record<string, string> = {
        // Do not let an external @font-face block glyph paint past our reveal deadline.
        '--unp-font': fontFamily(this.state.fontLoadState === 'ready' ? s.fontFamily : 'system-ui'),
        '--unp-size': `${s.fontSize}px`,
        '--unp-weight': String(effectiveWeight(s)),
        '--unp-author-weight': String(authorWeight(s)),
        '--unp-line-height': String(s.lineHeight / 100),
        '--unp-letter': `${s.letterSpacing}px`,
        '--unp-word': s.wordBreakMode,
        '--unp-color': s.textColor,
        '--unp-paragraph': `${s.paragraphSpacing}px`,
        '--unp-paragraph-gap': `${s.paragraphGap}px`,
        '--unp-bold-shadow': emphasisShadow(s.darkMode),
        '--unp-bold-highlight': emphasisHighlight(s.textColor),
      };
      for (const [key, value] of Object.entries(properties)) this.ledger.set(body, key, value);
      this.blocks.forEach((block, index) => {
        block.dataset.unpLine = '';
        block.toggleAttribute(
          'data-unp-paragraph',
          index < this.blocks.length - 1 && !!block.textContent?.replace(/\s|\u00a0/g, '')
        );
        block.toggleAttribute(
          'data-unp-empty',
          !block.textContent?.replace(/\s|\u00a0/g, '') &&
            !block.querySelector('img,svg,video,table')
        );
        for (const el of [
          block,
          ...block.querySelectorAll<HTMLElement>('[style],[data-unp-emphasis]'),
        ]) {
          const weight = el.style.fontWeight;
          // An inline !important weight may be our own override. Preserve its
          // marker, but remove stale emphasis when the site edits the same node.
          if (weight === 'var(--unp-author-weight)' && this.emphasis.has(el)) continue;
          if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) {
            el.dataset.unpEmphasis = '';
            this.emphasis.add(el);
            if (el.style.getPropertyPriority('font-weight') === 'important')
              this.ledger.set(el, 'font-weight', 'var(--unp-author-weight)');
          } else if (this.emphasis.delete(el)) {
            delete el.dataset.unpEmphasis;
          }
        }
      });
      this.ledger.set(box, 'background-color', `var(--unp-background-color,${s.backgroundColor})`);
      this.ledger.set(box, 'background-image', 'none');
      this.ledger.set(box, 'isolation', 'isolate');
      this.background.update(s, this.viewport.getBackgroundFrame());
      if (geometry) this.effects.warm(s.pageEffect);
      const paper = rgba(s.textAreaBackgroundColor, s.textAreaOpacity);
      this.ledger.set(body, 'background-color', 'transparent');
      this.ledger.set(text, 'box-sizing', 'border-box');
      // A short scroll chapter still has a full-height paper, without inserting
      // blank space between its text and the native afterword/footer controls.
      this.ledger.set(text, 'background-color', geometry ? 'transparent' : paper);
      this.ledger.set(text, 'min-height', geometry ? '0px' : `${reading.height}px`);
      this.ledger.set(
        text,
        'max-width',
        `${geometry?.outerWidth ?? Math.min(s.maxWidth, availableWidth)}px`
      );
      this.ledger.set(text, 'width', '100%');
      this.ledger.set(text, 'margin-inline', 'auto');
      if (geometry && pageContainer) {
        this.geometry = geometry;
        // Paint the stationary paper, including its insets. The multicolumn body scrolls
        // horizontally and its own background would cover only the first spread.
        const paperWidth = (geometry.outerWidth - geometry.pageGap) / 2;
        const parentStyles: Record<string, string> = {
          position: 'relative',
          'box-sizing': 'content-box',
          width: `${geometry.outerWidth}px`,
          'max-width': 'none',
          padding: '0',
          height: `${availableHeight}px`,
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          margin: `${reading.top}px auto 0`,
          'background-color': `var(--unp-transition-paper-color,${geometry.columns === 1 ? paper : 'transparent'})`,
          'background-image': `var(--unp-transition-paper-image,${
            geometry.columns === 2
              ? `linear-gradient(to right,${paper} 0 ${paperWidth}px,transparent ${paperWidth}px ${paperWidth + geometry.pageGap}px,${paper} ${paperWidth + geometry.pageGap}px 100%)`
              : 'none'
          })`,
          'background-attachment': 'scroll',
          'background-repeat': 'no-repeat',
          'background-size': '100% 100%',
          'background-position': '0 0',
        };
        for (const [key, value] of Object.entries(parentStyles))
          this.ledger.set(pageContainer, key, value);
        const bodyStyles: Record<string, string> = {
          width: `${geometry.outerWidth - 2 * s.horizontalPadding}px`,
          height: `${geometry.height}px`,
          'column-width': `${geometry.textWidth}px`,
          'column-count': String(geometry.columns),
          'column-gap': `${geometry.columnGap}px`,
          'column-fill': 'auto',
          padding: '0',
          margin: `${s.verticalPadding}px ${s.horizontalPadding}px`,
          position: 'static',
          '--unp-page-height': `${geometry.height}px`,
        };
        for (const [key, value] of Object.entries(bodyStyles)) this.ledger.set(body, key, value);
        this.sentinel.remove();
        this.extent.remove();
        const range = document.createRange();
        range.selectNodeContents(body);
        const rect = body.getBoundingClientRect();
        const pages = countPages(
          range.getClientRects(),
          rect.left,
          geometry.textWidth,
          geometry.columnGap
        );
        const spreads = Math.ceil(pages / geometry.columns);
        // Native page_cal hard-codes viewportWidth + 20. Its invisible marker
        // reports the logical total independently from the adjustable visual gap.
        this.sentinel.style.left = `${(spreads - 1) * (geometry.outerWidth + COLUMN_GAP) + 1}px`;
        body.append(this.sentinel);
        this.extent.style.left = `${spreads * geometry.spreadStride - geometry.pageGap - 1}px`;
        pageContainer.append(this.extent);
        this.publish({ pages, columns: geometry.columns, error: '' });
        if (this.preserveEnd) {
          pageContainer.scrollLeft = (spreads - 1) * geometry.spreadStride;
          this.initialAnchor = null;
          this.initialPage = null;
          this.updatePage();
        } else if (this.initialPage !== null) {
          const page = Math.min(this.initialPage, pages);
          pageContainer.scrollLeft =
            Math.floor((page - 1) / geometry.columns) * geometry.spreadStride;
          this.updatePage();
        } else if (previous) this.restoreNow(previous);
        else this.updatePage();
        void this.syncNative();
      } else {
        // Reserve space in the reading flow, not in the site's fixed recommendation layer.
        // Keep it after that layer hides so crossing the native end threshold cannot oscillate.
        this.ledger.set(body, 'padding', `${s.verticalPadding}px ${s.horizontalPadding}px`);
        this.ledger.set(body, 'box-sizing', 'border-box');
        this.ledger.set(text, 'padding-bottom', `${this.originalTextPadding}px`);
        if (this.serviceInset || s.pageNavigationPlacement === 'overlay') {
          const note = document.getElementById('writer_comments_box');
          const content = [...body.children, ...(note ? [note] : [])].filter(
            (el) =>
              el.tagName !== 'BR' &&
              !el.hasAttribute('data-unp-measure') &&
              (el.textContent?.trim() || el.querySelector('img,iframe,video')) &&
              el.getBoundingClientRect().height > 0 &&
              getComputedStyle(el).visibility !== 'hidden'
          );
          const end = Math.max(...content.map((el) => el.getBoundingClientRect().bottom));
          const naturalTail = Number.isFinite(end)
            ? Math.max(
                0,
                box.scrollHeight - (end - box.getBoundingClientRect().top + box.scrollTop)
              )
            : 0;
          const region = this.serviceRegion?.getBoundingClientRect();
          const overlap = region
            ? Math.max(0, box.getBoundingClientRect().bottom - region.top + 12)
            : 0;
          // The scroll viewport now ends above fixed service UI. Keep only a short
          // reachable tail; the old full-screen inset could exceed a 40% viewport.
          // Overlay controls keep the full viewport, but the final button/text
          // must still be scrollable above them. Add only the missing end tail.
          const overlayTail = s.pageNavigationPlacement === 'overlay' ? this.bottomInset : 0;
          const serviceTail = this.serviceInset ? overlap + Math.min(48, box.clientHeight / 4) : 0;
          const extra = Math.max(0, Math.max(overlayTail, serviceTail) - naturalTail);
          this.ledger.set(text, 'padding-bottom', `${this.originalTextPadding + extra}px`);
        }
        if (this.preserveEnd) {
          box.scrollTop = box.scrollHeight - box.clientHeight;
          this.initialAnchor = null;
        } else if (previous) this.restoreNow(previous);
        this.updateProgress();
        this.publish({ error: '' });
      }
      this.preserveEnd = false;
      const readingFrame = frameOf(
        (geometry && pageContainer ? pageContainer : box).getBoundingClientRect()
      );
      const viewportFrame = this.viewport.getFrame();
      if (
        JSON.stringify(readingFrame) !== JSON.stringify(this.state.readingFrame) ||
        JSON.stringify(viewportFrame) !== JSON.stringify(this.state.viewportFrame)
      )
        this.publish({ readingFrame, viewportFrame });
      // Initial attachment should preserve the site's cover/start position. Subsequent layouts use content anchors.
      this.anchor = this.getAnchor();
    } catch (error) {
      this.publish({ error: String(error) });
    }
  }
  private restoreNow(anchor: ReadingAnchor) {
    const range = rangeForAnchor(this.roots, anchor);
    const rect = range?.getClientRects()[0];
    if (!rect) return;
    if (this.geometry && this.roots.pageContainer) {
      const bodyRect = this.roots.body.getBoundingClientRect();
      const column = Math.max(
        0,
        Math.floor((rect.left - bodyRect.left + 0.5) / this.geometry.columnStride)
      );
      this.roots.pageContainer.scrollLeft =
        Math.floor(column / this.geometry.columns) * this.geometry.spreadStride;
      this.updatePage();
    } else {
      const view = this.roots.box.getBoundingClientRect();
      this.roots.box.scrollTop += rect.top - view.top - 1;
    }
  }
  private updatePage() {
    if (!this.geometry || !this.roots.pageContainer) return;
    const spread = Math.round(this.roots.pageContainer.scrollLeft / this.geometry.spreadStride);
    const page = Math.min(this.state.pages, spread * this.geometry.columns + 1);
    const count = Math.ceil(this.state.pages / this.geometry.columns);
    const progress = count > 1 ? spread / (count - 1) : 1;
    if (page !== this.state.page || progress !== this.state.progress)
      this.publish({ page, progress });
  }
  private updateProgress() {
    if (this.roots.mode === 'page') {
      this.updatePage();
      return;
    }
    const box = this.roots.box;
    const max = Math.max(0, box.scrollHeight - box.clientHeight);
    const progress = max ? Math.max(0, Math.min(1, box.scrollTop / max)) : 1;
    if (progress !== this.state.progress || max !== this.state.scrollRange)
      this.publish({ progress, scrollRange: max });
  }
  seek(progress: number) {
    this.resume.userIntent();
    if (this.roots.mode === 'page') {
      const count = Math.ceil(this.state.pages / this.state.columns);
      this.goTo(
        Math.round(Math.max(0, Math.min(1, progress)) * (count - 1)) * this.state.columns + 1,
        false
      );
      return;
    }
    this.initialAnchor = null;
    this.initialPage = null;
    this.endIntent = progress >= 1;
    const box = this.roots.box;
    box.scrollTo({
      top: Math.max(0, Math.min(1, progress)) * Math.max(0, box.scrollHeight - box.clientHeight),
      behavior: 'instant',
    });
    this.updateProgress();
    this.anchor = this.getAnchor();
    this.persistSoon();
  }
  restoreLegacyBookmark(position: number) {
    if (this.roots.mode === 'page') this.goTo((position - 1) * this.state.columns + 1, false);
    else {
      const box = this.roots.box;
      this.seek(
        ((position - 1) * box.clientHeight) / Math.max(1, box.scrollHeight - box.clientHeight)
      );
    }
  }
  private async syncNative() {
    if (!this.geometry || this.disposed) return;
    this.needsSync = true;
    if (this.syncing) return;
    this.syncing = true;
    try {
      while (this.needsSync && !this.disposed) {
        this.needsSync = false;
        await this.native.request({
          type: 'sync',
          page: Math.floor((this.state.page - 1) / this.geometry.columns) + 1,
          total: Math.ceil(this.state.pages / this.geometry.columns),
          stride: this.geometry.spreadStride,
        });
      }
    } catch (error) {
      if (!this.disposed) this.publish({ error: String(error) });
    } finally {
      this.syncing = false;
    }
  }
  goTo(page: number, animate = true) {
    this.resume.userIntent();
    this.initialAnchor = null;
    this.initialPage = null;
    if (!this.geometry || !this.roots.pageContainer) return;
    this.cancelTransitions();
    const container = this.roots.pageContainer;
    const previousSpread = Math.round(container.scrollLeft / this.geometry.spreadStride);
    const spread = Math.floor(
      (Math.max(1, Math.min(page, this.state.pages)) - 1) / this.geometry.columns
    );
    const lastSpread = Math.ceil(this.state.pages / this.geometry.columns) - 1;
    this.endIntent = spread === lastSpread;
    let shouldAnimate = shouldAnimatePageTurn(
      this.settings.pageEffect,
      previousSpread,
      spread,
      lastSpread,
      matchMedia('(prefers-reduced-motion: reduce)').matches,
      animate
    );
    shouldAnimate &&= !containsPageCover(container, container.getBoundingClientRect());
    const paper = rgba(this.settings.textAreaBackgroundColor, this.settings.textAreaOpacity);
    const backdrop = shouldAnimate ? this.background.snapshot() : undefined;
    const sourceService =
      shouldAnimate && containsPageService(container, container.getBoundingClientRect());
    const from =
      shouldAnimate && !sourceService
        ? capturePageSnapshot(container, this.blocks, this.geometry, paper, backdrop)
        : null;
    container.scrollTo({
      left: spread * this.geometry.spreadStride,
      behavior: 'instant',
    });
    // The collapsed cover button and expanded cover remain native, live elements.
    // Probe the actual destination too: an expanded cover can occupy several pages.
    shouldAnimate &&= !containsPageCover(container, container.getBoundingClientRect());
    const commit = () => {
      if (this.disposed) return;
      container.scrollLeft = spread * this.geometry!.spreadStride;
      this.updatePage();
      // A cover-only page has no text anchor. Reusing the previous page's anchor
      // would pull an explicit return to the cover back into the novel on scroll.
      this.anchor = captureAnchor(this.roots);
      this.initialAnchor = this.anchor;
      // Keep an explicit non-text page stable against delayed native restores.
      // This is session-only intent, released by the next reading gesture.
      this.initialPage = this.anchor ? null : this.state.page;
      void this.syncNative();
      this.persistSoon();
    };
    if (
      shouldAnimate &&
      (sourceService || containsPageService(container, container.getBoundingClientRect()))
    ) {
      // Probe the destination synchronously, then put the original DOM back before
      // the browser paints or native scroll callbacks run. The live turn commits
      // the real page at its midpoint so service content cannot arrive early.
      container.scrollLeft = previousSpread * this.geometry.spreadStride;
      this.effects.playLive(
        this.settings.pageEffect,
        container,
        this.roots.body,
        spread > previousSpread ? 1 : -1,
        commit
      );
      return;
    }
    if (from && shouldAnimate) {
      const to = capturePageSnapshot(container, this.blocks, this.geometry, paper, backdrop);
      if (to)
        this.effects.play(
          this.settings.pageEffect,
          from,
          to,
          spread > previousSpread ? 1 : -1,
          this.roots.body,
          container
        );
    }
    // Keep the latest explicit navigation through the site's delayed initial bookmark restoration.
    // A new pointer/wheel/key gesture releases it before native controls handle that gesture.
    commit();
  }
  move(direction: number) {
    this.cancelTransitions();
    if (this.roots.mode === 'page') this.goTo(this.state.page + direction * this.state.columns);
    else {
      const box = this.roots.box;
      this.seek(
        (box.scrollTop + direction * Math.max(1, box.clientHeight - 32)) /
          Math.max(1, box.scrollHeight - box.clientHeight)
      );
    }
  }
  private onKey = (event: KeyboardEvent) => {
    if (!readingKeyIntent(event)) return;
    this.initialAnchor = null;
    this.initialPage = null;
    this.endIntent = false;
    this.resume.userIntent();
    if (
      this.roots.mode !== 'page' ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      inputIsBusy(event)
    )
      return;
    const direction = ['ArrowRight', 'PageDown'].includes(event.key)
      ? 1
      : ['ArrowLeft', 'PageUp'].includes(event.key)
        ? -1
        : 0;
    if (!direction) return;
    this.cancelTransitions();
    if (direction > 0 && this.state.page + this.state.columns > this.state.pages) return; // Native boundary and auto-next behavior stay intact.
    if (direction < 0 && this.state.page === 1) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.move(direction);
  };
  private onClick = (event: MouseEvent) => {
    if (this.roots.mode !== 'page' || inputIsBusy(event) || !(event.target instanceof Element))
      return;
    const button = event.target.closest('#novel_drawing_left,#novel_drawing_right');
    if (!button) return;
    const direction = button.id === 'novel_drawing_right' ? 1 : -1;
    this.cancelTransitions();
    if (direction > 0 && this.state.page + this.state.columns > this.state.pages) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.move(direction);
  };
  private onScroll = () => {
    if (this.effects.isLive) return;
    // A delayed native bookmark animation can briefly scroll to an obsolete position.
    // Restore the pending explicit position before publishing a counter or saving an anchor.
    if (this.initialAnchor || this.initialPage !== null || this.endIntent) {
      this.schedule();
      return;
    }
    this.updateProgress();
    this.anchor = this.getAnchor();
    this.persistSoon();
  };
  private persistSoon() {
    clearTimeout(this.saveTimer);
    if (this.resume.canSave) this.saveTimer = setTimeout(() => this.flushPosition(), 300);
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.flushPosition();
    this.resize.disconnect();
    this.mutations.disconnect();
    this.roots.box.removeEventListener('scroll', this.onScroll);
    this.roots.pageContainer?.removeEventListener('scroll', this.onScroll);
    this.roots.body.removeEventListener('load', this.onLoad, true);
    document.fonts?.removeEventListener('loadingdone', this.onLoad);
    window.removeEventListener('resize', this.onLoad);
    window.removeEventListener('wheel', this.onGesture, true);
    window.removeEventListener('pointerdown', this.onGesture, true);
    window.removeEventListener('touchstart', this.onGesture, true);
    this.cancelTransitions();
    this.background.dispose();
    this.viewport.dispose();
    this.serviceResize.disconnect();
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('click', this.onClick, true);
    for (const block of this.blocks) {
      delete block.dataset.unpLine;
      delete block.dataset.unpEmpty;
      delete block.dataset.unpParagraph;
    }
    for (const el of this.emphasis) delete el.dataset.unpEmphasis;
    delete this.roots.body.dataset.unpReader;
    delete this.roots.body.dataset.unpBold;
    delete this.roots.box.dataset.unpViewport;
    this.extent.remove();
    this.sentinel.remove();
    this.sheet.remove();
    this.ledger.restore();
    if (this.ownsFonts) this.fonts.dispose();
    this.listeners.clear();
    void this.native.request({ type: 'release' }).catch(() => {});
  }
}
