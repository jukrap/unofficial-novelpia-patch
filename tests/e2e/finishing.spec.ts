import { launchReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
// @ts-expect-error Synthetic source only; no novel content.
import { viewerHtml } from '../fixtures/viewer.mjs';
let context: BrowserContext;
let profile: string;
let server: http.Server;
let base: string;
let page: Page;
test.beforeEach(async () => {
  server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const list =
      '<div id="list_box" style="display:none;background:transparent;filter:invert(1)"><table id="episode_table"><tr><td><b><span class="b_free" style="filter:invert(1);background:#166d95;color:white">무료</span>합성 회차</b><div class="ep_style2" style="background:white"><font>EP.1</font></div><div class="episode_view_1001" style="background:#8463f5">읽음</div><button onclick="this.dataset.used=1">회차 목록 동작</button></td></tr></table></div>';
    response.end(viewerHtml().replace('</body>', `${list}</body>`));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/viewer/1001`;
  profile = await mkdtemp(path.join(tmpdir(), 'unp-finishing-'));
  const extension = path.resolve('.output/chrome-mv3-e2e');
  context = await launchReadingContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await (context.serviceWorkers()[0] ? Promise.resolve() : context.waitForEvent('serviceworker'));
  page = await context.newPage();
  await page.goto(base);
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
});
test.afterEach(async () => {
  await context.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (profile.startsWith(path.join(tmpdir(), 'unp-finishing-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function update(patch: Record<string, unknown>) {
  await context.serviceWorkers()[0]!.evaluate(async (patch) => {
    const { ['unp.reader.v1']: doc } = await chrome.storage.sync.get('unp.reader.v1');
    Object.assign((doc as { data: Record<string, unknown> }).data, patch);
    await chrome.storage.sync.set({ 'unp.reader.v1': doc });
  }, patch);
}
for (const mode of ['scroll', 'page'] as const) {
  test(`extension invalidation retires the old ${mode} reader without API errors or an automatic page reload`, async () => {
    if (mode === 'page') {
      await page.evaluate(() => localStorage.setItem('viewer_paging', '1'));
      await page.reload();
    }
    await expect(page.locator(`[data-unp-reader="${mode}"]`)).toBeVisible();
    await page.locator('#btn_theme').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const identity = await page.evaluate(() => performance.timeOrigin);
    const worker = context.serviceWorkers()[0]!;
    const closed = worker.waitForEvent('close');
    await worker.evaluate(() => {
      setTimeout(() => chrome.runtime.reload(), 0);
    });
    await closed;
    await page.locator('#novel_box').evaluate((box) => {
      box.scrollTop = 400;
      box.dispatchEvent(new Event('scroll'));
    });
    await expect(
      page.locator('[data-unp-reader],#unp-panel-host,#unp-navigation-host')
    ).toHaveCount(0);
    await expect(
      page.locator(mode === 'page' ? '#novel_drawing_page' : '#novel_drawing')
    ).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(identity);
    expect(errors).toEqual([]);
    // This isolated Chromium setup disables CLI-loaded extensions on runtime.reload.
    // Verify that this now-native tab remains usable; valid-context reloads are
    // covered by the enable/reload and reader persistence tests below.
    await page.locator('#btn_theme').click();
    await page.locator('#btn_theme').click();
    await expect(page.locator('#option_panel_1')).toBeVisible();
    await page.locator('#novel_box').evaluate((box) => {
      box.scrollTop = 600;
      box.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(1100); // Cover one former watchdog and position-save interval.
    await expect(
      page.locator('[data-unp-reader],#unp-panel-host,#unp-navigation-host')
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('themebox is deferred, native mode restores both panel and list, and enable survives reload', async () => {
  await expect(page.locator('#unp-panel-host')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').some((item) => item.name.includes('panel-runtime-'))
    )
  ).toBe(false);
  const list = page.locator('#list_box');
  await expect(list).toHaveAttribute('data-unp-theme', 'light');
  await expect(list).toHaveCSS('filter', 'none');
  await update({ darkMode: true });
  await expect(list).toHaveAttribute('data-unp-theme', 'dark');
  await expect(list).toHaveCSS('background-color', 'rgb(36, 33, 43)');
  await expect(list.locator('.b_free')).toHaveCSS('filter', 'none');
  await expect(list.locator('.ep_style2')).toHaveCSS('opacity', '1');
  await expect(list.locator('.episode_view_1001')).toHaveCSS(
    'background-color',
    'rgb(132, 99, 245)'
  );
  await page.locator('#btn_theme').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await page.getByRole('button', { name: '정보 설정으로 이동', exact: true }).click();
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('switch', { name: '확장 뷰어 사용', exact: true }).click(),
  ]);
  await expect(page.locator('#unp-native-enable')).toBeAttached();
  await expect(page.locator('[data-unp-reader],#unp-panel-host')).toHaveCount(0);
  await expect(list).toHaveCSS('filter', 'invert(1)');
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain('DARKMODE=0');
  await page.locator('#btn_theme').click();
  await expect(page.locator('#option_panel_1')).toBeVisible();
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('button', { name: '확장 뷰어 켜기, 새로고침', exact: true }).click(),
  ]);
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await expect(list).toHaveCSS('filter', 'none');
  await expect(page.locator('#unp-native-enable')).toHaveCount(0);
});
test('external mode change leaves navigation under user control and requests a reload', async () => {
  const documentIdentity = await page.evaluate(() => performance.timeOrigin);
  await update({ enabled: false });
  await expect(page.locator('#unp-reload-notice')).toBeVisible();
  await update({ enabled: true });
  await expect(page.locator('#unp-reload-notice')).toHaveCount(0);
  await update({ enabled: false });
  await expect(page.locator('#unp-reload-notice')).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentIdentity);
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page
      .locator('#unp-reload-notice')
      .getByRole('button', { name: '새로고침', exact: true })
      .click(),
  ]);
  await expect(page.locator('#unp-native-enable')).toBeAttached();
  await expect(page.locator('[data-unp-line]')).toHaveCount(0);
});

test('native lists can hide a paged reader across resize and settings changes then restore it', async () => {
  await page.evaluate(() => localStorage.setItem('viewer_paging', '1'));
  await page.reload();
  await expect(page.locator('[data-unp-reader="page"]')).toBeVisible();
  // The root exists during initial preparation; exercise navigation once text is readable.
  await expect(page.locator('[data-unp-line]').first()).toBeVisible();
  const box = page.locator('#novel_box');
  const list = page.locator('#list_box');
  await expect(page.locator('#unp-navigation-host')).toBeAttached();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  const position = await page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft);
  // Reproduce the site's own list handler: the list is a normal-flow sibling.
  await page.evaluate(() => {
    document.getElementById('novel_box')!.style.display = 'none';
    document.getElementById('list_box')!.style.display = 'block';
  });
  await expect(box).toBeHidden();
  await expect(list).toBeVisible();
  await page.setViewportSize({ width: 1360, height: 860 });
  await update({ fontSize: 22 });
  await expect(box).toBeHidden();
  expect(await list.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(100);
  await list.getByRole('button', { name: '회차 목록 동작' }).click();
  await expect(list.getByRole('button')).toHaveAttribute('data-used', '1');
  await page.evaluate(() => {
    document.getElementById('list_box')!.style.display = 'none';
    document.getElementById('novel_box')!.style.display = 'block';
  });
  await expect(box).toBeVisible();
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '22px');
  expect(position).toBeGreaterThan(0);
  expect(
    await page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft)
  ).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a delayed native dark reply cannot overwrite a newer light selection', async () => {
  await page.evaluate(() => {
    let id = '';
    let held = false;
    window.addEventListener(
      'message',
      (event) => {
        const value = event.data;
        if (value?.channel !== 'unp.native.v1') return;
        if (
          value.direction === 'request' &&
          value.command?.type === 'option' &&
          value.command.option === 'dark' &&
          value.command.value === true
        )
          id = value.id;
        if (!held && id && value.direction === 'reply' && value.id === id) {
          held = true;
          document.body.dataset.heldDarkReply = 'true';
          event.stopImmediatePropagation();
          setTimeout(() => window.postMessage(value, location.origin), 200);
        }
      },
      true
    );
  });
  await update({ darkMode: true });
  await expect(page.locator('body')).toHaveAttribute('data-held-dark-reply', 'true');
  await update({ darkMode: false });
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain('DARKMODE=0');
  await expect(page.locator('#list_box')).toHaveAttribute('data-unp-theme', 'light');
});
