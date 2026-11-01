import { test, expect, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { launchReadingContext } from '../helpers/reading-font-fixture';
// @ts-expect-error Synthetic text only.
import { viewerHtml } from '../fixtures/viewer.mjs';

for (const width of [1920, 390]) {
  test(`built-in scenes and distinct reading frames work without registered files at ${width}px`, async () => {
    test.setTimeout(120000);
    const profile = await mkdtemp(path.join(tmpdir(), 'unp-preset-layouts-'));
    const extension = path.resolve('.output/chrome-mv3-e2e');
    let context: BrowserContext | undefined;
    const server = http.createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(viewerHtml());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      context = await launchReadingContext(profile, {
        channel: 'chromium',
        headless: true,
        viewport: { width, height: width === 390 ? 844 : 1080 },
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const id = new URL(worker.url()).host;
      const options = await context.newPage();
      const viewer = await context.newPage();
      const errors: string[] = [];
      for (const page of [options, viewer])
        page.on('pageerror', (error) => errors.push(error.message));
      await options.goto(`chrome-extension://${id}/options.html#/presets`);
      const gallery = options.getByRole('region', { name: '기본 제공 프리셋', exact: true });
      await expect(gallery.getByRole('article')).toHaveCount(10);
      await expect(gallery.getByRole('article', { name: '기본', exact: true })).toContainText(
        '100%'
      );
      const heights: number[] = [];
      const paperWidths: number[] = [];
      const cases = [
        ['밝은 돌빛', 'warm-stone', 720, 82, 56, 48, 'page'],
        ['옅은 녹색', 'pale-sage', 620, 68, 32, 36, 'scroll'],
        ['짙은 청회색', 'deep-slate', 560, 90, 60, 64, 'page'],
        ['차분한 보라', 'muted-plum', 980, 60, 72, 40, 'page'],
        ['좁은 본문', '', 520, 100, 20, 12, 'scroll'],
        ['넓은 본문', '', 1360, 100, 64, 24, 'scroll'],
      ] as const;
      for (const [name, asset, maxWidth, height, horizontal, vertical, mode] of cases) {
        await viewer.goto('about:blank');
        const card = gallery.getByRole('article', { name, exact: true });
        await card.scrollIntoViewIfNeeded();
        if (asset) {
          await expect(card.locator('.preview-image-layer')).toHaveCSS(
            'background-image',
            new RegExp(`/assets/backgrounds/${asset}\\.svg`)
          );
          await expect(card.getByRole('alert')).toHaveCount(0);
        }
        await card.getByRole('button', { name: `${name} 적용`, exact: true }).click();
        await expect
          .poll(() =>
            worker.evaluate(
              async () =>
                (
                  (await chrome.storage.sync.get('unp.reader.v1'))['unp.reader.v1'] as {
                    data: Record<string, unknown>;
                  }
                ).data
            )
          )
          .toMatchObject({
            readingMode: mode,
            maxWidth,
            readerHeightPercent: height,
            horizontalPadding: horizontal,
            verticalPadding: vertical,
            backgroundType: asset ? 'image' : 'color',
          });
        await viewer.goto(
          `http://127.0.0.1:${(server.address() as { port: number }).port}/viewer/1001`
        );
        const body = viewer.locator(`[data-unp-reader="${mode}"]`);
        await expect(body).toBeAttached();
        await expect(viewer.locator('html')).not.toHaveAttribute('data-unp-preparing', '');
        await expect(viewer.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
        await expect(body).toHaveCSS(
          mode === 'page' ? 'margin' : 'padding',
          `${vertical}px ${horizontal}px`
        );
        if (asset) {
          await expect(viewer.locator('[data-unp-background]')).toHaveCSS(
            'background-image',
            new RegExp(`/assets/backgrounds/${asset}\\.svg`)
          );
          await expect(viewer.locator('[data-unp-background]')).toHaveCSS('opacity', '1');
        }
        const frame = await viewer
          .locator(mode === 'page' ? '#novel_drawing_page_c' : '#novel_box')
          .boundingBox();
        expect(frame).not.toBeNull();
        expect(frame!.width).toBeLessThanOrEqual(width);
        heights.push(frame!.height);
        paperWidths.push(mode === 'page' ? frame!.width : (await body.boundingBox())!.width);
        await expect(viewer.locator('#test-banner')).toBeVisible();
        if (mode === 'page')
          await expect(body).toHaveCSS(
            'column-count',
            width === 390 || name === '차분한 보라' ? '1' : '2'
          );
        expect(
          await viewer.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        ).toBeLessThanOrEqual(1);
        if (asset === 'deep-slate' || asset === 'muted-plum')
          await viewer.screenshot({ path: test.info().outputPath(`${asset}-${width}.png`) });
      }
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(200);
      if (width === 1920) expect(new Set(paperWidths).size).toBeGreaterThan(3);
      const databases = await worker.evaluate(() => indexedDB.databases());
      expect(databases.some((database) => database.name === 'unp-background-images')).toBe(false);

      // Options and presets own the same persisted reading mode and page configuration.
      await options
        .getByRole('navigation', { name: '관리 항목' })
        .getByRole('button', { name: '레이아웃', exact: true })
        .click();
      await expect(
        options.getByRole('button', { name: '스크롤 방식', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      await options.getByRole('button', { name: '페이지 방식', exact: true }).click();
      await options.getByRole('button', { name: '항상 한 쪽', exact: true }).click();
      await expect(
        options.getByRole('spinbutton', { name: '두 쪽 사이 간격', exact: true })
      ).toHaveCount(0);
      await options.getByRole('combobox', { name: '페이지 효과', exact: true }).click();
      await options.getByRole('option', { name: '페이드', exact: true }).click();
      await options.getByRole('button', { name: '하단 고정', exact: true }).click();
      await expect
        .poll(() =>
          worker.evaluate(
            async () =>
              (
                (await chrome.storage.sync.get('unp.reader.v1'))['unp.reader.v1'] as {
                  data: Record<string, unknown>;
                }
              ).data
          )
        )
        .toMatchObject({
          readingMode: 'page',
          spreadMode: 'single',
          pageEffect: 'fade',
          pageNavigationPlacement: 'fixed',
        });
      await options.screenshot({
        path: test.info().outputPath(`options-layout-${width}.png`),
        fullPage: true,
      });
      await options.reload();
      await expect(
        options.getByRole('button', { name: '항상 한 쪽', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      expect(errors).toEqual([]);
    } finally {
      await context?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (path.resolve(profile).startsWith(path.join(tmpdir(), 'unp-preset-layouts-')))
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
}
