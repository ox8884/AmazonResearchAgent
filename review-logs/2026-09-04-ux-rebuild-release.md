# 리서치 앱 UX 수정 및 운영 배포

## 결과

사용자가 승인한 코드 변경을 커밋하고 지정한 GitHub 저장소 main에 푸시했다. Cloudflare 운영 배포 후 로그인된 Codex 인앱 브라우저에서 확인했다.

- 운영: https://amazon-research-agent.hyj5317.workers.dev/ko/dashboard
- 저장소: https://github.com/ox8884/AmazonResearchAgent
- `ba3f3cc`: 공통 후보 근거 및 실행 조회
- `bab56ba`: 근거 중심 대시보드·상세, 실행 상세, 반응형 메뉴
- `e27358c`: provider 결과 귀속, 대기/미확인 구분, 저장·목록 응답 충돌 차단
- `d31e2ea`: 영문 후보 수 문구와 명시적 UTC 화면 조회 시각
- 최종 배포 제품 소스: `d31e2eaf2241835934331828ec5eae7dcab78ede`
- 최종 Cloudflare 버전: `b5a13309-2dfd-482b-84d5-151ab9c47007`
- 최종 BUILD_ID: `Whck_lN-zcdr7Lox9pRBV`
- 최종 업로드 gzip: 2521.98 KiB, Worker startup: 29 ms
- 첫 배포 `e27358c` / `c5684b6c-37db-43f6-9e30-6266ae611bdb`에서 전체 화면을 확인한 뒤, 두 파일의 문구 수정만 추가하여 재배포했다.

## 실제로 달라진 것

- 대시보드·후보 목록·상세가 같은 근거 상태를 사용한다. 조회 오류나 한정 조회를 자료 없음으로 바꾸지 않는다.
- 현재 후보의 월 검색량 311, 분석 총점 50, 초기 선별 점수 81.32를 구분한다. 판매가·수수료·공급업체 확인 수익성과 리뷰 원문은 미확인으로 남는다. GO나 발주 승인을 생성하지 않았다.
- 실행 목록에서 실행별 후보와 개별 작업을 추적할 수 있다. 배정 완료와 작업 완료를 구분하고 임대 만료를 표시한다.
- AI 설정은 운영 활성과 이번 세션 테스트 결과를 분리한다. 결과 대기 만료·작업 실패·probe 대기는 연결 실패와 같지 않다. 다른 job ID의 결과를 사용하지 않는다.
- 저장 중 목록 새로고침까지 동작을 잠그고, 오래된 초기 GET의 선택/오류 및 역순 목록 응답이 최신 상태를 덮지 않게 했다.
- 모바일 메뉴가 줄바꿈되어 모든 메뉴가 보인다. 일반 설정의 긴 값은 세로로 배치한다. API 호출/일과 상품 출시 예산 $3,000을 구분한다.

## 검증

- `pnpm --filter @ara/web typecheck`: PASS
- `pnpm --filter @ara/web lint`: PASS
- `pnpm --filter @ara/web test`: 95 tests / 14 files PASS
- 마지막 문구 수정 후 `pnpm --filter @ara/shared test`: 26 tests / 6 files PASS, shared/web typecheck, web lint 및 Linux OpenNext 빌드 재통과. 변경 없는 web 동작 단위테스트는 반복 실행하지 않았다.
- Linux `pnpm --filter @ara/web build:cloudflare`: PASS. Node 24.14.0 사용으로 package 요구 24.20.0 경고는 남았지만 빌드 exit 0.
- `pnpm --filter @ara/web exec opennextjs-cloudflare deploy`: PASS. Linux에서 생성한 bundle을 Windows의 기존 Wrangler 인증으로 배포했다.
- `git diff --check`: PASS. 기존 CRLF 변환 안내만 있다.
- 비로그인 운영 GET: `/ko/dashboard`, `/ko/settings/ai` → 307 `/ko/login`; `/api/ai-providers` → 401.
- 인증 화면: 9개 route × 한국어/영어 × 375/768/1280 = 54개. 가로 overflow 0, 메뉴 가림 0, 활성 메뉴 중복 0. 저장된 provider 3개, OpenRouter 선택 시 올바른 모델과 빈 키 입력 확인. Tab 포커스 outline 확인.
- 보존 증거: 첫 배포 `production-final/` PNG 54장과 최종 문구 수정 배포 `production-copy-correction/` 대시보드 PNG 6장. 각 manifest에 별도 소스 SHA·배포 버전·실측 치수·SHA-256을 기록했다. 기존 BEFORE JPEG 6장 보존. `comparison.html`에서 최신 대표 화면 전후 비교.
- 별도 인증 fixture E2E는 DB가 차단된 환경의 로그인 단계에서 7개 실패했다. 비로그인 2개 및 9개 라우트 리다이렉트 검사는 통과했다. 실로그인 읽기 전용 확인은 저장·연결 테스트 E2E를 대신 통과한 것으로 계산하지 않는다.
- 이번 배포 검증에서 실제 provider completion, 리서치, CSV 업로드, 설정 저장은 실행하지 않았다. 유료 호출 비용은 발생시키지 않았다.

## 리뷰 기록

- `release_guard_review`: 지정된 provider controller/model/view/tests 정적 재리뷰 PASS. 초기 목록 race와 test job 귀속을 확인했다. 제품 소스 `e27358cbebe9a0975fc0eccfbff2efbd1a61bf0d`에 대응한다.
- `production_visual_review`: 같은 소스/배포 버전의 한국어 desktop/mobile PNG 6장 검수 PASS. 심미적 전면 재설계 승인을 뜻하지 않는다.
- `production_english_visual_review`: 첫 영문 검수에서 단수 문법·시간대 불명확을 지적하여 수정했다. `d31e2eaf2241835934331828ec5eae7dcab78ede` / `b5a13309-2dfd-482b-84d5-151ab9c47007`의 새 영문 대시보드 375/768/1280 PNG를 재검수하여 PASS. `Page retrieved at (UTC)`와 `Candidates needing review: 1.`을 실제 이미지에서 확인했다.

## 보존과 남은 작업

- 기존 `apps/web/next-env.d.ts`, `프롬프트.md`, 역사 보고서와 사용자 자료는 커밋에 포함하지 않았다. `.env.local`·자격 증명을 stage하지 않았다. 기존 이력의 텍스트 blob 1,523개를 주요 키 패턴으로 점검했으며 일치 0이었다. 이는 포괄적 보안 감사가 아니다.
- 전체 프론트엔드 재설계는 미완료다. 이번 대표 대시보드·상세 방향을 확인한 뒤 나머지 화면으로 확장한다.
- 수동 대나무 선반 조사/RFQ를 앱 후보에 연결하는 저장 흐름과 $3,000 출시비 자동 게이트는 별도 후속 범위다.
- 기존 worker의 누락 시장값을 0/false로 채우는 분석 경로(`apps/worker/src/jobs/enrich-strong-potential.ts`)는 추가 진단 대상으로 기록했다. 이번 UX 수정에서 worker 계산을 변경하지 않았다.
- OAuth 구독은 계속 보류한다. 실제 유료 provider 동작 및 공급업체 견적 확인은 이번 배포의 검증 범위가 아니다.
