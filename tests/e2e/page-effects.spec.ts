import { launchReadingContext } from '../helpers/reading-font-fixture';
import { test, expect, type BrowserContext, type Page, type CDPSession } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { defaults } from '../../src/shared/model/preferences';
// @ts-expect-error Synthetic fixture is a plain Node module.
import { viewerHtml } from '../fixtures/viewer.mjs';

let server: http.Server;
let base: string;
let context: BrowserContext;
let page: Page;
let profile: string;
let cdp: CDPSession;
let worlds: { id: number; name: string; origin: string }[];
test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url?.startsWith('/background.svg')) {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end(
        request.url.includes('pattern')
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><path fill="#2d5eb4" d="M0 0h720v900H0z"/><path fill="#ad7430" d="M720 0h720v900H720z"/></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="#2d5eb4" d="M0 0h2v2H0z"/></svg>'
      );
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(viewerHtml());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-effects-'));
  const extension = path.resolve('.output/chrome-mv3-e2e');
  context = await launchReadingContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(
    async (settings) => {
      await chrome.storage.sync.set({ 'unp.reader.v1': { schemaVersion: 1, data: settings } });
    },
    // Effect timing is independent of remote font arrival; that reflow has its own tests.
    { ...defaults, fontFamily: 'system-ui', maxWidth: 540, pageEffect: 'slide' }
  );
  page = await context.newPage();
  worlds = [];
  cdp = await context.newCDPSession(page);
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    worlds.push(context);
  });
  await cdp.send('Runtime.enable');
  await page.addInitScript(() => localStorage.setItem('viewer_paging', '1'));
  await page.goto(`${base}/viewer/1001`);
  await expect(page.locator('[data-unp-reader="page"]')).toBeVisible();
  await expect(page.locator('[data-unp-line]').first()).toBeVisible();
  await expect(page.locator('#unp-navigation-host')).toBeAttached();
  // Snapshot opacity after the initial reading-surface reveal has finished.
  await expect(page.locator('#unp-navigation-host')).toHaveCSS('opacity', '1');
});
test.afterEach(async () => {
  await context?.close();
  const resolved = path.resolve(profile);
  if (resolved.startsWith(path.join(tmpdir(), 'unp-effects-')))
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function setEffect(effect: string, patch: Record<string, unknown> = {}) {
  await context.serviceWorkers()[0]!.evaluate(
    async ({ effect, patch }) => {
      const raw = await chrome.storage.sync.get('unp.reader.v1');
      const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
      doc.data.pageEffect = effect;
      Object.assign(doc.data, patch);
      await chrome.storage.sync.set({ 'unp.reader.v1': doc });
    },
    { effect, patch }
  );
  await expect
    .poll(() => page.locator('[data-unp-reader]').getAttribute('data-unp-transition'))
    .toBeNull();
  // Storage event -> layout -> optional local paper module import.
  await page.waitForTimeout(120);
}
async function effectProbe() {
  const extensionId = new URL(context.serviceWorkers()[0]!.url()).host;
  let id: number | undefined;
  for (const world of worlds) {
    try {
      const result = await cdp.send('Runtime.evaluate', {
        contextId: world.id,
        expression: 'typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id',
        returnByValue: true,
      });
      if (result.result.value === extensionId) {
        id = world.id;
        break;
      }
    } catch {
      /* A world from the pre-navigation blank document is already gone. */
    }
  }
  expect(id).toBeDefined();
  await cdp.send('Runtime.evaluate', {
    contextId: id,
    expression: `(() => {
      const request = requestAnimationFrame.bind(globalThis), cancel = cancelAnimationFrame.bind(globalThis);
      const pending = new Set(); let calls = 0, paperCalls = 0, maskCalls = 0;
      globalThis.__unpEffectRaf = { snapshot: () => ({ pending: pending.size, calls, paperCalls, maskCalls }) };
      globalThis.requestAnimationFrame = (callback) => {
        const paper = callback.toString().includes('getUI');
        const mask = callback.toString().includes('clipPath');
        let ticket = request((time) => { pending.delete(ticket); if(paper||mask) calls++; if(paper)paperCalls++; if(mask)maskCalls++; callback(time); });
        if(paper||mask) pending.add(ticket); return ticket;
      };
      globalThis.cancelAnimationFrame = (ticket) => { pending.delete(ticket); cancel(ticket); };
    })()`,
  });
  return async () =>
    (
      await cdp.send('Runtime.evaluate', {
        contextId: id,
        expression: 'globalThis.__unpEffectRaf.snapshot()',
        returnByValue: true,
      })
    ).result.value as { pending: number; calls: number; paperCalls: number; maskCalls: number };
}

test('all five effects preserve final pages, clean transient layers, and honor motion preferences', async () => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  expect(await page.title()).toBe('UNP Synthetic Viewer');
  const probe = await effectProbe();
  const effects = ['slide', 'fade', 'paper', 'fold', 'none'];
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index]!;
    await setEffect(effect);
    const before = await page
      .locator('#novel_drawing_page_c')
      .evaluate((element) => element.scrollLeft);
    await page.keyboard.press('ArrowRight');
    if (effect !== 'none') {
      await expect(page.locator(`[data-unp-page-effect="${effect}"]`)).toBeAttached();
      if (index === 0) {
        const emphasis = page
          .locator('[data-unp-page-effect] span')
          .filter({ hasText: '작가가 지정한 굵은 글씨' });
        await expect(emphasis).toHaveCSS('font-weight', '700');
        const italic = page.locator('[data-unp-page-effect] span').filter({ hasText: '기울임' });
        await expect(italic).toHaveCSS('font-style', 'italic');
      }
      await expect(
        page.locator(
          '[data-unp-page-effect] iframe,[data-unp-page-effect] [data-service],[data-unp-page-effect] a,[data-unp-page-effect] button'
        )
      ).toHaveCount(0);
      if (effect === 'fold') {
        await page.waitForTimeout(100);
        await page.screenshot({ path: test.info().outputPath('paper-fold.png') });
      }
    }
    await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
    await expect
      .poll(() => page.locator('#novel_drawing_page_c').evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(before);
    await expect(page.locator('[data-unp-transition]')).toHaveCount(0);
    await expect.poll(async () => (await probe()).pending).toBe(0);
  }
  expect((await probe()).calls).toBeGreaterThan(0);
  expect((await probe()).paperCalls).toBeGreaterThan(0);
  expect((await probe()).maskCalls).toBeGreaterThan(0);
  await setEffect('fold');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-unp-page-effect="fold"]')).toBeAttached();
  await page.setViewportSize({ width: 1000, height: 760 });
  await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
  await expect.poll(async () => (await probe()).pending).toBe(0);
  expect(errors).toEqual([]);
});

