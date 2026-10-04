import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PageEffects, serviceClipPath, shouldAnimatePageTurn } from './page-effects';
import { capturePageSnapshot, containsVisibleService, containsPageCover } from './page-snapshot';
import { pageGeometry } from '../lib/geometry';
// @ts-expect-error Build plugin is a Node ESM script, not extension runtime code.
import { pageFlipLifecycle } from '../../../../scripts/page-flip-lifecycle.mjs';

describe('bounded page effects', () => {
  it('detects visible native cover fragments only, including expanded fragments on later pages', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="cover-wrapper"><button class="cover-text">커버보기</button></div><div class="line">커버보기는 합성 본문입니다.</div>';
    const cover = root.firstElementChild as HTMLElement;
    const view = new DOMRect(100, 40, 600, 700);
    vi.spyOn(cover, 'getClientRects').mockReturnValue([
      new DOMRect(150, 100, 100, 40),
    ] as unknown as DOMRectList);
    expect(containsPageCover(root, view)).toBe(true);
    vi.spyOn(cover, 'getClientRects').mockReturnValue([
      new DOMRect(-500, 100, 500, 40),
      new DOMRect(150, 100, 100, 40),
    ] as unknown as DOMRectList);
    expect(containsPageCover(root, view)).toBe(true);
    vi.spyOn(cover, 'getClientRects').mockReturnValue([
      new DOMRect(-500, 100, 100, 40),
    ] as unknown as DOMRectList);
    expect(containsPageCover(root, view)).toBe(false);
    cover.remove();
    expect(containsPageCover(root, view)).toBe(false);
  });
  it('animates adjacent reading turns only, not seeks, reduced motion, or boundaries', () => {
    expect(shouldAnimatePageTurn('fold', 0, 1, 5, false)).toBe(true);
    expect(shouldAnimatePageTurn('paper', 2, 1, 5, false)).toBe(true);
    expect(shouldAnimatePageTurn('fade', 0, 0, 5, false)).toBe(false);
    expect(shouldAnimatePageTurn('slide', 0, 4, 5, false)).toBe(false);
    expect(shouldAnimatePageTurn('slide', 0, 1, 5, false, false)).toBe(false);
    expect(shouldAnimatePageTurn('paper', 0, 1, 5, true)).toBe(false);
    expect(shouldAnimatePageTurn('none', 0, 1, 5, false)).toBe(false);
  });
  it.each([1, 2])('skips either direction of the final spread with %i columns', (columns) => {
    for (const pages of [1, 2, 5, 6]) {
      const last = Math.ceil(pages / columns) - 1;
      for (const effect of ['slide', 'fade', 'paper', 'fold'] as const) {
        expect(shouldAnimatePageTurn(effect, last - 1, last, last, false)).toBe(false);
        expect(shouldAnimatePageTurn(effect, last, last - 1, last, false)).toBe(false);
        if (last > 1)
          expect(shouldAnimatePageTurn(effect, last - 2, last - 1, last, false)).toBe(true);
      }
    }
  });
  it('never covers visible service or interactive elements, and ignores offscreen ones', () => {
    const root = document.createElement('div');
    const view = new DOMRect(100, 40, 600, 700);
    for (const html of [
      '<div data-service="ad">광고</div>',
      '<a href="/">링크</a>',
      '<button>다음</button>',
    ]) {
      root.innerHTML = html;
      const child = root.firstElementChild as HTMLElement;
      vi.spyOn(child, 'getClientRects').mockReturnValue([
        new DOMRect(150, 100, 100, 40),
      ] as unknown as DOMRectList);
      expect(containsVisibleService(root, view)).toBe(true);
      vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(view);
      const snapshot = capturePageSnapshot(
        root,
        [],
        pageGeometry(640, 700, 600, 20, 0, 18, 160, 'single'),
        'white'
      );
      expect(snapshot?.services).toHaveLength(1);
      expect(snapshot?.pages.every((page) => !page.querySelector('a,button,[data-service]'))).toBe(
        true
      );
      vi.spyOn(child, 'getClientRects').mockReturnValue([
        new DOMRect(850, 100, 100, 40),
      ] as unknown as DOMRectList);
      expect(containsVisibleService(root, view)).toBe(false);
    }
  });
  it('unions nested service holes instead of exposing their overlap with even-odd parity', () => {
    const clip = serviceClipPath(new DOMRect(0, 0, 300, 300), [
      new DOMRect(40, 40, 100, 100),
      new DOMRect(50, 50, 20, 20),
    ]);
    expect(clip).toBe('path(evenodd,"M0 0H300V300H0ZM40 40H140V140H40Z")');
  });
  it('releases the latest deferred service layout once after cleanup on finish or cancellation', async () => {
    const view = new DOMRect(20, 40, 400, 600);
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(view);
    const oldAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    const finishes: (() => void)[] = [];
    const cancel = vi.fn();
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: () => ({
        finished: new Promise<void>((resolve) => {
          finishes.push(resolve);
        }),
        cancel,
      }),
    });
    const container = document.createElement('div');
    const body = document.createElement('div');
    container.append(body);
    document.body.append(container);
    const effects = new PageEffects();
    const snapshot = () => ({
      view,
      columns: 1 as const,
      gap: 20,
      services: [],
      pages: [document.createElement('div')],
    });
    try {
      expect(effects.afterCurrent(() => {})).toBe(false);
      for (const cancelled of [false, true]) {
        effects.play('fade', snapshot(), snapshot(), 1, body, container);
        const stale = vi.fn(),
          latest = vi.fn(() => {
            expect(document.querySelector('[data-unp-page-effect]')).toBeNull();
            expect(body.hasAttribute('data-unp-transition')).toBe(false);
            expect(container.style.getPropertyValue('--unp-transition-paper-color')).toBe('');
            expect(effects.afterCurrent(() => {})).toBe(false);
          });
        expect(effects.afterCurrent(stale)).toBe(true);
        expect(effects.afterCurrent(latest)).toBe(true);
        if (cancelled) effects.cancel();
        else {
          finishes.splice(0).forEach((finish) => finish());
          await Promise.resolve();
          await Promise.resolve();
        }
        effects.cancel();
        expect(stale).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(1);
      }
    } finally {
      effects.cancel();
      container.remove();
      bounds.mockRestore();
      if (oldAnimate) Object.defineProperty(Element.prototype, 'animate', oldAnimate);
      else Reflect.deleteProperty(Element.prototype, 'animate');
    }
  });
  it('patches the audited dependency lifecycle and rejects silently incompatible upgrades', () => {
    const plugin = pageFlipLifecycle();
    const id = `${process.cwd()}/node_modules/page-flip/dist/js/page-flip.module.js`;
    const source = readFileSync(id, 'utf8');
    const result = plugin.transform(source, id);
    expect(result.code).toContain('this.app.getUI().getDistElement().isConnected');
    expect(result.code).toContain('this.removeHandlers(),this.distElement.remove()');
    expect(result.code).not.toContain(
      'this.app.getSettings().useMouseEvents&&this.removeHandlers()'
    );
    expect(() => plugin.transform('different upstream release', id)).toThrow(/audited 2.0.7/);
    expect(plugin.transform(source, '/unrelated.js')).toBeNull();
  });
});
