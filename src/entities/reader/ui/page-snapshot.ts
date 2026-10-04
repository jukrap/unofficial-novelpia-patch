import { protectedSelector } from '../lib/site';
import type { Geometry } from '../lib/geometry';
import { pagePaper, type PageBackdrop } from './page-paper';

const forbidden = `${protectedSelector},a,button,input,select,textarea,video,audio,#next_epi_btn_bottom,[onclick],[role="button"],[role="link"],[contenteditable="true"]`;
const readerBoundary = '[data-unp-reader],#novel_drawing_page,#novel_drawing';
function excludedSource(element: HTMLElement, container: HTMLElement) {
  const match = element.closest(forbidden);
  return (
    !!match && match !== container && container.contains(match) && !match.matches(readerBoundary)
  );
}
const MAX_RUNS = 800;
const MAX_MEASUREMENTS = 16000;
const textProperties = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-kerning',
  'font-feature-settings',
  'font-variation-settings',
  'letter-spacing',
  'word-spacing',
  'color',
  'text-shadow',
  'text-decoration',
  'text-transform',
  'direction',
] as const;

export interface PageSnapshot {
  view: DOMRect;
  pages: HTMLElement[];
  columns: 1 | 2;
  gap: number;
  services: DOMRect[];
}
export const intersects = (rect: DOMRect, view: DOMRect) =>
  rect.width > 0 &&
  rect.height > 0 &&
  rect.right > view.left + 0.5 &&
  rect.left < view.right - 0.5 &&
  rect.bottom > view.top &&
  rect.top < view.bottom;

interface SnapshotPaint {
  opacity: number;
  clips: { rect: DOMRect; x: boolean; y: boolean }[];
}

/** Range rectangles describe layout, not painted visibility. Preserve the source's
 * opacity and ancestor overflow clips rather than exposing its hidden descendants.
 * The overlay shares container.parentElement, so only the replaced subtree's
 * opacity is copied; common ancestors still composite the overlay normally.
 */
function snapshotPaint(source: HTMLElement, container: HTMLElement): SnapshotPaint | null {
  const sourceStyle = getComputedStyle(source);
  if (sourceStyle.visibility === 'hidden' || sourceStyle.visibility === 'collapse') return null;
  const paint: SnapshotPaint = { opacity: 1, clips: [] };
  for (
    let element: HTMLElement | null = source;
    element && element !== container.parentElement;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.contentVisibility === 'hidden') return null;
    const opacity = Number.parseFloat(style.opacity);
    paint.opacity *= Number.isFinite(opacity) ? opacity : 1;
    if (paint.opacity === 0) return null;
    // Arbitrary masks, filters and non-rectangular clips cannot be faithfully
    // reconstructed from text ranges. Keep the original rendering for this turn.
    if (
      (style.clipPath && style.clipPath !== 'none') ||
      (style.maskImage && style.maskImage !== 'none') ||
      (style.filter && style.filter !== 'none') ||
      (style.clip && style.clip !== 'auto')
    )
      throw new Error('Snapshot requires unsupported paint clipping');
    if (style.display === 'inline' || style.display === 'contents') continue;
    const x = /^(hidden|clip|auto|scroll)$/.test(style.overflowX);
    const y = /^(hidden|clip|auto|scroll)$/.test(style.overflowY);
    if (!x && !y) continue;
    if ((x && element.clientWidth === 0) || (y && element.clientHeight === 0)) return null;
    const bounds = element.getBoundingClientRect();
    const scaleX = element.offsetWidth ? bounds.width / element.offsetWidth : 1;
    const scaleY = element.offsetHeight ? bounds.height / element.offsetHeight : 1;
    paint.clips.push({
      rect: new DOMRect(
        bounds.left + element.clientLeft * scaleX,
        bounds.top + element.clientTop * scaleY,
        element.clientWidth * scaleX,
        element.clientHeight * scaleY
      ),
      x,
      y,
    });
  }
  return paint;
}

