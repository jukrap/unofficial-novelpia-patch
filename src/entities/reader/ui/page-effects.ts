import type { Settings } from '@/shared/model/preferences';
import { visibleServiceRects, type PageSnapshot } from './page-snapshot';
import { StyleLedger } from '../lib/ledger';
import { livePageEffect } from './live-page-effect';
import { animateElement, type MotionPlayback } from '@/shared/lib/motion';
import { motionDuration } from '@/shared/config/motion';

type PaperModule = typeof import('./paper-effect');
let paperModule: PaperModule | undefined;
let paperLoading: Promise<PaperModule> | undefined;
function loadPaper() {
  return (paperLoading ??= import('./paper-effect')
    .then((module) => {
      paperModule = module;
      return module;
    })
    .catch((error) => {
      paperLoading = undefined;
      throw error;
    }));
}

export function shouldAnimatePageTurn(
  effect: Settings['pageEffect'],
  fromSpread: number,
  toSpread: number,
  lastSpread: number,
  reduced: boolean,
  requested = true
) {
  // The final spread can include native ads and navigation. Keep both directions
  // immediate, including a two-page spread whose second page is the last one.
  return (
    requested &&
    effect !== 'none' &&
    !reduced &&
    fromSpread < lastSpread &&
    toSpread < lastSpread &&
    Math.abs(toSpread - fromSpread) === 1
  );
}

function spread(snapshot: PageSnapshot) {
  const element = document.createElement('div');
  element.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  snapshot.pages.forEach((page, column) => {
    page.style.left = `${column * ((snapshot.view.width + snapshot.gap) / snapshot.columns)}px`;
    element.append(page);
  });
  return element;
}

/** Build non-overlapping holes: overlapping service descendants must not cancel
 * each other's exclusion under the even-odd fill rule. */
export function serviceClipPath(view: DOMRect, services: DOMRect[]): string {
  const holes: DOMRect[] = [];
  for (const service of services) {
    let pieces = [
      new DOMRect(service.left - view.left, service.top - view.top, service.width, service.height),
    ];
    for (const hole of holes) {
      pieces = pieces.flatMap((piece) => {
        const left = Math.max(piece.left, hole.left),
          right = Math.min(piece.right, hole.right);
        const top = Math.max(piece.top, hole.top),
          bottom = Math.min(piece.bottom, hole.bottom);
        if (right <= left || bottom <= top) return [piece];
        return [
          new DOMRect(piece.left, piece.top, piece.width, top - piece.top),
          new DOMRect(piece.left, bottom, piece.width, piece.bottom - bottom),
          new DOMRect(piece.left, top, left - piece.left, bottom - top),
          new DOMRect(right, top, piece.right - right, bottom - top),
        ].filter((rect) => rect.width > 0 && rect.height > 0);
      });
    }
    holes.push(...pieces);
  }
  const rectangle = (rect: DOMRect) =>
    `M${rect.left} ${rect.top}H${rect.right}V${rect.bottom}H${rect.left}Z`;
  return `path(evenodd,"${rectangle(new DOMRect(0, 0, view.width, view.height))}${holes.map(rectangle).join('')}")`;
}

