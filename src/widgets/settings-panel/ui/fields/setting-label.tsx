import { useEffect, useRef, useState } from 'react';
import { usePopoverMotion } from '@/shared/ui/use-popover-motion';
import { settingHelp } from '../../config/help';
export function SettingLabel({
  label,
  htmlFor,
  descriptionId,
}: {
  label: string;
  htmlFor?: string;
  descriptionId: string;
}) {
  const tip = useRef<HTMLDivElement>(null);
  const popupMotion = usePopoverMotion(tip);
  const trigger = useRef<HTMLLabelElement & HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const focused = useRef(false);
  const [open, setOpen] = useState(false);
  const help = settingHelp[label];
  const Tag = htmlFor ? 'label' : 'span';
  const cancelClose = () => clearTimeout(timer.current);
  const close = () => {
    cancelClose();
    popupMotion.hide();
    setOpen(false);
  };
  const closeLater = () => {
    cancelClose();
    timer.current = setTimeout(() => {
      if (!hovered.current && !focused.current) close();
    }, 140);
  };
  const show = () => {
    cancelClose();
    const popup = tip.current,
      anchor = trigger.current;
    if (!popup || !anchor || !help) return;
    popup.showPopover();
    popupMotion.reveal();
    const rect = anchor.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - bounds.width - 12))}px`;
    popup.style.top = `${Math.max(12, rect.bottom + 8 + bounds.height > innerHeight - 12 ? rect.top - bounds.height - 8 : rect.bottom + 8)}px`;
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const hide = () => {
      if (tip.current?.matches(':popover-open')) tip.current.hidePopover();
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hide();
      }
    };
    const scroll = (event: Event) => {
      if (event.target !== tip.current) hide();
    };
    document.addEventListener('keydown', escape, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="label">
      <Tag
        ref={trigger}
        htmlFor={htmlFor}
        className={help ? 'label-help' : undefined}
        tabIndex={help ? 0 : undefined}
        aria-describedby={help ? descriptionId : undefined}
        onPointerEnter={() => {
          hovered.current = true;
          show();
        }}
        onPointerLeave={() => {
          hovered.current = false;
          closeLater();
        }}
        onFocus={() => {
          focused.current = true;
          show();
        }}
        onBlur={() => {
          focused.current = false;
          closeLater();
        }}
      >
        {label}
      </Tag>
      {help ? (
        <div
          ref={tip}
          id={descriptionId}
          role="tooltip"
          popover="auto"
          className="label-tooltip"
          onToggle={(event) => setOpen(event.newState === 'open')}
          onPointerEnter={() => {
            hovered.current = true;
            cancelClose();
          }}
          onPointerLeave={() => {
            hovered.current = false;
            closeLater();
          }}
        >
          {help}
        </div>
      ) : null}
    </div>
  );
}
