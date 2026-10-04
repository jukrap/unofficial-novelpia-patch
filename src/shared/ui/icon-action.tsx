import { MotionButton } from '@/shared/ui/motion-button';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from './icon';
import { usePopoverMotion } from './use-popover-motion';

export function IconAction({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: IconName;
  disabled?: boolean;
  onClick: () => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const popupMotion = usePopoverMotion(tip);
  const [open, setOpen] = useState(false);
  const hide = () => {
    popupMotion.hide();
    setOpen(false);
  };
  const show = () => {
    if (!tip.current || !anchor.current) return;
    tip.current.showPopover();
    popupMotion.reveal();
    const bounds = anchor.current.getBoundingClientRect();
    const tooltip = tip.current.getBoundingClientRect();
    tip.current.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - tooltip.width - 8))}px`;
    tip.current.style.top = `${Math.max(8, bounds.top - tooltip.height - 8)}px`;
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hide();
      }
    };
    document.addEventListener('keydown', escape, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open]);
  return (
    <span ref={anchor} className="icon-action" onPointerEnter={show} onPointerLeave={hide}>
      <MotionButton
        className="icon-button"
        aria-label={label}
        aria-describedby={id}
        disabled={disabled}
        onFocus={show}
        onBlur={hide}
        onClick={onClick}
      >
        <Icon name={icon} />
      </MotionButton>
      <div ref={tip} id={id} role="tooltip" popover="manual" className="label-tooltip">
        {label}
      </div>
    </span>
  );
}
