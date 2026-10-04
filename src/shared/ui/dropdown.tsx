import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icon';

export function Dropdown({
  label,
  trigger,
  className = '',
  overlay = true,
  viewportEndSelector,
  viewportKey,
  children,
}: {
  label: string;
  trigger: ReactNode;
  className?: string;
  overlay?: boolean;
  viewportEndSelector?: string;
  viewportKey?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const anchor = useRef({ left: 0, top: 0 });
  const placement = useRef({ down: true, upper: 12 });
  const previousViewportKey = useRef(viewportKey);
  const id = useId();
  const alignPopup = () => {
    const menu = popup.current;
    const trigger = button.current;
    if (!menu || !trigger || !menu.matches(':popover-open')) return;
    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${placement.current.down ? rect.bottom + 6 : Math.max(placement.current.upper, rect.top - menu.getBoundingClientRect().height - 6)}px`;
  };
  const fitViewport = (menu: HTMLDivElement) => {
    if (!viewportEndSelector) return;
    const end = menu.querySelector<HTMLElement>(viewportEndSelector);
    if (!end) return;
    const bounds = menu.getBoundingClientRect();
    const style = getComputedStyle(menu);
    const scale = bounds.width / Number.parseFloat(style.width) || 1;
    const height =
      (end.getBoundingClientRect().bottom - bounds.top) / scale +
      menu.scrollTop +
      Number.parseFloat(style.borderBottomWidth);
    menu.style.height = `${Math.ceil(height)}px`;
  };
  const close = () => {
    if (popup.current?.matches(':popover-open')) popup.current.hidePopover();
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  const show = () => {
    if (!overlay) {
      setOpen(true);
      return;
    }
    const menu = popup.current,
      trigger = button.current;
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    anchor.current = { left: rect.left, top: rect.top };
    const container = trigger.closest('.panel');
    const panel =
      container && getComputedStyle(container).overflowY !== 'visible'
        ? container.getBoundingClientRect()
        : undefined;
    const upper = Math.max(12, panel ? panel.top + 8 : 12);
    const lower = Math.min(innerHeight - 12, panel ? panel.bottom - 8 : innerHeight - 12);
    const below = lower - rect.bottom - 6,
      above = rect.top - upper - 6;
    const down = below >= 360 || below >= above;
    placement.current = { down, upper };
    const width = Math.min(Math.max(rect.width, 360), innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(80, Math.min(420, down ? below : above))}px`;
    menu.showPopover();
    if (viewportEndSelector) {
      previousViewportKey.current = viewportKey;
      menu.scrollTop = 0;
      fitViewport(menu);
    }
    menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    alignPopup();
    setOpen(true);
    menu.querySelector<HTMLElement>('button,input')?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!overlay || !open) return;
    const menu = popup.current;
    const trigger = button.current;
    if (!menu || !trigger || !menu.matches(':popover-open')) return;
    const changedViewport = previousViewportKey.current !== viewportKey;
    previousViewportKey.current = viewportKey;
    if (changedViewport) menu.scrollTop = 0;
    fitViewport(menu);
    alignPopup();
    if (changedViewport) menu.scrollTop = 0;
  });
  useLayoutEffect(() => {
    if (!overlay || !open || !popup.current || !button.current) return;
    // Categories, search results and decoded fonts can change intrinsic height
    // without moving the trigger. Keep the chosen edge attached after every resize.
    const observer = new ResizeObserver(alignPopup);
    observer.observe(popup.current);
    observer.observe(button.current);
    return () => observer.disconnect();
  }, [overlay, open]);
  useEffect(() => {
    if (!overlay || !open) return;
    const menu = popup.current!;
    const root = menu.getRootNode();
    const dismiss = () => {
      if (menu.matches(':popover-open')) menu.hidePopover();
      setOpen(false);
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return;
      const rect = button.current?.getBoundingClientRect();
      if (
        !rect ||
        Math.abs(rect.top - anchor.current.top) > 1 ||
        Math.abs(rect.left - anchor.current.left) > 1
      )
        dismiss();
    };
    root.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      root.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [overlay, open]);
  return (
    <div
      className={`dropdown ${className}`}
      data-open={open}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="dropdown-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup={overlay ? 'dialog' : undefined}
        onClick={() => (open ? close() : show())}
      >
        {trigger}
        <span className="chevron">
          <Icon name="chevron" />
        </span>
      </button>
      <div
        ref={popup}
        id={id}
        className={`dropdown-body${overlay ? ' dropdown-popup' : ''}`}
        hidden={overlay ? undefined : !open}
        popover={overlay ? 'auto' : undefined}
        role={overlay ? 'dialog' : undefined}
        aria-label={overlay ? `${label} 목록` : undefined}
        onToggle={overlay ? (event) => setOpen(event.newState === 'open') : undefined}
      >
        {children(close)}
      </div>
    </div>
  );
}
