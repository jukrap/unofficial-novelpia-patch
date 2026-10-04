import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getFontCatalog, subscribeFonts, initializeUserFonts } from '@/shared/platform/user-fonts';
import { fontWeightLabel } from '@/shared/config/font-weight-labels';
import type { Settings } from '@/shared/model/preferences';
import {
  FontLoader,
  fontFamily,
  supportedWeights,
  supportsBold,
  effectiveWeight,
} from '@/entities/reader';
import { Dropdown } from '@/shared/ui/dropdown';
import { SelectControl } from '@/shared/ui/select-control';
import { DelayedLoading } from '@/shared/ui/loading-indicator';
import { useFontRetry } from '../../model/font-retry';
import { Row } from './structure';
export function FontControl({
  settings,
  onChange,
  onPreview,
  error,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onPreview?: (font: string) => void;
  error?: string;
}) {
  const fonts = useSyncExternalStore(subscribeFonts, getFontCatalog);
  useEffect(() => {
    void initializeUserFonts().catch(() => {});
  }, []);
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const [loader, setLoader] = useState(() => new FontLoader());
  const retry = useFontRetry();
  const retryRevision = retry?.revision ?? 0;
  const [fontError, setFontError] = useState('');
  const [fontLoading, setFontLoading] = useState(false);
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [category, query]);
  useEffect(() => () => loader.dispose(), [loader]);
  useEffect(() => {
    let active = true;
    setFontError('');
    setFontLoading(true);
    void loader
      .load(settings.fontFamily, effectiveWeight(settings), settings.fontSize)
      .catch((cause: unknown) => {
        if (active)
          setFontError(
            cause instanceof Error ? cause.message : '글꼴을 불러오지 못해 대체 글꼴로 표시합니다.'
          );
      })
      .finally(() => {
        if (active) setFontLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    loader,
    settings.fontFamily,
    settings.fontWeight,
    settings.forceBold,
    settings.fontSize,
    retryRevision,
    fonts,
  ]);
  const preview = (id: string) => {
    onPreview?.(id);
    void loader.load(id, 400, 16).catch(() => {});
  };
  const font = fonts.find((f) => f.name === settings.fontFamily);
  const names: Record<string, string> = {
    All: '전체',
    System: '사용자',
    Sans: '돋움체',
    Serif: '바탕체',
    Calligraphy: '손글씨',
    Display: '장식체',
  };
  const search = query.trim().toLocaleLowerCase().replace(/\s+/g, '');
  const filtered = fonts.filter(
    (item) =>
      (category === 'All' || item.category === category) &&
      `${item.displayName}${item.name}`.toLocaleLowerCase().replace(/\s+/g, '').includes(search)
  );
  return (
    <>
      <Row label="글꼴">
        <Dropdown
          className="font-dropdown"
          overlay
          label="글꼴 선택"
          trigger={
            <>
              <span className="font-sample" style={{ fontFamily: fontFamily(settings.fontFamily) }}>
                가
              </span>
              <span>
                <strong aria-busy={fontLoading}>
                  {font?.displayName ??
                    (settings.fontFamily.startsWith('unp-local-')
                      ? '등록 파일 없음'
                      : settings.fontFamily)}
                </strong>
                <DelayedLoading busy={fontLoading} label="글꼴을 불러오는 중" variant="spinner" />
                <small>{font ? names[font.category] : '사용자 글꼴'}</small>
              </span>
            </>
          }
        >
          {(close) => (
            <>
              <div className="font-search">
                <input
                  type="search"
                  aria-label="글꼴 이름 검색"
                  placeholder="글꼴 이름 검색"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="tabs" role="group" aria-label="글꼴 분류">
                {Object.entries(names).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    className={category === key ? 'active' : ''}
                    aria-pressed={category === key}
                    onClick={() => setCategory(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="font-list" ref={list}>
                {category === 'System' ? (
                  <p className="font-empty">
                    설정 페이지의 ‘사용자 글꼴’에서 글꼴 파일을 추가할 수 있습니다.
                  </p>
                ) : null}
                {!filtered.length ? (
                  <p className="font-empty" role="status">
                    일치하는 글꼴이 없습니다. 이름이나 분류를 바꿔 보세요.
                  </p>
                ) : null}
                {filtered.map((f) => (
                  <button
                    type="button"
                    className={`font-option ${settings.fontFamily === f.name ? 'selected' : ''}`}
                    aria-pressed={settings.fontFamily === f.name}
                    key={f.name}
                    onPointerEnter={() => preview(f.name)}
                    onFocus={() => preview(f.name)}
                    onClick={() => {
                      onChange({ fontFamily: f.name });
                      close();
                    }}
                  >
                    <span className="font-option-heading">
                      <strong>{f.displayName}</strong>
                      {settings.fontFamily === f.name ? (
                        <span className="selected-label">✓ 선택됨</span>
                      ) : null}
                    </span>
                    <span className="font-preview" style={{ fontFamily: fontFamily(f.name) }}>
                      가나다라마바사 아자차카타파하
                      <span className="font-preview-sub">Abc 0123, 漢字</span>
                    </span>
                    <small>{f.description}</small>
                    <span className="font-meta">
                      <span className="font-meta-description">
                        {f.metadata.variableFont
                          ? `가변 글꼴, ${f.metadata.weights[0]}부터 ${f.metadata.weights.at(-1)}까지 두께를 지원합니다.`
                          : `지원 두께는 ${f.metadata.weights.join(', ')}입니다.`}
                      </span>
                      {f.metadata.variableFont ? (
                        <span className="font-meta-items" aria-hidden="true">
                          <span className="font-variable-badge">가변</span>
                          <span className="font-weight-range">
                            {f.metadata.weights[0]}~{f.metadata.weights.at(-1)}
                          </span>
                        </span>
                      ) : (
                        <span className="font-meta-items" aria-hidden="true">
                          <span>지원 두께</span>
                          {f.metadata.weights.map((weight) => (
                            <span className="font-weight-tag" key={weight}>
                              {weight}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Dropdown>
        {error || fontError ? (
          <div className="field-error font-error" role="alert">
            <p>{error || fontError}</p>
            <button
              type="button"
              disabled={fontLoading}
              onClick={() => (retry ? retry.retry() : setLoader(new FontLoader()))}
            >
              글꼴 다시 시도
            </button>
          </div>
        ) : null}
      </Row>
    </>
  );
}
export function FontWeightControl({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  useSyncExternalStore(subscribeFonts, getFontCatalog);
  const canSynthesize = !supportsBold(settings.fontFamily);
  const selected = settings.forceBold && canSynthesize ? 'bold' : String(effectiveWeight(settings));
  return (
    <>
      <Row label="글자 두께">
        <SelectControl
          label="글자 두께"
          value={selected}
          onChange={(value) =>
            onChange({
              forceBold: value === 'bold',
              fontWeight: value === 'bold' ? 400 : Number(value),
            })
          }
          options={[
            ...supportedWeights(settings.fontFamily).map((n) => ({
              value: String(n),
              label: fontWeightLabel(n),
              textStyle: { fontFamily: fontFamily(settings.fontFamily), fontWeight: n },
            })),
            ...(canSynthesize
              ? [
                  {
                    value: 'bold',
                    label: '강제로 굵게',
                    textStyle: { fontFamily: fontFamily(settings.fontFamily), fontWeight: 700 },
                  },
                ]
              : []),
          ]}
        />
        {effectiveWeight(settings) >= 700 ? (
          <p className="hint weight-advice">
            본문이 굵어 작가의 강조가 덜 구별될 수 있습니다. 아래에서 그림자, 배경 또는 테두리를
            함께 사용해 보세요.
          </p>
        ) : null}
      </Row>
    </>
  );
}
