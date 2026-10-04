import { launchReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { defaults } from '../../src/shared/model/preferences';
import type { UserFont } from '../../src/shared/model/user-font';
// @ts-expect-error Synthetic fixture, without novel text or site API calls.
import { viewerHtml } from '../fixtures/viewer.mjs';

test.use({ actionTimeout: 15_000 });

let server: http.Server;
let base: string;
let context: BrowserContext;
let profile: string;
let extensionId: string;
const regular = path.resolve('public/fonts/Freesentation-4Regular.woff2');
const medium = path.resolve('public/fonts/Freesentation-5Medium.woff2');
const bold = path.resolve('public/fonts/Freesentation-7Bold.woff2');

test.beforeAll(async () => {
  server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(viewerHtml());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-user-fonts-'));
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
  if (path.resolve(profile).startsWith(path.join(tmpdir(), 'unp-user-fonts-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function section(page: Page, name: string) {
  const button = page
    .getByRole('navigation', { name: '관리 항목' })
    .getByRole('button', { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}

async function options(fonts = true) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: '홈', exact: true })).toBeVisible();
  if (fonts) {
    await section(page, '사용자 글꼴');
    await expect(page.getByRole('button', { name: '파일 선택', exact: true })).toBeEnabled();
  }
  return page;
}

async function library(page: Page): Promise<UserFont[]> {
  return page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({
      channel: 'unp.user-fonts.v1',
      action: 'list',
    });
    if (!response?.ok) throw new Error(response?.error || 'Font library did not respond');
    return response.data;
  });
}

async function register(page: Page, name = '내 읽기 글꼴', files = [regular, bold]) {
  await page.getByLabel('사용자 글꼴 파일', { exact: true }).setInputFiles(files);
  await expect(page.locator('.font-family-editor')).toHaveCount(1);
  await expect(page.locator('.font-library-drafts .font-face-list li')).toHaveCount(files.length);
  await page.getByRole('textbox', { name: '표시 이름', exact: true }).fill(name);
  await page.getByRole('button', { name: '글꼴 저장', exact: true }).click();
  await expect(page.locator('.font-library-drafts')).toHaveCount(0);
  await expect(
    page.locator('.registered-font').getByRole('heading', { name, exact: true })
  ).toBeVisible();
  return (await library(page))[0]!;
}

async function updateSettings(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(
    async ({ patch, initial }) => {
      const raw = await chrome.storage.sync.get('unp.reader.v1');
      const stored = raw['unp.reader.v1'] as { data: Record<string, unknown> } | undefined;
      await chrome.storage.sync.set({
        'unp.reader.v1': { schemaVersion: 1, data: { ...initial, ...stored?.data, ...patch } },
      });
    },
    { patch, initial: defaults }
  );
}

async function chooseFont(page: Page, name: string) {
  await page.getByRole('button', { name: '글꼴 선택', exact: true }).click();
  await page
    .getByRole('group', { name: '글꼴 분류', exact: true })
    .getByRole('button', { name: '사용자', exact: true })
    .click();
  const option = page
    .locator('.font-option')
    .filter({ has: page.getByText(name, { exact: true }) });
  await expect(option).toBeVisible();
  await expect(option.locator('.font-weight-tag')).toHaveText(['400', '700']);
  await option.click();
}

test('registration groups actual WOFF2 faces, preserves drafts and updates names across options pages', async () => {
  const page = await options();
  await page.getByLabel('사용자 글꼴 파일', { exact: true }).setInputFiles([regular, bold]);
  await expect(page.locator('.font-family-editor')).toHaveCount(1);
  await expect(page.locator('.font-family-editor legend')).toHaveText('프리젠테이션');
  await expect(page.locator('.font-library-drafts .font-weight-tag')).toHaveText(['400', '700']);
  expect(await library(page)).toEqual([]);
  await page.getByRole('textbox', { name: '표시 이름', exact: true }).fill('두께를 묶은 글꼴');
  await section(page, '홈');
  await section(page, '사용자 글꼴');
  await expect(page.getByRole('textbox', { name: '표시 이름', exact: true })).toHaveValue(
    '두께를 묶은 글꼴'
  );
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page
    .getByRole('dialog', { name: '글꼴 변경 취소', exact: true })
    .getByRole('button', { name: '변경 버리기', exact: true })
    .click();
  await expect(page.locator('.font-family-editor')).toHaveCount(0);
  expect(await library(page)).toEqual([]);

  const font = await register(page, '두께를 묶은 글꼴');
  expect(font.faces.map((face) => face.weight)).toEqual([400, 700]);
  expect(font.faces.every((face) => !face.variable && face.style === 'normal')).toBe(true);
  const other = await options();
  await expect(other.locator('.registered-font h3')).toHaveText('두께를 묶은 글꼴');
  await page.locator('.registered-font').getByRole('button', { name: '수정', exact: true }).click();
  await page.getByRole('textbox', { name: '표시 이름', exact: true }).fill('이름을 바꾼 글꼴');
  await page.getByRole('button', { name: '글꼴 저장', exact: true }).click();
  await expect(other.locator('.registered-font h3')).toHaveText('이름을 바꾼 글꼴');
  expect((await library(page))[0]!.id).toBe(font.id);
  await page.getByLabel('사용자 글꼴 파일', { exact: true }).setInputFiles(medium);
  await expect(page.locator('.font-library-drafts .font-weight-tag')).toHaveText([
    '400',
    '700',
    '500',
  ]);
  await page.getByRole('button', { name: '글꼴 저장', exact: true }).click();
  await expect(other.locator('.registered-font .font-weight-tag')).toHaveText([
    '400',
    '500',
    '700',
  ]);
  expect((await library(other))[0]!.id).toBe(font.id);
  await expect(page.getByRole('button', { name: '파일 선택', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '알림 닫기', exact: true }).click();
  await updateSettings(page, { darkMode: true });
  await expect(page.getByTestId('management-page')).toHaveClass(/dark/);
  await page.screenshot({
    path: test.info().outputPath('user-fonts-desktop-dark.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: test.info().outputPath('user-fonts-390.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('a selected local font paints body and author emphasis and persists as a preset reference', async () => {
  const page = await options();
  const font = await register(page);
  await section(page, '텍스트');
  await chooseFont(page, '내 읽기 글꼴');
  const viewer = await context.newPage();
  await viewer.goto(`${base}/viewer/1001?controls`);
  await expect(viewer.locator('[data-unp-reader="scroll"]')).toBeVisible();
  await expect(viewer.locator('html')).not.toHaveAttribute('data-unp-preparing');
  const line = viewer.locator('#novel_drawing [data-unp-line]').nth(1);
  await expect(line).toHaveCSS('font-family', new RegExp(font.id));
  await expect(line).toHaveCSS('font-weight', '400');
  await expect(viewer.locator('#novel_drawing b').first()).toHaveCSS('font-weight', '700');
  await expect
    .poll(() =>
      viewer.evaluate(
        (id) =>
          [...document.fonts]
            .filter((face) => face.family === id && face.status === 'loaded')
            .map((face) => face.weight)
            .sort(),
        font.id
      )
    )
    .toEqual(['400', '700']);
  // The custom family must actually draw glyphs, not merely appear in a CSS string.
  const cdp = await context.newCDPSession(viewer);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: '#novel_drawing [data-unp-line]',
  });
  const painted = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: nodeIds[1]! });
  expect(painted.fonts.some((face) => face.isCustomFont && face.glyphCount > 0)).toBe(true);
  await cdp.detach();
  await viewer.reload();
  await expect(viewer.locator('#novel_drawing [data-unp-line]').nth(1)).toHaveCSS(
    'font-family',
    new RegExp(font.id)
  );
  await expect(viewer.locator('html')).not.toHaveAttribute('data-unp-preparing');

  await section(page, '프리셋');
  await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
  await page
    .getByRole('form', { name: '프리셋 편집', exact: true })
    .getByRole('textbox', { name: '이름', exact: true })
    .fill('로컬 글꼴 프리셋');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('article', { name: '로컬 글꼴 프리셋', exact: true })).toBeVisible();
  await section(page, '설정 파일');
  await page.getByRole('button', { name: 'JSON 보기', exact: true }).click();
  const exported = JSON.parse(
    await page.getByRole('textbox', { name: '내보내기 JSON', exact: true }).inputValue()
  );
  expect(exported.settings.fontFamily).toBe(font.id);
  expect(exported.presets[0].settings.fontFamily).toBe(font.id);
  expect(JSON.stringify(exported)).not.toContain('d09GMg');
  expect(JSON.stringify(exported).length).toBeLessThan(20_000);
  await section(page, '사용자 글꼴');
  await page.locator('.registered-font').getByRole('button', { name: '삭제', exact: true }).click();
  await page
    .getByRole('dialog', { name: '글꼴 삭제', exact: true })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('현재 읽기 설정');
  await expect(page.getByRole('alert')).toContainText('로컬 글꼴 프리셋');
  expect(await library(page)).toHaveLength(1);
});

test('duplicate weights and invalid files retain the draft and permit recovery without saving bad data', async () => {
  const page = await options();
  await page.getByLabel('사용자 글꼴 파일', { exact: true }).setInputFiles(regular);
  await expect(page.locator('.font-family-editor')).toHaveCount(1);
  // WOFF2 minorVersion changes the file identity without altering the actual font tables.
  // This produces two valid files advertising the same family and weight.
  const anotherVersion = Buffer.from(await readFile(regular));
  anotherVersion.writeUInt16BE((anotherVersion.readUInt16BE(26) + 1) % 65536, 26);
  await page.getByLabel('사용자 글꼴 파일', { exact: true }).setInputFiles({
    name: 'another-regular.woff2',
    mimeType: 'font/woff2',
    buffer: anotherVersion,
  });
  await expect(page.locator('.font-face-list li')).toHaveCount(2);
  await page.getByRole('button', { name: '글꼴 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('두께가 겹칩니다');
  await expect(page.locator('.font-face-list li')).toHaveCount(2);
  expect(await library(page)).toEqual([]);
  await page.getByRole('button', { name: 'another-regular.woff2 제외', exact: true }).click();
  await page.getByLabel('사용자 글꼴 파일', { exact: true }).setInputFiles({
    name: 'broken.woff2',
    mimeType: 'font/woff2',
    buffer: Buffer.from('This is not a font file.'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.font-face-list li')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '글꼴 저장', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '글꼴 저장', exact: true }).click();
  await expect(page.locator('.font-library-drafts')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await library(page))[0]!.faces.map((face) => face.weight)).toEqual([400]);
  await page.locator('.registered-font').getByRole('button', { name: '삭제', exact: true }).click();
  await page
    .getByRole('dialog', { name: '글꼴 삭제', exact: true })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await expect(page.locator('.registered-font')).toHaveCount(0);
  expect(await library(page)).toEqual([]);
});

test('a competing family edit reports a conflict and preserves the unsaved name', async () => {
  const page = await options();
  await register(page);
  const other = await options();
  for (const editor of [page, other])
    await editor
      .locator('.registered-font')
      .getByRole('button', { name: '수정', exact: true })
      .click();
  await page.getByRole('textbox', { name: '표시 이름', exact: true }).fill('먼저 저장한 이름');
  await other
    .getByRole('textbox', { name: '표시 이름', exact: true })
    .fill('아직 저장하지 않은 이름');
  await page.getByRole('button', { name: '글꼴 저장', exact: true }).click();
  await expect(other.locator('.registered-font h3')).toHaveText('먼저 저장한 이름');
  await other.getByRole('button', { name: '글꼴 저장', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('다른 창에서 글꼴이 변경되었습니다');
  await expect(other.getByRole('textbox', { name: '표시 이름', exact: true })).toHaveValue(
    '아직 저장하지 않은 이름'
  );
  expect((await library(page))[0]!.displayName).toBe('먼저 저장한 이름');
});

test('an injected IndexedDB write failure preserves the draft and previous files until retry succeeds', async () => {
  const page = await options();
  await register(page, '기존 글꼴', [regular]);
  await page.getByRole('button', { name: '알림 닫기', exact: true }).click();
  const before = await library(page);
  await page.getByLabel('사용자 글꼴 파일', { exact: true }).setInputFiles(bold);
  await expect(page.locator('.font-library-drafts .font-face-list li')).toHaveCount(2);
  await page.getByRole('textbox', { name: '표시 이름', exact: true }).fill('저장할 글꼴 이름');
  const worker = context.serviceWorkers()[0]!;
  // Deterministic failure injection in this isolated extension worker, not a full-disk test.
  await worker.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    const scope = globalThis as unknown as { restoreFontTransaction?: () => void };
    scope.restoreFontTransaction = () => {
      IDBDatabase.prototype.transaction = original;
    };
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const [stores, mode] = args;
      const names = typeof stores === 'string' ? [stores] : Array.from(stores);
      if (this.name === 'unp-user-fonts' && mode === 'readwrite' && names.includes('fonts')) {
        IDBDatabase.prototype.transaction = original;
        throw new DOMException('합성 검사: 글꼴 저장 공간이 부족합니다.', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  try {
    await page.getByRole('button', { name: '글꼴 저장', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('합성 검사: 글꼴 저장 공간이 부족합니다.');
    await expect(page.getByRole('textbox', { name: '표시 이름', exact: true })).toHaveValue(
      '저장할 글꼴 이름'
    );
    await expect(page.locator('.font-library-drafts .font-face-list li')).toHaveCount(2);
    await expect(page.locator('.registered-font h3')).toHaveText('기존 글꼴');
    await expect(page.getByRole('status').filter({ hasText: '글꼴을 등록했습니다.' })).toHaveCount(
      0
    );
    expect(await library(page)).toEqual(before);
  } finally {
    await worker.evaluate(() => {
      const scope = globalThis as unknown as { restoreFontTransaction?: () => void };
      scope.restoreFontTransaction?.();
      delete scope.restoreFontTransaction;
    });
  }
  await page.getByRole('button', { name: '글꼴 저장', exact: true }).click();
  await expect(page.locator('.font-library-drafts')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.registered-font h3')).toHaveText('저장할 글꼴 이름');
  const after = await library(page);
  expect(after[0]!.id).toBe(before[0]!.id);
  expect(after[0]!.faces.map((face) => face.weight)).toEqual([400, 700]);
  expect(after[0]!.faces[0]!.id).toBe(before[0]!.faces[0]!.id);
});

test('a missing font reference falls back and recovers on re-registration without losing the saved choice', async () => {
  const page = await options();
  const font = await register(page);
  await page.locator('.registered-font').getByRole('button', { name: '삭제', exact: true }).click();
  await page
    .getByRole('dialog', { name: '글꼴 삭제', exact: true })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await expect(page.locator('.registered-font')).toHaveCount(0);
  // An imported settings file can refer to a font whose binary is not in this browser.
  await updateSettings(page, { fontFamily: font.id });
  await section(page, '텍스트');
  await expect(
    page
      .getByRole('group', { name: '글꼴', exact: true })
      .getByText('이 브라우저에 글꼴 파일이 없습니다.', { exact: false })
  ).toBeVisible();
  const viewer = await context.newPage();
  await viewer.goto(`${base}/viewer/1001`);
  await expect(viewer.locator('[data-unp-reader="scroll"]')).toBeVisible();
  await expect(viewer.locator('html')).not.toHaveAttribute('data-unp-preparing');
  await expect(viewer.locator('#novel_drawing [data-unp-line]').nth(1)).toHaveCSS(
    'font-family',
    'system-ui, sans-serif'
  );
  const manager = await options();
  const restored = await register(manager, '다시 등록한 글꼴');
  expect(restored.id).toBe(font.id);
  await expect(page.getByRole('button', { name: '글꼴 선택', exact: true })).toContainText(
    '다시 등록한 글꼴'
  );
  await expect(viewer.locator('#novel_drawing [data-unp-line]').nth(1)).toHaveCSS(
    'font-family',
    new RegExp(font.id)
  );
  await expect
    .poll(() =>
      viewer.evaluate(
        (id) => [...document.fonts].some((face) => face.family === id && face.status === 'loaded'),
        font.id
      )
    )
    .toBe(true);
  await section(manager, '기타');
  await manager.getByRole('button', { name: '설정 초기화', exact: true }).click();
  await manager
    .getByRole('dialog', { name: '읽기 설정 초기화', exact: true })
    .getByRole('button', { name: '기본값으로 초기화', exact: true })
    .click();
  await expect(
    manager.getByRole('status').filter({ hasText: '읽기 설정을 초기화했습니다' })
  ).toBeVisible();
  expect((await library(manager))[0]!.id).toBe(font.id);
});

test('home and popup defer the font management screen until it is requested', async () => {
  const page = await options(false);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('button', { name: '설정 열기', exact: true })).toBeVisible();
  // Chrome does not expose all extension module requests as ResourceTiming entries.
  // Debugger.scriptParsed includes already-loaded scripts when the domain is enabled.
  const scripts = new Set<string>();
  const sessions = [];
  for (const surface of [page, popup]) {
    const session = await context.newCDPSession(surface);
    session.on('Debugger.scriptParsed', (script) => scripts.add(script.url));
    await session.send('Debugger.enable');
    sessions.push(session);
  }
  expect([...scripts].some((url) => /user-font-panel|parse-font|fontkit/.test(url))).toBe(false);
  await section(page, '사용자 글꼴');
  await expect(page.getByRole('button', { name: '파일 선택', exact: true })).toBeEnabled();
  await expect.poll(() => [...scripts].some((url) => /user-font-panel/.test(url))).toBe(true);
  await Promise.all(sessions.map((session) => session.detach()));
});
