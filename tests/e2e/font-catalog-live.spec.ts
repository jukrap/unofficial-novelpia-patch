import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FONTS } from '../../src/shared/config/fontData';

// Live CDN checks are deliberately separate from the offline regression suite.
// Browser plugin not available; use the repository's Playwright MV3 Chromium setup.
test.skip(!process.env.UNP_FONTS_LIVE, 'Set UNP_FONTS_LIVE=1 to verify real remote font files.');
test.setTimeout(180_000);

const ids = new Set([
  'Freesentation',
  'MuseumCulturalFoundationClassic',
  'KimJeongCheolHandwriting',
  'Yeongdo',
  'JeonjuWanpanbon',
  'IncheonEducation',
  'NexonMaplestory',
  'RoundedFixedsys',
  'Shilla',
  'PyeojinGothic',
  'Soonbatang',
]);
const fonts = FONTS.filter((font) => ids.has(font.name));
const sample = '가나다라마바사 새로운 페이지를 읽습니다.';
let context: BrowserContext;
let profile: string;
let extensionId: string;

test.beforeAll(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-font-live-'));
  const extension = path.resolve('.output/chrome-mv3-e2e');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1504, height: 960 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (
    profile &&
    path.dirname(path.resolve(profile)) === path.resolve(tmpdir()) &&
    path.basename(profile).startsWith('unp-font-live-')
  )
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('all 37 new remote faces decode and render Korean in an extension-origin gallery', async () => {
  const page = await context.newPage();
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: '홈', exact: true })).toBeVisible();
  // This gallery checks browser decoding and actual glyph use, independently of FontLoader.
  await page.setContent(`<!doctype html><html lang="ko"><head>
    <title>글꼴 실물 검사 — 합성 문장</title><style>
    body { margin: 24px; color: #282828; background: #f7f7f3; font: 16px system-ui; }
    h1 { margin: 0 0 12px; font-size: 25px; } .legend { margin-bottom: 20px; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
    section { padding: 18px; border: 1px solid #ccc; background: white; border-radius: 8px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    .sample { margin: 12px 0; border-top: 1px solid #eee; padding-top: 8px; }
    .weight { font: 12px system-ui; color: #666; }
    .korean { display: block; font-size: 24px; line-height: 1.5; }
    .latin { display: block; font-size: 20px; line-height: 1.3; }
    </style></head><body><h1>새 본문 글꼴 11종 · 37개 굵기</h1>
    <p class="legend">Chromium · 실제 CDN 파일 · 합성 한글과 영문 · 한자 등 미지원 문자는 대체 글꼴</p>
    <main>${fonts
      .map(
        (font) =>
          `<section><h2>${font.displayName}</h2>${font.metadata.weights
            .map(
              (
                weight
              ) => `<div class="sample" style="font-family:'${font.name}';font-weight:${weight}">
              <span class="weight">${weight}</span>
              <span class="korean" id="sample-${font.name}-${weight}">${sample}</span>
              <span class="latin">Abc 0123, 漢字</span></div>`
            )
            .join('')}</section>`
      )
      .join('')}</main></body></html>`);
  await page.addStyleTag({ content: fonts.map((font) => font.urls[0]!.css).join('\n') });
  const decoded = await page.evaluate(
    async ({ fonts, sample }) =>
      Promise.all(
        fonts.flatMap((font) =>
          font.metadata.weights.map(async (weight) => {
            try {
              const faces = await document.fonts.load(`${weight} 24px "${font.name}"`, sample);
              return {
                id: font.name,
                weight,
                loaded: faces.map((face) => ({
                  family: face.family,
                  weight: face.weight,
                  status: face.status,
                })),
              };
            } catch (error) {
              return { id: font.name, weight, error: String(error), loaded: [] };
            }
          })
        )
      ),
    { fonts, sample }
  );
  expect(decoded).toHaveLength(37);
  for (const face of decoded) {
    expect(face.loaded, JSON.stringify(face)).toEqual([
      { family: face.id, weight: String(face.weight), status: 'loaded' },
    ]);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const rendered = [];
  for (const face of decoded) {
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `#sample-${face.id}-${face.weight}`,
    });
    const { fonts: platformFonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    rendered.push({ id: face.id, weight: face.weight, platformFonts });
    expect(
      platformFonts.some((font) => font.isCustomFont && font.glyphCount > 0),
      JSON.stringify(rendered.at(-1))
    ).toBe(true);
  }
  expect(page.url()).toBe(`chrome-extension://${extensionId}/options.html`);
  await expect(page).toHaveTitle('글꼴 실물 검사 — 합성 문장');
  await expect(page.locator('section')).toHaveCount(11);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await writeFile(
    test.info().outputPath('remote-font-faces.json'),
    JSON.stringify({ sample, decoded, rendered, errors, failedRequests }, null, 2)
  );
  await page.screenshot({
    path: test.info().outputPath('remote-font-gallery.png'),
    fullPage: true,
  });
  await page.close();
});

test('options selection invokes FontLoader for Freesentation, Incheon and all seven Pyeojin weights', async () => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page
    .getByRole('navigation', { name: '관리 항목', exact: true })
    .getByRole('button', { name: '텍스트', exact: true })
    .click();
  const trigger = page.getByRole('button', { name: '글꼴 선택', exact: true });
  for (const id of ['Freesentation', 'IncheonEducation', 'PyeojinGothic']) {
    const font = fonts.find((font) => font.name === id)!;
    await trigger.click();
    await page.getByRole('searchbox', { name: '글꼴 이름 검색' }).fill(font.displayName);
    await expect(page.locator('.font-option')).toHaveCount(1);
    await page.locator('.font-option').click();
    await expect(trigger).toContainText(font.displayName);
    const weights = id === 'Freesentation' ? [400, 700] : font.metadata.weights;
    for (const weight of weights) {
      await page.getByRole('combobox', { name: '글자 두께', exact: true }).click();
      const choices = page.getByRole('option');
      await expect(choices).toHaveCount(
        font.metadata.weights.length + (id === 'IncheonEducation' ? 1 : 0)
      );
      if (id === 'IncheonEducation')
        await expect(page.getByRole('option', { name: '강제로 굵게', exact: true })).toBeVisible();
      await page.getByRole('option', { name: new RegExp(`\\(${weight}\\)$`) }).click();
      await expect(trigger.locator('strong')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('.font-error')).not.toBeVisible();
      // Observe faces loaded by the application. Do not start an extra fonts.load here.
      await expect
        .poll(() =>
          page.evaluate(
            ({ id, weight }) =>
              [...document.fonts].some(
                (face) =>
                  face.family === id && face.weight === String(weight) && face.status === 'loaded'
              ),
            { id, weight }
          )
        )
        .toBe(true);
      await expect
        .poll(() =>
          context.serviceWorkers()[0]!.evaluate(async () => {
            const value = await chrome.storage.sync.get('unp.reader.v1');
            const settings = (
              value['unp.reader.v1'] as { data: { fontFamily: string; fontWeight: number } }
            ).data;
            return { id: settings.fontFamily, weight: settings.fontWeight };
          })
        )
        .toEqual({ id, weight });
    }
    await trigger.click();
    await expect(page.getByRole('dialog', { name: '글꼴 선택 목록', exact: true })).toHaveCSS(
      'opacity',
      '1'
    );
    await page.screenshot({ path: test.info().outputPath(`options-${id}.png`) });
    await page.keyboard.press('Escape');
  }
  await expect(page.getByTestId('management-page')).toHaveCSS(
    'font-family',
    /UNP UI Freesentation/
  );
  expect(errors).toEqual([]);
  await page.close();
});
