import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaults } from '../../src/shared/model/preferences';
let context: BrowserContext;
let profile: string;
test.beforeAll(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'unp-live-'));
  const extension = path.resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.addCookies([{ name: 'NAVIGATION', value: '1', domain: 'novelpia.com', path: '/' }]);
});
test.afterAll(async () => {
  await context?.close();
  if (profile.startsWith(path.join(tmpdir(), 'unp-live-')))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('live terminal viewer 6118160 skips every effect in both directions and keeps its original next button', async () => {
  test.setTimeout(90000);
  const page = await context.newPage();
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const originalSettings = await worker.evaluate(() => chrome.storage.sync.get('unp.reader.v1'));
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (error.stack?.includes('chrome-extension://')) errors.push(error.message);
  });
  await page.addInitScript(() => localStorage.setItem('viewer_paging', '1'));
  try {
    await page.goto('https://novelpia.com/viewer/6118160', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-unp-line]').first()).toBeVisible({ timeout: 30000 });
    const campaign = page.locator('.banner-modal-background.show');
    if (await campaign.isVisible())
      await page
        .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
        .click({ timeout: 15000 });
    await page.addLocatorHandler(campaign, async () => {
      await page
        .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
        .click({ timeout: 15000 });
    });
    const button = page.locator('#next_epi_btn_bottom');
    const identity = await button.elementHandle();
    const paper = page.locator('#novel_drawing_page_c');
    for (const [index, effect] of ['slide', 'fade', 'paper', 'fold'].entries()) {
      await worker.evaluate(
        async ({ effect, index }) => {
          const raw = await chrome.storage.sync.get('unp.reader.v1');
          const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
          Object.assign(doc.data, {
            pageEffect: effect,
            maxWidth: 540,
            verticalPadding: index + 10,
            textAreaOpacity: 60,
            backgroundColor: '#204060',
            spreadMode: index % 2 ? 'single' : 'auto',
          });
          await chrome.storage.sync.set({ 'unp.reader.v1': doc });
        },
        { effect, index }
      );
      await expect(page.locator('[data-unp-reader="page"]')).toHaveCSS(
        'margin-top',
        `${index + 10}px`
      );
      // Native menus can auto-hide. Use the owned range's input contract to seek,
      // then actual keyboard input for the immediate terminal turns being verified.
      await page.locator('#unp-navigation-host input').evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = input.max;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
      });
      await expect
        .poll(() =>
          button.evaluate((el) => {
            const r = el.getBoundingClientRect(),
              v = document.getElementById('novel_drawing_page_c')!.getBoundingClientRect();
            return r.left >= v.left && r.right <= v.right;
          })
        )
        .toBe(true);
      const last = await paper.evaluate((el) => el.scrollLeft);
      for (const key of ['ArrowLeft', 'ArrowRight']) {
        const before = await paper.evaluate((el) => el.scrollLeft);
        await page.keyboard.press(key);
        expect(await page.locator('[data-unp-live-turn],[data-unp-page-effect]').count()).toBe(0);
        const after = await paper.evaluate((el) => el.scrollLeft);
        expect(key === 'ArrowLeft' ? after < before : after > before).toBe(true);
      }
      await expect.poll(() => paper.evaluate((el) => el.scrollLeft)).toBe(last);
      expect(await button.evaluate((el, original) => el === original, identity)).toBe(true);
      await expect(paper).toHaveCSS('transform', 'none');
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    if (originalSettings['unp.reader.v1'])
      await worker.evaluate((raw) => chrome.storage.sync.set(raw), originalSettings);
  }
});
test('live cover viewer 58128 skips turns at the native cover and preserves its toggle', async () => {
  test.setTimeout(90000);
  await context.addCookies([
    { name: 'COVER_OPEN', value: '1', domain: '.novelpia.com', path: '/' },
  ]);
  const page = await context.newPage();
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const originalSettings = await worker.evaluate(() => chrome.storage.sync.get('unp.reader.v1'));
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (error.stack?.includes('chrome-extension://')) errors.push(error.message);
  });
  await page.addInitScript(() => localStorage.setItem('viewer_paging', '1'));
  try {
    await page.goto('https://novelpia.com/viewer/58128', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-unp-line]').first()).toBeVisible({ timeout: 30000 });
    await page.addLocatorHandler(page.locator('.banner-modal-background.show'), async () => {
      await page
        .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
        .click({ timeout: 15000 });
    });
    const control = page.locator('.cover-wrapper .cover-text');
    const cover = page.locator('.cover-wrapper .cover-img');
    const paper = page.locator('#novel_drawing_page_c');
    const seekStart = async () => {
      await page.locator('#unp-navigation-host input').evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = '0';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
      });
      await expect.poll(() => paper.evaluate((el) => el.scrollLeft)).toBe(0);
    };
    let revision = 10;
    for (const spreadMode of ['single', 'auto']) {
      for (const expanded of [true, false]) {
        for (const pageEffect of ['slide', 'fade', 'paper', 'fold']) {
          const verticalPadding = revision++;
          await worker.evaluate(
            async (patch) => {
              const raw = await chrome.storage.sync.get('unp.reader.v1');
              const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
              Object.assign(doc.data, patch);
              await chrome.storage.sync.set({ 'unp.reader.v1': doc });
            },
            { pageEffect, spreadMode, verticalPadding, maxWidth: 540, textAreaOpacity: 60 }
          );
          await expect(page.locator('[data-unp-reader="page"]')).toHaveCSS(
            'margin-top',
            `${verticalPadding}px`
          );
          await seekStart();
          if ((await cover.isVisible()) !== expanded) await control.click();
          await expect(cover).toHaveCSS('display', expanded ? 'inline' : 'none');
          await seekStart();
          // The site may rebuild its cover after a settings change. Check that
          // page turns preserve the current native element, not an earlier one.
          const identity = await control.elementHandle();
          for (const key of ['ArrowRight', 'ArrowLeft']) {
            const before = await paper.evaluate((el) => el.scrollLeft);
            await page.keyboard.press(key);
            expect(await page.locator('[data-unp-live-turn],[data-unp-page-effect]').count()).toBe(
              0
            );
            const after = await paper.evaluate((el) => el.scrollLeft);
            expect(
              key === 'ArrowRight' ? after > before : after < before,
              JSON.stringify({ spreadMode, expanded, pageEffect, key, before, after })
            ).toBe(true);
          }
          await expect.poll(() => paper.evaluate((el) => el.scrollLeft)).toBe(0);
          expect(await control.evaluate((el, original) => el === original, identity)).toBe(true);
          await expect(paper).toHaveCSS('transform', 'none');
        }
      }
    }
    await control.click();
    await expect(cover).toHaveCSS('display', 'inline');
    expect(errors).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('cover-before-cleanup.png') });
    await writeFile(
      test.info().outputPath('cover-state.json'),
      JSON.stringify(
        await page.evaluate(() => ({
          active: document.activeElement?.outerHTML.slice(0, 200),
          menus: [
            ...document.querySelectorAll<HTMLElement>(
              '#theme_box,#comment_box,#list_box,.modal.show,.banner-modal-background.show,[role="dialog"]'
            ),
          ].map((el) => ({
            id: el.id,
            class: el.className,
            rects: el.getClientRects().length,
            visibility: getComputedStyle(el).visibility,
          })),
          reader: document.getElementById('novel_drawing_page_c')?.getBoundingClientRect().toJSON(),
          range: document.querySelector('#unp-navigation-host')?.shadowRoot?.querySelector('input')
            ?.outerHTML,
        })),
        null,
        2
      )
    );
    throw error;
  } finally {
    await page.close();
    if (originalSettings['unp.reader.v1'])
      await worker.evaluate((raw) => chrome.storage.sync.set(raw), originalSettings);
  }
});

