import { launchReadingContext, closeReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
// @ts-expect-error The fixture is a plain JS server module, never bundled into the extension.
import { viewerHtml } from '../fixtures/viewer.mjs';
let server: http.Server;
let base: string;
let context: BrowserContext;
let profile: string;
let page: Page;
let extensionId: string;
test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(viewerHtml());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-e2e-'));
  const extension = path.resolve('.output/chrome-mv3-e2e');
  context = await launchReadingContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  await page.goto(`${base}/viewer/1001`);
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await expect(page.getByRole('alert', { includeHidden: true })).toHaveCount(0);
});
test.afterEach(async () => {
  await closeReadingContext(context);
  if (profile.startsWith(path.join(tmpdir(), 'unp-e2e-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function externalDisable() {
  await updateReader({ enabled: false });
  await expect(page.locator('#unp-reload-notice')).toBeVisible();
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page
      .locator('#unp-reload-notice')
      .getByRole('button', { name: '새로고침', exact: true })
      .click(),
  ]);
  await expect(page.locator('#unp-native-enable')).toBeAttached();
}
async function disableViewer() {
  await expect(page.getByRole('switch', { name: '확장 뷰어 사용', exact: true })).toBeChecked();
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('switch', { name: '확장 뷰어 사용', exact: true }).click(),
  ]);
  await expect(page.locator('#unp-native-enable')).toBeAttached();
}
async function openSettings() {
  await page.locator('#btn_theme').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
}
async function settingsSection(target: Page, label: string) {
  if (new URL(target.url()).pathname === '/options.html') {
    await expect(target.getByTestId('management-page')).toBeVisible();
    await target
      .getByRole('navigation', { name: '관리 항목' })
      .getByRole('button', { name: label, exact: true })
      .click();
    return;
  }
  await target.getByRole('button', { name: `${label} 설정으로 이동`, exact: true }).click();
}
async function setNumber(label: string, value: number) {
  await settingsSection(
    page,
    ['본문 너비', '본문 높이', '좌우 여백', '상하 여백'].includes(label) ? '레이아웃' : '텍스트'
  );
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value));
  await input.press('Enter');
}
async function updateReader(patch: Record<string, string | number | boolean>) {
  await context.serviceWorkers()[0]!.evaluate(async (patch) => {
    const raw = await chrome.storage.sync.get('unp.reader.v1');
    const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
    Object.assign(doc.data, patch);
    await chrome.storage.sync.set({ 'unp.reader.v1': doc });
  }, patch);
}
async function clickProgressEnd() {
  const slider = page.locator('#unp-navigation-host input[type="range"]');
  const bounds = (await slider.boundingBox())!;
  await slider.click({ position: { x: bounds.width - 1, y: bounds.height / 2 } });
}
type TestAnchor = { episodeId: string; blockKey: string; textOffset: number; edge: string };
async function storedAnchor(kind: 'position' | 'bookmark', episode = '1001') {
  return context.serviceWorkers()[0]!.evaluate(
    async ({ kind, episode }) => {
      const key = `unp.${kind}.v1.${episode}`;
      return (await chrome.storage.local.get(key))[key] as TestAnchor | undefined;
    },
    { kind, episode }
  );
}
async function anchorVisible(anchor: TestAnchor) {
  return page.evaluate((a) => {
    const block = document.querySelector(`.line[data-line="${a.blockKey}"]`);
    if (!block) return false;
    const body = block.closest('[data-unp-reader]');
    const viewport = document
      .getElementById(
        body?.getAttribute('data-unp-reader') === 'page' ? 'novel_drawing_page_c' : 'novel_box'
      )!
      .getBoundingClientRect();
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let offset = a.textOffset;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (offset < node.length) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const r = range.getBoundingClientRect();
        return (
          r.right > viewport.left &&
          r.left < viewport.right &&
          r.bottom > viewport.top &&
          r.top < viewport.bottom
        );
      }
      offset -= node.length;
    }
    return [...block.getClientRects()].some(
      (r) =>
        r.right > viewport.left &&
        r.left < viewport.right &&
        r.bottom > viewport.top &&
        r.top < viewport.bottom
    );
  }, anchor);
}
async function seekFraction(fraction: number) {
  const slider = page.locator('#unp-navigation-host input[type="range"]');
  // A restored anchor can already intersect the viewport while the final
  // layout/reveal is still changing the range geometry.
  await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
  await expect(page.locator('html[data-unp-preparing]')).toHaveCount(0);
  const bounds = (await slider.boundingBox())!;
  await slider.click({ position: { x: bounds.width * fraction, y: bounds.height / 2 } });
}
const presetCard = (target: Page, name: string) =>
  target.getByRole('article', { name, exact: true });
const presetEditor = (target: Page) =>
  target.getByRole('form', { name: '프리셋 편집', exact: true });
async function createPreset(target: Page, name: string, apply = false) {
  await settingsSection(target, '프리셋');
  await target.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
  await presetEditor(target).getByRole('textbox', { name: '이름', exact: true }).fill(name);
  await target.getByRole('button', { name: apply ? '저장하고 적용' : '저장', exact: true }).click();
  await expect(presetEditor(target)).toHaveCount(0);
  await expect(presetCard(target, name)).toBeVisible();
}
async function fontLoaded(target: Page, family: string, size: number) {
  return target.evaluate(
    ({ family, size }) => {
      let loaded = false;
      document.fonts.forEach((face) => {
        if (face.family.replace(/["']/g, '') === family && face.status === 'loaded') loaded = true;
      });
      return loaded && document.fonts.check(`400 ${size}px "${family}"`);
    },
    { family, size }
  );
}

test('page paper stays behind every spread and includes adjustable inner margins', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await updateReader({
    maxWidth: 600,
    horizontalPadding: 30,
    verticalPadding: 20,
    backgroundColor: '#b7c5e0',
    textAreaBackgroundColor: '#14101c',
    textAreaOpacity: 80,
    textColor: '#f4f0fa',
  });
  await openSettings();
  await settingsSection(page, '레이아웃');
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: '페이지 방식', exact: true }).click(),
  ]);
  const paper = page.locator('#novel_drawing_page_c');
  const body = page.locator('#novel_drawing_page');
  await expect(body).toHaveCSS('column-count', '2');
  // Geometry exists during preparation; compare painted paper only after the
  // reading position and navigation have been restored and the body is shown.
  await expect(body.locator('[data-unp-line]').first()).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-unp-preparing', '');
  const original = (await paper.boundingBox())!;
  await updateReader({ horizontalPadding: 80, verticalPadding: 60 });
  await expect(body).toHaveCSS('margin', '60px 80px');
  const bounds = (await paper.boundingBox())!;
  expect(bounds).toEqual(original);
  await expect(body).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(paper).toHaveCSS('background-attachment', 'scroll');
  const crop = async (x: number) => {
    const png = await page.screenshot({ clip: { x, y: bounds.y + 4, width: 4, height: 4 } });
    return page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 4;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, 4, 4).data;
      return [0, 1, 2].map((channel) => {
        let total = 0;
        for (let i = channel; i < pixels.length; i += 4) total += pixels[i]!;
        return total / 16;
      });
    }, png.toString('base64'));
  };
  const difference = (a: number[], b: number[]) =>
    Math.max(...a.map((value, i) => Math.abs(value - b[i]!)));
  const left = await crop(bounds.x + 4);
  const gutter = await crop(bounds.x + bounds.width / 2 - 2);
  expect(difference(left, gutter)).toBeGreaterThan(50);
  expect(difference(left, await crop(bounds.x + bounds.width - 8))).toBeLessThan(2);
  const slider = page.getByRole('slider', { name: '본문 페이지', exact: true });
  await slider.press('Home');
  await page.screenshot({ path: test.info().outputPath('paper-first.png') });
  await page.getByRole('button', { name: '다음 쪽', exact: true }).click();
  await expect.poll(() => paper.evaluate((el) => el.scrollLeft)).toBeGreaterThan(bounds.width);
  expect(difference(left, await crop(bounds.x + 4))).toBeLessThan(2);
  expect(difference(left, await crop(bounds.x + bounds.width - 8))).toBeLessThan(2);
  await page.screenshot({ path: test.info().outputPath('paper-middle.png') });
  await slider.press('End');
  expect(difference(left, await crop(bounds.x + 4))).toBeLessThan(2);
  await updateReader({ spreadMode: 'single' });
  await expect(body).toHaveCSS('column-count', '1');
  await expect(paper).toHaveCSS('background-image', 'none');
  await expect(paper).toHaveCSS('background-color', 'rgba(20, 16, 28, 0.8)');
  await slider.press('Home');
  const inset = await body.evaluate((el) => {
    const b = el.getBoundingClientRect(),
      p = el.parentElement!.getBoundingClientRect();
    return {
      left: b.left - p.left,
      top: b.top - p.top,
      right: p.right - b.right,
      bottom: p.bottom - b.bottom,
    };
  });
  expect(inset).toEqual({ left: 80, right: 80, top: 60, bottom: 60 });
  await externalDisable();
  await expect(body).not.toHaveAttribute('data-unp-reader');
  await expect(paper).toHaveCSS('background-image', 'none');
  await expect(paper).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('themed episode hints and next button keep native actions and restore native paint on disable', async () => {
  await page.goto(`${base}/viewer/1001?controls`);
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  const adStyle = await page.locator('#test-banner').getAttribute('style');
  // The site may insert these after attaching the reader, or replace them on a mode change.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      for (const id of ['next_info_layer', 'back_info_layer']) {
        const hint = document.createElement('div');
        hint.id = id;
        hint.style.cssText =
          'display:none;position:fixed;top:calc(50% - 40px);width:240px;left:calc(50% - 120px);background-color:rgba(100,100,100,.3);font-size:12px;padding:5px 0;color:#333';
        hint.textContent =
          id === 'next_info_layer'
            ? '한번 더 누르면 다음화로 이동합니다'
            : '한번 더 누르면 이전화로 이동합니다';
        document.body.append(hint);
      }
    });
  });
  await page.reload();
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await updateReader({ textColor: '#dce8fa', darkMode: true, readingSurfaces: 'theme' });
  const hint = page.locator('#next_info_layer');
  await expect(hint).toHaveCSS('background-color', 'rgb(36, 33, 42)');
  await expect(hint).toHaveCSS('color', 'rgb(241, 237, 247)');
  await expect(hint).toHaveCSS('font-size', '14px');
  await expect(hint).toBeHidden();
  await expect(page.locator('#next_epi_btn_bottom')).toHaveCSS('color', 'rgb(241, 237, 247)');
  await hint.evaluate((el) => {
    el.style.display = 'block';
    el.style.opacity = '0.5';
  });
  await expect(hint).toHaveCSS('opacity', '0.5');
  await updateReader({ darkMode: false });
  await expect(hint).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(hint).toHaveCSS('color', 'rgb(41, 38, 48)');
  await expect(hint).toHaveCSS('opacity', '0.5');
  await page.locator('#next_epi_btn_bottom').click();
  await expect(page.locator('body')).toHaveAttribute('data-episode-next', 'yes');
  expect(await page.locator('#test-banner').getAttribute('style')).toBe(adStyle);
  await externalDisable();
  await expect(hint).toHaveCSS('background-color', 'rgba(100, 100, 100, 0.3)');
  await expect(hint).toHaveCSS('font-size', '12px');
  await expect(hint).toHaveCSS('color', 'rgb(51, 51, 51)');
  await expect(page.locator('#next_epi_btn_bottom')).toHaveCSS('color', 'rgb(215, 196, 0)');
});

