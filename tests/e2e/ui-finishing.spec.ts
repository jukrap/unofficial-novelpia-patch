import { launchReadingContext, closeReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
// @ts-expect-error Public synthetic fixture, never bundled into the extension.
import { viewerHtml } from '../fixtures/viewer.mjs';

let server: http.Server;
let base: string;
let context: BrowserContext;
let profile: string;
let extensionId: string;
test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const html = viewerHtml();
    response.end(
      request.url?.includes('native-stacking')
        ? html
            // Keep content below the menus to isolate header/footer stacking.
            .replace(/(<header\b[\s\S]*?<\/header>)([\s\S]*?)(<footer\b)/, '$2$1$3')
            .replaceAll('#header', '#header_bar')
            .replaceAll('#footer', '#footer_bar')
            .replace('id="header"', 'id="header_bar"')
            .replace('id="footer"', 'id="footer_bar"')
            .replace(
              '</style>',
              '#header_bar,#footer_bar,#theme_box{z-index:auto}#header_bar{will-change:transform}</style>'
            )
        : html
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-ui-finishing-'));
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
  if (profile.startsWith(path.join(tmpdir(), 'unp-ui-finishing-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function openViewer(width = 1504) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 960 });
  await page.goto(`${base}/viewer/1001`);
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await page.locator('#btn_theme').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  return page;
}
async function goSection(page: Page, section: string) {
  await page.getByRole('button', { name: `${section} 설정으로 이동`, exact: true }).click();
}

for (const mode of ['scroll', 'page'] as const) {
  for (const width of [1440, 390]) {
    test(`themebox stays above the ${mode} navigation when reading height changes at ${width}px`, async () => {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (mode) => localStorage.setItem('viewer_paging', mode === 'page' ? '1' : '0'),
        mode
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/viewer/1001?native-stacking`);
      await expect(page.locator(`[data-unp-reader="${mode}"]`)).toBeVisible();
      await page.locator('#btn_theme').click();
      await goSection(page, '레이아웃');
      const height = page.getByRole('spinbutton', { name: '본문 높이', exact: true });
      await height.fill('40');
      await height.press('Enter');
      const nav = page.locator('#unp-navigation-host');
      for (const placement of ['본문 아래', '본문 위']) {
        await page.getByRole('button', { name: placement, exact: true }).click();
        const overlapPoint = async () => {
          const bar = (await nav.boundingBox())!,
            panel = (await page.getByTestId('settings-panel').boundingBox())!;
          return {
            x: (Math.max(bar.x, panel.x) + Math.min(bar.x + bar.width, panel.x + panel.width)) / 2,
            y: bar.y + bar.height / 2,
          };
        };
        await expect
          .poll(async () =>
            page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, await overlapPoint())
          )
          .toBe('unp-panel-host');
        await page.screenshot({
          path: test
            .info()
            .outputPath(`${placement === '본문 위' ? 'overlay' : 'reserved'}-under-themebox.png`),
        });
      }
      // Native campaign UI must still be above the panel and retain its own action.
      const ad = page.locator('#test-banner');
      await ad.evaluate((element) => {
        element.style.top = '300px';
        element.style.bottom = 'auto';
        element.style.left = '50%';
        element.style.right = 'auto';
        element.style.transform = 'translateX(-50%)';
      });
      await ad.getByRole('button').click();
      await expect(ad).toHaveAttribute('data-clicked', 'yes');
      await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
      await expect(page.getByTestId('settings-panel')).toBeHidden();
      await nav.getByRole('button', { name: '현재 위치 북마크 저장', exact: true }).click();
      await expect(nav.getByRole('button', { name: '북마크로 이동', exact: true })).toBeEnabled();
      expect(errors).toEqual([]);
      if (width === 1440 && mode === 'scroll') {
        const worker = context.serviceWorkers()[0]!;
        const closed = worker.waitForEvent('close');
        await worker.evaluate(() => {
          setTimeout(() => chrome.runtime.reload(), 0);
        });
        await closed;
        await expect(page.locator('#unp-panel-host')).toHaveCount(0);
        await expect(page.locator('#header_bar')).toHaveCSS('z-index', 'auto');
      }
    });
  }
}
async function assertColorsOverlay(page: Page) {
  await goSection(page, '외관');
  await page.getByRole('button', { name: '이미지', exact: true }).click();
  for (const label of ['배경 색상', '오버레이 색상', '글자 색상', '본문 배경 색상']) {
    const row = page.getByRole('group', { name: label, exact: true }).locator('..');
    const trigger = row.locator('.dropdown-trigger');
    await trigger.scrollIntoViewIfNeeded();
    const before = (await row.boundingBox())!;
    await trigger.click();
    const popup = row.getByRole('dialog');
    await expect(popup).toBeVisible();
    expect(Math.abs((await row.boundingBox())!.height - before.height)).toBeLessThan(1);
    const rect = (await popup.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
}

for (const { width, dark } of [
  { width: 1504, dark: false },
  { width: 390, dark: false },
  { width: 1504, dark: true },
  { width: 390, dark: true },
]) {
  test(`themebox overlays and editor action slot stay stable at ${width}px ${dark ? 'dark' : 'light'}`, async () => {
    const testInfo = test.info();
    const page = await openViewer(width);
    if (dark) {
      await goSection(page, '외관');
      await page.getByRole('switch', { name: '다크 모드', exact: true }).click();
      await expect(page.getByTestId('settings-panel')).toHaveClass(/dark/);
    }
    await assertColorsOverlay(page);
    await goSection(page, '프리셋');
    await expect(
      page.getByRole('region', { name: '기본 제공 프리셋' }).locator('.preset-card')
    ).toHaveCount(10);
    await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
    if (width === 1504)
      await page.getByRole('textbox', { name: '이름', exact: true }).fill('작업바 저장 검증');
    const actions = page.getByRole('group', { name: '프리셋 편집 작업' });
    await expect(actions).toBeVisible();
    expect(await actions.evaluate((element) => Boolean(element.closest('.panel-scroll')))).toBe(
      false
    );
    const first = (await actions.boundingBox())!;
    for (const fraction of [0.5, 0.99, 1]) {
      await page.locator('.panel-scroll').evaluate((element, fraction) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction;
      }, fraction);
      const current = (await actions.boundingBox())!;
      expect(Math.abs(current.y - first.y)).toBeLessThan(1);
      expect(current.x + current.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}.png`) });
    await actions
      .getByRole('button', { name: width === 1504 ? '저장' : '취소', exact: true })
      .click();
    await expect(page.getByRole('form', { name: '프리셋 편집' })).toHaveCount(0);
    if (width === 1504)
      await expect(
        page.locator('.preset-card').filter({ hasText: '작업바 저장 검증' })
      ).toBeVisible();
  });
}

test('options keep one document scroll and a fixed editor toolbar with responsive information', async () => {
  const testInfo = test.info();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByTestId('management-page')).toBeVisible();
  const nav = page.getByRole('navigation', { name: '관리 항목' });
  await nav.getByRole('button', { name: '정보', exact: true }).click();
  const content = page.locator('.management-content');
  const left = (await content.boundingBox())!.x;
  expect(
    await page.locator('html').evaluate((element) => getComputedStyle(element).scrollbarGutter)
  ).toBe('stable');
  expect(
    await page
      .locator('.info-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
  ).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('info-desktop.png') });
  await nav.getByRole('button', { name: '프리셋', exact: true }).click();
  expect(Math.abs((await content.boundingBox())!.x - left)).toBeLessThan(1);
  await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
  await page.getByRole('button', { name: '현재 읽기 설정 가져오기', exact: true }).hover();
  await expect(
    page.getByRole('tooltip', {
      name: '현재 뷰어에 적용된 설정을 이 편집 초안으로 가져옵니다. 저장 전까지 프리셋은 바뀌지 않습니다.',
    })
  ).toBeVisible();
  const actions = page.getByRole('group', { name: '프리셋 편집 작업' });
  const first = (await actions.boundingBox())!;
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(Math.abs((await actions.boundingBox())!.y - first.y)).toBeLessThan(1);
  expect(
    await page
      .locator('.panel-scroll')
      .evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).overflowY === 'visible')
      )
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('options-editor-end.png') });
  await actions.getByRole('button', { name: '취소', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 960 });
  await nav.getByRole('button', { name: '정보', exact: true }).click();
  expect(
    await page
      .locator('.info-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
  ).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('info-mobile.png') });
});

