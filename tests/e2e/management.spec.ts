import { launchReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
// @ts-expect-error Synthetic source only, never bundled with the extension.
import { viewerHtml } from '../fixtures/viewer.mjs';

test.use({ actionTimeout: 15_000 });

let server: http.Server;
let base: string;
let context: BrowserContext;
let profile: string;
let extensionId: string;

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const episode = request.url?.match(/^\/viewer\/(\d+)/)?.[1] ?? '1001';
    const list = '<div id="list_box" style="display:none"><h2>합성 회차 목록</h2></div>';
    response.end(
      viewerHtml()
        .replace('id="content_no" value="1001"', `id="content_no" value="${episode}"`)
        .replace('</body>', `${list}</body>`)
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
  profile = await mkdtemp(path.join(tmpdir(), 'unp-management-'));
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
  if (path.resolve(profile).startsWith(path.join(tmpdir(), 'unp-management-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function openOptions() {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: '홈', exact: true })).toBeVisible();
  return page;
}

async function openViewer(episode = '1001') {
  const page = await context.newPage();
  await page.goto(`${base}/viewer/${episode}?controls`);
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  return page;
}

async function section(page: Page, name: string) {
  const button = page
    .getByRole('navigation', { name: '관리 항목', exact: true })
    .getByRole('button', { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}

async function updateSettings(patch: Record<string, unknown>) {
  await context.serviceWorkers()[0]!.evaluate(async (patch) => {
    const { ['unp.reader.v1']: value } = await chrome.storage.sync.get('unp.reader.v1');
    Object.assign((value as { data: Record<string, unknown> }).data, patch);
    await chrome.storage.sync.set({ 'unp.reader.v1': value });
  }, patch);
}

async function screenshot(page: Page, name: string) {
  const session = await context.newCDPSession(page);
  const capture = await session.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(test.info().outputPath(name), Buffer.from(capture.data, 'base64'));
  await session.detach();
}

async function statistics(page: Page) {
  return page.evaluate(async () => {
    const response = (await chrome.runtime.sendMessage({
      channel: 'unp.reading-stats.v1',
      action: 'read',
    })) as {
      ok: boolean;
      snapshot: {
        enabled: boolean;
        episodeCount: number;
        totalMs: number;
        activeDays: number;
        startedAt: number | null;
        epoch: string;
        error: string;
      };
    };
    if (!response.ok) throw new Error('Statistics service did not respond successfully');
    return response.snapshot;
  });
}

// Actual action popups are browser-managed targets, not ordinary context.pages().
// Inspect only the popup loaded by this isolated test extension/profile.
async function openActionPopup() {
  const worker = context.serviceWorkers()[0]!;
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.action?.default_popup).toBe('popup.html');
  expect(manifest.permissions).not.toContain('tabs');
  expect(manifest.permissions).not.toContain('activeTab');
  const root = await context.browser()!.newBrowserCDPSession();
  // Chrome may still be disposing its browser-owned bubble immediately after
  // Target.closeTarget, even when the popup document has already disappeared.
  await expect
    .poll(
      () =>
        worker.evaluate(async () => {
          try {
            await chrome.action.openPopup();
            return true;
          } catch {
            return false;
          }
        }),
      { timeout: 5000 }
    )
    .toBe(true);
  let targetId = '';
  await expect
    .poll(async () => {
      const targets = await root.send('Target.getTargets');
      targetId =
        targets.targetInfos.find(
          (target) => target.url === `chrome-extension://${extensionId}/popup.html`
        )?.targetId ?? '';
      return targetId;
    })
    .not.toBe('');
  const { sessionId } = await root.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  const command = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        root.off('Target.receivedMessageFromTarget', listener);
        reject(new Error(`Popup CDP command timed out: ${method}`));
      }, 10_000);
      const listener = (event: { sessionId: string; message: string }) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message) as {
          id?: number;
          result?: Record<string, unknown>;
          error?: { message: string };
        };
        if (message.id !== id) return;
        clearTimeout(timer);
        root.off('Target.receivedMessageFromTarget', listener);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result ?? {});
      };
      root.on('Target.receivedMessageFromTarget', listener);
      void root
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          root.off('Target.receivedMessageFromTarget', listener);
          reject(error);
        });
    });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const value = await command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return (value.result as { value: T }).value;
  };
  const click = async (selector: string) => {
    const point = await evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
    );
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    });
  };
  await expect
    .poll(() =>
      evaluate<boolean>(
        '!!document.querySelector("[role=switch]") && getComputedStyle(document.querySelector(".popup-content")).visibility === "visible"'
      )
    )
    .toBe(true);
  return { root, targetId, command, evaluate, click };
}

