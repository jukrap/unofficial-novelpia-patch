import { launchReadingContext, closeReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { defaults } from '../../src/shared/model/preferences';
// @ts-expect-error Synthetic fixture is a plain Node module, never a novel download.
import { viewerHtml } from '../fixtures/viewer.mjs';

let server: http.Server;
let base: string;
let context: BrowserContext;
let profile: string;
let extensionId: string;

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(
      request.url?.includes('short') ? viewerHtml().replace('i<150', 'i<2') : viewerHtml()
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-navigation-fonts-'));
  const extension = path.resolve('.output/chrome-mv3-e2e');
  context = await launchReadingContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1504, height: 960 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterEach(async () => {
  await closeReadingContext(context);
  if (path.resolve(profile).startsWith(path.join(tmpdir(), 'unp-navigation-fonts-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function settings(patch: Record<string, unknown>) {
  await context.serviceWorkers()[0]!.evaluate(async (patch) => {
    const current = await chrome.storage.sync.get('unp.reader.v1');
    const value = current['unp.reader.v1'] as { data?: Record<string, unknown> } | undefined;
    await chrome.storage.sync.set({
      'unp.reader.v1': { schemaVersion: 1, data: { ...value?.data, ...patch } },
    });
  }, patch);
}

async function openViewer(mode: 'scroll' | 'page' = 'scroll', query = 'controls') {
  await settings({ readingMode: mode });
  const page = await context.newPage();
  await page.addInitScript(
    (mode) => localStorage.setItem('viewer_paging', mode === 'page' ? '1' : '0'),
    mode
  );
  await page.goto(`${base}/viewer/1001?${query}`);
  await expect(page.locator(`[data-unp-reader="${mode}"]`)).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-unp-preparing');
  await expect(page.locator('#unp-navigation-host')).toBeVisible();
  return page;
}

async function geometry(page: Page, mode: 'scroll' | 'page') {
  return page.evaluate((mode) => {
    const rect = (selector: string) => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom };
    };
    return {
      reader: rect(mode === 'page' ? '#novel_drawing_page_c' : '#novel_box'),
      navigation: rect('#unp-navigation-host'),
      footer: rect('#footer'),
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  }, mode);
}

for (const mode of ['scroll', 'single', 'spread'] as const) {
  for (const placement of ['reserved', 'fixed', 'overlay'] as const) {
    test(`${placement} navigation follows its frame in ${mode} at 40, 70 and 100 percent height`, async () => {
      const readerMode = mode === 'scroll' ? 'scroll' : 'page';
      await settings({
        ...defaults,
        pageEffect: 'none',
        pageNavigationPlacement: placement,
        maxWidth: 580,
        spreadMode: mode === 'single' ? 'single' : 'auto',
        readerHeightPercent: 40,
      });
      const page = await openViewer(readerMode);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      if (mode !== 'scroll')
        await expect(page.locator('#novel_drawing_page')).toHaveCSS(
          'column-count',
          mode === 'spread' ? '2' : '1'
        );
      const frames: Awaited<ReturnType<typeof geometry>>[] = [];
      for (const percent of [40, 70, 100]) {
        await settings({ readerHeightPercent: percent });
        if (frames.length)
          await expect
            .poll(async () => (await geometry(page, readerMode)).reader.height)
            .toBeGreaterThan(frames.at(-1)!.reader.height + 30);
        // Wait for navigation ResizeObserver and the next reader layout together.
        await expect
          .poll(async () => {
            const { reader, navigation, footer } = await geometry(page, readerMode);
            if (placement === 'reserved') return Math.abs(navigation.y - reader.bottom - 8);
            if (placement === 'overlay')
              return Math.max(0, navigation.bottom - reader.bottom, navigation.bottom - footer.y);
            return frames.length ? Math.abs(navigation.y - frames[0]!.navigation.y) : 0;
          })
          .toBeLessThan(1);
        const frame = await geometry(page, readerMode);
        expect(frame.reader.y).toBeGreaterThanOrEqual(-1);
        expect(frame.reader.bottom).toBeLessThanOrEqual(961);
        expect(frame.navigation.bottom).toBeLessThanOrEqual(961);
        expect(frame.overflow).toBeLessThanOrEqual(1);
        if (placement !== 'overlay')
          expect(frame.navigation.y).toBeGreaterThanOrEqual(frame.reader.bottom);
        if (placement === 'fixed')
          expect(frame.navigation.bottom).toBeLessThanOrEqual(frame.footer.y);
        frames.push(frame);
      }
      expect(Math.abs(frames[0]!.reader.height / frames[2]!.reader.height - 0.4)).toBeLessThan(
        0.01
      );
      expect(Math.abs(frames[1]!.reader.height / frames[2]!.reader.height - 0.7)).toBeLessThan(
        0.01
      );
      if (placement === 'fixed')
        expect(Math.abs(frames[0]!.navigation.y - frames[2]!.navigation.y)).toBeLessThan(1);
      else expect(frames[2]!.navigation.y).toBeGreaterThan(frames[0]!.navigation.y + 60);
      expect(errors).toEqual([]);
    });
  }
}

test('scroll overlay fills the original viewport and menus do not shrink or shift it', async () => {
  await settings({ ...defaults, pageNavigationPlacement: 'overlay', readerHeightPercent: 100 });
  const page = await openViewer();
  await expect
    .poll(async () => {
      const { reader } = await geometry(page, 'scroll');
      return Math.max(Math.abs(reader.y), Math.abs(reader.bottom - 960));
    })
    .toBeLessThan(1);
  const before = (await geometry(page, 'scroll')).reader;
  for (const visible of [false, true]) {
    await page.locator('#header, #footer').evaluateAll((elements, visible) => {
      for (const element of elements) (element as HTMLElement).style.opacity = visible ? '1' : '0';
    }, visible);
    await page.waitForTimeout(100);
    expect((await geometry(page, 'scroll')).reader).toEqual(before);
  }
  await page.screenshot({ path: test.info().outputPath('scroll-overlay-full-height.png') });
  await page.getByRole('button', { name: '현재 위치 북마크 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '북마크로 이동', exact: true })).toBeEnabled();
});

test('short scroll content paints the whole requested height without growing the horizontal page', async () => {
  await settings({ ...defaults, pageNavigationPlacement: 'overlay', readerHeightPercent: 100 });
  const page = await openViewer('scroll', 'short');
  for (const percent of [100, 40]) {
    await settings({ readerHeightPercent: percent });
    await expect
      .poll(async () => (await geometry(page, 'scroll')).reader.height)
      .toBeCloseTo((960 * percent) / 100, 0);
    const frame = await geometry(page, 'scroll');
    const paper = (await page.locator('#novel_text').boundingBox())!;
    expect(paper.height).toBeGreaterThanOrEqual(frame.reader.height - 1);
    expect(frame.overflow).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.reader.y - (960 - frame.reader.height) / 2)).toBeLessThan(1);
  }
});

async function expectUiFont(page: Page, selector: string) {
  await expect(page.locator(selector)).toHaveCSS('font-family', /UNP UI Freesentation/);
  for (const weight of [400, 500, 600, 700]) {
    await expect
      .poll(() =>
        page.evaluate(async (weight) => {
          const faces = await document.fonts.load(
            `${weight} 16px "UNP UI Freesentation"`,
            '한글 Abc 123'
          );
          return faces.some(
            (face) => face.status === 'loaded' && face.family.includes('UNP UI Freesentation')
          );
        }, weight)
      )
      .toBe(true);
  }
}

test('packaged UI faces load in options, popup and viewer shadow roots without network access', async () => {
  await settings({ ...defaults, fontFamily: 'system-ui' });
  const viewer = await openViewer();
  await context.setOffline(true);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByRole('heading', { name: '홈', exact: true })).toBeVisible();
  await expectUiFont(options, '[data-testid="management-page"]');
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('button', { name: '설정 열기', exact: true })).toBeVisible();
  await expectUiFont(popup, '.extension-popup');
  await viewer.locator('#btn_theme').click();
  await expect(viewer.getByTestId('settings-panel')).toBeVisible();
  await expectUiFont(viewer, '[data-testid="settings-panel"]');
  await expectUiFont(viewer, '#unp-navigation-host nav');
  await expect(viewer.locator('[data-unp-line]').nth(1)).not.toHaveCSS(
    'font-family',
    /UNP UI Freesentation/
  );
  for (const page of [options, popup, viewer]) {
    const sources = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => entry.name)
    );
    expect(
      sources
        .filter((url) => /Freesentation.*woff2/i.test(url))
        .every((url) => url.startsWith('chrome-extension://'))
    ).toBe(true);
  }
  await popup.screenshot({ path: test.info().outputPath('popup-light-offline.png') });
  await settings({ darkMode: true });
  await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(popup.getByRole('button', { name: '설정 열기', exact: true })).toHaveCSS(
    'color',
    'rgb(33, 21, 47)'
  );
  await popup.screenshot({ path: test.info().outputPath('popup-dark-offline.png') });
  await viewer.screenshot({ path: test.info().outputPath('themebox-local-typeface.png') });
});

for (const width of [1504, 390]) {
  test(`font catalog filters and weight metadata stay keyboard usable without eager downloads at ${width}px`, async () => {
    // Isolate list browsing from the selected reading font's legitimate download.
    await settings({ ...defaults, fontFamily: 'system-ui' });
    const remote: string[] = [];
    context.on('request', (request) => {
      if (
        /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(
          request.url()
        )
      )
        remote.push(request.url());
    });
    const page = await openViewer();
    await page.setViewportSize({ width, height: 960 });
    await page.locator('#btn_theme').click();
    const trigger = page.getByRole('button', { name: '글꼴 선택', exact: true });
    await trigger.click();
    const search = page.getByRole('searchbox', { name: '글꼴 이름 검색', exact: true });
    await expect(search).toBeFocused();
    await expect(page.locator('.font-option')).toHaveCount(26);
    await search.fill('없는 글꼴');
    await expect(
      page.getByText('일치하는 글꼴이 없습니다. 이름이나 분류를 바꿔 보세요.')
    ).toBeVisible();
    await search.fill('프리젠테이션');
    await expect(page.locator('.font-option')).toHaveCount(1);
    await expect(page.locator('.font-weight-tag')).toHaveText([
      '100',
      '200',
      '300',
      '400',
      '500',
      '600',
      '700',
      '800',
      '900',
    ]);
    await expect(page.locator('.font-meta-description')).toContainText('지원 두께는 100, 200');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    expect(remote).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`font-search-${width}.png`) });
    await search.fill('노토 산스 KR');
    await expect(page.locator('.font-variable-badge')).toHaveText('가변');
    await expect(page.locator('.font-weight-range')).toHaveText('100~900');
    await search.fill('프리젠테이션');
    // Follow the actual keyboard path through categories to the one matching font.
    for (let step = 0; step < 9; step++) {
      await page.keyboard.press('Tab');
      if (await page.locator('.font-option').evaluate((element) => element.matches(':focus')))
        break;
    }
    await expect(page.locator('.font-option')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(search).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('프리젠테이션');
    await expect.poll(() => remote.length).toBeGreaterThan(0);
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}

test('standard, font and color selectors share hover feedback and animated chevrons', async () => {
  await settings({ ...defaults });
  const page = await openViewer();
  await page.locator('#btn_theme').click();
  for (const kind of ['font', 'standard', 'color'] as const) {
    if (kind === 'color')
      await page.getByRole('button', { name: '외관 설정으로 이동', exact: true }).click();
    const trigger =
      kind === 'font'
        ? page.getByRole('button', { name: '글꼴 선택', exact: true })
        : kind === 'standard'
          ? page.getByRole('combobox', { name: '글자 두께', exact: true })
          : page
              .getByRole('group', { name: '배경 색상', exact: true })
              .locator('.dropdown-trigger');
    await trigger.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const paint = () =>
      trigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.backgroundColor}/${style.borderColor}`;
      });
    const resting = await paint();
    await trigger.hover();
    await expect.poll(paint).not.toBe(resting);
    const arrow = trigger.locator('.chevron');
    await trigger.focus();
    const transforms = await trigger.evaluate(async (button) => {
      const arrow = button.querySelector('.chevron')!;
      const samples = [getComputedStyle(arrow).transform];
      (button as HTMLButtonElement).click();
      const started = performance.now();
      while (performance.now() - started < 240) {
        await new Promise(requestAnimationFrame);
        samples.push(getComputedStyle(arrow).transform);
      }
      return samples;
    });
    expect(new Set(transforms).size).toBeGreaterThan(2);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(arrow).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.color-dropdown .dropdown-trigger .chevron').first()).toHaveCSS(
    'transition-duration',
    '0s'
  );
});

for (const [surface, viewport] of [
  ['themebox', { width: 1504, height: 960 }],
  ['options', { width: 1440, height: 760 }],
  ['options', { width: 1440, height: 1200 }],
  ['preset', { width: 752, height: 700 }],
] as const) {
  test(`font categories keep the popup edge attached after reopening in ${surface} ${viewport.height}`, async () => {
    await settings({ ...defaults, fontFamily: 'system-ui' });
    const page = surface === 'themebox' ? await openViewer() : await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    if (surface === 'themebox') await page.locator('#btn_theme').click();
    else {
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await page
        .getByRole('button', { name: surface === 'preset' ? '프리셋' : '텍스트', exact: true })
        .click();
      if (surface === 'preset')
        await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
    }
    const trigger = page.getByRole('button', { name: '글꼴 선택', exact: true });
    await trigger.click();
    const popup = page.getByRole('dialog', { name: '글꼴 선택 목록', exact: true });
    const attached = async () => {
      await expect
        .poll(async () => {
          const [menu, control] = await Promise.all([popup.boundingBox(), trigger.boundingBox()]);
          if (!menu || !control) return 999;
          return Math.min(
            Math.abs(control.y - (menu.y + menu.height) - 6),
            Math.abs(menu.y - (control.y + control.height) - 6)
          );
        })
        .toBeLessThan(1.5);
    };
    await attached();
    await popup.getByRole('button', { name: '사용자', exact: true }).click();
    await attached();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(popup.getByRole('button', { name: '사용자', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await attached();
    await popup.getByRole('button', { name: '돋움체', exact: true }).click();
    await attached();
    await popup.getByRole('button', { name: '사용자', exact: true }).click();
    await attached();
    const search = popup.getByRole('searchbox');
    await search.fill('존재하지않는글꼴');
    await attached();
    await search.fill('');
    await popup.getByRole('button', { name: '전체', exact: true }).click();
    await attached();
    expect(
      await popup.evaluate((element) => element.scrollHeight - element.clientHeight)
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('category-popup-alignment.png') });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
  });
}

for (const surface of ['themebox', 'options', 'preset'] as const) {
  for (const viewport of [
    { width: 1504, height: 960 },
    { width: 390, height: 844 },
    { width: 752, height: 480 },
  ]) {
    test(`font picker has one scroll region in ${surface} at ${viewport.width}x${viewport.height}`, async () => {
      await settings({ ...defaults, darkMode: surface !== 'options' });
      const page = surface === 'themebox' ? await openViewer() : await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize(viewport);
      if (surface === 'themebox') await page.locator('#btn_theme').click();
      else {
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        await page
          .getByRole('button', { name: surface === 'preset' ? '프리셋' : '텍스트', exact: true })
          .click();
        if (surface === 'preset')
          await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
      }
      const trigger = page.getByRole('button', { name: '글꼴 선택', exact: true });
      await page.evaluate(() => document.fonts.ready.then(() => {}));
      await trigger.scrollIntoViewIfNeeded();
      await trigger.hover();
      const anchor = await trigger.boundingBox();
      await trigger.click();
      const popup = page.getByRole('dialog', { name: '글꼴 선택 목록', exact: true });
      const search = popup.getByRole('searchbox', { name: '글꼴 이름 검색' });
      const list = popup.locator('.font-list');
      await expect(search).toBeFocused();
      await expect(popup).toHaveCSS('opacity', '1');
      const metrics = await popup.evaluate((element) => {
        const list = element.querySelector('.font-list')!;
        return {
          popup: {
            client: element.clientHeight,
            scroll: element.scrollHeight,
            height: getComputedStyle(element).height,
          },
          list: { client: list.clientHeight, scroll: list.scrollHeight },
        };
      });
      await test.info().attach('scroll-metrics', {
        body: JSON.stringify(metrics),
        contentType: 'application/json',
      });
      await page.screenshot({ path: test.info().outputPath('font-picker-open.png') });
      expect(metrics.popup.scroll).toBeLessThanOrEqual(metrics.popup.client + 1);
      expect(metrics.list.scroll).toBeGreaterThan(metrics.list.client);
      const searchBounds = await search.boundingBox();
      const tabsBounds = await popup.locator('.tabs').boundingBox();
      await list.hover();
      await page.mouse.wheel(0, 1200);
      await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await popup.evaluate((element) => element.scrollTop)).toBe(0);
      expect(await search.boundingBox()).toEqual(searchBounds);
      expect(await popup.locator('.tabs').boundingBox()).toEqual(tabsBounds);
      expect(await trigger.boundingBox()).toEqual(anchor);
      await list.locator('.font-option').last().focus();
      await expect(list.locator('.font-option').last()).toBeInViewport();
      expect(await popup.evaluate((element) => element.scrollTop)).toBe(0);
      await page.screenshot({ path: test.info().outputPath('font-picker-scrolled.png') });
      await search.fill('system-ui');
      await expect(list.locator('.font-option')).toHaveCount(1);
      await list.locator('.font-option').click();
      await expect(popup).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}
