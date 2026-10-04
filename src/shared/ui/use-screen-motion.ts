import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animateElement } from '@/shared/lib/motion';
import { motionDuration } from '@/shared/config/motion';

/** Retained screens keep their form state; only their presentation changes. */
export function useScreenMotion(ref: RefObject<HTMLElement | null>, key: string) {
  const previous = useRef(key);
  useLayoutEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    const element = ref.current;
    if (!element) return;
    const animation = animateElement(element, [{ opacity: 0 }, { opacity: 1 }], {
      duration: motionDuration.popover * 1000,
      easing: 'ease-out',
    });
    void animation.finished.then(animation.cancel);
    return animation.cancel;
  }, [key, ref]);
}
