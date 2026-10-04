import {
  launchReadingContext,
  readingFontCss,
  readingFontUrl,
} from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
// @ts-expect-error Synthetic text only; never bundled with the extension.
import { viewerHtml } from '../fixtures/viewer.mjs';

let server: http.Server;
let base: string;
let context: BrowserContext;
let profile: string;
let extensionId: string;
const surfaces = [
  'writer_comments_box',
  'next_epi_btn_bottom',
  'next_info_layer',
  'back_info_layer',
];
test.beforeAll(async () => {
  server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(
      viewerHtml()
        .replace(
          '작가가 지정한 굵은 글씨</b>',
          '작가가 지정한 <i>굵은 기울임</i></b><strong>strong 강조</strong><span data-normal>보통 문장</span>'
        )
        .replace(
          '</body>',
          '<div id="next_info_layer" style="display:block;opacity:.65;color:#335577;background:rgba(210,180,140,.3);border:2px dashed #665544;box-shadow:1px 2px 3px #223344">한번 더 누르면 다음화로 이동합니다.</div><div id="back_info_layer" style="display:none;opacity:.45;color:#553377;background:rgba(180,210,140,.2);border:3px dotted #446655;box-shadow:2px 3px 4px #443322">한번 더 누르면 이전화로 이동합니다.</div></body>'
        )
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-reading-polish-'));
  const extension = path.resolve('.output/chrome-mv3-e2e');
  context = await launchReadingContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});
test.afterEach(async () => {
  await context.close();
  if (profile.startsWith(path.join(tmpdir(), 'unp-reading-polish-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function update(patch: Record<string, unknown>) {
  await context.serviceWorkers()[0]!.evaluate(async (patch) => {
    const { ['unp.reader.v1']: doc } = await chrome.storage.sync.get('unp.reader.v1');
    Object.assign((doc as { data: Record<string, unknown> }).data, patch);
    await chrome.storage.sync.set({ 'unp.reader.v1': doc });
  }, patch);
}
async function openViewer() {
  const page = await context.newPage();
  await page.goto(`${base}/viewer/1001?controls`);
  await expect(page.locator('[data-unp-line]').first()).toBeVisible();
  return page;
}
async function panel(page: Page) {
  await page.locator('#btn_theme').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
}
async function section(page: Page, name: string) {
  if (new URL(page.url()).pathname === '/options.html')
    await page
      .getByRole('navigation', { name: '관리 항목' })
      .getByRole('button', { name, exact: true })
      .click();
  else await page.getByRole('button', { name: `${name} 설정으로 이동`, exact: true }).click();
}
async function paint(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      background: style.backgroundColor,
      image: style.backgroundImage,
      border: style.border,
      shadow: style.boxShadow,
    };
  });
}

async function captureViewport(page: Page, filename: string) {
  // Capture the compositor viewport directly: clip coordinates on zoomed,
  // vertically scrolled extension pages can offset Playwright screenshots.
  const session = await context.newCDPSession(page);
  const result = await session.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(test.info().outputPath(filename), Buffer.from(result.data, 'base64'));
  await session.detach();
}

async function failingFontSource(failure: 'stylesheet' | 'font file') {
  const state = { failing: true, rejectedStylesheets: 0, rejectedFonts: 0, recoveredRequests: 0 };
  const stylesheet =
    'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';
  const fontUrl = 'https://font.test/reading-retry.woff2';
  // Registered after the general CDN fixture, so the failure reaches every loader
  // for this font without affecting unrelated preset previews.
  await context.route(fontUrl, async (route) => {
    state.rejectedFonts++;
    await route.abort('failed');
  });
  await context.route(stylesheet, async (route) => {
    if (state.failing && failure === 'stylesheet') {
      state.rejectedStylesheets++;
      await route.abort('failed');
      return;
    }
    if (!state.failing) state.recoveredRequests++;
    await route.fulfill({
      contentType: 'text/css',
      body: readingFontCss('Pretendard Variable', state.failing ? fontUrl : readingFontUrl),
    });
  });
  return state;
}

async function expectFontRecovered(page: Page, scope: Locator) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.fonts].some(
          (face) => face.family.includes('Pretendard') && face.status === 'loaded'
        )
      )
    )
    .toBe(true);
  await expect(scope.locator('.preview-surface').filter({ visible: true })).toHaveAttribute(
    'aria-busy',
    'false'
  );
  await expect(scope.locator('.field-error').filter({ visible: true })).toHaveCount(0);
  await expect(scope.locator('.preview-load-error').filter({ visible: true })).toHaveCount(0);
}

