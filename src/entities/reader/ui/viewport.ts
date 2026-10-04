import { StyleLedger } from '../lib/ledger';

export interface ReaderFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface BackgroundFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  originShift: number;
}
export function readingViewport(
  height: number,
  percent: number,
  bottomInset: number,
  serviceInset: number,
  overlay: boolean,
  mode: 'scroll' | 'page' = 'page'
) {
  // Scroll overlays occupy the native viewport; menus appear above its contents.
  // Real service reservations remain independent from the native menu clearance.
  const fullScroll = mode === 'scroll' && overlay;
  const top = fullScroll ? 0 : 64;
  const bottom = fullScroll
    ? Math.max(0, serviceInset)
    : Math.max(64, serviceInset) + (overlay ? 0 : Math.max(0, bottomInset - 64));
  const available = height - top - bottom;
  if (available <= 0)
    throw new Error('본문을 표시할 공간이 부족합니다. 창 높이나 진행바 배치를 조절해 주세요.');
  const readingHeight = (available * Math.max(40, Math.min(100, percent))) / 100;
  return { height: readingHeight, top: top + (available - readingHeight) / 2 };
}
export const frameOf = (rect: DOMRect): ReaderFrame => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
});

/** Keep the native scroll element. Measure its natural CSS only when its containing
 * geometry changes; temporarily expanding it on every scroll would clamp scrollTop. */
export class ReadingViewport {
  private ledger = new StyleLedger();
  private natural: {
    height: number;
    top: string;
    position: string;
    padding: number;
    borders: number;
    borderBox: boolean;
  } | null = null;
  private expected = { width: 0, height: 0, topStyle: '', heightStyle: '' };
  private shifted = 0;
  private dirty = true;
  constructor(private box: HTMLElement) {}
  invalidate() {
    this.dirty = true;
  }
  changed() {
    if (
      this.box.clientWidth !== this.expected.width ||
      this.box.clientHeight !== this.expected.height ||
      this.box.style.top !== this.expected.topStyle ||
      this.box.style.height !== this.expected.heightStyle
    )
      this.invalidate();
  }
  measure() {
    if (this.dirty || !this.natural) {
      this.ledger.restore();
      this.shifted = 0;
      const style = getComputedStyle(this.box);
      const number = (value: string) => Number.parseFloat(value) || 0;
      this.natural = {
        height: this.box.clientHeight,
        top: style.top === 'auto' ? '0px' : style.top,
        position: style.position,
        padding: number(style.paddingTop) + number(style.paddingBottom),
        borders: number(style.borderTopWidth) + number(style.borderBottomWidth),
        borderBox: style.boxSizing === 'border-box',
      };
      this.dirty = false;
      this.remember();
    }
    return this.natural.height;
  }
  applyScroll(top: number, height: number) {
    const natural = this.natural!;
    if (natural.position === 'static') this.ledger.set(this.box, 'position', 'relative');
    this.ledger.set(this.box, 'top', `calc(${natural.top} + ${top}px)`);
    this.ledger.set(
      this.box,
      'height',
      `${Math.max(1, height + (natural.borderBox ? natural.borders : -natural.padding))}px`
    );
    this.shifted = top;
    this.remember();
  }
  private remember() {
    this.expected = {
      width: this.box.clientWidth,
      height: this.box.clientHeight,
      topStyle: this.box.style.top,
      heightStyle: this.box.style.height,
    };
  }
  getFrame(): ReaderFrame {
    const rect = this.box.getBoundingClientRect();
    const style = getComputedStyle(this.box);
    const cssHeight =
      Number.parseFloat(style.height) +
      (this.natural?.borderBox ? 0 : (this.natural?.padding ?? 0) + (this.natural?.borders ?? 0));
    const scale = cssHeight ? rect.height / cssHeight : 1;
    return {
      left: rect.left,
      top: rect.top - this.shifted * scale,
      width: rect.width,
      height:
        ((this.natural?.height ?? this.box.clientHeight) + (this.natural?.borders ?? 0)) * scale,
    };
  }
  getBackgroundFrame(): BackgroundFrame {
    const style = getComputedStyle(this.box);
    const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
    const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
    return {
      left: this.box.offsetLeft + borderLeft,
      top: this.box.offsetTop + this.box.clientTop - this.shifted,
      // The backdrop also fills the strip above/below a classic scrollbar.
      width: Math.max(0, this.box.offsetWidth - borderLeft - borderRight),
      height: this.natural?.height ?? this.box.clientHeight,
      originShift: this.shifted,
    };
  }
  dispose() {
    this.ledger.restore();
  }
}
