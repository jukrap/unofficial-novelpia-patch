import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import type { OptionsScreenProps } from '../model/contracts';

export type ScreenLoader = () => Promise<{ default: ComponentType<OptionsScreenProps> }>;
export function DeferredScreen({ load, ...props }: OptionsScreenProps & { load: ScreenLoader }) {
  const [Screen, setScreen] = useState<ComponentType<OptionsScreenProps> | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void load().then(
      (module) => {
        if (active) setScreen(() => module.default);
      },
      () => {
        if (active)
          setError(
            '화면을 불러오지 못했습니다. 확장프로그램을 업데이트했다면 이 페이지를 새로고침해 주세요.'
          );
      }
    );
    return () => {
      active = false;
    };
  }, [load, attempt]);
  if (Screen) return <Screen {...props} />;
  return (
    <div className="deferred-screen" aria-busy={!error}>
      <DelayedLoading busy={!error} label="설정 화면을 불러오는 중" />
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            다시 시도
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            현재 페이지 새로고침
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PresetData({
  load,
  children,
}: {
  load: OptionsScreenProps['loadPresets'];
  children: (presets: Awaited<ReturnType<OptionsScreenProps['loadPresets']>>) => ReactNode;
}) {
  const [presets, setPresets] = useState<Awaited<ReturnType<typeof load>> | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void load().then(
      (value) => {
        if (active) setPresets(value);
      },
      (cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => {
      active = false;
    };
  }, [load, attempt]);
  if (presets) return children(presets);
  return (
    <div aria-busy={!error}>
      <DelayedLoading busy={!error} label="프리셋을 불러오는 중" />
      {error ? (
        <div className="message error" role="alert">
          <p>프리셋을 불러오지 못했습니다. {error}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            다시 시도
          </button>
        </div>
      ) : null}
    </div>
  );
}
