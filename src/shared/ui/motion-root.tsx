import { LazyMotion, domAnimation, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { motionDuration, motionEase } from '@/shared/config/motion';

export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: motionDuration.control, ease: [...motionEase] }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