test('single pages, rapid direction changes, and seek cancel paper without service clones', async () => {
  await setEffect('paper', { spreadMode: 'single', horizontalPadding: 45, verticalPadding: 30 });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-unp-page-effect="paper"]')).toBeAttached();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
  await expect(page.locator('[data-unp-transition]')).toHaveCount(0);
  const slider = page.locator('#unp-navigation-host input[type="range"]');
  await slider.fill('1');
  await slider.dispatchEvent('input');
  await slider.dispatchEvent('change');
  await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
  await expect(page.locator('#test-banner')).toBeVisible();
  await page.locator('#test-banner button').click();
  await expect(page.locator('#test-banner')).toHaveAttribute('data-clicked', 'yes');
});

test('page effects preserve hidden ancestor clipping and cumulative text and image opacity', async () => {
  await page.evaluate(async (base) => {
    const line = document.querySelector<HTMLElement>(
      '[data-unp-reader="page"] .line[data-line="1"]'
    )!;
    const fixture = document.createElement('span');
    fixture.id = 'snapshot-paint-fixture';
    fixture.innerHTML = `
      <p style="height:0;width:0;overflow:hidden;opacity:0;display:inline-block">HIDDEN_SNAPSHOT_DIRECT</p>
      <span style="opacity:0"><span>HIDDEN_SNAPSHOT_ANCESTOR</span><img width="24" height="14" src="${base}/background.svg?hidden-image-opacity"></span>
      <span style="display:inline-block;width:0;height:0;overflow:hidden"><span>HIDDEN_SNAPSHOT_ZERO_CLIP</span><img width="24" height="14" src="${base}/background.svg?hidden-image-clip"></span>
      <span style="visibility:hidden"><span>HIDDEN_SNAPSHOT_VISIBILITY</span></span>
      <span style="opacity:.5"><span style="opacity:.5">VISIBLE_DIMMED_TEXT</span><img style="opacity:.5" width="24" height="14" src="${base}/background.svg?visible-dimmed-image"></span>
      <span style="display:block;width:60px;height:24px;overflow:hidden;white-space:nowrap">PARTIAL_CLIP_TEXT</span>`;
    line.append(fixture);
    await Promise.all([...fixture.querySelectorAll('img')].map((image) => image.decode()));
  }, base);
  await setEffect('slide');
  const original = await page
    .locator('#snapshot-paint-fixture')
    .evaluate((element) => element.outerHTML);
  for (const effect of ['slide', 'fade', 'paper', 'fold']) {
    await setEffect(effect);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(`[data-unp-page-effect="${effect}"]`)).toBeAttached();
    const painted = await page.locator('[data-unp-page-effect]').evaluate((element) => {
      const spans = [...element.querySelectorAll<HTMLElement>('span')];
      const dimmed = spans.find((span) => span.textContent === 'VISIBLE_DIMMED_TEXT');
      const clipped = spans.find((span) => span.textContent === 'PARTIAL_CLIP_TEXT');
      const images = [...element.querySelectorAll<HTMLImageElement>('img')];
      return {
        text: element.textContent,
        dimmedOpacity: dimmed && getComputedStyle(dimmed).opacity,
        clipped: clipped && getComputedStyle(clipped).clipPath,
        images: images.map((image) => ({
          url: image.src,
          opacity: getComputedStyle(image).opacity,
        })),
      };
    });
    expect(painted.text).not.toContain('HIDDEN_SNAPSHOT_');
    expect(painted.dimmedOpacity).toBe('0.25');
    expect(painted.clipped).toMatch(/^inset\(/);
    expect(painted.images.some((image) => image.url.includes('hidden-image'))).toBe(false);
    expect(
      painted.images.find((image) => image.url.includes('visible-dimmed-image'))?.opacity
    ).toBe('0.25');
    await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
  }
  expect(
    await page.locator('#snapshot-paint-fixture').evaluate((element) => element.outerHTML)
  ).toBe(original);
});

