import { MotionButton } from '@/shared/ui/motion-button';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './icon';
import { m, useIsPresent, useReducedMotion } from 'motion/react';
import { motionDuration } from '@/shared/config/motion';
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const scope = dialog?.getRootNode();
    const opener = scope instanceof ShadowRoot ? scope.activeElement : document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <m.dialog
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : motionDuration.popover }}
      inert={!present}
      aria-hidden={!present || undefined}
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <MotionButton type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
          <Icon name="close" />
        </MotionButton>
      </header>
      {children}
    </m.dialog>
  );
}