test('reading surface backgrounds are optional, preserve native actions, and keep hint fade separate', async () => {
  await page.goto(`${base}/viewer/1001?controls`);
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await page.evaluate(() => {
    for (const id of ['next_info_layer', 'back_info_layer']) {
      const hint = document.createElement('div');
      hint.id = id;
      hint.style.cssText =
        'display:none;opacity:.5;position:fixed;top:50%;background:rgba(100,100,100,.3)';
      hint.textContent = '합성 이동 안내';
      document.body.append(hint);
    }
  });
  const note = page.locator('#writer_comments_box');
  const next = page.locator('#next_epi_btn_bottom');
  const noteMarkup = await note.innerHTML();
  const ad = await page.locator('#test-banner').evaluate((el) => el.outerHTML);
  await openSettings();
  await settingsSection(page, '외관');
  const select = page.getByRole('combobox', { name: '뷰어 보조 영역 색상', exact: true });
  await expect(select).toHaveText('테마에 맞춤');
  await select.click();
  await page.getByRole('option', { name: '기존대로', exact: true }).click();
  await expect(note).toHaveCSS('background-color', 'rgba(155, 155, 155, 0.1)');
  const originalPaint = await note.evaluate((el) => getComputedStyle(el).backgroundColor);
  await select.click();
  await page.getByRole('option', { name: '불투명', exact: true }).click();
  for (const surface of [note, next, page.locator('#next_info_layer')]) {
    await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
  await select.click();
  await page.getByRole('option', { name: '반투명', exact: true }).click();
  for (const surface of [note, next, page.locator('#next_info_layer')]) {
    await expect(surface).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.8)');
  }
  await expect(page.locator('#next_info_layer')).toHaveCSS('opacity', '0.5');
  await expect(page.locator('#next_info_layer')).toBeHidden();
  expect(await note.innerHTML()).toBe(noteMarkup);
  expect(await page.locator('#test-banner').evaluate((el) => el.outerHTML)).toBe(ad);
  await select.click();
  await page.getByRole('option', { name: '기존대로', exact: true }).click();
  await expect(note).toHaveCSS('background-color', originalPaint);
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await clickProgressEnd();
  await next.click();
  await expect(page.locator('body')).toHaveAttribute('data-episode-next', 'yes');
});

test('terminal recommendations reserve reading space and wheel-up does not bounce back to the end', async () => {
  await page.goto(`${base}/viewer/1001?terminal`);
  await expect(page.locator('#novel_drawing')).toHaveAttribute('data-unp-reader', 'scroll');
  await clickProgressEnd();
  const service = page.locator('#fixed-curation');
  await expect(service).toBeVisible();
  const fits = () =>
    page.evaluate(() => {
      const end = document.getElementById('episode-end')!.getBoundingClientRect();
      const service = document.getElementById('fixed-curation')!.getBoundingClientRect();
      return end.bottom <= service.top;
    });
  await expect.poll(fits).toBe(true);
  const end = await page.locator('#novel_box').evaluate((el) => el.scrollTop);
  await page.mouse.move(700, 700);
  await page.mouse.wheel(0, -600);
  await expect
    .poll(() => page.locator('#novel_box').evaluate((el) => el.scrollTop))
    .toBeLessThan(end - 300);
  await expect(service).toBeHidden();
  const samples = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const sample = () => {
          values.push(document.getElementById('novel_box')!.scrollTop);
          if (values.length < 30) requestAnimationFrame(sample);
          else resolve(values);
        };
        requestAnimationFrame(sample);
      })
  );
  expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(2);
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await page.getByRole('slider', { name: '본문 페이지', exact: true }).press('End');
  await expect(service).toBeVisible();
  await expect.poll(fits).toBe(true);
  await expect(page.getByRole('button', { name: '다음 쪽', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '이전 쪽', exact: true }).click();
  await expect(service).toBeHidden();
  await expect(service).toHaveCSS('position', 'fixed');
  await expect(service).toHaveCSS('bottom', '60px');
  await expect(page.locator('#test-banner')).toBeVisible();
});

for (const mode of ['scroll', 'page'] as const) {
  test(`automatic ${mode} resume starts completed episodes at the beginning and preserves manual bookmarks`, async () => {
    if (mode === 'page') {
      await updateReader({ readingMode: 'page' });
      await expect(page.locator('[data-unp-reader="page"]')).toBeVisible();
    }
    const navigation = page.locator('#unp-navigation-host');
    await expect(navigation).toBeVisible();
    await seekFraction(0.2);
    await navigation.getByRole('button', { name: '현재 위치 북마크 저장', exact: true }).click();
    await expect.poll(() => storedAnchor('bookmark')).toBeTruthy();
    const manual = (await storedAnchor('bookmark'))!;
    await seekFraction(0.85);
    await expect
      .poll(async () => {
        const position = await storedAnchor('position');
        return (
          !!position?.blockKey && position.blockKey !== manual.blockKey && anchorVisible(position)
        );
      })
      .toBe(true);
    const before = (await storedAnchor('position'))!;
    await page.reload();
    await expect.poll(() => anchorVisible(before)).toBe(true);
    await seekFraction(0.95);
    const completed = { episodeId: '1001', completed: true };
    await expect.poll(() => storedAnchor('position')).toEqual(completed);
    await seekFraction(0.4);
    await page.reload();
    await expect(navigation).toBeVisible();
    const viewport = page.locator(mode === 'page' ? '#novel_drawing_page_c' : '#novel_box');
    await expect
      .poll(() =>
        viewport.evaluate(
          (node, type) => (type === 'page' ? node.scrollLeft : node.scrollTop),
          mode
        )
      )
      .toBe(0);
    // A late native restoration cannot return a completed episode to its previous end.
    await viewport.evaluate((node, type) => {
      if (type === 'page') node.scrollLeft = 500;
      else node.scrollTop = 500;
    }, mode);
    await expect
      .poll(() =>
        viewport.evaluate(
          (node, type) => (type === 'page' ? node.scrollLeft : node.scrollTop),
          mode
        )
      )
      .toBe(0);
    await navigation.getByRole('button', { name: '북마크로 이동', exact: true }).click();
    await expect.poll(() => anchorVisible(manual)).toBe(true);
    expect(await storedAnchor('bookmark')).toEqual(manual);
    expect(await storedAnchor('position')).toEqual(completed);
    // Manual navigation and subsequent gestures release the initial-start guard.
    await seekFraction(0.5);
    await expect
      .poll(() =>
        viewport.evaluate(
          (node, type) => (type === 'page' ? node.scrollLeft : node.scrollTop),
          mode
        )
      )
      .toBeGreaterThan(0);
    expect(await storedAnchor('position')).toEqual(completed);
  });
}

test('a service-only final page finishes automatic recording without a text anchor', async () => {
  await updateReader({ readingMode: 'page', spreadMode: 'single', pageEffect: 'none' });
  await expect(page.locator('[data-unp-reader="page"]')).toBeVisible();
  await expect(page.locator('#unp-navigation-host')).toBeVisible();
  await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
  await page.locator('#novel_drawing_page').evaluate((body) => {
    const footer = document.createElement('div');
    footer.dataset.service = '';
    footer.id = 'completion-service-tail';
    footer.style.breakBefore = 'column';
    footer.textContent = '합성 서비스 안내만 있는 마지막 쪽';
    body.append(footer);
  });
  const end = page.getByRole('slider', { name: '본문 페이지', exact: true });
  await end.press('End');
  await expect(page.locator('#completion-service-tail')).toBeInViewport();
  expect(
    await page.locator('#novel_drawing_page').evaluate((body) => {
      const v = body.parentElement!.getBoundingClientRect();
      return [...body.querySelectorAll('.line')].some((line) =>
        [...line.getClientRects()].some((r) => r.right > v.left + 1 && r.left < v.right - 1)
      );
    })
  ).toBe(false);
  await expect.poll(() => storedAnchor('position')).toEqual({ episodeId: '1001', completed: true });
});

test('latest automatic position resumes on re-entry and back while manual bookmarks remain separate', async () => {
  await seekFraction(0.2);
  await page
    .locator('#unp-navigation-host')
    .getByRole('button', { name: '현재 위치 북마크 저장', exact: true })
    .click();
  await expect.poll(() => storedAnchor('bookmark')).toBeTruthy();
  const saved = (await storedAnchor('bookmark'))!;
  await seekFraction(0.65);
  await expect
    .poll(async () => {
      const current = await storedAnchor('position');
      return !!current && current.blockKey !== saved.blockKey;
    })
    .toBe(true);
  const latest = (await storedAnchor('position'))!;
  await page.goto(`${base}/outside`);
  await page.goto(`${base}/viewer/1001`);
  await expect.poll(() => anchorVisible(latest)).toBe(true);
  await expect.poll(() => anchorVisible(saved)).toBe(false);
  await page.goto(`${base}/outside`);
  await page.goBack();
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await expect.poll(() => anchorVisible(latest)).toBe(true);
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await expect.poll(() => anchorVisible(latest)).toBe(true);
  await page
    .locator('#unp-navigation-host')
    .getByRole('button', { name: '북마크로 이동', exact: true })
    .click();
  await expect.poll(() => anchorVisible(saved)).toBe(true);
  expect(await storedAnchor('bookmark')).toEqual(saved);
});

test('a quick persisted return waits for the pending completion write before restoring', async () => {
  await expect(page.locator('#unp-navigation-host')).toBeVisible();
  await seekFraction(0.2);
  await expect.poll(() => storedAnchor('position')).toBeTruthy();
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(() => {
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    const state = globalThis as typeof globalThis & { completionWriteWaiting?: boolean };
    chrome.storage.local.set = async (items: Record<string, unknown>) => {
      if ((items['unp.position.v1.1001'] as { completed?: boolean } | undefined)?.completed) {
        state.completionWriteWaiting = true;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      return set(items);
    };
  });
  await seekFraction(0.95);
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          (globalThis as typeof globalThis & { completionWriteWaiting?: boolean })
            .completionWriteWaiting
      )
    )
    .toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    document.getElementById('novel_box')!.scrollTop = 0;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => storedAnchor('position')).toEqual({ episodeId: '1001', completed: true });
  await expect.poll(() => page.locator('#novel_box').evaluate((node) => node.scrollTop)).toBe(0);
});

for (const returnPath of ['history return', 'persisted page-show'] as const) {
  test(`middle-button autoscroll after ${returnPath} is not pulled back to the restored anchor`, async () => {
    await seekFraction(0.35);
    await expect.poll(() => storedAnchor('position')).toBeTruthy();
    let anchor = (await storedAnchor('position'))!;
    if (returnPath === 'history return') {
      await page.goto(`${base}/outside`);
      await page.goBack();
    } else {
      // Observe completion of pagehide's worker write before simulating a later
      // record from another document. Direct storage edits bypass that queue.
      await context
        .serviceWorkers()[0]!
        .evaluate(() => chrome.storage.local.remove('unp.position.v1.1001'));
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      );
      await expect.poll(() => storedAnchor('position')).toEqual(anchor);
      anchor = { ...anchor, blockKey: '85', textOffset: 0 };
      await context.serviceWorkers()[0]!.evaluate(async (anchor) => {
        await chrome.storage.local.set({ 'unp.position.v1.1001': anchor });
      }, anchor);
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      );
    }
    await expect.poll(() => anchorVisible(anchor)).toBe(true);
    const box = page.locator('#novel_box');
    const start = await box.evaluate((element) => element.scrollTop);
    const bounds = (await box.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 3;
    await page.mouse.click(x, y, { button: 'middle' });
    await page.mouse.move(x, y + 100);
    const samples = await box.evaluate(
      (element) =>
        new Promise<number[]>((resolve) => {
          const values: number[] = [];
          const frame = () => {
            values.push(element.scrollTop);
            if (values.length < 60) requestAnimationFrame(frame);
            else resolve(values);
          };
          requestAnimationFrame(frame);
        })
    );
    await page.keyboard.press('Escape');
    await test.info().attach('autoscroll-positions', {
      body: JSON.stringify({ start, samples }),
      contentType: 'application/json',
    });
    expect(samples.at(-1)!).toBeGreaterThan(start + 200);
    expect(samples.every((value, index) => index === 0 || value >= samples[index - 1]! - 2)).toBe(
      true
    );
  });
}

