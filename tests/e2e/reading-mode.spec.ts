import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { launchReadingContext } from '../helpers/reading-font-fixture';
// @ts-expect-error Synthetic text only.
import { viewerHtml } from '../fixtures/viewer.mjs';
let context: BrowserContext, viewer: Page, options: Page, profile: string, base: string;
let server: http.Server;
const extension = path.resolve('.output/chrome-mv3-e2e');
const launch = () =>
  launchReadingContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
async function settings() {
  return context.serviceWorkers()[0]!.evaluate(
    async () =>
      (
        (await chrome.storage.sync.get('unp.reader.v1'))['unp.reader.v1'] as {
          data: Record<string, unknown>;
        }
      ).data
  );
}
async function ready(mode: 'scroll' | 'page') {
  await expect(viewer.locator(`[data-unp-reader="${mode}"]`)).toBeVisible();
  await expect(viewer.locator('#unp-navigation-host')).toBeVisible();
  await expect(viewer.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
}
test.beforeEach(async () => {
  server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(viewerHtml());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  profile = await mkdtemp(path.join(tmpdir(), 'unp-reading-mode-'));
  context = await launch();
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  viewer = await context.newPage();
  options = await context.newPage();
  await viewer.goto(`${base}/viewer/1001`);
  await ready('scroll');
  await options.goto(`chrome-extension://${id}/options.html#/layout`);
  await expect(options.getByRole('button', { name: '스크롤 방식', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
test.afterEach(async () => {
  await context?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (path.resolve(profile).startsWith(path.join(tmpdir(), 'unp-reading-mode-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('options mode and page choices survive revisiting, browser restart and a changed native preference', async () => {
  await options.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await options.getByRole('button', { name: '항상 한 쪽', exact: true }).click();
  await options.getByRole('combobox', { name: '페이지 효과', exact: true }).click();
  await options.getByRole('option', { name: '페이드', exact: true }).click();
  await options.getByRole('button', { name: '하단 고정', exact: true }).click();
  await ready('page');
  await expect.poll(settings).toMatchObject({
    readingMode: 'page',
    spreadMode: 'single',
    pageEffect: 'fade',
    pageNavigationPlacement: 'fixed',
  });
  const optionsBase = options.url().split('#')[0]!;
  await options.goto(`${optionsBase}#/files`);
  await options.getByRole('button', { name: 'JSON 보기', exact: true }).click();
  const exported = await options
    .getByRole('textbox', { name: '내보내기 JSON', exact: true })
    .inputValue();
  expect(JSON.parse(exported).settings).toMatchObject({
    readingMode: 'page',
    spreadMode: 'single',
    pageEffect: 'fade',
    pageNavigationPlacement: 'fixed',
  });
  await options.goto(`${optionsBase}#/layout`);
  await options.getByRole('button', { name: '스크롤 방식', exact: true }).click();
  await ready('scroll');
  await options.goto(`${optionsBase}#/files`);
  await options.getByRole('tab', { name: 'JSON 텍스트', exact: true }).click();
  await options.getByRole('textbox', { name: '설정 JSON', exact: true }).fill(exported);
  await options.getByRole('button', { name: '내용 확인', exact: true }).click();
  await options.getByRole('button', { name: '가져오기 및 적용', exact: true }).click();
  await ready('page');
  await viewer.goto(`${base}/viewer/1002`);
  await ready('page');
  await viewer.evaluate(() => localStorage.setItem('viewer_paging', '0'));
  await context.close();
  context = await launch();
  viewer = await context.newPage();
  await viewer.goto(`${base}/viewer/1002`);
  await ready('page');
  await expect(viewer.locator('[data-unp-reader="page"]')).toHaveCSS('column-count', '1');
  await expect.poll(settings).toMatchObject({
    readingMode: 'page',
    spreadMode: 'single',
    pageEffect: 'fade',
    pageNavigationPlacement: 'fixed',
  });
});

test('preset drafts keep the live mode unchanged until applying and round-trip every page option', async () => {
  test.setTimeout(90000);
  await options.goto(options.url().replace('#/layout', '#/presets'));
  const create = options.getByRole('button', { name: '현재 설정으로 만들기', exact: true });
  await create.click();
  await options.getByRole('tab', { name: '레이아웃', exact: true }).click();
  await options.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await options.getByRole('button', { name: '취소', exact: true }).click();
  await options.getByRole('button', { name: '버리고 이동', exact: true }).click();
  await expect.poll(settings).toMatchObject({ readingMode: 'scroll' });
  await ready('scroll');

  await create.click();
  await options.getByRole('textbox', { name: '이름', exact: true }).fill('페이지 독서');
  await options.getByRole('tab', { name: '레이아웃', exact: true }).click();
  await options.getByRole('button', { name: '페이지 방식', exact: true }).click();
  const gap = options.getByRole('spinbutton', { name: '두 쪽 사이 간격', exact: true });
  await gap.fill('80');
  await gap.press('Enter');
  await options.getByRole('button', { name: '항상 한 쪽', exact: true }).click();
  await options.getByRole('combobox', { name: '페이지 효과', exact: true }).click();
  await options.getByRole('option', { name: '종이 접힘', exact: true }).click();
  await options.getByRole('button', { name: '본문 아래', exact: true }).click();
  await options.screenshot({
    path: test.info().outputPath('preset-reading-mode-desktop.png'),
    fullPage: true,
  });
  await options.setViewportSize({ width: 390, height: 844 });
  expect(
    await options.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  ).toBeLessThanOrEqual(1);
  await options.screenshot({
    path: test.info().outputPath('preset-reading-mode-mobile.png'),
    fullPage: true,
  });
  await options.setViewportSize({ width: 1440, height: 900 });
  await options.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(settings).toMatchObject({ readingMode: 'scroll' });
  await ready('scroll');
  const card = options.getByRole('article', { name: '페이지 독서', exact: true });
  await expect(card).toContainText('페이지 · 한 쪽');
  await card.getByRole('button', { name: '페이지 독서 적용', exact: true }).click();
  await ready('page');
  await expect.poll(settings).toMatchObject({
    readingMode: 'page',
    spreadMode: 'single',
    pageEffect: 'fold',
    pageNavigationPlacement: 'reserved',
    pageGap: 80,
  });
  const id = await card.getAttribute('data-preset-id');
  await expect
    .poll(() =>
      context.serviceWorkers()[0]!.evaluate(
        async () =>
          (
            (await chrome.storage.sync.get('unp.presetIndex.v1'))['unp.presetIndex.v1'] as {
              selectedId: string;
            }
          ).selectedId
      )
    )
    .toBe(id);
  await card.getByRole('button', { name: '페이지 독서 편집', exact: true }).click();
  await options.getByRole('tab', { name: '레이아웃', exact: true }).click();
  await expect(options.getByRole('button', { name: '항상 한 쪽', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await options.getByRole('button', { name: '스크롤 방식', exact: true }).click();
  await options.getByRole('button', { name: '저장하고 적용', exact: true }).click();
  await ready('scroll');
  await expect(card).toContainText('스크롤');
});

test('themebox mode saves the choice and disabling restores the original native preference', async () => {
  expect(await viewer.evaluate(() => localStorage.getItem('viewer_paging'))).toBeNull();
  await viewer.locator('#btn_theme').click();
  await viewer.getByRole('button', { name: '레이아웃 설정으로 이동', exact: true }).click();
  await viewer.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await ready('page');
  await expect.poll(settings).toMatchObject({ readingMode: 'page' });
  await viewer.locator('#btn_theme').click();
  await viewer.getByRole('button', { name: '정보 설정으로 이동', exact: true }).click();
  await viewer.getByRole('switch', { name: '확장 뷰어 사용', exact: true }).click();
  await expect(viewer.locator('#unp-native-enable')).toBeAttached();
  expect(await viewer.evaluate(() => localStorage.getItem('viewer_paging'))).toBeNull();
  await expect.poll(settings).toMatchObject({ enabled: false, readingMode: 'page' });
});
