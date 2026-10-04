import { MotionButton } from '@/shared/ui/motion-button';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icon';
import { AnimatePresence, m, useIsPresent, useReducedMotion } from 'motion/react';
import { motionDuration } from '@/shared/config/motion';

interface ToastNotice {
  id: number;
  message: string;
}

function ActionToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const element = useRef<HTMLDivElement>(null);
  const remaining = useRef(4000);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  useEffect(() => {
    const toast = element.current;
    toast?.showPopover();
    return () => {
      if (toast?.isConnected && toast.matches(':popover-open')) toast.hidePopover();
    };
  }, []);
  useEffect(() => {
    if (paused || !present) return;
    const started = performance.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [paused, present, onDismiss]);
  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : motionDuration.popover }}
      inert={!present}
      aria-hidden={!present || undefined}
      ref={element}
      popover="manual"
      className="action-toast"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span role="status" aria-live="polite" aria-atomic="true">
        {message}
      </span>
      <MotionButton
        type="button"
        className="icon-button"
        aria-label="알림 닫기"
        onClick={onDismiss}
      >
        <Icon name="close" />
      </MotionButton>
    </m.div>
  );
}

export function useToast(): { notify: (message: string) => void; toast: ReactNode } {
  const sequence = useRef(0);
  const [notice, setNotice] = useState<ToastNotice | null>(null);
  const notify = useCallback((message: string) => {
    setNotice({ id: ++sequence.current, message });
  }, []);
  const dismiss = useCallback(() => setNotice(null), []);
  return {
    notify,
    toast: (
      <AnimatePresence>
        {notice ? (
          <ActionToast key={notice.id} message={notice.message} onDismiss={dismiss} />
        ) : null}
      </AnimatePresence>
    ),
  };
}
