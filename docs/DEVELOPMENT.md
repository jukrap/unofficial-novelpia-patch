# 개발 안내

## 환경 구성

Node.js 22.12 이상, npm, Git을 사용합니다. `.nvmrc`는 Node.js 22를 지정하며 의존성은 `package-lock.json`으로 고정합니다.

```sh
npm ci
npx playwright install chromium
npm run dev
```

일반 빌드는 `npm run build`로 만들고 `.output/chrome-mv3`를 Chrome의 압축해제된 확장 로드 기능으로 엽니다. `npm run zip`은 배포용 ZIP을 `.output`에 생성합니다. 테스트용 빌드는 배포하지 않습니다.

## 구조

런타임은 WXT/Vite·React·TypeScript입니다. React는 설정 UI를 맡고 독서 엔진의 본문 배치·위치 계산은 React 렌더링과 분리합니다.

| 영역                 | 역할                                              |
| -------------------- | ------------------------------------------------- |
| `src/entrypoints`    | WXT 콘텐츠 스크립트, 백그라운드, 옵션·팝업 진입점 |
| `src/app`            | 초기화, 수명주기, 서비스 연결과 화면 조립         |
| `src/pages`          | 설정 페이지와 확장 팝업                           |
| `src/widgets`        | 설정창·프리셋 편집기·하단 탐색 등 화면 단위       |
| `src/features`       | 뷰어 전환, 자동 추천 등 사용자 동작               |
| `src/entities`       | 읽기 엔진, 설정·프리셋·파일·통계 모델             |
| `src/shared`         | 공통 타입·설정·UI·브라우저 어댑터                 |
| `modules`, `scripts` | 지연 모듈 빌드와 검증·자원 생성 도구              |
| `tests`              | 합성 본문과 MV3 브라우저 검사                     |

slice 내부는 `ui`, `model`, `api`, `lib`, `config` 등 실제 역할에 맞는 세그먼트로 나눕니다. 비어 있는 세그먼트는 만들지 않습니다. slice 외부에서는 공개 API를 사용하며 계층과 동적 import 경계는 ESLint로 검사합니다. 도메인에 의존하는 컨트롤을 범용 `shared/ui`로 옮기지 않습니다.

실행 영역별 책임과 설정·본문·저장소의 연결은 [구조와 데이터 흐름](ARCHITECTURE.md)에 정리했습니다.

## 빌드와 지연 로딩

작은 초기 스크립트가 저장된 화면 색상을 먼저 적용합니다. 독서 런타임과 설정창·프리셋 편집기·종이 효과는 확장에 포함된 ESM 번들로 나누어 필요한 시점에 불러옵니다. 번들 구성은 `modules/esm-reader.ts`에서 관리합니다. 원격 JavaScript를 실행하지 않습니다.

일반 빌드의 콘텐츠 스크립트는 노벨피아 뷰어 주소에만 적용됩니다. E2E 빌드는 로컬 합성 서버를 사용하므로 적용 주소가 다릅니다. 배포 전 일반 빌드의 manifest와 ZIP을 검사해야 합니다.

## 검증 명령

```sh
npm run type-check
npm run lint
npm run format:check
npm run test:unit
npm run test:release
npm run test:e2e
npm run release:check
npm run build
npm run release:package
```

`test:e2e`는 테스트용 확장을 빌드하고 Playwright의 Chromium에서 MV3 확장을 로드합니다. 페이지 계산·북마크·읽던 위치·설정 UI·등록 파일·전환·초기 로딩 등을 합성 본문으로 검사합니다. 각 검사는 임시 브라우저 프로필을 사용합니다.

CI는 Linux에서 정적 검사·단위 검사·일반 빌드를, Windows에서 MV3 회귀 검사를 실행합니다. 브라우저 검사에 필요한 외부 글꼴은 통제된 fixture를 사용합니다. 공개 CI에는 실제 작품 원문, 로그인 정보나 개인 브라우저 프로필을 넣지 않습니다.

실제 노벨피아 화면과 웹글꼴 CDN 검사는 일반 CI와 분리한 수동 검증입니다. 단위 검사나 빌드 통과만으로 실제 사이트 동작까지 확인했다고 보고하지 마세요. 노벨피아 서비스 요청·추천·광고·결제·접근 권한에 영향을 줄 수 있는 작업은 합성 사례에서 먼저 확인합니다.

### 검사 선택과 산출물