async function closePopup(root: CDPSession, targetId: string) {
  await root.send('Target.closeTarget', { targetId }).catch(() => {});
  await root.detach();
}

test('packaged icons decode at their declared sizes and brand images load offline', async () => {
  await context.setOffline(true);
  const options = await openOptions();
  const manifest = await context.serviceWorkers()[0]!.evaluate(() => chrome.runtime.getManifest());
  const actionIcons = manifest.action?.default_icon;
  expect(actionIcons).toBeDefined();
  if (!actionIcons || typeof actionIcons === 'string') {
    throw new Error('Toolbar icons must provide their supported pixel sizes');
  }
  expect(Object.keys(actionIcons)).toEqual(['16', '24', '32', '48', '64']);
  expect(Object.keys(manifest.icons ?? {})).toEqual([
    '16',
    '24',
    '32',
    '48',
    '64',
    '96',
    '128',
    '192',
  ]);
  const entries = [...Object.entries(manifest.icons ?? {}), ...Object.entries(actionIcons)];
  const dimensions = await options.evaluate(async (entries) => {
    return Promise.all(
      entries.map(async ([size, file]) => {
        const image = new Image();
        image.src = chrome.runtime.getURL(file);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const drawing = canvas.getContext('2d')!;
        drawing.drawImage(image, 0, 0);
        return {
          size: Number(size),
          file,
          width: image.naturalWidth,
          height: image.naturalHeight,
          cornerAlpha: drawing.getImageData(0, 0, 1, 1).data[3],
        };
      })
    );
  }, entries);
  for (const icon of dimensions) {
    expect(icon.width, icon.file).toBe(icon.size);
    expect(icon.height, icon.file).toBe(icon.size);
    expect(icon.cornerAlpha, icon.file).toBe(0);
  }
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 440 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const productIcon = popup.locator('.popup-product-icon');
  await expect(productIcon).toBeVisible();
  await expect(productIcon).toHaveAttribute('src', /\/icons\/icon128\.png$/);
  expect(
    await productIcon.evaluate((image: HTMLImageElement) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }))
  ).toEqual({ width: 128, height: 128 });
  await expect(productIcon).toHaveCSS('width', '40px');
  await expect(productIcon).toHaveCSS('height', '40px');
  for (const page of [options, popup]) {
    for (const size of [16, 32]) {
      await expect(page.locator(`link[rel="icon"][sizes="${size}x${size}"]`)).toHaveAttribute(
        'href',
        `/icons/icon${size}.png`
      );
    }
  }
  await popup.screenshot({ path: test.info().outputPath('product-icon-offline.png') });
});

