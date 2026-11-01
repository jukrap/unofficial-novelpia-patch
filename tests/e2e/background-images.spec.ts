import { launchReadingContext, closeReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
// @ts-expect-error Synthetic fixture module has no TS declarations.
import { viewerHtml } from '../fixtures/viewer.mjs';

let server: http.Server;
let base: string;
let context: BrowserContext;
let profile: string;
let page: Page;
let extensionId: string;
test.beforeAll(async () => {
  server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(viewerHtml());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-images-'));
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
});
test.afterEach(async () => {
  await closeReadingContext(context);
  if (profile.startsWith(path.join(tmpdir(), 'unp-images-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function imageFile(target: Page) {
  const data = await target.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const drawing = canvas.getContext('2d')!;
    drawing.fillStyle = '#ad91ca';
    drawing.fillRect(0, 0, 24, 24);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return {
    name: 'synthetic-paper.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  };
}
async function listStoredImages() {
  return context.serviceWorkers()[0]!.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === 'unp-background-images')) return [];
    return new Promise<{ id: string; name: string; size: number }[]>((resolve, reject) => {
      const request = indexedDB.open('unp-background-images');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const all = db.transaction('images').objectStore('images').getAll();
        all.onsuccess = () => {
          db.close();
          resolve(all.result);
        };
        all.onerror = () => reject(all.error);
      };
    });
  });
}
async function setReader(patch: Record<string, unknown>) {
  await context.serviceWorkers()[0]!.evaluate(async (patch) => {
    const raw = await chrome.storage.sync.get('unp.reader.v1');
    const document = raw['unp.reader.v1'] as { data: Record<string, unknown> };
    Object.assign(document.data, patch);
    await chrome.storage.sync.set({ 'unp.reader.v1': document });
  }, patch);
}
async function tab(label: string) {
  await page.getByRole('button', { name: `${label} 설정으로 이동`, exact: true }).click();
}

test('a local file lives in extension IndexedDB, survives reopening, and stays out of exported settings', async () => {
  await page.locator('#btn_theme').click();
  await tab('외관');
  await page.getByRole('button', { name: '이미지', exact: true }).click();
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await page.getByLabel('배경 이미지 파일', { exact: true }).setInputFiles(await imageFile(page));
  await expect.poll(async () => (await listStoredImages()).length).toBe(1);
  await expect(page.getByRole('combobox', { name: /등록 배경 이미지/ })).toContainText(
    'synthetic-paper.png'
  );
  await tab('텍스트');
  await expect(page.locator('[data-section="text"] .preview-image-layer')).toBeVisible();
  const localPreview = page.locator('[data-section="text"] .preview-image-layer');
  const localUrl = await localPreview.evaluate(
    (element) => getComputedStyle(element).backgroundImage
  );
  await expect
    .poll(() => localPreview.evaluate((element) => element.getAnimations().length))
    .toBe(0);
  for (let revisit = 0; revisit < 3; revisit++) {
    await tab('레이아웃');
    await tab('텍스트');
    await expect(localPreview).toHaveCSS('background-image', localUrl);
    await expect(localPreview).toHaveCSS('animation-name', 'none');
    expect(await localPreview.evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect(page.locator('[data-section="text"] .preview-image-loading')).toHaveCount(0);
  }
  expect(
    await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name))
  ).not.toContain('unp-background-images');
  await expect
    .poll(() =>
      context.serviceWorkers()[0]!.evaluate(async () => {
        const values = await chrome.storage.sync.get('unp.reader.v1');
        return (values['unp.reader.v1'] as { data: { backgroundAssetId: string | null } }).data
          .backgroundAssetId;
      })
    )
    .toMatch(/^[a-z\d-]{36}$/i);
  const saved = await context.serviceWorkers()[0]!.evaluate(async () => {
    const values = await chrome.storage.sync.get(null);
    return {
      settings: (values['unp.reader.v1'] as { data: Record<string, unknown> }).data,
      json: JSON.stringify(values),
    };
  });
  expect(saved.settings.backgroundAssetId).toMatch(/^[a-z\d-]{36}$/i);
  expect(saved.json).not.toContain('data:image');
  expect(saved.json).not.toContain('blob:');
  await page.reload();
  await expect(page.locator('[data-unp-line]').first()).toBeAttached();
  await page.locator('#btn_theme').click();
  await expect(page.locator('[data-section="text"] .preview-image-layer')).toBeVisible();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options
    .getByRole('navigation', { name: '관리 항목' })
    .getByRole('button', { name: '설정 파일', exact: true })
    .click();
  await options.getByRole('button', { name: 'JSON 보기', exact: true }).click();
  const exportText = await options.getByRole('textbox', { name: '내보내기 JSON' }).inputValue();
  expect(exportText).toContain(String(saved.settings.backgroundAssetId));
  expect(exportText).not.toContain('data:image');
  const removal = await options.evaluate(async (id) => {
    return chrome.runtime.sendMessage({
      channel: 'unp.background-assets.v1',
      action: 'remove',
      id,
    });
  }, saved.settings.backgroundAssetId);
  expect(removal).toMatchObject({ ok: false, error: expect.stringContaining('현재 읽기 설정') });
  await setReader({ backgroundAssetId: crypto.randomUUID() });
  await expect(page.locator('[data-section="text"] .preview-load-error')).toContainText(
    '이미지 다시 등록'
  );
  await expect(page.locator('[data-section="text"] .preview-image-loading')).toHaveCount(0);
});

