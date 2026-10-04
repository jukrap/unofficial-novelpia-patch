import { describe, it, expect } from 'vitest';
import { pageGeometry, countPages } from './geometry';
import { graphemeOffset, parseAnchor, rangeForAnchor } from '../model/anchor';
import { StyleLedger } from './ledger';
import { readingBlocks } from './site';
describe('geometry and content anchors', () => {
  it('excludes lines inside protected service ancestors and lines containing service children', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="banner"><span class="line" data-line="1">광고</span></div><span class="line" data-line="2"><iframe></iframe></span><span class="line" data-line="3">본문 <b>강조</b></span>';
    expect(readingBlocks(root).map((el) => el.dataset.line)).toEqual(['3']);
  });
  it('accounts for inside padding exactly once in each spread', () => {
    const g = pageGeometry(1400, 800, 540, 35, 50, 24, 160, 'auto');
    expect(g.columns).toBe(2);
    expect(g.textWidth).toBe(470);
    expect(g.columnGap).toBe(90);
    expect(g.spreadStride).toBe(g.outerWidth + 20);
    expect(g.height).toBe(700);
    expect(pageGeometry(900, 800, 540, 35, 50, 24, 160, 'auto').columns).toBe(1);
    expect(pageGeometry(1400, 800, 540, 35, 50, 24, 160, 'single').columns).toBe(1);
  });
  it('rejects unusable space and counts actual trailing fragments without a phantom page', () => {
    expect(() => pageGeometry(400, 200, 540, 200, 100, 24, 160, 'auto')).toThrow();
    expect(
      countPages([new DOMRect(20, 0, 470, 700), new DOMRect(580, 0, 470, 700)], 20, 470, 90)
    ).toBe(2);
    expect(countPages([new DOMRect(20, 0, 469.9999, 700)], 20, 470, 90)).toBe(1);
  });
  it('changes the inter-page gap while preserving page insets and single-page geometry', () => {
    for (const gap of [0, 20, 80, 160, 240, 400]) {
      const spread = pageGeometry(1600, 800, 540, 35, 50, 24, 160, 'auto', gap);
      expect(spread.columns).toBe(2);
      expect(spread.pageGap).toBe(gap);
      expect(spread.outerWidth).toBe(1080 + gap);
      expect(spread.textWidth).toBe(470);
      expect(spread.columnGap).toBe(gap + 70);
      expect(spread.spreadStride).toBe(spread.outerWidth + gap);
      const narrow = pageGeometry(900, 800, 540, 35, 50, 24, 160, 'auto', gap);
      expect(narrow).toEqual(pageGeometry(900, 800, 540, 35, 50, 24, 160, 'single'));
    }
    expect(pageGeometry(1160, 800, 540, 35, 50, 24, 160, 'auto', 80).columns).toBe(2);
    expect(pageGeometry(1159, 800, 540, 35, 50, 24, 160, 'auto', 80).columns).toBe(1);
    expect(pageGeometry(1480, 800, 540, 35, 50, 24, 160, 'auto', 400).columns).toBe(2);
    expect(pageGeometry(1479, 800, 540, 35, 50, 24, 160, 'auto', 400).columns).toBe(1);
  });
  it('keeps surrogate pairs, combining marks and joined emoji at grapheme boundaries', () => {
    expect(graphemeOffset('한🌙글', 2)).toBe(1);
    expect(graphemeOffset('ae\u0301b', 2)).toBe(1);
    expect(graphemeOffset('A👩‍👩‍👧‍👦B', 8)).toBe(1);
    expect(parseAnchor({ episodeId: '1', blockKey: '3', textOffset: -1, edge: 'text' })).toBeNull();
  });
  it('restores through nested emphasis and falls forward when a block disappears', () => {
    const body = document.createElement('div');
    body.innerHTML =
      '<span class="line" data-line="4">한<b>🌙글</b></span><span class="line" data-line="8">다음</span>';
    const roots = {
      body,
      text: body,
      box: body,
      pageContainer: null,
      mode: 'scroll' as const,
      episodeId: '1',
    };
    const range = rangeForAnchor(roots, {
      episodeId: '1',
      blockKey: '4',
      textOffset: 2,
      edge: 'text',
    });
    expect(range?.toString()).toBe('🌙');
    expect(
      rangeForAnchor(roots, {
        episodeId: '1',
        blockKey: '6',
        textOffset: 0,
        edge: 'text',
      })?.toString()
    ).toBe('다');
  });
  it('restores only owned styles while retaining subsequent site writes', () => {
    const el = document.createElement('div');
    el.style.fontSize = '18px';
    const ledger = new StyleLedger();
    ledger.set(el, 'font-size', '24px');
    el.style.color = 'red';
    ledger.restore();
    expect(el.style.fontSize).toBe('18px');
    expect(el.style.color).toBe('red');
    ledger.set(el, 'font-size', '26px');
    el.style.fontSize = '30px';
    ledger.restore();
    expect(el.style.fontSize).toBe('30px');
  });
});