for (const scenario of ['delayed', 'late', 'failed', 'offline'] as const) {
  test(`popup font preparation prevents a visible font swap when ${scenario}`, async () => {
    await context.setOffline(true);
    await context.addInitScript((scenario) => {
      if (!location.pathname.endsWith('/popup.html')) return;
      const state = window as typeof window & {
        fontFrames: { state: string; visible: boolean; loaded: number; family: string }[];
        fontCompletions: number;
      };
      state.fontFrames = [];
      state.fontCompletions = 0;
      const nativeLoad = FontFace.prototype.load;
      FontFace.prototype.load = function () {
        const loadFace = nativeLoad.bind(this);
        if (!this.family.includes('UNP UI Freesentation') || scenario === 'offline')
          return loadFace();
        if (scenario === 'failed') return Promise.reject(new Error('Synthetic font failure'));
        return new Promise<FontFace>((resolve, reject) => {
          setTimeout(
            () => {
              void loadFace().then((loaded) => {
                state.fontCompletions++;
                resolve(loaded);
              }, reject);
            },
            scenario === 'late' ? 2100 : 900
          );
        });
      };
      let previous = '';
      const frame = () => {
        const main = document.querySelector<HTMLElement>('.extension-popup');
        const content = document.querySelector<HTMLElement>('.popup-content');
        if (main && content) {
          const sample = {
            state: main.dataset.fontState ?? '',
            visible: getComputedStyle(content).visibility === 'visible',
            loaded: Array.from(document.fonts).filter(
              (face) => face.family.includes('UNP UI Freesentation') && face.status === 'loaded'
            ).length,
            family: getComputedStyle(content).fontFamily,
          };
          const key = JSON.stringify(sample);
          if (key !== previous) state.fontFrames.push(sample);
          previous = key;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, scenario);
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 440 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveTitle('Unofficial Novelpia Patch');
    const main = page.locator('.extension-popup');
    const content = page.locator('.popup-content');
    if (scenario === 'delayed' || scenario === 'late') {
      await expect(main).toHaveAttribute('data-font-state', 'loading');
      await expect(content).toBeHidden();
      await expect(content).toHaveAttribute('inert');
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => document.activeElement?.closest('.popup-content'))
      ).toBeNull();
      await expect(page.getByRole('status', { name: '팝업 글꼴 준비 중' })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('popup-preparing.png') });
    }
    const fallback = scenario === 'late' || scenario === 'failed';
    await expect(main).toHaveAttribute('data-font-state', fallback ? 'fallback' : 'ready');
    await expect(main).toHaveAttribute('aria-busy', 'false');
    await expect(content).toBeVisible();
    await expect(content).not.toHaveAttribute('inert');
    await expect(page.getByRole('status', { name: '팝업 글꼴 준비 중' })).toHaveCount(0);
    const title = page.getByRole('heading', { name: 'Unofficial Novelpia Patch' });
    const initial = await title.boundingBox();
    if (scenario === 'late')
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { fontCompletions: number }).fontCompletions)
        )
        .toBe(4);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            fontFrames: { state: string; visible: boolean; loaded: number; family: string }[];
          }
        ).fontFrames
    );
    expect(frames.some((frame) => frame.visible)).toBe(true);
    expect(
      frames
        .filter((frame) => frame.visible)
        .every((frame) =>
          frame.state === 'fallback'
            ? !frame.family.includes('UNP UI Freesentation')
            : frame.state === 'ready' && frame.loaded === 4
        )
    ).toBe(true);
    expect(await title.boundingBox()).toEqual(initial);
    await page.getByRole('button', { name: '설정 열기', exact: true }).focus();
    await expect(page.getByRole('button', { name: '설정 열기', exact: true })).toBeFocused();
    await test
      .info()
      .attach('font-frames', { body: JSON.stringify(frames), contentType: 'application/json' });
    await page.screenshot({ path: test.info().outputPath('popup-ready.png') });
    expect(errors).toEqual([]);
  });
}

test('actual action popup is compact, loads no editing UI, and switches only the active viewer', async () => {
  const other = await openViewer('1002');
  const otherIdentity = await other.evaluate(() => performance.timeOrigin);
  const viewer = await openViewer();
  await viewer.bringToFront();
  await viewer.locator('#novel_box').evaluate((box) => {
    box.scrollTop = 1400;
    box.dispatchEvent(new Event('scroll'));
  });
  const popup = await openActionPopup();
  try {
    expect(await popup.evaluate('innerWidth')).toBe(360);
    expect(await popup.evaluate('document.querySelector("main").dataset.fontState')).toBe('ready');
    expect(
      await popup.evaluate(
        'Array.from(document.fonts).filter(face => face.family.includes("UNP UI Freesentation")).every(face => face.status === "loaded")'
      )
    ).toBe(true);
    expect(await popup.evaluate('document.body.innerText')).toContain(
      '변경하면 현재 회차를 새로고침합니다'
    );
    expect(
      await popup.evaluate('document.querySelector("[role=switch]").getAttribute("aria-checked")')
    ).toBe('true');
    expect(
      await popup.evaluate(
        'performance.getEntriesByType("resource").some(item => /preset-editor|panel-runtime|settings-panel|preset-screen|settings-screen|settings-file-panel|misc-panel/.test(item.name))'
      )
    ).toBe(false);
    const image = await popup.command('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      test.info().outputPath('actual-popup-light.png'),
      Buffer.from(image.data as string, 'base64')
    );
    await popup.click('[role=switch]');
    // Closing the action surface must not cancel the background/content operation.
    await closePopup(popup.root, popup.targetId);
  } catch (error) {
    await closePopup(popup.root, popup.targetId);
    throw error;
  }
  await expect(viewer.locator('#unp-native-enable')).toBeAttached();
  await expect(viewer.locator('[data-unp-reader]')).toHaveCount(0);
  await expect(other.locator('#unp-reload-notice')).toBeVisible();
  expect(await other.evaluate(() => performance.timeOrigin)).toBe(otherIdentity);
  await expect(other.locator('[data-unp-line]').first()).toBeAttached();
  await viewer.bringToFront();
  const second = await openActionPopup();
  try {
    expect(
      await second.evaluate('document.querySelector("[role=switch]").getAttribute("aria-checked")')
    ).toBe('false');
    await second.click('[role=switch]');
    await closePopup(second.root, second.targetId);
  } catch (error) {
    await closePopup(second.root, second.targetId);
    throw error;
  }
  await expect(viewer.locator('[data-unp-line]').first()).toBeAttached();
  await expect
    .poll(() => viewer.locator('#novel_box').evaluate((box) => box.scrollTop))
    .toBeGreaterThan(500);
  await expect(other.locator('#unp-reload-notice')).toHaveCount(0);
  expect(await other.evaluate(() => performance.timeOrigin)).toBe(otherIdentity);
});

