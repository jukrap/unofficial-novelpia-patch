import { MotionButton } from '@/shared/ui/motion-button';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Icon } from './icon';
import { MotionChevron } from './motion-chevron';
import { usePopoverMotion } from './use-popover-motion';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
  textStyle?: CSSProperties;
}

export function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const popupMotion = usePopoverMotion(popup);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useRef({ text: '', time: 0 });
  const anchor = useRef({ left: 0, top: 0 });
  const selected = options.find((option) => option.value === value);
  const enabled = options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const groups: { name: string; items: { option: SelectOption; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const name = option.group ?? '';
    if (groups.at(-1)?.name !== name) groups.push({ name, items: [] });
    groups.at(-1)!.items.push({ option, index });
  });
  const close = () => {
    popupMotion.hide();
    setOpen(false);
    search.current = { text: '', time: 0 };
  };
  const show = (
    index = options.findIndex((option) => option.value === value && !option.disabled)
  ) => {
    const menu = popup.current,
      button = trigger.current;
    if (!menu || !button || !enabled.length) return;
    setActive(index >= 0 ? index : enabled[0]!);
    const rect = button.getBoundingClientRect();
    anchor.current = { left: rect.left, top: rect.top };
    const panel = button.closest('.panel')?.getBoundingClientRect();
    const lower = Math.min(innerHeight - 12, panel ? panel.bottom - 8 : innerHeight - 12);
    const upper = Math.max(12, panel ? panel.top + 8 : 12);
    const below = lower - rect.bottom - 5,
      above = rect.top - upper - 5;
    const down = below >= Math.min(300, options.length * 38 + 10) || below >= above;
    const width = Math.min(Math.max(rect.width, 220), innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(40, Math.min(300, down ? below : above))}px`;
    menu.showPopover();
    popupMotion.reveal();
    menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    menu.style.top = `${down ? rect.bottom + 5 : Math.max(upper, rect.top - menu.getBoundingClientRect().height - 5)}px`;
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
    trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    const menu = popup.current!;
    const option = menu.querySelector<HTMLElement>(`[data-option-index="${active}"]`);
    if (option) {
      const item = option.getBoundingClientRect(),
        box = menu.getBoundingClientRect();
      if (item.top < box.top + 5) menu.scrollTop -= box.top + 5 - item.top;
      else if (item.bottom > box.bottom - 5) menu.scrollTop += item.bottom - box.bottom + 5;
    }
  }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const menu = popup.current!;
    const root = menu.getRootNode();
    const dismiss = () => {
      popupMotion.hide();
      setOpen(false);
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return;
      const rect = trigger.current?.getBoundingClientRect();
      // A scroll queued before opening can arrive afterward without moving the anchor.
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
  }, [open]);
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const key = event.key;
    if (key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (key === 'Tab') {
      if (open) choose(active);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      if (key === 'Enter' || key === ' ') {
        if (open) choose(active);
        else show();
      } else if (key === 'Home') {
        if (open) setActive(enabled[0]!);
        else show(enabled[0]);
      } else if (key === 'End') {
        if (open) setActive(enabled.at(-1)!);
        else show(enabled.at(-1));
      } else if (!open) show();
      else {
        const at = enabled.indexOf(active);
        setActive(
          enabled[Math.max(0, Math.min(enabled.length - 1, at + (key === 'ArrowDown' ? 1 : -1)))]!
        );
      }
      return;
    }
    if (
      key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.nativeEvent.isComposing
    ) {
      const now = Date.now();
      const text = now - search.current.time < 600 ? search.current.text + key : key;
      search.current = { text, time: now };
      const index = options.findIndex(
        (option) =>
          !option.disabled && option.label.toLocaleLowerCase().startsWith(text.toLocaleLowerCase())
      );
      if (index >= 0) {
        event.preventDefault();
        if (open) setActive(index);
        else show(index);
      }
    }
  };
  return (
    <div className="select-field">
      <MotionButton
        ref={trigger}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        data-value={value}
        onClick={() => (open ? close() : show())}
        onKeyDown={keyboard}
        onBlur={(event) => {
          if (!popup.current?.contains(event.relatedTarget)) close();
        }}
      >
        <span style={selected?.textStyle}>{selected?.label ?? value}</span>
        <MotionChevron open={open} />
      </MotionButton>
      <div
        ref={popup}
        id={id}
        popover="auto"
        role="listbox"
        aria-label={label}
        className="select-list"
        onToggle={(event) => {
          setOpen(event.newState === 'open');
          if (event.newState === 'closed') search.current = { text: '', time: 0 };
        }}
      >
        {groups.map((group) => (
          <div
            key={group.name}
            role={group.name ? 'group' : 'presentation'}
            aria-label={group.name || undefined}
          >
            {group.name ? (
              <div className="select-group" role="presentation">
                {group.name}
              </div>
            ) : null}
            {group.items.map(({ option, index }) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                data-option-index={index}
                role="option"
                aria-selected={value === option.value}
                aria-disabled={option.disabled || undefined}
                className={`select-option ${active === index ? 'highlighted' : ''}`}
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onPointerDown={(event) => {
                  if (event.pointerType === 'mouse') event.preventDefault();
                }}
                onClick={() => choose(index)}
              >
                <span style={option.textStyle}>{option.label}</span>
                {value === option.value ? <Icon name="check" /> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
