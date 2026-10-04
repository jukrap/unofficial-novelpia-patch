import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorWeight, effectiveWeight, supportedWeights, supportsBold, FontLoader } from './fonts';

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  vi.useRealTimers();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  document.head.querySelectorAll('[data-unp-font]').forEach((element) => element.remove());
});

it.each(['stylesheet', 'face', 'timeout'] as const)(
  'allows retry after a %s failure without keeping a rejected font resource',
  async (failure) => {
    const load = vi.fn().mockResolvedValue([{ status: 'loaded' }]);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    const loader = new FontLoader();
    const settings = { fontFamily: 'Pretendard', fontWeight: 600, fontSize: 20, forceBold: false };
    expect(loader.isReadingReady(settings)).toBe(false);
    if (failure === 'timeout') vi.useFakeTimers();
    if (failure === 'face') load.mockRejectedValueOnce(new Error('font download failed'));
    const failed = expect(loader.loadReading(settings)).rejects.toThrow();
    const link = document.head.querySelector<HTMLLinkElement>('[data-unp-font]')!;
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10000);
    else link.dispatchEvent(new Event(failure === 'stylesheet' ? 'error' : 'load'));
    await failed;
    expect(link.isConnected).toBe(false);
    vi.useRealTimers();
    const retry = loader.loadReading(settings);
    const replacement = document.head.querySelector<HTMLLinkElement>('[data-unp-font]')!;
    expect(replacement).not.toBe(link);
    replacement.dispatchEvent(new Event('load'));
    await retry;
    expect(loader.isReadingReady(settings)).toBe(true);
    expect(load).toHaveBeenCalledWith(
      '600 20px "Pretendard Variable"',
      expect.stringContaining('한글')
    );
    expect(load).toHaveBeenCalledWith(
      '900 20px "Pretendard Variable"',
      expect.stringContaining('한글')
    );
    loader.dispose();
    expect(loader.isReadingReady(settings)).toBe(false);
    expect(document.head.querySelector('[data-unp-font]')).toBeNull();
  }
);

it('keeps fallback text until both the reading and author emphasis faces are ready', async () => {
  const finish = new Map<string, () => void>();
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      load: (query: string) => new Promise((resolve) => finish.set(query, () => resolve([{}]))),
    },
  });
  const loader = new FontLoader();
  const settings = { fontFamily: 'Pretendard', fontWeight: 600, fontSize: 20, forceBold: false };
  const reading = loader.loadReading(settings);
  document.head.querySelector('[data-unp-font]')!.dispatchEvent(new Event('load'));
  await Promise.resolve();
  finish.get('600 20px "Pretendard Variable"')!();
  await Promise.resolve();
  expect(loader.isReadingReady(settings)).toBe(false);
  finish.get('900 20px "Pretendard Variable"')!();
  await reading;
  expect(loader.isReadingReady(settings)).toBe(true);
  expect(loader.isReadingReady({ ...settings, fontWeight: 300 })).toBe(false);
  loader.dispose();
});
it('waits for new Unicode subsets in both weights after a different text sample was ready', async () => {
  const finish = new Map<string, () => void>();
  const load = vi.fn((query: string, text: string) =>
    text.includes('가')
      ? new Promise((resolve) => finish.set(query, () => resolve([{}])))
      : Promise.resolve([{}])
  );
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
  const loader = new FontLoader();
  const settings = { fontFamily: 'Pretendard', fontWeight: 600, fontSize: 20, forceBold: false };
  const latin = loader.loadReading(settings, 'AAA');
  document.head.querySelector('[data-unp-font]')!.dispatchEvent(new Event('load'));
  await latin;
  expect(loader.isReadingReady(settings, 'A')).toBe(true);
  expect(loader.isReadingReady(settings, '가')).toBe(false);
  const korean = loader.loadReading(settings, '가가A가');
  await Promise.resolve();
  expect(load).toHaveBeenCalledWith('600 20px "Pretendard Variable"', ' 가A');
  expect(load).toHaveBeenCalledWith('900 20px "Pretendard Variable"', ' 가A');
  finish.get('600 20px "Pretendard Variable"')!();
  await Promise.resolve();
  expect(loader.isReadingReady(settings, '가A')).toBe(false);
  finish.get('900 20px "Pretendard Variable"')!();
  await korean;
  expect(loader.isReadingReady(settings, '가A가')).toBe(true);
  expect(loader.isReadingReady(settings, '다')).toBe(false);
  load.mockClear();
  await loader.loadReading({ ...settings, fontSize: 28 }, 'A가');
  expect(load).not.toHaveBeenCalled();
  loader.dispose();
});
it('does not mark a replacement font ready when an older, disposed face finishes loading', async () => {
  const requests: (() => void)[] = [];
  const load = vi.fn(() => new Promise((resolve) => requests.push(() => resolve([{}]))));
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
  const loader = new FontLoader();
  const settings = { fontFamily: 'Pretendard', fontWeight: 600, fontSize: 20, forceBold: false };
  const old = loader.loadReading(settings, '가');
  document.head.querySelector('[data-unp-font]')!.dispatchEvent(new Event('load'));
  await Promise.resolve();
  loader.dispose();
  const current = loader.loadReading(settings, '다');
  document.head.querySelector('[data-unp-font]')!.dispatchEvent(new Event('load'));
  await Promise.resolve();
  requests[0]!();
  requests[1]!();
  await old;
  expect(loader.isReadingReady(settings, '가')).toBe(false);
  expect(loader.isReadingReady(settings, '다')).toBe(false);
  requests[2]!();
  requests[3]!();
  await current;
  expect(loader.isReadingReady(settings, '다')).toBe(true);
  expect(loader.isReadingReady(settings, '가')).toBe(false);
  loader.dispose();
});
describe('font weight capabilities', () => {
  it.each([
    ['Pretendard', 400, false, 700],
    ['Pretendard', 500, false, 700],
    ['Pretendard', 600, false, 900],
    ['Pretendard', 700, false, 900],
    ['Pretendard', 900, false, 900],
    ['42dot Sans', 600, false, 800],
    ['MaruBuri', 600, false, 700],
    ['system-ui', 900, false, 700],
    ['RIDIBatang', 400, false, 700],
    ['RIDIBatang', 400, true, 700],
  ])(
    'keeps author emphasis within %s capabilities (%s, forced %s)',
    (fontFamily, fontWeight, forceBold, expected) => {
      const settings = { fontFamily, fontWeight, forceBold };
      expect(authorWeight(settings)).toBe(expected);
      expect(authorWeight(settings)).toBeGreaterThanOrEqual(effectiveWeight(settings));
    }
  );
  it('offers actual weights and reserves synthetic bold for fonts without a bold face', () => {
    expect(supportedWeights('system-ui')).toEqual([400, 700]);
    expect(supportsBold('RIDIBatang')).toBe(false);
    expect(supportedWeights('RIDIBatang')).toEqual([400]);
    expect(effectiveWeight({ fontFamily: 'RIDIBatang', fontWeight: 900, forceBold: false })).toBe(
      400
    );
    expect(effectiveWeight({ fontFamily: 'RIDIBatang', fontWeight: 400, forceBold: true })).toBe(
      700
    );
    expect(effectiveWeight({ fontFamily: 'system-ui', fontWeight: 400, forceBold: true })).toBe(
      700
    );
  });
});
