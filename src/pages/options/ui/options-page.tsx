import { MotionButton } from '@/shared/ui/motion-button';
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { MotionRoot } from '@/shared/ui/motion-root';
import { useScreenMotion } from '@/shared/ui/use-screen-motion';
import { HashRouter, useLocation, useNavigate } from 'react-router';
import { EXTENSION_VERSION } from '@/shared/config/extension';
import { useToast } from '@/shared/ui/toast';
import type { SettingsSection } from '@/shared/config/settings-sections';
import type { OptionsContext } from '../model/contracts';
import { optionsSections, optionsDescriptions, type OptionsSection } from '../config/navigation';
import { DeferredScreen } from './deferred-screen';
import { HomePanel } from './home-panel';
import { sectionFromPath, sectionPath } from '../model/navigation';
export { default as optionsStyles } from './styles.css?inline';

const loadFiles = () => import('./settings-file-panel');
const loadFonts = () => import('./user-font-panel');
const loadMisc = () => import('./misc-panel');
const loadPresetsScreen = () => import('./preset-screen');
const loadSettings = () => import('./settings-screen');
const isCommon = (section: OptionsSection) =>
  !['home', 'presets', 'files', 'misc', 'fonts'].includes(section);

export function OptionsPage(props: OptionsContext) {
  return (
    <MotionRoot>
      <HashRouter>
        <OptionsContent {...props} />
      </HashRouter>
    </MotionRoot>
  );
}

function OptionsContent({ store, stats, loadPresets }: OptionsContext) {
  const location = useLocation();
  const navigateTo = useNavigate();
  const parsedSection = sectionFromPath(location.pathname);
  const section = parsedSection ?? 'home';
  const darkMode = useStore(store.state, (state) => state.settings.darkMode);
  const error = useStore(store.state, (state) => state.error);
  const [visited, setVisited] = useState<Set<string>>(
    () => new Set(['home', isCommon(section) ? 'settings' : section])
  );
  const [lastCommon, setLastCommon] = useState<SettingsSection>('text');
  const commonSection = isCommon(section) ? (section as SettingsSection) : lastCommon;
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useScreenMotion(content, section);
  const [editorActions, setEditorActions] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const column = content.current;
    if (!column || !editorActions) return;
    const measure = () => {
      const bounds = column.getBoundingClientRect();
      editorActions.style.left = `${bounds.left}px`;
      editorActions.style.width = `${bounds.width}px`;
      column.style.setProperty(
        '--editor-actions-height',
        `${editorActions.getBoundingClientRect().height}px`
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    observer.observe(editorActions);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [editorActions]);
  const { notify, toast } = useToast();
  useLayoutEffect(() => {
    if (parsedSection === null) {
      void navigateTo('/', { replace: true });
      return;
    }
    const common = isCommon(section);
    if (common) setLastCommon(section as SettingsSection);
    setVisited((current) => {
      const key = common ? 'settings' : section;
      return current.has(key) ? current : new Set([...current, key]);
    });
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [section, parsedSection, navigateTo]);
  const navigate = (id: OptionsSection) => {
    if (id !== section) void navigateTo(sectionPath(id));
  };
  const screenProps = {
    store,
    stats,
    loadPresets,
    onNotify: notify,
    actionTarget: editorActions,
    section: commonSection,
  };
  return (
    <main
      className={`unp-theme panel management-page${darkMode ? ' dark' : ''}`}
      data-testid="management-page"
    >
      <header className="management-header">
        <strong>Unofficial Novelpia Patch</strong>
        <span>{EXTENSION_VERSION}</span>
      </header>
      <div className="management-workspace">
        <nav className="management-nav" aria-label="관리 항목">
          {optionsSections.map(([id, label]) => (
            <MotionButton
              key={id}
              type="button"
              className={id === 'files' ? 'nav-divider' : ''}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              {label}
            </MotionButton>
          ))}
        </nav>
        <div className="management-content" ref={content}>
          <header className="management-section-heading">
            <h1 ref={heading} tabIndex={-1}>
              {optionsSections.find(([id]) => id === section)?.[1]}
            </h1>
            <p className="section-description">{optionsDescriptions[section]}</p>
          </header>
          {error ? (
            <p className="message error" role="alert">
              {error}
            </p>
          ) : null}
          <div hidden={section !== 'home'}>
            <HomePanel stats={stats} navigate={navigate} />
          </div>
          {visited.has('files') ? (
            <div hidden={section !== 'files'}>
              <DeferredScreen {...screenProps} load={loadFiles} />
            </div>
          ) : null}
          {visited.has('fonts') ? (
            <div hidden={section !== 'fonts'}>
              <DeferredScreen {...screenProps} load={loadFonts} />
            </div>
          ) : null}
          {visited.has('misc') ? (
            <div hidden={section !== 'misc'}>
              <DeferredScreen {...screenProps} load={loadMisc} />
            </div>
          ) : null}
          {visited.has('presets') ? (
            <div hidden={section !== 'presets'} className="management-presets">
              <DeferredScreen {...screenProps} load={loadPresetsScreen} />
            </div>
          ) : null}
          {visited.has('settings') ? (
            <div hidden={!isCommon(section)}>
              <DeferredScreen {...screenProps} load={loadSettings} />
            </div>
          ) : null}
          <footer className="management-footer">
            Unofficial Novelpia Patch는 노벨피아의 비공식 확장프로그램입니다.
          </footer>
          <div
            className="management-editor-actions"
            hidden={section !== 'presets'}
            ref={setEditorActions}
          />
        </div>
      </div>
      {toast}
    </main>
  );
}
