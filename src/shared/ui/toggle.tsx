import { MotionButton } from '@/shared/ui/motion-button';
import { m, useReducedMotion } from 'motion/react';
import { motionDuration } from '@/shared/config/motion';
export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
  busy = false,
  descriptionId,
  showValue = true,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  descriptionId?: string;
  showValue?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <MotionButton
      type="button"
      className={`toggle ${value ? 'on' : ''}`}
      role="switch"
      aria-checked={value}
      aria-label={label}
      aria-describedby={descriptionId}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => onChange(!value)}
    >
      <span aria-hidden="true">
        <m.i
          className="toggle-thumb"
          initial={false}
          animate={{ x: value ? 14 : 0 }}
          transition={{ duration: reduced ? 0 : motionDuration.control }}
        />
      </span>
      {showValue ? (value ? '사용' : '미사용') : null}
    </MotionButton>
  );
}
