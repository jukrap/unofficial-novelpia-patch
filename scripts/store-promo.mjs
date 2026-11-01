import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { artworkResources, promoHtml } from './store-artwork.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'store/assets/promo-440x280.png');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 440, height: 280 },
    deviceScaleFactor: 1,
  });
  await page.setContent(promoHtml(await artworkResources(root)));
  await page.locator('img').evaluate((image) => image.decode());
  await mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output });
  console.log('프로모션 이미지 저장: store/assets/promo-440x280.png (440×280)');
} finally {
  await browser.close();
}