for (const failure of ['stylesheet', 'font file'] as const) {
  for (const retryFrom of ['preview', 'font control'] as const) {
    test(`retrying a failed ${failure} from the ${retryFrom} recovers the reader and both font controls`, async () => {
      const source = await failingFontSource(failure);
      const page = await openViewer();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await panel(page);
      await section(page, '텍스트');
      await update({ fontFamily: 'Pretendard', fontWeight: 600, forceBold: false });
      const scope = page.getByTestId('settings-panel');
      const previewError = scope.locator('.preview-load-error').filter({ visible: true });
      await expect(previewError).toBeVisible();
      await expect(scope.locator('.field-error').filter({ visible: true })).toBeVisible();
      expect(
        failure === 'stylesheet' ? source.rejectedStylesheets : source.rejectedFonts
      ).toBeGreaterThan(0);
      // Native episode-list views hide the reader; retry cannot depend on a layout pass.
      const hiddenReader = failure === 'stylesheet' && retryFrom === 'preview';
      if (hiddenReader)
        await page.locator('#novel_box').evaluate((node: HTMLElement) => {
          node.style.display = 'none';
        });
      source.failing = false;
      await (
        retryFrom === 'preview'
          ? previewError.getByRole('button', { name: '다시 시도', exact: true })
          : scope.getByRole('button', { name: '글꼴 다시 시도', exact: true })
      ).click();
      await expectFontRecovered(page, scope);
      if (hiddenReader)
        await page.locator('#novel_box').evaluate((node: HTMLElement) => {
          node.style.removeProperty('display');
        });
      expect(source.recoveredRequests).toBeGreaterThan(0);
      const line = page.locator('.line[data-line="3"]');
      await expect(line).toHaveCSS('font-weight', '600');
      await expect(line.locator('b')).toHaveCSS('font-weight', '900');
      await update({ fontFamily: 'system-ui', fontWeight: 400 });
      await expect(line).toHaveCSS('font-family', 'system-ui, sans-serif');
      await expect(scope.locator('.field-error').filter({ visible: true })).toHaveCount(0);
      await update({ fontFamily: 'Pretendard', fontWeight: 600 });
      await expect(line).toHaveCSS('font-family', '"Pretendard Variable", system-ui, sans-serif');
      await expectFontRecovered(page, scope);
      expect(errors).toEqual([]);
    });
  }

  test(`retrying a ${failure} in a preset draft recovers its preview without saving or changing the reader`, async () => {
    const source = await failingFontSource(failure);
    const page = await openViewer();
    await panel(page);
    await section(page, '프리셋');
    const savedState = () =>
      context.serviceWorkers()[0]!.evaluate(async () => {
        const values = await chrome.storage.sync.get(null);
        return Object.fromEntries(
          Object.entries(values).filter(([key]) =>
            /^(unp\.reader\.v1|unp\.presetIndex\.v1|unp\.preset\.v1\.)/.test(key)
          )
        );
      });
    const before = await savedState();
    const body = page.locator('[data-unp-line]').first();
    const bodyFont = await body.evaluate((node) => getComputedStyle(node).fontFamily);
    await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
    const editor = page.getByRole('form', { name: '프리셋 편집', exact: true });
    await editor.getByRole('button', { name: '글꼴 선택', exact: true }).click();
    await page
      .locator('.font-option')
      .filter({ has: page.getByText('프리텐다드', { exact: true }), visible: true })
      .click();
    await expect(editor.locator('.preview-load-error')).toBeVisible();
    await expect(editor.locator('.field-error')).toBeVisible();
    source.failing = false;
    await editor.getByRole('button', { name: '글꼴 다시 시도', exact: true }).click();
    await expectFontRecovered(page, editor);
    expect(source.recoveredRequests).toBeGreaterThan(0);
    await expect(editor.getByTestId('typography-preview')).toHaveCSS(
      'font-family',
      '"Pretendard Variable", system-ui, sans-serif'
    );
    await expect(body).toHaveCSS('font-family', bodyFont);
    expect(await savedState()).toEqual(before);
    await page
      .getByRole('group', { name: '프리셋 편집 작업' })
      .getByRole('button', { name: '취소', exact: true })
      .click();
    await page.getByRole('button', { name: '버리고 이동', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(body).toHaveCSS('font-family', bodyFont);
    expect(await savedState()).toEqual(before);
  });
}

for (const darkMode of [false, true]) {
  test(`reading surface modes restore native paint and leave service state and action toasts intact (${darkMode ? 'dark' : 'light'})`, async () => {
    const page = await openViewer();
    await update({
      darkMode,
      textColor: '#345678',
      textAreaBackgroundColor: '#dce8f4',
      readingSurfaces: 'default',
    });
    await expect(page.locator('#next_info_layer')).toHaveCSS('color', 'rgb(51, 85, 119)');
    await expect(page.locator('[data-unp-line]').first()).toHaveCSS('color', 'rgb(52, 86, 120)');
    if (darkMode) {
      await page.route('https://background.test/reading.svg', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><path fill="#151024" d="M0 0h800v800H0z"/><circle fill="#8872b6" cx="400" cy="400" r="300"/></svg>',
        })
      );
      await update({
        backgroundType: 'image',
        backgroundImage: 'https://background.test/reading.svg',
      });
      await expect(page.locator('[data-unp-background]')).toHaveCSS('opacity', '1');
    }
    const original = await Promise.all(surfaces.map((id) => paint(page.locator(`#${id}`))));
    await panel(page);
    if (darkMode) await expect(page.getByTestId('settings-panel')).toHaveClass(/dark/);
    else await expect(page.getByTestId('settings-panel')).not.toHaveClass(/dark/);
    await section(page, '외관');
    await page
      .getByTestId('settings-panel')
      .getByRole('button', { name: '현재 위치 북마크 저장', exact: true })
      .click();
    const toast = page.locator('.action-toast');
    await expect(toast).toBeVisible();
    await toast.hover();
    const toastPaint = await paint(toast);
    const modeControl = page.getByRole('combobox', { name: '뷰어 보조 영역 색상', exact: true });
    for (const mode of ['translucent', 'opaque', 'theme'] as const) {
      await update({ readingSurfaces: mode });
      await expect(modeControl).toHaveAttribute('data-value', mode);
      const expectedInk =
        mode === 'theme'
          ? darkMode
            ? 'rgb(241, 237, 247)'
            : 'rgb(41, 38, 48)'
          : 'rgb(52, 86, 120)';
      const expectedPaper =
        mode === 'theme'
          ? darkMode
            ? 'rgb(36, 33, 42)'
            : 'rgb(255, 255, 255)'
          : mode === 'translucent'
            ? 'rgba(220, 232, 244, 0.8)'
            : 'rgb(220, 232, 244)';
      for (const id of surfaces) {
        await expect(page.locator(`#${id}`)).toHaveCSS('color', expectedInk);
        await expect(page.locator(`#${id}`)).toHaveCSS('background-color', expectedPaper);
      }
      await expect(page.locator('#next_info_layer')).toHaveCSS('opacity', '0.65');
      await expect(page.locator('#next_info_layer')).toHaveCSS('display', 'block');
      await expect(page.locator('#back_info_layer')).toHaveCSS('opacity', '0.45');
      await expect(page.locator('#back_info_layer')).toHaveCSS('display', 'none');
      expect(await paint(toast)).toEqual(toastPaint);
      await update({ readingSurfaces: 'default' });
      await expect(modeControl).toHaveAttribute('data-value', 'default');
      for (const [index, id] of surfaces.entries())
        await expect.poll(() => paint(page.locator(`#${id}`))).toEqual(original[index]);
      await expect(page.locator('#next_info_layer')).toHaveCSS('width', '300px');
    }
    await page.getByRole('button', { name: '알림 닫기', exact: true }).click();
    await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
    // A real reading gesture releases the saved-position guard. Playwright's
    // automatic scrollIntoView alone is indistinguishable from a late site restore.
    const viewport = (await page.locator('#novel_box').boundingBox())!;
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await page.mouse.wheel(0, 20_000);
    await page.locator('#next_epi_btn_bottom').click();
    await expect(page.locator('body')).toHaveAttribute('data-episode-next', 'yes');
  });
}

