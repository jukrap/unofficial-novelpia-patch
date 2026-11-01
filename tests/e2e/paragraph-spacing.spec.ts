import { launchReadingContext, closeReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
// @ts-expect-error Synthetic text only.
import { viewerHtml } from '../fixtures/viewer.mjs';
let context: BrowserContext;
let page: Page;
let profile: string;
let server: http.Server;
test.beforeEach(async () => {
  server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    // One explicit long paragraph, adjacent paragraphs, and an authored empty line.
    response.end(
      viewerHtml().replace(
        'setTimeout(viewer_display,120);',
        `
      const originalLines = textLines;
      textLines = () => ['가나다라 '.repeat(28), '다음 문단입니다.', '&nbsp;', '빈 줄 뒤 문단입니다.', ...originalLines()];
      setTimeout(viewer_display,120);`
      )
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  profile = await mkdtemp(path.join(tmpdir(), 'unp-paragraph-'));
  const extension = path.resolve('.output/chrome-mv3-e2e');
  context = await launchReadingContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  page = await context.newPage();
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/viewer/1001`);
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  // Initial native-mode adoption persists a settings snapshot. Inject the test
  // values only after that startup write and the first presentation have settled.
  await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
  await update({
    fontFamily: 'system-ui',
    maxWidth: 500,
    fontSize: 18,
    lineHeight: 200,
    paragraphGap: 0,
    paragraphSpacing: 8,
    pageEffect: 'none',
  });
  await expect(page.locator('[data-unp-line]').first()).toHaveCSS(
    'font-family',
    'system-ui, sans-serif'
  );
});
test.afterEach(async () => {
  await closeReadingContext(context);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (profile.startsWith(path.join(tmpdir(), 'unp-paragraph-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function update(patch: Record<string, unknown>) {
  await context.serviceWorkers()[0]!.evaluate(async (patch) => {
    const raw = await chrome.storage.sync.get('unp.reader.v1');
    Object.assign((raw['unp.reader.v1'] as { data: object }).data, patch);
    await chrome.storage.sync.set(raw);
  }, patch);
}
async function measure() {
  return page.locator('[data-unp-reader]').evaluate((body) => {
    const elements = [0, 1, 2, 3].map((n) =>
      body.querySelector<HTMLElement>(`.line[data-line="${n}"]`)!
    );
    const rects = elements.map((e) => e.getBoundingClientRect());
    const range = document.createRange();
    range.selectNodeContents(elements[0]!);
    const tops = [...new Set([...range.getClientRects()].map((r) => r.top))];
    return {
      between: rects[1]!.top - rects[0]!.top,
      blank: rects[3]!.top - rects[2]!.top,
      wrapStep: tops[1]! - tops[0]!,
      wrapped: tops.length,
      padding: getComputedStyle(elements[0]!).paddingBottom,
      blankMargin: getComputedStyle(elements[2]!).marginBottom,
      emptyPadding: getComputedStyle(elements[2]!).paddingBottom,
    };
  });
}
for (const mode of ['scroll', 'page'] as const) {
  test(`paragraph and blank spacing are independent in ${mode}, including wraps and native cleanup`, async () => {
    if (mode === 'page') {
      await update({ readingMode: 'page' });
    }
    await expect(page.locator(`[data-unp-reader="${mode}"]`)).toBeVisible();
    await expect.poll(async () => (await measure()).blankMargin).toBe('8px');
    const before = await measure();
    expect(before.wrapped).toBeGreaterThan(1);
    expect(before.wrapStep).toBeCloseTo(36, 1);
    expect(before.blank).toBeCloseTo(9, 1);
    await update({ paragraphGap: 24 });
    await expect.poll(async () => (await measure()).padding).toBe('24px');
    const after = await measure();
    expect(after.between - before.between).toBeCloseTo(24, 1);
    expect(after.wrapStep).toBeCloseTo(before.wrapStep, 1);
    expect(after.blank).toBeCloseTo(before.blank, 1);
    expect(after.emptyPadding).toBe('0px');
    await update({ paragraphSpacing: 35 });
    await expect.poll(async () => (await measure()).blank).toBeCloseTo(36, 1);
    const blankChanged = await measure();
    expect(blankChanged.between).toBeCloseTo(after.between, 1);
    await expect(page.locator('#test-banner')).not.toHaveAttribute('data-unp-paragraph');
    await expect(page.locator('#writer_comments_box')).not.toHaveAttribute('data-unp-paragraph');
    if (mode === 'page') {
      await page.getByRole('slider', { name: '본문 페이지', exact: true }).focus();
      await page.keyboard.press('End');
      await expect
        .poll(async () => {
          const text = await page.getByTestId('reader-page').textContent();
          const [position, total] = text!.split('/');
          return position!.trim().endsWith(total!.trim());
        })
        .toBe(true);
    }
    await update({ enabled: false });
    await page.locator('#unp-reload-notice').getByRole('button').click();
    await expect(page.locator('#unp-native-enable')).toBeAttached();
    await expect(page.locator('[data-unp-paragraph]')).toHaveCount(0);
  });
}
test('default buttons and quick values keep all three spacing controls independent', async () => {
  await page.locator('#btn_theme').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  const row = (name: string) =>
    page
      .locator('.number-row')
      .filter({ has: page.getByRole('spinbutton', { name, exact: true }) });
  await row('줄 간격').getByRole('button', { name: '줄 간격 190%', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '줄 간격', exact: true })).toHaveValue('190');
  await row('줄 간격').getByRole('button', { name: '기본', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '줄 간격', exact: true })).toHaveValue('200');
  await row('문단 간격').getByRole('button', { name: '기본', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '문단 간격', exact: true })).toHaveValue('1');
  await row('빈 줄 간격').getByRole('button', { name: '빈 줄 간격 30px', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '빈 줄 간격', exact: true })).toHaveValue('30');
  await row('빈 줄 간격').getByRole('button', { name: '기본', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '빈 줄 간격', exact: true })).toHaveValue('35');
  await expect.poll(async () => (await measure()).wrapStep).toBeCloseTo(36, 1);
  await expect.poll(async () => (await measure()).blank).toBeCloseTo(36, 1);
  await expect.poll(async () => (await measure()).padding).toBe('1px');
  await page.getByRole('button', { name: '레이아웃 설정으로 이동', exact: true }).click();
  await row('본문 너비').getByRole('button', { name: '본문 너비 900px', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '본문 너비', exact: true })).toHaveValue('900');
  await row('본문 너비').getByRole('button', { name: '기본', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '본문 너비', exact: true })).toHaveValue('880');
});

test('language-based wrapping differs from word and character wrapping for Korean and English', async () => {
  await update({
    maxWidth: 200,
    fontSize: 24,
    horizontalPadding: 0,
    letterSpacing: 0,
    wordBreakMode: 'normal',
  });
  await page.evaluate(() => {
    const root = document.getElementById('novel_drawing')!;
    for (const [id, text] of [
      ['wrap-en', 'ABCDEFG abcdefghijk'],
      ['wrap-ko', '앞문장 가나다라마바사'],
    ]) {
      const line = document.createElement('div');
      line.className = 'line';
      line.dataset.line = id!;
      line.id = id!;
      line.textContent = text!;
      root.prepend(line);
    }
  });
  await expect(page.locator('#wrap-ko')).toHaveCSS('font-size', '24px');
  const wordLines = (id: string) =>
    page.locator(`#${id}`).evaluate((line) => {
      const text = line.firstChild!;
      const start = text.textContent!.indexOf(' ') + 1;
      const tops = new Set<number>();
      for (let index = start; index < text.textContent!.length; index++) {
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        tops.add(Math.round(range.getBoundingClientRect().top));
      }
      return tops.size;
    });
  await expect.poll(() => wordLines('wrap-ko')).toBe(2);
  expect(await wordLines('wrap-en')).toBe(1);
  await page.locator('#btn_theme').click();
  const wrapping = page
    .locator('.row')
    .filter({ has: page.locator('.label-help').filter({ hasText: /^줄바꿈 방식$/ }) });
  await wrapping.getByRole('button', { name: '단어 단위', exact: true }).click();
  await expect.poll(() => wordLines('wrap-ko')).toBe(1);
  expect(await wordLines('wrap-en')).toBe(1);
  await wrapping.getByRole('button', { name: '글자 단위', exact: true }).click();
  await expect.poll(() => wordLines('wrap-en')).toBe(2);
  await wrapping.getByRole('button', { name: '언어별', exact: true }).click();
  await expect.poll(() => wordLines('wrap-en')).toBe(1);
  expect(await wordLines('wrap-ko')).toBe(2);
});

