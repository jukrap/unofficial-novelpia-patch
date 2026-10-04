export { createRoot } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { ReaderNavigation as Navigation } from '@/widgets/reader-navigation';
import { MotionRoot } from '@/shared/ui/motion-root';
export { navigationStyles } from '@/widgets/reader-navigation';
export function ReaderNavigation(props: ComponentProps<typeof Navigation>) {
  return (
    <MotionRoot>
      <Navigation {...props} />
    </MotionRoot>
  );
}
