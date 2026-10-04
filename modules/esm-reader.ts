import { defineWxtModule } from 'wxt/modules';
import { build } from 'vite';
import { resolve } from 'node:path';
// @ts-expect-error Shared Node-side adapter, checked by lifecycle tests.
import { pageFlipLifecycle } from '../scripts/page-flip-lifecycle.mjs';

// WXT content entries are IIFEs. Build an extension-local ESM graph explicitly so the
// settings panel and paper animation really load on demand in production, too.
export default defineWxtModule((wxt) => {
  const compile = async () => {
    await build({
      configFile: false,
      publicDir: false,
      plugins: [
        pageFlipLifecycle(),
        {
          name: 'unp-startup-files',
          generateBundle(_options, bundle) {
            const files = new Set<string>();
            const visit = (file: string) => {
              if (files.has(file)) return;
              const chunk = bundle[file];
              if (!chunk || chunk.type !== 'chunk') return;
              files.add(file);
              chunk.imports.forEach(visit);
            };
            // Only the static startup graph. Settings/editor/effects remain lazy.
            visit('viewer.js');
            this.emitFile({
              type: 'asset',
              fileName: 'startup.json',
              source: JSON.stringify([...files]),
            });
          },
        },
      ],
      mode: wxt.config.mode,
      oxc: { jsx: { runtime: 'automatic', development: false } },
      resolve: { alias: { '@': resolve(wxt.config.root, 'src') } },
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        target: 'chrome120',
        emptyOutDir: true,
        outDir: resolve(wxt.config.outDir, 'content-scripts/esm'),
        lib: {
          entry: resolve(wxt.config.root, 'src/app/viewer.tsx'),
          formats: ['es'],
          fileName: () => 'viewer.js',
        },
        rolldownOptions: {
          output: { chunkFileNames: '[name]-[hash].js', assetFileNames: '[name][extname]' },
        },
      },
    });
  };
  wxt.hooks.hook('build:done', compile);
  wxt.hooks.hook('build:manifestGenerated', (_, manifest) => {
    manifest.web_accessible_resources ??= [];
    const resources = manifest.web_accessible_resources as {
      resources: string[];
      matches: string[];
    }[];
    resources.push({
      resources: [
        'content-scripts/esm/*',
        'fonts/Freesentation-4Regular.woff2',
        'fonts/Freesentation-5Medium.woff2',
        'fonts/Freesentation-6SemiBold.woff2',
        'fonts/Freesentation-7Bold.woff2',
      ],
      matches:
        wxt.config.mode === 'e2e'
          ? ['http://127.0.0.1/*']
          : ['https://novelpia.com/*', 'https://www.novelpia.com/*'],
    });
  });
  wxt.hooks.hookOnce('build:done', () => {
    let queue = Promise.resolve();
    wxt.server?.watcher.on('change', (file) => {
      if (!file.replaceAll('\\', '/').includes('/src/')) return;
      queue = queue
        .then(compile)
        .then(() =>
          wxt.server?.reloadContentScript({
            contentScript: {
              matches: ['https://novelpia.com/viewer/*', 'https://www.novelpia.com/viewer/*'],
              js: ['/content-scripts/content.js'],
            },
          })
        )
        .catch((error) => {
          wxt.logger.error(String(error));
        });
    });
  });
});
