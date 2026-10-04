import { useId, useRef, useState } from 'react';
import type { SettingsStore } from '@/entities/settings';
import type { PresetStore } from '@/entities/preset';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import { PresetData } from './deferred-screen';
import type { OptionsScreenProps } from '../model/contracts';

type TransferArea = 'export' | 'import';
type ImportMethod = 'file' | 'json';

export default function SettingsFileScreen({ store, loadPresets, onNotify }: OptionsScreenProps) {
  return (
    <PresetData load={loadPresets}>
      {(presets) => <BackupPanel store={store} presets={presets} onNotify={onNotify} />}
    </PresetData>
  );
}

export function BackupPanel({
  store,
  presets,
  onNotify,
}: {
  store: SettingsStore;
  presets: PresetStore;
  onNotify?: (message: string) => void;
}) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [method, setMethod] = useState<ImportMethod>('file');
  const [json, setJson] = useState('');
  const [fileText, setFileText] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number } | null>(null);
  const [review, setReview] = useState<{
    parsed: ReturnType<PresetStore['parseImport']>;
    text: string;
  } | null>(null);
  const [exported, setExported] = useState('');
  const [errors, setErrors] = useState({ export: '', import: '' });
  const [busy, setBusy] = useState<TransferArea | null>(null);
  const setError = (area: TransferArea, error: string) =>
    setErrors((current) => ({ ...current, [area]: error }));
  const run = async (area: TransferArea, task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(area);
    setError(area, '');
    try {
      await task();
    } catch (error) {
      setError(area, error instanceof Error ? error.message : String(error));
    } finally {
      running.current = false;
      setBusy(null);
    }
  };
  const validate = (value: string) => {
    setReview(null);
    setError('import', '');
    try {
      setReview({ parsed: presets.parseImport(value), text: value });
    } catch (error) {
      setError('import', error instanceof Error ? error.message : 'JSON을 확인해 주세요.');
    }
  };
  const chooseMethod = (next: ImportMethod) => {
    setMethod(next);
    setError('import', '');
    if (next === 'file' && fileText) validate(fileText);
    else setReview(null);
  };
  const exportSettings = () => presets.export(store.getSnapshot().settings);
  return (
    <div className="settings-file-panel">
      <section
        className="transfer-section"
        aria-labelledby={`${id}-export`}
        aria-busy={busy === 'export'}
      >
        <header>
          <h2 id={`${id}-export`}>내보내기</h2>
          <p>현재 읽기 설정과 내 프리셋을 JSON으로 저장합니다.</p>
          <p className="hint">등록한 이미지와 사용자 글꼴 파일은 포함되지 않습니다.</p>
        </header>
        <div className="button-row transfer-actions">
          <button
            type="button"
            className="primary"
            disabled={!!busy}
            onClick={() =>
              void run('export', async () => {
                const url = URL.createObjectURL(
                  new Blob([exportSettings()], { type: 'application/json' })
                );
                try {
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'unofficial-novelpia-settings.json';
                  link.click();
                  onNotify?.('다운로드를 요청했습니다');
                } finally {
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
              })
            }
          >
            파일로 저장
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              void run('export', async () => {
                const value = exportSettings();
                try {
                  await navigator.clipboard.writeText(value);
                  onNotify?.('JSON을 복사했습니다');
                } catch {
                  setExported(value);
                  throw new Error(
                    '자동 복사를 사용할 수 없습니다. 아래 JSON을 선택해 복사해 주세요.'
                  );
                }
              })
            }
          >
            JSON 복사
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!!busy}
            aria-expanded={!!exported}
            aria-controls={`${id}-exported`}
            onClick={() => setExported(exported ? '' : exportSettings())}
          >
            {exported ? 'JSON 접기' : 'JSON 보기'}
          </button>
          <DelayedLoading
            busy={busy === 'export'}
            label="설정 파일을 내보내는 중"
            variant="spinner"
          />
        </div>
        {exported ? (
          <textarea
            id={`${id}-exported`}
            aria-label="내보내기 JSON"
            className="transfer-json"
            readOnly
            value={exported}
            onFocus={(event) => event.currentTarget.select()}
          />
        ) : null}
        {errors.export ? (
          <p className="field-error" role="alert">
            {errors.export}
          </p>
        ) : null}
      </section>
      <section
        className="transfer-section"
        aria-labelledby={`${id}-import`}
        aria-busy={busy === 'import'}
      >
        <header>
          <h2 id={`${id}-import`}>가져오기</h2>
          <p>파일이나 JSON 텍스트를 선택한 뒤 적용할 내용을 확인합니다.</p>
        </header>
        <div
          className="transfer-method"
          role="tablist"
          aria-label="가져오기 방식"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 'file'
                : event.key === 'End'
                  ? 'json'
                  : method === 'file'
                    ? 'json'
                    : 'file';
            chooseMethod(next);
            event.currentTarget
              .querySelector<HTMLButtonElement>(`[data-method="${next}"]`)
              ?.focus();
          }}
        >
          {(['file', 'json'] as const).map((value) => (
            <button
              key={value}
              id={`${id}-tab-${value}`}
              type="button"
              role="tab"
              data-method={value}
              aria-selected={method === value}
              aria-controls={`${id}-import-${value}`}
              tabIndex={method === value ? 0 : -1}
              disabled={!!busy}
              onClick={() => chooseMethod(value)}
            >
              {value === 'file' ? '파일' : 'JSON 텍스트'}
            </button>
          ))}
        </div>
        <div
          id={`${id}-import-file`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-file`}
          hidden={method !== 'file'}
          className="transfer-file-input"
        >
          <button type="button" disabled={!!busy} onClick={() => file.current?.click()}>
            {selectedFile ? '다른 파일 선택' : '파일 선택'}
          </button>
          <div className="transfer-file-description">
            {selectedFile ? (
              <>
                <strong>{selectedFile.name}</strong>
                <span>{selectedFile.size.toLocaleString('ko-KR')} bytes</span>
              </>
            ) : (
              <span>설정 JSON 파일, 최대 2MB</span>
            )}
          </div>
          <input
            ref={file}
            type="file"
            hidden
            accept="application/json,.json"
            aria-label="설정 파일"
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (chosen)
                void run('import', async () => {
                  setReview(null);
                  setFileText('');
                  setSelectedFile({ name: chosen.name, size: chosen.size });
                  if (chosen.size > 2_000_000)
                    throw new Error('파일이 너무 큽니다. 2MB 이하의 JSON 파일을 선택해 주세요.');
                  const value = await chosen.text();
                  setFileText(value);
                  validate(value);
                });
            }}
          />
        </div>
        <div
          id={`${id}-import-json`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-json`}
          hidden={method !== 'json'}
        >
          <label className="transfer-input-label" htmlFor={`${id}-json`}>
            설정 JSON
          </label>
          <textarea
            id={`${id}-json`}
            className="transfer-json"
            spellCheck={false}
            placeholder="JSON을 붙여 넣으세요."
            value={json}
            disabled={!!busy}
            onChange={(event) => {
              setJson(event.target.value);
              setReview(null);
              setError('import', '');
            }}
          />
          <button type="button" disabled={!!busy || !json.trim()} onClick={() => validate(json)}>
            내용 확인
          </button>
        </div>
        <DelayedLoading
          busy={busy === 'import'}
          label="설정 파일을 가져오는 중"
          variant="spinner"
        />
        {errors.import ? (
          <p className="field-error transfer-error" role="alert">
            {errors.import}
          </p>
        ) : null}
        {review ? (
          <div className="import-review">
            <h3>가져올 내용</h3>
            <dl className="transfer-summary">
              <div>
                <dt>읽기 설정</dt>
                <dd>
                  글자 {review.parsed.settings.fontSize}px, 본문 너비{' '}
                  {review.parsed.settings.maxWidth}px
                </dd>
              </div>
              <div>
                <dt>추가할 프리셋</dt>
                <dd>
                  {review.parsed.presets.length + 1}개 <span>(가져온 읽기 설정 1개 포함)</span>
                </dd>
              </div>
            </dl>
            <p className="hint">
              같은 이름은 번호로 구분합니다. 자동 추천 동의, 읽기 위치, 북마크와 독서 통계는
              유지됩니다.
            </p>
            <button
              type="button"
              className="primary"
              disabled={!!busy}
              onClick={() =>
                void run('import', async () => {
                  const settings = await presets.importBackup(review.text);
                  store.update({
                    ...settings,
                    autoRecommend: store.getSnapshot().settings.autoRecommend,
                  });
                  await store.flush();
                  const result = store.getSnapshot();
                  if (result.status === 'error' || result.error)
                    throw new Error(result.error || '설정을 저장하지 못했습니다.');
                  setReview(null);
                  setJson('');
                  setFileText('');
                  setSelectedFile(null);
                  onNotify?.('설정과 프리셋을 가져왔습니다');
                })
              }
            >
              {busy === 'import' ? '가져오는 중…' : '가져오기 및 적용'}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
