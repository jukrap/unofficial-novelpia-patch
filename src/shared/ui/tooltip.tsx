import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
/** Hover/focus help for actions, kept in the top layer like setting labels. */
export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const close = () => {
    if (tip.current?.matches(':popover-open')) tip.current.hidePopover();
    setOpen(false);
  };
  const show = () => {
    if (!anchor.current || !tip.current) return;
    tip.current.showPopover();
    const bounds = anchor.current.getBoundingClientRect();
    const popup = tip.current.getBoundingClientRect();
    tip.current.style.left = `${Math.max(12, Math.min(bounds.left, innerWidth - popup.width - 12))}px`;
    tip.current.style.top = `${Math.max(12, bounds.bottom + 8 + popup.height < innerHeight - 12 ? bounds.bottom + 8 : bounds.top - popup.height - 8)}px`;
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  return (
    <span
      ref={anchor}
      className="action-help"
      aria-describedby={id}
      onPointerEnter={show}
      onPointerLeave={close}
      onFocus={show}
      onBlur={close}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <div ref={tip} id={id} role="tooltip" popover="manual" className="label-tooltip">
        {text}
      </div>
    </span>
  );
}
