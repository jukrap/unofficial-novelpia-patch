import type { Settings } from '@/shared/model/preferences';
export function recommendationState(): 'yes' | 'no' | 'unknown' {
  const root = document.querySelector('#recommend_tap');
  if (!root) return 'unknown';
  const text = root.textContent ?? '';
  const img = root.querySelector('img');
  const src = img?.getAttribute('src') ?? '';
  if (
    root.getAttribute('aria-pressed') === 'true' ||
    root.querySelector('[aria-pressed="true"]') ||
    /추천 취소|추천취소/.test(text) ||
    /recommend_on|recommend_active|recommend-on/.test(src)
  )
    return 'yes';
  if (root.getAttribute('aria-pressed') === 'false' || /recommend_off|recommend\.svg/.test(src))
    return 'no';
  return 'unknown';
}
export function autoRecommend(
  settings: Settings,
  episode: string,
  onStatus: (text: string) => void
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const stop = () => clearTimeout(timer);
  const run = () => {
    if (done || document.hidden || !settings.autoRecommend) return;
    timer = setTimeout(() => {
      if (document.hidden || location.pathname.match(/\/viewer\/(\d+)/)?.[1] !== episode) return;
      const status = recommendationState();
      if (status !== 'no') {
        onStatus(
          status === 'yes'
            ? '이미 추천한 회차입니다.'
            : '추천 상태를 확인할 수 없어 자동 추천하지 않았습니다.'
        );
        return;
      }
      const target = document.querySelector<HTMLElement>(
        '#recommend_tap #menu-bottom-item,#recommend_tap button'
      );
      if (!target) return;
      done = true;
      target.click();
      onStatus('추천 버튼을 눌렀습니다.');
    }, settings.recommendDelay * 1000);
  };
  const visibility = () => {
    stop();
    run();
  };
  document.addEventListener('visibilitychange', visibility);
  run();
  return () => {
    stop();
    document.removeEventListener('visibilitychange', visibility);
  };
}
