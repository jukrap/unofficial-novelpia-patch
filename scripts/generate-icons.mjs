import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(path.join(root, 'icons/source/cup-tteokbokki.png'));
const sourceUrl = `data:image/png;base64,${source.toString('base64')}`;
const outputs = [
  [16, 'icon16.png'],
  [24, 'icon24.png'],
  [32, 'icon32.png'],
  [48, 'icon48.png'],
  [64, 'icon64.png'],
  [96, '96.png'],
  [128, 'icon128.png'],
  [192, 'icon192.png'],
  [192, '192.png'],
];

// Reuse the project's Chromium dependency; icon generation makes no network requests.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  for (const directory of ['icons', 'public/icons']) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  for (const [size, filename] of outputs) {
    const png = await page.evaluate(
      async ({ sourceUrl, size }) => {
        const image = new Image();
        image.src = sourceUrl;
        await image.decode();
        // Downsample in two stages to preserve the small gaps and rounded edges.
        const large = document.createElement('canvas');
        large.width = large.height = size * 4;
        const largeContext = large.getContext('2d');
        largeContext.imageSmoothingEnabled = true;
        largeContext.imageSmoothingQuality = 'high';
        largeContext.drawImage(image, 0, 0, large.width, large.height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        // Chrome Web Store's 128px square icon reserves a 16px transparent margin.
        const inset = size === 128 ? 16 : 0;
        context.drawImage(large, inset, inset, size - inset * 2, size - inset * 2);
        if (context.getImageData(0, 0, 1, 1).data[3] !== 0) {
          throw new Error(`Icon ${size} lost its transparent corner`);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { sourceUrl, size }
    );
    const bytes = Buffer.from(png, 'base64');
    if (bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size) {
      throw new Error(`${filename} has an unexpected PNG size`);
    }
    for (const directory of ['icons', 'public/icons']) {
      await writeFile(path.join(root, directory, filename), bytes);
    }
    console.log(`${filename}: ${size}x${size}, ${bytes.length} bytes`);
  }
} finally {
  await browser.close();
}
