import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { EXTENSION_VERSION } from '@/shared/config/extension';
import { useToast } from '@/shared/ui/toast';
import type { SettingsSection } from '@/shared/config/settings-sections';
import type { OptionsContext } from '../model/contracts';
import { optionsSections, optionsDescriptions, type OptionsSection } from '../config/navigation';
import { DeferredScreen } from './deferred-screen';
import { HomePanel } from './home-panel';
export { default as optionsStyles } from './styles.css?inline';

const loadFiles = () => import('./settings-file-panel');
const loadFonts = () => import('./user-font-panel');
const loadMisc = () => import('./misc-panel');
const loadPresetsScreen = () => import('./preset-screen');
const loadSettings = () => import('./settings-screen');
const isCommon = (section: OptionsSection) =>
  !['home', 'presets', 'files', 'misc', 'fonts'].includes(section);

export function OptionsPage({ store, stats, loadPresets }: OptionsContext) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [section, setSection] = useState<OptionsSection>('home');
  const [visited, setVisited] = useState<Set<string>>(() => new Set(['home']));
  const [commonSection, setCommonSection] = useState<SettingsSection>('text');
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
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
  const navigate = (id: OptionsSection) => {
    if (id === section) return;
    setSection(id);
    const common = isCommon(id);
    if (common) setCommonSection(id as SettingsSection);
    setVisited((current) => new Set([...current, common ? 'settings' : id]));
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
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
      className={`unp-theme panel management-page${snapshot.settings.darkMode ? ' dark' : ''}`}
      data-testid="management-page"
    >
      <header className="management-header">
        <strong>Unofficial Novelpia Patch</strong>
        <span>{EXTENSION_VERSION}</span>
      </header>
      <div className="management-workspace">
        <nav className="management-nav" aria-label="관리 항목">
          {optionsSections.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={id === 'files' ? 'nav-divider' : ''}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="management-content" ref={content}>
          <header className="management-section-heading">
            <h1 ref={heading} tabIndex={-1}>
              {optionsSections.find(([id]) => id === section)?.[1]}
            </h1>
            <p className="section-description">{optionsDescriptions[section]}</p>
          </header>
          {snapshot.error ? (
            <p className="message error" role="alert">
              {snapshot.error}
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
