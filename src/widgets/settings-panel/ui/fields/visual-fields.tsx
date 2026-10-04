import { useSyncExternalStore, type ReactNode } from 'react';
import { subscribeFonts, getFontCatalog } from '@/shared/platform/user-fonts';
import type { Settings } from '@/shared/model/preferences';
import { emphasisHighlight, emphasisShadow } from '@/shared/config/emphasis';
import { authorWeight, fontFamily } from '@/entities/reader';
import {
  ColorControl,
  FontControl,
  FontWeightControl,
  NumberControl,
  Row,
  SettingGroup,
  Toggle,
} from './controls';
import { ReadingPreview } from '../reading-preview';
import { SelectControl } from '@/shared/ui/select-control';
import { BackgroundImageField } from './background-image-field';
import { FontRetryScope } from '../../model/font-retry';

export type VisualSection = 'text' | 'layout' | 'appearance';
export function VisualSettingsFields({
  section,
  settings,
  onChange,
  onPreview,
  onRetryFont,
  fontError,
  before,
  after,
  preview = true,
  rememberColors = true,
  showPageGap = true,
  onBackgroundBusyChange,
}: {
  section: VisualSection;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onPreview?: (font: string) => void;
  onRetryFont?: () => void;
  fontError?: string;
  before?: ReactNode;
  after?: ReactNode;
  preview?: boolean;
  rememberColors?: boolean;
  showPageGap?: boolean;
  onBackgroundBusyChange?: (busy: boolean) => void;
}) {
  useSyncExternalStore(subscribeFonts, getFontCatalog);
  const boldPreview = {
    fontWeight: authorWeight(settings),
    fontFamily: fontFamily(settings.fontFamily),
  };
  if (section === 'text') {
    const fields = (
      <>
        {before}
        {preview ? <ReadingPreview settings={settings} loadFont /> : null}
        <SettingGroup title="글꼴">
          <FontControl
            settings={settings}
            onChange={onChange}
            onPreview={onPreview}
            error={fontError}
          />
          <NumberControl name="fontSize" settings={settings} onChange={onChange} />
          <FontWeightControl settings={settings} onChange={onChange} />
          <Row label="굵은 텍스트 강조">
            <SelectControl
              label="굵은 텍스트 강조"
              value={settings.enhanceBoldTextStyle}
              onChange={(value) =>
                onChange({ enhanceBoldTextStyle: value as Settings['enhanceBoldTextStyle'] })
              }
              options={[
                { value: 'none', label: '단순히 굵게', textStyle: boldPreview },
                {
                  value: 'shadow',
                  label: '그림자 효과',
                  textStyle: { ...boldPreview, textShadow: emphasisShadow(settings.darkMode) },
                },
                {
                  value: 'highlight',
                  label: '배경 강조',
                  textStyle: {
                    ...boldPreview,
                    color: settings.textColor,
                    background: emphasisHighlight(settings.textColor),
                    borderRadius: 3,
                  },
                },
                {
                  value: 'border',
                  label: '위아래 테두리',
                  textStyle: { ...boldPreview, borderBlock: '2px solid currentColor' },
                },
              ]}
            />
          </Row>
        </SettingGroup>
        <SettingGroup title="문장과 문단">
          {(['lineHeight', 'paragraphGap', 'paragraphSpacing', 'letterSpacing'] as const).map(
            (name) => (
              <NumberControl key={name} name={name} settings={settings} onChange={onChange} />
            )
          )}
          <Row label="줄바꿈 방식">
            <div className="segments">
              <button
                type="button"
                className={settings.wordBreakMode === 'normal' ? 'active' : ''}
                aria-pressed={settings.wordBreakMode === 'normal'}
                onClick={() => onChange({ wordBreakMode: 'normal' })}
              >
                언어별
              </button>
              <button
                type="button"
                className={settings.wordBreakMode === 'keep-all' ? 'active' : ''}
                aria-pressed={settings.wordBreakMode === 'keep-all'}
                onClick={() => onChange({ wordBreakMode: 'keep-all' })}
              >
                단어 단위
              </button>
              <button
                type="button"
                className={settings.wordBreakMode === 'break-all' ? 'active' : ''}
                aria-pressed={settings.wordBreakMode === 'break-all'}
                onClick={() => onChange({ wordBreakMode: 'break-all' })}
              >
                글자 단위
              </button>
            </div>
          </Row>
        </SettingGroup>
        {after}
      </>
    );
    return preview ? <FontRetryScope onRetry={onRetryFont}>{fields}</FontRetryScope> : fields;
  }
  if (section === 'layout')
    return (
      <>
        {before}
        {showPageGap ? (
          <SettingGroup title="페이지 간격">
            <NumberControl name="pageGap" settings={settings} onChange={onChange} />
          </SettingGroup>
        ) : null}
        <SettingGroup title="본문 영역">
          {(
            ['maxWidth', 'readerHeightPercent', 'horizontalPadding', 'verticalPadding'] as const
          ).map((name) => (
            <NumberControl key={name} name={name} settings={settings} onChange={onChange} />
          ))}
        </SettingGroup>
        {after}
      </>
    );
  return (
    <>
      {before}
      <SettingGroup title="화면 테마">
        <Row label="다크 모드">
          <Toggle
            label="다크 모드"
            value={settings.darkMode}
            onChange={(value) => onChange({ darkMode: value })}
          />
        </Row>
      </SettingGroup>
      <SettingGroup title="바깥 배경">
        <Row label="배경 타입">
          <div className="segments">
            <button
              type="button"
              className={settings.backgroundType === 'color' ? 'active' : ''}
              aria-pressed={settings.backgroundType === 'color'}
              onClick={() => onChange({ backgroundType: 'color' })}
            >
              단색
            </button>
            <button
              type="button"
              className={settings.backgroundType === 'image' ? 'active' : ''}
              aria-pressed={settings.backgroundType === 'image'}
              onClick={() => onChange({ backgroundType: 'image' })}
            >
              이미지
            </button>
          </div>
        </Row>
        <ColorControl
          remember={rememberColors}
          label="배경 색상"
          value={settings.backgroundColor}
          onChange={(value) => onChange({ backgroundColor: value })}
        />
        {settings.backgroundType === 'image' ? (
          <>
            <BackgroundImageField
              settings={settings}
              onChange={onChange}
              draft={!rememberColors}
              onBusyChange={onBackgroundBusyChange}
            />
            {rememberColors ? (
              <Row label="배경 이미지 부드럽게 표시">
                <Toggle
                  label="배경 이미지 부드럽게 표시"
                  value={settings.backgroundImageFade}
                  onChange={(backgroundImageFade) => onChange({ backgroundImageFade })}
                />
              </Row>
            ) : null}
            <ColorControl
              remember={rememberColors}
              label="오버레이 색상"
              value={settings.overlayColor}
              onChange={(value) => onChange({ overlayColor: value })}
            />
            <NumberControl name="overlayOpacity" settings={settings} onChange={onChange} />
          </>
        ) : null}
      </SettingGroup>
      <SettingGroup title="본문">
        <ColorControl
          remember={rememberColors}
          label="글자 색상"
          value={settings.textColor}
          onChange={(value) => onChange({ textColor: value })}
        />
        <ColorControl
          remember={rememberColors}
          label="본문 배경 색상"
          value={settings.textAreaBackgroundColor}
          onChange={(value) => onChange({ textAreaBackgroundColor: value })}
        />
        <NumberControl name="textAreaOpacity" settings={settings} onChange={onChange} />
        {after}
      </SettingGroup>
      <SettingGroup title="후기와 회차 이동">
        <Row label="뷰어 보조 영역 색상">
          <SelectControl
            label="뷰어 보조 영역 색상"
            value={settings.readingSurfaces}
            onChange={(readingSurfaces) =>
              onChange({ readingSurfaces: readingSurfaces as Settings['readingSurfaces'] })
            }
            options={[
              { value: 'default', label: '기존대로' },
              { value: 'translucent', label: '반투명' },
              { value: 'opaque', label: '불투명' },
              { value: 'theme', label: '테마에 맞춤' },
            ]}
          />
        </Row>
      </SettingGroup>
    </>
  );
}
