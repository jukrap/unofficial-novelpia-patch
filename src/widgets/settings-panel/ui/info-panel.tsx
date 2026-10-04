import type { Settings } from '@/entities/settings';
import { SettingGroup } from './fields/controls';
import { ViewerModeSwitch } from '@/features/viewer-mode';
import { EXTENSION_VERSION, PROJECT_URL, ISSUES_URL } from '@/shared/config/extension';

export function InfoPanel({
  settings,
  onEnabledChange,
  viewer = false,
}: {
  settings: Settings;
  onEnabledChange: (enabled: boolean) => Promise<void>;
  viewer?: boolean;
}) {
  return (
    <div className="info-panel">
      <ViewerModeSwitch
        enabled={settings.enabled}
        onChangeAsync={onEnabledChange}
        context={viewer ? 'viewer' : 'options'}
      />
      <SettingGroup title="Unofficial Novelpia Patch">
        <div className="info-grid">
          <div className="info-description">
            <p>
              노벨피아 뷰어의 글꼴과 화면 구성을 조절하는 비공식 확장프로그램입니다. 노벨피아와
              공식적인 관계가 없습니다.
            </p>
            <p>
              노벨피아 측의 요청이나 문제가 확인되면 관련 기능을 수정하거나 개발·배포를 중단하고
              공개 자료를 삭제할 수 있습니다.
            </p>
          </div>
          <dl className="info-details">
            <div>
              <dt>버전</dt>
              <dd>{EXTENSION_VERSION}</dd>
            </div>
            <div>
              <dt>프로젝트</dt>
              <dd>
                <a href={PROJECT_URL} target="_blank" rel="noreferrer">
                  GitHub 저장소
                </a>
              </dd>
            </div>
            <div>
              <dt>문의 및 제안</dt>
              <dd>
                <a href={ISSUES_URL} target="_blank" rel="noreferrer">
                  문제 신고, 기능 제안
                </a>
              </dd>
            </div>
          </dl>
        </div>
      </SettingGroup>
    </div>
  );
}