test('settings and preset previews expose paragraph spacing, preserve the choice, and show the requested bar order', async () => {
  await page.locator('#btn_theme').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  const control = page.getByRole('spinbutton', { name: '문단 간격', exact: true });
  await control.fill('16');
  await control.press('Enter');
  await expect(
    page.locator('[data-section="text"]').getByTestId('typography-preview').locator('p').first()
  ).toHaveCSS('padding-bottom', '16px');
  await expect.poll(async () => (await measure()).padding).toBe('16px');
  await page.getByRole('button', { name: '레이아웃 설정으로 이동', exact: true }).click();
  const row = page
    .locator('.row')
    .filter({ has: page.getByText('하단 진행바 배치', { exact: true }) });
  await expect(row.locator('.segments button')).toHaveText(['하단 고정', '본문 아래', '본문 위']);
  // Settings intentionally debounce persistence; check the saved value before testing reload.
  await expect
    .poll(() =>
      context.serviceWorkers()[0]!.evaluate(async () => {
        const raw = await chrome.storage.sync.get('unp.reader.v1');
        return (raw['unp.reader.v1'] as { data: { paragraphGap: number } }).data.paragraphGap;
      })
    )
    .toBe(16);
  await page.reload();
  await expect.poll(async () => (await measure()).padding).toBe('16px');
});

test('scrolling inside a paragraph gap saves the next visible text instead of jumping back', async () => {
  await update({ paragraphGap: 100 });
  await expect.poll(async () => (await measure()).padding).toBe('100px');
  // A hidden startup layout is not a reading interaction to persist.
  await expect(page.locator('#unp-navigation-host')).toBeVisible();
  await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
  await page.locator('#novel_box').evaluate((box) => {
    const first = box.querySelector<HTMLElement>('.line[data-line="0"]')!;
    box.scrollTop = first.offsetTop + first.offsetHeight - 75;
    box.dispatchEvent(new Event('scroll'));
  });
  const readPosition = () =>
    context.serviceWorkers()[0]!.evaluate(async () => {
      const raw = await chrome.storage.local.get('unp.position.v1.1001');
      return raw['unp.position.v1.1001'] as { blockKey: string; edge: string } | undefined;
    });
  await expect.poll(readPosition).toMatchObject({ blockKey: '1', edge: 'text' });
  await page.reload();
  await expect
    .poll(() =>
      page.locator('[data-unp-reader] .line[data-line="1"]').evaluate((line) => {
        const range = document.createRange();
        range.setStart(line.firstChild!, 0);
        range.setEnd(line.firstChild!, 1);
        const r = range.getBoundingClientRect(),
          v = document.getElementById('novel_box')!.getBoundingClientRect();
        return r.top >= v.top - 1 && r.top < v.bottom;
      })
    )
    .toBe(true);
});
