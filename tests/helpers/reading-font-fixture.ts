import { chromium, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FONTS } from '../../src/shared/config/fontData';

// Synthetic UI tests exercise CSS requests, FontFace decoding and loading state.
// They do not assert the appearance of remote families; font-catalog-live does.
export const readingFontUrl = 'https://unp-font-fixture.test/reading.woff2';
export const readingFontBytes = readFile(
  new URL('../../public/fonts/Freesentation-4Regular.woff2', import.meta.url)
);
const aliases: Record<string, string> = {
  Pretendard: 'Pretendard Variable',
  'NanumSquare Neo': 'NanumSquareNeo',
  MaruBuri: '마루 부리',
  RIDIBatang: '리디바탕',
};
export function readingFontCss(family: string, source = readingFontUrl, weight = '100 900') {
  return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;font-display:swap;src:url("${source}") format("woff2")}`;
}
const stylesheets = new Map(
  FONTS.flatMap((font) =>
    font.urls
      .filter((resource) => !resource.css && resource.url.startsWith('https://'))
      .map(
        (resource) =>
          [
            resource.url,
            (font.metadata.variableFont
              ? [`${font.metadata.weights[0]} ${font.metadata.weights.at(-1)}`]
              : font.metadata.weights.map(String)
            )
              .map((weight) =>
                readingFontCss(aliases[font.name] ?? font.name, readingFontUrl, weight)
              )
              .join('\n'),
          ] as const
      )
  )
);
const fontRequests =
  /^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|(?:cdn|fastly)\.jsdelivr\.net|unp-font-fixture\.test)\//;

async function installReadingFonts(context: BrowserContext) {
  await context.route(fontRequests, async (route) => {
    const url = route.request().url();
    const css = stylesheets.get(url);
    if (css) {
      await route.fulfill({ contentType: 'text/css', body: css });
    } else if (/\.(?:woff2?|ttf|otf)(?:\?|$)/.test(url)) {
      await route.fulfill({
        contentType: 'font/woff2',
        body: await readingFontBytes,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } else {
      throw new Error(`Add a synthetic font fixture for ${url}`);
    }
  });
}

export async function launchReadingContext(
  ...args: Parameters<typeof chromium.launchPersistentContext>
) {
  const context = await chromium.launchPersistentContext(args[0], {
    ...args[1],
    args: [
      ...(args[1]?.args ?? []),
      // Restored tabs may issue requests before launch returns and routes attach.
      // The synthetic suite never needs external hosts, including in that window.
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    ],
  });
  // Install before the suite navigates. More specific failure/delay routes are
  // registered by individual tests afterwards and retain their precedence.
  await installReadingFonts(context);
  return context;
}