test('missing or damaged automatic records never fall back to manual or other-episode bookmarks', async () => {
  await page.goto(`${base}/outside`);
  const worker = context.serviceWorkers()[0]!;
  const bookmark = { episodeId: '1002', blockKey: '40', textOffset: 0, edge: 'text' };
  await worker.evaluate(async (bookmark) => {
    await chrome.storage.local.set({ 'unp.bookmark.v1.1002': bookmark });
    await chrome.storage.local.remove('unp.position.v1.1002');
  }, bookmark);
  for (const invalid of [
    null,
    { ...bookmark, episodeId: '1003' },
    { ...bookmark, textOffset: -1 },
  ]) {
    await worker.evaluate(async (value) => {
      if (value === null) await chrome.storage.local.remove('unp.position.v1.1002');
      else await chrome.storage.local.set({ 'unp.position.v1.1002': value });
    }, invalid);
    await page.goto(`${base}/viewer/1002`);
    await expect(page.locator('[data-unp-reader]')).toBeAttached();
    await expect.poll(() => page.locator('#novel_box').evaluate((el) => el.scrollTop)).toBe(0);
    await expect(
      page
        .locator('#unp-navigation-host')
        .getByRole('button', { name: '북마크로 이동', exact: true })
    ).toBeEnabled();
    expect(await storedAnchor('bookmark', '1002')).toEqual(bookmark);
    await page.goto(`${base}/outside`);
  }
});

test('persisted page-show reads a fresh automatic position without restoring its manual bookmark', async () => {
  await seekFraction(0.2);
  await page
    .locator('#unp-navigation-host')
    .getByRole('button', { name: '현재 위치 북마크 저장', exact: true })
    .click();
  await expect.poll(() => storedAnchor('bookmark')).toBeTruthy();
  const saved = (await storedAnchor('bookmark'))!;
  // This case isolates pageshow's fresh read from another document. Wait for
  // this document's automatic save before editing storage directly. Pagehide's
  // pending-write ordering has a separate delayed-storage test above.
  await expect.poll(() => storedAnchor('position')).toEqual(saved);
  const latest = { ...saved, blockKey: '40', textOffset: 0 };
  await context.serviceWorkers()[0]!.evaluate(async (latest) => {
    await chrome.storage.local.set({ 'unp.position.v1.1001': latest });
  }, latest);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  );
  await expect.poll(() => anchorVisible(latest)).toBe(true);
  await expect.poll(() => anchorVisible(saved)).toBe(false);
  expect(await storedAnchor('bookmark')).toEqual(saved);
});

test('owned page effect has an observable on-off difference and respects reduced motion', async () => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  const next = page.getByRole('button', { name: '다음 쪽', exact: true });
  await next.click();
  const active = () =>
    page
      .locator('[data-unp-page-effect], [data-unp-page-effect] *')
      .evaluateAll(
        (els) =>
          els.flatMap((el) => el.getAnimations()).filter((a) => a.playState === 'running').length
      );
  expect(await active()).toBeGreaterThan(0);
  expect(await page.locator('.curation-wrapper').evaluate((el) => el.getAnimations().length)).toBe(
    0
  );
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('combobox', { name: '페이지 효과', exact: true }).click();
  await page.getByRole('option', { name: '없음', exact: true }).click();
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await next.click();
  expect(await active()).toBe(0);
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('combobox', { name: '페이지 효과', exact: true }).click();
  await page.getByRole('option', { name: '페이드', exact: true }).click();
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await next.click();
  expect(await active()).toBe(0);
});

test('first visible novel frame uses extension typography and disabled startup remains native', async () => {
  await updateReader({ fontSize: 31, textColor: '#345b9c' });
  await page.addInitScript(() => {
    const state = window as unknown as {
      readerFrames: { size: string; color: string; owned: boolean }[];
    };
    state.readerFrames = [];
    let count = 0;
    function sample() {
      const line = document.querySelector<HTMLElement>('#novel_drawing>.line');
      if (line) {
        const s = getComputedStyle(line);
        if (s.visibility !== 'hidden' && s.display !== 'none')
          state.readerFrames.push({
            size: s.fontSize,
            color: s.color,
            owned: line.hasAttribute('data-unp-line'),
          });
      }
      if (count++ < 90) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.reload();
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '31px');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { readerFrames: unknown[] }).readerFrames.length)
    )
    .toBeGreaterThan(3);
  const frames = await page.evaluate(
    () =>
      (window as unknown as { readerFrames: { size: string; color: string; owned: boolean }[] })
        .readerFrames
  );
  expect(
    frames.every(
      (frame) => frame.owned && frame.size === '31px' && frame.color === 'rgb(52, 91, 156)'
    )
  ).toBe(true);
  await updateReader({ enabled: false });
  await page.reload();
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '18px');
  await expect(page.locator('#unp-first-layout')).toHaveCount(0);
});

test('recent colors persist across controls and pages, and weight options match the selected font', async () => {
  await updateReader({ fontFamily: 'system-ui', fontWeight: 900, forceBold: false });
  await openSettings();
  await settingsSection(page, '외관');
  const color = page.getByRole('group', { name: '글자 색상', exact: true });
  await color.locator('.dropdown-trigger').click();
  await color.getByRole('button', { name: '글자 색상 #FF0000', exact: true }).click();
  const hex = page.getByRole('textbox', { name: '글자 색상 HEX', exact: true });
  await hex.fill('#123456');
  await hex.press('Enter');
  await color.getByRole('button', { name: '최근 선택', exact: true }).click();
  await expect(color.locator('.palette button')).toHaveCount(2);
  await expect(color.locator('.palette button').first()).toHaveAttribute(
    'aria-label',
    '글자 색상 #123456'
  );
  await hex.press('Escape');
  await settingsSection(page, '텍스트');
  const weight = page.getByRole('combobox', { name: '글자 두께', exact: true });
  await weight.click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('option', { name: '강제로 굵게', exact: true })).toHaveCount(0);
  await weight.press('Escape');
  // Change through the UI: a direct storage write here can race the pending color
  // save, where the store intentionally keeps the user's unsaved local edits.
  const font = page.getByRole('button', { name: '글꼴 선택', exact: true });
  await font.click();
  await page.getByRole('button', { name: /^리디바탕/ }).click();
  const selectedFont = font.locator('strong');
  await expect(selectedFont).toHaveText('리디바탕');
  await expect(selectedFont).toHaveAttribute('aria-busy', 'false');
  await expect(weight).toHaveText('보통 / Regular (400)');
  await weight.click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('option', { name: '강제로 굵게', exact: true }).click();
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-weight', '700');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await settingsSection(options, '외관');
  const background = options.getByRole('group', { name: '배경 색상', exact: true });
  await background.locator('.dropdown-trigger').click();
  await background.getByRole('button', { name: '최근 선택', exact: true }).click();
  await expect(
    background.getByRole('button', { name: '배경 색상 #123456', exact: true })
  ).toBeVisible();
  await options.screenshot({ path: test.info().outputPath('recent-colors.png') });
});

test('management settings have one navigation and one document scroll with an inline preset gallery', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setViewportSize({ width: 1440, height: 1000 });
  await expect(options.getByRole('heading', { level: 1 })).toHaveText('홈');
  await settingsSection(options, '프리셋');
  await expect(options.getByRole('heading', { level: 1 })).toHaveText('프리셋');
  await options.screenshot({ path: test.info().outputPath('options-backup.png') });
  for (const size of [
    { width: 1440, height: 640 },
    { width: 390, height: 844 },
  ]) {
    await options.setViewportSize(size);
    await settingsSection(options, '텍스트');
    await expect(options.getByRole('navigation')).toHaveCount(1);
    const nested = await options
      .locator('.management-content, .panel.embedded, .panel-workspace, .panel-scroll')
      .evaluateAll(
        (els) =>
          els.filter((el) => {
            const s = getComputedStyle(el);
            return /auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2;
          }).length
      );
    expect(nested).toBe(0);
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await options.mouse.move(size.width / 2, size.height / 2);
    await options.mouse.wheel(0, 500);
    await expect.poll(() => options.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await options.locator('.panel-scroll').evaluate((el) => el.scrollTop)).toBe(0);
    await options.screenshot({
      path: test.info().outputPath(`options-text-${size.width}.png`),
    });
  }
  await openSettings();
  await settingsSection(page, '프리셋');
  await expect(
    page.getByRole('region', { name: '기본 제공 프리셋', exact: true }).locator('article')
  ).toHaveCount(10);
  await expect(page.locator('.preset-browser, .preset-pagination')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '현재 설정으로 만들기', exact: true })
  ).toBeVisible();
});