test('live native defaults match the extension basic preset at desktop and mobile widths', async () => {
  test.setTimeout(90000);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const native = await browser.newPage();
  const reader = await context.newPage();
  const sample = () => {
    const root = document.getElementById('novel_drawing')!;
    const one = root.querySelector<HTMLElement>('.line[data-line="1"]')!;
    const four = root.querySelector<HTMLElement>('.line[data-line="4"]')!;
    const range = document.createRange();
    range.selectNodeContents(one);
    const first = range.getBoundingClientRect();
    range.selectNodeContents(four);
    const next = range.getBoundingClientRect();
    const style = getComputedStyle(one);
    const body = root.getBoundingClientRect();
    return {
      font: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
      line: style.lineHeight,
      color: style.color,
      width: body.width,
      left: body.left,
      glyphWidth: first.width,
      blankAdvance: next.top - first.top,
    };
  };
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async (data) => chrome.storage.sync.set({ 'unp.reader.v1': { schemaVersion: 1, data } }),
      defaults
    );
    for (const page of [native, reader]) {
      await page.goto('https://novelpia.com/viewer/58128', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#novel_drawing .line[data-line="4"]', { timeout: 30000 });
    }
    await expect(reader.locator('[data-unp-line]').first()).toHaveCSS(
      'font-family',
      /Noto Sans KR/
    );
    for (const width of [1440, 390]) {
      for (const page of [native, reader]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => document.fonts.ready);
      }
      await expect
        .poll(() =>
          reader.locator('#novel_drawing').evaluate((el) => el.getBoundingClientRect().width)
        )
        .toBe(width === 390 ? 350 : 900);
      const original = await native.evaluate(sample);
      const applied = await reader.evaluate(sample);
      expect(applied.font).toContain('Noto Sans KR');
      for (const key of ['size', 'weight', 'line', 'color'] as const)
        expect(applied[key]).toBe(original[key]);
      for (const key of ['width', 'left', 'glyphWidth', 'blankAdvance'] as const)
        expect(applied[key], `${width}px ${key}`).toBeCloseTo(original[key], 0);
      await writeFile(
        test.info().outputPath(`native-comparison-${width}.json`),
        JSON.stringify({ original, applied }, null, 2)
      );
    }
  } finally {
    await reader.close();
    await browser.close();
  }
});