test('a draft file is not persisted on cancel and is committed only when the preset is saved', async () => {
  await page.locator('#btn_theme').click();
  await tab('프리셋');
  await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
  await page.getByRole('tab', { name: '외관', exact: true }).click();
  await page.getByRole('button', { name: '이미지', exact: true }).click();
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await page.getByLabel('배경 이미지 파일', { exact: true }).setInputFiles(await imageFile(page));
  await expect(page.getByRole('combobox', { name: /등록 배경 이미지/ })).toContainText('저장 전');
  expect(await listStoredImages()).toEqual([]);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '버리고 이동', exact: true }).click();
  expect(await listStoredImages()).toEqual([]);
  await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
  await page.getByRole('textbox', { name: '이름', exact: true }).fill('로컬 파일 프리셋');
  await page.getByRole('tab', { name: '외관', exact: true }).click();
  await page.getByRole('button', { name: '이미지', exact: true }).click();
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await page.getByLabel('배경 이미지 파일', { exact: true }).setInputFiles(await imageFile(page));
  await expect(page.getByRole('combobox', { name: /등록 배경 이미지/ })).toContainText('저장 전');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('article', { name: '로컬 파일 프리셋', exact: true })).toBeVisible();
  expect(await listStoredImages()).toHaveLength(1);
});

test('slow preview images show a scoped loader, reveal after decode, and expose a retryable failure', async () => {
  const file = await imageFile(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route(`${base}/slow-image.png`, async (route) => {
    await gate;
    await route.fulfill({ body: file.buffer, contentType: 'image/png' });
  });
  await page.locator('#btn_theme').click();
  await setReader({
    backgroundType: 'image',
    backgroundImageSource: 'url',
    backgroundImage: `${base}/slow-image.png`,
  });
  await expect(page.locator('.preview-image-loading')).toBeVisible();
  await expect(
    page.locator('[data-section="text"]').getByTestId('typography-preview')
  ).toBeVisible();
  release();
  await expect(page.locator('.preview-image-layer')).toBeVisible();
  await expect(page.locator('.preview-image-loading')).toHaveCount(0);
  await context.route(`${base}/missing-image.png`, (route) => route.abort());
  await setReader({ backgroundImage: `${base}/missing-image.png` });
  await expect(page.locator('.preview-load-error')).toContainText('이미지를 불러오지 못했습니다');
  await expect(
    page.locator('.preview-load-error').getByRole('button', { name: '다시 시도' })
  ).toBeVisible();
  await expect(page.locator('.preview-image-loading')).toHaveCount(0);
});

test('the local storage limit fails visibly, preserves existing files, and allows a retry after cleanup', async () => {
  await page.locator('#btn_theme').click();
  await tab('외관');
  await page.getByRole('button', { name: '이미지', exact: true }).click();
  await page.getByRole('button', { name: '파일', exact: true }).click();
  const file = await imageFile(page);
  // Fill the accounted capacity without allocating 100MiB in the browser test process.
  await context.serviceWorkers()[0]!.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('unp-background-images', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('images', 'readwrite');
        transaction.objectStore('images').put({
          id: crypto.randomUUID(),
          name: 'capacity-fixture.png',
          type: 'image/png',
          size: 100 * 1024 * 1024,
          createdAt: 1,
          blob: new Blob(['fixture']),
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onabort = () => reject(transaction.error);
      };
    });
  });
  await page.getByLabel('배경 이미지 파일', { exact: true }).setInputFiles(file);
  await expect(page.locator('.background-image-field [role="alert"]')).toContainText('100MiB');
  expect(await listStoredImages()).toHaveLength(1);
  await page.getByRole('button', { name: '등록 이미지 관리', exact: true }).click();
  await page.getByRole('button', { name: 'capacity-fixture.png 삭제', exact: true }).click();
  await expect.poll(async () => (await listStoredImages()).length).toBe(0);
  await page.getByLabel('배경 이미지 파일', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('combobox', { name: /등록 배경 이미지/ })).toContainText(
    'synthetic-paper.png'
  );
  expect(await listStoredImages()).toHaveLength(1);
  await expect(page.locator('.background-image-field [role="alert"]')).toHaveCount(0);
});

