import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewerHtml } from '../tests/fixtures/viewer.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'store/assets');
const extension = path.join(root, '.output/chrome-mv3-e2e');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
if (!manifest.content_scripts?.some((script) => script.matches.includes('http://127.0.0.1/*')))
  throw new Error('Run npm run build:e2e before capturing synthetic store screenshots.');
await mkdir(output, { recursive: true });

// Original sample prose written for these screenshots. No novel is downloaded.
// Only fixture content changes; extension DOM, styles and controls are untouched.
const paragraphs = [
  '<b>창가의 기록</b>',
  '비가 그친 오후, 오래된 책방의 창문으로 따뜻한 빛이 들어왔다. 나는 마지막으로 남은 의자를 당겨 앉았다.',
  '책장을 펼치자 접어 둔 종이 한 장이 바닥으로 떨어졌다. 종이에는 작은 지도와 함께 짧은 문장이 적혀 있었다.',
  '“길을 잃었다면, 가장 조용한 곳에서 다시 시작해.”',
  '창밖으로 보이는 골목은 평소와 다르지 않았다. 빵집의 간판이 흔들리고, 학교에서 돌아오는 아이들의 웃음소리가 들렸다.',
  '나는 <b>지도의 첫 번째 표시</b>를 손가락으로 짚었다. 책방 바로 옆, 아무도 들어가지 않던 작은 정원이었다.',
  '&nbsp;',
  '문을 열자 젖은 흙 냄새가 났다. 담장 너머에는 생각보다 넓은 길이 이어져 있었다.',
  '한 걸음씩 천천히 걸었다. 서두를 이유는 없었다. 오늘의 이야기는 이제 막 시작되고 있었으니까.',
  '가끔 멈춰 서서 지나온 길을 돌아보았다. 익숙한 곳에도 아직 발견하지 못한 풍경이 남아 있었다.',
  '나는 주머니에서 수첩을 꺼냈다. 잊고 싶지 않은 장면을 한 줄씩 적어 두기로 했다.',
  '&nbsp;',
  '길 끝에는 작은 벤치가 있었다. 먼저 도착한 고양이 한 마리가 햇볕 아래서 느긋하게 눈을 감고 있었다.',
  '지도에 그려진 나무도 그곳에 있었다. 오래된 가지에는 종이로 만든 별들이 매달려 바람에 살랑거렸다.',
  '별 하나를 펼쳐 보니 누군가의 소원이 적혀 있었다. 다른 별에는 여행에서 돌아온 사람이 남긴 짧은 인사가 있었다.',
  '나는 빈 종이를 골라 오늘 발견한 풍경을 적었다. 그리고 가장 낮은 가지에 조심스럽게 걸어 두었다.',
  '&nbsp;',
  '책방으로 돌아왔을 때에는 창가에 긴 그림자가 드리워져 있었다. 펼쳐 둔 책은 여전히 같은 페이지에서 나를 기다리고 있었다.',
];
const fixture = viewerHtml()
  .replace(
    /function textLines\(\)\{[\s\S]*?\}\r?\nfunction viewer_display/,
    `function textLines(){return Array.from({length:120},(_,i)=>${JSON.stringify(paragraphs)}[i%${paragraphs.length}]);}\nfunction viewer_display`
  )
  .replace('회귀 테스트 · 합성 본문', '창가의 기록 · 합성 체험 본문')
  .replace('보존해야 하는 테스트 광고', '서비스 영역 · 합성 예시');

