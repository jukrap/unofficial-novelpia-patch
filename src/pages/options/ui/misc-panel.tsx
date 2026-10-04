import { AnimatePresence } from 'motion/react';
import { MotionButton } from '@/shared/ui/motion-button';
import { useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { defaults } from '@/entities/settings';
import { Modal } from '@/shared/ui/modal';
import { Toggle } from '@/shared/ui/toggle';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import type { OptionsScreenProps } from '../model/contracts';

type Confirmation = 'settings' | 'statistics' | null;
export default function MiscScreen(props: OptionsScreenProps) {
  return <MiscPanel {...props} />;
}
export function MiscPanel({ store, stats, loadPresets, onNotify }: OptionsScreenProps) {
  const id = useId();
  const snapshot = useStore(stats.state);
  const running = useRef(false);
  const [confirming, setConfirming] = useState<Confirmation>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statsError, setStatsError] = useState('');
  const run = async (task: () => Promise<void>, statistics = false) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    (statistics ? setStatsError : setError)('');
    try {
      await task();
    } catch (cause) {
      (statistics ? setStatsError : setError)(
        cause instanceof Error ? cause.message : String(cause)
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const resetSettings = () =>
    run(async () => {
      const presets = await loadPresets();
      store.update({ ...defaults });
      await store.flush();
      const result = store.getSnapshot();
      if (result.status === 'error' || result.error)
        throw new Error(result.error || '설정을 저장하지 못했습니다.');
      await presets.select(null);
      setConfirming(null);
      onNotify('읽기 설정을 초기화했습니다');
    });
  const resetStats = () =>
    run(async () => {
      const result = await stats.reset();
      if (result.error) throw new Error(result.error);
      setConfirming(null);
      onNotify('독서 통계를 삭제했습니다');
    }, true);
  return (
    <div className="misc-panel">
      <section className="management-action-section" aria-labelledby={`${id}-reset`}>
        <div className="management-action-row">
          <div className="management-action-copy">
            <h2 id={`${id}-reset`}>설정 초기화</h2>
            <p>글꼴, 간격, 색상과 독서 도구 설정을 기본값으로 되돌립니다.</p>
            <p className="hint">내 프리셋, 등록 이미지, 사용자 글꼴과 읽기 기록은 유지됩니다.</p>
          </div>
          <MotionButton
            type="button"
            disabled={busy}
            onClick={() => {
              setError('');
              setConfirming('settings');
            }}
          >
            설정 초기화
          </MotionButton>
        </div>
      </section>
      <section
        className="management-action-section"
        aria-labelledby={`${id}-stats`}
        aria-busy={!snapshot.ready || busy}
      >
        <h2 id={`${id}-stats`}>독서 통계</h2>
        <DelayedLoading busy={!snapshot.ready} label="독서 통계를 불러오는 중" />
        <div className="management-action-row">
          <div className="management-action-copy">
            <h3>통계 기록</h3>
            <p>
              이 브라우저의 독서 시간, 열어 본 회차와 독서한 날을 기록합니다. 꺼도 기존 통계는
              남습니다.
            </p>
          </div>
          <Toggle
            label="독서 통계 기록"
            value={snapshot.enabled}
            disabled={busy || !snapshot.ready}
            showValue={false}
            onChange={(enabled) =>
              void run(async () => {
                const result = await stats.setEnabled(enabled);
                if (result.error) throw new Error(result.error);
                onNotify(enabled ? '독서 통계 기록을 켰습니다' : '독서 통계 기록을 껐습니다');
              }, true)
            }
          />
        </div>
        <div className="management-action-row">
          <div className="management-action-copy">
            <h3>통계 삭제</h3>
            <p>
              지금까지의 숫자를 지우고 새로 시작합니다. 프리셋과 읽던 위치, 북마크는 유지됩니다.
            </p>
          </div>
          <MotionButton
            type="button"
            disabled={busy || !snapshot.ready}
            onClick={() => {
              setStatsError('');
              setConfirming('statistics');
            }}
          >
            통계 삭제
          </MotionButton>
        </div>
        {(statsError || snapshot.error) && confirming !== 'statistics' ? (
          <div className="statistics-error" role="alert">
            <p>{statsError || snapshot.error}</p>
            <MotionButton
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await stats.retry();
                  if (result.error) throw new Error(result.error);
                  onNotify('독서 통계 저장소를 확인했습니다');
                }, true)
              }
            >
              다시 시도
            </MotionButton>
          </div>
        ) : null}
      </section>
      <AnimatePresence>
        {confirming ? (
          <Modal
            title={confirming === 'settings' ? '읽기 설정 초기화' : '독서 통계 삭제'}
            onClose={() => {
              if (!busy) setConfirming(null);
            }}
          >
            {confirming === 'settings' ? (
              <>
                <p>글꼴, 간격, 색상과 독서 도구 설정을 기본값으로 되돌립니다.</p>
                <p>
                  사용자 프리셋, 등록 이미지, 사용자 글꼴, 읽기 위치, 북마크와 독서 통계는 삭제하지
                  않습니다.
                </p>
              </>
            ) : (
              <>
                <p>
                  이 브라우저에 저장된 독서 시간, 회차 수와 날짜 기록을 모두 삭제합니다. 삭제한
                  통계는 되돌릴 수 없습니다.
                </p>
                <p>
                  읽던 위치와 북마크, 설정과 프리셋은 유지됩니다. 통계 기록의 켜짐·꺼짐 상태도
                  유지합니다.
                </p>
              </>
            )}
            <div className="modal-actions">
              <MotionButton type="button" disabled={busy} onClick={() => setConfirming(null)}>
                취소
              </MotionButton>
              <MotionButton
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void (confirming === 'settings' ? resetSettings() : resetStats())}
              >
                {busy
                  ? '처리하는 중…'
                  : confirming === 'settings'
                    ? '기본값으로 초기화'
                    : '통계 삭제하기'}
              </MotionButton>
            </div>
            {(confirming === 'settings' ? error : statsError) ? (
              <p className="field-error" role="alert">
                {confirming === 'settings' ? error : statsError}
              </p>
            ) : null}
          </Modal>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
