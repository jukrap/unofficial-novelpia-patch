import type { ReaderRoots } from '../lib/site';
import { readingBlocks } from '../lib/site';
export interface ReadingAnchor {
  episodeId: string;
  blockKey: string;
  textOffset: number;
  edge: 'text' | 'before' | 'after';
}
export function parseAnchor(value: unknown): ReadingAnchor | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as ReadingAnchor;
  return typeof a.episodeId === 'string' &&
    /^\d+$/.test(a.episodeId) &&
    typeof a.blockKey === 'string' &&
    a.blockKey.length < 100 &&
    Number.isInteger(a.textOffset) &&
    a.textOffset >= 0 &&
    a.textOffset < 1e8 &&
    ['text', 'before', 'after'].includes(a.edge)
    ? a
    : null;
}
const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
export function graphemeOffset(text: string, offset: number): number {
  const clamped = Math.min(text.length, Math.max(0, offset));
  if (clamped === text.length) return clamped;
  return segmenter.segment(text).containing(clamped)?.index ?? 0;
}
function texts(block: HTMLElement) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      return !el || el.closest('script,style,[hidden]') || getComputedStyle(el).display === 'none'
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}
export function rangeForAnchor(roots: ReaderRoots, anchor: ReadingAnchor): Range | null {
  const blocks = readingBlocks(roots.body);
  const block =
    blocks.find((el) => el.dataset.line === anchor.blockKey) ??
    blocks.find((el) => Number(el.dataset.line) >= Number(anchor.blockKey)) ??
    blocks.at(-1);
  if (!block) return null;
  const nodes = texts(block);
  const range = document.createRange();
  let offset = Math.max(0, anchor.textOffset);
  for (const node of nodes) {
    if (offset < node.length) {
      const start = graphemeOffset(node.data, offset);
      const grapheme = segmenter.segment(node.data).containing(start)?.segment ?? '';
      range.setStart(node, start);
      range.setEnd(node, Math.min(start + Math.max(1, grapheme.length), node.length));
      return range;
    }
    offset -= node.length;
  }
  range.selectNodeContents(block);
  return range;
}
export function captureAnchor(roots: ReaderRoots): ReadingAnchor | null {
  const viewport = roots.mode === 'page' && roots.pageContainer ? roots.pageContainer : roots.box;
  const view = viewport.getBoundingClientRect();
  const top =
    roots.mode === 'scroll'
      ? Math.max(view.top + (roots.box.hasAttribute('data-unp-viewport') ? 1 : 65), 0)
      : view.top;
  const blocks = readingBlocks(roots.body);
  for (const block of blocks) {
    if (block.hasAttribute('data-unp-empty')) continue;
    const visible = [...block.getClientRects()].some(
      (r) =>
        r.bottom > top + 1 &&
        r.top < view.bottom &&
        r.right > view.left + 1 &&
        r.left < view.right - 1
    );
    if (!visible) continue;
    let offset = 0;
    for (const node of texts(block)) {
      // Range measurement only on the first visible block; binary search within wrapped text.
      let lo = 0,
        hi = node.length;
      const r = document.createRange();
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        r.setStart(node, mid);
        r.setEnd(node, Math.min(mid + 1, node.length));
        const rect = r.getBoundingClientRect();
        const before = roots.mode === 'page' ? rect.right <= view.left + 1 : rect.bottom <= top + 1;
        if (before) lo = mid + 1;
        else hi = mid;
      }
      if (lo < node.length) {
        r.setStart(node, lo);
        r.setEnd(node, lo + 1);
        const rect = r.getBoundingClientRect();
        if (
          rect.width &&
          rect.height &&
          rect.right > view.left &&
          rect.left < view.right &&
          rect.bottom > top &&
          rect.top < view.bottom
        )
          return {
            episodeId: roots.episodeId,
            blockKey: block.dataset.line ?? '0',
            textOffset: offset + graphemeOffset(node.data, lo),
            edge: 'text',
          };
      }
      offset += node.length;
    }
    // A paragraph's bottom padding may be visible after all of its glyphs have
    // scrolled out. Anchor the next visible text, not the start of that paragraph.
    if (!block.querySelector('img,svg,video,table')) continue;
    return {
      episodeId: roots.episodeId,
      blockKey: block.dataset.line ?? '0',
      textOffset: 0,
      edge: 'before',
    };
  }
  return null;
}