test('navigation endpoints reach odd and even final spreads after layout changes without clicking native services', async () => {
  await updateReader({ pageNavigationPlacement: 'reserved' });
  await openSettings();
  await setNumber('본문 너비', 540);
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveCSS('column-count', '2');
  await expect(page.locator('#page_navigation')).toBeHidden();
  const parity = new Set<number>();
  for (const fontSize of [18, 19, 20, 21, 22, 23, 24, 27]) {
    await updateReader({ fontSize, horizontalPadding: 30, verticalPadding: 35 });
    await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', `${fontSize}px`);
    await clickProgressEnd();
    await expect(page.getByRole('button', { name: '다음 쪽', exact: true })).toBeDisabled();
    const label = (await page.getByTestId('reader-page').textContent())!;
    const total = Number(label.split('/')[1]);
    const start = Math.floor((total - 1) / 2) * 2 + 1;
    parity.add(total % 2);
    expect(label).toBe(`${start === total ? total : `${start}~${total}`} / ${total}`);
    await expect(page.locator('#page_cnt')).toHaveText(
      `${Math.ceil(total / 2)}/${Math.ceil(total / 2)}`
    );
    // A split multicol paragraph has an offscreen union box; check its final glyph instead.
    expect(
      await page.locator('.line[data-line="149"]').evaluate((el) => {
        const node = el.lastChild as Text;
        const range = document.createRange();
        range.setStart(node, node.length - 2);
        range.setEnd(node, node.length - 1);
        const r = range.getBoundingClientRect();
        const v = document.getElementById('novel_drawing_page_c')!.getBoundingClientRect();
        return r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom <= v.bottom;
      })
    ).toBe(true);
    const layout = await page.evaluate(() => ({
      bodyBottom: document.getElementById('novel_drawing_page_c')!.getBoundingClientRect().bottom,
      navigationTop: document.getElementById('unp-navigation-host')!.getBoundingClientRect().top,
    }));
    expect(layout.bodyBottom).toBeLessThanOrEqual(layout.navigationTop);
    await page.locator('#unp-navigation-host input').press('Home');
  }
  expect([...parity].sort()).toEqual([0, 1]);
  await updateReader({ spreadMode: 'single' });
  await expect(page.locator('#novel_drawing_page')).toHaveCSS('column-count', '1');
  await clickProgressEnd();
  await expect(page.getByRole('button', { name: '다음 쪽', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#novel_drawing_page')).toHaveCSS('column-count', '1');
  // The fixture's floating ad covers part of the native navigation slot when narrow.
  // Keep that overlay intact and verify the keyboard endpoint independently.
  await page.getByRole('slider', { name: '본문 페이지', exact: true }).press('End');
  await expect(page.getByRole('button', { name: '다음 쪽', exact: true })).toBeDisabled();
  const total = (await page.getByTestId('reader-page').textContent())!.split('/')[1]!.trim();
  await expect(page.getByTestId('reader-page')).toHaveText(`${total} / ${total}`);
  await page.screenshot({ path: test.info().outputPath('after-narrow.png') });
  await expect(page.locator('body')).not.toHaveAttribute('data-recommend-clicks', /.+/);
  await expect(page.locator('body')).not.toHaveAttribute('data-episode-next', 'yes');
  await expect(page.locator('#test-banner')).toBeVisible();
});

test('scroll progress uses current scroll extent and navigation toggle restores the native controls on disable', async () => {
  const slider = page.getByRole('slider', { name: '본문 읽기 진행률', exact: true });
  await expect(slider).toBeVisible();
  for (const fontSize of [18, 30]) {
    await updateReader({ fontSize, maxWidth: 620, verticalPadding: 70 });
    await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', `${fontSize}px`);
    await clickProgressEnd();
    await expect(page.getByTestId('reader-page')).toHaveText('100%');
    expect(
      await page
        .locator('#novel_box')
        .evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))
    ).toBeLessThan(2);
    await slider.press('Home');
    await expect(page.getByTestId('reader-page')).toHaveText('0%');
  }
  await openSettings();
  await settingsSection(page, '독서 도구');
  await page.getByRole('switch', { name: '네비게이션, 북마크', exact: true }).click();
  await expect(page.locator('#unp-navigation-host')).toHaveCount(0);
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await expect(page.getByTestId('reader-page')).toBeVisible();
  await expect(page.locator('#unp-navigation-host input')).toHaveCount(0);
  await openSettings();
  await settingsSection(page, '독서 도구');
  await page.getByRole('switch', { name: '네비게이션, 북마크', exact: true }).click();
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await expect(page.getByRole('slider', { name: '본문 페이지', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('after-wide.png') });
  await openSettings();
  await settingsSection(page, '정보');
  await disableViewer();
  await expect(page.locator('#unp-navigation-host')).toHaveCount(0);
  await expect(page.locator('#page_navigation')).toBeVisible();
  await expect(page.locator('#bookmark_div')).toBeVisible();
});

test('content bookmarks survive typography, narrow layout, mode changes and reload', async () => {
  await openSettings();
  await setNumber('본문 너비', 540);
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  const slider = page.getByRole('slider', { name: '본문 페이지', exact: true });
  await slider.press('Home');
  await slider.press('ArrowRight');
  await slider.press('ArrowRight');
  await page
    .locator('#unp-navigation-host')
    .getByRole('button', { name: '현재 위치 북마크 저장', exact: true })
    .click();
  const worker = context.serviceWorkers()[0]!;
  const readBookmark = () =>
    worker.evaluate(
      async () => (await chrome.storage.local.get('unp.bookmark.v1.1001'))['unp.bookmark.v1.1001']
    );
  await expect.poll(readBookmark).toBeTruthy();
  const anchor = (await readBookmark()) as { blockKey: string; textOffset: number; edge: string };
  const bookmarkIsVisible = () =>
    page.evaluate((a) => {
      const block = document.querySelector(`.line[data-line="${a.blockKey}"]`)!;
      const body = block.closest('[data-unp-reader]')!;
      const viewport = document
        .getElementById(
          body.getAttribute('data-unp-reader') === 'page' ? 'novel_drawing_page_c' : 'novel_box'
        )!
        .getBoundingClientRect();
      const illustration = block.querySelector('img');
      if (a.edge === 'before' && illustration) {
        const r = illustration.getBoundingClientRect();
        return (
          r.right > viewport.left &&
          r.left < viewport.right &&
          r.bottom > viewport.top &&
          r.top < viewport.bottom
        );
      }
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let offset = a.textOffset;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (offset < node.length) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const r = range.getBoundingClientRect();
          return (
            r.right > viewport.left &&
            r.left < viewport.right &&
            r.bottom > viewport.top &&
            r.top < viewport.bottom
          );
        }
        offset -= node.length;
      }
      return false;
    }, anchor);
  await updateReader({ fontSize: 28, horizontalPadding: 40, verticalPadding: 45 });
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '28px');
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator('#novel_drawing_page')).toHaveCSS('column-count', '1');
  await slider.press('End');
  await page
    .locator('#unp-navigation-host')
    .getByRole('button', { name: '북마크로 이동', exact: true })
    .click();
  await expect.poll(bookmarkIsVisible).toBe(true);
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '스크롤 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing')).toHaveAttribute('data-unp-reader', 'scroll');
  await page.reload();
  await expect(
    page.locator('#unp-navigation-host').getByRole('button', { name: '북마크로 이동', exact: true })
  ).toBeEnabled();
  await page.getByRole('slider', { name: '본문 읽기 진행률', exact: true }).press('End');
  await page
    .locator('#unp-navigation-host')
    .getByRole('button', { name: '북마크로 이동', exact: true })
    .click();
  await expect.poll(bookmarkIsVisible).toBe(true);
  expect(await readBookmark()).toEqual(anchor);
  await page.getByRole('button', { name: '북마크 해제', exact: true }).click();
  await expect(
    page.locator('#unp-navigation-host').getByRole('button', { name: '북마크로 이동', exact: true })
  ).toBeDisabled();
  await expect.poll(readBookmark).toBeUndefined();
});

test('legacy native bookmarks remain available until explicitly cleared', async () => {
  await page.evaluate(() => {
    localStorage.setItem('bookmark_1001', '3');
  });
  await updateReader({ maxWidth: 540, readingMode: 'page' });
  await expect(page.locator('#novel_drawing_page')).toHaveCSS('column-count', '2');
  await page
    .locator('#unp-navigation-host')
    .getByRole('button', { name: '북마크로 이동', exact: true })
    .click();
  await expect(page.getByTestId('reader-page')).toHaveText(/^5~6 \/ /);
  expect(await page.evaluate(() => localStorage.getItem('bookmark_1001'))).toBe('3');
  await page
    .locator('#unp-navigation-host')
    .getByRole('button', { name: '현재 위치 북마크 저장', exact: true })
    .click();
  await expect(
    page.locator('#unp-navigation-host').getByRole('button', { name: '북마크로 이동', exact: true })
  ).toHaveAttribute('title', '저장한 본문 위치로 이동');
  expect(await page.evaluate(() => localStorage.getItem('bookmark_1001'))).toBe('3');
  await page.getByRole('button', { name: '북마크 해제', exact: true }).click();
  await expect(
    page.locator('#unp-navigation-host').getByRole('button', { name: '북마크로 이동', exact: true })
  ).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('bookmark_1001'))).toBeNull();
});