| 변경 범위                    | 관련 검사                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------- |
| 페이지·높이·읽던 위치        | `reader`, `reader-height`, `page-effects`, `paragraph-spacing`, `session-restore` |
| 설정창·프리셋·파일·글꼴      | `ui-finishing`, `preset-loading`, `management`, `user-fonts`, `navigation-fonts`  |
| 초기 표시·이미지·보조 영역   | `initial-display`, `background-images`, `reading-polish`, `finishing`             |
| 릴리스·버전·스토어 제출 분기 | `npm run test:release`, `npm run release:check`                                   |

표의 브라우저 검사 이름은 `tests/e2e`의 `.spec.ts` 파일명입니다. 특정 파일만 실행할 때도 먼저 `npm run build:e2e`로 현재 소스를 반영합니다. `--list`는 등록 확인이며 실제 실행이 아닙니다. 부분 검사와 전체 검사를 구분해 기록하세요.

일반 회귀 결과는 `test-results/`에, 실제 사이트 검사 결과는 `_reference/live/`에 남습니다. 실제 사이트 결과에는 작품 내용이나 네트워크 헤더가 포함될 수 있으므로 공개 CI 산출물로 올리지 않습니다.

문서만 바꾸면 링크·명령·포맷·기재한 계약을 검증합니다. 같은 소스의 런타임 검사 결과를 재사용할 때는 그 기준과 미검증 범위를 적습니다. 변경한 코드가 있는데 이전 빌드로 검사한 결과를 새 코드의 성공으로 취급하지 않습니다.

## 저장과 호환성

읽기 설정·프리셋은 Chrome 동기화 저장소, 위치·북마크·통계는 로컬 저장소를 사용합니다. 등록 이미지·글꼴 파일은 확장 영역의 IndexedDB에 저장합니다. 자세한 범위는 [개인정보 안내](PRIVACY.md)를 기준으로 합니다.

설정 스키마를 바꿀 때는 기존 값의 해석, 기본값, 프리셋 적용 범위, 설정 파일 가져오기와 초기 화면 캐시를 함께 확인하세요. 프리셋 적용은 사용자 동의나 전역 모션 선호를 암묵적으로 바꾸지 않아야 합니다. 파일 참조를 저장할 때 실제 파일이 없는 환경의 대체 표시도 검사합니다.

읽기 위치는 문단·글자 앵커로 유지합니다. 본문 레이아웃을 바꿀 때는 스크롤·한 쪽·두 쪽, 첫 쪽·마지막 쪽, 설정 변경과 뒤로 가기에서 위치가 유지되는지 확인하세요.

## 배포

작업 PR은 `develop`으로, 릴리스 PR은 같은 저장소의 `develop`에서 `main`으로 보냅니다. 릴리스 PR에서 `package.json`·lockfile의 버전과 [변경 이력](../CHANGELOG.md)을 함께 갱신합니다. 자세한 협업 규칙은 [기여 안내](../CONTRIBUTING.md)에 있습니다.

배포 파이프라인은 검증한 동일 ZIP을 GitHub Release와 스토어 제출에 사용합니다. Chrome 웹 스토어 자동 제출은 최초 등록 준비가 끝날 때까지 비활성 상태로 둡니다. 활성화 이후에도 Google 심사 승인과 사용자 브라우저 업데이트 시점은 별개입니다. 배포 인증 값은 저장소에 커밋하지 않습니다.

`release:package`가 만드는 `.output/release/`의 ZIP·SHA256SUMS·메타데이터를 제출 기준으로 사용합니다. 일반 `npm run zip` 결과와 혼동하지 마세요. 활성화 조건, 필요한 변수와 실패 후 재실행은 [배포 운영](RELEASE.md)을 따릅니다.

## 아이콘과 라이선스

아이콘을 바꾸면 원본과 생성 스크립트를 함께 유지하고 `npm run icons:generate`로 필요한 크기를 생성합니다. 원본 작업 파일은 확장 ZIP에 넣지 않습니다.

새 라이브러리나 글꼴을 추가할 때 출처·버전·사용 조건을 확인하고 배포 고지에 반영합니다. UI 동봉 글꼴과 원격 독서용 글꼴, 사용자가 등록한 파일은 배포 범위가 다릅니다. 사용자 등록 파일이나 권한 없는 작품 원문을 테스트 fixture로 커밋하지 않습니다.
