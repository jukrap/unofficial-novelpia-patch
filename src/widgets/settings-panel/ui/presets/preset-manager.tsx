import { AnimatePresence } from 'motion/react';
import { MotionButton } from '@/shared/ui/motion-button';
import {
  lazy,
  Component,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';
import { useScreenMotion } from '@/shared/ui/use-screen-motion';
import { SettingsStore } from '@/entities/settings';
import {
  PresetStore,
  builtInPresets,
  legacyBuiltInPresets,
  createPresetDraft,
  presetRevision,
  applyPresetSettings,
  presetSettingsEqual,
  type PresetDraft,
} from '@/entities/preset';
import type { Preset } from '@/shared/model/preferences';
import {
  commitBackgroundAsset,
  discardBackgroundAsset,
  rollbackBackgroundAsset,
} from '@/shared/platform/background-assets';
import { Modal } from '../fields/controls';
import { PresetCard } from './preset-card';
import { LoadingIndicator } from '@/shared/ui/loading-indicator';
import presetStyles from './presets.css?inline';
const PresetEditor = lazy(() =>
  import('./preset-editor').then((module) => ({ default: module.PresetEditor }))
);

class EditorLoadBoundary extends Component<
  {
    children: ReactNode;
    onCancel: () => void;
    onReload: () => void;
  },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="message error" role="alert">
        <p>편집 화면을 불러오지 못했습니다. 확장프로그램이 업데이트되었을 수 있습니다.</p>
        <p>
          현재 뷰어 또는 설정 페이지를 새로고침한 뒤 다시 시도해 주세요. 저장된 프리셋은 유지됩니다.
        </p>
        <div className="button-row">
          <MotionButton type="button" onClick={this.props.onReload}>
            현재 페이지 새로고침
          </MotionButton>
          <MotionButton type="button" onClick={this.props.onCancel}>
            목록으로 돌아가기
          </MotionButton>
        </div>
      </div>
    );
  }
}

type NavigationGuard = (action: () => void) => void;
interface EditorState {
  draft: PresetDraft;
  initial: PresetDraft;
}

function draftChanged({ draft, initial }: EditorState) {
  return (
    draft.name !== initial.name ||
    draft.description !== initial.description ||
    !presetSettingsEqual(draft.settings, initial.settings)
  );
}

