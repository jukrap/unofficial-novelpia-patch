import { afterEach, expect, it, vi } from 'vitest';
import { prepareViewer } from './bootstrap';
import { STARTUP_KEY } from '@/shared/platform/startup';
import { defaults } from '@/shared/model/preferences';

const preparations: ReturnType<typeof prepareViewer>[] = [];
function setup(value: unknown = defaults) {
  vi.useFakeTimers();
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension' },
    storage: { local: { get: async () => ({ [STARTUP_KEY]: value }) } },
  });
  document.body.innerHTML =
    '<div id="novel_text"><div id="load_bar" style="display:none"><div>소설 내용을 불러오고 있습니다.</div></div><div id="novel_drawing"></div></div>';
  const preparation = prepareViewer();
  preparations.push(preparation);
  return preparation;
}
afterEach(() => {
  preparations.splice(0).forEach((preparation) => preparation.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
it('keeps protection after a line is marked and releases only after an explicit reveal', async () => {
  const preparation = setup();
  await vi.advanceTimersByTimeAsync(160);
  expect(document.getElementById('unp-reader-loading')).not.toBeNull();
  preparation.claim(defaults);
  const line = document.createElement('span');
  line.dataset.unpLine = '';
  document.getElementById('novel_drawing')!.append(line);
  await vi.advanceTimersByTimeAsync(1);
  expect(document.getElementById('unp-first-layout')).not.toBeNull();
  preparation.handoffPaint();
  await vi.advanceTimersByTimeAsync(3000);
  expect(document.getElementById('unp-first-layout')).not.toBeNull();
  preparation.reveal();
  expect(document.getElementById('unp-first-layout')).toBeNull();
  expect(document.getElementById('unp-reader-loading')).toBeNull();
  expect(document.documentElement.hasAttribute('data-unp-preparing')).toBe(false);
  await vi.advanceTimersByTimeAsync(3000);
  expect(document.getElementById('unp-reader-loading')).toBeNull();
});
it('recovers the native viewer within 2.5 seconds when the runtime never claims it', async () => {
  setup();
  await vi.advanceTimersByTimeAsync(2499);
  expect(document.getElementById('unp-first-layout')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(document.getElementById('unp-first-layout')).toBeNull();
});
it('recovers when native loading has ended but no usable reader layout can be produced', async () => {
  const preparation = setup();
  preparation.claim(defaults);
  await vi.advanceTimersByTimeAsync(2600);
  expect(document.getElementById('unp-first-layout')).toBeNull();
  expect(document.getElementById('unp-reader-loading')).toBeNull();
});
it('does not override inherited native loading ink in default surface mode', async () => {
  setup({ ...defaults, textColor: '#aabbcc', readingSurfaces: 'default' });
  await vi.advanceTimersByTimeAsync(1);
  const css = document.getElementById('unp-first-layout')!.textContent!;
  expect(css).not.toContain('color:#aabbcc');
  expect(css).not.toContain('#load_bar>div');
});
it('does not overlay its loader while the native content loader is visible', async () => {
  const preparation = setup();
  const native = document.getElementById('load_bar')!;
  native.style.display = 'block';
  vi.spyOn(native, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  preparation.claim(defaults);
  await vi.advanceTimersByTimeAsync(160);
  expect(document.getElementById('unp-reader-loading')).toBeNull();
  native.style.display = 'none';
  await vi.advanceTimersByTimeAsync(1);
  expect(document.getElementById('unp-reader-loading')).not.toBeNull();
});
it('uses cached opacity and reading surface colors before runtime ownership', async () => {
  setup({ ...defaults, textAreaOpacity: 35, readingSurfaces: 'theme', darkMode: true });
  await vi.advanceTimersByTimeAsync(1);
  const css = document.getElementById('unp-first-layout')!.textContent!;
  expect(css).toContain('rgba(255,255,255,0.35)');
  expect(css).toContain('#load_bar>div{color:#f1edf7');
});
it('retires cached paint without releasing text protection until the final layout is ready', async () => {
  const preparation = setup();
  preparation.claim(defaults);
  preparation.handoffPaint();
  const css = document.getElementById('unp-first-layout')!.textContent!;
  expect(css).not.toContain('#novel_box{');
  expect(css).toContain('visibility:hidden');
  expect(preparation.revealed).toBe(false);
  preparation.reveal();
  expect(preparation.revealed).toBe(true);
});
it('leaves a disabled viewer unguarded and does not reveal a duplicate loader later', async () => {
  setup({ ...defaults, enabled: false });
  await vi.advanceTimersByTimeAsync(500);
  expect(document.getElementById('unp-first-layout')).toBeNull();
  expect(document.getElementById('unp-reader-loading')).toBeNull();
});
