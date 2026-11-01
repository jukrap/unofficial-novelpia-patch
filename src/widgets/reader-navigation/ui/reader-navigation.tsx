import { MotionButton } from '@/shared/ui/motion-button';
import { useSyncExternalStore, type CSSProperties } from 'react';
import type { ReaderEngine, BookmarkStore } from '@/entities/reader';
const paths = {
  previous: 'm14 5-7 7 7 7',
  next: 'm10 5 7 7-7 7',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  restore: 'M9 5 4 10l5 5M4 10h10a5 5 0 0 1 0 10',
  clear: 'm6 6 12 12M6 18 18 6',
};
function Symbol({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function ReaderNavigation({
  engine,
  bookmarks,
  expanded,
  dark,
  onSave,
  onRestore,
}: {
  engine: ReaderEngine;
  bookmarks: BookmarkStore;
  expanded: boolean;
  dark: boolean;
  onSave: () => void;
  onRestore: () => void;
}) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const bookmark = useSyncExternalStore(bookmarks.subscribe, bookmarks.getSnapshot);
  const end = Math.min(state.page + state.columns - 1, state.pages);
  const pageMode = state.mode === 'page';
  const label = pageMode
    ? `${state.page === end ? state.page : `${state.page}~${end}`} / ${state.pages}`
    : `${Math.round(state.progress * 100)}%`;
  const max = pageMode
    ? Math.max(0, Math.ceil(state.pages / state.columns) - 1)
    : state.scrollRange > 0
      ? 1000
      : 0;
  const value = pageMode
    ? Math.floor((state.page - 1) / state.columns)
    : Math.round(state.progress * max);
  if (!expanded)
    return (
      <output className={`counter ${dark ? 'dark' : ''}`} data-testid="reader-page">
        {label}
      </output>
    );
  const hasBookmark = !!(bookmark.anchor || bookmark.legacy);
  return (
    <nav aria-label="본문 탐색과 북마크" className={dark ? 'dark' : ''}>
      <div className="bookmarks">
        <MotionButton
          aria-label="현재 위치 북마크 저장"
          title="현재 본문 위치에 북마크 저장"
          aria-pressed={!!bookmark.anchor}
          disabled={!bookmark.ready}
          onClick={onSave}
        >
          <Symbol name="bookmark" />
        </MotionButton>
        <MotionButton
          aria-label="북마크로 이동"
          title={
            bookmark.anchor
              ? '저장한 본문 위치로 이동'
              : '이전 북마크로 이동, 이전 페이지 번호 기준'
          }
          disabled={!hasBookmark}
          onClick={onRestore}
        >
          <Symbol name="restore" />
        </MotionButton>
        {hasBookmark ? (
          <MotionButton
            aria-label="북마크 해제"
            title="북마크 해제"
            onClick={() => void bookmarks.clear()}
          >
            <Symbol name="clear" />
          </MotionButton>
        ) : null}
      </div>
      <MotionButton
        className="previous"
        aria-label={pageMode ? '이전 쪽' : '이전 위치'}
        disabled={max === 0 || value <= 0}
        onClick={() => engine.move(-1)}
      >
        <Symbol name="previous" />
      </MotionButton>
      <input
        className="progress"
        aria-label={pageMode ? '본문 페이지' : '본문 읽기 진행률'}
        aria-valuetext={pageMode ? `${label}쪽` : label}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={max === 0}
        style={{ '--progress': `${state.progress * 100}%` } as CSSProperties}
        onChange={(e) => {
          const range = e.currentTarget;
          engine.seek(Number(range.value) / Math.max(1, Number(range.max)), pageMode);
        }}
      />
      <output className="position" data-testid="reader-page" aria-live="off">
        {label}
      </output>
      <MotionButton
        className="next"
        aria-label={pageMode ? '다음 쪽' : '다음 위치'}
        disabled={max === 0 || value >= max}
        onClick={() => engine.move(1)}
      >
        <Symbol name="next" />
      </MotionButton>
      {bookmark.error ? <p role="alert">{bookmark.error}</p> : null}
    </nav>
  );
}
export const navigationStyles = `
:host{display:block;width:100%;max-width:920px;margin:auto;font:14px/1.4 var(--unp-ui-font, "UNP UI Freesentation", system-ui),sans-serif;color:#292630}
*{box-sizing:border-box}.counter{display:inline-block;padding:4px 12px;background:#ffffffdf;border-radius:4px;font-variant-numeric:tabular-nums;pointer-events:none}
nav{--paper:#ffffff;--ink:#292630;--accent:#7632ff;--track:#dcd7e5;display:grid;grid-template-columns:auto 32px minmax(100px,1fr) auto 32px;align-items:center;gap:10px;padding:6px 10px;background:var(--paper);color:var(--ink);border:1px solid #bcb8c4;border-radius:6px;box-shadow:0 2px 8px #0001}
.dark{--paper:#24212b;--ink:#efedf3;--accent:#b79aff;--track:#554d63;background:#24212b;color:#efedf3;border-color:#69616f}
.bookmarks{display:flex;gap:2px;padding-right:8px;border-right:1px solid var(--track)}
button{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;padding:4px}
button[data-motion-hover]{background:#7632ff14}button[aria-pressed=true]{color:var(--accent)}button[aria-pressed=true] svg{fill:#7632ff20}button:disabled{opacity:.35;cursor:default}
.position{min-width:72px;text-align:center;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
input{appearance:none;width:100%;min-width:0;height:32px;margin:0;background:transparent;cursor:pointer;touch-action:none}
input::-webkit-slider-runnable-track{height:5px;border-radius:3px;background:linear-gradient(to right,var(--accent) var(--progress),var(--track) var(--progress))}
input::-webkit-slider-thumb{appearance:none;width:18px;height:18px;border-radius:50%;margin-top:-6.5px;background:var(--paper);border:2px solid var(--accent)}
input::-moz-range-track{height:5px;border-radius:3px;background:var(--track)}input::-moz-range-progress{height:5px;background:var(--accent)}input::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--paper);border:2px solid var(--accent)}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}p{grid-column:1/-1;margin:0;padding:4px;color:var(--ink);font-size:12px}
@media(max-width:600px){nav{grid-template-columns:32px minmax(0,1fr) 32px;gap:4px 8px}.bookmarks{grid-column:1/3;grid-row:1;border:0}.position{grid-column:3;grid-row:1;justify-self:end}.previous{grid-column:1;grid-row:2}.progress{grid-column:2;grid-row:2}.next{grid-column:3;grid-row:2}}
`;