test('native cover pages switch immediately in both directions while middle pages retain effects', async () => {
  await page.evaluate(() => {
    const cover = document.createElement('div');
    cover.className = 'cover-wrapper';
    cover.style.cssText = 'break-inside:avoid;padding:8px 0';
    cover.innerHTML =
      '<div class="cover-image" style="height:180px;background:#a8b4ca" hidden>합성 표지</div><button class="cover-text" type="button">커버보기</button>';
    const image = cover.querySelector<HTMLElement>('.cover-image')!;
    const button = cover.querySelector<HTMLButtonElement>('.cover-text')!;
    button.onclick = () => {
      image.hidden = !image.hidden;
      button.textContent = image.hidden ? '커버보기' : '커버접기';
    };
    document.getElementById('novel_drawing_page')!.prepend(cover);
    (window as unknown as { originalCover: Element }).originalCover = cover;
  });
  const slider = page.locator('#unp-navigation-host input[type="range"]');
  const paper = page.locator('#novel_drawing_page_c');
  const cover = page.locator('.cover-wrapper');
  const turn = (key: string) =>
    page.evaluate((key) => {
      const paper = document.getElementById('novel_drawing_page_c')!;
      const before = paper.scrollLeft;
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      return {
        before,
        after: paper.scrollLeft,
        transient: !!document.querySelector('[data-unp-live-turn],[data-unp-page-effect]'),
        original:
          document.querySelector('.cover-wrapper') ===
          (window as unknown as { originalCover: Element }).originalCover,
      };
    }, key);
  for (const spreadMode of ['single', 'auto']) {
    for (const expanded of [false, true]) {
      await slider.press('Home');
      const button = cover.getByRole('button');
      if ((await button.textContent()) !== (expanded ? '커버접기' : '커버보기'))
        await button.click();
      await expect(button).toHaveText(expanded ? '커버접기' : '커버보기');
      for (const effect of ['slide', 'fade', 'paper', 'fold']) {
        await setEffect(effect, { spreadMode, textAreaOpacity: 55 });
        await slider.press('Home');
        await page.locator('#header').click({ position: { x: 20, y: 20 } });
        await expect(paper).toHaveJSProperty('scrollLeft', 0);
        const originalStyle = await cover.getAttribute('style');
        for (const key of ['ArrowRight', 'ArrowLeft']) {
          const result = await turn(key);
          expect(result.transient).toBe(false);
          expect(result.original).toBe(true);
          expect(
            key === 'ArrowRight' ? result.after > result.before : result.after < result.before
          ).toBe(true);
          expect(await cover.getAttribute('style')).toBe(originalStyle);
        }
        await turn('ArrowRight');
        const ordinary = await turn('ArrowRight');
        expect(ordinary.transient).toBe(true);
        await expect(page.locator('[data-unp-live-turn],[data-unp-page-effect]')).toHaveCount(0);
        await slider.press('Home');
      }
    }
  }
  await expect(cover.getByRole('button')).toHaveText('커버접기');
  await cover.getByRole('button').click();
  await expect(cover.getByRole('button')).toHaveText('커버보기');
});

