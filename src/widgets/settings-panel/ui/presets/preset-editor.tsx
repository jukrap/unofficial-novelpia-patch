import { MotionButton } from '@/shared/ui/motion-button';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { PresetDraft } from '@/entities/preset';
import type { Settings } from '@/shared/model/preferences';
import { ReadingPreview } from '../reading-preview';
import { VisualSettingsFields } from '../fields/visual-fields';
import { Tooltip } from '@/shared/ui/tooltip';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import { FontRetryScope } from '../../model/font-retry';

const editorSections = [
  ['text', '텍스트'],
  ['layout', '레이아웃'],
  ['appearance', '외관'],
] as const;

export function PresetEditor({
  draft,
  busy,
  error,
  conflict,
  latestAvailable,
  onChange,
  onImport,
  onCancel,
  onSave,
  onDelete,
  onLoadLatest,
  onSaveAsNew,
  actionTarget,
}: {
  draft: PresetDraft;
  busy: boolean;
  error: string;
  conflict: boolean;
  latestAvailable: boolean;
  onChange: (draft: PresetDraft) => void;
  onImport: () => void;
  onCancel: () => void;
  onSave: (apply: boolean) => void;
  onDelete?: () => void;
  onLoadLatest: () => void;
  onSaveAsNew: () => void;
  actionTarget?: HTMLElement | null;
}) {
  const [section, setSection] = useState<(typeof editorSections)[number][0]>('text');
  const [assetBusy, setAssetBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    nameInput.current?.focus({ preventScroll: true });
    const scroll = form.current?.closest<HTMLElement>('.panel-scroll');
    if (scroll) scroll.scrollTo({ top: 0, behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorNotice.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);
  const id = useId();
  const actions = (
    <footer
      className="preset-editor-actions"
      role="group"
      aria-label="프리셋 편집 작업"
      aria-busy={busy || assetBusy}
    >
      {onDelete ? (
        <MotionButton
          type="button"
          className="text-button preset-delete"
          disabled={busy || assetBusy || conflict}
          onClick={onDelete}
        >
          삭제
        </MotionButton>
      ) : (
        <span />
      )}
      <div className="button-row">
        <DelayedLoading busy={busy} label="프리셋 저장 중" variant="spinner" />
        <MotionButton type="button" disabled={busy} onClick={onCancel}>
          취소
        </MotionButton>
        <MotionButton type="submit" form={`${id}-form`} disabled={busy || assetBusy || conflict}>
          {busy ? '저장 중…' : '저장'}
        </MotionButton>
        <MotionButton
          type="button"
          className="primary"
          disabled={busy || assetBusy || conflict}
          onClick={() => {
            if (form.current?.reportValidity()) onSave(true);
          }}
        >
          저장하고 적용
        </MotionButton>
      </div>
    </footer>
  );
  const update = (patch: Partial<Settings>) => {
    onChange({ ...draft, settings: { ...draft.settings, ...patch } });
  };
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % 3
        : event.key === 'ArrowLeft'
          ? (index + 2) % 3
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 2
              : null;
    if (next === null) return;
    event.preventDefault();
    setSection(editorSections[next]![0]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };
  const content = (
    <form
      ref={form}
      id={`${id}-form`}
      className="preset-editor"
      aria-label="프리셋 편집"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !assetBusy && !conflict) onSave(false);
      }}
    >
      <header className="preset-editor-heading">
        <div>
          <h3>{draft.id ? '프리셋 편집' : '새 프리셋'}</h3>
          <p>편집 중에는 본문 설정이 바뀌지 않습니다.</p>
        </div>
      </header>
      <fieldset className="preset-editor-fields" disabled={busy}>
        <label htmlFor={`${id}-name`}>
          <span className="preset-field-label">이름</span>
          <input
            id={`${id}-name`}
            ref={nameInput}
            required
            maxLength={80}
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </label>
        <label htmlFor={`${id}-description`}>
          <span className="preset-field-label">
            설명 <em>선택</em>
          </span>
          <input
            id={`${id}-description`}
            maxLength={1000}
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
          />
        </label>
      </fieldset>
      <div className="preset-import-current">
        <Tooltip text="현재 뷰어에 적용된 설정을 이 편집 초안으로 가져옵니다. 저장 전까지 프리셋은 바뀌지 않습니다.">
          <MotionButton type="button" disabled={busy || assetBusy} onClick={onImport}>
            현재 읽기 설정 가져오기
          </MotionButton>
        </Tooltip>
      </div>
      <ReadingPreview settings={draft.settings} loadFont />
      <div className="preset-editor-tabs" role="tablist" aria-label="프리셋 설정 항목">
        {editorSections.map(([value, label], index) => (
          <MotionButton
            key={value}
            id={`${id}-tab-${value}`}
            type="button"
            role="tab"
            disabled={busy || assetBusy}
            aria-selected={section === value}
            aria-controls={`${id}-fields`}
            tabIndex={section === value ? 0 : -1}
            onKeyDown={(event) => navigateTabs(event, index)}
            onClick={() => setSection(value)}
          >
            {label}
          </MotionButton>
        ))}
      </div>
      <fieldset
        disabled={busy}
        className="preset-editor-controls"
        id={`${id}-fields`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${section}`}
      >
        <VisualSettingsFields
          section={section}
          settings={draft.settings}
          onChange={update}
          preview={false}
          rememberColors={false}
          onBackgroundBusyChange={setAssetBusy}
        />
      </fieldset>
      {conflict ? (
        <div className="preset-conflict" role="alert">
          <p>
            {latestAvailable
              ? '다른 화면에서 이 프리셋을 수정했습니다. 편집 중인 내용은 유지됩니다.'
              : '다른 화면에서 이 프리셋을 삭제했습니다. 편집 중인 내용은 새 프리셋으로 저장할 수 있습니다.'}
          </p>
          <div className="button-row">
            {latestAvailable ? (
              <MotionButton type="button" disabled={busy || assetBusy} onClick={onLoadLatest}>
                최신 내용 불러오기
              </MotionButton>
            ) : null}
            <MotionButton type="button" disabled={busy || assetBusy} onClick={onSaveAsNew}>
              새 프리셋으로 저장
            </MotionButton>
          </div>
        </div>
      ) : null}
      {error ? (
        <p ref={errorNotice} className="message error" role="alert">
          {error}
        </p>
      ) : null}
      {actionTarget ? createPortal(actions, actionTarget) : actions}
    </form>
  );
  return <FontRetryScope>{content}</FontRetryScope>;
}