test('author weights, previews and supported choices follow the same font policy without changing italic or normal text', async () => {
  const page = await openViewer();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await panel(page);
  await section(page, '텍스트');
  const line = page.locator('.line[data-line="3"]');
  const preview = page.getByTestId('typography-preview').filter({ visible: true });
  const emphasis = page.getByRole('combobox', { name: '굵은 텍스트 강조', exact: true });
  const weight = page.getByRole('combobox', { name: '글자 두께', exact: true });
  for (const sample of [
    { fontFamily: 'Pretendard', fontWeight: 400, body: 400, author: 700 },
    { fontFamily: 'Pretendard', fontWeight: 600, body: 600, author: 900 },
    { fontFamily: 'Pretendard', fontWeight: 700, body: 700, author: 900 },
    { fontFamily: 'MaruBuri', fontWeight: 600, body: 600, author: 700 },
    { fontFamily: '42dot Sans', fontWeight: 600, body: 600, author: 800 },
    { fontFamily: 'RIDIBatang', fontWeight: 400, body: 700, author: 700, forceBold: true },
  ]) {
    await update({
      fontFamily: sample.fontFamily,
      fontWeight: sample.fontWeight,
      forceBold: sample.forceBold ?? false,
    });
    await expect(line).toHaveCSS('font-weight', String(sample.body));
    await expect(line.locator('[data-normal]')).toHaveCSS('font-weight', String(sample.body));
    for (const author of ['b', 'strong', '[data-unp-emphasis]', 'b i'])
      await expect(line.locator(author)).toHaveCSS('font-weight', String(sample.author));
    await expect(line.locator('b i')).toHaveCSS('font-style', 'italic');
    await expect(line.locator('i').last()).toHaveCSS('font-style', 'italic');
    await expect(preview).toHaveCSS('font-weight', String(sample.body));
    await expect(preview.locator('strong')).toHaveCSS('font-weight', String(sample.author));
    await expect(page.locator('.weight-advice').filter({ visible: true })).toHaveCount(
      sample.body >= 700 ? 1 : 0
    );
    await emphasis.click();
    const choices = page
      .getByRole('listbox', { name: '굵은 텍스트 강조', exact: true })
      .getByRole('option');
    await expect(choices).toHaveCount(4);
    for (const choice of await choices.all())
      await expect(choice.locator('span')).toHaveCSS('font-weight', String(sample.author));
    await emphasis.press('Escape');
    await weight.click();
    const menu = page.getByRole('listbox', { name: '글자 두께', exact: true });
    if (sample.fontFamily === 'RIDIBatang') {
      await expect(menu.getByRole('option')).toHaveCount(2);
      await expect(menu.getByRole('option', { name: '강제로 굵게', exact: true })).toBeVisible();
    } else
      await expect(menu.getByRole('option', { name: '강제로 굵게', exact: true })).toHaveCount(0);
    if (sample.fontFamily === 'Pretendard') {
      await expect(menu.getByRole('option')).toHaveCount(9);
      await expect(menu).toContainText('Semi Bold');
      await expect(menu).toContainText('Extra Bold');
      await expect(menu).toContainText('Black');
    }
    await weight.press('Escape');
  }
  await update({ fontFamily: 'Pretendard', fontWeight: 600, forceBold: false });
  await expect(preview.locator('strong')).toHaveCSS('font-weight', '900');
  await expect(page.locator('.weight-advice').filter({ visible: true })).toHaveCount(0);
  await section(page, '프리셋');
  await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
  const editor = page.getByRole('form', { name: '프리셋 편집', exact: true });
  await expect(editor.getByTestId('typography-preview').locator('strong')).toHaveCSS(
    'font-weight',
    '900'
  );
  await editor.getByRole('textbox', { name: '이름', exact: true }).fill('두께 일치 검증');
  await page
    .getByRole('group', { name: '프리셋 편집 작업' })
    .getByRole('button', { name: '저장', exact: true })
    .click();
  const card = page.getByRole('article', { name: '두께 일치 검증', exact: true });
  await expect(card.getByTestId('typography-preview')).toHaveCSS('font-weight', '600');
  await expect(card.getByTestId('typography-preview').locator('strong')).toHaveCSS(
    'font-weight',
    '900'
  );
  expect(errors).toEqual([]);
});

