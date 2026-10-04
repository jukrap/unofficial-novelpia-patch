import { MotionButton } from '@/shared/ui/motion-button';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { ReadingStatsClient } from '@/entities/reading-stats';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import type { OptionsSection } from '../config/navigation';

function duration(milliseconds: number) {
  if (milliseconds > 0 && milliseconds < 60_000) return '1분 미만';
  const minutes = Math.floor(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
}

export function HomePanel({
  stats,
  navigate,
}: {
  stats: ReadingStatsClient;
  navigate: (section: OptionsSection) => void;
}) {
  const snapshot = useStore(stats.state);
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState('');
  return (
    <div className="home-panel">
      <section className="home-introduction" aria-label="시작하기">
        <h2>읽기 설정</h2>
        <p>
          프리셋으로 시작하거나 글꼴과 간격을 직접 조절할 수 있습니다.
          <br />
          설정은 테마박스와 함께 사용합니다.
        </p>
        <div className="home-shortcuts">
          <MotionButton className="primary" type="button" onClick={() => navigate('presets')}>
            프리셋 보기
          </MotionButton>
          <MotionButton type="button" onClick={() => navigate('text')}>
            텍스트 설정
          </MotionButton>
          <MotionButton className="text-button" type="button" onClick={() => navigate('files')}>
            설정 파일 열기
          </MotionButton>
        </div>
      </section>
      <section
        className="home-statistics"
        aria-label="독서 통계"
        aria-busy={!snapshot.ready || busy}
      >
        <header className="home-statistics-heading">
          <h2>독서 통계</h2>
          {snapshot.ready && !snapshot.enabled ? <span>기록 꺼짐</span> : null}
        </header>
        <DelayedLoading busy={!snapshot.ready} label="독서 통계를 불러오는 중" />
        {snapshot.ready ? (
          <>
            <dl className="reading-statistics">
              <div>
                <dt>독서 시간</dt>
                <dd>{duration(snapshot.todayMs)}</dd>
                <span>오늘, 누적 {duration(snapshot.totalMs)}</span>
              </div>
              <div>
                <dt>열어 본 회차</dt>
                <dd>
                  {snapshot.episodeCount.toLocaleString('ko-KR')}
                  <small>회차</small>
                </dd>
                <span>다시 열어도 한 번만 셉니다</span>
              </div>
              <div>
                <dt>독서한 날</dt>
                <dd>
                  {snapshot.activeDays.toLocaleString('ko-KR')}
                  <small>일</small>
                </dd>
                <span>독서 시간이 기록된 날짜</span>
              </div>
            </dl>
            <p className="statistics-local-note">
              이 브라우저에만 저장하며 외부로 전송하지 않습니다.
              {snapshot.startedAt
                ? ` ${new Date(snapshot.startedAt).toLocaleDateString('ko-KR')}부터 기록했습니다.`
                : ' 뷰어에서 본문을 읽으면 기록이 시작됩니다.'}
            </p>
            <details className="statistics-method">
              <summary>기록 기준</summary>
              <div className="statistics-method-copy">
                <p>확장 뷰어가 활성화된 창에서 본문이 보이는 동안의 추정 시간입니다.</p>
                <p>
                  설정창·회차 목록 등이 열려 있거나, 5분 동안 읽기 조작이 없으면 시간을 세지
                  않습니다.
                </p>
                <p>시크릿 창은 기록하지 않습니다.</p>
              </div>
              <MotionButton
                type="button"
                className="statistics-manage"
                onClick={() => navigate('misc')}
              >
                기록 관리
              </MotionButton>
            </details>
          </>
        ) : null}
        {snapshot.error || retryError ? (
          <div className="statistics-error" role="alert">
            <p>{snapshot.error || retryError}</p>
            <MotionButton
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setRetryError('');
                try {
                  const result = await stats.retry();
                  if (result.error) setRetryError(result.error);
                } catch (cause) {
                  setRetryError(cause instanceof Error ? cause.message : String(cause));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '확인 중…' : '다시 시도'}
            </MotionButton>
            <MotionButton
              type="button"
              className="statistics-manage"
              onClick={() => navigate('misc')}
            >
              기록 관리
            </MotionButton>
          </div>
        ) : null}
      </section>
    </div>
  );
}
