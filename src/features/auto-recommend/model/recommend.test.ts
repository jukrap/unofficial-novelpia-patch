import { afterEach, it, expect, vi } from 'vitest';
import { autoRecommend, recommendationState } from './auto-recommend';
import { defaults } from '@/shared/model/preferences';
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});
it('clicks exactly once after explicit consent and never toggles an existing recommendation off', async () => {
  vi.useFakeTimers();
  history.replaceState(null, '', '/viewer/1');
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  document.body.innerHTML =
    '<div id="recommend_tap" aria-pressed="false"><button>추천</button></div>';
  const click = vi.fn(() =>
    document.getElementById('recommend_tap')!.setAttribute('aria-pressed', 'true')
  );
  document.querySelector('button')!.onclick = click;
  const stop = autoRecommend(
    { ...defaults, autoRecommend: true, recommendDelay: 20 },
    '1',
    () => {}
  );
  await vi.advanceTimersByTimeAsync(19999);
  expect(click).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(click).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(40000);
  expect(click).toHaveBeenCalledTimes(1);
  stop();
  const again = autoRecommend(
    { ...defaults, autoRecommend: true, recommendDelay: 20 },
    '1',
    () => {}
  );
  await vi.advanceTimersByTimeAsync(20000);
  expect(click).toHaveBeenCalledTimes(1);
  again();
});
it('does nothing by default or when state is unknown/already recommended', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="recommend_tap"><button>추천</button></div>';
  const click = vi.fn();
  document.querySelector('button')!.onclick = click;
  const stop = autoRecommend(defaults, '1', () => {});
  await vi.advanceTimersByTimeAsync(60000);
  expect(click).not.toHaveBeenCalled();
  stop();
  expect(recommendationState()).toBe('unknown');
  document.getElementById('recommend_tap')!.setAttribute('aria-pressed', 'true');
  expect(recommendationState()).toBe('yes');
});
it('cancels pending consent immediately on disposal', async () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<div id="recommend_tap" aria-pressed="false"><button>추천</button></div>';
  const click = vi.fn();
  document.querySelector('button')!.onclick = click;
  const stop = autoRecommend(
    { ...defaults, autoRecommend: true, recommendDelay: 20 },
    '1',
    () => {}
  );
  stop();
  await vi.advanceTimersByTimeAsync(30000);
  expect(click).not.toHaveBeenCalled();
});
