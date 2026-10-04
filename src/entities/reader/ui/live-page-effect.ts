import type { Settings } from '@/shared/model/preferences';
import { animateElement, type MotionPlayback } from '@/shared/lib/motion';

/** Turn the original viewport in two phases. Service DOM and handlers keep
 * their identity; the reading position changes only when the old page is edge-on
 * (or faded out). No service screenshot, clone or alternate click target exists. */
export function livePageEffect(
  effect: Settings['pageEffect'],
  container: HTMLElement,
  body: HTMLElement,
  direction: 1 | -1,
  commit: () => void,
  complete: () => void
): () => void {
  const target = effect === 'fade' ? body : container;
  const base = getComputedStyle(target).transform;
  const transform = (value: string) => `${base === 'none' ? '' : base} ${value}`.trim();
  const duration = effect === 'paper' ? 360 : effect === 'fold' ? 440 : 240;
  const rest: Keyframe =
    effect === 'fade' ? { opacity: getComputedStyle(target).opacity } : { transform: base };
  let exit: Keyframe, entry: Keyframe;
  if (effect === 'fade') {
    exit = entry = { opacity: 0 };
  } else if (effect === 'slide') {
    exit = { transform: transform(`translateX(${-direction * 100}%)`) };
    entry = { transform: transform(`translateX(${direction * 100}%)`) };
  } else {
    const fold = effect === 'fold' ? 4 : 0;
    exit = {
      transform: transform(
        `perspective(1600px) rotateY(${-direction * 90}deg) rotateZ(${-direction * fold}deg)`
      ),
    };
    entry = {
      transform: transform(
        `perspective(1600px) rotateY(${direction * 90}deg) rotateZ(${direction * fold}deg)`
      ),
    };
    if (fold) {
      rest.clipPath = 'polygon(0 0,100% 0,100% 100%,0 100%)';
      exit.clipPath = 'polygon(0 0,0 0,100% 100%,100% 100%)';
      entry.clipPath = 'polygon(100% 0,100% 0,0 100%,0 100%)';
    }
  }
  let animation: MotionPlayback | undefined;
  let cancelled = false;
  let committed = false;
  const apply = () => {
    if (committed) return;
    committed = true;
    commit();
  };
  const timing: KeyframeAnimationOptions = {
    duration: duration / 2,
    easing: 'ease-in-out',
    fill: 'both',
  };
  container.dataset.unpLiveTurn = 'outgoing';
  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(deadline);
    animation?.cancel();
    delete container.dataset.unpLiveTurn;
    apply();
  };
  const deadline = setTimeout(complete, duration + 250);
  try {
    animation = animateElement(target, [rest, exit], timing);
    void animation.finished
      .then(
        () => {
          if (cancelled) return;
          animation?.cancel();
          // Cancel the transform before measuring anchors in the new page.
          apply();
          container.dataset.unpLiveTurn = 'incoming';
          animation = animateElement(target, [entry, rest], timing);
          void animation.finished.then(complete, () => {
            if (!cancelled) complete();
          });
        },
        () => {
          if (!cancelled) complete();
        }
      )
      .catch(complete);
  } catch {
    finish();
    // Let the caller register its cleanup before completing a failed animation.
    queueMicrotask(complete);
  }
  return finish;
}
