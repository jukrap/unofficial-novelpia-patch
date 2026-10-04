import { useEffect, useRef, type RefObject } from 'react';
import { animateElement, type MotionPlayback } from '@/shared/lib/motion';
import { motionDuration } from '@/shared/config/motion';

/** Preserve native top-layer/focus behavior; explicit closes finish a short fade.
 * Native light-dismiss still closes immediately, as required by the browser. */
export function usePopoverMotion(ref: RefObject<HTMLElement | null>) {
  const running = useRef<MotionPlayback | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      running.current?.cancel();
    },
    []
  );
  const reveal = () => {
    const element = ref.current;
    if (!element) return;
    const current = ++generation.current;
    running.current?.cancel();
    element.inert = false;
    element.removeAttribute('aria-hidden');
    const animation = animateElement(element, [{ opacity: 0 }, { opacity: 1 }], {
      duration: motionDuration.popover * 1000,
      easing: 'ease-out',
    });
    running.current = animation;
    void animation.finished.then(() => {
      if (generation.current === current) animation.cancel();
    });
  };
  const hide = () => {
    const element = ref.current;
    if (!element?.isConnected || !element.matches(':popover-open')) return;
    const opacity = getComputedStyle(element).opacity;
    const current = ++generation.current;
    running.current?.cancel();
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
    const animation = animateElement(element, [{ opacity }, { opacity: 0 }], {
      duration: motionDuration.popover * 1000,
      easing: 'ease-out',
    });
    running.current = animation;
    void animation.finished.then(() => {
      if (generation.current !== current) return;
      animation.cancel();
      if (element.isConnected && element.matches(':popover-open')) element.hidePopover();
      element.inert = false;
      element.removeAttribute('aria-hidden');
    });
  };
  return { reveal, hide };
}
