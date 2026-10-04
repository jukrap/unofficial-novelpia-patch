import { AnimatePresence } from 'motion/react';
import { MotionButton } from '@/shared/ui/motion-button';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getUserFonts,
  initializeUserFonts,
  refreshUserFonts,
  subscribeFonts,
  inspectUserFont,
  encodeFontBytes,
  saveUserFonts,
  removeUserFont,
} from '@/shared/platform/user-fonts';
import {
  FONT_FILE_LIMIT,
  FONT_BATCH_LIMIT,
  type UserFontFace,
  type FontInspection,
} from '@/shared/model/user-font';
import { FontLoader } from '@/entities/reader';
import { UserFontPreview } from './user-font-preview';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import { Modal } from '@/shared/ui/modal';
import type { OptionsScreenProps } from '../model/contracts';
import { editFont, appendFontFiles, fontWrites, type FontDraft } from '../model/font-draft';
import styles from './user-font-panel.css?inline';

function sizeLabel(size: number) {
  return `${(size / 1024 / 1024).toFixed(1)}MiB`;
}
function weightLabel(face: UserFontFace) {
  return `${face.variable ? `가변 ${face.minWeight}~${face.maxWeight}` : face.weight}${face.style === 'italic' ? ', 기울임' : ''}`;
}
export default function UserFontPanel({ onNotify }: OptionsScreenProps) {
  const fonts = useSyncExternalStore(subscribeFonts, getUserFonts);
  const input = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<FontDraft[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [loader] = useState(() => new FontLoader());
  useEffect(() => () => loader.dispose(), [loader]);
  useEffect(() => {
    let active = true;
    void initializeUserFonts().then(
      () => {
        if (active) setReady(true);
      },
      (cause: unknown) => {
        if (active) setError(String(cause));
      }
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    const pending = () => {
      if (drafts.length) return '저장하지 않은 글꼴이 있습니다.';
    };
    const guard = (event: BeforeUnloadEvent) => {
      if (pending()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [drafts.length]);
  const chooseFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    setError('');
    setBusy('글꼴 이름과 두께를 읽는 중');
    try {
      const stagedSize = drafts.reduce(
        (sum, draft) => sum + draft.faces.reduce((n, face) => n + (face.data ? face.size : 0), 0),
        0
      );
      if (
        files.length > 24 ||
        files.some((file) => file.size > FONT_FILE_LIMIT) ||
        files.reduce((sum, file) => sum + file.size, stagedSize) > FONT_BATCH_LIMIT
      )
        throw new Error('파일당 20MiB, 한 번에 총 32MiB, 최대 24개까지 선택할 수 있습니다.');
      const inspected: { info: FontInspection; data: string }[] = [];
      for (const file of files) {
        const data = encodeFontBytes(new Uint8Array(await file.arrayBuffer()));
        const info = await inspectUserFont(file.name, data);
        // Browser decoding is verified before a draft can be committed.
        const probe = new FontFace('unp-file-check', await file.arrayBuffer());
        await probe.load().catch(() => {
          throw new Error(`${file.name}: 브라우저에서 사용할 수 없는 글꼴입니다.`);
        });
        inspected.push({ info, data });
      }
      setDrafts((current) => appendFontFiles(current, fonts, inspected));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
      if (input.current) input.current.value = '';
    }
  };
  const save = async () => {
    setError('');
    setBusy('글꼴을 저장하는 중');
    try {
      await saveUserFonts(fontWrites(drafts));
      setDrafts([]);
      onNotify('글꼴을 등록했습니다.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  };
  const discard = () => {
    setConfirming('discard');
  };
  return (
    <section className="user-font-manager" aria-busy={!!busy || (!ready && !error)}>
      <style>{styles}</style>
      <div className="font-library-top">
        <div>
          <h2>글꼴 파일 추가</h2>
          <p>여러 두께의 파일을 함께 선택하세요. 같은 글꼴은 하나로 묶입니다.</p>
          <small>TTF, OTF, WOFF, WOFF2, 파일당 20MiB, 보관함 100MiB</small>
        </div>
        <MotionButton
          type="button"
          className="primary"
          disabled={!!busy || !ready}
          onClick={() => input.current?.click()}
        >
          파일 선택
        </MotionButton>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept=".ttf,.otf,.woff,.woff2"
          aria-label="사용자 글꼴 파일"
          onChange={(event) => void chooseFiles(Array.from(event.target.files ?? []))}
        />
      </div>
      <DelayedLoading
        busy={!!busy || (!ready && !error)}
        label={busy || '글꼴 보관함을 불러오는 중'}
      />
      {error ? (
        <div className="message error" role="alert">
          <p>{error}</p>
          {!ready ? (
            <MotionButton
              type="button"
              onClick={() => {
                setError('');
                setAttempt((n) => n + 1);
              }}
            >
              다시 시도
            </MotionButton>
          ) : null}
        </div>
      ) : null}
      {drafts.length ? (
        <div className="font-library-drafts">
          <h2>등록할 글꼴</h2>
          <p className="hint">
            표시 이름을 정하고 파일별 두께를 확인하세요. 저장 전에는 읽기 설정이 바뀌지 않습니다.
          </p>
          {drafts.map((draft) => (
            <fieldset key={draft.id} disabled={!!busy} className="font-family-editor">
              <legend>{draft.family}</legend>
              <label className="font-name-field">
                표시 이름
                <input
                  value={draft.displayName}
                  maxLength={80}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((item) =>
                        item.id === draft.id ? { ...item, displayName: event.target.value } : item
                      )
                    )
                  }
                />
              </label>
              <ul className="font-face-list">
                {draft.faces.map((face) => (
                  <li key={face.id}>
                    <span className="font-file-name">
                      {face.fileName}
                      <small>{sizeLabel(face.size)}</small>
                    </span>
                    <span className="font-weight-tag">{weightLabel(face)}</span>
                    <MotionButton
                      type="button"
                      aria-label={`${face.fileName} 제외`}
                      onClick={() =>
                        setDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id
                              ? { ...item, faces: item.faces.filter((f) => f.id !== face.id) }
                              : item
                          )
                        )
                      }
                    >
                      제외
                    </MotionButton>
                  </li>
                ))}
              </ul>
              {!draft.faces.length ? (
                <p className="hint">파일을 추가하거나 이 글꼴을 목록에서 제외하세요.</p>
              ) : null}
              <MotionButton
                type="button"
                className="quiet"
                onClick={() =>
                  setDrafts((current) => current.filter((item) => item.id !== draft.id))
                }
              >
                이 글꼴 제외
              </MotionButton>
            </fieldset>
          ))}
          <div className="font-library-actions">
            <MotionButton type="button" disabled={!!busy} onClick={discard}>
              취소
            </MotionButton>
            <MotionButton
              type="button"
              className="primary"
              disabled={
                !!busy || drafts.some((draft) => !draft.displayName.trim() || !draft.faces.length)
              }
              onClick={() => void save()}
            >
              {busy === '글꼴을 저장하는 중' ? '저장 중…' : '글꼴 저장'}
            </MotionButton>
          </div>
        </div>
      ) : null}
      <div className="font-library-heading">
        <h2>
          등록한 글꼴 <small>{fonts.length}</small>
        </h2>
        <MotionButton
          type="button"
          disabled={!!busy}
          onClick={() => void refreshUserFonts().catch((cause: unknown) => setError(String(cause)))}
        >
          목록 새로고침
        </MotionButton>
      </div>
      {!fonts.length && ready ? (
        <p className="hint">
          아직 등록한 글꼴이 없습니다. 파일을 추가하면 글꼴 선택기의 ‘사용자’에 표시됩니다.
        </p>
      ) : null}
      {fonts.map((font) => (
        <article className="registered-font" key={font.id}>
          <div className="registered-font-heading">
            <h3>{font.displayName}</h3>
            <div>
              <MotionButton
                type="button"
                disabled={!!busy || drafts.some((draft) => draft.id === font.id)}
                onClick={() => setDrafts((current) => [...current, editFont(font)])}
              >
                수정
              </MotionButton>
              <MotionButton
                type="button"
                disabled={!!busy || !!drafts.length}
                onClick={() => setConfirming(font.id)}
              >
                삭제
              </MotionButton>
            </div>
          </div>
          <UserFontPreview font={font} loader={loader} />
          <div className="font-library-weights">
            {font.faces.map((face) => (
              <span className="font-weight-tag" key={face.id}>
                {weightLabel(face)}
              </span>
            ))}
            <small>{sizeLabel(font.faces.reduce((sum, face) => sum + face.size, 0))}</small>
          </div>
        </article>
      ))}
      <p className="font-library-note">
        글꼴 파일은 이 브라우저에만 보관하며 설정 파일에 포함되지 않습니다. 다른 브라우저에서는 같은
        글꼴 파일을 다시 등록하세요. 설정 초기화로 삭제되지 않습니다.
      </p>
      <AnimatePresence>
        {confirming ? (
          <Modal
            title={confirming === 'discard' ? '글꼴 변경 취소' : '글꼴 삭제'}
            onClose={() => {
              if (!busy) setConfirming(null);
            }}
          >
            <p>
              {confirming === 'discard'
                ? '저장하지 않은 글꼴 변경을 버릴까요?'
                : `‘${fonts.find((font) => font.id === confirming)?.displayName ?? '선택한 글꼴'}’ 파일을 이 브라우저에서 삭제할까요?`}
            </p>
            <div className="button-row">
              <MotionButton type="button" disabled={!!busy} onClick={() => setConfirming(null)}>
                돌아가기
              </MotionButton>
              <MotionButton
                type="button"
                className="primary"
                disabled={!!busy}
                onClick={() => {
                  if (confirming === 'discard') {
                    setDrafts([]);
                    setError('');
                    setConfirming(null);
                    return;
                  }
                  const font = fonts.find((item) => item.id === confirming);
                  if (!font) return setConfirming(null);
                  setBusy('글꼴을 삭제하는 중');
                  setError('');
                  void removeUserFont(font.id, font.revision)
                    .then(
                      () => {
                        onNotify('글꼴을 삭제했습니다.');
                        setConfirming(null);
                      },
                      (cause: unknown) => {
                        setError(cause instanceof Error ? cause.message : String(cause));
                        setConfirming(null);
                      }
                    )
                    .finally(() => setBusy(''));
                }}
              >
                {confirming === 'discard' ? '변경 버리기' : busy ? '삭제 중…' : '삭제'}
              </MotionButton>
            </div>
          </Modal>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
