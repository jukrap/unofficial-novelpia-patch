import {
  launchReadingContext,
  readingFontBytes,
  readingFontCss,
  readingFontUrl,
} from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
// @ts-expect-error Synthetic fixture only; no novel text or service requests.
import { viewerHtml } from '../fixtures/viewer.mjs';

let server: http.Server;
let base: string;
let context: BrowserContext;
let profile: string;
const palette = {
  enabled: true,
  backgroundColor: '#233344',
  textColor: '#e6eef8',
  textAreaBackgroundColor: '#344455',
  textAreaOpacity: 65,
  readingSurfaces: 'opaque',
  darkMode: true,
};
interface FrameSample {
  time: number;
  preparing: boolean;
  marked: boolean;
  visible: boolean;
  nativeLoader: boolean;
  extensionLoader: boolean;
  ink: string;
  paper: string;
  image: boolean;
}
type SampleWindow = Window & typeof globalThis & { displayFrames: FrameSample[] };

function syntheticViewer() {
  return viewerHtml()
    .replace(
      '<div id="novel_text">',
      '<div id="novel_text"><div id="load_bar" style="text-align:center;color:#ea2060"><br><br><br><div style="background-color:#eeeeee66">소설 내용을 불러오고 있습니다.</div></div>'
    )
    .replace(
      'setTimeout(viewer_display,120);',
      `const originalDisplay=viewer_display;
      viewer_display=()=>{
        originalDisplay();
        const root=document.getElementById(localStorage.getItem('viewer_paging')==='1'?'novel_drawing_page':'novel_drawing');
        const end=document.createElement('div');
        end.dataset.testid='notice-end';
        end.style.cssText='color:#914817;background:rgba(190,160,120,.3);border:2px dashed #665544;box-shadow:1px 2px 3px #223344;opacity:.85';
        end.textContent='여기까지가 공지 마지막 내용입니다.';
        root.append(end);
        const cover=document.createElement('div');
        cover.className='cover-wrapper';
        cover.style.cssText='margin:20px 0;text-align:center';
        cover.innerHTML='<button class="cover-text" style="color:#999;background:rgba(155,155,155,.1);border:1px solid #ccc">커버보기</button><img hidden alt="합성 커버" width="80" height="120" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2780%27 height=%27120%27%3E%3Crect width=%2780%27 height=%27120%27 fill=%27%239090a0%27/%3E%3C/svg%3E">';
        cover.firstElementChild.onclick=function(){const image=this.nextElementSibling;image.hidden=!image.hidden;this.textContent=image.hidden?'커버보기':'커버접기';};
        root.append(cover);
        const decoy=document.createElement('span');
        decoy.dataset.testid='notice-in-fiction';
        decoy.style.background='rgb(89,67,45)';
        decoy.textContent='여기까지가 공지 마지막 내용입니다.';
        root.querySelector('.line[data-line="1"]').append(decoy);
        if(!document.querySelector('[data-testid="notice-in-service"]'))document.getElementById('test-banner').insertAdjacentHTML('beforeend','<div data-testid="notice-in-service" style="background:rgb(23,45,67)">여기까지가 공지 마지막 내용입니다.</div>');
      };
      window.releaseSyntheticBody=()=>{
        viewer_display();
        document.getElementById('load_bar').style.display='none';
      };
      if(!location.search.includes('hold-body'))setTimeout(window.releaseSyntheticBody,120);`
    );
}
test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    let html = syntheticViewer();
    if (request.url?.includes('inherited-loading'))
      html = html
        .replace('text-align:center;color:#ea2060', 'text-align:center')
        .replace('body{margin:0;', 'body{color:#965b29!important;margin:0;');
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-first-display-'));
  const extension = path.resolve('.output/chrome-mv3-e2e');
  context = await launchReadingContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await (context.serviceWorkers()[0] ? Promise.resolve() : context.waitForEvent('serviceworker'));
  await seed();
  await context.addInitScript(() => {
    const frameWindow = window as SampleWindow;
    frameWindow.displayFrames = [];
    const visible = (element: Element | null) => {
      if (!element?.getClientRects().length) return false;
      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };
    const sample = () => {
      const line = document.querySelector('.line[data-line="1"]');
      const box = document.querySelector('#novel_box');
      const base = document.querySelector('[data-unp-background-base]');
      // A reduced reading viewport paints its outer surface on a sibling layer.
      // Sample that visible paint owner after the bootstrap hands colors over.
      const paper = box ? getComputedStyle(box).backgroundColor : '';
      frameWindow.displayFrames.push({
        time: performance.now(),
        preparing: document.documentElement?.hasAttribute('data-unp-preparing') ?? false,
        marked: !!line?.hasAttribute('data-unp-line'),
        visible: visible(line),
        nativeLoader: visible(document.getElementById('load_bar')),
        extensionLoader: visible(document.getElementById('unp-reader-loading')),
        ink: line ? getComputedStyle(line).color : '',
        paper:
          paper === 'rgba(0, 0, 0, 0)' && visible(base)
            ? getComputedStyle(base!).backgroundColor
            : paper,
        image: visible(document.querySelector('[data-unp-background]')),
      });
      if (frameWindow.displayFrames.length < 1200) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
});
test.afterEach(async () => {
  await context.close();
  if (profile.startsWith(path.join(tmpdir(), 'unp-first-display-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function seed(patch: Record<string, unknown> = {}, legacyCache = false) {
  await context.serviceWorkers()[0]!.evaluate(
    async ({ palette, patch, legacyCache }) => {
      const data = { ...palette, fontFamily: 'system-ui', pageEffect: 'none', ...patch };
      await chrome.storage.sync.set({
        'unp.reader.v1': { schemaVersion: 1, data },
      });
      const theme = { ...palette, ...patch };
      if (legacyCache) {
        delete (theme as Partial<typeof theme>).textAreaOpacity;
        delete (theme as Partial<typeof theme>).readingSurfaces;
      }
      await chrome.storage.local.set({ 'unp.startup.v1': theme });
    },
    { palette, patch, legacyCache }
  );
}
async function open(query = '') {
  const page = await context.newPage();
  await page.goto(`${base}/viewer/1001${query}`, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  return page;
}
async function frames(page: Page) {
  return page.evaluate(() => (window as SampleWindow).displayFrames);
}
async function saveEvidence(page: Page, name: string) {
  await writeFile(
    test.info().outputPath(`${name}-frames.json`),
    JSON.stringify(await frames(page), null, 2)
  );
  await test.info().attach(`${name}-frames`, {
    body: JSON.stringify(await frames(page), null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}
function gate() {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
}
async function png() {
  const page = await context.newPage();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ink = canvas.getContext('2d')!;
    ink.fillStyle = '#665080';
    ink.fillRect(0, 0, 16, 16);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.close();
  return Buffer.from(base64, 'base64');
}
async function assertDeferredSettings(page: Page) {
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((entry) => /panel-runtime-|preset-editor-/.test(entry.name))
    )
  ).toBe(false);
}

test('native loading keeps the selected palette without a duplicate loader, premature statistics, or a fixed delay', async () => {
  const page = await open('?hold-body');
  await expect(page.locator('#load_bar')).toBeVisible();
  await expect(page.locator('#load_bar > div')).toHaveCSS('color', 'rgb(230, 238, 248)');
  await expect(page.locator('#load_bar > div')).toHaveCSS('background-color', 'rgb(52, 68, 85)');
  await page.waitForTimeout(2700); // A healthy runtime may wait longer than the failure watchdog for native text.
  await expect(page.locator('html')).toHaveAttribute('data-unp-preparing', '');
  await expect(page.locator('#unp-reader-loading')).toBeHidden();
  const episodes = await context.serviceWorkers()[0]!.evaluate(async () => {
    const data = await chrome.storage.local.get('unp.reading-stats.v1.episodes');
    return data['unp.reading-stats.v1.episodes'] ?? [];
  });
  expect(episodes).toEqual([]);
  await page.locator('#test-banner button').click();
  await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
  const start = await page.evaluate(() => {
    (window as unknown as { releaseSyntheticBody(): void }).releaseSyntheticBody();
    return performance.now();
  });
  await expect(page.locator('[data-unp-line][data-line="1"]')).toBeVisible();
  // Keep sampling through the site's delayed redraw/position callbacks.
  await page.waitForTimeout(650);
  const history = await frames(page);
  await saveEvidence(page, 'native-loading-handoff');
  const reveal = history.find((frame) => frame.visible);
  expect(reveal).toBeDefined();
  expect(reveal!.time - start).toBeLessThan(1800);
  expect(history.some((frame) => frame.nativeLoader && frame.extensionLoader)).toBe(false);
  expect(history.filter((frame) => frame.visible && frame.ink !== 'rgb(230, 238, 248)')).toEqual(
    []
  );
  const firstPaint = history.findIndex((frame) => frame.paper === 'rgb(35, 51, 68)');
  expect(firstPaint).toBeGreaterThanOrEqual(0);
  expect(history.slice(firstPaint).every((frame) => frame.paper === 'rgb(35, 51, 68)')).toBe(true);
  await assertDeferredSettings(page);
});

test('an initial image delays only body text until decode and hands the background over without a blank frame', async () => {
  const image = await png();
  const pending = gate();
  await context.route(`${base}/initial-image.png`, async (route) => {
    await pending.pending;
    await route.fulfill({ body: image, contentType: 'image/png' });
  });
  await seed({
    backgroundType: 'image',
    backgroundImage: `${base}/initial-image.png`,
    backgroundImageFade: false,
  });
  const page = await open();
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await expect(page.locator('[data-unp-line][data-line="1"]')).toBeHidden();
  await expect(page.locator('#unp-reader-loading')).toBeVisible();
  await page.locator('#test-banner button').click();
  await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
  await page.waitForTimeout(350);
  pending.release();
  await expect(page.locator('[data-unp-background]')).toBeVisible();
  await expect(page.locator('[data-unp-line][data-line="1"]')).toBeVisible();
  await expect(page.locator('#unp-reader-loading,#unp-first-layout')).toHaveCount(0);
  const history = await frames(page);
  expect(history.some((frame) => frame.marked && !frame.visible)).toBe(true);
  expect(history.filter((frame) => frame.visible).every((frame) => frame.image)).toBe(true);
  await assertDeferredSettings(page);
  await saveEvidence(page, 'image-ready-handoff');
});

for (const mode of ['scroll', 'page'])
  test(`initial ${mode} image fades from the chosen color over 800ms without exposing native black`, async () => {
    const image = await png();
    const pending = gate();
    await context.route(`${base}/gentle-image.png`, async (route) => {
      await pending.pending;
      await route.fulfill({ body: image, contentType: 'image/png' });
    });
    await context.addInitScript(
      (mode) => localStorage.setItem('viewer_paging', mode === 'page' ? '1' : '0'),
      mode
    );
    await seed({
      backgroundType: 'image',
      backgroundImage: `${base}/gentle-image.png`,
      backgroundImageFade: true,
      backgroundColor: '#D2C9B8',
      overlayOpacity: 0,
      pageNavigationPlacement: 'overlay',
      readerHeightPercent: 100,
    });
    const page = await open('?hold-body');
    expect(await page.title()).toBe('UNP Synthetic Viewer');
    await page.addStyleTag({ content: 'html,body{background:#000!important}' });
    await expect(page.locator('#load_bar')).toBeVisible();
    await page.evaluate(() => {
      new MutationObserver(() => {
        const layer = document.querySelector('[data-unp-background]');
        if (!layer || layer.hasAttribute('data-test-paused')) return;
        layer.setAttribute('data-test-paused', '');
        for (const animation of layer.getAnimations()) {
          animation.pause();
          animation.currentTime = 0;
        }
      }).observe(document.body, { childList: true, subtree: true });
      (window as unknown as { releaseSyntheticBody(): void }).releaseSyntheticBody();
    });
    await expect(page.locator('[data-unp-line]').first()).toBeAttached();
    pending.release();
    const layer = page.locator('[data-unp-background]');
    await expect(layer).toHaveCSS('opacity', '0');
    await expect(page.locator('[data-unp-line]').first()).toBeVisible();
    const pixel = async () => {
      const shot = await page.screenshot({ clip: { x: 4, y: 100, width: 1, height: 1 } });
      return page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      }, shot.toString('base64'));
    };
    expect(await pixel()).toEqual([210, 201, 184]);
    const bounds = await page.locator('#novel_box').boundingBox();
    expect(await layer.evaluate((el) => el.getAnimations()[0]!.effect!.getTiming().duration)).toBe(
      800
    );
    await page.screenshot({ path: test.info().outputPath(`${mode}-fade-start.png`) });
    await layer.evaluate((el) => {
      el.getAnimations()[0]!.currentTime = 400;
    });
    const middle = await pixel();
    expect(middle[0]).toBeGreaterThan(102);
    expect(middle[0]).toBeLessThan(210);
    expect(middle[1]).toBeGreaterThan(80);
    expect(middle[1]).toBeLessThan(201);
    await page.screenshot({ path: test.info().outputPath(`${mode}-fade-middle.png`) });
    await layer.evaluate((el) => el.getAnimations()[0]!.finish());
    await expect(layer).toHaveCSS('opacity', '1');
    expect(await pixel()).toEqual([102, 80, 128]);
    expect(await page.locator('#novel_box').boundingBox()).toEqual(bounds);
    await page.screenshot({ path: test.info().outputPath(`${mode}-fade-end.png`) });
  });

test('font and author emphasis faces finish before the first text paint when they arrive within the budget', async () => {
  const pending = gate();
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\//, async (route) => {
    await pending.pending;
    await route.fulfill({
      contentType: 'text/css',
      body: readingFontCss('Pretendard Variable'),
    });
  });
  await seed({ fontFamily: 'Pretendard', fontWeight: 600 });
  const page = await open();
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await expect(page.locator('[data-unp-line][data-line="1"]')).toBeHidden();
  await expect(page.locator('#unp-reader-loading')).toBeVisible();
  pending.release();
  await expect(page.locator('[data-unp-line][data-line="1"]')).toBeVisible();
  await expect(page.locator('[data-unp-line] b').first()).toHaveCSS('font-weight', '900');
  await expect(page.locator('[data-unp-line][data-line="1"]')).toHaveCSS('font-weight', '600');
  expect(
    await page.evaluate(
      () =>
        document.fonts.check('600 18px "Pretendard Variable"') &&
        document.fonts.check('900 18px "Pretendard Variable"')
    )
  ).toBe(true);
  await saveEvidence(page, 'font-ready-handoff');
});

test('a quick Latin subset does not reveal Korean body text before the Korean font subset has loaded', async () => {
  const pending = gate();
  // The bundled real font exercises decoding and separate Unicode-range requests.
  // Remote Noto glyph appearance remains the responsibility of live font checks.
  const font = await readingFontBytes;
  await context.route(/^https:\/\/fonts\.googleapis\.com\//, (route) =>
    route.fulfill({
      contentType: 'text/css',
      body: `@font-face{font-family:"Noto Sans KR";font-weight:100 900;src:url("${readingFontUrl}") format("woff2");unicode-range:U+0000-00FF}
       @font-face{font-family:"Noto Sans KR";font-weight:100 900;src:url("${base}/hangul-subset.woff2") format("woff2");unicode-range:U+AC00-D7A3}`,
    })
  );
  let requested = false;
  await context.route(`${base}/hangul-subset.woff2`, async (route) => {
    requested = true;
    await pending.pending;
    await route.fulfill({
      body: font,
      contentType: 'font/woff2',
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  await seed({ fontFamily: 'Noto Sans KR', fontWeight: 600 });
  const page = await open();
  await expect.poll(() => requested).toBe(true);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.fonts.check('600 18px "Noto Sans KR"', 'abc'))).toBe(
    true
  );
  await expect(page.locator('[data-unp-line][data-line="1"]')).toBeHidden();
  const koreanSubset = () =>
    page.evaluate(() =>
      [...document.fonts]
        .filter((face) => face.family === 'Noto Sans KR' && face.unicodeRange.includes('AC00'))
        .map((face) => face.status)
    );
  expect(await koreanSubset()).toEqual(['loading']);
  pending.release();
  await expect(page.locator('[data-unp-line][data-line="1"]')).toBeVisible();
  expect(await koreanSubset()).toEqual(['loaded']);
  expect(
    await page.evaluate(
      () =>
        document.fonts.check('600 18px "Noto Sans KR"', '문단') &&
        document.fonts.check('900 18px "Noto Sans KR"', '문단')
    )
  ).toBe(true);
  await saveEvidence(page, 'font-subset-ready-handoff');
});

test('a completed native load without accessible body leaves no extension preparation layer behind', async () => {
  const page = await open('?hold-body');
  await expect(page.locator('#load_bar')).toBeVisible();
  await expect(page.locator('#load_bar > div')).toHaveCSS('color', 'rgb(230, 238, 248)');
  await page.evaluate(() => {
    document.getElementById('load_bar')!.style.display = 'none';
    const gate = document.createElement('p');
    gate.id = 'synthetic-access-gate';
    gate.textContent = '로그인이 필요한 회차입니다.';
    document.getElementById('novel_text')!.append(gate);
  });
  await expect(page.locator('#synthetic-access-gate')).toBeVisible();
  await expect(page.locator('#unp-first-layout,#unp-reader-loading')).toHaveCount(0, {
    timeout: 4000,
  });
  await expect(page.locator('[data-unp-line],#unp-navigation-host')).toHaveCount(0);
  await page.locator('#test-banner button').click();
  await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
});

test('the original surface mode preserves a loading message color inherited from native ancestors', async () => {
  await seed({ readingSurfaces: 'default', darkMode: false });
  const page = await open('?hold-body&inherited-loading');
  const loading = page.locator('#load_bar > div');
  await expect(loading).toHaveCSS('color', 'rgb(150, 91, 41)');
  await expect(loading).toHaveCSS('background-color', 'rgba(238, 238, 238, 0.4)');
  await page.waitForTimeout(250);
  await expect(loading).toHaveCSS('color', 'rgb(150, 91, 41)');
  for (const readingSurfaces of ['opaque', 'default']) {
    await context.serviceWorkers()[0]!.evaluate(async (readingSurfaces) => {
      const data = await chrome.storage.sync.get('unp.reader.v1');
      const doc = data['unp.reader.v1'] as { data: Record<string, unknown> };
      doc.data.readingSurfaces = readingSurfaces;
      await chrome.storage.sync.set({ 'unp.reader.v1': doc });
    }, readingSurfaces);
    await expect(loading).toHaveCSS(
      'color',
      readingSurfaces === 'opaque' ? 'rgb(230, 238, 248)' : 'rgb(150, 91, 41)'
    );
  }
});

test('a slow image falls back after three seconds, and late completion never hides the revealed reader again', async () => {
  const image = await png();
  const pending = gate();
  await context.route(`${base}/late-image.png`, async (route) => {
    await pending.pending;
    await route.fulfill({ body: image, contentType: 'image/png' });
  });
  await seed({ backgroundType: 'image', backgroundImage: `${base}/late-image.png` });
  const page = await open();
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await expect(page.locator('[data-unp-line][data-line="1"]')).toBeVisible({ timeout: 6500 });
  const history = await frames(page);
  const marked = history.find((frame) => frame.marked)!;
  const reveal = history.find((frame) => frame.visible)!;
  expect(reveal.time - marked.time).toBeGreaterThan(2700);
  expect(reveal.time - marked.time).toBeLessThan(4500);
  expect(reveal.image).toBe(false);
  expect(reveal.paper).toBe('rgb(35, 51, 68)');
  await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
  // Use a reading gesture after the fallback is presented, rather than racing
  // a programmatic scroll against the initial restoration/reveal.
  const start = await page.locator('#novel_box').evaluate((box) => box.scrollTop);
  await page.mouse.move(700, 300);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => page.locator('#novel_box').evaluate((box) => box.scrollTop))
    .toBe(start + 400);
  const position = await page.locator('#novel_box').evaluate((box) => box.scrollTop);
  pending.release();
  await expect(page.locator('[data-unp-background]')).toBeVisible();
  await expect(page.locator('#unp-first-layout,#unp-reader-loading')).toHaveCount(0);
  expect(
    (await frames(page))
      .filter((frame) => frame.time >= reveal.time)
      .every((frame) => frame.visible)
  ).toBe(true);
  expect(await page.locator('#novel_box').evaluate((box) => box.scrollTop)).toBe(position);
  await saveEvidence(page, 'late-image-fallback');
});

test('a failed image and an older startup cache release the reader without waiting the full asset budget', async () => {
  await context.route(`${base}/failed-image.png`, (route) => route.abort());
  await seed({ backgroundType: 'image', backgroundImage: `${base}/failed-image.png` }, true);
  const page = await open();
  await expect(page.locator('[data-unp-line][data-line="1"]')).toBeVisible();
  const history = await frames(page);
  const marked = history.find((frame) => frame.marked)!;
  const reveal = history.find((frame) => frame.visible)!;
  expect(reveal.time - marked.time).toBeLessThan(1800);
  await expect(page.locator('#unp-reader-loading,#unp-first-layout')).toHaveCount(0);
  await expect(page.locator('[data-unp-line][data-line="1"]')).toHaveCSS(
    'color',
    'rgb(230, 238, 248)'
  );
  await page.locator('#btn_theme').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await expect(page.getByTestId('settings-panel')).toContainText('이미지를 불러오지 못했습니다');
  await saveEvidence(page, 'failed-image-recovery');
});

test('a failed MV3 runtime import releases the native reader and leaves its service controls usable', async () => {
  const page = await context.newPage();
  const protocol = await context.newCDPSession(page);
  await protocol.send('Network.enable');
  await protocol.send('Network.setBlockedURLs', {
    urls: ['chrome-extension://*/content-scripts/esm/viewer.js'],
  });
  const start = Date.now();
  await page.goto(`${base}/viewer/1001`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.line[data-line="1"]')).toBeVisible({ timeout: 3500 });
  await expect(page.locator('[data-unp-line],#unp-first-layout,#unp-reader-loading')).toHaveCount(
    0
  );
  expect(Date.now() - start).toBeLessThan(3500);
  await page.locator('#test-banner button').click();
  await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
  await page.locator('#btn_theme').click();
  await expect(page.locator('#option_panel_1')).toBeVisible();
  await saveEvidence(page, 'runtime-import-recovery');
});

test('a disabled startup cache never prepares or restyles the native reader', async () => {
  await seed({ enabled: false });
  const page = await open();
  await expect(page.locator('.line[data-line="1"]')).toBeVisible();
  await expect(page.locator('[data-unp-line],#unp-first-layout,#unp-reader-loading')).toHaveCount(
    0
  );
  await expect(page.locator('#unp-native-enable')).toBeAttached();
  await expect(page.getByTestId('notice-end')).toHaveCSS('color', 'rgb(145, 72, 23)');
  await expect(page.locator('#load_bar > div')).toHaveCSS(
    'background-color',
    'rgba(238, 238, 238, 0.4)'
  );
  await page.locator('#test-banner button').click();
  await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
});

for (const dark of [false, true]) {
  test(`native notice and loading surfaces follow all four modes in ${dark ? 'dark' : 'light'} UI without styling fiction or services`, async () => {
    await seed({ darkMode: dark });
    const page = await open();
    const notice = page.getByTestId('notice-end');
    const loading = page.locator('#load_bar > div');
    const cover = page.locator('.cover-wrapper > .cover-text');
    await expect(page.locator('[data-unp-line][data-line="1"]')).toBeVisible();
    for (const mode of ['translucent', 'theme', 'default', 'opaque']) {
      await context.serviceWorkers()[0]!.evaluate(async (mode) => {
        const raw = await chrome.storage.sync.get('unp.reader.v1');
        const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
        doc.data.readingSurfaces = mode;
        await chrome.storage.sync.set({ 'unp.reader.v1': doc });
      }, mode);
      if (mode === 'default') {
        await expect(notice).toHaveCSS('color', 'rgb(145, 72, 23)');
        await expect(notice).toHaveCSS('background-color', 'rgba(190, 160, 120, 0.3)');
        await expect(notice).toHaveCSS('border-top-style', 'dashed');
        await expect(notice).toHaveCSS('box-shadow', 'rgb(34, 51, 68) 1px 2px 3px 0px');
        await expect(loading).toHaveCSS('color', 'rgb(234, 32, 96)');
        await expect(loading).toHaveCSS('background-color', 'rgba(238, 238, 238, 0.4)');
        await expect(cover).toHaveCSS('color', 'rgb(153, 153, 153)');
        await expect(cover).toHaveCSS('background-color', 'rgba(155, 155, 155, 0.1)');
      } else {
        const paper =
          mode === 'theme'
            ? dark
              ? 'rgb(36, 33, 42)'
              : 'rgb(255, 255, 255)'
            : mode === 'translucent'
              ? 'rgba(52, 68, 85, 0.8)'
              : 'rgb(52, 68, 85)';
        const ink =
          mode === 'theme'
            ? dark
              ? 'rgb(241, 237, 247)'
              : 'rgb(41, 38, 48)'
            : 'rgb(230, 238, 248)';
        for (const surface of [notice, loading, cover]) {
          await expect(surface).toHaveCSS('background-color', paper);
          await expect(surface).toHaveCSS('color', ink);
        }
      }
      await expect(notice).toHaveCSS('opacity', '0.85');
      await expect(page.locator('#load_bar')).toBeHidden();
      await expect(page.getByTestId('notice-in-fiction')).toHaveCSS(
        'background-color',
        'rgb(89, 67, 45)'
      );
      await expect(page.getByTestId('notice-in-service')).toHaveCSS(
        'background-color',
        'rgb(23, 45, 67)'
      );
    }
    await notice.evaluate((element) => element.replaceWith(element.cloneNode(true)));
    await expect(notice).toHaveCSS('color', 'rgb(230, 238, 248)');
    await cover.click();
    await expect(cover).toHaveText('커버접기');
    await expect(page.getByAltText('합성 커버')).toBeVisible();
    await expect(cover).toHaveCSS('color', 'rgb(230, 238, 248)');
    await expect(page.locator('.cover-wrapper')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await cover.click();
    await expect(cover).toHaveText('커버보기');
    await expect(page.getByAltText('합성 커버')).toBeHidden();
    await page.locator('#test-banner button').click();
    await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
    await page.mouse.move(720, 400);
    await page.mouse.wheel(0, 100000);
    await expect(notice).toBeInViewport();
    await saveEvidence(page, `notice-surfaces-${dark ? 'dark' : 'light'}`);
  });
}
