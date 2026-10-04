import type { Root } from 'react-dom/client';
import { SettingsStore } from '@/entities/settings';
import { PresetStore } from '@/entities/preset';
import {
  detectReader,
  ReaderEngine,
  parseAnchor,
  positionKey,
  resumeAnchor,
  StyleLedger,
  BookmarkStore,
  FontLoader,
  ReadingControls,
  type ReadingAnchor,
} from '@/entities/reader';
import { chromeStorage, hasExtensionContext } from '@/shared/platform/storage';
import { NativeClient } from '@/shared/platform/native';
import type { NativeState, NativeOption } from '@/shared/model/native-protocol';
import { autoRecommend } from '@/features/auto-recommend';
import { EpisodeListTheme, nativeModeEntry, reloadNotice } from '../ui/viewer-surfaces';
import { trackReadingStatistics } from './reading-statistics';
import type { ViewerPreparation } from './bootstrap';
import { FirstDisplay } from './first-display';
import { installUiFonts } from '@/shared/platform/ui-fonts';
import { initializeUserFonts, subscribeFonts } from '@/shared/platform/user-fonts';

export function startViewer(isContextValid = hasExtensionContext, preparation?: ViewerPreparation) {
  const releaseUiFonts = installUiFonts();
  const storage = chromeStorage(isContextValid);
  const settings = new SettingsStore(storage);
  const presets = new PresetStore(storage);
  const native = new NativeClient();
  const fonts = new FontLoader();
  const firstDisplay = new FirstDisplay(preparation, fonts);
  const readingControls = new ReadingControls();
  let disposed = false;
  let initialized = false;
  const documentKey = crypto.randomUUID();
  let stopStatistics = () => {};
  let sessionEnabled = true;
  let switching = false;
  let panelUi: typeof import('../ui/panel-runtime') | null = null;
  let navigationUi: typeof import('../ui/navigation-runtime') | null = null;
  let panelPromise: Promise<void> | undefined;
  let navigationPromise: Promise<void> | undefined;
  let removeNativeEntry = () => {};
  let nativeEntry: HTMLElement | null = null;
  let notice: HTMLElement | null = null;
  let syncingDark = false;
  let darkSync: Promise<void> = Promise.resolve();
  let restoringDark = false;
  const listTheme = new EpisodeListTheme();
  const nativeDarkKey = 'unp.native-dark.v1';
  let engine: ReaderEngine | null = null;
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  let state: NativeState | undefined;
  let observer: MutationObserver;
  let frame = 0;
  let recommendationStop = () => {};
  let settingsStop = () => {};
  let fontLibraryStop = () => {};
  let autoKey = '';
  let recommendationStatus = '';
  let nativeError = '';
  let appliedSettings = settings.getSnapshot().settings;
  let navigationRoot: Root | null = null;
  let navigationHost: HTMLElement | null = null;
  let nativeCounter: HTMLElement | null = null;
  let counterDisplay = '';
  let counterPriority = '';
  let bookmarks: BookmarkStore | null = null;
  let bookmarkEpisode = '';
  let bookmarkStop = () => {};
  let resumeReady: Promise<void> = Promise.resolve();
  let nativeNavigation: HTMLElement | null = null;
  let navigationContext: HTMLElement | null = null;
  let navigationExpanded = false;
  let navigationInset = 136;
  let navigationResize: ResizeObserver | null = null;
  let navigationUpdate = () => {};
  let navigationPosition = '';
  const navigationLedger = new StyleLedger();
  const counterSheet = document.createElement('style');
  counterSheet.textContent =
    '[data-unp-native-counter],[data-unp-native-navigation]{display:none!important}';
  const panelLedger = new StyleLedger();
  let entry: HTMLElement | null = null;
  let entryAttributes: { name: string; value: string | null }[] = [];
  const closePanel = () => {
    document.getElementById('btn_theme')?.click();
    entry?.focus();
  };
  const entryKeyboard = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      entry?.click();
      requestAnimationFrame(() =>
        host?.shadowRoot?.querySelector<HTMLButtonElement>('button')?.focus()
      );
    }
  };
  const mountEntry = () => {
    const next = document.querySelector<HTMLElement>('.menu-top-setting');
    if (next === entry) return;
    entry?.removeEventListener('keydown', entryKeyboard);
    for (const { name, value } of entryAttributes) {
      if (value === null) entry?.removeAttribute(name);
      else entry?.setAttribute(name, value);
    }
    entry = next;
    entryAttributes = ['tabindex', 'role', 'aria-label'].map((name) => ({
      name,
      value: entry?.getAttribute(name) ?? null,
    }));
    entry?.setAttribute('tabindex', '0');
    entry?.setAttribute('role', 'button');
    entry?.setAttribute('aria-label', '독서 설정');
    entry?.addEventListener('keydown', entryKeyboard);
  };
  const modePositionKey = (episode: string) => `unp.mode-position.v1.${episode}`;
  const saveBookmark = async () => {
    const target = bookmarks;
    if (!target?.getSnapshot().ready) return false;
    const anchor = engine?.getAnchor();
    if (!anchor) return false;
    await target.save(anchor);
    return !target.getSnapshot().error && !!target.getSnapshot().anchor;
  };
  const restoreBookmark = () => {
    const saved = bookmarks?.getSnapshot();
    if (saved?.anchor) engine?.restore(saved.anchor, true);
    else if (saved?.legacy) engine?.restoreLegacyBookmark(saved.legacy);
  };
  const savePosition = (anchor: ReadingAnchor) => {
    void storage.local.set({ [positionKey(anchor.episodeId)]: anchor }).catch(() => {});
  };
  const resumePosition = (current: ReaderEngine, ...preferred: (ReadingAnchor | null)[]) => {
    const ticket = current.beginResume();
    const episode = current.roots.episodeId;
    return storage.local.get(positionKey(episode)).then(
      (raw) => {
        if (disposed || current !== engine) return;
        current.completeResume(
          ticket,
          resumeAnchor(episode, ...preferred, raw[positionKey(episode)])
        );
      },
      () => {
        if (disposed || current !== engine) return;
        // Do not replace an unread saved position with a startup layout after a failed read.
        current.completeResume(ticket, resumeAnchor(episode, ...preferred), false);
      }
    );
  };
  const onNative = async (option: NativeOption, value: boolean | 'scroll' | 'page') => {
    if (option === 'mode') await resumeReady;
    const before = engine?.getAnchor() ?? null;
    if (option === 'mode') {
      const anchor = engine?.getResumeAnchor();
      if (anchor) {
        await storage.local.set({ [positionKey(anchor.episodeId)]: anchor });
        sessionStorage.setItem(modePositionKey(anchor.episodeId), JSON.stringify(anchor));
      }
    }
    state = await native.request({ type: 'option', option, value });
    nativeError = '';
    engine?.setAnimation(state.animation);
    if (option !== 'mode') engine?.restore(before);
    if (!disposed) {
      render();
      schedule();
    }
  };
  const syncDark = () => {
    if (!sessionEnabled || !settings.getSnapshot().settings.enabled || switching || syncingDark)
      return;
    if (state && state.dark !== settings.getSnapshot().settings.darkMode) {
      const previous = state.dark;
      let succeeded = false;
      syncingDark = true;
      darkSync = storage.local
        .get(nativeDarkKey)
        .then(async (raw) => {
          if (typeof raw[nativeDarkKey] !== 'boolean')
            await storage.local.set({ [nativeDarkKey]: previous });
          if (!disposed && !switching) {
            await onNative('dark', settings.getSnapshot().settings.darkMode);
            succeeded = true;
          }
        })
        .catch((error) => {
          nativeError = String(error);
          render();
        })
        .finally(() => {
          syncingDark = false;
          if (succeeded && !disposed) syncDark();
        });
    }
  };
  const restoreNativeDark = async () => {
    if (restoringDark) return;
    restoringDark = true;
    try {
      await darkSync;
      const raw = await storage.local.get(nativeDarkKey);
      if (typeof raw[nativeDarkKey] !== 'boolean') return;
      const current = await native.request({ type: 'read' });
      if (!current.available) return;
      if (current.dark !== raw[nativeDarkKey])
        await native.request({
          type: 'option',
          option: 'dark',
          value: raw[nativeDarkKey] as boolean,
        });
      await storage.local.remove(nativeDarkKey);
    } finally {
      restoringDark = false;
    }
  };
  const changeEnabled = async (enabled: boolean, reload = true) => {
    if (switching) throw new Error('뷰어를 전환하고 있습니다. 잠시 기다려 주세요.');
    const previous = settings.getSnapshot().settings.enabled;
    switching = true;
    try {
      await resumeReady;
      const anchor = engine?.getResumeAnchor();
      if (anchor) await storage.local.set({ [positionKey(anchor.episodeId)]: anchor });
      settings.update({ enabled });
      await settings.flush();
      if (settings.getSnapshot().status === 'error') throw new Error(settings.getSnapshot().error);
      if (!enabled) {
        await restoreNativeDark();
      }
      if (reload) window.location.reload();
    } catch (error) {
      settings.update({ enabled: previous });
      await settings.flush();
      switching = false;
      throw error;
    }
  };
  const modeMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (value: unknown) => void
  ) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !initialized || disposed) return;
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    if (message.type === 'unp:viewer-mode-probe') {
      respond({ viewer: true, documentKey });
      return;
    }
    if (message.type !== 'unp:viewer-mode-change') return;
    if (
      !('documentKey' in message) ||
      message.documentKey !== documentKey ||
      !('enabled' in message) ||
      typeof message.enabled !== 'boolean'
    ) {
      respond({ ok: false, error: '회차가 바뀌었습니다. 팝업을 다시 열어 주세요.' });
      return;
    }
    void changeEnabled(message.enabled, false).then(
      () => {
        respond({ ok: true });
        // The original document owns reload; a navigation cannot redirect it to another tab/page.
        window.setTimeout(() => {
          if (!disposed && isContextValid()) window.location.reload();
        }, 0);
      },
      (error: unknown) =>
        respond({ ok: false, error: error instanceof Error ? error.message : String(error) })
    );
    return true;
  };
  chrome.runtime.onMessage.addListener(modeMessage);
  const render = () => {
    if (!root || !panelUi) return;
    root.render(
      <panelUi.ViewerPanel
        engine={engine}
        store={settings}
        presets={presets}
        native={state}
        recommendationStatus={recommendationStatus}
        connectionError={nativeError || bookmarks?.getSnapshot().error}
        onNative={onNative}
        onClose={closePanel}
        onEnabledChange={changeEnabled}
        onBookmark={saveBookmark}
        onRestoreBookmark={restoreBookmark}
        bookmarkAvailable={!!(bookmarks?.getSnapshot().anchor || bookmarks?.getSnapshot().legacy)}
        onChange={(patch) => {
          settings.update(patch);
        }}
      />
    );
  };
  const mount = () => {
    mountEntry();
    const container = document.querySelector<HTMLElement>('#theme_box');
    if (!container || host?.isConnected || getComputedStyle(container).display === 'none') return;
    root?.unmount();
    host?.remove();
    panelLedger.restore();
    const controls = [
      container.querySelector<HTMLElement>('#option_panel_1'),
      container.querySelector<HTMLElement>('#option_panel_2'),
      container.querySelector('#btn_panel_1')?.closest('table'),
    ];
    controls.forEach((el) => {
      if (el) panelLedger.set(el, 'display', 'none');
    });
    // The native fixed header/footer are separate stacking contexts. Raising only
    // theme_box cannot put it above navigation inside the later footer context.
    const header = container.closest<HTMLElement>('#header_bar');
    const footer = document.getElementById('footer_bar');
    if (header && footer) {
      const headerLayer = Number.parseInt(getComputedStyle(header).zIndex) || 0;
      const footerLayer = Number.parseInt(getComputedStyle(footer).zIndex) || 0;
      if (headerLayer <= footerLayer) panelLedger.set(header, 'z-index', String(footerLayer + 1));
    }
    panelLedger.set(container, 'width', 'min(780px, calc(100vw - 32px))');
    panelLedger.set(container, 'position', 'fixed');
    panelLedger.set(container, 'left', '50%');
    panelLedger.set(container, 'right', 'auto');
    panelLedger.set(container, 'top', 'clamp(52px, 7dvh, 72px)');
    panelLedger.set(container, 'transform', 'translateX(-50%)');
    panelLedger.set(container, 'height', 'auto');
    panelLedger.set(container, 'max-height', 'calc(100dvh - 100px)');
    panelLedger.set(container, 'background', 'transparent');
    // The site-owned frame has its own square shadow; the rounded panel owns its surface.
    panelLedger.set(container, 'border', '0');
    panelLedger.set(container, 'padding', '0');
    panelLedger.set(container, 'border-radius', '10px');
    panelLedger.set(container, 'box-shadow', 'none');
    panelLedger.set(container, 'overflow', 'visible');
    host = document.createElement('div');
    host.id = 'unp-panel-host';
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !host?.shadowRoot?.querySelector('dialog[open]')) {
        event.preventDefault();
        closePanel();
      }
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    const pendingDark = settings.getSnapshot().settings.darkMode;
    style.textContent = `:host{display:block;border-radius:10px;color:${pendingDark ? '#eeeaf4' : '#3b304c'};background:${pendingDark ? '#24212b' : '#faf8fd'};font:14px var(--unp-ui-font, "UNP UI Freesentation", system-ui)}.panel-pending{padding:32px;text-align:center;opacity:0;animation:unp-ready 0s 150ms forwards}.panel-pending svg{display:block;margin:0 auto 12px;color:#8463f5;animation:unp-book 850ms ease-in-out infinite alternate}.panel-pending button{margin-left:12px}@keyframes unp-ready{to{opacity:1}}@keyframes unp-book{to{opacity:.5;transform:translateY(-2px)}}@media(prefers-reduced-motion:reduce){.panel-pending svg{animation:none}}`;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    container.append(host);
    for (const type of ['click', 'keydown', 'pointerdown'])
      host.addEventListener(type, (event) => event.stopPropagation());
    mount.className = 'panel-pending';
    mount.setAttribute('role', 'status');
    mount.innerHTML =
      '<svg width="28" height="24" viewBox="0 0 28 24" aria-hidden="true"><path d="M14 5C10 2 5 2 2 4v16c4-2 8-2 12 1 4-3 8-3 12-1V4c-4-2-8-2-12 1Zm0 0v16" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>테마박스를 준비하고 있습니다…';
    const expected = host;
    const load = () => {
      panelPromise ??= Promise.all([import('../ui/panel-runtime'), presets.initialize()]).then(
        ([ui]) => {
          panelUi = ui;
        }
      );
      void panelPromise
        .then(() => {
          if (disposed || host !== expected || !panelUi) return;
          style.textContent = panelUi.panelStyles;
          mount.removeAttribute('class');
          mount.removeAttribute('role');
          mount.textContent = '';
          root = panelUi.createRoot(mount);
          render();
        })
        .catch((error) => {
          if (disposed || host !== expected) return;
          console.error('[UNP] Themebox load failed', error);
          panelPromise = undefined;
          mount.textContent = '테마박스를 불러오지 못했습니다.';
          const retry = document.createElement('button');
          retry.textContent = '다시 시도';
          retry.onclick = load;
          mount.append(retry);
        });
    };
    load();
  };
  const positionNavigation = () => {
    if (!engine || !navigationHost) return;
    const frame = engine.getSnapshot().readingFrame;
    if (
      !frame ||
      !engine.roots.box.getClientRects().length ||
      getComputedStyle(engine.roots.box).display === 'none'
    ) {
      navigationHost.style.visibility = 'hidden';
      navigationPosition = '';
      return;
    }
    const placement = settings.getSnapshot().settings.pageNavigationPlacement;
    const { viewportFrame, serviceInset } = engine.getSnapshot();
    const full = viewportFrame ?? frame;
    const positionKey = `${frame.left}/${frame.top}/${frame.width}/${frame.height}/${full.top}/${full.height}/${serviceInset}/${navigationHost.offsetHeight}/${placement}`;
    if (navigationPosition === positionKey) return;
    navigationPosition = positionKey;
    const width = Math.min(920, Math.max(0, frame.width - 16));
    Object.assign(navigationHost.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: `${width}px`,
      margin: '0',
      zIndex: '5',
      visibility: 'visible',
      textAlign: 'center',
    });
    // Fixed positioning can still be relative to a native transformed ancestor.
    const origin = navigationHost.getBoundingClientRect();
    const overlay = placement === 'overlay';
    const followingTop = overlay
      ? frame.top + frame.height - origin.height - 8
      : frame.top + frame.height + 8;
    // The dock uses the unscaled viewport, not the percentage-height paper.
    // Keep native menu/service clearance without shrinking an overlay's text.
    const bottomTop = full.top + full.height - Math.max(64, serviceInset) - origin.height - 8;
    const top = placement === 'fixed' ? bottomTop : Math.min(followingTop, bottomTop);
    navigationHost.style.left = `${frame.left + (frame.width - width) / 2 - origin.left}px`;
    navigationHost.style.top = `${top - origin.top}px`;
  };
  const removeNavigation = () => {
    navigationPosition = '';
    navigationResize?.disconnect();
    navigationResize = null;
    navigationRoot?.unmount();
    navigationRoot = null;
    navigationHost?.remove();
    navigationHost = null;
    navigationContext = null;
    if (nativeNavigation) delete nativeNavigation.dataset.unpNativeNavigation;
    nativeNavigation = null;
    navigationLedger.restore();
    if (nativeCounter) {
      delete nativeCounter.dataset.unpNativeCounter;
      nativeCounter.style.setProperty('display', counterDisplay, counterPriority);
      nativeCounter = null;
    }
    counterSheet.remove();
  };
  const mountNavigation = () => {
    const group = document.getElementById('navigation_group');
    const nativeUI = group
      ?.querySelector<HTMLElement>('#page_navigation')
      ?.closest('table')?.parentElement;
    const expanded = !!(state?.navigation && group && nativeUI);
    const counter = document.getElementById('page_cnt');
    const context = expanded ? group : counter?.parentElement;
    if (!engine || !bookmarks || (!expanded && engine.roots.mode !== 'page') || !context) {
      removeNavigation();
      engine?.setBottomInset(64);
      return;
    }
    if (!navigationUi) {
      navigationPromise ??= import('../ui/navigation-runtime')
        .then((ui) => {
          navigationUi = ui;
          if (!disposed) schedule();
        })
        .catch(() => {
          navigationPromise = undefined;
        });
      return;
    }
    if (
      !navigationHost?.isConnected ||
      navigationContext !== context ||
      navigationExpanded !== expanded ||
      nativeCounter !== counter
    ) {
      removeNavigation();
      navigationContext = context;
      navigationExpanded = expanded;
      nativeCounter = counter;
      if (nativeCounter) {
        counterDisplay = nativeCounter.style.getPropertyValue('display');
        counterPriority = nativeCounter.style.getPropertyPriority('display');
        nativeCounter.dataset.unpNativeCounter = '';
      }
      document.head.append(counterSheet);
      navigationHost = document.createElement('span');
      navigationHost.id = 'unp-navigation-host';
      const shadow = navigationHost.attachShadow({ mode: 'open' });
      const sheet = document.createElement('style');
      sheet.textContent = navigationUi.navigationStyles;
      const element = document.createElement('span');
      shadow.append(sheet, element);
      if (expanded) {
        nativeNavigation = nativeUI!;
        nativeNavigation.dataset.unpNativeNavigation = '';
        navigationLedger.set(group!, 'opacity', '1');
        group!.append(navigationHost);
      } else nativeCounter?.after(navigationHost);
      for (const event of ['click', 'keydown', 'pointerdown'])
        navigationHost.addEventListener(event, (e) => e.stopPropagation());
      navigationRoot = navigationUi.createRoot(element);
      navigationInset = 136;
      navigationResize = new ResizeObserver(() => {
        if (!engine || !navigationHost) return;
        const bounds = navigationHost.getBoundingClientRect();
        if (bounds.height > 0) {
          navigationInset = 64 + bounds.height + 16;
          engine.setBottomInset(navigationInset);
          positionNavigation();
        }
      });
      navigationResize.observe(navigationHost);
    }
    engine.setBottomInset(navigationInset);
    positionNavigation();
    navigationRoot?.render(
      <navigationUi.ReaderNavigation
        engine={engine}
        bookmarks={bookmarks}
        expanded={expanded}
        dark={settings.getSnapshot().settings.darkMode}
        onSave={saveBookmark}
        onRestore={restoreBookmark}
      />
    );
  };
  const reconcile = () => {
    if (disposed) return;
    if (!sessionEnabled) {
      preparation?.reveal();
      void restoreNativeDark().catch(() => {});
      const advanced = document.getElementById('option_panel_2');
      if (advanced && nativeEntry !== advanced) {
        removeNativeEntry();
        nativeEntry = advanced;
        removeNativeEntry = nativeModeEntry(advanced, () => changeEnabled(true));
      }
      return;
    }
    mount();
    const found = detectReader();
    const s = settings.getSnapshot().settings;
    readingControls.update(s);
    listTheme.apply(s.darkMode);
    if (!found) {
      if (engine) {
        navigationUpdate();
        engine.dispose();
        engine = null;
        removeNavigation();
        render();
      }
      return;
    }
    if (engine && engine.roots.body === found.body && engine.roots.mode === found.mode) {
      engine.refreshServiceRegion();
      mountNavigation();
      return;
    }
    const priorPosition =
      engine?.roots.episodeId === found.episodeId ? engine.getResumeAnchor() : null;
    navigationUpdate();
    engine?.dispose();
    if (bookmarkEpisode !== found.episodeId) {
      bookmarkStop();
      bookmarks?.dispose();
      bookmarkEpisode = found.episodeId;
      const legacyKey = `bookmark_${found.episodeId}`;
      bookmarks = new BookmarkStore(found.episodeId, storage, {
        read: () => localStorage.getItem(legacyKey),
        clear: () => localStorage.removeItem(legacyKey),
      });
      bookmarkStop = bookmarks.subscribe(() => render());
      void bookmarks.initialize();
    }
    engine = new ReaderEngine(found, s, native, savePosition, { fonts });
    const current = engine;
    navigationUpdate = current.subscribe(positionNavigation);
    let modePosition: ReadingAnchor | null = null;
    try {
      const key = modePositionKey(found.episodeId);
      const raw = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      modePosition = parseAnchor(raw ? JSON.parse(raw) : null);
    } catch {
      /* A damaged one-time position must not prevent opening the reader. */
    }
    resumeReady = resumePosition(current, priorPosition, modePosition);
    firstDisplay.attach(current, resumeReady);
    current.refreshServiceRegion();
    void native
      .request({ type: 'read' })
      .then((value) => {
        if (!disposed) {
          state = value;
          if (settings.getSnapshot().needsEffectMigration)
            settings.update({ pageEffect: value.animation ? 'fade' : 'none' });
          engine?.setAnimation(value.animation);
          syncDark();
          render();
          mountNavigation();
        }
      })
      .catch(() => {});
    render();
    mountNavigation();
  };
  const schedule = () => {
    if (!disposed && !frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        reconcile();
      });
  };
  const ready = settings
    .initialize()
    .then(async () => {
      const catalog = initializeUserFonts().catch(() => {});
      // A missing local library must not hold up readers using system or web fonts.
      if (settings.getSnapshot().settings.fontFamily.startsWith('unp-local-')) await catalog;
    })
    .then(() => {
      if (disposed) return;
      if (settings.getSnapshot().status === 'error') throw new Error(settings.getSnapshot().error);
      initialized = true;
      sessionEnabled = settings.getSnapshot().settings.enabled;
      if (sessionEnabled && initialized) {
        preparation?.claim(settings.getSnapshot().settings);
        readingControls.update(settings.getSnapshot().settings);
        firstDisplay.warm(settings.getSnapshot().settings);
      }
      stopStatistics = trackReadingStatistics(
        storage,
        () => engine,
        () => !disposed && !switching && sessionEnabled && settings.getSnapshot().settings.enabled
      );
      if (!settings.getSnapshot().settings.enabled || settings.getSnapshot().status === 'error')
        preparation?.reveal();
      observer = new MutationObserver((records) => {
        if (
          records.some(
            (r) =>
              (r.type === 'attributes' && (r.target as Element).id === 'theme_box') ||
              [...r.addedNodes, ...r.removedNodes].some(
                (n) =>
                  n instanceof HTMLElement &&
                  !n.hasAttribute('data-unp-measure') &&
                  !n.closest('#unp-panel-host')
              )
          )
        )
          schedule();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style'],
      });
      const changed = () => {
        const s = settings.getSnapshot().settings;
        if (sessionEnabled !== s.enabled && !switching) {
          recommendationStop();
          autoKey = '';
          if (!notice)
            notice = reloadNotice(() => changeEnabled(settings.getSnapshot().settings.enabled));
          return;
        }
        notice?.remove();
        notice = null;
        if (appliedSettings !== s) {
          if (sessionEnabled && s.enabled) firstDisplay.warm(s);
          engine?.update(s);
          appliedSettings = s;
          syncDark();
        }
        schedule();
        const episode = location.pathname.match(/\/viewer\/(\d+)/)?.[1];
        const key = `${s.enabled}/${s.autoRecommend}/${s.recommendDelay}/${episode}`;
        if (autoKey !== key) {
          autoKey = key;
          recommendationStop();
          recommendationStatus = '';
          if (s.enabled && s.autoRecommend && episode)
            recommendationStop = autoRecommend(s, episode, (text) => {
              recommendationStatus = text;
              render();
            });
        }
      };
      settingsStop = settings.subscribe(changed);
      fontLibraryStop = subscribeFonts(() => {
        if (disposed) return;
        const current = settings.getSnapshot().settings;
        if (current.fontFamily.startsWith('unp-local-')) {
          if (sessionEnabled && current.enabled) firstDisplay.warm(current);
          engine?.update({ ...current });
          engine?.retryFont();
        }
        render();
      });
      reconcile();
      changed();
    })
    .catch((error: unknown) => {
      preparation?.dispose();
      // Startup can be retried in this document. Keep its MAIN-world bridge
      // listening; only the failed isolated runtime is being retired.
      stop(true);
      throw error;
    });
  const stop = (retrying = false) => {
    if (disposed) return;
    stopStatistics();
    disposed = true;
    if (hasExtensionContext()) {
      try {
        chrome.runtime.onMessage.removeListener(modeMessage);
      } catch {
        /* Old context listeners are already detached. */
      }
    }
    cancelAnimationFrame(frame);
    observer?.disconnect();
    settingsStop();
    fontLibraryStop();
    bookmarkStop();
    bookmarks?.dispose();
    recommendationStop();
    navigationUpdate();
    engine?.dispose();
    firstDisplay.dispose();
    fonts.dispose();
    releaseUiFonts();
    readingControls.dispose();
    listTheme.dispose();
    removeNativeEntry();
    notice?.remove();
    removeNavigation();
    root?.unmount();
    host?.remove();
    panelLedger.restore();
    if (initialized) void settings.flush();
    settings.dispose();
    presets.dispose();
    void native
      .request({ type: retrying ? 'release' : 'dispose' })
      .catch(() => {})
      .finally(() => native.dispose());
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    entry?.removeEventListener('keydown', entryKeyboard);
    for (const { name, value } of entryAttributes) {
      if (value === null) entry?.removeAttribute(name);
      else entry?.setAttribute(name, value);
    }
  };
  const onPageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) {
      stop();
      return;
    }
    engine?.flushPosition();
    void settings.flush();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || disposed) return;
    if (engine) resumeReady = resumePosition(engine);
    void bookmarks?.initialize();
    schedule();
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  return { ready, stop: () => stop() };
}
