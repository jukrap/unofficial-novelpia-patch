import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: process.env.UNP_FONTS_LIVE
    ? 'font-catalog-live.spec.ts'
    : process.env.UNP_LIVE
      ? 'live.spec.ts'
      : [
          'reader.spec.ts',
          'reader-height.spec.ts',
          'preset-loading.spec.ts',
          'ui-finishing.spec.ts',
          'finishing.spec.ts',
          'background-images.spec.ts',
          'page-effects.spec.ts',
          'reading-polish.spec.ts',
          'management.spec.ts',
          'initial-display.spec.ts',
          'presentation.spec.ts',
          'navigation-fonts.spec.ts',
          'session-restore.spec.ts',
          'paragraph-spacing.spec.ts',
          'user-fonts.spec.ts',
        ],
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: 'list',
  // Live pages may contain copyrighted novel text; never upload this directory in public CI.
  outputDir:
    process.env.UNP_LIVE && !process.env.UNP_FONTS_LIVE ? '_reference/live' : 'test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
