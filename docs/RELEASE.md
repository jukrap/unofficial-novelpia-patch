# 배포 운영

현재는 비공개 저장소 검토와 Chrome 웹 스토어 최초 등록 준비 단계입니다. GitHub Actions와 스토어 자동 제출은 꺼져 있습니다. 이 문서는 구성과 활성화 절차이며 실제 심사·공개 완료 기록이 아닙니다.

## 브랜치 보호 활성화

`.github/rulesets/`는 main·develop의 PR, 필수 검사, 강제 push·삭제 금지 규칙입니다. main에는 같은 저장소 develop의 PR만 허용하는 `PR policy` 검사도 필요합니다. 관리자가 한 명이므로 별도의 승인 1회를 요구하지 않습니다.

비공개 저장소에서 현재 요금제로 규칙을 적용할 수 없으면 유료 전환하지 않고 공개 검토가 끝날 때까지 보류합니다. 파일이 존재하는 것만으로 원격 보호가 적용되는 것은 아닙니다.

```sh
# 조회만 수행합니다.
node scripts/apply-rulesets.mjs jukrap/unofficial-novelpia-patch

# 공개 전환, Actions 활성화와 검사 성공을 확인한 후 관리자가 실행합니다.
node scripts/apply-rulesets.mjs jukrap/unofficial-novelpia-patch --apply
```

필수 검사 이름은 `PR policy`, `Static and package`, `MV3 (Windows)`이며 GitHub Actions 앱이 발행한 결과만 받습니다. main의 릴리스 병합 방식은 merge commit입니다. 적용 후 다른 출발 브랜치·포크의 develop·실패한 검사에서 병합이 거절되는지 실제 PR로 확인합니다.

## 최초 Cloud 인증 준비

Google Cloud에서 결제 계정을 연결하지 않은 전용 프로젝트를 만들고 Chrome Web Store API 약관을 확인합니다. 다음 스크립트는 gcloud가 인증된 Cloud Shell에서 사용합니다. 인수는 프로젝트 ID, GitHub 저장소, 저장소 숫자 ID, 소유자 숫자 ID입니다.

```sh
bash scripts/setup-cloud.sh PROJECT_ID OWNER/REPOSITORY REPOSITORY_ID OWNER_ID
```

스크립트는 제출용 서비스 계정, GitHub OIDC 연결과 해당 계정의 Workload Identity User 권한을 구성합니다. 프로젝트의 일반 관리 권한이나 키 파일을 만들지 않습니다. 같은 이름의 연결이 있으면 지정한 저장소의 조건으로 갱신하므로 전용 프로젝트에서만 실행하세요.

신뢰 조건은 저장소·소유자의 숫자 ID, 저장소 이름, main 참조, `ci.yml` 경로, push·수동 실행 이벤트를 함께 확인합니다. 실행 코드는 확장 패키지에 포함하며 Cloud 인증은 확장 이용자에게 필요하지 않습니다.

Chrome 웹 스토어 개발자 대시보드에서 서비스 계정을 연결하고 등록 초안의 항목 ID와 게시자 ID를 확인합니다. 기존 다른 배포용 계정이 연결돼 있으면 임의로 교체하지 않습니다.

## GitHub 변수

저장소의 Actions variables에 아래 항목을 둡니다. ID는 비밀 키가 아니며 토큰이나 서비스 계정 키 JSON을 커밋하지 않습니다.

| 변수                             | 값                                                      |
| -------------------------------- | ------------------------------------------------------- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | setup-cloud.sh가 출력한 provider 경로                   |
| `GCP_SERVICE_ACCOUNT`            | 제출용 서비스 계정 주소                                 |
| `CWS_PUBLISHER_ID`               | 스토어 게시자 ID                                        |
| `CWS_EXTENSION_ID`               | 스토어 초안의 32자 항목 ID                              |
| `CWS_SUBMIT_ENABLED`             | 최초 제출 승인 전까지 `false`                           |
| `CI_PRIVATE_ENABLED`             | 비공개 저장소에서 무료 사용량을 확인하기 전까지 `false` |

Actions 자체가 비활성 상태면 먼저 저장소 설정에서 활성화해야 합니다. 공개 저장소는 표준 실행기를 사용합니다. 비공개 저장소의 실행·산출물 한도는 별도로 확인하며, 추가 과금이나 유료 실행기를 자동 활성화하지 않습니다.

`CI` 워크플로를 main에서 수동 실행하고 `store-status`를 선택하면 단기 인증 후 상태만 조회합니다. 이 작업은 ZIP을 올리거나 심사를 요청하지 않습니다. 인증이 성공해도 항목·게시자 연결이 잘못되면 조회가 실패할 수 있습니다.

## 릴리스 순서

1. main의 변경을 PR로 develop에 동기화합니다.
2. develop의 릴리스 준비 PR에서 package.json·lockfile 버전과 CHANGELOG를 갱신합니다. 버전은 증가하는 `x.y.z`, 변경 이력 제목은 `## [x.y.z] - YYYY-MM-DD`입니다.
3. develop → main PR에서 검사와 변경 내용을 확인하고 merge commit으로 병합합니다.
4. Linux 검증·빌드와 Windows MV3 회귀가 통과하면 검증한 ZIP·SHA256SUMS·release.json을 GitHub Release에 올립니다.
5. `CWS_SUBMIT_ENABLED=true`인 경우에만 같은 ZIP을 스토어에 올리고 심사를 요청합니다. 승인이 나면 공개되며 브라우저 업데이트는 Chrome의 배포 일정에 따릅니다.

첫 스토어 제출 전에는 [등록 자료](../store/LISTING.md), 화면·아이콘, 공개 개인정보 URL과 심사 확인 절차를 검토합니다. 저장소가 비공개인 상태의 GitHub 문서 URL은 공개 개인정보 안내로 사용할 수 없습니다.

## 재실행과 실패

- `verify`: 검사·빌드만 실행합니다.
- `release`: 검사 후 현재 main 버전의 GitHub 릴리스와 활성화된 스토어 제출을 재시도합니다.
- `store-status`: 스토어 상태만 조회합니다.

같은 태그가 다른 커밋을 가리키거나 배포 파일의 해시가 다르면 덮어쓰지 않고 중단합니다. 부분 업로드된 draft는 재사용하되, GitHub의 빈 `starter` 파일은 초안에서 확인·정리한 뒤 재실행해야 합니다. 정상 배포 파일은 삭제하지 마세요.

스토어에 다른 버전이 심사 중이거나 승인 후 공개 대기 중이면 자동 취소·교체하지 않습니다. 응답이 불확실한 POST도 바로 재전송하지 않고 먼저 상태를 확인합니다. 수정이 필요하면 더 높은 버전으로 배포하며 스토어 버전을 되돌리지 않습니다.

## 로컬 패키지 확인

```sh
npm run release:check
npm run test:release
npm run build
npm run release:package
```

`.output/release/`에 검증한 ZIP, SHA256SUMS, 메타데이터와 릴리스 설명이 생성됩니다. 스토어에는 ZIP만 업로드합니다. 프로덕션 권한·사이트 범위·지연 청크·라이선스·개발 전용 파일 유입을 검사하며 ZIP 루트에 manifest.json이 위치합니다.
