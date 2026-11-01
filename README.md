# Unofficial Novelpia Patch

노벨피아 웹소설을 원하는 글꼴, 간격과 테마로 읽을 수 있는 비공식 Chrome 확장프로그램입니다.

- 스크롤 읽기와 한 쪽·두 쪽 페이지 읽기
- 글꼴·굵기·줄 간격·문단 간격·빈 줄 간격 조절
- 읽기 방식·크기·여백이 다른 10가지 프리셋: 스크롤형 6개·페이지형 4개, 내장 이미지 배경 4개
- 사용자 글꼴 파일 등록, 프리셋 편집과 설정 파일 내보내기
- 읽던 위치 자동 저장, 수동 북마크와 로컬 독서 통계

## 설치

Chrome 웹 스토어 등록을 준비하고 있습니다. 아직 스토어에서 설치할 수 없습니다.

직접 빌드하려면 Node.js 26.10 이상과 pnpm이 필요합니다. `.nvmrc`에 검증한 개발 버전을 지정합니다.

```sh
git clone https://github.com/jukrap/unofficial-novelpia-patch.git
cd unofficial-novelpia-patch
npm install --global pnpm@12.9.1
pnpm install --frozen-lockfile
pnpm run build
```

Chrome에서 `chrome://extensions`를 열고 **개발자 모드 → 압축해제된 확장 프로그램을 로드합니다**를 선택한 뒤 `.output/chrome-mv3` 폴더를 지정하세요. 개발용 빌드에는 스토어 자동 업데이트가 적용되지 않습니다.

## 시작하기

1. 노벨피아에서 읽을 수 있는 회차를 열고 기존 테마박스 버튼을 누릅니다.
2. **프리셋**에서 원하는 모습을 적용하거나 **텍스트·레이아웃·외관**을 조절합니다.
3. 확장 아이콘의 **설정 열기**에서 사용자 글꼴, 설정 파일과 독서 통계를 관리합니다.

기본 뷰어로 돌아가려면 **정보 → 확장 뷰어 사용**을 끄세요. 열린 회차에는 새로고침이 필요합니다.

## 안내와 문의

- [문서 전체 안내](docs/README.md)
- [사용 안내와 문제 해결](docs/USAGE.md)
- [개인정보 처리 안내](docs/PRIVACY.md)
- [개발 안내](docs/DEVELOPMENT.md) · [기여 방법](CONTRIBUTING.md) · [변경 이력](CHANGELOG.md)
- [문제 신고·문의·제안](https://github.com/jukrap/unofficial-novelpia-patch/issues)

읽기 설정과 프리셋은 Chrome 동기화 설정에 따라 다른 기기로 동기화될 수 있습니다. 등록한 글꼴·이미지 파일, 읽던 위치와 독서 통계는 동기화되지 않습니다. 웹글꼴이나 이미지 주소를 사용하면 해당 외부 서비스로 자원 요청이 발생합니다.

이 프로젝트는 노벨피아와 공식적인 관계가 없습니다. 광고·결제·회차 접근 권한과 서비스 요청을 우회하지 않습니다. 노벨피아 측의 요청이나 문제가 확인되면 수정, 배포 중단 또는 공개 자료 삭제 등의 조치를 취할 수 있습니다.

소스 코드는 [MIT License](LICENSE)로 제공합니다. 포함된 글꼴과 외부 라이브러리의 조건은 [별도 고지](public/THIRD_PARTY_NOTICES.txt)와 [글꼴 출처](public/licenses/Reading-Font-Sources.txt)를 확인하세요.
