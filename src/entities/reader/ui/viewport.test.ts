import { describe, expect, it } from 'vitest';
import { ReadingViewport, readingViewport } from './viewport';

describe('usable reading viewport', () => {
  it('fills the full scroll overlay viewport while retaining real service space', () => {
    expect(readingViewport(900, 100, 126, 0, true, 'scroll')).toEqual({ top: 0, height: 900 });
    expect(readingViewport(900, 40, 126, 0, true, 'scroll')).toEqual({ top: 270, height: 360 });
    expect(readingViewport(900, 100, 126, 322, true, 'scroll')).toEqual({ top: 0, height: 578 });
    expect(readingViewport(900, 100, 200, 322, true, 'scroll')).toEqual({ top: 0, height: 578 });
  });
  it('centers the selected height within header, footer and reserved navigation bounds', () => {
    expect(readingViewport(900, 100, 126, 0, false)).toEqual({ top: 64, height: 710 });
    const compact = readingViewport(900, 40, 126, 0, false);
    expect(compact).toEqual({ top: 277, height: 284 });
    expect(compact.top - 64).toBe(774 - compact.top - compact.height);
  });
  it('overlay releases the navigation slot while retaining the native footer and service boundary', () => {
    expect(readingViewport(900, 100, 126, 0, true)).toEqual({ top: 64, height: 772 });
    const terminal = readingViewport(900, 40, 126, 322, false);
    expect(terminal.height).toBeCloseTo(180.8);
    expect(terminal.top).toBeCloseTo(199.6);
    expect(readingViewport(900, 100, 126, 322, true)).toEqual({ top: 64, height: 514 });
    expect(() => readingViewport(300, 40, 126, 322, false)).toThrow(/공간/);
  });
  it('keeps native height cached across managed scroll layouts and fills a classic scrollbar gutter', () => {
    const box = document.createElement('div');
    box.style.cssText = 'height:100%;border-left:2px solid;border-right:3px solid';
    Object.defineProperties(box, {
      clientWidth: { get: () => 978 },
      offsetWidth: { get: () => 1000 },
      clientHeight: {
        get: () => (box.style.height.endsWith('px') ? Number.parseFloat(box.style.height) : 900),
      },
    });
    document.body.append(box);
    const viewport = new ReadingViewport(box);
    expect(viewport.measure()).toBe(900);
    viewport.applyScroll(100, 400);
    viewport.changed();
    expect(viewport.measure()).toBe(900);
    expect(box.style.height).toBe('400px');
    expect(viewport.getBackgroundFrame().width).toBe(995);
    box.style.height = '1200px';
    viewport.changed();
    expect(viewport.measure()).toBe(1200);
    viewport.dispose();
    expect(box.style.height).toBe('1200px');
    box.remove();
  });
});
