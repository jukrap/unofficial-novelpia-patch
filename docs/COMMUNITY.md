# 이슈·PR 관리

신고·질문·기여 방법은 [기여 안내](../CONTRIBUTING.md)에 있습니다. 이 문서는 접수한 항목의 분류와 관리 기준을 설명합니다.

## 양식

| 양식           | 적는 내용                  | 처음 붙는 라벨                |
| -------------- | -------------------------- | ----------------------------- |
| 문제 신고      | 환경·재현·기대와 실제 동작 | bug, status: triage           |
| 기능·개선 제안 | 불편한 상황·원하는 결과    | enhancement, status: triage   |
| 사용 방법 문의 | 하려는 일·질문·시도한 방법 | question, status: triage      |
| 문서 오류·개선 | 문서 위치·고칠 부분        | documentation, status: triage |

일반 PR에는 변경 이유·내용·실행한 검사를 적습니다. 릴리스 PR에는 버전, 같은 ZIP의 검증 결과와 실제 배포 범위를 추가합니다. PR은 양식만으로 라벨이 붙지 않으므로 관리자가 유형과 영역을 선택합니다. Dependabot PR에는 `dependencies`, `area: tooling`을 지정했습니다.

이슈 양식과 PR 양식은 기본 브랜치 `main`에 반영된 뒤 제공됩니다. 작업 브랜치에서 파일을 준비한 것과 사용자에게 적용된 상태를 구분합니다. 기존 `bug.yml`, `feature.yml` 주소는 유지하고, 기능 제안 화면에서 사용 질문으로 이동할 수 있게 했습니다.

## 라벨을 붙이는 기준

이슈와 PR은 같은 라벨을 사용합니다. **주된 유형 하나 + 관련 영역**이면 충분하며, 필요한 경우에만 처리 상태나 참여 안내를 더합니다. 우선순위나 완료 여부를 모든 항목에 중복 표시하지 않습니다.

| 구분      | 라벨과 용도                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 유형      | `bug` 오류, `enhancement` 기능 개선, `documentation` 문서, `question` 사용 질문, `maintenance` 개발·저장소 관리, `dependencies` 의존성, `release` 릴리스 PR                                             |
| 기능 영역 | `area: reader` 본문·위치, `area: settings` 설정 UI·팝업, `area: presets` 프리셋, `area: fonts` 글꼴, `area: storage` 저장·파일·통계, `area: release` 패키지·스토어, `area: tooling` 테스트·CI·운영 도구 |
| 처리 상태 | `status: triage` 접수 확인 전, `status: needs-info` 추가 정보 대기, `status: blocked` 선행 작업·외부 조건 대기                                                                                          |
| 참여·관점 | `good first issue` 시작점이 정리된 작은 작업, `help wanted` 참여 요청, `accessibility` 접근성                                                                                                           |
| 종결 사유 | `duplicate` 중복, `invalid` 확장 범위 밖·분류 불가, `wontfix` 진행하지 않기로 결정                                                                                                                      |

분류 예: 페이지 복원 오류는 `bug` + `area: reader`, 설명 수정 PR은 `documentation`, 패키지 검사 도구 수정은 `maintenance` + `area: tooling`입니다. 여러 영역에 직접 영향을 주면 영역 라벨을 함께 붙일 수 있습니다.

## 확인부터 종결까지

1. 접수 내용과 중복 여부를 확인하고 유형·영역을 정합니다. 확인을 마치면 `status: triage`를 제거합니다.
2. 정보가 부족하면 필요한 항목을 구체적으로 요청하고 `status: needs-info`로 바꿉니다. 답변이 오면 다시 확인합니다.
3. 진행이 막히면 선행 이슈나 조건을 설명하고 `status: blocked`를 붙입니다. 상태 라벨은 동시에 여러 개 붙이지 않습니다.
4. 처음 기여하기 좋은 작업은 범위·시작 파일·완료 조건을 적은 후 `good first issue`를 붙입니다. 범위가 불명확한 작업에 참여 라벨부터 붙이지 않습니다.
5. 해결되거나 진행하지 않을 때는 결과와 이유를 남기고 닫습니다. 중복은 원래 이슈를 연결합니다. 라벨만 붙이고 이유 없이 종결하지 않습니다.

상태·영역의 갱신과 종결은 관리자가 수행합니다. 오래됐다는 이유만으로 이슈를 닫는 자동화는 두지 않습니다. 담당자 배정이나 라벨은 구현·일정의 확약이 아닙니다.

## 라벨 목록 관리

[라벨 목록](../.github/labels.json)이 이름·색상·한국어 설명의 기준입니다. 기존 기본 라벨 이름은 유지해 링크와 분류를 보존합니다. 저장소 관리 권한과 GitHub CLI 인증이 있는 환경에서 다음 명령으로 확인·적용합니다.

```sh
node scripts/sync-labels.mjs jukrap/unofficial-novelpia-patch
node scripts/sync-labels.mjs jukrap/unofficial-novelpia-patch --apply
```

첫 명령은 조회만 하고 추가·변경 예정 항목을 보여줍니다. `--apply`는 필요한 라벨만 생성하거나 설명·색상을 갱신하고 다시 조회해 확인합니다. 기존 이름·이슈 연결과 목록 밖의 라벨은 보존하며 삭제나 이름 변경을 하지 않습니다. 새 이름을 도입할 때는 양식과 운영 안내도 함께 고칩니다.

참고: [GitHub 이슈 양식](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms), [템플릿 적용 시점](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository), [PR 양식](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository).
