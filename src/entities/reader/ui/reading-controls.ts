import {
  readingSurfacePalette,
  type ReadingSurfaceSettings,
} from '@/shared/config/reading-surface-palette';
import { StyleLedger } from '../lib/ledger';
import { protectedSelector } from '../lib/site';

const namedSurfaces = [
  'writer_comments_box',
  'next_epi_btn_bottom',
  'next_info_layer',
  'back_info_layer',
];
const footerMessages = new Set(['여기까지가 공지 마지막 내용입니다', '등록된 마지막 회차입니다']);
const lineSelector = '.line, [data-line], [data-unp-line]';

function readingSurfaces() {
  const surfaces = new Set<HTMLElement>();
  for (const id of namedSurfaces) {
    const element = document.getElementById(id);
    if (element) surfaces.add(element);
  }
  for (const element of document.querySelectorAll<HTMLElement>('#load_bar > div'))
    surfaces.add(element);

  // Native notice/final-episode messages have no ID. Only inspect direct footer
  // divs after the body's last reading block, never prose or a service descendant.
  for (const body of document.querySelectorAll<HTMLElement>(
    '#novel_drawing, #novel_drawing_page'
  )) {
    // Only the native expand/collapse button is a paint target. Its image and
    // wrapper remain protected from the reading engine and color changes.
    for (const button of body.querySelectorAll<HTMLElement>('.cover-wrapper > .cover-text')) {
      if (
        button.closest(
          '.curation-wrapper, #writer_comments_box, [id*="banner"], [class*="banner"], [id*="payment"], [data-service]'
        )
      )
        continue;
      surfaces.add(button);
    }
    const children = [...body.children];
    let lastLine = -1;
    for (let index = children.length - 1; index >= 0; index--)
      if (children[index]!.matches(lineSelector) || children[index]!.querySelector(lineSelector)) {
        lastLine = index;
        break;
      }
    if (lastLine < 0) continue;
    for (const element of children.slice(lastLine + 1)) {
      if (
        !(element instanceof HTMLDivElement) ||
        element.id ||
        element.matches(lineSelector) ||
        element.matches(protectedSelector) ||
        element.querySelector(`${lineSelector}, ${protectedSelector}`) ||
        element.closest(protectedSelector)
      )
        continue;
      const message = element.textContent
        ?.trim()
        .replace(/\s+/g, ' ')
        .replace(/[.!。]+$/, '');
      if (message && footerMessages.has(message)) surfaces.add(element);
    }
  }
  return surfaces;
}

/** Style only the known reading surfaces; leave service visibility, timers and clicks native. */
export class ReadingControls {
  private layout = new StyleLedger();
  private paint = new Map<HTMLElement, StyleLedger>();

  /** Can run before a reader exists and again whenever native surfaces are replaced. */
  update(settings: ReadingSurfaceSettings) {
    // Keep native paint independent from the hint's improved placement. The ledger
    // also remembers native changes made while extension paint is active.
    const palette = readingSurfacePalette(settings);
    const surfaces = palette ? readingSurfaces() : new Set<HTMLElement>();
    for (const [element, ledger] of this.paint) {
      if (surfaces.has(element)) continue;
      ledger.restore();
      this.paint.delete(element);
    }
    if (palette)
      for (const element of surfaces) {
        let ledger = this.paint.get(element);
        if (!ledger) this.paint.set(element, (ledger = new StyleLedger()));
        const hint = element.id === 'next_info_layer' || element.id === 'back_info_layer';
        ledger.set(element, 'color', palette.ink);
        ledger.set(element, 'background-color', palette.paper);
        ledger.set(element, 'background-image', 'none');
        // Track each side independently: native controls may use asymmetric
        // borders, and restoring a shorthand can erase untouched sides.
        for (const side of ['top', 'right', 'bottom', 'left']) {
          ledger.set(element, `border-${side}-color`, palette.border);
          if (hint) {
            ledger.set(element, `border-${side}-width`, '1px');
            ledger.set(element, `border-${side}-style`, 'solid');
          }
        }
        if (hint) {
          ledger.set(element, 'box-shadow', '0 2px 12px #00000026');
        }
      }
    for (const id of ['next_info_layer', 'back_info_layer']) {
      const hint = document.getElementById(id);
      if (!hint) continue;
      const styles: Record<string, string> = {
        'font-size': '14px',
        'line-height': '1.5',
        padding: '10px 16px',
        'box-sizing': 'border-box',
        width: '300px',
        'max-width': 'calc(100% - 32px)',
        left: '50%',
        transform: 'translateX(-50%)',
      };
      for (const [key, value] of Object.entries(styles)) this.layout.set(hint, key, value);
    }
  }

  dispose() {
    for (const ledger of this.paint.values()) ledger.restore();
    this.paint.clear();
    this.layout.restore();
  }
}
