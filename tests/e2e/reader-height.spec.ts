import { launchReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { defaults } from '../../src/shared/model/preferences';
// @ts-expect-error Synthetic fixture is a plain Node module.
import { viewerHtml } from '../fixtures/viewer.mjs';

test('a 40 percent scroll viewport retains its terminal note, full background and native service access', async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(
      viewerHtml().replace(
        '</style>',
        '@media(max-width:500px){#fixed-curation{height:350px!important}}</style>'
      )
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(path.join(tmpdir(), 'unp-height-'));
  const extension = path.resolve('.output/chrome-mv3-e2e');
  let context: BrowserContext | undefined;
  try {
    context = await launchReadingContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async (data) => chrome.storage.sync.set({ 'unp.reader.v1': { schemaVersion: 1, data } }),
      {
        ...defaults,
        pageNavigationPlacement: 'reserved',
        readerHeightPercent: 40,
        pageEffect: 'none',
        backgroundColor: '#b7c5e0',
      }
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/viewer/1001?terminal`
    );
    const box = page.locator('#novel_box');
    await expect(page.locator('[data-unp-reader="scroll"]')).toBeVisible();
    const slider = page.getByRole('slider', { name: '본문 읽기 진행률', exact: true });
    await expect(slider).toBeVisible();
    await slider.press('End');
    const service = page.locator('#fixed-curation');
    await expect(service).toBeVisible();
    await expect.poll(() => slider.inputValue()).toBe('1000');
    const first = (await box.boundingBox())!;
    const note = (await page.locator('#writer_comments_box').boundingBox())!;
    const end = (await page.locator('#episode-end').boundingBox())!;
    const recommendation = (await service.boundingBox())!;
    expect(note.y + note.height).toBeGreaterThan(first.y);
    expect(note.y).toBeLessThan(first.y + first.height);
    expect(end.y + end.height).toBeLessThanOrEqual(first.y + first.height + 1);
    expect(first.y + first.height).toBeLessThan(recommendation.y);
    await expect(page.locator('[data-unp-background-base]')).toHaveCSS('height', '900px');
    await page.waitForTimeout(400);
    expect(await box.boundingBox()).toEqual(first);
    await expect(slider).toHaveValue('1000');
    for (const viewport of [
      { width: 390, height: 760 },
      { width: 1440, height: 900 },
    ]) {
      // The native fixed recommendation stays open while both viewport axes change.
      // Its reservation must use the new full viewport, not the previous frame.
      await page.setViewportSize(viewport);
      await expect(page.locator('[data-unp-background-base]')).toHaveCSS(
        'height',
        `${viewport.height}px`
      );
      await expect(service).toBeVisible();
      await expect
        .poll(async () => {
          const bar = (await page.locator('#unp-navigation-host').boundingBox())!;
          const region = (await service.boundingBox())!;
          const actual = (await box.boundingBox())!;
          const reserved = viewport.height - region.y + 12;
          const expected = (viewport.height - 64 - reserved - bar.height - 16) * 0.4;
          return Math.abs(actual.height - expected);
        })
        .toBeLessThanOrEqual(1);
      await expect(slider).toHaveValue('1000');
    }
    expect(await box.boundingBox()).toEqual(first);
    await service.getByRole('button').click();
    await expect(page.locator('body')).toHaveAttribute('data-curation-clicked', '1');
    await page.mouse.move(recommendation.x + 50, recommendation.y + 100);
    await page.mouse.wheel(0, -500);
    await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(1000);
    await expect(service).toBeHidden();
    expect(await box.boundingBox()).toEqual(first);
    await page.setViewportSize({ width: 1440, height: 760 });
    await expect(page.locator('[data-unp-background-base]')).toHaveCSS('height', '760px');
    await expect.poll(async () => (await box.boundingBox())!.height).toBeLessThan(first.height);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (path.resolve(profile).startsWith(path.join(tmpdir(), 'unp-height-')))
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
