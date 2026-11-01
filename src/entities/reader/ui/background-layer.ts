import type { Settings } from '@/shared/model/preferences';
import { resolveBackgroundImage } from '@/shared/platform/background-assets';
import { StyleLedger } from '../lib/ledger';
import type { BackgroundFrame } from './viewport';
import type { PageBackdrop } from './page-paper';
import { animateElement, type MotionPlayback } from '@/shared/lib/motion';
import { motionDuration } from '@/shared/config/motion';

export type ReaderBackgroundStatus = 'idle' | 'loading' | 'ready' | 'error';
const rgba = (hex: string, opacity: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${opacity / 100})`;

/** A sibling background stays outside the reader's scrolling/containing block. */
export class ReaderBackground {
  private settings: Settings;
  private key = '';
  private pending: AbortController | undefined;
  private current: { element: HTMLDivElement; url: string; release: () => void } | undefined;
  private finishTransition: (() => void) | undefined;
  private disposed = false;
  private paintLedger = new StyleLedger();
  private layers = new Set<HTMLElement>();
  private observer: MutationObserver;
  private resize?: ResizeObserver;
  private fullFrame?: BackgroundFrame;
  private base: HTMLDivElement | undefined;
  constructor(
    private box: HTMLElement,
    settings: Settings,
    private report: (status: ReaderBackgroundStatus, error: string) => void
  ) {
    this.settings = settings;
    this.observer = new MutationObserver(this.positionLayers);
    for (let element: HTMLElement | null = box; element; element = element.parentElement)
      this.observer.observe(element, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      });
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(this.positionLayers);
      this.resize.observe(box);
    }
    window.addEventListener('resize', this.positionLayers);
  }
  private positionLayers = () => {
    if (!this.layers.size || this.disposed) return;
    const style = getComputedStyle(this.box);
    const visible =
      this.box.getClientRects().length > 0 &&
      this.box.clientWidth > 0 &&
      this.box.clientHeight > 0 &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse';
    const origin = style.transformOrigin.split(' ');
    const full = this.fullFrame;
    // A sibling's absolute coordinates use the same offset parent as the reader.
    // Internal scroll offsets are deliberately absent; no scroll listener or frame loop is needed.
    for (const layer of this.layers) {
      Object.assign(layer.style, {
        left: `${full?.left ?? this.box.offsetLeft + this.box.clientLeft}px`,
        top: `${full?.top ?? this.box.offsetTop + this.box.clientTop}px`,
        width: `${full?.width ?? this.box.clientWidth}px`,
        height: `${full?.height ?? this.box.clientHeight}px`,
        transform: style.transform,
        transformOrigin: `${(parseFloat(origin[0] || '0') || 0) - this.box.clientLeft}px ${(parseFloat(origin[1] || '0') || 0) - this.box.clientTop + (full?.originShift ?? 0)}px ${origin[2] || '0px'}`,
        borderRadius: style.borderRadius,
        opacity: style.opacity,
      });
      layer.style.setProperty('display', visible ? 'block' : 'none', 'important');
    }
  };
  private unmount(element: HTMLElement) {
    this.layers.delete(element);
    element.remove();
  }
  private paint(element: HTMLElement, url: string) {
    const overlay = rgba(this.settings.overlayColor, this.settings.overlayOpacity);
    element.style.backgroundImage = `linear-gradient(${overlay},${overlay}),url(${JSON.stringify(url)})`;
    element.style.backgroundColor = this.settings.backgroundColor;
  }
  private syncPaintOwnership() {
    const parent = this.box.parentElement;
    if (this.layers.size && parent) {
      this.paintLedger.set(parent, 'isolation', 'isolate');
      this.paintLedger.set(this.box, '--unp-background-color', 'transparent');
    } else this.paintLedger.restore();
  }
  private syncBase() {
    // The image starts transparent. Keep our solid paint behind it, otherwise
    // making the reader transparent exposes the native page's background mid-fade.
    const needed =
      this.settings.backgroundType === 'image' ||
      (this.fullFrame && this.fullFrame.height > this.box.clientHeight + 0.5);
    if (needed && this.box.parentElement) {
      if (!this.base) {
        this.base = document.createElement('div');
        this.base.dataset.unpBackgroundBase = '';
        this.base.setAttribute('aria-hidden', 'true');
        this.base.style.cssText =
          'position:absolute;z-index:-1;pointer-events:none;box-sizing:border-box;';
        this.box.parentElement.insertBefore(this.base, this.current?.element ?? this.box);
        this.layers.add(this.base);
      }
      this.base.style.backgroundColor = this.settings.backgroundColor;
    } else if (this.base) {
      this.unmount(this.base);
      this.base = undefined;
    }
    this.syncPaintOwnership();
  }
  snapshot(): PageBackdrop {
    return {
      color: this.settings.backgroundColor,
      layers: [...this.layers].flatMap((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none') return [];
        return [
          {
            view: element.getBoundingClientRect(),
            image: style.backgroundImage,
            color: style.backgroundColor,
            size: style.backgroundSize,
            position: style.backgroundPosition,
            repeat: style.backgroundRepeat,
            opacity: style.opacity,
          },
        ];
      }),
    };
  }
  update(settings: Settings, fullFrame?: BackgroundFrame) {
    this.settings = settings;
    this.fullFrame = fullFrame;
    this.syncBase();
    if (!settings.backgroundImageFade) this.finishTransition?.();
    this.positionLayers();
    if (this.current) {
      this.paint(this.current.element, this.current.url);
    }
    const key = JSON.stringify([
      settings.backgroundType,
      settings.backgroundImageSource,
      settings.backgroundAssetId,
      settings.backgroundImage,
    ]);
    if (key === this.key) return;
    this.key = key;
    this.pending?.abort();
    this.finishTransition?.();
    const abort = new AbortController();
    this.pending = abort;
    if (
      settings.backgroundType !== 'image' ||
      (settings.backgroundImageSource === 'url' && !settings.backgroundImage) ||
      (settings.backgroundImageSource !== 'url' && !settings.backgroundAssetId)
    ) {
      if (this.current) this.unmount(this.current.element);
      this.current?.release();
      this.current = undefined;
      this.syncPaintOwnership();
      this.report('idle', '');
      return;
    }
    this.report('loading', '');
    void resolveBackgroundImage(settings, abort.signal)
      .then((resolved) => {
        if (!resolved) return;
        const parent = this.box.parentElement;
        if (abort.signal.aborted || this.disposed || !parent) {
          resolved.release();
          return;
        }
        const old = this.current;
        const element = document.createElement('div');
        element.dataset.unpBackground = '';
        element.setAttribute('aria-hidden', 'true');
        element.style.cssText =
          'position:absolute;z-index:-1;pointer-events:none;box-sizing:border-box;background-size:cover;background-position:center;background-repeat:no-repeat;';
        this.paint(element, resolved.url);
        // Isolate the negative background above its parent's paint and below all reader/service UI.
        // Do not remove native transforms, filters, containment, or acceleration hints.
        parent.insertBefore(element, this.box);
        this.layers.add(element);
        this.syncPaintOwnership();
        this.positionLayers();
        this.current = { element, ...resolved };
        let animation: MotionPlayback | undefined;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          animation?.cancel();
          if (old) this.unmount(old.element);
          old?.release();
          if (this.finishTransition === finish) this.finishTransition = undefined;
        };
        this.finishTransition = finish;
        if (
          this.settings.backgroundImageFade &&
          !matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          animation = animateElement(
            element,
            [{ opacity: 0 }, { opacity: element.style.opacity || '1' }],
            {
              duration: motionDuration.background * 1000,
              easing: 'ease-in-out',
            }
          );
          void animation.finished.then(finish, finish);
        } else finish();
        this.report('ready', '');
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || this.disposed) return;
        if (this.current) this.unmount(this.current.element);
        this.current?.release();
        this.current = undefined;
        this.syncPaintOwnership();
        this.report(
          'error',
          error instanceof Error ? error.message : '배경 이미지를 불러오지 못했습니다.'
        );
      });
  }
  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.resize?.disconnect();
    window.removeEventListener('resize', this.positionLayers);
    this.pending?.abort();
    this.finishTransition?.();
    if (this.current) this.unmount(this.current.element);
    this.current?.release();
    this.current = undefined;
    if (this.base) this.unmount(this.base);
    this.base = undefined;
    this.paintLedger.restore();
  }
}
