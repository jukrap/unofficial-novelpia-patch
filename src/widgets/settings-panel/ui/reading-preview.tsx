import { MotionButton } from '@/shared/ui/motion-button';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { getFontCatalog, subscribeFonts } from '@/shared/platform/user-fonts';
import type { Settings } from '@/shared/model/preferences';
import { FontLoader, fontFamily, effectiveWeight, authorWeight } from '@/entities/reader';
import { emphasisHighlight, emphasisShadow } from '@/shared/config/emphasis';
import { LoadingIndicator, useDelayedBusy } from '@/shared/ui/loading-indicator';
import { useBackgroundImage } from '@/shared/ui/use-background-image';
import { animateElement } from '@/shared/lib/motion';
import { motionDuration } from '@/shared/config/motion';
import imageStyles from './reading-preview-loading.css?inline';
import { useFontRetry } from '../model/font-retry';

export function ReadingPreview({
  settings,
  loadFont,
  compact = false,
}: {
  settings: Settings;
  loadFont: boolean;
  compact?: boolean;
}) {
  const fonts = useSyncExternalStore(subscribeFonts, getFontCatalog);
  const [loader, setLoader] = useState(() => new FontLoader());
  const retry = useFontRetry();
  const retryRevision = retry?.revision ?? 0;
  const [fontBusy, setFontBusy] = useState(false);
  const [fontError, setFontError] = useState('');
  const image = useBackgroundImage(settings, loadFont);
  const imageLayer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!image.reveal || !image.url || !imageLayer.current) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;
    // CSS keyframes restart when a retained tab changes from display:none to visible.
    // Start one presentation animation for this decoded resource instead.
    const animation = animateElement(imageLayer.current, [{ opacity: 0 }, { opacity: 1 }], {
      duration: motionDuration.popover * 1000,
      easing: 'ease-out',
    });
    const reduce = () => {
      if (motion.matches) animation.cancel();
    };
    motion.addEventListener('change', reduce);
    return () => {
      animation.cancel();
      motion.removeEventListener('change', reduce);
    };
  }, [image.url, image.reveal]);
  const showImageLoading = useDelayedBusy(image.status === 'loading');
  const showFontLoading = useDelayedBusy(fontBusy);
  useEffect(() => () => loader.dispose(), [loader]);
  useEffect(() => {
    let active = true;
    setFontError('');
    setFontBusy(false);
    if (!loadFont) return;
    setFontBusy(true);
    void loader.loadReading(settings).then(
      () => {
        if (active) setFontBusy(false);
      },
      (cause: unknown) => {
        if (active) {
          setFontBusy(false);
          setFontError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    );
    return () => {
      active = false;
    };
  }, [
    loadFont,
    loader,
    settings.fontFamily,
    settings.fontWeight,
    settings.forceBold,
    settings.fontSize,
    retryRevision,
    fonts,
  ]);
  const typography: CSSProperties = {
    fontFamily: fontFamily(settings.fontFamily),
    fontSize: settings.fontSize,
    fontWeight: effectiveWeight(settings),
    lineHeight: settings.lineHeight / 100,
    letterSpacing: `${settings.letterSpacing}px`,
    wordBreak: settings.wordBreakMode,
    color: settings.textColor,
    backgroundColor: `${settings.textAreaBackgroundColor}${Math.round(
      settings.textAreaOpacity * 2.55
    )
      .toString(16)
      .padStart(2, '0')}`,
  };
  const emphasis: CSSProperties = {
    fontWeight: authorWeight(settings),
    ...(settings.enhanceBoldTextStyle === 'highlight'
      ? { background: emphasisHighlight(settings.textColor), borderRadius: 3 }
      : {}),
    ...(settings.enhanceBoldTextStyle === 'shadow'
      ? { textShadow: emphasisShadow(settings.darkMode) }
      : {}),
    ...(settings.enhanceBoldTextStyle === 'border'
      ? { borderBlock: '2px solid currentColor' }
      : {}),
  };
  const overlay = `${settings.overlayColor}${Math.round(settings.overlayOpacity * 2.55)
    .toString(16)
    .padStart(2, '0')}`;
  return (
    <figure className={`reading-preview ${compact ? 'compact-preview' : ''}`}>
      <style>{imageStyles}</style>
      {!compact ? <figcaption>미리보기</figcaption> : null}
      <div
        className="preview-surface"
        aria-busy={image.status === 'loading' || fontBusy}
        style={{
          backgroundColor: settings.backgroundColor,
        }}
      >
        {image.url ? (
          <div
            key={image.url}
            ref={imageLayer}
            className="preview-image-layer"
            data-reveal={image.reveal}
            aria-hidden="true"
            style={{
              backgroundImage: `linear-gradient(${overlay}, ${overlay}), url(${JSON.stringify(image.url)})`,
            }}
          />
        ) : null}
        <div className="preview-copy" style={typography} data-testid="typography-preview">
          <p style={{ paddingBottom: settings.paragraphGap }}>
            창가에 <strong style={emphasis}>책을 펼쳤다.</strong>
          </p>
          <p>조용한 오후가 천천히 흘러갔다.</p>
        </div>
        {showImageLoading ? (
          <div className="preview-image-loading">
            <LoadingIndicator variant="spinner" label="배경 이미지 불러오는 중" />
          </div>
        ) : null}
        {showFontLoading && !showImageLoading ? (
          <div className="preview-font-loading">
            <LoadingIndicator label="미리보기 글꼴 불러오는 중" />
          </div>
        ) : null}
      </div>
      {image.error ? (
        <div className="preview-load-error" role="alert">
          <span>{image.error}</span>
          <MotionButton type="button" onClick={image.retry}>
            다시 시도
          </MotionButton>
        </div>
      ) : null}
      {fontError ? (
        <div className="preview-load-error" role="alert">
          <span>{fontError}</span>
          <MotionButton
            type="button"
            onClick={() => (retry ? retry.retry() : setLoader(new FontLoader()))}
          >
            다시 시도
          </MotionButton>
        </div>
      ) : null}
    </figure>
  );
}
