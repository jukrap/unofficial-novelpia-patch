import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewerHtml } from '../tests/fixtures/viewer.mjs';
import { artworkResources, posterHtml, promoHtml } from './store-artwork.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'store/assets');
const rawOutput = path.join(root, 'test-results/store-captures');
const extension = path.join(root, '.output/chrome-mv3');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
if (!manifest.content_scripts?.some((s) => s.matches.includes('https://novelpia.com/viewer/*')))
  throw new Error('Run pnpm run build: production MV3 is required for store captures.');
await Promise.all([mkdir(output, { recursive: true }), mkdir(rawOutput, { recursive: true })]);

// Original fictional prose. The fixture provides only the host page; the shipped
// extension renders every reading surface, control, gallery and font preview.
const paragraphs = [
  '비가 그친 뒤에야 우편함이 눈에 들어왔다.',
  '골목 끝의 작은 책방 앞이었다. 어제까지 아무것도 없던 벽에 파란 우편함 하나가 걸려 있었다. 젖은 나무 냄새 사이로, 막 끓인 차의 향이 흘러나왔다.',
  '“그 편지는 이름이 없는 사람에게만 와요.”',
  '책방 주인이 문에 기대어 말했다. 나는 우편함에서 손을 떼고 돌아섰다. 그녀의 손에는 접힌 종이 대신 오래된 열쇠가 들려 있었다.',
  '“제 이름을 모르시잖아요.”',
  '“그러니까 아직 받을 수 있죠.”',
  '&nbsp;',
  '봉투에는 주소도 우표도 없었다. 대신 작은 등대가 그려져 있었다. 바다가 없는 이 도시에서 등대라니.',
  '종이 속 불빛이 한 번 깜박였다.',
  '잠깐의 착각이라고 하기에는 너무 선명했다. 주인은 놀라지도 않고 열쇠를 내 손에 쥐여 주었다. 손바닥에 닿은 금속은 햇볕을 받은 돌처럼 따뜻했다.',
  '“<b>오늘 해가 지기 전에</b> 다녀와요. 늦으면 길이 조금 달라지거든.”',
  '내가 다시 물으려는 순간, 책방 안쪽에서 종소리가 났다. 벽시계는 세 시를 가리켰지만 종은 여섯 번 울렸다.',
  '&nbsp;',
  '책장 사이에는 어른 한 사람이 겨우 지날 만한 문이 있었다. 열쇠를 넣자 문틈으로 소금기 어린 바람이 밀려왔다.',
  '문 너머의 계단은 아래로 이어졌다. 나는 봉투를 주머니 깊이 넣고 첫 번째 돌계단을 밟았다. 신발 아래에서 모래가 작게 바스러졌다.',
  '낮게 깔린 구름 아래로 바다가 보였다.',
  '방금 전까지 빗물 고인 골목에 서 있었는데, 이제는 파도 소리가 귓가를 채웠다. 멀리 등대 하나가 흰 선처럼 서 있었다. 봉투에 그려진 것과 같은 등대였다.',
  '나는 뒤를 돌아보았다. 책방 문은 아직 거기에 있었다. 주인은 문가에 작은 의자를 가져다 놓고 책을 펴고 있었다.',
  '“돌아갈 길은 기억하지 않아도 돼요.”',
  '그녀는 책에서 눈을 떼지 않은 채 덧붙였다.',
  '“돌아오고 싶은 이유만 잊지 않으면.”',
  '&nbsp;',
  '해변에는 발자국이 하나도 없었다. 멀리서 누군가 손을 흔드는 것 같았다. 나는 편지를 다시 꺼냈다. 비어 있던 봉투 위에, 조금 전에는 없던 문장이 천천히 나타나고 있었다.',
  '기다리고 있었습니다.',
  '이상하게도 무섭지는 않았다. 나는 젖은 소매를 걷고 등대 쪽으로 걸었다. 처음 보는 길인데도 오래전에 약속한 장소를 찾아가는 기분이었다.',
  '파도는 내 걸음보다 조금 느리게 밀려왔다. 그 속도에 맞추어 걷다 보니, 멀리 있던 불빛이 어느새 손에 잡힐 듯 가까워져 있었다.',
];
const fixture = viewerHtml()
  .replace(
    /function textLines\(\)\{[\s\S]*?\}\r?\nfunction viewer_display/,
    `function textLines(){return Array.from({length:104},(_,i)=>${JSON.stringify(paragraphs)}[i%${paragraphs.length}]);}\nfunction viewer_display`
  )
  .replace('회귀 테스트 · 합성 본문', '이름 없는 편지 · 촬영용 예시')
  // Keep the fixture's service marker in its native footer, outside the reader capture.
  .replace(
    '#test-banner{position:fixed;right:2px;bottom:60px;',
    '#test-banner{position:fixed;right:2px;bottom:0px;'
  )
  .replace('보존해야 하는 테스트 광고', '서비스 영역');