test('a cover-only page survives delayed native restore and reflow until the next reading gesture', async () => {
  await setEffect('paper', { spreadMode: 'single' });
  await page.evaluate(() => {
    const cover = document.createElement('div');
    cover.className = 'cover-wrapper';
    cover.style.cssText = 'break-after:column;height:240px';
    cover.innerHTML = '<div class="cover-text">커버접기</div>';
    document.getElementById('novel_drawing_page')!.prepend(cover);
  });
  const slider = page.locator('#unp-navigation-host input[type="range"]');
  const paper = page.locator('#novel_drawing_page_c');
  await slider.press('End');
  await slider.press('Home');
  await page.locator('#header').click({ position: { x: 20, y: 20 } });
  // Wait across scroll/layout callbacks, not just the synchronous scrollTo call.
  await expect
    .poll(async () => {
      const positions = await paper.evaluate(async (element) => {
        const result: number[] = [];
        for (let frame = 0; frame < 6; frame++) {
          await new Promise(requestAnimationFrame);
          result.push(element.scrollLeft);
        }
        return result;
      });
      return positions.every((position) => position === 0);
    })
    .toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => paper.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => paper.evaluate((el) => el.scrollLeft)).toBe(0);
  await page.waitForTimeout(150);
  await expect(paper).toHaveJSProperty('scrollLeft', 0);
  await expect(page.locator('[data-unp-live-turn],[data-unp-page-effect]')).toHaveCount(0);
  const worker = context.serviceWorkers()[0]!;
  const savedPosition = () =>
    worker.evaluate(async () => await chrome.storage.local.get('unp.position.v1.1001'));
  // Let any earlier text-position save finish before testing obsolete native callbacks.
  await page.waitForTimeout(350);
  const previousPosition = await savedPosition();
  const nativeTurn = () =>
    page.evaluate(() => (window as unknown as { page_goto: (n: number) => void }).page_goto(4));
  await nativeTurn();
  await expect.poll(() => paper.evaluate((el) => el.scrollLeft)).toBe(0);
  await setEffect('fade', { fontSize: 26 });
  await expect(page.locator('[data-unp-line]').first()).toHaveCSS('font-size', '26px');
  await nativeTurn();
  await expect.poll(() => paper.evaluate((el) => el.scrollLeft)).toBe(0);
  await page.waitForTimeout(350);
  expect(await savedPosition()).toEqual(previousPosition);
  await page.screenshot({ path: test.info().outputPath('cover-intent-preserved.png') });
  // A real reading gesture releases the guard before the site's own movement.
  await paper.dispatchEvent('wheel', { deltaY: 100, bubbles: true });
  await nativeTurn();
  await expect.poll(() => paper.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  expect(await paper.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test('final spreads switch immediately in both directions for every effect and column mode', async () => {
  await page.addStyleTag({ content: '.curation-wrapper { display:block !important }' });
  await page.evaluate(() => {
    const service = document.createElement('aside');
    service.id = 'terminal-service';
    service.dataset.service = 'ad';
    service.style.cssText =
      'display:block;break-inside:avoid;height:100px;padding:20px;background:rgb(29,190,146);color:black';
    service.innerHTML = '<button type="button">합성 서비스 버튼</button>';
    service.querySelector('button')!.addEventListener('click', () => {
      service.dataset.clicked = String(Number(service.dataset.clicked || 0) + 1);
    });
    document.getElementById('novel_drawing_page')!.append(service);
    (window as unknown as { originalService: Element }).originalService = service;
  });
  const paper = page.locator('#novel_drawing_page_c');
  const service = page.locator('#terminal-service');
  const originalStyle = await service.getAttribute('style');
  const slider = page.locator('#unp-navigation-host input[type="range"]');
  for (const spreadMode of ['single', 'auto']) {
    for (const effect of ['slide', 'fade', 'paper', 'fold']) {
      await setEffect(effect, { textAreaOpacity: 55, spreadMode });
      await slider.press('End');
      await page.locator('#header').click({ position: { x: 20, y: 20 } });
      const last = await paper.evaluate((el) => el.scrollLeft);
      for (const key of ['ArrowLeft', 'ArrowRight']) {
        const turn = await page.evaluate((key) => {
          const paper = document.getElementById('novel_drawing_page_c')!;
          const before = paper.scrollLeft;
          document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
          return {
            before,
            after: paper.scrollLeft,
            transient: !!document.querySelector('[data-unp-live-turn],[data-unp-page-effect]'),
            original:
              document.getElementById('terminal-service') ===
              (window as unknown as { originalService: Element }).originalService,
          };
        }, key);
        expect(turn.transient).toBe(false);
        expect(turn.original).toBe(true);
        expect(key === 'ArrowLeft' ? turn.after < turn.before : turn.after > turn.before).toBe(
          true
        );
        expect(await service.getAttribute('style')).toBe(originalStyle);
      }
      expect(await paper.evaluate((el) => el.scrollLeft)).toBe(last);
      await service.getByRole('button').click();
      await page.locator('#header').click({ position: { x: 20, y: 20 } });
    }
  }
  await expect(service).toHaveAttribute('data-clicked', '8');
  await page.locator('#btn_theme').click();
  await page.getByRole('button', { name: '레이아웃 설정으로 이동', exact: true }).click();
  const label = page.locator('.label-help').filter({ hasText: /^페이지 효과$/ });
  for (const width of [1440, 390]) {
    await page.getByRole('button', { name: '레이아웃 설정으로 이동', exact: true }).focus();
    await page.setViewportSize({ width, height: 900 });
    await label.scrollIntoViewIfNeeded();
    await label.focus();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText('커버가 있는 쪽과 마지막 쪽');
    expect(await tip.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`terminal-tooltip-${width}.png`) });
    await page.keyboard.press('Escape');
  }
});

test('late in-flow recommendations recount the terminal page without losing the end position', async () => {
  await page.evaluate(() => {
    const service = document.createElement('aside');
    service.id = 'late-terminal-service';
    service.dataset.service = 'ad';
    service.style.cssText = 'break-inside:avoid;height:100px;padding:20px';
    service.innerHTML = '<button type="button">마지막 합성 서비스</button>';
    service.querySelector('button')!.addEventListener('click', () => {
      service.dataset.clicked = 'yes';
    });
    document.getElementById('novel_drawing_page')!.append(service);
  });
  const slider = page.locator('#unp-navigation-host input[type="range"]');
  await slider.press('End');
  const visible = () =>
    page.locator('#late-terminal-service').evaluate((service) => {
      const rect = service.getBoundingClientRect();
      const view = document.getElementById('novel_drawing_page_c')!.getBoundingClientRect();
      return rect.left >= view.left && rect.right <= view.right;
    });
  await expect.poll(visible).toBe(true);
  await expect(page.getByRole('button', { name: '다음 쪽', exact: true })).toBeDisabled();
  // Hide, then show the native recommendation again through normal page navigation.
  await slider.press('ArrowLeft');
  await expect(page.locator('.curation-wrapper')).toBeHidden();
  await slider.press('End');
  await expect.poll(visible).toBe(true);
  await expect(page.locator('.curation-wrapper')).toBeVisible();
  await page.locator('#late-terminal-service button').click();
  await expect(page.locator('#late-terminal-service')).toHaveAttribute('data-clicked', 'yes');
});

test('effects keep their local origin under native transformed containing blocks and adjustable page gaps', async () => {
  await page.evaluate(() => {
    const box = document.getElementById('novel_box')!;
    box.setAttribute('onclick', 'void 0');
    document.getElementById('novel_drawing_page')!.setAttribute('onclick', 'void 0');
    box.style.cssText +=
      ';will-change:transform;position:relative;left:11px;top:17px;width:calc(100% - 22px);height:calc(100vh - 34px)';
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  for (const gap of [0, 160, 400]) {
    for (const effect of ['slide', 'paper', 'fold']) {
      await setEffect(effect, { pageGap: gap, maxWidth: 500, verticalPadding: 32 });
      const before = await page.locator('#novel_drawing_page_c').boundingBox();
      await page.evaluate(() => {
        const state = window as unknown as { effectOrigins: number[][] };
        state.effectOrigins = [];
        const deadline = performance.now() + 1000;
        let observed = false;
        const sample = () => {
          const host = document.querySelector<HTMLElement>('[data-unp-page-effect]');
          if (host) {
            observed = true;
            const reference = document
              .getElementById('novel_drawing_page_c')!
              .getBoundingClientRect();
            const bounds = host.getBoundingClientRect();
            const book = host.querySelector('.stf__block')?.getBoundingClientRect();
            state.effectOrigins.push([
              bounds.left - reference.left,
              bounds.top - reference.top,
              bounds.width - reference.width,
              bounds.height - reference.height,
              book ? book.top - bounds.top : 0,
            ]);
          }
          if (host || (!observed && performance.now() < deadline)) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.keyboard.press('ArrowRight');
      await expect(page.locator(`[data-unp-page-effect="${effect}"]`)).toBeAttached();
      await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
      const samples = await page.evaluate(
        () => (window as unknown as { effectOrigins: number[][] }).effectOrigins
      );
      expect(samples.length).toBeGreaterThan(0);
      expect(Math.max(...samples.flat().map(Math.abs))).toBeLessThan(0.6);
      expect(await page.locator('#novel_drawing_page_c').boundingBox()).toEqual(before);
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
    }
  }
});

test('decoded reader background paints behind text, fades optionally, and never changes page geometry', async () => {
  await page.evaluate(() => {
    const recorded = window as unknown as { backgroundAnimations: number[] };
    recorded.backgroundAnimations = [];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement && node.hasAttribute('data-unp-background'))
            recorded.backgroundAnimations.push(node.getAnimations().length);
    }).observe(document.body, { subtree: true, childList: true });
  });
  const before = await page.locator('#novel_drawing_page_c').boundingBox();
  await setEffect('none', {
    backgroundType: 'image',
    backgroundImage: `${base}/background.svg`,
    backgroundImageSource: 'url',
    backgroundImageFade: true,
    overlayOpacity: 0,
  });
  const layer = page.locator('[data-unp-background]');
  await expect(layer).toHaveCount(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { backgroundAnimations: number[] }).backgroundAnimations[0]
    )
  ).toBe(1);
  await expect
    .poll(() =>
      layer.evaluate(
        (element) =>
          element.getAnimations().filter((animation) => animation.playState === 'running').length
      )
    )
    .toBe(0);
  const png = await page.screenshot({ clip: { x: 4, y: 100, width: 2, height: 2 } });
  const color = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }, png.toString('base64'));
  expect(color).toEqual([45, 94, 180]);
  expect(await page.locator('#novel_drawing_page_c').boundingBox()).toEqual(before);
  await setEffect('none', {
    backgroundImage: `${base}/background.svg?replacement=1`,
    backgroundImageFade: false,
  });
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveCSS('opacity', '1');
  expect(await layer.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { backgroundAnimations: number[] }).backgroundAnimations.at(-1)
    )
  ).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setEffect('none', {
    backgroundImage: `${base}/background.svg?replacement=2`,
    backgroundImageFade: true,
  });
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveCSS('opacity', '1');
  expect(await layer.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { backgroundAnimations: number[] }).backgroundAnimations.at(-1)
    )
  ).toBe(0);
  await setEffect('none', { backgroundType: 'color' });
  await expect(layer).toHaveCount(0);
  expect(await page.locator('#novel_drawing_page_c').boundingBox()).toEqual(before);
});