test('native inline weight edits remove obsolete emphasis markers after reflow', async () => {
  const page = await openViewer();
  await update({ fontFamily: 'Pretendard', fontWeight: 600 });
  const line = page.locator('.line[data-line="3"]');
  const child = line.locator('[data-normal]');
  await expect(line).toHaveCSS('font-weight', '600');
  for (const element of [line, child])
    await element.evaluate((node: HTMLElement) =>
      node.style.setProperty('font-weight', '700', 'important')
    );
  await update({ fontSize: 19 });
  for (const element of [line, child]) {
    await expect(element).toHaveAttribute('data-unp-emphasis', '');
    await expect(element).toHaveCSS('font-weight', '900');
  }
  await page.setViewportSize({ width: 1390, height: 860 });
  await update({ fontSize: 20 });
  for (const element of [line, child]) await expect(element).toHaveCSS('font-weight', '900');
  await line.evaluate((node: HTMLElement) => node.style.setProperty('font-weight', '400'));
  await child.evaluate((node: HTMLElement) =>
    node.style.setProperty('font-weight', '400', 'important')
  );
  await update({ fontSize: 21 });
  for (const element of [line, child])
    await expect(element).not.toHaveAttribute('data-unp-emphasis');
  await expect(line).toHaveCSS('font-weight', '600');
  await expect(child).toHaveCSS('font-weight', '400');
  await child.evaluate((node: HTMLElement) => node.style.removeProperty('font-weight'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await update({ fontSize: 22 });
  await expect(child).toHaveCSS('font-weight', '600');
  await expect(line.locator('strong')).toHaveCSS('font-weight', '900');
});

async function assertAdviceLayout(scope: Locator) {
  const weight = scope.getByRole('combobox', { name: '글자 두께', exact: true });
  const advice = scope.locator('.weight-advice').filter({ visible: true });
  const emphasis = scope.getByRole('combobox', { name: '굵은 텍스트 강조', exact: true });
  await expect(advice).toBeVisible();
  await advice.scrollIntoViewIfNeeded();
  await expect(advice).toBeInViewport({ ratio: 1 });
  const rectangles = await Promise.all(
    [weight, advice, emphasis].map((item) => item.boundingBox())
  );
  const [first, middle, last] = rectangles;
  expect(first!.y + first!.height).toBeLessThanOrEqual(middle!.y);
  expect(middle!.y + middle!.height).toBeLessThanOrEqual(last!.y);
  expect(Math.abs(first!.x - middle!.x)).toBeLessThan(1);
  expect(middle!.width).toBeLessThanOrEqual(first!.width + 1);
}
async function assertMetricLayout(page: Page) {
  const metrics = page.locator('.preset-card-metrics').filter({ visible: true });
  await expect(metrics.first()).toBeVisible();
  expect(
    await metrics.evaluateAll((elements) =>
      elements.every((element) => element.scrollWidth <= element.clientWidth)
    )
  ).toBe(true);
  expect(
    await metrics.evaluateAll((elements) =>
      elements.every((element) => {
        const box = element.getBoundingClientRect();
        return [...element.children].every((item) => {
          const rect = item.getBoundingClientRect();
          return rect.left >= box.left - 1 && rect.right <= box.right + 1;
        });
      })
    )
  ).toBe(true);
}
for (const scenario of [
  { width: 1440, zoom: 1 },
  { width: 390, zoom: 1 },
  { width: 1440, zoom: 2 },
]) {
  test(`weight advice and preset metrics stay readable across themebox, options and editor at ${scenario.width}px ${scenario.zoom * 100}%`, async () => {
    const page = await openViewer();
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await context.serviceWorkers()[0]!.evaluate(async (zoom) => {
      const tab = (await chrome.tabs.query({})).at(-1)!;
      await chrome.tabs.setZoom(tab.id!, zoom);
    }, scenario.zoom);
    await update({ fontWeight: 700 });
    await panel(page);
    await section(page, '텍스트');
    await assertAdviceLayout(page.getByTestId('settings-panel'));
    await captureViewport(page, 'themebox-weight-advice.png');
    await section(page, '프리셋');
    await assertMetricLayout(page);
    await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
    await assertAdviceLayout(page.getByRole('form', { name: '프리셋 편집', exact: true }));
    await captureViewport(page, 'themebox-editor-advice.png');

    const options = await context.newPage();
    await options.setViewportSize({ width: scenario.width, height: 900 });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.getByTestId('management-page')).toBeVisible();
    await context.serviceWorkers()[0]!.evaluate(async (zoom) => {
      const tab = (await chrome.tabs.query({})).at(-1)!;
      await chrome.tabs.setZoom(tab.id!, zoom);
    }, scenario.zoom);
    await section(options, '프리셋');
    await assertMetricLayout(options);
    await options.locator('.preset-card').first().scrollIntoViewIfNeeded();
    await captureViewport(options, 'options-preset-metrics.png');
    await section(options, '텍스트');
    await assertAdviceLayout(options.getByTestId('management-page'));
    await section(options, '프리셋');
    await options.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
    await assertAdviceLayout(options.getByRole('form', { name: '프리셋 편집', exact: true }));
    await captureViewport(options, 'options-editor-advice.png');
  });
}
