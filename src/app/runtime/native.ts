import {
  NATIVE_CHANNEL,
  isNativeCommand,
  type NativeState,
  type NativeCommand,
} from '@/shared/model/native-protocol';
type SiteWindow = Window & typeof globalThis & Record<string, unknown>;
// The site's classic script declares these with global `let`, not window properties.
// These known bindings are accessible only in MAIN; no eval or arbitrary property execution.
declare let this_page: number;
declare let max_page: number;
export function startNativeBridge() {
  const site = window as SiteWindow;
  const prior = site.__unpNativeCleanup;
  if (typeof prior === 'function') prior();
  let originalWidth: unknown;
  let widthWrapper: (() => number) | undefined;
  let stride = 0;
  const read = (): NativeState => ({
    mode: localStorage.getItem('viewer_paging') === '1' ? 'page' : 'scroll',
    dark: /(?:^|;\s*)DARKMODE=1(?:;|$)/.test(document.cookie),
    illustrations: !/(?:^|;\s*)BLOCK_ILLUSTRATION=ON(?:;|$)/.test(document.cookie),
    animation:
      localStorage.getItem('viewer_animation') !== 'off' &&
      localStorage.getItem('viewer_animation') !== '',
    autoNext: localStorage.getItem('viewer_nextepi') === 'on',
    navigation: /(?:^|;\s*)NAVIGATION=1(?:;|$)/.test(document.cookie),
    page: (typeof this_page === 'number' ? this_page : Number(site.this_page)) || 1,
    total: (typeof max_page === 'number' ? max_page : Number(site.max_page)) || 1,
    available: typeof site.viewer_display === 'function',
  });
  const release = () => {
    if (widthWrapper && site.page_width === widthWrapper) site.page_width = originalWidth;
    widthWrapper = undefined;
    stride = 0;
  };
  const call = (name: string) => {
    const fn = site[name];
    if (typeof fn !== 'function') throw new Error('사이트에서 이 옵션을 제공하지 않습니다.');
    fn();
  };
  const listener = (event: MessageEvent) => {
    const value = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      value?.channel !== NATIVE_CHANNEL ||
      value.direction !== 'request' ||
      typeof value.id !== 'string' ||
      value.id.length > 100 ||
      !isNativeCommand(value.command)
    )
      return;
    try {
      const command: NativeCommand = value.command;
      if (command.type === 'release') release();
      if (command.type === 'dispose') cleanup();
      if (command.type === 'option') {
        const map = {
          dark: ['dark_off_btn', 'dark_on_btn'],
          illustrations: ['img_off_btn', 'img_on_btn'],
          animation: ['animation_off_btn', 'animation_on_btn'],
          autoNext: ['auto_nextepi_off_btn', 'auto_nextepi_on_btn'],
          navigation: ['navigation_off_btn', 'navigation_on_btn'],
        } as const;
        if (command.option === 'mode')
          call(command.value === 'page' ? 'viewer_2_btn' : 'viewer_1_btn');
        else call(map[command.option][command.value ? 1 : 0]);
      }
      if (command.type === 'sync') {
        stride = command.stride;
        if (!widthWrapper && typeof site.page_width === 'function') {
          originalWidth = site.page_width;
          widthWrapper = () => stride;
          site.page_width = widthWrapper;
        }
        if (typeof this_page === 'number') this_page = Math.min(command.page, command.total);
        else site.this_page = Math.min(command.page, command.total);
        if (typeof max_page === 'number') max_page = command.total;
        else site.max_page = command.total;
        // Keep the site's own bookmark/curation/service effects. Never copy or suppress them.
        if (typeof site.page_cal === 'function') site.page_cal();
        const current = document.getElementById('this_page_view');
        if (current) current.textContent = String(read().page);
        const slider = document.getElementById('page_navigation');
        if (slider instanceof HTMLInputElement) slider.value = String(read().page);
      }
      window.postMessage(
        { channel: NATIVE_CHANNEL, direction: 'reply', id: value.id, state: read() },
        location.origin
      );
    } catch (error) {
      window.postMessage(
        { channel: NATIVE_CHANNEL, direction: 'reply', id: value.id, error: String(error) },
        location.origin
      );
    }
  };
  const cleanup = () => {
    release();
    window.removeEventListener('message', listener);
    document.removeEventListener('click', prepareSettings, true);
    delete site.__unpNativeCleanup;
  };
  site.__unpNativeCleanup = cleanup;
  window.addEventListener('message', listener);
  // Some anonymous sessions leave this site-owned UI flag unset after an unrelated startup error.
  // Initialize only the settings entry, then let its original handler perform the actual toggle.
  const prepareSettings = (event: MouseEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest('.menu-top-setting') &&
      site.option_btn_theme !== 0 &&
      site.option_btn_theme !== 1
    )
      site.option_btn_theme = 0;
  };
  document.addEventListener('click', prepareSettings, true);
}