test('first fixed terminal recommendation reserves space without a terminal effect or lost end position', async () => {
  await setEffect('fold');
  await page.goto(`${base}/viewer/1001?terminal`);
  await expect(page.locator('[data-unp-reader="page"]')).toBeVisible();
  const slider = page.locator('#unp-navigation-host input[type="range"]');
  await expect.poll(async () => Number(await slider.getAttribute('max'))).toBeGreaterThan(1);
  await expect(page.locator('#fixed-curation')).toBeHidden();
  const last = Number(await slider.getAttribute('max'));
  await slider.fill(String(last - 1));
  await page.locator('#header').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
  await page.evaluate(() => {
    const state = window as unknown as {
      terminalFrames: {
        reader: number[];
        effect: number[] | null;
        service: number[] | null;
        value: string;
        max: string;
      }[];
    };
    state.terminalFrames = [];
    const start = performance.now();
    const sample = () => {
      const reader = document.getElementById('novel_drawing_page_c')!.getBoundingClientRect();
      const effect = document
        .querySelector('[data-unp-page-effect],[data-unp-live-turn]')
        ?.getBoundingClientRect();
      const service = document.getElementById('fixed-curation')!.getBoundingClientRect();
      const slider = document
        .querySelector('#unp-navigation-host')!
        .shadowRoot!.querySelector('input')!;
      state.terminalFrames.push({
        reader: [reader.top, reader.height],
        effect: effect ? [effect.top, effect.height] : null,
        service: service.height ? [service.top, service.height] : null,
        value: slider.value,
        max: slider.max,
      });
      if (performance.now() - start < 1200) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#fixed-curation')).toBeVisible();
  await page.waitForTimeout(1300);
  const frames = await page.evaluate(
    () =>
      (
        window as unknown as {
          terminalFrames: {
            reader: number[];
            effect: number[] | null;
            service: number[] | null;
            value: string;
            max: string;
          }[];
        }
      ).terminalFrames
  );
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((frame) => frame.effect === null)).toBe(true);
  expect(frames.at(-1)!.value).toBe(frames.at(-1)!.max);
  const final = frames.at(-1)!;
  expect(final.reader[0]! + final.reader[1]!).toBeLessThanOrEqual(final.service![0]! - 10);
});

test('translucent sheets preserve background colors and occlude text on the sheet below', async () => {
  const paper = page.locator('#novel_drawing_page_c');
  const pixel = async (x: number, y: number) => {
    const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
    return page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }, png.toString('base64'));
  };
  for (const image of [false, true])
    for (const opacity of [0, 40, 100]) {
      await setEffect('slide', {
        backgroundType: image ? 'image' : 'color',
        backgroundImage: `${base}/background.svg?pattern`,
        backgroundImageFade: false,
        backgroundColor: '#204060',
        textAreaBackgroundColor: '#e8d6b4',
        textAreaOpacity: opacity,
      });
      if (image) await expect(page.locator('[data-unp-background]')).toBeAttached();
      await page.locator('#unp-navigation-host input').press('Home');
      await page.locator('#header').click({ position: { x: 20, y: 20 } });
      const bounds = (await paper.boundingBox())!;
      const point = { x: Math.round(bounds.x + 80), y: Math.round(bounds.y + 3) };
      const before = await pixel(point.x, point.y);
      // Freeze the real source/destination presentation at a deliberately overlapping
      // position: the paper, including at alpha 0, must occlude lower-page glyphs.
      await page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        const host = document.querySelector<HTMLElement>('[data-unp-page-effect="slide"]')!;
        const incoming = host.children[0] as HTMLElement;
        for (const animation of host.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime =
            (animation.effect as KeyframeEffect).target === incoming ? 240 : 0;
        }
        const marker = document.createElement('span');
        marker.style.cssText =
          'position:absolute;left:0;top:0;width:200px;height:20px;background:red';
        incoming.append(marker);
      });
      const during = await pixel(point.x, point.y);
      // The Windows software compositor can round an 8-bit blend by one level
      // compared with a separate animated layer. Keep alpha exact and allow
      // only that rounding error; the deliberately red lower sheet must stay hidden.
      for (let channel = 0; channel < 4; channel++)
        expect(
          Math.abs(during[channel]! - before[channel]!),
          `image=${image}, alpha=${opacity}, channel=${channel}`
        ).toBeLessThanOrEqual(channel === 3 ? 0 : 1);
      await page.locator('#unp-navigation-host input').press('Home');
      await expect(page.locator('[data-unp-page-effect]')).toHaveCount(0);
    }
});

