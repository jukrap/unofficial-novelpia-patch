import { defineConfig } from 'wxt';
// @ts-expect-error The adapter is shared with Node-side verification scripts.
import { pageFlipLifecycle } from './scripts/page-flip-lifecycle.mjs';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  vite: () => ({ plugins: [pageFlipLifecycle()] }),
  manifest: {
    minimum_chrome_version: '120',
    name: 'Unofficial Novelpia Patch',
    description: '글꼴, 여백, 테마, 페이지 읽기를 조절하는 노벨피아 비공식 뷰어 확장',
    permissions: ['storage'],
    icons: {
      16: 'icons/icon16.png',
      24: 'icons/icon24.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      64: 'icons/icon64.png',
      96: 'icons/96.png',
      128: 'icons/icon128.png',
      192: 'icons/icon192.png',
    },
    action: {
      default_title: 'Unofficial Novelpia Patch',
      default_icon: {
        16: 'icons/icon16.png',
        24: 'icons/icon24.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        64: 'icons/icon64.png',
      },
    },
  },
});
