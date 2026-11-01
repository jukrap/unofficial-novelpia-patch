import { launchReadingContext, closeReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext } from '@playwright/test';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
// @ts-expect-error Public synthetic text only.
import { viewerHtml } from '../fixtures/viewer.mjs';

for (const mode of ['scroll', 'page'] as const) {
  for (const fault of ['none', 'module', 'dependency', 'storage', 'disabled'] as const) {
    test(`full browser restart restores ${mode}, startup ${fault}`, async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'unp-restart-'));
      const profile = path.join(directory, 'profile');
      const extension = path.join(directory, 'extension');
      let context: BrowserContext | undefined;
      const server = http.createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(viewerHtml());
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/viewer/1001`;
      const launch = () =>
        launchReadingContext(profile, {
          channel: 'chromium',
          headless: true,
          viewport: { width: 1440, height: 900 },
          args: [
            `--disable-extensions-except=${extension}`,
            `--load-extension=${extension}`,
            '--restore-last-session',
          ],
        });
      try {
        await cp(path.resolve('.output/chrome-mv3-e2e'), extension, { recursive: true });
        if (fault === 'storage') {
          // Inject a transient extension-storage failure into this isolated test copy only.
          const file = path.join(extension, 'content-scripts/content.js');
          const code = await readFile(file, 'utf8');
          await writeFile(
            file,
            `if(sessionStorage.getItem('unp-test-restoring')==='1'){
            const get=chrome.storage.sync.get.bind(chrome.storage.sync);let failures=2;
            chrome.storage.sync.get=(...args)=>failures-->0?Promise.reject(new Error('synthetic startup storage failure')):get(...args);
          }\n${code}`
          );
        }
        context = await launch();
        const page = context.pages()[0]!;
        await page.goto(url);
        await expect(page.locator('[data-unp-reader="scroll"]')).toBeVisible();
        // Wait for initial preference adoption before injecting an external storage edit.
        await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        await worker.evaluate(async () => {
          const raw = await chrome.storage.sync.get('unp.reader.v1');
          const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
          Object.assign(doc.data, { fontSize: 23, backgroundColor: '#e5d8ba', darkMode: false });
          await chrome.storage.sync.set({ 'unp.reader.v1': doc });
        });
        await expect(page.locator('[data-unp-line]').first()).toHaveCSS('font-size', '23px');
        if (mode === 'page') {
          await worker.evaluate(async () => {
            const raw = await chrome.storage.sync.get('unp.reader.v1');
            const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
            doc.data.readingMode = 'page';
            await chrome.storage.sync.set({ 'unp.reader.v1': doc });
          });
          await expect(page.locator('[data-unp-reader="page"]')).toBeVisible();
          await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
        }
        await page.evaluate(() => sessionStorage.setItem('unp-test-restoring', '1'));
        if (fault === 'disabled')
          await worker.evaluate(async () => {
            const raw = await chrome.storage.sync.get('unp.reader.v1');
            const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
            doc.data.enabled = false;
            await chrome.storage.sync.set({ 'unp.reader.v1': doc });
          });
        // Close the whole browser, not just this tab. Reopen the same persistent profile.
        await closeReadingContext(context);
        context = undefined;
        const esm = path.join(extension, 'content-scripts/esm');
        const moduleFile = path.join(
          esm,
          fault === 'dependency'
            ? (await readdir(esm)).find(
                (name) => name.startsWith('reader-') && name.endsWith('.js')
              )!
            : 'viewer.js'
        );
        const moduleCode =
          fault === 'module' || fault === 'dependency' ? await readFile(moduleFile) : undefined;
        if (moduleCode) await rm(moduleFile);
        context = await launch();
        let restored = context.pages().find((candidate) => candidate.url() === url);
        await expect
          .poll(() => {
            restored = context!.pages().find((candidate) => candidate.url() === url);
            return !!restored;
          })
          .toBe(true);
        const current = restored!;
        const errors: string[] = [];
        current.on('pageerror', (error) => errors.push(error.message));
        await current.bringToFront();
        if (moduleCode) {
          // Keep a packaged startup resource unavailable, then restore it without reloading.
          await current.waitForTimeout(600); // Keep the file absent through the first startup attempts.
          await expect(current.locator('[data-unp-reader]')).toHaveCount(0);
          await expect(current.locator('.line[data-line="1"]').first()).toBeVisible();
          await writeFile(moduleFile, moduleCode);
        }
        if (fault === 'disabled') {
          await expect(
            current.getByRole('button', { name: /확장 뷰어 켜기/, includeHidden: true })
          ).toBeAttached();
          await expect(current.locator('[data-unp-reader]')).toHaveCount(0);
        } else {
          await expect(current.locator(`[data-unp-reader="${mode}"]`)).toBeVisible();
          await expect(current.locator('[data-unp-line]').first()).toHaveCSS('font-size', '23px');
          await current.locator('#btn_theme').click();
          await expect(current.getByTestId('settings-panel')).toBeVisible();
          await expect(current.locator('#unp-panel-host')).toHaveCount(1);
        }
        expect(errors).toEqual([]);
        const restoredWorker =
          context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        expect(
          await restoredWorker.evaluate(async () => {
            const raw = await chrome.storage.sync.get('unp.reader.v1');
            return (raw['unp.reader.v1'] as { data: { fontSize: number } }).data.fontSize;
          })
        ).toBe(23);
      } finally {
        await closeReadingContext(context);
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (directory.startsWith(path.join(tmpdir(), 'unp-restart-')))
          await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    });
  }
}