test('live browser restart restores viewer 58128 and saved typography', async () => {
  test.setTimeout(90000);
  const url = 'https://novelpia.com/viewer/58128';
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-unp-reader="scroll"]')).toBeVisible({ timeout: 30000 });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const previousSettings = await worker.evaluate(async () => {
    const raw = await chrome.storage.sync.get('unp.reader.v1');
    const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
    const previous = structuredClone(doc);
    Object.assign(doc.data, { enabled: true, fontSize: 23, darkMode: false });
    await chrome.storage.sync.set({ 'unp.reader.v1': doc });
    return previous;
  });
  await expect(page.locator('[data-unp-line]').first()).toHaveCSS('font-size', '23px');
  await context.close();
  const extension = path.resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--restore-last-session',
    ],
  });
  let restored = context.pages().find((candidate) => candidate.url().replace(/\/$/, '') === url);
  await expect
    .poll(() => {
      restored = context.pages().find((candidate) => candidate.url().replace(/\/$/, '') === url);
      return !!restored;
    })
    .toBe(true);
  const current = restored!;
  const extensionErrors: string[] = [];
  current.on('pageerror', (error) => {
    if (error.stack?.includes('chrome-extension://')) extensionErrors.push(error.message);
  });
  await current.addLocatorHandler(current.locator('.banner-modal-background.show'), async () => {
    await current
      .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
      .click({ timeout: 15000 });
  });
  await current.bringToFront();
  await expect(current.locator('[data-unp-reader="scroll"]')).toBeVisible({ timeout: 30000 });
  await expect(current.locator('[data-unp-line]').first()).toHaveCSS('font-size', '23px');
  if (!(await current.locator('#btn_theme').isVisible()))
    await current.locator('#novel_box').click({ position: { x: 720, y: 250 } });
  await current.locator('#btn_theme').click();
  await expect(current.getByTestId('settings-panel')).toBeVisible();
  await expect(current.locator('#unp-panel-host')).toHaveCount(1);
  await current.screenshot({ path: test.info().outputPath('restored-themebox.png') });
  expect(extensionErrors).toEqual([]);
  const restoredWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await restoredWorker.evaluate(async (previous) => {
    await chrome.storage.sync.set({ 'unp.reader.v1': previous });
  }, previousSettings);
  await current.close();
});

test('live notice viewer 6135852 keeps native notice and loading colors in the selected surface mode', async () => {
  const page = await context.newPage();
  await page.addLocatorHandler(page.locator('.banner-modal-background.show'), async () => {
    await page
      .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
      .click({ timeout: 15000 });
  });
  await page.goto('https://novelpia.com/viewer/6135852', { waitUntil: 'domcontentloaded' });
  const login = page.getByText('로그인이 필요한 회차입니다.', { exact: true });
  await expect(page.locator('[data-unp-line]').first().or(login)).toBeVisible({ timeout: 30000 });
  if (await login.isVisible()) {
    await expect(page.locator('#unp-panel-host,[data-unp-reader]')).toHaveCount(0);
    await page.close();
    test.skip(true, '새 프로필에서 로그인 필요: 공지 접근 제한만 확인');
    return;
  }
  const notice = page
    .locator('#novel_drawing > div,#novel_drawing_page > div')
    .filter({ hasText: /^\s*여기까지가 공지 마지막 내용입니다[.!。]?\s*$/ });
  await expect(notice).toHaveCount(1);
  const original = await notice.evaluate((element) => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    border: element.style.getPropertyValue('border'),
    shadow: element.style.getPropertyValue('box-shadow'),
  }));
  const worker = context.serviceWorkers()[0]!;
  for (const mode of ['translucent', 'opaque', 'theme', 'default']) {
    await worker.evaluate(async (mode) => {
      const raw = await chrome.storage.sync.get('unp.reader.v1');
      const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
      Object.assign(doc.data, {
        readingSurfaces: mode,
        darkMode: false,
        textColor: '#344c70',
        textAreaBackgroundColor: '#f4ead7',
      });
      await chrome.storage.sync.set({ 'unp.reader.v1': doc });
    }, mode);
    if (mode === 'default') {
      await expect
        .poll(() =>
          notice.evaluate((element) => element.style.getPropertyPriority('background-color'))
        )
        .not.toBe('important');
      expect(await notice.evaluate((element) => element.style.getPropertyValue('border'))).toBe(
        original.border
      );
      expect(await notice.evaluate((element) => element.style.getPropertyValue('box-shadow'))).toBe(
        original.shadow
      );
    } else {
      for (const surface of [notice, page.locator('#load_bar > div')]) {
        await expect(surface).toHaveCSS(
          'color',
          mode === 'theme' ? 'rgb(41, 38, 48)' : 'rgb(52, 76, 112)'
        );
        await expect(surface).toHaveCSS(
          'background-color',
          mode === 'theme'
            ? 'rgb(255, 255, 255)'
            : mode === 'translucent'
              ? 'rgba(244, 234, 215, 0.8)'
              : 'rgb(244, 234, 215)'
        );
      }
    }
  }
  await page.screenshot({ path: test.info().outputPath('live-notice-surfaces.png') });
  await page.close();
});