function paintBounds(rect: DOMRect, paint: SnapshotPaint): DOMRect | null {
  let left = rect.left,
    right = rect.right,
    top = rect.top,
    bottom = rect.bottom;
  for (const clip of paint.clips) {
    if (clip.x) {
      left = Math.max(left, clip.rect.left);
      right = Math.min(right, clip.rect.right);
    }
    if (clip.y) {
      top = Math.max(top, clip.rect.top);
      bottom = Math.min(bottom, clip.rect.bottom);
    }
  }
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null;
}

function applyPaint(element: HTMLElement, rect: DOMRect, visible: DOMRect, paint: SnapshotPaint) {
  element.style.opacity = String(paint.opacity);
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
  if (
    visible.left !== rect.left ||
    visible.right !== rect.right ||
    visible.top !== rect.top ||
    visible.bottom !== rect.bottom
  )
    element.style.clipPath = `inset(${visible.top - rect.top}px ${rect.right - visible.right}px ${rect.bottom - visible.bottom}px ${visible.left - rect.left}px)`;
}

/** Rectangles are only exclusion geometry. Service DOM is never cloned or changed. */
export function visibleServiceRects(container: HTMLElement, view: DOMRect): DOMRect[] {
  const elements = new Set(container.querySelectorAll<HTMLElement>(forbidden));
  if (container.isConnected)
    for (const element of container.ownerDocument.querySelectorAll<HTMLElement>(protectedSelector))
      elements.add(element);
  return [...elements].flatMap((element) => {
    if (element.matches(readerBoundary)) return [];
    const style = getComputedStyle(element);
    if (
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0' ||
      (typeof element.checkVisibility === 'function' &&
        !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    )
      return [];
    return [...element.getClientRects()]
      .filter((rect) => intersects(rect, view))
      .map((rect) => {
        const left = Math.max(view.left, rect.left - 1),
          top = Math.max(view.top, rect.top - 1);
        return new DOMRect(
          left,
          top,
          Math.min(view.right, rect.right + 1) - left,
          Math.min(view.bottom, rect.bottom + 1) - top
        );
      });
  });
}
export function containsVisibleService(container: HTMLElement, view: DOMRect): boolean {
  return visibleServiceRects(container, view).length > 0;
}

/** Only services that actually move with the paged body need a live turn.
 * Fixed site menus/ads outside this container keep their normal independent layer. */
export function containsPageService(container: HTMLElement, view: DOMRect): boolean {
  return [...container.querySelectorAll<HTMLElement>(forbidden)].some((element) => {
    if (element.matches(readerBoundary)) return false;
    const style = getComputedStyle(element);
    return (
      style.position !== 'fixed' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      [...element.getClientRects()].some((rect) => intersects(rect, view))
    );
  });
}

/** Native cover controls remain live DOM. Skip turns on either side of their page. */
export function containsPageCover(container: HTMLElement, view: DOMRect): boolean {
  return [...container.querySelectorAll<HTMLElement>('.cover-wrapper')].some((cover) => {
    if (!cover.querySelector('.cover-text')) return false;
    const style = getComputedStyle(cover);
    return (
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      [...cover.getClientRects()].some((rect) => intersects(rect, view))
    );
  });
}

function lowerBound(length: number, before: (offset: number) => boolean) {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (before(middle)) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Snapshot visible text runs, never the complete chapter or its service descendants.
 * Range coordinates preserve the engine's line breaks, inline emphasis, and padding.
 */
export function capturePageSnapshot(
  container: HTMLElement,
  blocks: HTMLElement[],
  geometry: Geometry,
  paper: string,
  backdrop?: PageBackdrop
): PageSnapshot | null {
  const view = container.getBoundingClientRect();
  if (!view.width || !view.height) return null;
  const services = visibleServiceRects(container, view);
  const gap = geometry.pageGap;
  const width = (view.width - (geometry.columns - 1) * gap) / geometry.columns;
  const pages = Array.from({ length: geometry.columns }, (_, column) => {
    const element = document.createElement('div');
    element.style.cssText = `position:absolute;inset:0 auto auto 0;width:${width}px;height:${view.height}px;overflow:hidden;background:${paper};pointer-events:none;box-sizing:border-box;`;
    if (backdrop) {
      element.style.background = 'transparent';
      element.append(
        pagePaper(
          new DOMRect(view.left + column * (width + gap), view.top, width, view.height),
          paper,
          backdrop
        )
      );
    }
    return element;
  });
  let count = 0;
  let measurements = 0;
  const append = (element: HTMLElement, rect: DOMRect) => {
    const column = Math.min(
      geometry.columns - 1,
      Math.max(0, Math.floor((rect.left - view.left + 0.5) / (width + gap)))
    );
    element.style.position = 'absolute';
    element.style.left = `${rect.left - view.left - column * (width + gap)}px`;
    element.style.top = `${rect.top - view.top}px`;
    pages[column]!.append(element);
    if (++count > MAX_RUNS) throw new Error('Snapshot bounds exceeded');
  };
  try {
    for (const block of blocks) {
      if (
        !block.getClientRects().length ||
        ![...block.getClientRects()].some((rect) => intersects(rect, view))
      )
        continue;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || excludedSource(parent, container) || !node.textContent?.length) continue;
        const paint = snapshotPaint(parent, container);
        if (!paint) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (![...range.getClientRects()].some((rect) => intersects(rect, view))) continue;
        const text = node.textContent;
        const rectAt = (offset: number) => {
          if (++measurements > MAX_MEASUREMENTS) throw new Error('Snapshot bounds exceeded');
          range.setStart(node!, offset);
          range.setEnd(node!, Math.min(text.length, offset + 1));
          return range.getBoundingClientRect();
        };
        let start = lowerBound(text.length, (offset) => rectAt(offset).right <= view.left + 0.5);
        const end = lowerBound(text.length, (offset) => rectAt(offset).left < view.right - 0.5);
        const style = getComputedStyle(parent);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        while (start < end) {
          const first = rectAt(start);
          const column = Math.floor((first.left - view.left + 0.5) / (width + gap));
          const length = lowerBound(end - start, (offset) => {
            const rect = rectAt(start + offset);
            return (
              Math.abs(rect.top - first.top) < 1 &&
              Math.floor((rect.left - view.left + 0.5) / (width + gap)) === column
            );
          });
          const next = Math.min(end, start + Math.max(1, length));
          range.setStart(node, start);
          range.setEnd(node, next);
          const rect = range.getBoundingClientRect();
          const visible = paintBounds(rect, paint);
          if (visible && intersects(visible, view)) {
            const run = document.createElement('span');
            run.textContent = text.slice(start, next);
            run.style.cssText = `display:block;white-space:pre;margin:0;padding:0;border:0;line-height:${rect.height}px;`;
            for (const property of textProperties)
              run.style.setProperty(property, style.getPropertyValue(property));
            // Inline emphasis may be inherited through nested <b><i> elements.
            let emphasis: HTMLElement | null = parent;
            while (emphasis && emphasis !== block) {
              const emphasisStyle = getComputedStyle(emphasis);
              if (emphasisStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                run.style.backgroundColor = emphasisStyle.backgroundColor;
                run.style.borderRadius = emphasisStyle.borderRadius;
                break;
              }
              emphasis = emphasis.parentElement;
            }
            run.style.borderTop = style.borderTop;
            run.style.borderBottom = style.borderBottom;
            applyPaint(run, rect, visible, paint);
            append(run, rect);
          }
          start = next;
        }
      }
      for (const source of block.querySelectorAll<HTMLImageElement>('img')) {
        if (!source.complete || !source.naturalWidth || excludedSource(source, container)) continue;
        const paint = snapshotPaint(source, container);
        if (!paint) continue;
        const rect = source.getBoundingClientRect();
        const visible = paintBounds(rect, paint);
        if (!visible || !intersects(visible, view)) continue;
        const image = document.createElement('img');
        image.src = source.currentSrc || source.src;
        image.alt = '';
        image.style.cssText = `width:${rect.width}px;height:${rect.height}px;object-fit:${getComputedStyle(source).objectFit};`;
        applyPaint(image, rect, visible, paint);
        append(image, rect);
      }
    }
    // Service-only terminal pages still need a destination surface for the turn.
    return { view, pages, columns: geometry.columns, gap, services };
  } catch {
    // Unusual or extremely complex markup must not delay reading.
    return null;
  }
}