test('page mode contains native outer overflow without preventing page turns or scroll mode', async () => {
  await updateReader({ maxWidth: 540, pageEffect: 'slide', readingMode: 'page' });
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  // Match the native forced scrollbar and a small overflowing decoration at the
  // viewport edge, including the fractional layout seen with browser zoom.
  await page.addStyleTag({ content: '#novel_box{position:relative;overflow:scroll!important}' });
  await page.locator('#novel_box').evaluate((box) => {
    const decoration = document.createElement('span');
    decoration.style.cssText =
      'position:absolute;left:0;top:0;width:calc(100% + 2.4px);height:calc(100% + 2.4px);pointer-events:none';
    box.append(decoration);
  });
  for (const width of [1440, 999, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const box = page.locator('#novel_box');
    await expect(box).toHaveCSS('overflow-x', 'clip');
    await expect(box).toHaveCSS('overflow-y', 'clip');
    expect(
      await box.evaluate((el) => {
        el.scrollTo(20, 20);
        return [el.scrollLeft, el.scrollTop, el.getBoundingClientRect().width - el.clientWidth];
      })
    ).toEqual([0, 0, 0]);
    expect(await box.evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
    const pages = page.locator('#novel_drawing_page_c');
    const before = await pages.evaluate((el) => el.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => pages.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
    await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
    expect(await box.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([0, 0]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '스크롤 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing')).toHaveAttribute('data-unp-reader', 'scroll');
  await expect(page.locator('#novel_box')).toHaveCSS('overflow-y', 'auto');
  expect(
    await page.locator('#novel_box').evaluate((el) => {
      el.scrollTo(0, 200);
      return el.scrollTop;
    })
  ).toBe(200);
  await page.locator('#test-banner button').click();
  await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
});

test('translucent author note follows reader colors and dark shadow preview preserves note markup', async () => {
  const note = page.locator('#writer_comments_box');
  const markup = await note.innerHTML();
  await updateReader({
    textColor: '#e9e4f0',
    backgroundColor: '#18151e',
    textAreaBackgroundColor: '#18151e',
    darkMode: true,
    enhanceBoldTextStyle: 'shadow',
    readingSurfaces: 'translucent',
  });
  await expect(note).toHaveCSS('color', 'rgb(233, 228, 240)');
  await expect(note.locator('b')).toHaveCSS('color', 'rgb(233, 228, 240)');
  await expect(note).toHaveCSS('background-color', 'rgba(24, 21, 30, 0.8)');
  expect(await note.innerHTML()).toBe(markup);
  await page.evaluate(() => {
    const old = document.getElementById('writer_comments_box')!;
    const fresh = old.cloneNode(true) as HTMLElement;
    fresh.style.color = '#222222';
    old.replaceWith(fresh);
  });
  await expect(note).toHaveCSS('color', 'rgb(233, 228, 240)');
  await openSettings();
  const emphasis = page.getByRole('combobox', { name: '굵은 텍스트 강조', exact: true });
  await emphasis.click();
  const sample = page.getByRole('option', { name: '그림자 효과', exact: true }).locator('span');
  const shadow = await sample.evaluate((el) => getComputedStyle(el).textShadow);
  expect(shadow).toContain('4px');
  expect(shadow).not.toContain('rgb(0, 0, 0)');
  await expect(page.locator('.line[data-line="3"] b')).toHaveCSS(
    'text-shadow',
    /rgb\(233, 228, 240\).*4px/
  );
  await page.screenshot({ path: test.info().outputPath('dark-shadow.png') });
  await emphasis.press('Escape');
  await settingsSection(page, '정보');
  await disableViewer();
  await expect(note).toHaveCSS('color', 'rgb(34, 34, 34)');
  expect(await note.innerHTML()).toBe(markup);
});

test('emphasis options show their effects and spread controls belong only to page mode', async () => {
  await openSettings();
  const emphasis = page.getByRole('combobox', { name: '굵은 텍스트 강조', exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('.panel-scroll').evaluate((el) => el.scrollTo(0, 0));
    await emphasis.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await emphasis.press('Escape');
    await expect(page.getByTestId('settings-panel')).toBeVisible();
  }
  for (const [label, property, expected] of [
    ['그림자 효과', 'text-shadow', /.+/],
    ['배경 강조', 'background-color', 'rgb(234, 220, 255)'],
    ['위아래 테두리', 'border-top-width', '2px'],
  ] as const) {
    await emphasis.click();
    const item = page.getByRole('option', { name: label, exact: true });
    if (property === 'text-shadow')
      await expect(item.locator('span')).not.toHaveCSS(property, 'none');
    else await expect(item.locator('span')).toHaveCSS(property, expected);
    await item.click();
    const bold = page.locator('.line[data-line="3"] b');
    if (property === 'text-shadow') await expect(bold).not.toHaveCSS(property, 'none');
    else await expect(bold).toHaveCSS(property, expected);
  }
  await settingsSection(page, '레이아웃');
  await expect(page.getByRole('button', { name: '항상 한 쪽', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '항상 한 쪽', exact: true }).click();
  await page.getByRole('button', { name: '스크롤 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing')).toHaveAttribute('data-unp-reader', 'scroll');
  await openSettings();
  await settingsSection(page, '레이아웃');
  await expect(page.getByRole('button', { name: '항상 한 쪽', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await openSettings();
  await settingsSection(page, '레이아웃');
  await expect(page.getByRole('button', { name: '항상 한 쪽', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('management page exports files and clipboard, validates imports, and resets settings without deleting presets', async () => {
  await openSettings();
  await setNumber('글자 크기', 23);
  await createPreset(page, '보관할 설정');
  const worker = context.serviceWorkers()[0]!;
  const otherEpisode = { episodeId: '1002', blockKey: '12', textOffset: 4, edge: 'text' };
  await worker.evaluate(async (anchor) => {
    await chrome.storage.local.set({
      'unp.position.v1.1002': anchor,
      'unp.bookmark.v1.1002': anchor,
    });
  }, otherEpisode);
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.action?.default_popup).toBe('popup.html');
  expect(manifest.options_ui?.open_in_tab).toBe(true);
  const opening = context.waitForEvent('page');
  await worker.evaluate(() => chrome.runtime.openOptionsPage());
  const options = await opening;
  await expect(options.getByTestId('management-page')).toBeVisible();
  await expect(options.getByRole('heading', { level: 1 })).toHaveText('홈');
  await settingsSection(options, '설정 파일');
  const downloading = options.waitForEvent('download');
  await options.getByRole('button', { name: '파일로 저장', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('unofficial-novelpia-settings.json');
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(backup.settings.fontSize).toBe(23);
  expect(backup.presets[0].name).toBe('보관할 설정');
  expect(Object.keys(backup).sort()).toEqual([
    'exportedAt',
    'presets',
    'schemaVersion',
    'selectedId',
    'settings',
  ]);
  expect(JSON.stringify(backup)).not.toMatch(/unp\.position|unp\.bookmark|episodeId|blockKey/);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await options.bringToFront();
  await options.getByRole('button', { name: 'JSON 복사', exact: true }).click();
  await expect(options.getByRole('status')).toHaveText('JSON을 복사했습니다');
  expect(
    JSON.parse(await options.evaluate(() => navigator.clipboard.readText())).settings.fontSize
  ).toBe(23);
  const json = options.getByRole('textbox', { name: '설정 JSON', exact: true });
  await options.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      },
    })
  );
  await options.getByRole('button', { name: 'JSON 복사', exact: true }).click();
  await expect(options.getByRole('alert')).toContainText('자동 복사를 사용할 수 없습니다.');
  await expect(options.getByRole('textbox', { name: '내보내기 JSON', exact: true })).toHaveValue(
    /"fontSize": 23/
  );
  await options.getByRole('tab', { name: 'JSON 텍스트', exact: true }).click();
  await json.fill('{"settings":{"fontSize":99}}');
  await options.getByRole('button', { name: '내용 확인', exact: true }).click();
  await expect(
    options.getByRole('region', { name: '가져오기', exact: true }).getByRole('alert')
  ).toContainText('잘못된 설정');
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '23px');
  await options.getByRole('tab', { name: '파일', exact: true }).click();
  await options.locator('input[type="file"]').setInputFiles({
    name: 'restore.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...backup, settings: { ...backup.settings, fontSize: 31 } })
    ),
  });
  await expect(options.locator('.import-review')).toContainText('2개 (가져온 읽기 설정 1개 포함)');
  await options.getByRole('button', { name: '가져오기 및 적용', exact: true }).click();
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '31px');
  await options.getByRole('button', { name: '프리셋', exact: true }).click();
  await expect(
    options.getByRole('region', { name: '내 프리셋', exact: true }).locator('article')
  ).toHaveCount(3);
  await expect(options.getByRole('region', { name: '내 프리셋', exact: true })).toContainText(
    '보관할 설정 (2)'
  );
  await settingsSection(options, '기타');
  await options.getByRole('button', { name: '설정 초기화', exact: true }).click();
  await options.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '31px');
  await options.getByRole('button', { name: '설정 초기화', exact: true }).click();
  await options.getByRole('button', { name: '기본값으로 초기화', exact: true }).click();
  await expect(options.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '18px');
  expect(await storedAnchor('position', '1002')).toEqual(otherEpisode);
  expect(await storedAnchor('bookmark', '1002')).toEqual(otherEpisode);
  await options.getByRole('button', { name: '프리셋', exact: true }).click();
  await expect(
    options.getByRole('region', { name: '내 프리셋', exact: true }).locator('article')
  ).toHaveCount(3);
  await options.setViewportSize({ width: 390, height: 844 });
  for (const label of [
    '홈',
    '프리셋',
    '텍스트',
    '레이아웃',
    '외관',
    '실험실',
    '설정 파일',
    '기타',
    '정보',
  ]) {
    await options.getByRole('button', { name: label, exact: true }).click();
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  }
});
test('preset drafts keep live reading unchanged until saved and explicitly applied', async () => {
  await openSettings();
  await setNumber('글자 크기', 23);
  await createPreset(page, '내 스타일', true);
  await presetCard(page, '내 스타일')
    .getByRole('button', { name: '내 스타일 복제', exact: true })
    .click();
  const editor = presetEditor(page);
  await editor.getByRole('textbox', { name: '이름', exact: true }).fill('다른 스타일');
  await editor.getByRole('spinbutton', { name: '글자 크기', exact: true }).fill('29');
  await editor.getByRole('spinbutton', { name: '글자 크기', exact: true }).press('Enter');
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('typography-preview')).toHaveCSS('font-size', '29px');
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '23px');
  const worker = context.serviceWorkers()[0]!;
  const selected = () =>
    worker.evaluate(
      async () =>
        (await chrome.storage.sync.get('unp.presetIndex.v1'))['unp.presetIndex.v1'] as {
          selectedId: string | null;
        }
    );
  const before = await selected();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect((await selected()).selectedId).toBe(before.selectedId);
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '23px');
  await presetCard(page, '다른 스타일')
    .getByRole('button', { name: '다른 스타일 적용', exact: true })
    .click();
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '29px');
  await presetCard(page, '내 스타일')
    .getByRole('button', { name: '내 스타일 편집', exact: true })
    .click();
  await editor.getByRole('textbox', { name: '이름', exact: true }).fill('이름 변경');
  await editor.getByRole('spinbutton', { name: '글자 크기', exact: true }).fill('25');
  await editor.getByRole('spinbutton', { name: '글자 크기', exact: true }).press('Tab');
  await editor.getByRole('tab', { name: '레이아웃', exact: true }).click();
  await editor.getByRole('spinbutton', { name: '좌우 여백', exact: true }).fill('44');
  await editor.getByRole('spinbutton', { name: '좌우 여백', exact: true }).press('Tab');
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '29px');
  await page.getByRole('button', { name: '저장하고 적용', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '25px');
  await expect(page.locator('#novel_drawing')).toHaveCSS('padding-left', '44px');
  await expect(presetCard(page, '이름 변경')).toContainText('현재 사용 중');
  await presetCard(page, '다른 스타일')
    .getByRole('button', { name: '다른 스타일 편집', exact: true })
    .click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await page
    .getByRole('dialog', { name: '프리셋 삭제', exact: true })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: '내 프리셋', exact: true }).locator('article')
  ).toHaveCount(1);
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '25px');
});

