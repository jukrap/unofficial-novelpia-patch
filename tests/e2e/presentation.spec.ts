import { test, expect, type BrowserContext } from '@playwright/test';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { launchReadingContext } from '../helpers/reading-font-fixture';
// @ts-expect-error Synthetic text only.
import { viewerHtml } from '../fixtures/viewer.mjs';

interface PresentationFrame {
  time: number;
  preparing: boolean;
  paper: string;
  alpha: number;
  lines: number[];
  frame: number[];
  position: number;
  navigation: boolean;
}

for (const sample of [
  { mode: 'scroll', storageDelay: 3800, navigationDelay: 800 },
  { mode: 'page', storageDelay: 800, navigationDelay: 3800 },
  { mode: 'scroll', storageDelay: 6500, navigationDelay: 100 },
] as const) {
  test(`initial ${sample.mode} presentation stays atomic with position ${sample.storageDelay}ms and navigation ${sample.navigationDelay}ms`, async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'unp-presentation-'));
    const extension = path.join(workspace, 'extension');
    let context: BrowserContext | undefined;
    const server = http.createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(viewerHtml());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await cp(path.resolve('.output/chrome-mv3-e2e'), extension, { recursive: true });
      const contentFile = path.join(extension, 'content-scripts/content.js');
      await writeFile(
        contentFile,
        `{
        const original=chrome.storage.local.get.bind(chrome.storage.local);
        chrome.storage.local.get=(keys)=>{
          const result=original(keys);
          return String(keys).includes('unp.position.v1.')
            ? result.then(value=>new Promise(resolve=>setTimeout(()=>resolve(value),${sample.storageDelay})))
            : result;
        };
      }\n${await readFile(contentFile, 'utf8')}`
      );
      const directory = path.join(extension, 'content-scripts/esm');
      const navigation = (await readdir(directory)).find((name) =>
        /^navigation-runtime-.*\.js$/.test(name)
      )!;
      expect(navigation).toBeTruthy();
      const navigationFile = path.join(directory, navigation);
      await writeFile(
        navigationFile,
        `await new Promise(resolve=>setTimeout(resolve,${sample.navigationDelay}));\n${await readFile(navigationFile, 'utf8')}`
      );
      context = await launchReadingContext(path.join(workspace, 'profile'), {
        channel: 'chromium',
        headless: true,
        viewport: { width: 1440, height: 900 },
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await worker.evaluate(async () => {
        await chrome.storage.sync.set({
          'unp.reader.v1': {
            schemaVersion: 1,
            data: {
              enabled: true,
              fontFamily: 'system-ui',
              textAreaOpacity: 65,
              textAreaBackgroundColor: '#dce8f4',
              readerHeightPercent: 70,
              pageNavigationPlacement: 'reserved',
            },
          },
        });
        await chrome.storage.local.set({
          'unp.position.v1.1001': {
            episodeId: '1001',
            blockKey: '50',
            textOffset: 0,
            edge: 'text',
          },
        });
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((mode) => {
        localStorage.setItem('viewer_paging', mode === 'page' ? '1' : '0');
        const snapshots: PresentationFrame[] = [];
        Object.assign(window, { presentationFrames: snapshots });
        const tick = () => {
          const body = document.querySelector<HTMLElement>('[data-unp-reader]');
          const frame = document.querySelector<HTMLElement>(
            mode === 'page' ? '#novel_drawing_page_c' : '#novel_box'
          );
          const paper = document.querySelector<HTMLElement>(
            mode === 'page' ? '#novel_drawing_page_c' : '#novel_text'
          );
          const rect = frame?.getBoundingClientRect();
          const visible = (element: Element) => {
            const style = getComputedStyle(element);
            return (
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              Number(style.opacity) > 0.02 &&
              [...element.getClientRects()].some(
                (r) =>
                  r.width > 0 &&
                  r.height > 0 &&
                  r.right > (rect?.left ?? 0) &&
                  r.left < (rect?.right ?? innerWidth) &&
                  r.bottom > (rect?.top ?? 0) &&
                  r.top < (rect?.bottom ?? innerHeight)
              )
            );
          };
          const navigation = document.getElementById('unp-navigation-host');
          snapshots.push({
            time: performance.now(),
            preparing: document.documentElement.hasAttribute('data-unp-preparing'),
            paper: paper ? getComputedStyle(paper).backgroundColor : '',
            alpha:
              Number.parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue('--unp-initial-alpha')
              ) || 0,
            lines: body
              ? [...body.querySelectorAll<HTMLElement>('[data-unp-line]')]
                  .filter(visible)
                  .map((line) => Number(line.dataset.line))
              : [],
            frame: rect ? [rect.x, rect.y, rect.width, rect.height] : [],
            position: frame ? (mode === 'page' ? frame.scrollLeft : frame.scrollTop) : 0,
            navigation:
              !!navigation &&
              navigation.getBoundingClientRect().height > 0 &&
              getComputedStyle(navigation).visibility !== 'hidden' &&
              Number(getComputedStyle(navigation).opacity) > 0.02,
          });
          if (performance.now() < 12000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, sample.mode);
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/viewer/1001`
      );
      await expect(page.locator('[data-unp-line]').first()).toBeAttached();
      await page.waitForTimeout(3150);
      await expect(page.locator('[data-unp-line]').first()).toBeHidden();
      await expect(page.locator('#test-banner')).toBeVisible();
      await page.locator('#test-banner button').click();
      await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
      await expect(page.locator('html')).not.toHaveAttribute('data-unp-preparing', '', {
        timeout: 6000,
      });
      await page.waitForTimeout(sample.storageDelay > 5000 ? 2100 : 1000);
      const history = await page.evaluate(
        () => (window as unknown as { presentationFrames: PresentationFrame[] }).presentationFrames
      );
      await writeFile(test.info().outputPath('presentation-frames.json'), JSON.stringify(history));
      await page.screenshot({ path: test.info().outputPath('presentation.png') });
      const shown = history.filter((frame) => frame.lines.length);
      expect(shown.length).toBeGreaterThan(5);
      const first = shown[0]!;
      expect(
        history
          .filter((frame) => frame.preparing && frame.frame.length)
          .every((frame) => /, 0\)$/.test(frame.paper))
      ).toBe(true);
      expect(first.time).toBeGreaterThan(sample.storageDelay > 5000 ? 4900 : 3600);
      expect(shown.filter((frame) => frame.alpha > 0 && frame.alpha < 1).length).toBeGreaterThan(1);
      const settled = shown.filter((frame) => frame.time >= first.time + 400);
      for (const frame of settled) {
        expect(frame.frame).toEqual(first.frame);
        expect(Math.abs(frame.position - first.position)).toBeLessThanOrEqual(1);
        expect(frame.navigation).toBe(true);
      }
      if (sample.storageDelay < 5000) expect(first.lines).toContain(50);
      else {
        expect(history.at(-1)!.time).toBeGreaterThan(sample.storageDelay + 500);
        expect(first.position).toBeLessThanOrEqual(1);
        expect(
          await worker.evaluate(
            async () =>
              (await chrome.storage.local.get('unp.position.v1.1001'))['unp.position.v1.1001']
          )
        ).toMatchObject({ blockKey: '50' });
      }
      expect(errors).toEqual([]);
    } finally {
      await context?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (path.resolve(workspace).startsWith(path.join(tmpdir(), 'unp-presentation-')))
        await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
}
