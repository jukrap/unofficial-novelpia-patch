import { useLayoutEffect, useState } from 'react';
import type { Settings } from '@/shared/model/preferences';
import {
  resolveBackgroundImage,
  acquireCachedBackgroundImage,
  type ResolvedBackgroundImage,
} from '@/shared/platform/background-assets';

export type ImageLoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export function useBackgroundImage(settings: Settings, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    url: string | null;
    status: ImageLoadStatus;
    error: string;
    reveal: boolean;
  }>({ url: null, status: 'idle', error: '', reveal: false });
  useLayoutEffect(() => {
    const wanted =
      enabled &&
      settings.backgroundType === 'image' &&
      Boolean(
        settings.backgroundImageSource !== 'url'
          ? settings.backgroundAssetId
          : settings.backgroundImage
      );
    if (!wanted) {
      setState({ url: null, status: 'idle', error: '', reveal: false });
      return;
    }
    // Restore a cached lease before paint. A remounted tab must not flash its empty preview.
    const cached = acquireCachedBackgroundImage(settings);
    if (cached) {
      setState({ url: cached.url, status: 'ready', error: '', reveal: false });
      return cached.release;
    }
    const controller = new AbortController();
    let image: ResolvedBackgroundImage | null = null;
    setState({ url: null, status: 'loading', error: '', reveal: false });
    void resolveBackgroundImage(settings, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return result?.release();
        image = result;
        setState({
          url: result?.url ?? null,
          status: result ? 'ready' : 'idle',
          error: '',
          reveal: Boolean(result && !result.reused),
        });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            url: null,
            status: 'error',
            error: cause instanceof Error ? cause.message : String(cause),
            reveal: false,
          });
      }
    );
    return () => {
      controller.abort();
      image?.release();
    };
  }, [
    enabled,
    settings.backgroundType,
    settings.backgroundImageSource,
    settings.backgroundAssetId,
    settings.backgroundImage,
    attempt,
  ]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
