import { MotionButton } from '@/shared/ui/motion-button';
import { useEffect, useRef, useState } from 'react';
import { defaults } from '@/entities/settings';
import type { Preset } from '@/shared/model/preferences';
import { ReadingPreview } from '../reading-preview';

export function PresetCard({
  preset,
  current,
  busy,
  onApply,
  onEdit,
  onDuplicate,
}: {
  preset: Preset;
  current: boolean;
  busy: boolean;
  onApply: () => void;
  onEdit?: () => void;
  onDuplicate: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = card.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const settings = { ...defaults, ...preset.settings };
  return (
    <article
      className={`preset-card${current ? ' preset-card-current' : ''}`}
      ref={card}
      aria-label={preset.name}
      data-preset-id={preset.id}
    >
      <header className="preset-card-heading">
        <h4>{preset.name}</h4>
        {current ? <span className="preset-current">현재 사용 중</span> : null}
      </header>
      {preset.description ? <p className="preset-card-description">{preset.description}</p> : null}
      <ReadingPreview settings={settings} loadFont={visible} compact />
      <dl className="preset-card-metrics">
        <div>
          <dt>읽기</dt>
          <dd>
            {settings.readingMode == null
              ? '현재 방식 유지'
              : settings.readingMode === 'scroll'
                ? '스크롤'
                : settings.spreadMode === 'single'
                  ? '페이지 · 한 쪽'
                  : '페이지 · 자동 한/두 쪽'}
          </dd>
        </div>
        <div>
          <dt>크기</dt>
          <dd>{settings.fontSize}px</dd>
        </div>
        <div>
          <dt>줄 간격</dt>
          <dd>{settings.lineHeight}%</dd>
        </div>
        {settings.paragraphGap > 0 ? (
          <div>
            <dt>문단 간격</dt>
            <dd>{settings.paragraphGap}px</dd>
          </div>
        ) : null}
        <div>
          <dt>너비</dt>
          <dd>{settings.maxWidth}px</dd>
        </div>
        <div>
          <dt>높이</dt>
          <dd>{settings.readerHeightPercent}%</dd>
        </div>
        <div>
          <dt>여백</dt>
          <dd>
            좌우 {settings.horizontalPadding}px, 상하 {settings.verticalPadding}px
          </dd>
        </div>
      </dl>
      <div className="preset-card-actions">
        <MotionButton
          type="button"
          className="primary"
          disabled={busy || current}
          aria-label={`${preset.name} 적용`}
          onClick={onApply}
        >
          적용
        </MotionButton>
        {onEdit ? (
          <MotionButton
            type="button"
            disabled={busy}
            aria-label={`${preset.name} 편집`}
            onClick={onEdit}
          >
            편집
          </MotionButton>
        ) : null}
        <MotionButton
          type="button"
          disabled={busy}
          aria-label={`${preset.name} ${preset.isDefault ? '복제하여 편집' : '복제'}`}
          onClick={onDuplicate}
        >
          {preset.isDefault ? '복제하여 편집' : '복제'}
        </MotionButton>
      </div>
    </article>
  );
}