test('dark action popup opens an existing settings page without discarding its input', async () => {
  const options = await openOptions();
  await section(options, '설정 파일');
  await options.getByRole('tab', { name: 'JSON 텍스트', exact: true }).click();
  const input = options.getByRole('textbox', { name: '설정 JSON', exact: true });
  await input.fill('아직 작성 중인 설정 JSON');
  const identity = await options.evaluate(() => performance.timeOrigin);
  await updateSettings({ darkMode: true });
  await expect(options.getByTestId('management-page')).toHaveClass(/dark/);
  const unrelated = await context.newPage();
  await unrelated.goto('about:blank');
  await unrelated.bringToFront();
  const popup = await openActionPopup();
  try {
    await expect.poll(() => popup.evaluate('document.documentElement.dataset.theme')).toBe('dark');
    expect(await popup.evaluate('document.body.innerText')).toContain(
      '열린 뷰어에는 새로고침 후 적용됩니다'
    );
    expect(
      await popup.evaluate(
        'Array.from(document.querySelectorAll("nav a"), link => link.textContent)'
      )
    ).toEqual(['문제 신고', '문의, 제안', 'GitHub']);
    const image = await popup.command('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      test.info().outputPath('actual-popup-dark.png'),
      Buffer.from(image.data as string, 'base64')
    );
    await popup.click('.popup-open-settings');
    await expect(input).toHaveValue('아직 작성 중인 설정 JSON');
    await expect.poll(() => options.evaluate(() => document.hasFocus())).toBe(true);
    expect(await options.evaluate(() => performance.timeOrigin)).toBe(identity);
    expect(context.pages().filter((page) => page.url().endsWith('/options.html'))).toHaveLength(1);
  } finally {
    await closePopup(popup.root, popup.targetId);
  }
});

