import { PAGE_GAP_MAX } from '@/shared/config/reader-layout';

export const COLUMN_GAP = 20; // Native page_cal's counting unit remains viewportWidth + 20.
export interface Geometry {
  columns: 1 | 2;
  outerWidth: number;
  textWidth: number;
  height: number;
  pageGap: number;
  columnGap: number;
  columnStride: number;
  spreadStride: number;
}
export function pageGeometry(
  width: number,
  height: number,
  maxWidth: number,
  paddingX: number,
  paddingY: number,
  fontSize: number,
  lineHeight: number,
  spread: 'auto' | 'single',
  requestedGap = COLUMN_GAP
): Geometry {
  const gap = Math.max(0, Math.min(PAGE_GAP_MAX, requestedGap));
  const columns = spread === 'auto' && width >= 2 * maxWidth + gap ? 2 : 1;
  const pageGap = columns === 2 ? gap : COLUMN_GAP;
  const outerWidth = Math.min(width, columns === 2 ? 2 * maxWidth + pageGap : maxWidth);
  const textWidth = (outerWidth - (columns - 1) * pageGap) / columns - 2 * paddingX;
  const innerHeight = height - 2 * paddingY;
  if (
    textWidth < Math.max(40, fontSize * 2) ||
    innerHeight < fontSize * Math.max(lineHeight / 100, 1) * 2 ||
    lineHeight < 100
  )
    throw new Error(
      '페이지에 글을 표시할 공간이 부족합니다. 여백을 줄이거나 크기, 행간을 조절해 주세요.'
    );
  const columnGap = pageGap + 2 * paddingX;
  const columnStride = textWidth + columnGap;
  return {
    columns,
    outerWidth,
    textWidth,
    height: innerHeight,
    pageGap,
    columnGap,
    columnStride,
    spreadStride: columnStride * columns,
  };
}
export function countPages(
  rects: Iterable<DOMRect>,
  left: number,
  columnWidth: number,
  gap: number
) {
  let end = 0;
  for (const rect of rects)
    if (rect.width > 0 && rect.height > 0) end = Math.max(end, rect.right - left);
  return Math.max(1, Math.ceil((end + gap - 0.5) / (columnWidth + gap)));
}
