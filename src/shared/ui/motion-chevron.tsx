import { m, useReducedMotion } from 'motion/react';
import { motionDuration } from '@/shared/config/motion';
import { Icon } from './icon';

export function MotionChevron({ open }: { open: boolean }) {
  const reduced = useReducedMotion();
  return (
    <m.span
      className="chevron"
      initial={false}
      animate={{ rotate: open ? 180 : 0 }}
      transition={{ duration: reduced ? 0 : motionDuration.popover }}
    >
      <Icon name="chevron" />
    </m.span>
  );
}
