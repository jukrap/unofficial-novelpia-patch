import { useEffect, useRef, useState } from 'react';
import { animateElement } from '@/shared/lib/motion';
import loadingStyles from './loading-indicator.css?inline';

export function useDelayedBusy(busy: boolean, delay = 150): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!busy) return;
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [busy, delay]);
  return busy && shown;
}
export function LoadingIndicator({
  label = '불러오는 중',
  variant = 'book',
}: {
  label?: string;
  variant?: 'book' | 'spinner';
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const target = ref.current?.querySelector<SVGElement>(
      variant === 'book' ? '.unp-loading-page' : 'svg'
    );
    if (!target) return;
    const animation = animateElement(
      target,
      variant === 'book'
        ? [
            { opacity: 0.4, transform: 'translateX(0)' },
            { opacity: 1, transform: 'translateX(-2px)' },
            { opacity: 0.4, transform: 'translateX(0)' },
          ]
        : [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      {
        duration: variant === 'book' ? 1100 : 900,
        easing: variant === 'book' ? 'ease-in-out' : 'linear',
        iterations: Infinity,
      }
    );
    return animation.cancel;
  }, [variant]);
  return (
    <span
      ref={ref}
      className={`unp-loading-indicator unp-loading-${variant}`}
      role="status"
      aria-label={label}
    >
      <style>{loadingStyles}</style>
      {variant === 'book' ? (
        <svg viewBox="0 0 32 24" fill="none" aria-hidden="true">
          <path d="M16 21C12 18 6 18 2 20V3C7 1 12 2 16 5C20 2 25 1 30 3V20C26 18 20 18 16 21ZM16 5V21" />
          <path className="unp-loading-page" d="M21 7L26 6M21 11L26 10M21 15L26 14" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="unp-loading-track" cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 1 9 9" />
        </svg>
      )}
      <span className="unp-loading-sr">{label}</span>
    </span>
  );
}
export function DelayedLoading({
  busy,
  label,
  variant,
}: {
  busy: boolean;
  label?: string;
  variant?: 'book' | 'spinner';
}) {
  const shown = useDelayedBusy(busy);
  return shown ? <LoadingIndicator label={label} variant={variant} /> : null;
}