const profile = await mkdtemp(path.join(tmpdir(), 'unp-store-assets-'));
let context;
const errors = [];
const images = [];
const resources = await artworkResources(root);
async function removeCaptureProfile() {
  const resolved = path.resolve(profile);
  if (!resolved.startsWith(path.join(path.resolve(tmpdir()), 'unp-store-assets-')))
    throw new Error('Unexpected profile path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  // Production match patterns are exercised without fetching any real novel.
  await context.route('https://novelpia.com/viewer/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: fixture,
    })
  );
  // These are the exact shipped Freesentation faces, not a substitute font.
  await context.route(
    /https:\/\/cdn\.jsdelivr\.net\/gh\/Freesentation\/.*\.woff2$/,
    async (route) => {
      const filename = new URL(route.request().url()).pathname.split('/').at(-1);
      await route.fulfill({
        contentType: 'font/woff2',
        body: await readFile(path.join(root, 'public/fonts', filename)),
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  );
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html#/home`);
  await expect(options.getByTestId('management-page')).toBeVisible();
  const defaults = await worker.evaluate(
    async () => (await chrome.storage.sync.get('unp.reader.v1'))['unp.reader.v1'].data
  );
  async function settings(patch) {
    await worker.evaluate(
      async (data) => chrome.storage.sync.set({ 'unp.reader.v1': { schemaVersion: 1, data } }),
      {
        ...defaults,
        fontFamily: 'Freesentation',
        fontSize: 20,
        fontWeight: 400,
        boldTextStyle: 'none',
        lineHeight: 175,
        paragraphSpacing: 18,
        paragraphGap: 7,
        autoRecommend: false,
        pageEffect: 'none',
        pageNavigationPlacement: 'fixed',
        ...patch,
      }
    );
  }
  async function settled(page) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  async function reader(patch, width = 1200, height = 730) {
    await settings(patch);
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.goto('https://novelpia.com/viewer/1001?terminal');
    await expect(page.locator(`[data-unp-reader="${patch.readingMode}"]`)).toBeVisible();
    await expect(page.locator('html[data-unp-preparing]')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('[data-unp-reader] .line').first()).toHaveCSS(
      'visibility',
      'visible'
    );
    await expect(page.locator('#unp-reader-loading')).toHaveCount(0);
    await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
    await settled(page);
    return page;
  }
  async function raw(page, name, clip) {
    const bytes = await page.screenshot({ ...(clip ? { clip } : {}), animations: 'disabled' });
    await writeFile(path.join(rawOutput, name), bytes);
    return bytes;
  }
  async function readingScene(page, name, surround = 0) {
    const paper = await page.locator('#novel_drawing_page_c').boundingBox();
    const navigation = await page.locator('#unp-navigation-host').boundingBox();
    if (!paper || !navigation) throw new Error('Reading scene is not ready');
    const left = Math.min(paper.x, navigation.x) - 8 - surround;
    const top = Math.min(paper.y, navigation.y) - 8;
    const right = Math.max(paper.x + paper.width, navigation.x + navigation.width) + 8 + surround;
    const bottom = Math.max(paper.y + paper.height, navigation.y + navigation.height) + 8;
    const clip = { x: left, y: top, width: right - left, height: bottom - top };
    const viewport = page.viewportSize();
    if (left < 0 || top < 0 || right > viewport.width || bottom > viewport.height)
      throw new Error('Reading scene would be clipped');
    const marker = await page.locator('#test-banner').boundingBox();
    if (
      marker &&
      marker.x < right &&
      marker.x + marker.width > left &&
      marker.y < bottom &&
      marker.y + marker.height > top
    )
      throw new Error('Fixture service marker overlaps the reader capture');
    return raw(page, name, clip);
  }
  async function poster(name, config) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(posterHtml(resources, config));
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await page.screenshot({ path: path.join(output, name) });
    images.push(name);
    await page.close();
  }

  const spread = await reader({
    readingMode: 'page',
    spreadMode: 'auto',
    maxWidth: 530,
    horizontalPadding: 38,
    verticalPadding: 28,
    pageGap: 32,
    readerHeightPercent: 100,
    backgroundColor: '#E9E2D6',
    textAreaBackgroundColor: '#FFFBF2',
    textColor: '#433A30',
    textAreaOpacity: 100,
  });
  await expect(spread.locator('[data-unp-reader]')).toHaveCSS('column-count', '2');
  const spreadImage = await readingScene(spread, 'reading.png');
  await poster('01-reading.png', {
    label: '01 / 읽기 방식',
    title: '읽는 방식부터, 내 취향대로.',
    description: '익숙한 스크롤도, 책처럼 펼친 두 쪽도. 화면에 맞는 너비와 여백을 찾아보세요.',
    image: spreadImage,
  });
  await spread.close();

  const text = await reader(
    {
      readingMode: 'scroll',
      maxWidth: 900,
      backgroundColor: '#F2EDF8',
      textAreaBackgroundColor: '#FFFFFF',
      textColor: '#25212D',
      darkMode: false,
    },
    1200,
    960
  );
  await text.locator('#btn_theme').click();
  await expect(text.getByTestId('settings-panel')).toBeVisible();
  await settled(text);
  const panelImage = await text
    .getByTestId('settings-panel')
    .screenshot({ animations: 'disabled' });
  await writeFile(path.join(rawOutput, 'typography.png'), panelImage);
  await poster('02-typography.png', {
    aside: true,
    label: '02 / 글꼴과 간격',
    title: '한 줄의 길이도,<br>문장의 호흡도.',
    description:
      '글꼴과 두께부터<br>줄·문단·빈 줄 간격까지.<br><br>미리 보며 조절하고,<br>바로 읽어보세요.',
    image: panelImage,
  });
  await text.close();

  await settings({ darkMode: true, readingMode: 'scroll' });
  await options.setViewportSize({ width: 1300, height: 1100 });
  await options.goto(`chrome-extension://${id}/options.html#/presets`);
  const first = options.getByRole('article', { name: '밝은 돌빛', exact: true });
  await first.scrollIntoViewIfNeeded();
  const cards = ['밝은 돌빛', '옅은 녹색', '짙은 청회색', '차분한 보라'].map((name) =>
    options.getByRole('article', { name, exact: true })
  );
  for (const card of cards) {
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.preview-image-layer')).toHaveCSS('opacity', '1');
  }
  await first.scrollIntoViewIfNeeded();
  await settled(options);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  const left = Math.min(...boxes.map((b) => b.x)),
    top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width)),
    bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const gallery = await raw(options, 'presets.png', {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
  await poster('03-presets.png', {
    dark: true,
    aside: true,
    label: '03 / 프리셋',
    title: '편한 설정을<br>찾았다면,<br>저장해두세요.',
    description:
      '10가지 기본 프리셋에서 시작해<br>내 설정으로 편집하고 복제하세요.<br><br>읽기 방식과 배치도<br>함께 기억합니다.',
    image: gallery,
  });

  const imageReader = await reader({
    readingMode: 'page',
    spreadMode: 'single',
    maxWidth: 740,
    horizontalPadding: 52,
    verticalPadding: 30,
    readerHeightPercent: 85,
    darkMode: true,
    textColor: '#F3EDF7',
    backgroundColor: '#322B40',
    textAreaBackgroundColor: '#211C2A',
    textAreaOpacity: 92,
    backgroundType: 'image',
    backgroundImageSource: 'builtin',
    backgroundAssetId: 'muted-plum',
    overlayOpacity: 0,
  });
  await expect(imageReader.locator('[data-unp-background]')).toHaveCSS('opacity', '1');
  const backgroundImage = await readingScene(imageReader, 'background.png', 120);
  await poster('04-backgrounds.png', {
    dark: true,
    label: '04 / 색상과 배경',
    title: '오늘의 이야기에 어울리는 분위기.',
    description: '밝게, 어둡게, 또는 내 이미지로. 본문과 바깥 배경은 따로 조절하세요.',
    image: backgroundImage,
  });
  await imageReader.close();

  await settings({ darkMode: false, readingMode: 'scroll' });
  await options.setViewportSize({ width: 1240, height: 900 });
  await options.goto(`chrome-extension://${id}/options.html#/fonts`);
  await options
    .getByLabel('사용자 글꼴 파일', { exact: true })
    .setInputFiles([
      path.join(root, 'public/fonts/Freesentation-4Regular.woff2'),
      path.join(root, 'public/fonts/Freesentation-7Bold.woff2'),
    ]);
  await expect(options.locator('.font-family-editor')).toHaveCount(1);
  await options.getByRole('textbox', { name: '표시 이름', exact: true }).fill('나의 프리젠테이션');
  await options.getByRole('button', { name: '글꼴 저장', exact: true }).click();
  await expect(options.locator('.registered-font h3')).toHaveText('나의 프리젠테이션');
  await options.getByRole('button', { name: '알림 닫기', exact: true }).click();
  await settled(options);
  const fontImage = await options
    .locator('.management-content')
    .screenshot({ animations: 'disabled' });
  await writeFile(path.join(rawOutput, 'fonts.png'), fontImage);
  await poster('05-user-fonts.png', {
    aside: true,
    label: '05 / 사용자 글꼴',
    title: '좋아하는 글꼴을<br>가져오세요.',
    description:
      '이름과 지원 두께를 읽어<br>하나의 글꼴로 정리합니다.<br><br>등록 파일은<br>이 브라우저에 보관됩니다.',
    image: fontImage,
    inset: true,
  });

  const tile = await context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.setContent(promoHtml(resources));
  await tile.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await tile.screenshot({ path: path.join(output, 'promo-440x280.png') });
  images.push('promo-440x280.png');
  if (errors.length) throw new Error(`Capture runtime errors: ${errors.join('; ')}`);
  for (const filename of images) {
    const bytes = await readFile(path.join(output, filename));
    const expected = filename.startsWith('promo-') ? [440, 280] : [1280, 800];
    if (bytes.readUInt32BE(16) !== expected[0] || bytes.readUInt32BE(20) !== expected[1])
      throw new Error(`Invalid dimensions: ${filename}`);
  }
  await writeFile(
    path.join(rawOutput, 'capture.json'),
    JSON.stringify(
      {
        version: manifest.version,
        images,
        errors,
        source:
          'Production MV3, synthetic prose, unedited UI captures with external marketing framing',
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ version: manifest.version, images, errors }, null, 2));
} finally {
  await context?.close();
  await removeCaptureProfile();
}