/** Transient presentation only. Page counters, navigation and anchors stay in ReaderEngine. */
export class PageEffects {
  private cleanup: (() => void) | undefined;
  private deferred: (() => void) | undefined;
  private live = false;
  get isLive() {
    return this.live;
  }
  warm(effect: Settings['pageEffect']) {
    if (effect === 'paper' || effect === 'fold') void loadPaper().catch(() => {});
  }
  cancel() {
    const cleanup = this.cleanup;
    cleanup?.();
    if (this.cleanup === cleanup) this.cleanup = undefined;
  }
  /** A newly visible service can reserve space after the current turn finishes.
   * Repeated measurements coalesce; cancellation must release that work as well. */
  afterCurrent(action: () => void): boolean {
    if (!this.cleanup) return false;
    this.deferred = action;
    return true;
  }
  playLive(
    effect: Settings['pageEffect'],
    container: HTMLElement,
    body: HTMLElement,
    direction: 1 | -1,
    commit: () => void
  ) {
    this.cancel();
    this.live = true;
    let release: (() => void) | undefined;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      release?.();
      this.live = false;
      if (this.cleanup === finish) this.cleanup = undefined;
      const deferred = this.deferred;
      this.deferred = undefined;
      deferred?.();
    };
    this.cleanup = finish;
    release = livePageEffect(effect, container, body, direction, commit, finish);
  }
  play(
    effect: Settings['pageEffect'],
    from: PageSnapshot,
    to: PageSnapshot,
    direction: 1 | -1,
    body: HTMLElement,
    container: HTMLElement
  ) {
    this.cancel();
    if ((effect === 'paper' || effect === 'fold') && !paperModule) {
      this.warm(effect);
      return;
    }
    const host = document.createElement('div');
    host.dataset.unpPageEffect = effect;
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    host.style.cssText = `position:absolute;left:0;top:0;width:${from.view.width}px;height:${from.view.height}px;margin:0;padding:0;border:0;box-sizing:border-box;overflow:hidden;pointer-events:none;z-index:3;`;
    // Keep the overlay within the reader's stacking context, below service modals.
    container.parentElement?.append(host);
    // A native will-change/transform ancestor can establish a containing block.
    // Measure that local origin instead of applying viewport coordinates twice.
    const origin = host.getBoundingClientRect();
    if (
      Math.abs(origin.width - from.view.width) > 0.5 ||
      Math.abs(origin.height - from.view.height) > 0.5
    ) {
      host.remove();
      return;
    }
    host.style.left = `${from.view.left - origin.left}px`;
    host.style.top = `${from.view.top - origin.top}px`;
    const ledger = new StyleLedger();
    // Dedicated variables avoid competing with ReaderEngine's reversible style ledger
    // when a native scroll callback recomputes layout during this animation.
    let bodyOnly = false;
    const keepServicePaper = () => {
      if (bodyOnly) return;
      bodyOnly = true;
      for (const page of [...from.pages, ...to.pages]) page.style.background = 'transparent';
      ledger.restore();
    };
    if (from.services.length || to.services.length) keepServicePaper();
    else if (effect !== 'fade') {
      ledger.set(container, '--unp-transition-paper-color', 'transparent');
      ledger.set(container, '--unp-transition-paper-image', 'none');
    }
    body.dataset.unpTransition = '';
    let animations: MotionPlayback[] = [];
    let releasePaper: (() => void) | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let maskFrame = 0;
    let previousClip = '';
    const updateExclusions = () => {
      if (cancelled) return;
      const view = host.getBoundingClientRect();
      const services = visibleServiceRects(container, view);
      if (services.length) keepServicePaper();
      const clip = services.length ? serviceClipPath(view, services) : 'none';
      if (clip !== previousClip) {
        host.style.clipPath = clip;
        previousClip = clip;
      }
      maskFrame = requestAnimationFrame(updateExclusions);
    };
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(maskFrame);
      clearTimeout(deadline);
      animations.forEach((animation) => animation.cancel());
      animations = [];
      releasePaper?.();
      host.remove();
      delete body.dataset.unpTransition;
      ledger.restore();
      if (this.cleanup === finish) this.cleanup = undefined;
      const deferred = this.deferred;
      this.deferred = undefined;
      deferred?.();
    };
    this.cleanup = finish;
    try {
      updateExclusions();
      if (effect === 'paper' || effect === 'fold') {
        releasePaper = paperModule!.playPaperEffect(
          host,
          from,
          to,
          direction,
          effect === 'fold',
          finish
        );
        return;
      }
      const outgoing = spread(from);
      const incoming = spread(to);
      host.append(incoming, outgoing);
      const timing: KeyframeAnimationOptions = {
        duration: motionDuration.page * 1000,
        easing: 'cubic-bezier(.2,.6,.2,1)',
        fill: 'both',
      };
      if (effect === 'slide') {
        animations = [
          animateElement(
            outgoing,
            [{ transform: 'translateX(0)' }, { transform: `translateX(${-direction * 100}%)` }],
            timing
          ),
          animateElement(
            incoming,
            [{ transform: `translateX(${direction * 100}%)` }, { transform: 'translateX(0)' }],
            timing
          ),
        ];
      } else {
        // Sequential fades avoid displaying two paragraphs through each other.
        // Keep the stationary paper during the handover so only text fades.
        animations = [
          animateElement(
            outgoing,
            [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
            timing
          ),
          animateElement(
            incoming,
            [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }],
            timing
          ),
        ];
      }
      void Promise.all(animations.map((animation) => animation.finished)).then(finish, finish);
      deadline = setTimeout(finish, 400);
    } catch {
      finish();
    }
  }
}