test('home starts without editing chunks and keeps a preset draft across menu navigation', async () => {
  const page = await openOptions();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('region', { name: '독서 통계', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((resource) =>
          /preset-editor|panel-runtime|settings-panel|preset-screen|settings-screen|settings-file-panel|misc-panel/.test(
            resource.name
          )
        )
    )
  ).toBe(false);
  await page.getByRole('button', { name: '프리셋 보기', exact: true }).click();
  await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
  const editor = page.getByRole('form', { name: '프리셋 편집', exact: true });
  await expect(editor).toBeVisible();
  const name = editor.getByRole('textbox', { name: '이름', exact: true });
  await name.fill('메뉴를 오가며 만든 프리셋');
  await section(page, '홈');
  await expect(editor).toBeHidden();
  await expect(page.getByRole('button', { name: '저장하고 적용', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '텍스트 설정', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '글자 크기', exact: true })).toBeVisible();
  await section(page, '프리셋');
  await expect(editor).toBeVisible();
  await expect(name).toHaveValue('메뉴를 오가며 만든 프리셋');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(
    page.getByRole('article', { name: '메뉴를 오가며 만든 프리셋', exact: true })
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('file and JSON import share review while preserving invalid input and hidden drafts', async () => {
  const page = await openOptions();
  await page.getByRole('button', { name: '설정 파일 열기', exact: true }).click();
  await expect(page.getByRole('tab', { name: '파일', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('textbox', { name: '설정 JSON', exact: true })).toBeHidden();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일로 저장', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('unofficial-novelpia-settings.json');
  await expect(
    page.getByRole('status').filter({ hasText: '다운로드를 요청했습니다' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'JSON 보기', exact: true }).click();
  const exported = await page
    .getByRole('textbox', { name: '내보내기 JSON', exact: true })
    .inputValue();
  expect(JSON.parse(exported)).toHaveProperty('settings');
  await page.getByRole('button', { name: 'JSON 접기', exact: true }).click();
  await page.getByRole('tab', { name: 'JSON 텍스트', exact: true }).click();
  const json = page.getByRole('textbox', { name: '설정 JSON', exact: true });
  await json.fill('{ not valid JSON');
  await page.getByRole('button', { name: '내용 확인', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(json).toHaveValue('{ not valid JSON');
  await section(page, '홈');
  await section(page, '설정 파일');
  await expect(json).toHaveValue('{ not valid JSON');
  await json.fill(exported);
  await page.getByRole('button', { name: '내용 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '가져오기 및 적용', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('tab', { name: '파일', exact: true }).click();
  await page.getByLabel('설정 파일', { exact: true }).setInputFiles({
    name: 'valid-settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported),
  });
  await expect(page.getByText('valid-settings.json', { exact: true })).toBeVisible();
  await expect(json).toBeHidden();
  await page.getByRole('button', { name: '가져오기 및 적용', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '설정과 프리셋을 가져왔습니다' })
  ).toBeVisible();
  await section(page, '프리셋');
  await expect(
    page.getByRole('region', { name: '내 프리셋', exact: true }).locator('article')
  ).toHaveCount(1);
});

test('a failed first preset storage read shows an error and can recover without reloading home', async () => {
  const page = await openOptions();
  const identity = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(() => {
    const original = chrome.storage.sync.get;
    (window as unknown as { restoreManagementRead: () => void }).restoreManagementRead = () => {
      chrome.storage.sync.get = original;
    };
    chrome.storage.sync.get = async () => {
      throw new Error('test preset read unavailable');
    };
  });
  await page.getByRole('button', { name: '프리셋 보기', exact: true }).click();
  const error = page.getByRole('alert').filter({ hasText: '프리셋을 불러오지 못했습니다' });
  await expect(error).toBeVisible();
  await expect(error).toContainText('test preset read unavailable');
  await expect(page.getByRole('article', { name: '기본', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { restoreManagementRead: () => void }).restoreManagementRead();
  });
  await error.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('article', { name: '기본', exact: true })).toBeVisible();
  await expect(error).toHaveCount(0);
  await section(page, '홈');
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(identity);
});

test('current preset has a stable highlighted border and loses selection when settings change', async () => {
  const page = await openOptions();
  await section(page, '프리셋');
  const card = page.getByRole('article', { name: '종이', exact: true });
  const other = page.getByRole('article', { name: '큰 글씨', exact: true });
  const before = (await card.boundingBox())!;
  await card.getByRole('button', { name: '종이 적용', exact: true }).click();
  await expect(card.getByText('현재 사용 중', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const border = await card.evaluate((element) => getComputedStyle(element).borderColor);
      const neutral = await other.evaluate((element) => getComputedStyle(element).borderColor);
      return border !== neutral;
    })
    .toBe(true);
  const after = (await card.boundingBox())!;
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  await screenshot(page, 'selected-preset.png');
  await section(page, '텍스트');
  const size = page.getByRole('spinbutton', { name: '글자 크기', exact: true });
  await size.fill('25');
  await size.press('Enter');
  await section(page, '프리셋');
  await expect(card.getByText('현재 사용 중', { exact: true })).toHaveCount(0);
  expect(await card.evaluate((element) => getComputedStyle(element).borderColor)).toBe(
    await other.evaluate((element) => getComputedStyle(element).borderColor)
  );
});

test('local statistics follow visible reading, pause behind menus, and deduplicate reopened episodes', async () => {
  const options = await openOptions();
  const viewer = await openViewer();
  await viewer.bringToFront();
  await expect.poll(async () => (await statistics(options)).episodeCount).toBe(1);
  await viewer.waitForTimeout(1200); // One real tracker sample before the menu pause.
  await viewer.locator('#btn_theme').click();
  await expect(viewer.getByTestId('settings-panel')).toBeVisible();
  await expect.poll(async () => (await statistics(options)).totalMs).toBeGreaterThan(500);
  const paused = await statistics(options);
  expect(paused.activeDays).toBe(1);
  expect(paused.startedAt).not.toBeNull();
  await viewer.waitForTimeout(2200); // The menu remains open across two tracker samples.
  expect((await statistics(options)).totalMs - paused.totalMs).toBeLessThan(200);
  await viewer.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await viewer.waitForTimeout(1200);
  await viewer.evaluate(() => {
    document.getElementById('novel_box')!.style.display = 'none';
    document.getElementById('list_box')!.style.display = 'block';
  });
  await expect
    .poll(async () => (await statistics(options)).totalMs)
    .toBeGreaterThan(paused.totalMs);
  const listPaused = await statistics(options);
  await viewer.waitForTimeout(2200);
  expect((await statistics(options)).totalMs - listPaused.totalMs).toBeLessThan(200);
  await viewer.reload();
  await expect(viewer.locator('[data-unp-line]').first()).toBeAttached();
  await expect.poll(async () => (await statistics(options)).episodeCount).toBe(1);
  await viewer.waitForTimeout(1200);
  await viewer.evaluate(() => {
    const modal = document.createElement('div');
    modal.id = 'user_donation_coin';
    modal.className = 'basic-modal-background';
    modal.style.cssText = 'position:fixed;inset:0;z-index:30000;background:#ddd;display:block';
    modal.textContent = '합성 서비스 모달, 실제 서비스 요청 없음';
    document.body.append(modal);
  });
  await expect
    .poll(async () => (await statistics(options)).totalMs)
    .toBeGreaterThan(listPaused.totalMs);
  const servicePaused = await statistics(options);
  await viewer.waitForTimeout(2200);
  expect((await statistics(options)).totalMs - servicePaused.totalMs).toBeLessThan(200);
  await viewer.locator('#user_donation_coin').evaluate((element) => element.remove());
  await viewer.goto(`${base}/viewer/1002?controls`);
  await expect(viewer.locator('[data-unp-line]').first()).toBeAttached();
  await expect.poll(async () => (await statistics(options)).episodeCount).toBe(2);
  await options.bringToFront();
  const stats = options.getByRole('region', { name: '독서 통계', exact: true });
  await expect(stats).toContainText('열어 본 회차');
  await expect(stats).toContainText('독서한 날');
  await expect(stats).toContainText('2');
  await screenshot(options, 'home-local-statistics.png');
});

test('settings reset preserves statistics, while recording and deletion have independent controls', async () => {
  const options = await openOptions();
  const viewer = await openViewer();
  await viewer.bringToFront();
  await expect.poll(async () => (await statistics(options)).episodeCount).toBe(1);
  await options.bringToFront();
  await section(options, '기타');
  const record = options.getByRole('switch', { name: '독서 통계 기록', exact: true });
  await expect(record).toBeChecked();
  await record.click();
  await expect(record).not.toBeChecked();
  await expect.poll(async () => (await statistics(options)).enabled).toBe(false);
  const saved = await statistics(options);
  await updateSettings({ fontSize: 25 });
  await options.getByRole('button', { name: '설정 초기화', exact: true }).click();
  const reset = options.getByRole('dialog', { name: '읽기 설정 초기화', exact: true });
  await expect(reset).toContainText('독서 통계');
  await reset.getByRole('button', { name: '취소', exact: true }).click();
  await expect(reset).toBeHidden();
  await options.getByRole('button', { name: '설정 초기화', exact: true }).click();
  await reset.getByRole('button', { name: '기본값으로 초기화', exact: true }).click();
  await expect(reset).toBeHidden();
  expect(await statistics(options)).toEqual(saved);
  await viewer.bringToFront();
  await viewer.goto(`${base}/viewer/1002?controls`);
  await expect(viewer.locator('[data-unp-line]').first()).toBeAttached();
  await viewer.waitForTimeout(1200);
  expect((await statistics(options)).episodeCount).toBe(1);
  await options.bringToFront();
  await options.getByRole('button', { name: '통계 삭제', exact: true }).click();
  const deletion = options.getByRole('dialog', { name: '독서 통계 삭제', exact: true });
  await deletion.getByRole('button', { name: '통계 삭제하기', exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect.poll(async () => (await statistics(options)).episodeCount).toBe(0);
  const cleared = await statistics(options);
  expect(cleared.enabled).toBe(false);
  expect(cleared.epoch).not.toBe(saved.epoch);
  expect(cleared.totalMs).toBe(0);
  await record.click();
  await expect(record).toBeChecked();
  await viewer.bringToFront();
  await expect.poll(async () => (await statistics(options)).episodeCount).toBe(1);
});

for (const dark of [false, true]) {
  test(`management home, transfer and reset remain readable in ${dark ? 'dark' : 'light'} layouts`, async () => {
    const page = await openOptions();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await updateSettings({ darkMode: dark });
    for (const layout of [
      { name: 'desktop', width: 1440, height: 900, zoom: 1 },
      { name: 'narrow', width: 390, height: 844, zoom: 1 },
      { name: 'zoom200', width: 1440, height: 900, zoom: 2 },
    ]) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = String(zoom);
      }, layout.zoom);
      for (const name of ['홈', '설정 파일', '기타', '정보']) {
        await section(page, name);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth
            )
          )
          .toBeLessThanOrEqual(1);
        if (name === '홈') {
          const introduction = page.getByRole('region', { name: '시작하기', exact: true });
          const statistics = page.getByRole('region', { name: '독서 통계', exact: true });
          const method = statistics.locator('.statistics-method');
          if (!(await method.evaluate((element) => (element as HTMLDetailsElement).open))) {
            await method.locator('summary').click();
          }
          const introductionWidth = (await introduction.boundingBox())!.width;
          const descriptionWidth = (await introduction.locator('p').boundingBox())!.width;
          expect(Math.abs(descriptionWidth - introductionWidth)).toBeLessThan(1);
          const methodWidth = (await method.boundingBox())!.width;
          for (const paragraph of await method.locator('p').all()) {
            expect(Math.abs((await paragraph.boundingBox())!.width - methodWidth)).toBeLessThan(1);
          }
          const manage = method.getByRole('button', { name: '기록 관리', exact: true });
          await manage.scrollIntoViewIfNeeded();
          await page.mouse.move(0, 0);
          const before = (await manage.boundingBox())!;
          expect(before.height).toBeGreaterThanOrEqual(36 * layout.zoom);
          const padding = await manage.evaluate((element) => {
            const style = getComputedStyle(element);
            return [Number.parseFloat(style.paddingLeft), Number.parseFloat(style.paddingRight)];
          });
          expect(padding.every((value) => value >= 12)).toBe(true);
          await manage.hover();
          expect((await manage.boundingBox())!.width).toBe(before.width);
          expect((await manage.boundingBox())!.height).toBe(before.height);
          await manage.focus();
          await expect(manage).toBeFocused();
          await screenshot(page, `${dark ? 'dark' : 'light'}-${layout.name}-기록-기준.png`);
          await manage.press('Enter');
          await expect(page.getByRole('heading', { name: '기타', exact: true })).toBeVisible();
          await section(page, '홈');
        }
        const target =
          name === '정보'
            ? page.getByRole('switch', { name: '확장 뷰어 사용', exact: true })
            : name === '기타'
              ? page.getByRole('button', { name: '설정 초기화', exact: true })
              : name === '설정 파일'
                ? page.getByRole('button', { name: '파일로 저장', exact: true })
                : page.getByRole('button', { name: '프리셋 보기', exact: true });
        await target.scrollIntoViewIfNeeded();
        await expect(target).toBeVisible();
        const bounds = (await target.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.width);
        await screenshot(page, `${dark ? 'dark' : 'light'}-${layout.name}-${name}.png`);
      }
    }
    expect(errors).toEqual([]);
  });
}