export function PresetManager({
  store,
  presets,
  onNotify,
  onGuardChange,
  actionTarget,
}: {
  store: SettingsStore;
  presets: PresetStore;
  onNotify?: (message: string) => void;
  onGuardChange?: (guard: NavigationGuard | null) => void;
  actionTarget?: HTMLElement | null;
}) {
  const settings = useStore(store.state, (state) => state.settings);
  const snapshot = useStore(presets.state);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  useScreenMotion(workspace, editor ? 'editor' : 'gallery');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirmation, setConfirmation] = useState<{
    kind: 'discard' | 'delete';
    action: () => void;
  } | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const dirty = editor ? draftChanged(editor) : false;
  const closeEditor = useCallback(() => {
    if (editorRef.current) discardBackgroundAsset(editorRef.current.draft.settings);
    setEditor(null);
    setError('');
    requestAnimationFrame(() => createButton.current?.focus({ preventScroll: true }));
  }, []);
  useEffect(
    () => () => {
      if (editorRef.current) discardBackgroundAsset(editorRef.current.draft.settings);
    },
    []
  );
  const guard = useCallback<NavigationGuard>(
    (action) => {
      if (busyRef.current) return;
      const leave = () => {
        closeEditor();
        action();
      };
      if (editorRef.current && draftChanged(editorRef.current))
        setConfirmation({ kind: 'discard', action: leave });
      else leave();
    },
    [closeEditor]
  );
  useEffect(() => {
    onGuardChange?.(editor ? guard : null);
    return () => onGuardChange?.(null);
  }, [Boolean(editor), guard, onGuardChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const run = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const apply = async (preset: Preset) => {
    // Persist the selected card before a reading-mode change can reload the viewer.
    const previous = presets.getSnapshot().selectedId;
    await presets.select(preset.id);
    try {
      store.update(applyPresetSettings(store.getSnapshot().settings, preset.settings));
      await store.flush();
      if (store.getSnapshot().status === 'error') throw new Error(store.getSnapshot().error);
    } catch (error) {
      await presets.select(previous).catch(() => {});
      throw error;
    }
  };
  const openEditor = (source?: Preset, duplicate = false) => {
    const draft = createPresetDraft(store.getSnapshot().settings, source, duplicate);
    if (duplicate) {
      const base = draft.name.slice(0, 70);
      const used = new Set(snapshot.presets.map((preset) => preset.name));
      draft.name = base;
      for (let number = 2; used.has(draft.name); number++) draft.name = `${base} (${number})`;
    }
    setEditor({ draft, initial: draft });
    setError('');
  };
  const save = (applyAfter: boolean, asNew = false) => {
    const current = editorRef.current;
    if (!current) return;
    void run(async () => {
      const saving = asNew
        ? { ...current.draft, id: undefined, sourceId: null, sourceRevision: null }
        : current.draft;
      if (asNew) {
        const used = new Set(presets.getSnapshot().presets.map((preset) => preset.name));
        const base = `${saving.name.trim().slice(0, 65)} 복사`;
        if (used.has(saving.name.trim())) saving.name = base;
        for (let number = 2; used.has(saving.name.trim()); number++)
          saving.name = `${base} (${number})`;
      }
      const committed = await commitBackgroundAsset(saving.settings);
      let saved: Preset;
      try {
        saved = await presets.saveDraft({ ...saving, settings: committed });
      } catch (cause) {
        await rollbackBackgroundAsset(saving.settings).catch(() => {});
        throw cause;
      }
      discardBackgroundAsset(saving.settings);
      const fresh = createPresetDraft(store.getSnapshot().settings, saved);
      setEditor({ draft: fresh, initial: fresh });
      if (applyAfter) await apply(saved);
      closeEditor();
      onNotify?.(applyAfter ? '프리셋을 저장하고 적용했습니다.' : '프리셋을 저장했습니다.');
    });
  };
  const draft = editor?.draft;
  const latest = draft?.id ? snapshot.presets.find((preset) => preset.id === draft.id) : undefined;
  const conflict = Boolean(
    draft?.id && (!latest || presetRevision(latest) !== draft.sourceRevision)
  );
  const selectedLegacy = legacyBuiltInPresets.find((preset) => preset.id === snapshot.selectedId);
  const matching =
    snapshot.presets.length >= 7
      ? snapshot.presets.filter((preset) =>
          `${preset.name} ${preset.description}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())
        )
      : snapshot.presets;
  const renderCard = (preset: Preset) => (
    <PresetCard
      key={preset.id}
      preset={preset}
      current={presetSettingsEqual(settings, preset.settings)}
      busy={busy}
      onApply={() =>
        void run(async () => {
          await apply(preset);
          onNotify?.(`${preset.name} 프리셋을 적용했습니다.`);
        })
      }
      onEdit={preset.isDefault ? undefined : () => openEditor(preset)}
      onDuplicate={() => openEditor(preset, true)}
    />
  );
  return (
    <div className="preset-workspace" ref={workspace}>
      <style>{presetStyles}</style>
      {draft ? (
        <EditorLoadBoundary
          onCancel={() => guard(closeEditor)}
          onReload={() => guard(() => window.location.reload())}
        >
          <Suspense
            fallback={<LoadingIndicator label="프리셋 편집기를 불러오는 중" variant="book" />}
          >
            <PresetEditor
              draft={draft}
              busy={busy}
              error={error}
              conflict={conflict}
              latestAvailable={Boolean(latest)}
              actionTarget={actionTarget}
              onChange={(next) =>
                setEditor((current) => (current ? { ...current, draft: next } : current))
              }
              onImport={() => {
                if (editorRef.current) discardBackgroundAsset(editorRef.current.draft.settings);
                setEditor((current) =>
                  current
                    ? {
                        ...current,
                        draft: {
                          ...current.draft,
                          settings: applyPresetSettings(
                            current.draft.settings,
                            store.getSnapshot().settings
                          ),
                        },
                      }
                    : current
                );
              }}
              onCancel={() => guard(closeEditor)}
              onSave={save}
              onLoadLatest={() =>
                guard(() => {
                  if (latest) openEditor(latest);
                })
              }
              onSaveAsNew={() => save(false, true)}
              onDelete={
                draft.id
                  ? () =>
                      setConfirmation({
                        kind: 'delete',
                        action: () =>
                          void run(async () => {
                            await presets.remove(draft.id!, {
                              expectedRevision: draft.sourceRevision ?? undefined,
                            });
                            closeEditor();
                            onNotify?.('프리셋을 삭제했습니다.');
                          }),
                      })
                  : undefined
              }
            />
          </Suspense>
        </EditorLoadBoundary>
      ) : (
        <>
          <section className="preset-gallery-group" aria-label="내 프리셋">
            <header className="preset-gallery-heading">
              <h3>내 프리셋</h3>
              <MotionButton
                type="button"
                className="primary"
                ref={createButton}
                disabled={busy}
                onClick={() => openEditor()}
              >
                현재 설정으로 만들기
              </MotionButton>
            </header>
            {snapshot.presets.length >= 7 ? (
              <input
                className="preset-search"
                type="search"
                aria-label="내 프리셋 검색"
                placeholder="이름이나 설명 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            ) : null}
            {matching.length ? (
              <div className="preset-gallery">{matching.map(renderCard)}</div>
            ) : (
              <p className="preset-gallery-empty">
                {snapshot.presets.length
                  ? '일치하는 프리셋이 없습니다.'
                  : '지금 읽는 설정을 저장하거나, 아래 프리셋을 복제해 만들어 보세요.'}
              </p>
            )}
          </section>
          <section className="preset-gallery-group" aria-label="기본 제공 프리셋">
            <header className="preset-gallery-heading">
              <h3>기본 제공</h3>
            </header>
            <div className="preset-gallery">{builtInPresets.map(renderCard)}</div>
          </section>
          {selectedLegacy ? (
            <section className="preset-gallery-group" aria-label="이전에 선택한 프리셋">
              <header className="preset-gallery-heading">
                <h3>이전에 선택한 프리셋</h3>
              </header>
              <p className="preset-legacy-note">
                기존 값을 유지한 항목입니다. 복제하여 내 프리셋으로 저장할 수 있습니다.
              </p>
              <div className="preset-gallery">{renderCard(selectedLegacy)}</div>
            </section>
          ) : null}
          {error || snapshot.error ? (
            <p className="message error" role="alert">
              {error || snapshot.error}
            </p>
          ) : null}
        </>
      )}
      <AnimatePresence>
        {confirmation ? (
          <Modal
            title={confirmation.kind === 'delete' ? '프리셋 삭제' : '편집 내용 버리기'}
            onClose={() => setConfirmation(null)}
          >
            <p>
              {confirmation.kind === 'delete'
                ? `‘${draft?.name}’ 프리셋을 삭제할까요? 현재 읽기 설정은 유지됩니다.`
                : '저장하지 않은 편집 내용이 있습니다. 이 내용을 버리고 이동할까요?'}
            </p>
            <div className="button-row modal-actions">
              <MotionButton type="button" onClick={() => setConfirmation(null)}>
                {confirmation.kind === 'delete' ? '취소' : '계속 편집'}
              </MotionButton>
              <MotionButton
                type="button"
                className="primary"
                onClick={() => {
                  const action = confirmation.action;
                  setConfirmation(null);
                  action();
                }}
              >
                {confirmation.kind === 'delete' ? '삭제' : '버리고 이동'}
              </MotionButton>
            </div>
          </Modal>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
