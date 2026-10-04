export const protectedSelector =
  'iframe, [id*="banner"], [class*="banner"], .curation-wrapper, #writer_comments_box, [id*="payment"], .cover-wrapper, [data-service]';
export interface ReaderRoots {
  box: HTMLElement;
  text: HTMLElement;
  body: HTMLElement;
  pageContainer: HTMLElement | null;
  mode: 'scroll' | 'page';
  episodeId: string;
}
export function detectReader(): ReaderRoots | null {
  const box = document.querySelector<HTMLElement>('#novel_box');
  const text = document.querySelector<HTMLElement>('#novel_text');
  const scroll = document.querySelector<HTMLElement>('#novel_drawing');
  const page = document.querySelector<HTMLElement>('#novel_drawing_page');
  if (!box || !text) return null;
  const pageMode =
    !!page?.querySelector('.line') &&
    getComputedStyle(page).display !== 'none' &&
    (!scroll?.querySelector('.line') || getComputedStyle(scroll).display === 'none');
  const body = pageMode ? page : scroll;
  if (!body?.querySelector('.line')) return null;
  const episodeId =
    location.pathname.match(/\/viewer\/(\d+)/)?.[1] ??
    document.querySelector<HTMLInputElement>('#content_no')?.value;
  if (!episodeId) return null;
  return {
    box,
    text,
    body,
    pageContainer: document.querySelector('#novel_drawing_page_c'),
    mode: pageMode ? 'page' : 'scroll',
    episodeId,
  };
}
export function readingBlocks(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.line[data-line]')].filter(
    (el) =>
      !el.matches(protectedSelector) &&
      !el.querySelector(protectedSelector) &&
      !el.closest(protectedSelector)
  );
}
export function inputIsBusy(event?: Event): boolean {
  const path = event?.composedPath() ?? [document.activeElement];
  if (
    path.some(
      (el) =>
        el instanceof HTMLElement &&
        (el.closest(
          'input,textarea,select,button,a,[contenteditable="true"],[role="dialog"],#unp-panel-host'
        ) ||
          el.id === 'unp-panel-host')
    )
  )
    return true;
  if (window.getSelection()?.toString()) return true;
  return [
    ...document.querySelectorAll<HTMLElement>(
      '#theme_box,#comment_box,#list_box,.modal.show,.banner-modal-background.show,[role="dialog"]'
    ),
  ].some((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}
