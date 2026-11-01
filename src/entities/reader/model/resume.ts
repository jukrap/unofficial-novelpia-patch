import { parseAnchor, type ReadingAnchor } from './anchor';
import { inputIsBusy, type ReaderRoots } from '../lib/site';

export const positionKey = (episode: string) => `unp.position.v1.${episode}`;

export function completedPosition(value: unknown, episode: string): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    'episodeId' in value &&
    value.episodeId === episode &&
    'completed' in value &&
    value.completed === true
  );
}

export function resumeAnchor(episode: string, ...candidates: unknown[]): ReadingAnchor | null {
  for (const candidate of candidates) {
    if (completedPosition(candidate, episode)) return null;
    const anchor = parseAnchor(candidate);
    if (anchor?.episodeId === episode) return anchor;
  }
  return null;
}

export function readingKeyIntent(event: KeyboardEvent) {
  return (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !inputIsBusy(event) &&
    [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' ',
    ].includes(event.key)
  );
}

export function readingGestureIntent(
  event: Event,
  roots: ReaderRoots,
  service: HTMLElement | null
) {
  if (!(event.target instanceof Element)) return false;
  if (
    event
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLElement &&
          node.closest(
            'input,textarea,select,[contenteditable="true"],[role="dialog"],#unp-panel-host,#theme_box,#comment_box,#list_box'
          )
      ) ||
    [
      ...document.querySelectorAll<HTMLElement>(
        '#theme_box,#comment_box,#list_box,.modal.show,.banner-modal-background.show,[role="dialog"]'
      ),
    ].some(
      (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'
    )
  )
    return false;
  const target = event.target;
  const viewport = roots.mode === 'page' && roots.pageContainer ? roots.pageContainer : roots.box;
  if (event.type === 'pointerdown' && target.closest('#novel_drawing_left,#novel_drawing_right'))
    return true;
  if (event instanceof WheelEvent)
    return !!(
      (event.deltaY || event.deltaX) &&
      (viewport.contains(target) || (roots.mode === 'scroll' && service?.contains(target)))
    );
  if (!viewport.contains(target)) return false;
  if (event.type === 'touchstart') return true;
  if (event.type !== 'pointerdown' || !(event instanceof MouseEvent)) return false;
  // Browser middle-button autoscroll emits scroll events without wheel events.
  // Release the restored anchor before those events, while leaving links/controls alone.
  if (event.button === 1)
    return roots.mode === 'scroll' && !target.closest('a[href],button,[role="button"]');
  if (event.button !== 0) return false;
  // Ordinary clicks toggle native menus; only the viewport scrollbar starts a reading move.
  const rect = viewport.getBoundingClientRect();
  return (
    (viewport.scrollHeight > viewport.clientHeight &&
      event.clientX >= rect.left + viewport.clientLeft + viewport.clientWidth &&
      event.clientX < rect.right) ||
    (viewport.scrollWidth > viewport.clientWidth &&
      event.clientY >= rect.top + viewport.clientTop + viewport.clientHeight &&
      event.clientY < rect.bottom)
  );
}

/** Keeps startup scroll events from overwriting a position that has not been read yet. */
export class ResumeSession {
  private generation = 0;
  private pending = false;
  private readSucceeded = false;
  private interacted = false;

  begin() {
    this.pending = true;
    this.readSucceeded = false;
    this.interacted = false;
    return ++this.generation;
  }

  userIntent() {
    this.interacted = true;
  }

  get canSave() {
    return this.readSucceeded || this.interacted;
  }

  complete(ticket: number, anchor: ReadingAnchor | null, readSucceeded = true) {
    if (ticket !== this.generation || !this.pending) return null;
    this.pending = false;
    this.readSucceeded = readSucceeded;
    return {
      anchor: this.interacted ? null : anchor,
      saveCurrent: this.interacted,
    };
  }
}
