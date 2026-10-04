import { useEffect, useImperativeHandle, useRef, type ComponentPropsWithRef } from 'react';
import { animateElement, type MotionPlayback } from '@/shared/lib/motion';
import { motionDuration } from '@/shared/config/motion';

const paint = (element: HTMLButtonElement) => {
  const style = getComputedStyle(element);
  return {
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    color: style.color,
    filter: style.filter,
  };
};

/** CSS owns state colors; Motion interpolates and releases its inline values.
 * Selection, disabled state and theme changes must never retain an old fill. */
export function MotionButton({
  ref,
  onPointerEnter,
  onPointerLeave,
  ...props
}: ComponentPropsWithRef<'button'>) {
  const element = useRef<HTMLButtonElement>(null);
  const running = useRef<MotionPlayback | null>(null);
  useImperativeHandle(ref, () => element.current!);
  useEffect(() => () => running.current?.cancel(), []);
  useEffect(() => {
    if (props.disabled) {
      running.current?.cancel();
      element.current?.removeAttribute('data-motion-hover');
    }
  }, [props.disabled]);
  const hover = (active: boolean) => {
    const button = element.current;
    if (!button || button.disabled) return;
    const before = paint(button);
    running.current?.cancel();
    button.toggleAttribute('data-motion-hover', active);
    const animation = animateElement(button, [before, paint(button)], {
      duration: motionDuration.control * 1000,
      easing: 'ease-out',
    });
    running.current = animation;
    void animation.finished.then(() => {
      if (running.current === animation) animation.cancel();
    });
  };
  return (
    <button
      {...props}
      ref={element}
      data-motion-control=""
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') hover(true);
        onPointerEnter?.(event);
      }}
      onPointerLeave={(event) => {
        hover(false);
        onPointerLeave?.(event);
      }}
    />
  );
}
