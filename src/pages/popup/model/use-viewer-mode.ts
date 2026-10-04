import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getViewerModeStatus,
  setViewerMode,
  subscribeViewerMode,
  type ViewerModeStatus,
} from '@/features/viewer-mode';

export function useViewerMode() {
  const [status, setStatus] = useState<ViewerModeStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const changing = useRef(false);
  const refresh = useCallback(async () => {
    if (changing.current) return;
    const current = ++request.current;
    setError('');
    setLoading(true);
    try {
      const next = await getViewerModeStatus();
      if (current === request.current) setStatus(next);
    } catch (cause) {
      if (current === request.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeViewerMode(() => void refresh());
    return () => {
      ++request.current;
      unsubscribe();
    };
  }, [refresh]);

  const change = useCallback(async (enabled: boolean) => {
    if (changing.current) return;
    changing.current = true;
    ++request.current;
    try {
      const result = await setViewerMode(enabled);
      setStatus((current) =>
        current ? { ...current, enabled, connected: result.connected } : current
      );
    } finally {
      changing.current = false;
      setLoading(false);
    }
  }, []);

  return { status, error, loading, refresh, change };
}
