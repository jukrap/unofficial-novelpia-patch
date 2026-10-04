import { MotionButton } from '@/shared/ui/motion-button';
import { m, useReducedMotion } from 'motion/react';
import { motionDuration } from '@/shared/config/motion';
import { useEffect, useState, type ReactNode } from 'react';
import { EXTENSION_VERSION } from '@/shared/config/extension';
import { ViewerModeSwitch } from '@/features/viewer-mode';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import { uiThemeStyles } from '@/shared/ui/theme-styles';
import { popupLinks } from '../config/links';
import { useViewerMode } from '../model/use-viewer-mode';
import styles from './styles.css?inline';

const linkIcons = {
  issue: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v6M12 17h.01',
  message: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2ZM7 9h10M7 13h7',
  github:
    'M8 20v-3c-3 .5-4-1-4-2m12 5v-4c0-1-.4-1.5-1-2 3-.4 5-1.6 5-5 0-1.4-.5-2.5-1.3-3.4.2-.8.2-2-.2-3.1-1.7 0-2.8.8-3.3 1.2a11 11 0 0 0-6.4 0C8.3 3.3 7.2 2.5 5.5 2.5c-.4 1.1-.4 2.3-.2 3.1C4.5 6.5 4 7.6 4 9c0 3.4 2 4.6 5 5-.6.5-1 1-1 2',
} as const;

function PopupLink({ href, children }: { href: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <m.a
      href={href}
      target="_blank"
      rel="noreferrer"
      whileHover={{ color: 'var(--accent-text)', backgroundColor: 'var(--wash)' }}
      transition={{ duration: reduced ? 0 : motionDuration.control }}
    >
      {children}
    </m.a>
  );
}

export function PopupPage({ fontsReady }: { fontsReady: Promise<boolean> }) {
  const { status, error, loading, refresh, change } = useViewerMode();
  const [fontState, setFontState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  const dark = status?.darkMode ?? matchMedia('(prefers-color-scheme: dark)').matches;

  useEffect(() => {
    let active = true;
    void fontsReady.then(
      (ready) => {
        if (active) setFontState(ready ? 'ready' : 'fallback');
      },
      () => {
        if (active) setFontState('fallback');
      }
    );
    return () => {
      active = false;
    };
  }, [fontsReady]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const openOptions = async () => {
    if (opening) return;
    setOpening(true);
    setOpenError('');
    try {
      await chrome.runtime.openOptionsPage();
      window.close();
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(false);
    }
  };

  return (
    <main
      className={`unp-theme extension-popup${dark ? ' dark' : ''}`}
      data-font-state={fontState}
      aria-busy={fontState === 'loading'}
    >
      <style>{uiThemeStyles + styles}</style>
      {fontState === 'loading' ? (
        <div className="popup-font-loading">
          <DelayedLoading busy label="팝업 글꼴 준비 중" />
        </div>
      ) : null}
      <div
        className="popup-content"
        inert={fontState === 'loading'}
        aria-hidden={fontState === 'loading' || undefined}
      >
        <header className="popup-header">
          <img
            className="popup-product-icon"
            src={chrome.runtime.getURL('/icons/icon128.png')}
            width="40"
            height="40"
            alt=""
          />
          <div className="popup-brand">
            <h1>Unofficial Novelpia Patch</h1>
            <p className="popup-description">Novelpia Community Extension</p>
          </div>
          <span className="popup-version">{EXTENSION_VERSION}</span>
        </header>
        <section className="popup-mode" aria-label="뷰어 설정" aria-busy={loading}>
          {status ? (
            <ViewerModeSwitch
              enabled={status.enabled}
              onChangeAsync={change}
              context="popup"
              connected={status.connected}
            />
          ) : (
            <div className="popup-loading">
              <DelayedLoading busy={loading} label="뷰어 상태 불러오는 중" />
            </div>
          )}
          {error ? (
            <div className="popup-error">
              <p role="alert">{error}</p>
              <MotionButton type="button" onClick={() => void refresh()} disabled={loading}>
                다시 시도
              </MotionButton>
            </div>
          ) : null}
        </section>
        <MotionButton
          className="primary popup-open-settings"
          type="button"
          disabled={opening}
          aria-busy={opening}
          onClick={() => void openOptions()}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" />
          </svg>
          설정 열기
        </MotionButton>
        {openError ? (
          <p className="popup-open-error" role="alert">
            {openError}
          </p>
        ) : null}
        <nav className="popup-links" aria-label="프로젝트 링크">
          {popupLinks.map(({ href, label, icon }) => (
            <PopupLink key={href} href={href}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={linkIcons[icon]} />
              </svg>
              <span>{label}</span>
              <svg
                className="popup-link-arrow"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 17 17 7M7 7h10v10" />
              </svg>
            </PopupLink>
          ))}
        </nav>
      </div>
    </main>
  );
}
