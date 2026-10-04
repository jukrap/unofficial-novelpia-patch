import { animateElement, type MotionPlayback } from '@/shared/lib/motion';
import { motionDuration } from '@/shared/config/motion';

export const initialReadingLines =
  ':is(#novel_drawing,#novel_drawing_page)>.line[data-line]:not(:has(iframe,[id*="banner"],[class*="banner"],[data-service]))';

/** Fade owned paper and visible fiction only. Never fade a parent containing ads,
 * native buttons, access notices or service modals. */
export function revealReading(): MotionPlayback {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !CSS.registerProperty)
    return { finished: Promise.resolve(), cancel() {} };
  try {
    CSS.registerProperty({
      name: '--unp-initial-alpha',
      syntax: '<number>',
      inherits: true,
      initialValue: '1',
    });
  } catch {
    // The same document may already have this owned property after a reconnect.
  }
  const root = document.documentElement;
  const previous = root.style.getPropertyValue('--unp-initial-alpha');
  const priority = root.style.getPropertyPriority('--unp-initial-alpha');
  const viewport = document.querySelector('#novel_box')?.getBoundingClientRect();
  const targets = [
    ...document.querySelectorAll<HTMLElement>(`${initialReadingLines},#unp-navigation-host`),
  ].filter((element) =>
    [...element.getClientRects()].some(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > (viewport?.left ?? 0) &&
        rect.left < (viewport?.right ?? innerWidth) &&
        rect.bottom > 0 &&
        rect.top < innerHeight
    )
  );
  const duration = motionDuration.reading * 1000;
  root.style.setProperty('--unp-initial-alpha', '0');
  const animations: MotionPlayback[] = [];
  let stopped = false;
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    animations.forEach((animation) => animation.cancel());
    if (previous) root.style.setProperty('--unp-initial-alpha', previous, priority);
    else root.style.removeProperty('--unp-initial-alpha');
  };
  try {
    for (const element of targets)
      animations.push(
        animateElement(element, [{ opacity: 0 }, { opacity: getComputedStyle(element).opacity }], {
          duration,
          easing: 'ease-out',
        })
      );
    animations.push(
      animateElement(root, [{ '--unp-initial-alpha': 0 }, { '--unp-initial-alpha': 1 }], {
        duration,
        easing: 'ease-out',
      })
    );
  } catch {
    // An unsupported animation must never leave the text or paper transparent.
    cancel();
  }
  return {
    finished: Promise.all(animations.map((animation) => animation.finished)).then(cancel),
    cancel,
  };
}