test('live scroll viewport and fixed navigation 58128', async () => {
  test.setTimeout(90000);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(
    async (data) => {
      await chrome.storage.sync.set({ 'unp.reader.v1': { schemaVersion: 1, data } });
    },
    {
      ...defaults,
      pageNavigationPlacement: 'overlay',
      readerHeightPercent: 70,
      pageEffect: 'none',
    }
  );
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('viewer_paging', '0'));
  await page.addLocatorHandler(page.locator('.banner-modal-background.show'), async () => {
    await page
      .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
      .click({ timeout: 15000 });
  });
  await page.goto('https://novelpia.com/viewer/58128', { waitUntil: 'domcontentloaded' });
  const login = page.getByText('로그인이 필요한 회차입니다.', { exact: true });
  await expect(page.locator('[data-unp-line]').first().or(login)).toBeVisible({ timeout: 30000 });
  if (await login.isVisible()) {
    await expect(page.locator('#unp-panel-host,[data-unp-reader]')).toHaveCount(0);
    await page.close();
    test.skip(true, '새 프로필에서 로그인 필요: 접근 제한 보존만 확인, 배치 검증 미실행');
    return;
  }
  await expect(page.locator('#novel_drawing')).toHaveAttribute('data-unp-reader', 'scroll');
  await expect(page.locator('html')).not.toHaveAttribute('data-unp-preparing');
  const box = page.locator('#novel_box');
  // A separate base is needed only while the reader is shorter than its native
  // viewport. Capture it before opening the reading frame to full height.
  await expect(page.locator('[data-unp-background-base]')).toBeAttached();
  const natural = (await page.locator('[data-unp-background-base]').boundingBox())!;
  const originalViewport = {
    top: natural.y,
    bottom: natural.y + natural.height,
    height: natural.height,
    width: natural.width,
  };
  await worker.evaluate(async () => {
    const raw = await chrome.storage.sync.get('unp.reader.v1');
    const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
    doc.data.readerHeightPercent = 100;
    await chrome.storage.sync.set({ 'unp.reader.v1': doc });
  });
  const readFrames = () =>
    page.evaluate((originalViewport) => {
      const bounds = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width };
      };
      return {
        box: bounds('#novel_box'),
        viewport: document.querySelector('[data-unp-background-base]')
          ? bounds('[data-unp-background-base]')
          : originalViewport,
        bar: bounds('#unp-navigation-host'),
        footer: bounds('#footer_bar'),
      };
    }, originalViewport);
  await expect
    .poll(async () => {
      const frame = await readFrames();
      return Math.max(
        Math.abs(frame.box.top - frame.viewport.top),
        Math.abs(frame.box.bottom - frame.viewport.bottom)
      );
    })
    .toBeLessThan(1);
  const original = (await readFrames()).box;
  await box.evaluate((element) => {
    element.scrollTop = 1800;
  });
  await expect.poll(() => box.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
  // Exercise the site's own click-to-toggle menus, without rewriting their styles.
  const menu = page.locator('#btn_theme');
  for (let attempt = 0; attempt < 2; attempt++) {
    const wasVisible = await menu.isVisible();
    await box.click({ position: { x: 720, y: 250 } });
    await expect.poll(() => menu.isVisible()).toBe(!wasVisible);
    expect((await readFrames()).box).toEqual(original);
  }
  if (!(await menu.isVisible())) await box.click({ position: { x: 720, y: 250 } });
  await page.screenshot({ path: test.info().outputPath('live-scroll-overlay-full-viewport.png') });
  await box.evaluate((element) => {
    element.scrollTop = 1800;
  });
  await expect.poll(() => box.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
  const navigation = page.getByRole('navigation', { name: '본문 탐색과 북마크', exact: true });
  if (!(await navigation.isVisible())) await box.click({ position: { x: 720, y: 250 } });
  await navigation.getByRole('button', { name: '현재 위치 북마크 저장', exact: true }).click();
  const saved = () =>
    worker.evaluate(
      async () =>
        (await chrome.storage.local.get('unp.bookmark.v1.58128'))['unp.bookmark.v1.58128'] as
          | { blockKey: string; textOffset: number; edge: string }
          | undefined
    );
  await expect.poll(saved).toBeTruthy();
  const anchor = (await saved())!;
  const anchorVisible = () =>
    page.evaluate((anchor) => {
      const block = document.querySelector(`#novel_drawing .line[data-line="${anchor.blockKey}"]`);
      if (!block) return false;
      const viewport = document.getElementById('novel_box')!.getBoundingClientRect();
      const visible = (rect: DOMRect) =>
        rect.bottom > viewport.top &&
        rect.top < viewport.bottom &&
        rect.right > viewport.left &&
        rect.left < viewport.right;
      if (anchor.edge !== 'text') return [...block.getClientRects()].some(visible);
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let offset = anchor.textOffset;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (offset < node.length) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, Math.min(offset + 1, node.length));
          return visible(range.getBoundingClientRect());
        }
        offset -= node.length;
      }
      return false;
    }, anchor);
  const results = [];
  for (const percent of [40, 70, 100]) {
    await worker.evaluate(async (readerHeightPercent) => {
      const raw = await chrome.storage.sync.get('unp.reader.v1');
      const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
      Object.assign(doc.data, { pageNavigationPlacement: 'fixed', readerHeightPercent });
      await chrome.storage.sync.set({ 'unp.reader.v1': doc });
    }, percent);
    await expect
      .poll(async () => {
        const { box, viewport, bar } = await readFrames();
        const available = viewport.height - 64 - 64 - bar.height - 16;
        return Math.abs(box.height - (available * percent) / 100);
      })
      .toBeLessThan(1);
    if (!(await navigation.isVisible())) await box.click({ position: { x: 720, y: 100 } });
    await expect(navigation).toBeVisible();
    const frame = await readFrames();
    expect(frame.bar.top).toBeGreaterThan(frame.box.bottom);
    expect(frame.bar.bottom).toBeLessThan(frame.footer.top);
    if (results.length) expect(Math.abs(frame.bar.top - results[0]!.bar.top)).toBeLessThan(1);
    await expect.poll(anchorVisible).toBe(true);
    results.push(frame);
  }
  expect(results[0]!.box.height).toBeLessThan(results[2]!.box.height);
  await page.screenshot({ path: test.info().outputPath('live-fixed-navigation-height-100.png') });
  await writeFile(
    test.info().outputPath('live-geometry.json'),
    JSON.stringify({ original, results }, null, 2)
  );
  await page.goto('about:blank');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).not.toHaveAttribute('data-unp-preparing');
  await expect.poll(anchorVisible).toBe(true);
  const beforeAutoscroll = await box.evaluate((element) => element.scrollTop);
  const restored = (await box.boundingBox())!;
  await box.click({
    button: 'middle',
    position: { x: restored.width / 2, y: restored.height / 3 },
  });
  await page.mouse.move(restored.x + restored.width / 2, restored.y + restored.height / 3 + 100);
  const samples = await box.evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const sample = () => {
          values.push(element.scrollTop);
          if (values.length < 120) requestAnimationFrame(sample);
          else resolve(values);
        };
        requestAnimationFrame(sample);
      })
  );
  await page.keyboard.press('Escape');
  await writeFile(
    test.info().outputPath('live-autoscroll.json'),
    JSON.stringify({ start: beforeAutoscroll, samples })
  );
  expect(samples.at(-1)!).toBeGreaterThan(beforeAutoscroll + 200);
  // Native startup page-mark callbacks can still make a one-time position correction.
  // They must not leave the extension continuously pinning browser autoscroll.
  const tail = samples.slice(-30);
  expect(tail.every((value, index) => index === 0 || value >= tail[index - 1]! - 2)).toBe(true);
  expect(tail.at(-1)! - tail[0]!).toBeGreaterThan(100);
  await page.close();
});
for (const id of ['58128', '60485', '65149', '3915249', '3929613', '3948927'])
  test(`live free viewer ${id}`, async () => {
    test.setTimeout(90000);
    const page = await context.newPage();
    // A campaign may appear after the first visible-body check. Use its own
    // enabled close control whenever it covers a later action; never hide it.
    await page.addLocatorHandler(page.locator('.banner-modal-background.show'), async () => {
      await page
        .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
        .click({ timeout: 15000 });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`https://novelpia.com/viewer/${id}`, { waitUntil: 'domcontentloaded' });
    const login = page.getByText('로그인이 필요한 회차입니다.', { exact: true });
    await expect(page.locator('[data-unp-line]').first().or(login)).toBeVisible({
      timeout: 30000,
    });
    if (await login.isVisible()) {
      await expect(page.locator('#unp-panel-host,[data-unp-reader]')).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath(`live-${id}-access-gate.png`),
      });
      await writeFile(
        test.info().outputPath(`live-${id}.json`),
        JSON.stringify(
          {
            url: page.url(),
            access: 'login_required',
            extensionMounted: false,
            bodyValidation: 'not_run',
          },
          null,
          2
        )
      );
      await page.close();
      test.skip(true, '새 프로필에서 로그인 필요: 접근 제한 보존만 확인, 본문 검증 미실행');
      return;
    }
    await expect(page.locator('[data-unp-line]').first()).toBeAttached({ timeout: 30000 });
    if (await page.locator('.banner-modal-background.show').isVisible())
      await page
        .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
        .click({ timeout: 15000 });
    const dark = id === '3929613';
    const worker = context.serviceWorkers()[0]!;
    await page.bringToFront();
    await expect
      .poll(() =>
        worker.evaluate(async (episode) => {
          const raw = await chrome.storage.local.get('unp.reading-stats.v1.episodes');
          return (
            (raw['unp.reading-stats.v1.episodes'] as number[] | undefined)?.includes(
              Number(episode)
            ) ?? false
          );
        }, id)
      )
      .toBe(true);
    await worker.evaluate(async (dark) => {
      const raw = await chrome.storage.sync.get('unp.reader.v1');
      const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
      Object.assign(doc.data, {
        textColor: dark ? '#e9e4f0' : '#344c70',
        backgroundColor: dark ? '#18151e' : '#ffffff',
        textAreaBackgroundColor: dark ? '#18151e' : '#ffffff',
        darkMode: dark,
        enhanceBoldTextStyle: 'shadow',
        pageGap: dark ? 400 : 80,
        readerHeightPercent: dark ? 60 : 70,
        pageNavigationPlacement: dark ? 'overlay' : 'reserved',
        readingSurfaces: 'opaque',
        fontFamily: dark ? 'Noto Sans KR' : 'system-ui',
        fontWeight: dark ? 600 : 400,
        forceBold: false,
      });
      await chrome.storage.sync.set({ 'unp.reader.v1': doc });
    }, dark);
    await expect(page.locator('[data-unp-line]').first()).toHaveCSS(
      'color',
      dark ? 'rgb(233, 228, 240)' : 'rgb(52, 76, 112)'
    );
    if (dark) {
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const faces = await document.fonts.load('900 24px "Noto Sans KR"');
            return faces.length > 0 && faces.every((face) => face.status === 'loaded');
          })
        )
        .toBe(true);
      await expect(page.locator('[data-unp-line] b').first()).toHaveCSS('font-weight', '900');
      await expect(page.locator('[data-unp-line]').first()).toHaveCSS('font-weight', '600');
    }
    if (!(await page.locator('#btn_theme').isVisible()))
      await page.locator('#novel_box').click({ position: { x: 720, y: 250 } });
    await page.locator('#btn_theme').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    const font = page.getByRole('spinbutton', { name: '글자 크기', exact: true });
    await font.fill('24');
    await font.press('Enter');
    await page.getByRole('button', { name: '레이아웃 설정으로 이동', exact: true }).click();
    const width = page.getByRole('spinbutton', { name: '본문 너비', exact: true });
    await expect(page.getByRole('spinbutton', { name: '본문 높이', exact: true })).toHaveValue(
      dark ? '60' : '70'
    );
    await width.fill(dark ? '480' : '540');
    await width.press('Enter');
    await page.getByRole('button', { name: '페이지 방식', exact: true }).click();
    await expect(page.locator('#novel_drawing_page')).toHaveAttribute('data-unp-reader', 'page', {
      timeout: 30000,
    });
    if (await page.locator('.banner-modal-background.show').isVisible())
      await page
        .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
        .click({ timeout: 15000 });
    await expect(page.locator('#novel_drawing_page')).toHaveCSS('column-count', '2');
    await expect(page.locator('#novel_box')).toHaveCSS('overflow-x', 'clip');
    await expect(page.locator('#novel_box')).toHaveCSS('overflow-y', 'clip');
    expect(
      await page.locator('#novel_box').evaluate((box) => {
        box.scrollTo(20, 20);
        return [box.scrollLeft, box.scrollTop];
      })
    ).toEqual([0, 0]);
    await expect(page.getByTestId('reader-page')).toBeAttached();
    const assertBarPlacement = async (selector: string) => {
      const nav = page.getByRole('navigation', { name: '본문 탐색과 북마크' });
      if (!(await nav.isVisible()))
        await page.locator('#novel_box').click({ position: { x: 720, y: 250 } });
      await expect(nav).toBeVisible();
      await expect
        .poll(async () => {
          const frame = (await page.locator(selector).boundingBox())!;
          const bar = await nav.boundingBox();
          return (
            !!bar &&
            (dark
              ? bar.y >= frame.y && bar.y + bar.height < frame.y + frame.height
              : bar.y > frame.y + frame.height)
          );
        })
        .toBe(true);
    };
    await assertBarPlacement('#novel_drawing_page_c');
    await expect(page.locator('.banner-modal-background')).toBeHidden();
    const before = await page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.locator('#novel_drawing_page_c').evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(before);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const current = Number(
            document
              .getElementById('unp-navigation-host')!
              .shadowRoot!.querySelector('output')!
              .textContent!.split('/')[0]!
              .split('~')[0]
          );
          const native = Number(document.getElementById('page_cnt')!.textContent!.split('/')[0]);
          return native === Math.floor((current - 1) / 2) + 1;
        })
      )
      .toBe(true);
    const slider = page.getByRole('slider', { name: '본문 페이지', exact: true });
    if (!(await slider.isVisible()))
      await page.locator('#novel_box').click({ position: { x: 720, y: 250 } });
    const bounds = (await slider.boundingBox())!;
    await slider.click({ position: { x: bounds.width - 1, y: bounds.height / 2 } });
    await expect(page.getByRole('button', { name: '다음 쪽', exact: true })).toBeDisabled();
    const label = (await page.getByTestId('reader-page').textContent())!;
    const total = Number(label.split('/')[1]);
    await expect(page.locator('#page_cnt')).toHaveText(
      `${Math.ceil(total / 2)}/${Math.ceil(total / 2)}`
    );
    const start = Math.floor((total - 1) / 2) * 2 + 1;
    expect(label).toBe(`${start === total ? total : `${start}~${total}`} / ${total}`);
    expect(page.url()).toContain(`/viewer/${id}`);
    if (await page.locator('#writer_comments_box').count()) {
      const textColor = await page
        .locator('[data-unp-line]')
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      await expect(page.locator('#writer_comments_box')).toHaveCSS('color', textColor);
      await expect(page.locator('#writer_comments_box')).toHaveCSS(
        'background-color',
        dark ? 'rgb(24, 21, 30)' : 'rgb(255, 255, 255)'
      );
    }
    const surfaces = page.locator(
      '#writer_comments_box,#next_epi_btn_bottom,#next_info_layer,#back_info_layer'
    );
    for (const mode of ['translucent', 'theme', 'default', 'opaque'] as const) {
      await worker.evaluate(async (readingSurfaces) => {
        const raw = await chrome.storage.sync.get('unp.reader.v1');
        const doc = raw['unp.reader.v1'] as { data: Record<string, unknown> };
        doc.data.readingSurfaces = readingSurfaces;
        await chrome.storage.sync.set({ 'unp.reader.v1': doc });
      }, mode);
      if (mode === 'default') {
        for (const surface of await surfaces.all())
          await expect
            .poll(() => surface.evaluate((el) => el.style.getPropertyPriority('background-color')))
            .not.toBe('important');
      } else {
        const paper =
          mode === 'theme'
            ? dark
              ? 'rgb(36, 33, 42)'
              : 'rgb(255, 255, 255)'
            : mode === 'translucent'
              ? dark
                ? 'rgba(24, 21, 30, 0.8)'
                : 'rgba(255, 255, 255, 0.8)'
              : dark
                ? 'rgb(24, 21, 30)'
                : 'rgb(255, 255, 255)';
        const ink =
          mode === 'theme'
            ? dark
              ? 'rgb(241, 237, 247)'
              : 'rgb(41, 38, 48)'
            : dark
              ? 'rgb(233, 228, 240)'
              : 'rgb(52, 76, 112)';
        for (const surface of await surfaces.all()) {
          await expect(surface).toHaveCSS('background-color', paper);
          await expect(surface).toHaveCSS('color', ink);
        }
      }
    }
    await page.screenshot({
      path: test.info().outputPath(`live-${id}-page.png`),
    });
    const observed = await page.evaluate(() => ({
      url: location.href,
      lines: document.querySelectorAll('[data-unp-line]').length,
      reader: document.querySelector('[data-unp-reader]')?.getAttribute('style'),
      viewport: document.querySelector('#novel_drawing_page_c')?.getAttribute('style'),
      counter: document.querySelector('#page_cnt')?.textContent,
      navigation: document
        .querySelector('#unp-navigation-host')
        ?.shadowRoot?.querySelector('output')?.textContent,
      authorColor: document.getElementById('writer_comments_box')
        ? getComputedStyle(document.getElementById('writer_comments_box')!).color
        : null,
      boldShadow: document.querySelector('[data-unp-line] b')
        ? getComputedStyle(document.querySelector('[data-unp-line] b')!).textShadow
        : null,
      bold: [...document.querySelectorAll('[data-unp-line] b')]
        .slice(0, 2)
        .map((el) => getComputedStyle(el).fontWeight),
      italic: [...document.querySelectorAll('[data-unp-line] i')]
        .slice(0, 2)
        .map((el) => getComputedStyle(el).fontStyle),
      service: [...document.querySelectorAll('.curation-wrapper,iframe,[id*="banner"]')].map(
        (el) => ({ tag: el.tagName, id: el.id, visible: !!el.getClientRects().length })
      ),
    }));
    await writeFile(
      test.info().outputPath(`live-${id}.json`),
      JSON.stringify({ observed, errors }, null, 2)
    );
    if (id === '58128' || id === '3929613') {
      if (!(await page.locator('#btn_list').isVisible()))
        await page.locator('#novel_box').click({ position: { x: 720, y: 250 } });
      await page.locator('#btn_list').click();
      await expect(page.locator('#list_box')).toBeVisible();
      await expect(page.locator('#novel_box')).toBeHidden();
      await expect(page.locator('#episode_table tr').first()).toBeVisible();
      await page.locator('#btn_list').click();
      await expect(page.locator('#novel_box')).toBeVisible();
      await expect(page.locator('#list_box')).toBeHidden();
      await expect(page.locator('#novel_drawing_page')).toHaveCSS('column-count', '2');
    }
    if (!(await page.locator('#btn_theme').isVisible()))
      await page.locator('#novel_box').click({ position: { x: 720, y: 250 } });
    await page.locator('#btn_theme').click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath(`live-${id}-settings.png`),
    });
    await page.getByRole('button', { name: '레이아웃 설정으로 이동', exact: true }).click();
    await page.getByRole('button', { name: '스크롤 방식', exact: true }).click();
    await expect(page.locator('#novel_drawing')).toHaveAttribute('data-unp-reader', 'scroll', {
      timeout: 30000,
    });
    await assertBarPlacement('#novel_box');
    if (id === '58128' || id === '3929613') {
      if (await page.locator('.banner-modal-background.show').isVisible())
        await page
          .locator('.banner-modal-close:not(.banner-modal-close-disabled)')
          .click({ timeout: 15000 });
      if (!(await page.locator('#btn_list').isVisible()))
        await page.locator('#novel_box').click({ position: { x: 720, y: 250 } });
      await page.locator('#btn_list').click();
      const list = page.locator('#list_box');
      await expect(list).toBeVisible();
      await expect(list.locator('#episode_table tr').first()).toBeVisible();
      await expect(list).toHaveCSS('filter', 'none');
      await expect(list).toHaveCSS(
        'background-color',
        dark ? 'rgb(36, 33, 43)' : 'rgb(250, 249, 252)'
      );
      await expect(list.locator('.b_free,.b_plus').first()).toHaveCSS('filter', 'none');
      await expect(list.locator('.episode_title').first()).toHaveCSS(
        'filter',
        dark ? 'brightness(0) invert(1)' : 'none'
      );
      await expect(list.locator('.ep_style2').first()).toHaveCSS('opacity', '1');
      await page.screenshot({
        path: test.info().outputPath(`live-${id}-episode-list.png`),
      });
    }
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          const raw = await chrome.storage.local.get('unp.reading-stats.v1.days');
          return Object.values(
            (raw['unp.reading-stats.v1.days'] ?? {}) as Record<string, number>
          ).reduce((sum, ms) => sum + ms, 0);
        })
      )
      .toBeGreaterThan(0);
    await page.close();
  });