test('terminal turns cancel previous effects and keep position across resize and settings changes', async () => {
  await page.addStyleTag({ content: '.curation-wrapper { display:block !important }' });
  await page.locator('#unp-navigation-host input').press('End');
  await setEffect('paper');
  await page.locator('#header').click({ position: { x: 20, y: 20 } });
  const paper = page.locator('#novel_drawing_page_c');
  const last = await paper.evaluate((el) => el.scrollLeft);
  await page.keyboard.press('ArrowLeft');
  expect(await paper.getAttribute('data-unp-live-turn')).toBeNull();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-unp-live-turn],[data-unp-page-effect]')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await page.locator('[data-unp-live-turn],[data-unp-page-effect]').count()).toBe(0);
  expect(await paper.evaluate((el) => el.scrollLeft)).toBe(last);
  await page.keyboard.press('ArrowLeft');
  await page.setViewportSize({ width: 1050, height: 780 });
  await expect(paper).not.toHaveAttribute('data-unp-live-turn');
  await expect(paper).toHaveCSS('transform', 'none');
  await page.locator('#unp-navigation-host input').press('End');
  await page.locator('#header').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('ArrowLeft');
  await setEffect('fold', { horizontalPadding: 40 });
  await expect(paper).not.toHaveAttribute('data-unp-live-turn');
  await expect(paper).toHaveCSS('transform', 'none');
  await expect(paper).toHaveCSS('clip-path', 'none');
});