test('an already decoded URL preview is restored on tab re-entry without a new fade or loading surface', async () => {
  const file = await imageFile(page);
  await context.route(`${base}/cached-preview.png`, (route) =>
    route.fulfill({ body: file.buffer, contentType: 'image/png' })
  );
  await setReader({
    backgroundType: 'image',
    backgroundImageSource: 'url',
    backgroundImage: `${base}/cached-preview.png`,
  });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const navigation = options.getByRole('navigation', { name: '관리 항목' });
  await navigation.getByRole('button', { name: '텍스트', exact: true }).click();
  const preview = options.locator('[data-section="text"] .preview-image-layer');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((element) => element.getAnimations().length)).toBe(0);
  for (let revisit = 0; revisit < 3; revisit++) {
    await navigation.getByRole('button', { name: '레이아웃', exact: true }).click();
    await navigation.getByRole('button', { name: '텍스트', exact: true }).click();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS('animation-name', 'none');
    expect(await preview.evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect(options.locator('[data-section="text"] .preview-image-loading')).toHaveCount(0);
  }
});

test('scroll backgrounds fill the original viewport around a shorter reader and never cover service UI', async () => {
  const file = await imageFile(page);
  await context.route(`${base}/scroll-background.png`, (route) =>
    route.fulfill({ body: file.buffer, contentType: 'image/png' })
  );
  await page.evaluate(() => {
    const box = document.getElementById('novel_box')!;
    const frame = document.createElement('div');
    frame.id = 'viewer_no_drag';
    frame.style.cssText = 'position:absolute;inset:0;background:#c32118';
    box.before(frame);
    frame.append(box);
    box.style.position = 'relative';
    box.style.willChange = 'transform';
    document.body.style.backgroundColor = '#c32118';
  });
  await setReader({
    backgroundType: 'image',
    backgroundImageSource: 'url',
    backgroundImage: `${base}/scroll-background.png`,
    backgroundImageFade: false,
    overlayOpacity: 0,
    readerHeightPercent: 60,
  });
  const layer = page.locator('[data-unp-background]');
  await expect(layer).toHaveCount(1);
  for (const nativeStyle of [
    'will-change:transform',
    'transform:translateZ(0)',
    'filter:blur(0px)',
    'contain:paint',
  ]) {
    await page.evaluate((style) => {
      const box = document.getElementById('novel_box')!;
      for (const name of ['will-change', 'transform', 'filter', 'contain'])
        box.style.removeProperty(name);
      const [name, value] = style.split(':');
      box.style.setProperty(name!, value!);
    }, nativeStyle);
    for (const fraction of [0, 0.45, 1]) {
      await page.locator('#novel_box').evaluate((element, value) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * value;
      }, fraction);
      await expect
        .poll(
          () =>
            layer.evaluate((element) => {
              const box = document.getElementById('novel_box')!;
              const viewport = document.getElementById('viewer_no_drag')!.getBoundingClientRect(),
                image = element.getBoundingClientRect();
              return Math.max(
                Math.abs(image.top - viewport.top - box.clientTop),
                Math.abs(image.left - viewport.left - box.clientLeft),
                Math.abs(
                  image.width -
                    (box.offsetWidth -
                      (parseFloat(getComputedStyle(box).borderLeftWidth) || 0) -
                      (parseFloat(getComputedStyle(box).borderRightWidth) || 0))
                ),
                Math.abs(image.height - viewport.height)
              );
            }),
          {
            message: `${nativeStyle}, scroll ${fraction}: background fills the original viewport`,
          }
        )
        .toBeLessThan(1);
      const png = await page.screenshot({ clip: { x: 4, y: 100, width: 2, height: 2 } });
      const color = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 2;
        const drawing = canvas.getContext('2d')!;
        drawing.drawImage(image, 0, 0);
        return [...drawing.getImageData(0, 0, 1, 1).data].slice(0, 3);
      }, png.toString('base64'));
      expect(color).toEqual([173, 145, 202]);
      expect(
        await page
          .locator('#novel_box')
          .evaluate((element) => element.scrollWidth - element.clientWidth)
      ).toBeLessThanOrEqual(1);
    }
  }
  await page.locator('#test-banner button').click();
  await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(() =>
      layer.evaluate((element) => {
        return Math.abs(element.getBoundingClientRect().height - window.innerHeight);
      })
    )
    .toBeLessThan(1);
  await page.evaluate(() => {
    document.getElementById('novel_box')!.style.display = 'none';
  });
  await expect(layer).toBeHidden();
  await page.evaluate(() => {
    document.getElementById('novel_box')!.style.display = 'block';
  });
  await expect(layer).toBeVisible();
});
