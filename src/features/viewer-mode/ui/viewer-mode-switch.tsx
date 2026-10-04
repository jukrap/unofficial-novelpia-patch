import { useId, useRef, useState } from 'react';
import { Toggle } from '@/shared/ui/toggle';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import styles from './viewer-mode-switch.css?inline';

export interface ViewerModeSwitchProps {
  enabled: boolean;
  onChangeAsync: (enabled: boolean) => Promise<void>;
  context: 'viewer' | 'options' | 'popup';
  connected?: boolean;
}

export function ViewerModeSwitch({
  enabled,
  onChangeAsync,
  context,
  connected = false,
}: ViewerModeSwitchProps) {
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changing = useRef(false);
  const description =
    context === 'viewer' || (context === 'popup' && connected)
      ? '변경하면 현재 회차를 새로고침합니다.'
      : '열린 뷰어에는 새로고침 후 적용됩니다.';

  const change = async (next: boolean) => {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    setError('');
    try {
      await onChangeAsync(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="viewer-mode-setting" aria-busy={busy}>
      <style>{styles}</style>
      <div className="viewer-mode-setting-row">
        <div className="viewer-mode-setting-copy">
          <span className="viewer-mode-setting-label">확장 뷰어 사용</span>
          <p id={descriptionId}>{description}</p>
        </div>
        <div className="viewer-mode-setting-action">
          <span className="viewer-mode-setting-busy">
            <DelayedLoading busy={busy} label="뷰어 전환 중" variant="spinner" />
          </span>
          <Toggle
            label="확장 뷰어 사용"
            value={enabled}
            onChange={(next) => void change(next)}
            disabled={busy}
            busy={busy}
            descriptionId={descriptionId}
            showValue={false}
          />
        </div>
      </div>
      {error ? (
        <p className="viewer-mode-setting-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