for (const width of [1504, 390]) {
  test(`preset previews contain the full sample without scaling large typography at ${width}px`, async () => {
    const page = await openViewer(width);
    await goSection(page, '프리셋');
    await context.serviceWorkers()[0]!.evaluate(async () => {
      const raw = await chrome.storage.sync.get('unp.reader.v1');
      const document = raw['unp.reader.v1'] as { data: Record<string, unknown> };
      await chrome.storage.sync.set({
        'unp.presetIndex.v1': { schemaVersion: 1, ids: ['preview_extreme'], selectedId: null },
        'unp.preset.v1.preview_extreme': {
          id: 'preview_extreme',
          name: '최대 글자 미리보기',
          description: '',
          isDefault: false,
          createdAt: 0,
          settings: { ...document.data, fontSize: 50, lineHeight: 400, letterSpacing: 20 },
        },
      });
    });
    for (const [name, size, lineHeight] of [
      ['최대 글자 미리보기', 50, 200],
      ['큰 글씨', 26, 49.4],
    ] as const) {
      const card = page.getByRole('article', { name, exact: true });
      await expect(card).toBeAttached();
      const sample = card.getByTestId('typography-preview');
      await sample.scrollIntoViewIfNeeded();
      await expect(sample).toHaveCSS('font-size', `${size}px`);
      await expect(sample).toHaveCSS('line-height', `${lineHeight}px`);
      const measured = await sample.evaluate((element) => {
        const surface = element.closest('.preview-surface')!;
        const figure = element.closest('figure')!;
        const card = element.closest('.preset-card')!;
        const copy = element.getBoundingClientRect();
        const bounds = surface.getBoundingClientRect();
        const preview = figure.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = [...range.getClientRects()];
        return {
          overflow: element.scrollHeight - element.clientHeight,
          clippedText: text.some(
            (rect) =>
              rect.top < copy.top - 1 ||
              rect.bottom > copy.bottom + 1 ||
              rect.left < copy.left - 1 ||
              rect.right > copy.right + 1
          ),
          copyInsideSurface: copy.bottom <= bounds.bottom && copy.top >= bounds.top,
          surfaceInsideFigure: bounds.bottom <= preview.bottom && bounds.top >= preview.top,
          metricsBelowPreview:
            card.querySelector('.preset-card-metrics')!.getBoundingClientRect().top >=
            preview.bottom,
        };
      });
      expect(measured).toEqual({
        overflow: 0,
        clippedText: false,
        copyInsideSurface: true,
        surfaceInsideFigure: true,
        metricsBelowPreview: true,
      });
    }
    await page.screenshot({ path: test.info().outputPath(`large-preset-${width}.png`) });
  });
}

