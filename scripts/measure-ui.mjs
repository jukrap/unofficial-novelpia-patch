// Repeatable synthetic MV3 measurements; no live site or account data.
import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { viewerHtml } from '../tests/fixtures/viewer.mjs';

const destination = resolve(process.argv[2] ?? 'test-results/performance');
await mkdir(destination, { recursive: true });
const extension = resolve('.output/chrome-mv3-e2e');
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
if (
  !manifest.content_scripts.some((script) =>
    script.matches.some((url) => url.includes('127.0.0.1'))
  )
)
  throw new Error('pnpm run build:e2e로 합성 검사 빌드를 준비해 주세요.');
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(viewerHtml());
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const rows = [];
try {
  for (let sample = 0; sample < 5; sample++) {
    const profile = await mkdtemp(join(tmpdir(), 'unp-measure-'));
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        viewport: { width: 1440, height: 900 },
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const id = new URL(worker.url()).host;
      for (const surface of ['home', 'popup', 'viewer']) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
          window.__unpMeasure = { visibleAt: null };
          const check = () => {
            const ui = document.querySelector(
              '.management-page, .popup-content:not([aria-hidden="true"])'
            );
            const line = document.querySelector('[data-unp-line]');
            const ready =
              ui ||
              (line &&
                getComputedStyle(line).visibility !== 'hidden' &&
                !document.documentElement.hasAttribute('data-unp-preparing'));
            if (ready) window.__unpMeasure.visibleAt = performance.now();
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
        const session = await context.newCDPSession(page);
        await session.send('Performance.enable');
        const url =
          surface === 'viewer'
            ? `http://127.0.0.1:${server.address().port}/viewer/1001`
            : `chrome-extension://${id}/${surface === 'home' ? 'options' : 'popup'}.html`;
        await page.goto(url);
        await page.waitForFunction(() => window.__unpMeasure.visibleAt !== null);
        const values = await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          return {
            visibleMs: window.__unpMeasure.visibleAt,
            readyMs: performance.now(),
            jsResources: performance
              .getEntriesByType('resource')
              .filter((r) => r.name.endsWith('.js')).length,
          };
        });
        const { metrics } = await session.send('Performance.getMetrics');
        rows.push({
          sample,
          surface,
          ...values,
          errors,
          ...Object.fromEntries(
            metrics
              .filter((m) => ['JSHeapUsedSize', 'ScriptDuration', 'TaskDuration'].includes(m.name))
              .map((m) => [m.name, m.value])
          ),
        });
        if (sample === 0) await page.screenshot({ path: join(destination, `${surface}.png`) });
        await page.close();
      }
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
await writeFile(join(destination, 'metrics.json'), JSON.stringify(rows, null, 2));
for (const surface of ['home', 'popup', 'viewer']) {
  const samples = rows.filter((row) => row.surface === surface);
  const median = (key) => samples.map((row) => row[key]).sort((a, b) => a - b)[2];
  console.log(
    JSON.stringify({
      surface,
      medianVisibleMs: median('visibleMs'),
      medianReadyMs: median('readyMs'),
      medianHeapBytes: median('JSHeapUsedSize'),
      errors: samples.flatMap((row) => row.errors),
    })
  );
}
