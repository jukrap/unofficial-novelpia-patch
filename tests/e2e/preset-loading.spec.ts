import { launchReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext } from '@playwright/test';
import { cp, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { defaults } from '../../src/shared/model/preferences';
// @ts-expect-error Synthetic fixture is a plain Node module.
import { viewerHtml } from '../fixtures/viewer.mjs';

for (const surface of ['viewer', 'options'] as const) {
  test(`a missing ${surface} editor chunk offers page reload and preserves saved presets`, async () => {
    // Alter an isolated build copy; never remove files from a user's loaded build.
    const workspace = await mkdtemp(path.join(tmpdir(), 'unp-editor-load-'));
    const extension = path.join(workspace, 'extension');
    await cp(path.resolve('.output/chrome-mv3-e2e'), extension, { recursive: true });
    const server = http.createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(viewerHtml());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    let context: BrowserContext | undefined;
    try {
      context = await launchReadingContext(path.join(workspace, 'profile'), {
        channel: 'chromium',
        headless: true,
        viewport: { width: 1440, height: 900 },
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const saved = {
        id: 'existing',
        name: '남아 있는 프리셋',
        description: '',
        isDefault: false,
        createdAt: 123,
        settings: defaults,
      };
      await worker.evaluate(
        async (saved) =>
          chrome.storage.sync.set({
            'unp.presetIndex.v1': { schemaVersion: 1, ids: [saved.id], selectedId: null },
            'unp.preset.v1.existing': saved,
          }),
        saved
      );
      const page = await context.newPage();
      const url =
        surface === 'viewer'
          ? `http://127.0.0.1:${(server.address() as { port: number }).port}/viewer/1001`
          : `chrome-extension://${new URL(worker.url()).host}/options.html`;
      const openGallery = async () => {
        if (surface === 'viewer') {
          await expect(page.locator('[data-unp-reader]')).toBeVisible();
          await page.locator('#btn_theme').click();
          await page.getByRole('button', { name: '프리셋 설정으로 이동', exact: true }).click();
        } else {
          await page
            .getByRole('navigation', { name: '관리 항목' })
            .getByRole('button', { name: '프리셋', exact: true })
            .click();
        }
        await expect(page.getByRole('article', { name: saved.name, exact: true })).toBeVisible();
      };
      await page.goto(url);
      await openGallery();
      const directory = path.join(
        extension,
        surface === 'viewer' ? 'content-scripts/esm' : 'chunks'
      );
      const name = (await readdir(directory)).find((file) => /^preset-editor-.*\.js$/.test(file))!;
      expect(name).toBeTruthy();
      const file = path.join(directory, name);
      await rename(file, `${file}.unavailable`);
      await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
      const error = page.getByRole('alert').filter({ hasText: '편집 화면을 불러오지 못했습니다' });
      await expect(error).toBeVisible();
      await expect(error).toContainText('저장된 프리셋은 유지됩니다');
      expect(
        await worker.evaluate(
          async () =>
            (await chrome.storage.sync.get('unp.preset.v1.existing'))['unp.preset.v1.existing']
        )
      ).toEqual(saved);
      await rename(`${file}.unavailable`, file);
      await Promise.all([
        page.waitForEvent('domcontentloaded'),
        error.getByRole('button', { name: '현재 페이지 새로고침', exact: true }).click(),
      ]);
      await openGallery();
      await page.getByRole('button', { name: '현재 설정으로 만들기', exact: true }).click();
      const editor = page.getByRole('form', { name: '프리셋 편집', exact: true });
      await expect(editor).toBeVisible();
      await editor.getByRole('textbox', { name: '이름', exact: true }).fill('다시 저장한 프리셋');
      await page.getByRole('button', { name: '저장', exact: true }).click();
      await expect(
        page.getByRole('article', { name: '다시 저장한 프리셋', exact: true })
      ).toBeVisible();
      await expect(page.getByRole('article', { name: saved.name, exact: true })).toBeVisible();
    } finally {
      await context?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (path.resolve(workspace).startsWith(path.join(tmpdir(), 'unp-editor-load-')))
        await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
}

test('a failed themebox remains readable after Escape and reopening', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'unp-panel-load-'));
  const extension = path.join(workspace, 'extension');
  await cp(path.resolve('.output/chrome-mv3-e2e'), extension, { recursive: true });
  const directory = path.join(extension, 'content-scripts/esm');
  const panel = (await readdir(directory)).find((file) => /^panel-runtime-.*\.js$/.test(file));
  expect(panel).toBeTruthy();
  await rename(path.join(directory, panel!), path.join(directory, `${panel}.unavailable`));
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(viewerHtml());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let context: BrowserContext | undefined;
  try {
    context = await launchReadingContext(path.join(workspace, 'profile'), {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/viewer/1001`);
    await expect(page.locator('[data-unp-reader]')).toBeVisible();
    await page.locator('#btn_theme').click();
    const error = page.locator('.panel-pending');
    await expect(error).toContainText('테마박스를 불러오지 못했습니다');
    await expect(error).toHaveCSS('opacity', '1');
    await error.getByRole('button', { name: '다시 시도', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(error).toBeHidden();
    await page.locator('#btn_theme').click();
    await expect(error).toBeVisible();
    await expect(error).toHaveCSS('opacity', '1');
    await expect(error.getByRole('button', { name: '다시 시도', exact: true })).toBeEnabled();
  } finally {
    await context?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (path.resolve(workspace).startsWith(path.join(tmpdir(), 'unp-panel-load-')))
      await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