for (const dark of [false, true]) {
  test(`themebox has four rounded corners without a native square frame in ${dark ? 'dark' : 'light'} mode`, async () => {
    const page = await context.newPage();
    await page.goto(`${base}/viewer/1001`);
    await expect(page.locator('[data-unp-line]').first()).toBeAttached();
    await page.locator('#theme_box').evaluate((element) => {
      // Match the native frame, including the square shadow found on the live viewer.
      (element as HTMLElement).style.boxShadow = '0 1px 4px 0 rgba(0,0,0,.4)';
      (element as HTMLElement).style.borderRadius = '0';
    });
    await page.locator('#btn_theme').click();
    const panel = page.getByTestId('settings-panel');
    await expect(panel).toBeVisible();
    if (dark) {
      await goSection(page, '외관');
      await page.getByRole('switch', { name: '다크 모드', exact: true }).click();
      await expect(panel).toHaveClass(/dark/);
    }
    await expect(page.locator('#theme_box')).toHaveCSS('box-shadow', 'none');
    await expect(page.locator('#theme_box')).toHaveCSS('border-top-width', '0px');
    await expect(page.locator('#theme_box')).toHaveCSS('border-radius', '10px');
    await expect(panel).toHaveCSS('overflow', 'hidden');
    await page.evaluate(() => {
      const backdrop = document.createElement('div');
      backdrop.id = 'test-corner-backdrop';
      backdrop.style.cssText =
        'position:fixed;inset:0;background:#00ff00;z-index:109;pointer-events:none';
      document.getElementById('theme_box')!.before(backdrop);
    });
    const bounds = (await panel.boundingBox())!;
    const png = await page.screenshot({
      path: test.info().outputPath(`rounded-${dark ? 'dark' : 'light'}.png`),
    });
    const corners = await page.evaluate(
      async ({ imageUrl, bounds }) => {
        const image = new Image();
        image.src = imageUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return [
          [bounds.x + 1, bounds.y + 1],
          [bounds.x + bounds.width - 2, bounds.y + 1],
          [bounds.x + 1, bounds.y + bounds.height - 2],
          [bounds.x + bounds.width - 2, bounds.y + bounds.height - 2],
        ].map(([x, y]) => [...context.getImageData(Math.floor(x!), Math.floor(y!), 1, 1).data]);
      },
      { imageUrl: `data:image/png;base64,${png.toString('base64')}`, bounds }
    );
    // Outside each rounded corner the green backdrop remains visible, allowing for the panel shadow.
    for (const [red, green, blue] of corners)
      expect(green! - Math.max(red!, blue!)).toBeGreaterThan(100);
    await page.locator('#test-corner-backdrop').evaluate((element) => element.remove());
    await goSection(page, '텍스트');
    await page.getByRole('button', { name: '글꼴 선택', exact: true }).click();
    const fontPopup = page.getByRole('dialog', { name: '글꼴 선택 목록', exact: true });
    await expect(fontPopup).toBeVisible();
    expect(await fontPopup.evaluate((element) => element.matches(':popover-open'))).toBe(true);
    await page.keyboard.press('Escape');
    await page
      .getByRole('group', { name: '글꼴', exact: true })
      .locator('.label-help')
      .first()
      .hover();
    await expect(
      page.getByRole('tooltip').filter({ hasText: '본문에 사용할 글꼴입니다.' })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await assertColorsOverlay(page);
  });
}

for (const systemTheme of ['light', 'dark'] as const) {
  test(`options canvas follows the selected theme with a ${systemTheme} system theme`, async () => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: systemTheme });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const management = page.getByTestId('management-page');
    await expect(management).toBeVisible();
    const navigation = page.getByRole('navigation', { name: '관리 항목' });
    for (const dark of [false, true, false]) {
      if ((await management.evaluate((element) => element.classList.contains('dark'))) !== dark) {
        await navigation.getByRole('button', { name: '외관', exact: true }).click();
        await page.getByRole('switch', { name: '다크 모드', exact: true }).click();
      }
      await navigation.getByRole('button', { name: '프리셋', exact: true }).click();
      const color = dark ? [36, 33, 42, 255] : [255, 255, 255, 255];
      await expect(page.locator('html')).toHaveCSS('color-scheme', dark ? 'dark' : 'light');
      await expect(page.locator('html')).toHaveCSS(
        'background-color',
        dark ? 'rgb(36, 33, 42)' : 'rgb(255, 255, 255)'
      );
      const png = await page.screenshot({
        path: test
          .info()
          .outputPath(`canvas-system-${systemTheme}-selected-${dark ? 'dark' : 'light'}.png`),
      });
      const pixels = await page.evaluate(
        async (imageUrl) => {
          const image = new Image();
          image.src = imageUrl;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return [1, 16, 31, 90].map((y) => [...context.getImageData(3, y, 1, 1).data]);
        },
        `data:image/png;base64,${png.toString('base64')}`
      );
      expect(pixels).toEqual([color, color, color, color]);
    }
  });
}

