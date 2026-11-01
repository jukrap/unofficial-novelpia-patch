import type { Settings } from '@/shared/model/preferences';
import { MotionButton } from '@/shared/ui/motion-button';
import { SelectControl } from '@/shared/ui/select-control';
import { NumberControl, Row, SettingGroup } from './controls';

export function ReadingModeFields({
  settings,
  onChange,
  context,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  context: 'viewer' | 'settings' | 'preset';
}) {
  return (
    <SettingGroup title="읽기 방식">
      <Row label="읽기 방식">
        <div className="segments">
          {(
            [
              ['scroll', '스크롤 방식'],
              ['page', '페이지 방식'],
            ] as const
          ).map(([mode, label]) => (
            <MotionButton
              type="button"
              key={mode}
              className={settings.readingMode === mode ? 'active' : ''}
              aria-pressed={settings.readingMode === mode}
              onClick={() => onChange({ readingMode: mode })}
            >
              {label}
            </MotionButton>
          ))}
        </div>
      </Row>
      <p className="section-description">
        {context === 'preset'
          ? '저장한 읽기 방식과 페이지 옵션은 프리셋을 적용할 때 함께 바뀝니다.'
          : settings.readingMode === null
            ? '아직 선택하지 않았다면 처음 연 회차의 기존 읽기 방식을 가져옵니다.'
            : context === 'viewer'
              ? '읽기 방식을 바꾸면 위치를 저장한 뒤 현재 회차를 새로고침합니다.'
              : '읽기 방식 변경은 열린 확장 뷰어에도 적용되며, 해당 회차가 새로고침됩니다.'}
      </p>
      {settings.readingMode !== 'scroll' ? (
        <>
          <Row label="페이지 구성">
            <div className="segments">
              {(
                [
                  ['auto', '자동 한 쪽, 두 쪽'],
                  ['single', '항상 한 쪽'],
                ] as const
              ).map(([mode, label]) => (
                <MotionButton
                  type="button"
                  key={mode}
                  className={settings.spreadMode === mode ? 'active' : ''}
                  aria-pressed={settings.spreadMode === mode}
                  onClick={() => onChange({ spreadMode: mode })}
                >
                  {label}
                </MotionButton>
              ))}
            </div>
          </Row>
          {settings.spreadMode === 'auto' ? (
            <NumberControl name="pageGap" settings={settings} onChange={onChange} />
          ) : null}
          <Row label="페이지 효과">
            <SelectControl
              label="페이지 효과"
              value={settings.pageEffect}
              onChange={(value) => onChange({ pageEffect: value as Settings['pageEffect'] })}
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
          {(
            [
              ['fixed', '하단 고정'],
              ['reserved', '본문 아래'],
              ['overlay', '본문 위'],
            ] as const
          ).map(([placement, label]) => (
            <MotionButton
              type="button"
              key={placement}
              className={settings.pageNavigationPlacement === placement ? 'active' : ''}
              aria-pressed={settings.pageNavigationPlacement === placement}
              onClick={() => onChange({ pageNavigationPlacement: placement })}
            >
              {label}
            </MotionButton>
          ))}
        </div>
      </Row>
    </SettingGroup>
  );
}
