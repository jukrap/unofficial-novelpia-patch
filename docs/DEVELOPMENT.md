# 개발 안내

## 환경 구성

Node.js 26.10 이상, pnpm 12.9.1, Git을 사용합니다. `.nvmrc`는 검증한 Node.js 26.10.0을 지정하며 CI도 이 파일을 사용합니다. 의존성은 `pnpm-lock.yaml`으로 고정합니다. Node 버전을 바꾼 뒤에는 `pnpm install --frozen-lockfile`로 다시 설치하세요.

`pnpm-workspace.yaml`은 의존성 경로 길이 기준도 Windows와 Linux에서 같게 고정합니다. 번들의 소스 구역 주석에 설치 경로가 반영되므로, 이 설정은 운영체제에 따른 청크 해시 차이를 줄이는 데 필요합니다.

`@types/node`는 개발·검증에 사용하는 Node의 주요 버전과 맞춥니다. 주요 버전을 올릴 때는 `.nvmrc`·`engines`·문서를 함께 갱신하고 설치·타입·테스트·빌드 및 MV3 실행을 확인합니다. 개발용 Node 버전 변경이 확장 사용자에게 Node 설치를 요구하는 것은 아닙니다.

Linux에서 공식 Node 바이너리를 쓰려면 `libatomic` 런타임이 필요합니다. Ubuntu·Debian의 패키지 이름은 `libatomic1`이며, `libatomic.so.1` 로딩 오류가 나면 이 시스템 의존성을 확인하세요. [Node의 실행 환경 요구사항](https://github.com/nodejs/node/blob/v26.10.0/BUILDING.md#official-binary-platforms-and-toolchains)을 따릅니다.

```sh
npm install --global pnpm@12.9.1
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run dev
```

일반 빌드는 `pnpm run build`로 만들고 `.output/chrome-mv3`를 Chrome의 압축해제된 확장 로드 기능으로 엽니다. `pnpm run zip`은 배포용 ZIP을 `.output`에 생성합니다. 테스트용 빌드는 배포하지 않습니다.

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

ESLint 본체와 `@eslint/js`는 같은 주요 버전을 사용하고, TypeScript 파서·플러그인은 함께 갱신합니다. Dependabot에서도 이 도구들을 묶어 제안합니다. 새 규칙이 추가되면 경고를 일괄 끄기보다 실제 코드와 의도를 확인합니다.

TypeScript는 현재 ESLint 파서가 지원하는 6.0 계열을 사용합니다. 7.0은 기존 JavaScript 컴파일러 API를 제공하지 않으므로 단순 버전 교체로 올리지 않습니다. 주요 버전 변경은 파서의 peer 의존성과 WXT의 타입 생성·검사까지 확인한 뒤 진행합니다. [TypeScript 7의 도구 호환 안내](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0)를 참고하세요.

실행 영역별 책임과 설정·본문·저장소의 연결은 [구조와 데이터 흐름](ARCHITECTURE.md)에 정리했습니다.

## 빌드와 지연 로딩

작은 초기 스크립트가 저장된 화면 색상을 먼저 적용합니다. 독서 런타임과 설정창·프리셋 편집기·종이 효과는 확장에 포함된 ESM 번들로 나누어 필요한 시점에 불러옵니다. 번들 구성은 `modules/esm-reader.ts`에서 관리합니다. 원격 JavaScript를 실행하지 않습니다.

일반 빌드의 콘텐츠 스크립트는 노벨피아 뷰어 주소에만 적용됩니다. E2E 빌드는 로컬 합성 서버를 사용하므로 적용 주소가 다릅니다. 배포 전 일반 빌드의 manifest와 ZIP을 검사해야 합니다.

## 검증 명령

```sh
pnpm run type-check
pnpm run lint
pnpm run format:check
pnpm run test:unit
pnpm run test:release
pnpm run test:ci
pnpm run test:e2e
pnpm run release:check
pnpm run build
pnpm run release:package
```

`test:e2e`는 테스트용 확장을 빌드하고 Playwright의 Chromium에서 MV3 확장을 로드합니다. 페이지 계산·북마크·읽던 위치·설정 UI·등록 파일·전환·초기 로딩 등을 합성 본문으로 검사합니다. 각 검사는 임시 브라우저 프로필을 사용합니다.

CI는 Linux에서 정적 검사·단위 검사·일반 빌드를, Windows에서 필요한 MV3 회귀 검사를 실행합니다. `develop` push에서는 PR 검사를 반복하지 않습니다. 문서·검사 파일·런타임 변경의 실행 범위와 성공 결과 재사용 기준은 [CI 운영](CI.md)에 설명합니다. 브라우저 검사에 필요한 외부 글꼴은 통제된 fixture를 사용합니다. 공개 CI에는 실제 작품 원문, 로그인 정보나 개인 브라우저 프로필을 넣지 않습니다.

실제 노벨피아 화면과 웹글꼴 CDN 검사는 일반 CI와 분리한 수동 검증입니다. 단위 검사나 빌드 통과만으로 실제 사이트 동작까지 확인했다고 보고하지 마세요. 노벨피아 서비스 요청·추천·광고·결제·접근 권한에 영향을 줄 수 있는 작업은 합성 사례에서 먼저 확인합니다.

### 검사 선택과 산출물

| 변경 범위                    | 관련 검사                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| 페이지·높이·읽던 위치        | `reader`, `reader-height`, `page-effects`, `paragraph-spacing`, `session-restore`     |
| 설정창·프리셋·파일·글꼴      | `ui-finishing`, `preset-loading`, `management`, `user-fonts`, `navigation-fonts`      |
| 초기 표시·이미지·보조 영역   | `initial-display`, `presentation`, `background-images`, `reading-polish`, `finishing` |
| 릴리스·버전·스토어 제출 분기 | `pnpm run test:release`, `pnpm run release:check`                                     |

표의 브라우저 검사 이름은 `tests/e2e`의 `.spec.ts` 파일명입니다. 특정 파일만 실행할 때도 먼저 `pnpm run build:e2e`로 현재 소스를 반영합니다. `--list`는 등록 확인이며 실제 실행이 아닙니다. 부분 검사와 전체 검사를 구분해 기록하세요.

일반 회귀 결과는 `.output/qa/results/`에, 실패 당시 결과 사본은 `.output/qa/failures/`에 남습니다. 브라우저 프로필은 `.output/qa/profiles/`의 실행별 폴더를 사용하고 실행 종료 시 정리합니다. 실제 사이트 검사 결과는 `_reference/live/`에 남으며 작품 내용이나 네트워크 헤더가 포함될 수 있으므로 공개 CI 산출물로 올리지 않습니다. 이전 실패나 중단된 프로필의 7일 보관·정리 절차는 [CI 운영](CI.md#실패를-조사하는-순서)을 따릅니다.

문서만 바꾸면 링크·명령·포맷·기재한 계약을 검증합니다. 같은 소스의 런타임 검사 결과를 재사용할 때는 그 기준과 미검증 범위를 적습니다. 변경한 코드가 있는데 이전 빌드로 검사한 결과를 새 코드의 성공으로 취급하지 않습니다.

## 저장과 호환성

읽기 설정·프리셋은 Chrome 동기화 저장소, 위치·북마크·통계는 로컬 저장소를 사용합니다. 등록 이미지·글꼴 파일은 확장 영역의 IndexedDB에 저장합니다. 자세한 범위는 [개인정보 안내](PRIVACY.md)를 기준으로 합니다.

설정 스키마를 바꿀 때는 기존 값의 해석, 기본값, 프리셋 적용 범위, 설정 파일 가져오기와 초기 화면 캐시를 함께 확인하세요. 프리셋은 읽기 방식·페이지 구성·효과·진행바 배치도 저장하지만 확장 사용 여부·자동 추천 동의·배경 이미지 페이드는 바꾸지 않습니다. 파일 참조를 저장할 때 실제 파일이 없는 환경의 대체 표시도 검사합니다.

`readingMode`가 없는 설정은 `null`로 읽고 처음 사용 가능한 원사이트 읽기 방식을 한 번 가져옵니다. 값이 정해진 뒤에는 확장 저장값이 우선합니다. `reading-mode.ts`는 저장 완료 후 기존 native adapter로 전환하며, 최초 변경 직전의 원사이트 값을 기본 뷰어 복귀 시 복원합니다. 구형 프리셋의 `readingMode: null`은 새로 포함한 읽기 옵션 네 개를 적용하지 않는 호환 표시입니다. 새 초안은 명시적인 읽기 방식을 저장합니다. 관련 검사는 `reading-mode.spec.ts`와 `session-restore.spec.ts`입니다.

읽기 위치는 문단·글자 앵커로 유지합니다. 본문 레이아웃을 바꿀 때는 스크롤·한 쪽·두 쪽, 첫 쪽·마지막 쪽, 설정 변경과 뒤로 가기에서 위치가 유지되는지 확인하세요.

자동 위치는 백그라운드에서 직렬로 저장합니다. 진행률 90% 이상이면 해당 회차의 앵커를 완료 표시로 바꾸고, 다른 탭의 늦은 기록도 이를 되돌리지 못하게 합니다. 본문 글자가 없는 마지막 쪽은 회차 ID만으로 완료를 기록합니다. 페이지 캐시에서 빠르게 돌아오면 직전 저장 응답을 기다린 뒤 복원 값을 읽습니다. 완료 회차의 재진입은 처음부터 시작하되 현재 문서·읽기 방식 전환의 앵커와 수동 북마크는 별도로 유지합니다. 초기 배치가 공개되기 전의 임시 진행률은 저장하지 않습니다.

위치 저장 메시지는 이 확장의 최상위 뷰어 문서에서만 받으며 URL의 회차 번호와 보고한 회차 번호가 일치해야 합니다. `/viewer/123`과 `/viewer/123/`는 같은 회차로 처리하고 쿼리·해시는 식별에 쓰지 않습니다. 허용 출처 검사 실패와 실제 저장소 오류를 구분하며, 저장 실패를 무시하고 모드를 바꾸지 않습니다. 주소 변형과 다른 회차·출처·하위 프레임 거절은 `reading-position-service.test.ts`, 전환 동작은 `reading-mode.spec.ts`에서 검사합니다.

내장 배경은 `shared/config/backgrounds.ts`의 고정 ID와 경로를 사용합니다. 설정·프리셋에는 ID만 저장하고, 뷰어가 사용할 실제 파일만 `modules/esm-reader.ts`에서 공개합니다. 등록 파일의 IndexedDB·용량 한도와 외부 URL 허용 규칙에 섞지 않습니다. 프리셋과 배경 참조의 회귀 검사는 `preset-layouts.spec.ts`를 포함합니다.

## 배포

작업 PR은 `develop`으로, 릴리스 PR은 같은 저장소의 `develop`에서 `main`으로 보냅니다. 릴리스 PR에서 `package.json`의 버전과 [변경 이력](../CHANGELOG.md)을 함께 갱신합니다. pnpm 잠금 파일은 프로젝트 버전을 저장하지 않습니다. 의존성을 바꾸면 잠금 파일도 갱신하며, 릴리스 검사는 루트 의존성과 잠금 파일의 일치를 확인합니다. 자세한 협업 규칙은 [기여 안내](../CONTRIBUTING.md)에 있습니다.

배포 파이프라인은 검증한 동일 ZIP을 GitHub Release와 스토어 제출에 사용합니다. Chrome 웹 스토어 자동 제출은 최초 등록 준비가 끝날 때까지 비활성 상태로 둡니다. 활성화 이후에도 Google 심사 승인과 사용자 브라우저 업데이트 시점은 별개입니다. 배포 인증 값은 저장소에 커밋하지 않습니다.

`release:package`가 만드는 `.output/release/`의 ZIP·SHA256SUMS·메타데이터를 제출 기준으로 사용합니다. 일반 `pnpm run zip` 결과와 혼동하지 마세요. 활성화 조건, 필요한 변수와 실패 후 재실행은 [배포 운영](RELEASE.md)을 따릅니다.

## 아이콘과 라이선스

스토어·README 이미지는 일반 배포 빌드 후 `node scripts/store-assets.mjs`로 촬영합니다. 실제 확장 UI와 직접 작성한 본문을 사용하며, 촬영 원본은 공개 소스와 분리된 테스트 출력에 둡니다. 구성과 검수 기준은 [이미지 안내](../store/assets/README.md)를 참고하세요.

아이콘을 바꾸면 원본과 생성 스크립트를 함께 유지하고 `pnpm run icons:generate`로 필요한 크기를 생성합니다. 원본 작업 파일은 확장 ZIP에 넣지 않습니다.

새 라이브러리나 글꼴을 추가할 때 출처·버전·사용 조건을 확인하고 배포 고지에 반영합니다. UI 동봉 글꼴과 원격 독서용 글꼴, 사용자가 등록한 파일은 배포 범위가 다릅니다. 사용자 등록 파일이나 권한 없는 작품 원문을 테스트 fixture로 커밋하지 않습니다.

## 성능 비교

`pnpm run build:e2e` 후 `node scripts/measure-ui.mjs`를 실행하면 `test-results/performance/`에 합성 MV3 측정 결과와 화면을 저장합니다. 옵션 홈·팝업·뷰어를 새 프로필 5개에서 열어 표시 시점, 글꼴 준비 후 시점, JavaScript 실행 시간과 힙 크기를 기록합니다. 같은 머신과 Chromium, 다른 무거운 검사 없이 변경 전후 중앙값을 비교하세요. 외부 요청은 차단하므로 실제 CDN 속도나 사용자 이미지의 최악 조건을 나타내지는 않습니다.

라우팅·모션·상태 구독을 바꾸면 `management`, `navigation-fonts`, `page-effects` 검사와 전체 MV3 회귀를 확인합니다. CSS 애니메이션 이름 대신 실제 움직임·포커스·취소·스타일 복원을 검사합니다. 시작 지연 청크에 무거운 설정 UI를 추가하거나 동작 줄이기에서도 반복 모션이 남지 않도록 합니다.