test('color palettes separate the current color editor without losing swatch selection', async () => {
  const page = await openViewer();
  await goSection(page, '외관');
  const group = page.getByRole('group', { name: '배경 색상', exact: true });
  await group.locator('.dropdown-trigger').click();
  const popup = group.getByRole('dialog');
  const current = popup.getByRole('region', { name: '배경 색상 현재 색상' });
  await expect(current.getByRole('heading', { name: '현재 색상', exact: true })).toBeVisible();
  await expect(current).toHaveCSS('border-top-width', '1px');
  await expect(current).toHaveCSS('padding-top', '16px');
  await expect(current).toHaveCSS('border-left-width', '0px');
  const chosen = popup.getByRole('button', { name: '배경 색상 #8A2BE2', exact: true });
  await chosen.click();
  await expect(chosen).toHaveAttribute('aria-pressed', 'true');
  await expect(chosen.locator('.swatch-check')).toHaveText('✓');
  await expect(current.getByRole('textbox', { name: '배경 색상 HEX' })).toHaveValue('#8A2BE2');
  await expect(current.getByRole('slider', { name: '배경 색상 빨강' })).toHaveValue('138');
  await current.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('current-color-editor.png') });
});

for (const width of [1504, 390]) {
  test(`color popover starts at HEX and reveals RGB by keyboard without growing at ${width}px`, async () => {
    const page = await openViewer(width);
    await goSection(page, '외관');
    const group = page.getByRole('group', { name: '배경 색상', exact: true });
    const trigger = group.locator('.dropdown-trigger');
    await trigger.scrollIntoViewIfNeeded();
    const rowHeight = (await group.boundingBox())!.height;
    await trigger.click();
    const popup = group.getByRole('dialog');
    const hex = popup.getByRole('textbox', { name: '배경 색상 HEX', exact: true });
    const red = popup.getByRole('slider', { name: '배경 색상 빨강', exact: true });
    const assertInitialViewport = async () => {
      await expect(popup).toBeVisible();
      await expect.poll(() => popup.evaluate((element) => element.scrollTop)).toBe(0);
      const { bounds, rgb, inputs } = await popup.evaluate((element) => ({
        bounds: element.getBoundingClientRect().toJSON(),
        rgb: element.querySelector('.rgb-controls input')!.getBoundingClientRect().toJSON(),
        inputs: element.querySelector('.color-inputs')!.getBoundingClientRect().toJSON(),
      }));
      expect(bounds.height).toBeLessThanOrEqual(420);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(inputs.y + inputs.height + 2);
      expect(inputs.y + inputs.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(rgb.y).toBeGreaterThanOrEqual(bounds.y + bounds.height - 2);
      expect(Math.abs((await group.boundingBox())!.height - rowHeight)).toBeLessThan(1);
      return bounds;
    };
    const initial = await assertInitialViewport();
    await popup.getByRole('button', { name: '최근 선택', exact: true }).click();
    const recent = await assertInitialViewport();
    expect(recent.height).toBeLessThan(initial.height);
    await popup.getByRole('button', { name: '기본', exact: true }).click();
    await assertInitialViewport();
    await page.screenshot({ path: test.info().outputPath(`color-HEX-first-${width}.png`) });
    await hex.focus();
    await hex.press('Tab');
    await expect(red).toBeFocused();
    await expect.poll(() => popup.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const after = (await popup.boundingBox())!;
    const range = (await red.boundingBox())!;
    expect(Math.abs(after.height - initial.height)).toBeLessThan(1);
    expect(range.y).toBeGreaterThanOrEqual(after.y);
    expect(range.y + range.height).toBeLessThanOrEqual(after.y + after.height);
    const editingScroll = await popup.evaluate((element) => element.scrollTop);
    await red.press('ArrowLeft');
    await expect(red).toHaveValue('254');
    await expect(hex).toHaveValue('#feffff');
    expect(
      Math.abs((await popup.evaluate((element) => element.scrollTop)) - editingScroll)
    ).toBeLessThan(1);
    await page.screenshot({ path: test.info().outputPath(`color-RGB-focused-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await assertInitialViewport();
  });
}

test('page configuration and navigation placement are editable in isolated preset drafts', async () => {
  const page = await openViewer();
  await goSection(page, '레이아웃');
  const gap = page.getByRole('spinbutton', { name: '두 쪽 사이 간격', exact: true });
  await expect(gap).toHaveCount(0);
  await expect(page.getByRole('button', { name: '본문 위', exact: true })).toBeVisible();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: '페이지 방식', exact: true }).click(),
  ]);
  await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page');
  await page.locator('#btn_theme').click();
  await goSection(page, '레이아웃');
  await expect(gap).toHaveValue('20');
  await gap.fill('64');
  await gap.press('Enter');
  await page.getByRole('button', { name: '항상 한 쪽', exact: true }).click();
  await expect(gap).toHaveCount(0);
  await page.getByRole('button', { name: '자동 한 쪽, 두 쪽', exact: true }).click();
  await expect(gap).toHaveValue('64');
  await page.setViewportSize({ width: 390, height: 960 });
  await expect(gap).toHaveValue('64');
  await page.getByRole('button', { name: '본문 위', exact: true }).click();
  await expect(page.getByRole('button', { name: '본문 위', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const readSettings = () =>
    context.serviceWorkers()[0]!.evaluate(async () => {
      const raw = await chrome.storage.sync.get('unp.reader.v1');
      return (
        raw['unp.reader.v1'] as { data: { pageGap: number; pageNavigationPlacement: string } }
      ).data;
    });
  await expect
    .poll(readSettings)
    .toMatchObject({ pageGap: 64, pageNavigationPlacement: 'overlay' });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options
    .getByRole('navigation', { name: '관리 항목' })
    .getByRole('button', { name: '프리셋', exact: true })
    .click();
  await options.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
  const editor = options.getByRole('form', { name: '프리셋 편집' });
  await editor.getByRole('textbox', { name: '이름', exact: true }).fill('페이지 간격 프리셋');
  await editor.getByRole('tab', { name: '레이아웃', exact: true }).click();
  const draftGap = editor.getByRole('spinbutton', { name: '두 쪽 사이 간격', exact: true });
  await expect(draftGap).toHaveValue('64');
  await expect(editor.getByRole('button', { name: '본문 위', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await draftGap.fill('120');
  await draftGap.press('Enter');
  expect(await readSettings()).toMatchObject({ pageGap: 64, pageNavigationPlacement: 'overlay' });
  await options
    .getByRole('group', { name: '프리셋 편집 작업' })
    .getByRole('button', { name: '저장', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await options.getByRole('button', { name: '페이지 간격 프리셋 적용', exact: true }).click();
  await expect
    .poll(readSettings)
    .toMatchObject({ pageGap: 120, pageNavigationPlacement: 'overlay' });
  await options.screenshot({ path: test.info().outputPath('page-gap-preset.png') });
});