test('preset draft cancellation and external changes never silently overwrite either version', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await createPreset(options, '충돌 확인');
  await presetCard(options, '충돌 확인')
    .getByRole('button', { name: '충돌 확인 편집', exact: true })
    .click();
  const editor = presetEditor(options);
  await editor.getByRole('textbox', { name: '이름', exact: true }).fill('내가 편집한 이름');
  await settingsSection(options, '텍스트');
  const discard = options.getByRole('dialog', { name: '편집 내용 버리기', exact: true });
  await expect(discard).toHaveCount(0);
  await expect(editor).toBeHidden();
  await expect(options.getByRole('group', { name: '프리셋 편집 작업' })).toBeHidden();
  await settingsSection(options, '프리셋');
  await expect(editor.getByRole('textbox', { name: '이름', exact: true })).toHaveValue(
    '내가 편집한 이름'
  );
  await options.getByRole('button', { name: '취소', exact: true }).click();
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: '계속 편집', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: '이름', exact: true })).toHaveValue(
    '내가 편집한 이름'
  );
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(async () => {
    const index = (await chrome.storage.sync.get('unp.presetIndex.v1'))['unp.presetIndex.v1'] as {
      ids: string[];
    };
    const key = `unp.preset.v1.${index.ids[0]}`;
    const original = (await chrome.storage.sync.get(key))[key] as {
      name: string;
      settings: Record<string, unknown>;
    };
    await chrome.storage.sync.set({
      [key]: {
        ...original,
        name: '다른 화면의 이름',
        settings: { ...original.settings, fontSize: 27 },
      },
    });
  });
  await expect(editor.getByRole('alert')).toContainText('다른 화면에서 이 프리셋을 수정했습니다.');
  await expect(options.getByRole('button', { name: '저장', exact: true })).toBeDisabled();
  await expect(editor.getByRole('textbox', { name: '이름', exact: true })).toHaveValue(
    '내가 편집한 이름'
  );
  await editor.getByRole('button', { name: '새 프리셋으로 저장', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(presetCard(options, '다른 화면의 이름')).toContainText('27px');
  await expect(presetCard(options, '내가 편집한 이름')).toBeVisible();
  await presetCard(options, '내가 편집한 이름')
    .getByRole('button', { name: '내가 편집한 이름 편집', exact: true })
    .click();
  await editor.getByRole('textbox', { name: '이름', exact: true }).fill('버릴 내용');
  await options.getByRole('button', { name: '취소', exact: true }).click();
  await discard.getByRole('button', { name: '버리고 이동', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(presetCard(options, '내가 편집한 이름')).toBeVisible();
  await expect(presetCard(options, '버릴 내용')).toHaveCount(0);
});

test('failed preset storage retains the draft and does not apply or claim success', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await settingsSection(options, '프리셋');
  await options.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
  const editor = presetEditor(options);
  await editor.getByRole('textbox', { name: '이름', exact: true }).fill('저장 재시도');
  await editor.getByRole('spinbutton', { name: '글자 크기', exact: true }).fill('30');
  await editor.getByRole('spinbutton', { name: '글자 크기', exact: true }).press('Tab');
  await options.evaluate(() => {
    const original = chrome.storage.sync.set;
    (window as unknown as { restorePresetStorage: () => void }).restorePresetStorage = () => {
      chrome.storage.sync.set = original;
    };
    chrome.storage.sync.set = async () => {
      throw new Error('test storage unavailable');
    };
  });
  await options.getByRole('button', { name: '저장하고 적용', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('test storage unavailable');
  await expect(editor.getByRole('textbox', { name: '이름', exact: true })).toHaveValue(
    '저장 재시도'
  );
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '18px');
  await expect(
    options.getByRole('status').filter({ hasText: '저장하고 적용했습니다' })
  ).toHaveCount(0);
  await options.evaluate(() =>
    (window as unknown as { restorePresetStorage: () => void }).restorePresetStorage()
  );
  await options.getByRole('button', { name: '저장하고 적용', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '30px');
  await expect(presetCard(options, '저장 재시도')).toBeVisible();
});

test('themebox label help opens on hover and keyboard without clipping or closing the panel', async () => {
  await openSettings();
  const panel = page.getByTestId('settings-panel');
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText('테마박스');
  await expect(panel.locator('.brand-name')).toHaveText('Unofficial Novelpia Patch');
  const label = panel.locator('.label-help').filter({ hasText: /^글자 크기$/ });
  const tip = page.getByRole('tooltip');
  await label.hover();
  await expect(tip).toContainText('줄바꿈과 페이지 수');
  await tip.hover();
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(panel).toBeVisible();
  await label.focus();
  await expect(tip).toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: '글자 크기', exact: true })
  ).toHaveAccessibleDescription(/줄바꿈과 페이지 수/);
  await page.keyboard.press('Escape');
  await expect(label).toBeFocused();
  await expect(tip).toHaveCount(0);
  await settingsSection(page, '독서 도구');
  const bookmark = panel.locator('.label-help').filter({ hasText: /^네비게이션, 북마크$/ });
  const line = await bookmark.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].length;
  });
  expect(line).toBe(1);
  await bookmark.hover();
  await expect(tip).toContainText('페이지 탐색과 북마크');
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.locator('.brand-name')).toBeVisible();
  await bookmark.focus();
  await expect(tip).toBeVisible();
  expect(
    await tip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    })
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await settingsSection(page, '외관');
  const surfaces = panel.locator('.label-help').filter({ hasText: /^뷰어 보조 영역 색상$/ });
  for (const width of [390, 1440]) {
    await panel.getByRole('button', { name: '외관 설정으로 이동', exact: true }).focus();
    await page.setViewportSize({ width, height: 844 });
    await surfaces.scrollIntoViewIfNeeded();
    await surfaces.focus();
    await expect(tip).toContainText('커버보기');
    expect(await tip.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(
      true
    );
    await page.screenshot({
      path: test.info().outputPath(`reading-surfaces-tooltip-${width}.png`),
    });
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await expect(panel).toBeHidden();
});
test('owned select, dropdown, RGB picker and numeric controls preserve keyboard and settings behavior', async () => {
  await updateReader({ fontFamily: 'system-ui' });
  await openSettings();
  const panel = page.getByTestId('settings-panel');
  await expect(panel.locator('select, input[type="color"], details')).toHaveCount(0);
  const weight = page.getByRole('combobox', { name: '글자 두께', exact: true });
  await weight.focus();
  await page.keyboard.press('ArrowDown');
  await expect(weight).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('option', { name: '가늘게 (100)', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('option', { name: '보통 / Regular (400)', exact: true }).locator('span')
  ).toHaveCSS('font-weight', '400');
  await expect(
    page.getByRole('option', { name: '굵게 / Bold (700)', exact: true }).locator('span')
  ).toHaveCSS('font-weight', '700');
  await page.keyboard.press('ArrowDown');
  await expect(weight).toHaveAttribute('data-value', '400');
  await page.keyboard.press('Escape');
  await expect(weight).toHaveAttribute('aria-expanded', 'false');
  await expect(weight).toBeFocused();
  await expect(panel).toBeVisible();
  await weight.press('ArrowDown');
  await weight.press('End');
  await weight.press('Enter');
  await expect(weight).toHaveText('굵게 / Bold (700)');
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-weight', '700');
  await weight.press('ArrowDown');
  await weight.press('Home');
  await weight.press('Tab');
  await expect(weight).toHaveAttribute('data-value', '400');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await setNumber('글자 크기', 50);
  await expect(page.getByRole('button', { name: '글자 크기 늘리기', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '글자 크기 줄이기', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '글자 크기', exact: true })).toHaveValue('49');
  await setNumber('자간', 0.8);
  await page.getByRole('button', { name: '자간 늘리기', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '자간', exact: true })).toHaveValue('0.9');
  await settingsSection(page, '외관');
  const color = panel.getByRole('group', { name: '글자 색상', exact: true });
  const colorTrigger = color.locator('.dropdown-trigger');
  await colorTrigger.click();
  const hex = page.getByRole('textbox', { name: '글자 색상 HEX', exact: true });
  await hex.fill('#336699');
  await hex.press('Enter');
  const red = page.getByRole('slider', { name: '글자 색상 빨강', exact: true });
  await expect(red).toHaveValue('51');
  await red.focus();
  await red.press('ArrowRight');
  await expect(hex).toHaveValue('#346699');
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('color', 'rgb(52, 102, 153)');
  await red.press('Escape');
  await expect(colorTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(colorTrigger).toBeFocused();
  await settingsSection(page, '텍스트');
  const presets = weight;
  const worker = context.serviceWorkers()[0]!;
  for (const size of [
    { width: 390, height: 844, zoom: 1 },
    { width: 1440, height: 900, zoom: 2 },
  ]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await worker.evaluate(async (zoom) => {
      const tab = (await chrome.tabs.query({})).at(-1)!;
      await chrome.tabs.setZoom(tab.id!, zoom);
    }, size.zoom);
    await presets.click();
    const menu = page.getByRole('listbox');
    expect(
      await menu.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      })
    ).toBe(true);
    await presets.press('End');
    await expect(page.getByRole('option').last()).toBeInViewport();
    await panel.getByRole('heading', { name: '텍스트', exact: true }).click();
    await expect(menu).toHaveCount(0);
  }
  await expect(panel).toBeVisible();
});
test('settings shortcuts, readable themes and value controls stay usable when narrow or zoomed', async () => {
  await updateReader({ fontFamily: 'system-ui' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSettings();
  const panel = page.getByTestId('settings-panel');
  const shortcut = (label: string) =>
    page.getByRole('button', { name: `${label} 설정으로 이동`, exact: true });
  const textHeading = panel.locator('[data-section="text"] h2');
  await shortcut('텍스트').focus();
  await page.keyboard.press('Enter');
  await expect(textHeading).toBeFocused();
  await expect(shortcut('텍스트')).toHaveAttribute('aria-current', 'location');
  await expect(panel.locator('.panel-header')).toBeInViewport();
  await page.getByRole('button', { name: '글자 크기 24px', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '글자 크기', exact: true })).toHaveValue('24');
  await expect(page.getByRole('button', { name: '글자 크기 24px', exact: true })).toHaveText('24');
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '24px');
  await shortcut('텍스트').click();
  await page.locator('.font-dropdown .dropdown-trigger').click();
  await expect(panel.locator('.font-option').first()).toContainText(
    '가나다라마바사 아자차카타파하'
  );
  await expect(panel.locator('.font-option').first()).toContainText('Abc 0123, 漢字');
  await expect(panel.locator('.font-option').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.font-dropdown .dropdown-trigger').click();

  for (const dark of [false, true]) {
    if (dark) {
      await settingsSection(page, '외관');
      await settingsSection(page, '외관');
      await page.getByRole('switch', { name: '다크 모드', exact: true }).click();
    }
    await shortcut('레이아웃').click();
    const contrast = await panel.evaluate((root) => {
      const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
      const luminance = (color: number[]) =>
        color
          .slice(0, 3)
          .map((v) => {
            const n = v / 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      return [
        ...root.querySelectorAll(
          'h1,h2,.label,.section-description,.segments button,.quick button,.panel-nav button,.hint'
        ),
      ]
        .filter((el) => el.getClientRects().length)
        .map((el) => {
          let parent: Element | null = el;
          let background = [255, 255, 255];
          while (parent) {
            const color = rgb(getComputedStyle(parent).backgroundColor);
            if (color.length === 3 || color[3] === 1) {
              background = color;
              break;
            }
            parent = parent.parentElement;
          }
          const a = luminance(rgb(getComputedStyle(el).color)),
            b = luminance(background);
          return { text: el.textContent, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        });
    });
    expect(contrast.length).toBeGreaterThan(20);
    expect(contrast.filter(({ ratio }) => ratio < 4.5)).toEqual([]);
  }
  const worker = context.serviceWorkers()[0]!;
  for (const scenario of [
    { width: 390, height: 844, zoom: 1 },
    { width: 1440, height: 900, zoom: 2 },
  ]) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await worker.evaluate(async (zoom) => {
      const tab = (await chrome.tabs.query({})).at(-1)!;
      await chrome.tabs.setZoom(tab.id!, zoom);
    }, scenario.zoom);
    for (const label of ['텍스트', '외관', '실험실', '프리셋']) {
      await shortcut(label).click();
      await expect(shortcut(label)).toHaveAttribute('aria-current', 'location');
      await expect(shortcut(label)).toBeInViewport();
    }
    await shortcut('텍스트').click();
    await panel.locator('.font-dropdown .dropdown-trigger').scrollIntoViewIfNeeded();
    await expect(panel.locator('.font-dropdown .dropdown-trigger')).toBeInViewport({ ratio: 1 });
    expect(
      await panel.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1
        );
      })
    ).toBe(true);
    await shortcut('외관').click();
    const colors = panel.locator('[data-section="appearance"] .dropdown').first();
    await colors.locator('.dropdown-trigger').click();
    const swatch = colors.locator('.palette button').first();
    await swatch.click();
    await expect(swatch).toHaveAttribute('aria-pressed', 'true');
    await expect(colors.locator('input[type="text"], input:not([type])')).toHaveValue('#FF0000');
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await colors.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await colors.locator('.dropdown-trigger').click();
    await shortcut('프리셋').click();
    await settingsSection(page, '프리셋');
    await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
    await expect(
      presetEditor(page).getByRole('textbox', { name: '이름', exact: true })
    ).toBeInViewport();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(presetEditor(page)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '현재 설정으로 만들기', exact: true })
    ).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test('font picker overlays settings without shifting rows and emphasis immediately follows weight', async () => {
  await openSettings();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await settingsSection(options, '텍스트');
  for (const target of [page, options]) {
    for (const width of [1440, 390]) {
      await target.setViewportSize({ width, height: 900 });
      const trigger = target.getByRole('button', { name: '글꼴 선택', exact: true });
      await trigger.scrollIntoViewIfNeeded();
      const weight = target.getByRole('group', { name: '글자 두께', exact: true });
      const before = await weight.boundingBox();
      const height = await target
        .locator('[data-section="text"]')
        .evaluate((el) => el.scrollHeight);
      await trigger.press('Enter');
      const menu = target.getByRole('dialog', { name: '글꼴 선택 목록', exact: true });
      await expect(menu).toBeVisible();
      expect(await weight.boundingBox()).toEqual(before);
      expect(await target.locator('[data-section="text"]').evaluate((el) => el.scrollHeight)).toBe(
        height
      );
      expect(
        await menu.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            el.matches(':popover-open') &&
            getComputedStyle(el).position === 'fixed' &&
            r.left >= 0 &&
            r.right <= innerWidth &&
            r.top >= 0 &&
            r.bottom <= innerHeight
          );
        })
      ).toBe(true);
      await menu.locator('.font-list').evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(menu.locator('.font-option').last()).toBeInViewport();
      await target.screenshot({
        path: test
          .info()
          .outputPath(`font-overlay-${target === page ? 'themebox' : 'options'}-${width}.png`),
      });
      await menu.locator('.font-option').last().focus();
      await target.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await menu.locator('.tabs button').first().click();
      await menu.locator('.font-option').first().click();
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(
        await weight.evaluate((el) => {
          const section = el.closest('[data-section="text"]')!;
          const rows = [...section.querySelectorAll('[role="group"]')];
          return rows[rows.indexOf(el) + 1]?.getAttribute('aria-label');
        })
      ).toBe('굵은 텍스트 강조');
      await trigger.click();
      await trigger.click();
      await expect(menu).toBeHidden();
      await trigger.click();
      // The upward popup can cover the section heading on a narrow viewport.
      await target.mouse.click(2, 2);
      await expect(menu).toBeHidden();
      await trigger.click();
      await target.setViewportSize({ width: width - 10, height: 900 });
      await expect(menu).toBeHidden();
    }
  }
});
test('ten preset cards show real samples and applying a card updates other reading views', async () => {
  await openSettings();
  const preview = page.locator('[data-section="text"]').getByTestId('typography-preview');
  await setNumber('글자 크기', 24);
  await setNumber('줄 간격', 180);
  await setNumber('자간', 1.4);
  await expect(preview).toHaveCSS('font-size', '24px');
  await expect(preview).toHaveCSS('line-height', '43.2px');
  await expect(preview).toHaveCSS('letter-spacing', '1.4px');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await settingsSection(options, '텍스트');
  const optionsPreview = options.locator('[data-section="text"]').getByTestId('typography-preview');
  try {
    await expect(optionsPreview).toHaveCSS('font-size', '24px');
  } catch (error) {
    await test.info().attach('settings-sync-state', {
      contentType: 'application/json',
      body: JSON.stringify({
        stored: await context
          .serviceWorkers()[0]!
          .evaluate(async () => (await chrome.storage.sync.get('unp.reader.v1'))['unp.reader.v1']),
        viewer: await preview.evaluate((el) => ({
          font: getComputedStyle(el).fontSize,
          visible: document.visibilityState,
        })),
        options: await optionsPreview.evaluate((el) => ({
          font: getComputedStyle(el).fontSize,
          visible: document.visibilityState,
        })),
      }),
    });
    throw error;
  }
  await settingsSection(page, '프리셋');
  const catalog = page.getByRole('region', { name: '기본 제공 프리셋', exact: true });
  await expect(catalog.locator('article')).toHaveCount(10);
  expect(await catalog.locator('article h4').allTextContents()).toEqual([
    '기본',
    '종이',
    '어두움',
    '큰 글씨',
    '좁은 본문',
    '넓은 본문',
    '밝은 돌빛',
    '옅은 녹색',
    '짙은 청회색',
    '차분한 보라',
  ]);
  await expect(catalog.getByTestId('typography-preview')).toHaveCount(10);
  await expect(page.locator('.preset-browser, .preset-pagination, .current-preset')).toHaveCount(0);
  const own = page.getByRole('region', { name: '내 프리셋', exact: true });
  expect((await own.boundingBox())!.y).toBeLessThan((await catalog.boundingBox())!.y);
  await expect(own).toContainText('지금 읽는 설정을 저장하거나');
  await expect(page.getByRole('searchbox', { name: '내 프리셋 검색', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const paper = presetCard(page, '종이');
  await paper.scrollIntoViewIfNeeded();
  await expect(paper.getByTestId('typography-preview')).toHaveCSS('font-size', '20px');
  await Promise.all([
    page.waitForEvent('load'),
    paper.getByRole('button', { name: '종이 적용', exact: true }).click(),
  ]);
  await expect(page.locator('[data-unp-reader="page"]')).toBeVisible();
  await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
  await openSettings();
  await settingsSection(page, '프리셋');
  await expect(paper).toContainText('현재 사용 중');
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '20px');
  await expect(optionsPreview).toHaveCSS('font-size', '20px');
  await settingsSection(page, '텍스트');
  await expect(preview).toHaveCSS('font-size', '20px');
  await expect
    .poll(() => fontLoaded(options, '마루 부리', 20), {
      timeout: 15000,
    })
    .toBe(true);
  await expect(page.getByText('미리보기 글꼴을 불러왔습니다.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '테마박스 닫기', exact: true }).click();
  await expect(page.getByTestId('settings-panel')).toBeHidden();
});
test('real MV3 worlds, scroll typography, emphasis, native options, cleanup', async () => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  expect(
    await page.evaluate(
      () => typeof (window as unknown as { novelpiaPatch?: unknown }).novelpiaPatch
    )
  ).toBe('undefined');
  expect(await page.evaluate(() => Object.hasOwn(window, 'this_page'))).toBe(false);
  await openSettings();
  await setNumber('글자 크기', 26);
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '26px');
  await expect(page.locator('.line[data-line="3"] b')).toHaveCSS('font-weight', '700');
  await expect(page.locator('.line[data-line="3"] i')).toHaveCSS('font-style', 'italic');
  await settingsSection(page, '외관');
  await page.getByRole('switch', { name: '삽화 표시', exact: true }).click();
  await expect(page.locator('.line img')).toBeHidden();
  await settingsSection(page, '외관');
  await page.getByRole('switch', { name: '삽화 표시', exact: true }).click();
  await expect(page.locator('.line img')).toBeVisible();
  await settingsSection(page, '외관');
  await page.getByRole('switch', { name: '다크 모드', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain('DARKMODE=1');
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '26px');
  await settingsSection(page, '외관');
  await page.getByRole('switch', { name: '다크 모드', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain('DARKMODE=0');
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await page.locator('#test-banner button').click();
  await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
  await openSettings();
  await settingsSection(page, '정보');
  await disableViewer();
  await expect(page.locator('[data-unp-line]')).toHaveCount(0);
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '18px');
  await expect(page.locator('#unp-panel-host')).toHaveCount(0);
  await expect(page.locator('#unp-native-enable')).toBeAttached();
  expect(errors).toEqual([]);
});
test('page layout reflows and native service counters agree across spreads', async () => {
  await openSettings();
  await setNumber('본문 너비', 540);
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await expect(page.locator('#novel_drawing_page')).toHaveCSS('column-count', '2');
  const before = await page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(before);
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '항상 한 쪽', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveCSS('column-count', '1');
  await setNumber('글자 크기', 28);
  await setNumber('좌우 여백', 60);
  await setNumber('상하 여백', 25);
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  const initial = await page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(initial);
  await expect(page.locator('.line[data-line="3"] b')).toHaveCSS('font-weight', '700');
  await expect(page.locator('#test-banner')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('page-mode.png') });
});

test('adjustable page gaps preserve native final-page counts and navigation can overlay the paper', async () => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await updateReader({
    readingMode: 'page',
    maxWidth: 540,
    horizontalPadding: 20,
    pageNavigationPlacement: 'reserved',
    pageEffect: 'none',
  });
  const paper = page.locator('#novel_drawing_page_c');
  const body = page.locator('#novel_drawing_page');
  await expect(body).toHaveCSS('column-count', '2');
  for (const gap of [0, 160, 400]) {
    await updateReader({ pageGap: gap });
    await expect(paper).toHaveCSS('width', `${1080 + gap}px`);
    await expect(body).toHaveCSS('column-gap', `${gap + 40}px`);
    await clickProgressEnd();
    await expect(page.getByRole('button', { name: '다음 쪽', exact: true })).toBeDisabled();
    await expect
      .poll(async () => {
        const label = (await page.getByTestId('reader-page').textContent())!;
        const total = Number(label.split('/')[1]);
        return page.evaluate(
          (expected) => {
            const native = document.getElementById('page_cnt')!.textContent!.split('/').map(Number);
            return native[0] === expected && native[1] === expected;
          },
          Math.ceil(total / 2)
        );
      })
      .toBe(true);
  }
  await page.getByRole('slider', { name: '본문 페이지', exact: true }).press('Home');
  const reserved = (await paper.boundingBox())!;
  const bar = (await page.locator('#unp-navigation-host').boundingBox())!;
  expect(reserved.y + reserved.height).toBeLessThanOrEqual(bar.y);
  await updateReader({ pageNavigationPlacement: 'overlay' });
  await expect
    .poll(async () => (await paper.boundingBox())!.height)
    .toBeGreaterThan(reserved.height);
  const overlay = (await paper.boundingBox())!;
  expect(overlay.y + overlay.height).toBeGreaterThan(bar.y + bar.height);
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(body).toHaveCSS('column-count', '1');
  await expect(body).toHaveCSS('column-gap', '60px');
  await expect(paper).toHaveCSS('width', '540px');
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(body).toHaveCSS('column-count', '2');
  await expect(body).toHaveCSS('column-gap', '440px');
  await updateReader({ pageNavigationPlacement: 'reserved' });
  await expect.poll(async () => (await paper.boundingBox())!.height).toBe(reserved.height);
});
for (const mode of ['scroll', 'page'] as const) {
  for (const width of [1440, 390]) {
    test(`reading height centers the ${mode} viewport and navigation really overlays at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await updateReader({ readingMode: mode });
      await expect(page.locator(`[data-unp-reader="${mode}"]`)).toBeVisible();
      const frame = page.locator(mode === 'page' ? '#novel_drawing_page_c' : '#novel_box');
      const nav = page.getByRole('navigation', { name: '본문 탐색과 북마크' });
      await expect(nav).toBeVisible();
      await updateReader({
        readerHeightPercent: 100,
        pageNavigationPlacement: 'reserved',
        pageEffect: 'none',
      });
      await expect
        .poll(async () => {
          const paper = (await frame.boundingBox())!,
            bar = (await nav.boundingBox())!;
          return bar.y - paper.y - paper.height;
        })
        .toBeGreaterThanOrEqual(7);
      const full = (await frame.boundingBox())!;
      const initialAnchor = await storedAnchor('position');
      await seekFraction(0.3);
      await expect
        .poll(async () => {
          const current = await storedAnchor('position');
          return (
            !!current &&
            JSON.stringify(current) !== JSON.stringify(initialAnchor) &&
            anchorVisible(current)
          );
        })
        .toBe(true);
      const anchor = (await storedAnchor('position'))!;
      await updateReader({ readerHeightPercent: 60 });
      await expect
        .poll(async () => Math.abs((await frame.boundingBox())!.height / full.height - 0.6))
        .toBeLessThan(0.005);
      const smaller = (await frame.boundingBox())!;
      expect(Math.abs(smaller.y + smaller.height / 2 - full.y - full.height / 2)).toBeLessThan(1);
      await expect.poll(() => anchorVisible(anchor)).toBe(true);
      await page.screenshot({ path: test.info().outputPath('height-reserved.png') });
      await updateReader({ pageNavigationPlacement: 'overlay' });
      await expect
        .poll(async () => {
          const paper = (await frame.boundingBox())!,
            bar = (await nav.boundingBox())!;
          return (
            bar.y >= paper.y &&
            bar.y + bar.height <= paper.y + paper.height &&
            bar.y < paper.y + paper.height - 16
          );
        })
        .toBe(true);
      const bar = (await nav.boundingBox())!;
      expect(
        await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, {
          x: bar.x + 15,
          y: bar.y + 15,
        })
      ).toBe('unp-navigation-host');
      await nav.getByRole('button', { name: '현재 위치 북마크 저장', exact: true }).click();
      await expect(nav.getByRole('button', { name: '북마크로 이동', exact: true })).toBeEnabled();
      await page.screenshot({ path: test.info().outputPath('height-overlay.png') });
      await updateReader({ readerHeightPercent: 100, pageNavigationPlacement: 'reserved' });
      await expect.poll(async () => (await frame.boundingBox())!.height).toBe(full.height);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  }
}

test('presets, backup preview, reload and extension options share storage', async () => {
  await openSettings();
  await setNumber('글자 크기', 23);
  await createPreset(page, '나의 독서');
  await page.reload();
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '23px');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: '텍스트', exact: true }).click();
  await expect(options.getByTestId('settings-panel')).toBeVisible();
  await settingsSection(options, '텍스트');
  await expect(options.getByRole('spinbutton', { name: '글자 크기', exact: true })).toHaveValue(
    '23'
  );
  await options.getByRole('button', { name: '설정 파일', exact: true }).click();
  await options.getByRole('tab', { name: 'JSON 텍스트', exact: true }).click();
  await options
    .getByRole('textbox', { name: '설정 JSON', exact: true })
    .fill('{"settings":{"fontSize":31}}');
  await options.getByRole('button', { name: '내용 확인', exact: true }).click();
  await expect(options.locator('.import-review')).toContainText('1개 (가져온 읽기 설정 1개 포함)');
  await options.getByRole('button', { name: '가져오기 및 적용', exact: true }).click();
  await expect(options.getByRole('status')).toContainText('설정과 프리셋을 가져왔습니다');
  await options.getByRole('button', { name: '텍스트', exact: true }).click();
  await settingsSection(options, '텍스트');
  await expect(options.getByRole('spinbutton', { name: '글자 크기', exact: true })).toHaveValue(
    '31'
  );
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '31px');
  await options.getByRole('button', { name: '프리셋', exact: true }).click();
  await options.getByRole('button', { name: '나의 독서 편집', exact: true }).click();
  await options.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(options.getByRole('dialog')).toContainText('현재 읽기 설정은 유지됩니다.');
  await options
    .getByRole('dialog', { name: '프리셋 삭제', exact: true })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await expect(options.getByRole('dialog')).toHaveCount(0);
  await expect(options.getByRole('region', { name: '내 프리셋', exact: true })).not.toContainText(
    '나의 독서'
  );
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '31px');
  await options.screenshot({
    path: test.info().outputPath('settings-panel.png'),
    fullPage: false,
  });
});

test('content replacement, settings focus, invalid geometry and cleanup are recoverable', async () => {
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await expect(page.getByTestId('reader-page')).toBeVisible();
  const old = await page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft);
  await openSettings();
  const input = page.getByRole('spinbutton', { name: '글자 크기', exact: true });
  await input.focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft)).toBe(old);
  const originalHeight = await page
    .locator('#novel_drawing_page')
    .evaluate((el) => el.getBoundingClientRect().height);
  await setNumber('상하 여백', 500);
  await expect(page.getByRole('alert')).toContainText('공간이 부족');
  expect(
    await page.locator('#novel_drawing_page').evaluate((el) => el.getBoundingClientRect().height)
  ).toBe(originalHeight);
  await setNumber('상하 여백', 20);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await page.evaluate(() => {
    const root = document.getElementById('novel_drawing_page')!;
    const replacement = root.cloneNode(true) as HTMLElement;
    replacement.removeAttribute('data-unp-reader');
    replacement
      .querySelectorAll('[data-unp-line]')
      .forEach((el) => el.removeAttribute('data-unp-line'));
    root.replaceWith(replacement);
  });
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await expect(page.locator('[data-unp-reader-style]')).toHaveCount(1);
  await expect(page.locator('#unp-panel-host')).toHaveCount(1);
  await expect(page.locator('#unp-navigation-host')).toHaveCount(1);
  await page.getByRole('button', { name: '다음 쪽', exact: true }).click();
  await expect(page.getByTestId('reader-page')).not.toHaveText(/^1 \/ /);
  await openSettings();
  await settingsSection(page, '정보');
  await disableViewer();
  await expect(page.locator('#unp-navigation-host')).toHaveCount(0);
  await expect(page.locator('[data-unp-reader-style]')).toHaveCount(0);
});

test('last spread, reduced motion and native auto-next boundary', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSettings();
  await setNumber('본문 너비', 540);
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await expect(page.getByTestId('reader-page')).toBeVisible();
  const slider = page.getByRole('slider', { name: '본문 페이지', exact: true });
  await slider.focus();
  await slider.press('End');
  await expect(page.getByRole('button', { name: '다음 쪽', exact: true })).toBeDisabled();
  await expect(page.locator('.curation-wrapper')).toBeVisible();
  await page.mouse.click(700, 300);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('body')).not.toHaveAttribute('data-episode-next', 'yes');
  await openSettings();
  await settingsSection(page, '독서 도구');
  await page.getByRole('switch', { name: '정주행', exact: true }).click();
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await page.mouse.click(700, 300);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('body')).toHaveAttribute('data-episode-next', 'yes');
  expect(
    await page.locator('#novel_drawing_page').evaluate((el) => el.getAnimations().length)
  ).toBe(0);
});

test('a late native initial-position callback does not undo the latest page intent', async () => {
  await openSettings();
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await expect(page.getByTestId('reader-page')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  const before = await page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft);
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => {
    const site = window as unknown as { page_goto: (n: number) => void };
    site.page_goto(1);
  });
  await expect
    .poll(() => page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft))
    .toBe(before);
  await expect(page.locator('#page_cnt')).toHaveText(/^2\//);
  await clickProgressEnd();
  const last = await page.getByTestId('reader-page').textContent();
  const labels = await page.evaluate(async () => {
    const output = document
      .getElementById('unp-navigation-host')!
      .shadowRoot!.querySelector('output')!;
    const labels = [output.textContent];
    const observer = new MutationObserver(() => labels.push(output.textContent));
    observer.observe(output, { childList: true, characterData: true, subtree: true });
    (window as unknown as { page_goto: (n: number) => void }).page_goto(1);
    await new Promise<void>((resolve) => {
      let frame = 0;
      const next = () => {
        if (++frame < 30) requestAnimationFrame(next);
        else resolve();
      };
      requestAnimationFrame(next);
    });
    observer.disconnect();
    return labels;
  });
  expect([...new Set(labels)]).toEqual([last]);
});

test('scroll anchor survives font changes, viewport changes and mode switch', async () => {
  await expect(page.locator('#unp-navigation-host')).toBeVisible();
  await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
  await page.locator('#novel_box').evaluate((el) => {
    el.scrollTop = 1800;
  });
  const worker = context.serviceWorkers()[0]!;
  await expect
    .poll(() =>
      worker.evaluate(
        async () => (await chrome.storage.local.get('unp.position.v1.1001'))['unp.position.v1.1001']
      )
    )
    .toBeTruthy();
  const anchor = (await worker.evaluate(
    async () => (await chrome.storage.local.get('unp.position.v1.1001'))['unp.position.v1.1001']
  )) as { blockKey: string; textOffset: number; edge: string };
  await openSettings();
  await setNumber('글자 크기', 28);
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect
    .poll(() =>
      page.evaluate((a) => {
        const block = document.querySelector(`.line[data-line="${a.blockKey}"]`);
        if (!block) return false;
        if (a.edge !== 'text') {
          const v = document.getElementById('novel_drawing_page_c')!.getBoundingClientRect();
          return [...block.getClientRects()].some(
            (r) => r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom
          );
        }
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let offset = a.textOffset;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (offset < node.length) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, Math.min(offset + 1, node.length));
            const r = range.getBoundingClientRect(),
              v = document.getElementById('novel_drawing_page_c')!.getBoundingClientRect();
            return r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom;
          }
          offset -= node.length;
        }
        return false;
      }, anchor)
    )
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath('1024-page.png') });
});

test('every text fragment fits exactly one logical page at representative viewport and zoom settings', async () => {
  test.setTimeout(90000);
  await openSettings();
  await setNumber('본문 너비', 540);
  await settingsSection(page, '레이아웃');
  await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await expect(page.getByTestId('reader-page')).toBeVisible();
  const worker = context.serviceWorkers()[0]!;
  for (const scenario of [
    { width: 1024, height: 768, zoom: 1 },
    { width: 1440, height: 900, zoom: 1.25 },
    { width: 1920, height: 1080, zoom: 0.8 },
    { width: 2560, height: 1440, zoom: 1.5 },
    { width: 1440, height: 900, zoom: 2 },
  ]) {
    await worker.evaluate(async (zoom) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.at(-1);
      await chrome.tabs.setZoom(tab!.id!, zoom);
    }, scenario.zoom);
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await expect
      .poll(() => page.locator('#novel_drawing_page_c').evaluate((el) => el.clientHeight))
      .toBeGreaterThan(0);
    // A fresh frame allows ResizeObserver and the engine's scheduled geometry to settle.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    const failures = await page.evaluate(() => {
      const body = document.getElementById('novel_drawing_page')!,
        viewport = document.getElementById('novel_drawing_page_c')!;
      const style = getComputedStyle(body),
        bodyRect = body.getBoundingClientRect();
      const width = parseFloat(style.columnWidth),
        gap = parseFloat(style.columnGap),
        height = body.clientHeight;
      const total = Number(
        document
          .querySelector('#unp-navigation-host')!
          .shadowRoot!.querySelector('output')!
          .textContent!.split('/')[1]
      );
      const failures: string[] = [];
      let maximum = 0;
      for (const block of body.querySelectorAll<HTMLElement>(
        '[data-unp-line]:not([data-unp-empty])'
      )) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width < 0.1 || rect.height < 0.1) continue;
            const x = rect.left - bodyRect.left,
              column = Math.floor((x + 0.5) / (width + gap));
            maximum = Math.max(maximum, column + 1);
            if (
              x - column * (width + gap) < -1 ||
              rect.right - bodyRect.left - column * (width + gap) > width + 1 ||
              rect.top < bodyRect.top - 1 ||
              rect.bottom > bodyRect.top + height + 1
            )
              failures.push(`clipped line ${block.dataset.line}`);
          }
        }
      }
      if (maximum > total) failures.push(`unreachable text ${maximum}/${total}`);
      if (viewport.scrollWidth < viewport.clientWidth) failures.push('invalid viewport');
      return [...new Set(failures)];
    });
    expect(failures, JSON.stringify(scenario)).toEqual([]);
  }
});

test('font failure is visible, CSS aliases load, and Escape returns keyboard focus', async () => {
  await context.route('https://fonts.googleapis.com/**', (route) => route.abort());
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(async () => {
    const raw = await chrome.storage.sync.get('unp.reader.v1');
    const value = raw['unp.reader.v1'] as { data: { fontFamily: string } };
    // Noto Sans KR is now the default and already loaded. Fail an unrequested family.
    value.data.fontFamily = 'Noto Serif KR';
    await chrome.storage.sync.set({ 'unp.reader.v1': value });
  });
  await openSettings();
  await expect(
    page.getByText('Error: 글꼴 파일을 불러오지 못했습니다.', { exact: true })
  ).toBeVisible();
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS('font-size', '18px');
  await context.unroute('https://fonts.googleapis.com/**');
  await worker.evaluate(async () => {
    const raw = await chrome.storage.sync.get('unp.reader.v1');
    const value = raw['unp.reader.v1'] as { data: { fontFamily: string } };
    value.data.fontFamily = 'Pretendard';
    await chrome.storage.sync.set({ 'unp.reader.v1': value });
  });
  await expect(page.locator('.line[data-line="3"]')).toHaveCSS(
    'font-family',
    /Pretendard Variable/
  );
  await expect
    .poll(() => fontLoaded(page, 'Pretendard Variable', 18), {
      timeout: 15000,
    })
    .toBe(true);
  await expect(page.getByText('글꼴 적용됨', { exact: true })).toHaveCount(0);
  await page.getByRole('spinbutton', { name: '글자 크기', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await expect(page.locator('.menu-top-setting')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await page
    .locator('#unp-panel-host')
    .evaluate((el) => (el.shadowRoot!.querySelector('.panel-scroll')!.scrollTop = 700));
  await page.locator('.font-dropdown .dropdown-trigger').click();
  await page.screenshot({ path: test.info().outputPath('font-picker.png') });
});
