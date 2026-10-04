import { animate } from 'motion/mini';
import { motionEase } from '@/shared/config/motion';

export interface MotionPlayback {
  finished: Promise<void>;
  cancel(): void;
}

/** Motion's native DOM renderer, with explicit cancellation/style restoration.
 * The engine must measure the original layout after a cancelled page effect. */
export function animateElement(
  element: HTMLElement | SVGElement,
  frames: Keyframe[],
  options: KeyframeAnimationOptions
): MotionPlayback {
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (media?.matches || typeof element.animate !== 'function')
    return { finished: Promise.resolve(), cancel() {} };
  const keys = [...new Set(frames.flatMap(Object.keys))].filter(
    (key) => !['offset', 'easing', 'composite'].includes(key)
  );
  const saved = keys.map((key) => {
    const css = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return [
      css,
      element.style.getPropertyValue(css),
      element.style.getPropertyPriority(css),
    ] as const;
  });
  let resolve!: () => void;
  const finished = new Promise<void>((done) => {
    resolve = done;
  });
  const playback = animate(
    element,
    Object.fromEntries(keys.map((key) => [key, frames.map((frame) => frame[key] ?? null)])),
    {
      duration: Number(options.duration ?? 0) / 1000,
      delay: Number(options.delay ?? 0) / 1000,
      ease:
        options.easing === 'linear'
          ? 'linear'
          : options.easing === 'ease-out'
            ? 'easeOut'
            : options.easing === 'ease-in-out'
              ? 'easeInOut'
              : [...motionEase],
      repeat:
        options.iterations === Infinity
          ? Infinity
          : Math.max(0, Number(options.iterations ?? 1) - 1),
      ...(frames.some((frame) => frame.offset !== undefined)
        ? {
            times: frames.map((frame, index) => frame.offset ?? index / (frames.length - 1)),
          }
        : {}),
    }
  );
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    playback.cancel();
    saved.forEach(([key, value, priority]) =>
      value ? element.style.setProperty(key, value, priority) : element.style.removeProperty(key)
    );
    media?.removeEventListener('change', reduce);
    resolve();
  };
  const reduce = () => {
    if (media?.matches) cancel();
  };
  media?.addEventListener('change', reduce);
  void playback.then(() => {
    media?.removeEventListener('change', reduce);
    resolve();
  });
  return { finished, cancel };
}
