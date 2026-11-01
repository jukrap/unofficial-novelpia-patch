import { MotionButton } from '@/shared/ui/motion-button';
import { useEffect, useRef, useState } from 'react';
import type { Settings } from '@/shared/model/preferences';
import {
  commitBackgroundAsset,
  discardBackgroundAsset,
  listBackgroundAssets,
  pendingBackgroundAsset,
  removeBackgroundAsset,
  stageBackgroundAsset,
  type BackgroundAssetInfo,
} from '@/shared/platform/background-assets';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import { Row } from './controls';
import { SelectControl } from '@/shared/ui/select-control';
import styles from './background-image-field.css?inline';
import { BUILTIN_BACKGROUNDS } from '@/shared/config/backgrounds';

export function BackgroundImageField({
  settings,
  onChange,
  draft = false,
  onBusyChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  draft?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [assets, setAssets] = useState<BackgroundAssetInfo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(false);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const current = useRef(settings);
  current.current = settings;
  const source = settings.backgroundImageSource ?? 'url';
  const pending = pendingBackgroundAsset(settings.backgroundAssetId);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(
    () => () => {
      onBusyChange?.(false);
    },
    [onBusyChange]
  );
  const refresh = async () => setAssets(await listBackgroundAssets());
  useEffect(() => {
    let active = true;
    if (source !== 'file') return;
    void listBackgroundAssets().then(
      (items) => {
        if (active) setAssets(items);
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => {
      active = false;
    };
  }, [source, settings.backgroundAssetId]);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  const chooseFile = async (file: File) => {
    const request = ++generation.current;
    setBusy(true);
    setError('');
    let temporary: Settings | undefined;
    try {
      const id = await stageBackgroundAsset(file);
      temporary = { ...current.current, backgroundImageSource: 'file', backgroundAssetId: id };
      if (request !== generation.current) return discardBackgroundAsset(temporary);
      const next = draft ? temporary : await commitBackgroundAsset(temporary);
      if (request !== generation.current) return discardBackgroundAsset(temporary);
      discardBackgroundAsset(current.current);
      onChange({ backgroundImageSource: 'file', backgroundAssetId: next.backgroundAssetId });
      if (!draft) {
        discardBackgroundAsset(temporary);
        await refresh();
      }
    } catch (cause) {
      if (temporary) discardBackgroundAsset(temporary);
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const options = [
    { value: '', label: '선택한 이미지 없음' },
    ...assets.map((asset) => ({ value: asset.id, label: asset.name })),
    ...(pending ? [{ value: pending.id, label: `${pending.name} (저장 전)` }] : []),
  ];
  const missing =
    settings.backgroundAssetId &&
    !options.some((option) => option.value === settings.backgroundAssetId);
  if (missing) options.push({ value: settings.backgroundAssetId!, label: '이미지 다시 등록' });
  return (
    <Row label="배경 이미지">
      <style>{styles}</style>
      <div className="background-image-field" aria-busy={busy}>
        <div className="segments" aria-label="배경 이미지 출처">
          <MotionButton
            type="button"
            disabled={busy}
            className={source === 'builtin' ? 'active' : ''}
            aria-pressed={source === 'builtin'}
            onClick={() => {
              discardBackgroundAsset(current.current);
              setError('');
              onChange({
                backgroundImageSource: 'builtin',
                backgroundAssetId: BUILTIN_BACKGROUNDS.some(
                  (item) => item.id === settings.backgroundAssetId
                )
                  ? settings.backgroundAssetId
                  : BUILTIN_BACKGROUNDS[0].id,
              });
            }}
          >
            기본 배경
          </MotionButton>
          <MotionButton
            type="button"
            disabled={busy}
            className={source === 'url' ? 'active' : ''}
            aria-pressed={source === 'url'}
            onClick={() => {
              setError('');
              onChange({ backgroundImageSource: 'url' });
            }}
          >
            주소
          </MotionButton>
          <MotionButton
            type="button"
            disabled={busy}
            className={source === 'file' ? 'active' : ''}
            aria-pressed={source === 'file'}
            onClick={() => {
              setError('');
              onChange({
                backgroundImageSource: 'file',
                ...(BUILTIN_BACKGROUNDS.some((item) => item.id === settings.backgroundAssetId)
                  ? { backgroundAssetId: null }
                  : {}),
              });
            }}
          >
            파일
          </MotionButton>
        </div>
        {source === 'builtin' ? (
          <>
            <SelectControl
              label="기본 배경 이미지"
              value={settings.backgroundAssetId ?? ''}
              options={BUILTIN_BACKGROUNDS.map((item) => ({ value: item.id, label: item.name }))}
              onChange={(value) => onChange({ backgroundAssetId: value })}
            />
            <p className="background-file-note">
              확장에 포함되어 있어 파일 등록 없이 사용할 수 있습니다.
            </p>
          </>
        ) : source === 'url' ? (
          <input
            aria-label="배경 이미지 주소"
            type="url"
            placeholder="https://…"
            defaultValue={settings.backgroundImage}
            key={settings.backgroundImage}
            onBlur={(event) => onChange({ backgroundImage: event.target.value })}
          />
        ) : (
          <>
            <SelectControl
              label="등록 배경 이미지"
              value={settings.backgroundAssetId ?? ''}
              options={busy ? options.map((option) => ({ ...option, disabled: true })) : options}
              onChange={(value) => {
                if (busy) return;
                discardBackgroundAsset(current.current);
                onChange({ backgroundAssetId: value || null });
                setError('');
              }}
            />
            <div className="background-file-actions">
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="배경 이미지 파일"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void chooseFile(file);
                }}
              />
              <MotionButton type="button" disabled={busy} onClick={() => input.current?.click()}>
                <DelayedLoading busy={busy} label="이미지 확인 중" variant="spinner" /> 파일 선택
              </MotionButton>
              <MotionButton
                type="button"
                disabled={busy}
                aria-expanded={managing}
                onClick={() => {
                  setManaging((value) => !value);
                  void refresh().catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause))
                  );
                }}
              >
                등록 이미지 관리
              </MotionButton>
            </div>
            <p className="background-file-note">
              이 브라우저에만 보관합니다. 설정 파일에는 이미지가 포함되지 않습니다. JPEG, PNG, WebP,
              최대 10MiB.
            </p>
            {managing ? (
              <div className="background-file-library" aria-label="등록 이미지 관리">
                <p className="background-file-note">
                  {assets.length}개,{' '}
                  {(assets.reduce((sum, asset) => sum + asset.size, 0) / 1048576).toFixed(1)} /
                  100MiB
                </p>
                {assets.length ? (
                  assets.map((asset) => (
                    <div className="background-file-entry" key={asset.id}>
                      <div>
                        <strong>{asset.name}</strong>
                        <small>
                          {asset.references.length
                            ? `사용 중: ${asset.references.join(', ')}`
                            : '사용하지 않는 이미지'}
                        </small>
                      </div>
                      <MotionButton
                        type="button"
                        disabled={
                          busy ||
                          asset.references.length > 0 ||
                          settings.backgroundAssetId === asset.id
                        }
                        aria-label={`${asset.name} 삭제`}
                        onClick={async () => {
                          setBusy(true);
                          setError('');
                          try {
                            await removeBackgroundAsset(asset.id);
                            await refresh();
                          } catch (cause) {
                            setError(cause instanceof Error ? cause.message : String(cause));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        삭제
                      </MotionButton>
                    </div>
                  ))
                ) : (
                  <p className="background-file-note">등록한 이미지가 없습니다.</p>
                )}
              </div>
            ) : null}
          </>
        )}
        {error ? (
          <p className="message error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Row>
  );
}
