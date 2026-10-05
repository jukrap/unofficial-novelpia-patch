import { MotionButton } from '@/shared/ui/motion-button';
import {
  sectionLinks,
  sectionDescriptions,
  type SettingsSection,
} from '@/shared/config/settings-sections';
import type { Settings } from '@/shared/model/preferences';
import type { NativeOption } from '@/shared/model/native-protocol';
import type { PanelProps, NavigationGuard } from '../model/panel-contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useScreenMotion } from '@/shared/ui/use-screen-motion';
import { Section, Row, Toggle, NumberControl, SettingGroup } from './fields/controls';
import { Icon } from '@/shared/ui/icon';
import { IconAction } from '@/shared/ui/icon-action';
import { PresetManager } from './presets/preset-manager';
import { InfoPanel } from './info-panel';
import { VisualSettingsFields } from './fields/visual-fields';
import { useToast } from '@/shared/ui/toast';
import { SelectControl } from '@/shared/ui/select-control';
export function SettingsPanel({
  store,
  presets,
  native,
  reader,
  onNative,
  onClose,
  onPreview,
  onRetryFont,
  onBookmark,
  onRestoreBookmark,
  bookmarkAvailable = false,
  onChange,
  onEnabledChange,
  recommendationStatus,
  connectionError,
  embedded = false,
  section,
}: PanelProps) {
  const snapshot = useStore(store.state);
  const settings = snapshot.settings;
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [editorActions, setEditorActions] = useState<HTMLDivElement | null>(null);
  const guard = useRef<NavigationGuard | null>(null);
  const registerGuard = useCallback((next: NavigationGuard | null) => {
    guard.current = next;
  }, []);
  const guarded = (action: () => void) => (guard.current ? guard.current(action) : action());
  const [localSection, setActiveSection] = useState<SettingsSection>('text');
  const activeSection = section ?? localSection;
  useScreenMotion(scrollRef, activeSection);
  const requestedFocus = useRef(false);
  const { notify, toast } = useToast();
  const focusSection = (id: string) => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-section="${id}"] h2`)
      ?.focus({ preventScroll: true });
  };
  const jumpTo = (id: SettingsSection) => {
    if (id === activeSection) {
      focusSection(id);
      return;
    }
    guarded(() => {
      requestedFocus.current = true;
      setActiveSection(id);
    });
  };
  useEffect(() => {
    if (requestedFocus.current) {
      focusSection(activeSection);
      requestedFocus.current = false;
    }
  }, [activeSection]);
  const close = () => guarded(() => onClose?.());
  const update = (patch: Partial<Settings>) => (onChange ?? store.update.bind(store))(patch);
  const perform = (task: () => Promise<unknown>) => {
    setError('');
    void task().catch((cause) => setError(String(cause)));
  };
  const option = (name: NativeOption, value: boolean | 'scroll' | 'page') =>
    perform(async () => {
      await store.flush();
      await onNative?.(name, value);
    });
  const fontError =
    reader?.fontStatus && !['글꼴 확인 중…', '글꼴 적용됨'].includes(reader.fontStatus)
      ? reader.fontStatus
      : undefined;
  return (
    <div
      ref={panelRef}
      className={`panel ${settings.darkMode ? 'dark' : ''} ${embedded ? 'embedded' : ''}`}
      data-testid="settings-panel"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !panelRef.current?.querySelector('dialog[open]')
        ) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="panel-header">
        <div className="panel-brand">
          <div className="brand-title">
            <h1>테마박스</h1>
            <span className="brand-name">Unofficial Novelpia Patch</span>
          </div>
        </div>
        <div className="header-actions">
          {snapshot.status !== 'saved' ? (
            <span className={`save-state ${snapshot.status}`} role="status">
              {snapshot.status === 'saving'
                ? '저장 중…'
                : snapshot.status === 'error'
                  ? '저장 실패'
                  : '불러오는 중…'}
            </span>
          ) : null}
          {onClose ? (
            <MotionButton className="icon-button" aria-label="설정 닫기" onClick={close}>
              <Icon name="close" />
            </MotionButton>
          ) : null}
        </div>
      </header>
      <div className="panel-workspace">
        {!section ? (
          <aside className="panel-sidebar">
            <nav className="panel-nav" aria-label="설정 항목 바로가기">
              {sectionLinks
                .filter(([id]) => (native || id !== 'reading') && (!embedded || id !== 'presets'))
                .map(([id, label]) => (
                  <MotionButton
                    key={id}
                    aria-label={`${label} 설정으로 이동`}
                    aria-current={activeSection === id ? 'location' : undefined}
                    className={activeSection === id ? 'current' : ''}
                    onClick={() => jumpTo(id)}
                  >
                    <Icon name={id} />
                    <span>{label}</span>
                  </MotionButton>
                ))}
            </nav>
          </aside>
        ) : null}
        <div className="panel-scroll" ref={scrollRef}>
          {error || snapshot.error || reader?.error || connectionError ? (
            <p className="message error" role="alert">
              {error || snapshot.error || reader?.error || connectionError}
            </p>
          ) : null}
          {snapshot.migrationIssues.length ? (
            <p className="message">
              기존 설정의 일부 값을 기본값으로 복원했습니다: {snapshot.migrationIssues.join(', ')}
            </p>
          ) : null}
          {!embedded && presets ? (
            <Section
              id="presets"
              active={activeSection === 'presets'}
              title="프리셋"
              description={sectionDescriptions.presets}
            >
              <PresetManager
                store={store}
                presets={presets}
                onNotify={notify}
                onGuardChange={registerGuard}
                actionTarget={editorActions}
              />
            </Section>
          ) : null}
          <Section
            id="text"
            active={activeSection === 'text'}
            title="텍스트"
            description={sectionDescriptions.text}
          >
            <VisualSettingsFields
              section="text"
              settings={settings}
              onChange={update}
              onPreview={onPreview}
              onRetryFont={onRetryFont}
              fontError={fontError}
            />
          </Section>
          <Section
            id="layout"
            active={activeSection === 'layout'}
            title="레이아웃"
            description={sectionDescriptions.layout}
          >
            <VisualSettingsFields
              section="layout"
              showPageGap={false}
              settings={settings}
              onChange={update}
              before={
                <SettingGroup title={native ? '읽기 방식' : '페이지와 탐색'}>
                  {native ? (
                    <Row label="읽기 방식">
                      <div className="segments">
                        <MotionButton
                          className={native.mode === 'scroll' ? 'active' : ''}
                          aria-pressed={native.mode === 'scroll'}
                          onClick={() => option('mode', 'scroll')}
                        >
                          스크롤 방식
                        </MotionButton>
                        <MotionButton
                          className={native.mode === 'page' ? 'active' : ''}
                          aria-pressed={native.mode === 'page'}
                          onClick={() => option('mode', 'page')}
                        >
                          페이지 방식
                        </MotionButton>
                      </div>
                    </Row>
                  ) : (
                    <p className="section-description">
                      스크롤·페이지 전환은 회차의 테마박스에서 변경합니다. 페이지 구성과 효과는
                      페이지 방식에서 적용됩니다.
                    </p>
                  )}
                  {!native || native.mode === 'page' ? (
                    <>
                      <Row label="페이지 구성">
                        <div className="segments">
                          <MotionButton
                            className={settings.spreadMode === 'auto' ? 'active' : ''}
                            aria-pressed={settings.spreadMode === 'auto'}
                            onClick={() => update({ spreadMode: 'auto' })}
                          >
                            자동 한 쪽, 두 쪽
                          </MotionButton>
                          <MotionButton
                            className={settings.spreadMode === 'single' ? 'active' : ''}
                            aria-pressed={settings.spreadMode === 'single'}
                            onClick={() => update({ spreadMode: 'single' })}
                          >
                            항상 한 쪽
                          </MotionButton>
                        </div>
                      </Row>
                      {settings.spreadMode === 'auto' ? (
                        <NumberControl name="pageGap" settings={settings} onChange={update} />
                      ) : null}
                      <Row label="페이지 효과">
                        <SelectControl
                          label="페이지 효과"
                          value={settings.pageEffect}
                          onChange={(value) =>
                            update({ pageEffect: value as Settings['pageEffect'] })
                          }
                          options={[
                            { value: 'none', label: '없음' },
                            { value: 'slide', label: '옆으로 밀기' },
                            { value: 'fade', label: '페이드' },
                            { value: 'paper', label: '종이 회전' },
                            { value: 'fold', label: '종이 접힘' },
                          ]}
                        />
                      </Row>
                    </>
                  ) : null}
                  <Row label="하단 진행바 배치">
                    <div className="segments">
                      <MotionButton
                        type="button"
                        className={settings.pageNavigationPlacement === 'fixed' ? 'active' : ''}
                        aria-pressed={settings.pageNavigationPlacement === 'fixed'}
                        onClick={() => update({ pageNavigationPlacement: 'fixed' })}
                      >
                        하단 고정
                      </MotionButton>
                      <MotionButton
                        type="button"
                        className={settings.pageNavigationPlacement === 'reserved' ? 'active' : ''}
                        aria-pressed={settings.pageNavigationPlacement === 'reserved'}
                        onClick={() => update({ pageNavigationPlacement: 'reserved' })}
                      >
                        본문 아래
                      </MotionButton>
                      <MotionButton
                        type="button"
                        className={settings.pageNavigationPlacement === 'overlay' ? 'active' : ''}
                        aria-pressed={settings.pageNavigationPlacement === 'overlay'}
                        onClick={() => update({ pageNavigationPlacement: 'overlay' })}
                      >
                        본문 위
                      </MotionButton>
                    </div>
                  </Row>
                </SettingGroup>
              }
            />
          </Section>
          <Section
            id="appearance"
            active={activeSection === 'appearance'}
            title="외관"
            description={sectionDescriptions.appearance}
          >
            {reader?.backgroundError ? (
              <p className="field-error background-load-error" role="alert">
                {reader.backgroundError}
              </p>
            ) : null}
            <VisualSettingsFields
              section="appearance"
              settings={settings}
              onChange={update}
              after={
                native ? (
                  <Row label="삽화 표시">
                    <Toggle
                      label="삽화 표시"
                      value={native.illustrations}
                      onChange={(value) => option('illustrations', value)}
                    />
                  </Row>
                ) : null
              }
            />
          </Section>
          {native ? (
            <Section
              id="reading"
              active={activeSection === 'reading'}
              title="독서 도구"
              description={sectionDescriptions.reading}
            >
              <SettingGroup title="회차 이동">
                <Row label="정주행">
                  <Toggle
                    label="정주행"
                    value={native.autoNext}
                    onChange={(value) => option('autoNext', value)}
                  />
                </Row>
              </SettingGroup>
              <SettingGroup title="본문 탐색">
                <Row label="네비게이션, 북마크">
                  <Toggle
                    label="네비게이션, 북마크"
                    value={native.navigation}
                    onChange={(value) => option('navigation', value)}
                  />
                </Row>
              </SettingGroup>
            </Section>
          ) : null}
          <Section
            id="lab"
            active={activeSection === 'lab'}
            title="실험실"
            description={sectionDescriptions.lab}
          >
            <SettingGroup title="자동 추천">
              <Row label="자동 추천">
                <Toggle
                  label="자동 추천"
                  value={settings.autoRecommend}
                  onChange={(value) => update({ autoRecommend: value })}
                />
              </Row>
              {settings.autoRecommend ? (
                <NumberControl name="recommendDelay" settings={settings} onChange={update} />
              ) : null}
              {recommendationStatus ? (
                <p className="group-status" role="status">
                  <Icon
                    name={
                      recommendationStatus.includes('이미 추천') ||
                      recommendationStatus.includes('추천했습니다')
                        ? 'check'
                        : 'info'
                    }
                  />
                  {recommendationStatus}
                </p>
              ) : null}
            </SettingGroup>
          </Section>
          <Section
            id="info"
            active={activeSection === 'info'}
            title="정보"
            description={sectionDescriptions.info}
          >
            <InfoPanel
              settings={settings}
              onEnabledChange={
                onEnabledChange ??
                (async (enabled) => {
                  update({ enabled });
                  await store.flush();
                  if (store.getSnapshot().status === 'error')
                    throw new Error(store.getSnapshot().error);
                  notify('변경했습니다. 열려 있는 뷰어를 새로고침하면 적용됩니다.');
                })
              }
              viewer={Boolean(native)}
            />
          </Section>
        </div>
      </div>
      <div className="panel-editor-actions" ref={setEditorActions} />
      <footer className="panel-footer">
        <div className="bookmark-actions">
          {onBookmark ? (
            <IconAction
              label="현재 위치 북마크 저장"
              icon="bookmark"
              disabled={!settings.enabled}
              onClick={() =>
                perform(async () => {
                  if (await onBookmark()) notify('북마크를 저장했습니다.');
                })
              }
            />
          ) : null}
          {onRestoreBookmark ? (
            <IconAction
              label="북마크로 이동"
              icon="restore"
              disabled={!settings.enabled || !bookmarkAvailable}
              onClick={onRestoreBookmark}
            />
          ) : null}
        </div>
        {onClose ? (
          <MotionButton className="return-button" aria-label="테마박스 닫기" onClick={close}>
            닫기
          </MotionButton>
        ) : null}
      </footer>
      {toast}
    </div>
  );
}
