# UX 개선 증거

## 최종 배포본

- 현재 비교 페이지의 AFTER는 실제 Cloudflare 배포본이다. 후보 상세는 `production-final/`, 대시보드는 마지막 문구 수정을 포함한 `production-copy-correction/`를 사용한다.
- 전체 54장 배포: 코드 `e27358cbebe9a0975fc0eccfbff2efbd1a61bf0d`, Cloudflare `c5684b6c-37db-43f6-9e30-6266ae611bdb`, BUILD_ID `TXnz9HE1nb9rH15tl4KP9`.
- 마지막 대시보드 6장 배포: 코드 `d31e2eaf2241835934331828ec5eae7dcab78ede`, Cloudflare `b5a13309-2dfd-482b-84d5-151ab9c47007`, BUILD_ID `Whck_lN-zcdr7Lox9pRBV`. 명시적 UTC 조회 시각·영문 후보 수 문구만 추가 수정했다. 이전 캡처를 덮어쓰지 않았다.
- 9개 화면 × 한/영 × 375/768/1280 = 54개 PNG. `production-final/capture-manifest.json`에 URL, 실제 viewport/PNG 치수, SHA-256, 시각, 내비게이션 결과가 있다.
- 정확한 탭별 viewport를 설정한 후 실제 PNG 너비를 검증했다. 초기 시도의 요청/실측 폭 불일치 캡처는 최종 증거에서 제외했다. BEFORE는 덮어쓰지 않았다.
- 54개 모두 가로 overflow 0, 메뉴 전체 표시, 활성 메뉴 1개. AI 설정은 provider 3개가 로드된 뒤 촬영했다.
- 유료 호출·저장·업로드·리서치 실행 없이 기존 로그인 세션으로 화면을 확인했다. 인증 fixture E2E 성공을 주장하지 않는다.
- 최종 검증과 남은 작업: `../../2026-09-04-ux-rebuild-release.md`.

## 배포 전 보존 기록

아래 AFTER와 검증 수치는 배포 전 로컬 단계의 기록이다. 최종 증거는 위의 production-final을 사용한다.

- 대표 화면 비교: `comparison.html`.
- BEFORE 6장: 기존 배포본 대시보드·동일 후보 상세, ko × 375/768/1280.
- AFTER 55장: dashboard/detail/candidates/runs/run-detail/settings/ai-settings/imports/new-import × ko/en × 375/768/1280 = 54장, OpenRouter 선택 1280 1장.
- 다른 화면의 BEFORE는 확보하지 않았으며 재구성하지 않았다.
- AFTER 빌드: `E-Yt2FRD51eMH4xzE3ydu`. 모든 AFTER는 해당 빌드 이후 촬영. 사용자가 로그인한 실제 세션에서 읽기 전용으로 이동했다.
- 형식: CUA가 반환한 JPEG. 초기 `.png` 확장자 오류를 실제 JPEG에 맞게 `.jpg`로 정정했다. BEFORE 바이트는 그대로 보존했다. 잘못된 폭으로 찍힌 AFTER 6장은 다시 촬영했다.
- `capture-manifest.json`: 실제 디코딩한 format/width/height, SHA-256, 촬영 시각. 전체 페이지 캡처는 스크롤바가 있을 때 요청 viewport보다 15px 좁다. 모두 viewport 또는 viewport-15px 조건 충족.
- DOM 확인: 9개 화면 × 한/영 × 3폭에서 scrollWidth가 innerWidth를 넘지 않았다. 후보 연결·실행 상세·언어 전환·provider 선택과 빈 키 입력을 확인했다.
- 기존 배포본과 로컬은 같은 후보·DB를 조회했으나 촬영 시각/환경은 다르다. 동적 시각과 작업 집계까지 동일하다는 주장이 아니다.
- 단위 93개/14파일, web typecheck/lint/build 통과. 비로그인 9개 라우트 리다이렉트 E2E 통과.
- 인증 fixture E2E: DB 연결을 차단한 별도 환경에서 7개가 로그인 단계 실패, 2개 비로그인 테스트 통과. durable session DB가 필요한 구조여서 인증 테스트 통과로 계산하지 않는다. 실로그인 화면 이동은 저장·연결 테스트 E2E의 대체 통과가 아니다.
- 유료 provider 호출, 새 리서치, CSV 업로드, DB 수정, 배포·커밋 없음. 전체 디자인 확장은 대표 시안에 대한 사용자 방향 확인 후 진행한다.
- 독립 visual-QA 결과는 별도 최종 보고서에 기록한다. 이 파일 자체는 PASS 선언이 아니다.
