import { useEffect, useRef, useState } from 'react';
import { FontLoader, fontFamily } from '@/entities/reader';
import type { UserFont } from '@/shared/model/user-font';
import { DelayedLoading } from '@/shared/ui/loading-indicator';

export function UserFontPreview({ font, loader }: { font: UserFont; loader: FontLoader }) {
  const target = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!target.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setBusy(true);
    setError('');
    void loader
      .load(font.id, 400, 22)
      .catch(() => {
        if (active) setError('미리보기를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [font.id, font.revision, loader, visible, attempt]);
  return (
    <div ref={target} aria-busy={busy}>
      <p className="registered-font-preview" style={{ fontFamily: fontFamily(font.id) }}>
        창가에 책을 펼쳤다. 조용한 오후가 흘러갔다.
      </p>
      <DelayedLoading busy={busy} variant="spinner" label="글꼴 미리보기를 불러오는 중" />
      {error ? (
        <p className="field-error">
          {error}{' '}
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            다시 시도
          </button>
        </p>
      ) : null}
    </div>
  );
}