const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), 'unp-store-assets-'));
let context;
const errors = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByTestId('management-page')).toBeVisible();

  async function settings(patch) {
    await worker.evaluate(async (patch) => {
      const key = 'unp.reader.v1';
      const stored = (await chrome.storage.sync.get(key))[key];
      await chrome.storage.sync.set({
        [key]: { schemaVersion: 1, data: { ...stored?.data, ...patch } },
      });
    }, patch);
  }
  async function settled(page) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  }
  async function capture(page, filename) {
    await settled(page);
    await page.mouse.move(1260, 780);
    await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
    console.log(`${filename}: 1280x800`);
  }

  await settings({
    fontFamily: 'system-ui',
    fontSize: 20,
    lineHeight: 180,
    paragraphGap: 8,
    paragraphSpacing: 24,
    maxWidth: 880,
    horizontalPadding: 32,
    verticalPadding: 24,
    pageNavigationPlacement: 'fixed',
    backgroundColor: '#F4F1F8',
    textAreaBackgroundColor: '#FFFFFF',
    textAreaOpacity: 100,
    textColor: '#282330',
    darkMode: false,
    autoRecommend: false,
  });
  const scroll = await context.newPage();
  await scroll.addInitScript(() => localStorage.setItem('viewer_paging', '0'));
  await scroll.goto(`${base}/viewer/1001`);
  await expect(scroll.locator('[data-unp-reader="scroll"]')).toBeVisible();
  await expect(scroll.locator('html')).not.toHaveAttribute('data-unp-preparing');
  await scroll.locator('#btn_theme').click();
  await expect(scroll.getByTestId('settings-panel')).toBeVisible();
  await capture(scroll, '01-reading-settings.png');
  await scroll.close();

  await settings({
    maxWidth: 540,
    horizontalPadding: 32,
    verticalPadding: 24,
    pageGap: 32,
    spreadMode: 'auto',
    backgroundColor: '#E8E2D8',
    textAreaBackgroundColor: '#F7F3E9',
    textColor: '#483D32',
    readerHeightPercent: 100,
  });
  const spread = await context.newPage();
  await spread.addInitScript(() => localStorage.setItem('viewer_paging', '1'));
  await spread.goto(`${base}/viewer/1002?terminal`);
  await expect(spread.locator('[data-unp-reader="page"]')).toBeVisible();
  await expect(spread.locator('#novel_drawing_page')).toHaveCSS('column-count', '2');
  await expect(spread.locator('html')).not.toHaveAttribute('data-unp-preparing');
  await expect(spread.locator('#unp-navigation-host')).toBeVisible();
  await capture(spread, '02-two-page-reading.png');
  await spread.close();

  await settings({ darkMode: true });
  await options
    .getByRole('navigation', { name: '관리 항목' })
    .getByRole('button', { name: '프리셋', exact: true })
    .click();
  await expect(options.getByRole('article', { name: '기본', exact: true })).toBeVisible();
  await capture(options, '03-presets.png');

  // A separate marketing tile uses the shipped brand icon and bundled UI font.
  // It is not presented as an application screenshot.
  const icon = await readFile(path.join(root, 'public/icons/icon192.png'));
  const font = await readFile(path.join(root, 'public/fonts/Freesentation-7Bold.woff2'));
  const tile = await context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.setContent(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>Novelpia Patch promo</title><style>
    @font-face{font-family:UI;src:url(data:font/woff2;base64,${font.toString('base64')});font-weight:700}
    *{box-sizing:border-box}body{margin:0;background:#251e34;color:#f6f2ff;font-family:UI,sans-serif}
    main{width:440px;height:280px;padding:28px 32px;display:flex;flex-direction:column;justify-content:space-between}
    header{display:flex;gap:16px;align-items:center}img{width:70px;height:70px}h1{font-size:30px;line-height:1.03;margin:0;letter-spacing:-.5px}small{display:block;color:#c5b5e0;font-size:12px;margin-top:7px}
    p{font-size:23px;line-height:1.4;margin:0;letter-spacing:-.4px}footer{color:#cabbe2;font-size:15px;border-top:1px solid #4b3e60;padding-top:13px}
    </style><main><header><img alt="" src="data:image/png;base64,${icon.toString('base64')}"><div><h1>Novelpia Patch</h1><small>COMMUNITY EXTENSION</small></div></header><p>내게 편안한 글꼴과 간격으로,<br>이야기에 집중하세요.</p><footer>글꼴 · 프리셋 · 스크롤과 페이지 읽기</footer></main></html>`);
  await tile.evaluate(() => document.fonts.ready);
  await tile.screenshot({ path: path.join(output, 'promo-440x280.png') });
  console.log('promo-440x280.png: 440x280');
  if (errors.length) throw new Error(`Capture runtime errors: ${errors.join('; ')}`);
  const filenames = [
    '01-reading-settings.png',
    '02-two-page-reading.png',
    '03-presets.png',
    'promo-440x280.png',
  ];
  for (const filename of filenames) {
    const bytes = await readFile(path.join(output, filename));
    const expected = filename.startsWith('promo-') ? [440, 280] : [1280, 800];
    if (bytes.readUInt32BE(16) !== expected[0] || bytes.readUInt32BE(20) !== expected[1])
      throw new Error(`Unexpected screenshot dimensions: ${filename}`);
  }
  await writeFile(
    path.join(output, 'README.md'),
    `# 스토어 등록 이미지\n\n버전 ${manifest.version}의 실제 확장을 격리된 MV3 Chromium에서 촬영했습니다.\n\n- \`01-reading-settings.png\`: 스크롤 읽기에서 연 테마박스, 1280×800\n- \`02-two-page-reading.png\`: 두 쪽 페이지 읽기와 진행바, 1280×800\n- \`03-presets.png\`: 설정 페이지의 실제 프리셋 갤러리, 1280×800\n- \`promo-440x280.png\`: 배포 아이콘과 동봉 글꼴로 조합한 홍보 이미지, 440×280\n\n세 기능 화면은 합성 본문과 서비스 UI fixture에 확장을 실행한 화면입니다. 노벨피아 작품·계정 정보·실제 광고를 수집하지 않았습니다. 본문은 촬영용으로 작성했으며 원사이트 디자인을 정확히 재현한 화면은 아닙니다. 홍보 이미지를 제외한 기능 화면에는 합성된 UI나 사후 보정을 넣지 않았습니다.\n\n## 다시 만들기\n\n프로젝트 의존성과 Playwright Chromium 설치 후 저장소 루트에서 실행합니다.\n\n\`\`\`sh\nnpm run build:e2e\nnode scripts/store-assets.mjs\n\`\`\`\n\n결과는 이 디렉터리에만 저장합니다. 브라우저 프로필은 임시 폴더에 만들고 종료 시 삭제합니다. UI 글꼴은 확장에 동봉된 파일을 사용하며, 프리셋의 독서용 웹글꼴은 앱의 실제 로더가 요청합니다. 네트워크 실패 시 대체 글꼴이 보일 수 있으므로 생성 후 화면을 확인해야 합니다. 이 자료는 심사 제출이나 승인을 의미하지 않습니다.\n`,
    'utf8'
  );
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await removeTemporaryProfile(profile);
}

async function removeTemporaryProfile(profile) {
  const resolved = path.resolve(profile);
  const prefix = path.join(path.resolve(tmpdir()), 'unp-store-assets-');
  if (!resolved.startsWith(prefix)) throw new Error('Unexpected temporary profile path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
