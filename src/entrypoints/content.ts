import { defineContentScript } from 'wxt/utils/define-content-script';
import { viewerMatches } from '@/shared/config/matches';
import { prepareViewer } from '@/app/runtime/bootstrap';
import { startContentSession } from '@/app/runtime/content-session';
import { prepareStartupFiles } from '@/app/runtime/startup-files';
export default defineContentScript({
  matches: viewerMatches,
  runAt: 'document_start',
  main(ctx) {
    if (ctx.isInvalid) return;
    const bodyReady = () =>
      new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (!document.body && ctx.isValid) return;
          observer.disconnect();
          resolve();
        });
        ctx.onInvalidated(() => {
          observer.disconnect();
          resolve();
        });
        if (document.body) resolve();
        else observer.observe(document, { childList: true, subtree: true });
      });
    const session = startContentSession({
      valid: () => ctx.isValid,
      preparation: prepareViewer(),
      bodyReady,
      load: async (attempt) => {
        const base = chrome.runtime.getURL('content-scripts/esm/');
        await prepareStartupFiles(base, ctx.signal);
        if (ctx.isInvalid) throw new Error('Extension context invalidated');
        const url = `${base}viewer.js`;
        // Chromium remembers a failed module URL within this document. Give the
        // bounded retry its own entry URL; successful shared chunks stay cached.
        return import(/* @vite-ignore */ attempt ? `${url}?startup=${attempt}` : url);
      },
    });
    ctx.onInvalidated(() => session.dispose());
    // onInvalidated alone does not detect an extension reload: WXT checks the
    // runtime when isValid is read. No messages or service-worker keepalive.
    ctx.setInterval(() => {}, 1000);
    const checkContext = () => {
      if (ctx.isValid && document.visibilityState === 'visible') session.wake();
    };
    ctx.addEventListener(window, 'focus', checkContext);
    ctx.addEventListener(document, 'visibilitychange', checkContext);
    ctx.addEventListener(window, 'pageshow', checkContext);
  },
});
