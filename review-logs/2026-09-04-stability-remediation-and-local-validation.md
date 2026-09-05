# Stability remediation — local verification

- Date: 2026-09-04 America/Chicago (verification continued into 2026-09-05 UTC)
- Request: 감사에서 추천한 결함을 모두 수정.
- Base HEAD: `374a736322c982b36350d7a6ba68de03ad4bfbd6`
- Status: **확인된 7개 결함 수정 및 로컬 검증 통과. 운영 반영은 미실시.**
- Commit / push / production migration / Cloudflare deploy: **이번 수정 턴에는 실행하지 않음.**
- Exact dirty artifact: 37 source/config/test/migration files, manifest SHA-256 `ee5f3b231e4aa51d4ba5f06ed639e3a1917b95da3b7e454d7644258e0023090d`.
- 이 문서는 기존 감사 결과를 대체하는 운영 안전 인증이 아니다. 현재 배포된 사이트는 수정 전 버전이며, 신규 DB 함수와 새 web/worker 배포가 함께 필요하다.

## 1. 수정 결과

| 감사 항목 | 수정 | 관찰된 검증 |
|---|---|---|
| P1-1 최종 시도 후 lease 만료 작업 고착 | 새 terminalize RPC를 worker loop에서 호출. 실패로 종료하고 lease 제거; 해당 DAILY_RESEARCH 활성 run만 needs_attention | 실제 격리 SQL에서 최종/비최종/유효 lease 구별 및 linked run 상태 확인 |
| P1-2 요청 예산 밖 자동 재시도 | Jungle Scout 기본 retryLimit 2 → 0. 기본 요청은 1 wire call. 추가 queue 시도는 기존 budget authorization 경로 사용 | 로컬 HTTP 서버 3회 호출 red → 1회 green; 실패 usage call_count=1/retry_count=0 |
| P1-3 미관측 수치가 유리한 점수로 변환 | 빈/불완전/비정상 판매량은 snapshot 생성 대신 Needs Review + market_evidence_status. 미관측 optional 지표는 null. 검증된 수치 없으면 점수 판정 차단 | scoring/unit/실제 DB worker integration 및 빈 데이터 acceptance |
| P2-1 로그인 전체 차단 | trusted Cloudflare IP를 canonicalize/HMAC 처리. client 8/300s + global 80/300s. production trust 누락 fail-closed | 실제 production-mode route에서 A 8실패 후 A 정상 비밀번호 401, B 정상 비밀번호 200 |
| P2-2 수동 실행 중복 생성 | advisory transaction lock 기반 manual run + job 단일 RPC | 동시 SQL 호출이 하나의 run/job 반환; 실제 브라우저 반복 클릭 후 DB runs=1/jobs=1 |
| P2-3 데이터 신선도 혼동 | cacheCapturedAt / processedAt / providerUpdatedAt와 가용성 분리. daily freshness는 cache 관측시각. expanded resume도 실제 cache key 유지 | 유효/미상/미래/오래된 관측 및 expanded checkpoint regression |
| P2-4 1,000행 집계 잘림 | service-role 전용 security-invoker aggregate RPC | 실제 DB jobs 1205/candidates 1206, 실제 브라우저 대기 1205 표시 |

추가로 검증 중 드러난 직접 관련 결함을 수정했다.

- 즉시 enqueue 시 host 시간을 DB에 전달하지 않고 DB default 시간을 사용한다. 명시된 예약 시각은 보존한다.
- 새 동시성/집계 tests가 다른 파일의 jobs를 claim하는 shared-DB 간섭을 막기 위해 DB test script는 이미 존재하는 per-file isolation 모드를 사용한다. 새 테스트 인프라/의존성은 추가하지 않았다.
- 즉시 실행을 의도하는 기존 acceptance fixture의 host-now 시각은 고정 과거 시각으로 교체했다. 미래 lease/expiry assertions는 그대로 유지했다.

## 2. 독립 리뷰와 수정

Independent reviewer: `/root/remediation_review`, read-only, base HEAD + uncommitted artifact.

초기 결과: Critical 0 / Important 2, REQUEST CHANGES.

1. 기존 2-arg login RPC 삭제가 기존 bundle/rollback 로그인을 깨뜨림 → 기존 함수를 유지하고 새 4-arg overload를 추가.
2. global limit 초과 뒤에도 새로운 client row가 생성됨 → global row를 먼저 lock/check하고 초과 시 client insert 전에 반환.

재검토: 위 두 항목 해결 및 queue DB-clock authority / expanded-cache resume / test isolation / single-wire contract 확인, APPROVE (검토 범위 한정). 새 commit SHA에 대한 release gate나 운영 배포 승인으로 확대하지 않는다.

## 3. Fresh verification

명령에서 local fixture credentials만 사용했으며 운영 env 파일/키를 주입하지 않았다.

```sh
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=local-fixture-only \
pnpm exec turbo run test --force --env-mode=loose
```

Exit 0; Turbo 11/11 successful, 0 cached.

| Package | Passing tests |
|---|---:|
| api-budget | 4 |
| shared | 26 |
| web | 101 |
| secret-store | 4 |
| ai-router | 72 |
| research-engine | 46 |
| jungle-scout | 29 |
| notifications | 10 |
| queue | 12 |
| db | 223 |
| worker | 244 |
| **Vitest total** | **771** |

- Worker 5 skips: existing Windows-only exclusions in systemd-subscription-sandbox tests. 미실행 Linux/POSIX 검증을 통과로 세지 않았다.
- DB harness Node tests: 33 pass / 0 fail.
- `node --test scripts/start-production-worker.test.mjs`: 2 pass / 0 fail.
- 합계: 806 passing tests, 5 explicit platform skips (중복 좁은 재실행은 합산하지 않음).
- `pnpm exec turbo run typecheck lint --force`: 22/22 successful, 0 cached.
- `git diff --check`: whitespace error 없음. 기존 CRLF conversion warnings는 있음.
- WSL staging `pnpm --filter @ara/web build:cloudflare`: exit 0, Next 16.3.3 + OpenNext Cloudflare 1.20.6 bundle complete.
- Build limitation: WSL Node 24.14.0 vs repository engine 24.20.0 warning. Windows test/typecheck runtime은 Node 24.20.0. 실제 release 전에 pinned build runtime으로 재검증할 것.
- LSP: TypeScript server 미설치/사용자 설치 거절 상태. 대신 실제 tsc --noEmit 실행 결과 사용.

중간 실패도 기록한다: env 미주입 시 harness가 provisioning 전에 거부; old retry expectations 2건; host-vs-DB clock fixture failures; shared-DB cross-file claim 실패. 각각 원인 수정 후 위 전체 명령을 재실행하여 exit 0을 확인했다. 테스트 삭제/단언 약화/임의 sleep으로 통과시키지 않았다.

## 4. 실제 브라우저 및 HTTP QA

운영 사이트가 아닌 run-owned disposable PostgreSQL + PostgREST + production-mode Next server를 사용했다. 기존 admin fixture 비밀번호로 정상 로그인했으며, 서명 쿠키를 임의 주입하지 않았다. 실제 provider/worker 호출 실행은 없음.

- In-app browser tab 9, fixture `http://127.0.0.1:62737` (현재 종료됨).
- UI: `/ko/login` → 실제 form submit → `/ko/settings/ai`.
- Dashboard AX: `작업 대기열 : 대기 1205 · 실행 중 0 · 완료 0`.
- `지금 리서치` 두 번 클릭 → `대기열에 추가됨`.
- 독립 DB read-back: `{"runs":1,"jobs":1}`.
- HTTP client isolation:

```json
{"clientAFirst8":[401,401,401,401,401,401,401,401],"clientACorrectAfterLimit":401,"clientBCorrect":200}
```

- 화면은 실제 CUA AX 및 screenshot으로 확인했다. screenshot은 이 대화의 tool evidence이며 별도 PNG 파일로 저장했다고 주장하지 않는다.
- 전체 Playwright E2E suite를 실행했다고 주장하지 않는다. 이번 수정의 실제 login/dashboard/manual-enqueue flow는 직접 검증했다.
- QA 연결의 Windows↔WSL loopback/예약 포트 제약은 fixture transport에서 해결했다. 앱의 보안 설정이나 운영 방화벽을 낮추지 않았다.
- fixture `ara_it_58260_10d1283b`: 정상 종료, `FIXTURE_CLEANED` 확인. 임시 Next PID와 relay/DB/PostgREST는 해당 run만 정리.

## 5. Migration / release handoff

신규 migration 3개:

1. `20260905024323_queue_authority_recovery.sql`
2. `20260905024517_dashboard_exact_counts.sql`
3. `20260905024826_login_guard_client_isolation.sql`

다음 운영 반영은 별도 단계다.

1. 운영 DB의 실제 migration history/backup과 worker 상태를 읽기 전용 확인.
2. 세 migration 적용 후 RPC 권한/존재 확인. 기존 login 2-arg 함수는 rollback window 동안 유지.
3. 새 web bundle과 worker 코드를 함께 배포. Cloudflare에서만 `ARA_TRUST_CLOUDFLARE_CLIENT_IP=true` 사용.
4. 실제 edge에서 trusted IP header, admin login, origin/CSRF, 집계, worker recovery 검증.
5. rollback 준비: 새 함수는 기존 code에 무해하게 남길 수 있다. 기존 login overload 제거는 성공적 cutover 뒤 별도 변경.
6. 이번 변경을 commit/push할 경우 아래 exact dirty artifact를 기준으로 검토하며 사용자 기존 dirty 두 파일은 포함하지 말 것.

## 6. 잔여 한계 / 하지 않은 일

- 운영 migration/deploy/commit/push는 하지 않았다. 사이트가 이미 고쳐졌다고 보지 말 것.
- 기존 잘못된 후보/점수/고착 작업의 운영 데이터 정리, 기존 provider-attempt 결과 추정은 하지 않았다.
- global 80/300 backstop은 분산 공격 시 소진 가능하며 NAT 사용자는 IP bucket을 공유한다. 실제 CF edge/WAF 및 origin-bypass 차단 검증은 별도.
- provider source timestamp가 없으면 unknown/partial로 명시한다. cache가 최근이라고 원본 데이터가 최신임을 보장하지 않는다.
- 구독 OAuth 보류 유지. 실 Jungle Scout/provider API 비용 0.
- CSV bounds, 출시 전체 비용 $3,000 gate, 운영 worker supervision/deployment attestation 등의 별도 후속 강화는 이번 7개 결함 수리와 구분한다.

## 7. Preservation and exact artifact

기존 dirty `apps/web/next-env.d.ts` SHA-256:
`0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc` unchanged.
기존 `프롬프트.md`, untracked historical reports/notes 보존. Staged 0.

Manifest algorithm: 정렬된 각 경로의 raw bytes SHA-256을 `<hash>  <path>\n`으로 연결한 UTF-8 문자열을 다시 SHA-256. Protected next-env와 문서는 제외.

```text
5c7204613db44c773d2f56ed3f28c49de18c877a9df797565c5d7dc861881402  apps/web/app/api/auth/login/route.test.ts
48006e09cc022452ae9565641eacbf50428a1b8da9cda50b0a850b6f2392ca4e  apps/web/app/api/auth/login/route.ts
1d21a63478e2ac72f3e896e7b589316d2816f9fe46313dccfe0abe6b0ecc74c9  apps/web/app/api/imports/route.test.ts
4b2fae523d8517bd0867f538f3b0d6fe8acf352d1ded2df983ee6039d33d4fc9  apps/web/app/api/research-now/route.test.ts
1b4dee53a9351e3a9f43707db774c67b69a54dc6a5c3c4b127ddaea061255566  apps/web/lib/server/dashboard-data-operations.test.ts
89dbfd28fd726f76b6ec9cafb1016d917a6379912f78837abc8d064525698369  apps/web/lib/server/dashboard-data-operations.ts
ee96758e1b1c3dfe5e30479cff47f16c0cc1f589c23f6631001c50844ea3fc81  apps/web/lib/server/login-guard.ts
2b8a1dc3f972f2ac983c0a2f8b89a4c7ad3f92be09227e8f9861125707487191  apps/web/lib/server/provider-auth.test.ts
ab711794c401e04496390864a39572d1af2d02d62173c3609d0b3d8864f4f9e1  apps/web/lib/server/research-now.test.ts
fa5813aab707b8127cfe142e9654cf66a29f7d2c5f90588a3cef9cab394351d6  apps/web/lib/server/research-now.ts
58d033ff52c68d1e4c3ee79b8254741e94857886b9a1426f82225029df258d2f  apps/web/wrangler.jsonc
64f615e0b7178f89805b70ca4317b5aa069c323e53654741628f9771b4c742f8  apps/worker/src/jobs/daily-research.test.ts
5a350360931d064467c958bbf98e6b2b33650505e7d36fc88c670fd242530b70  apps/worker/src/jobs/daily-research.ts
723344bf95119c95278326a9d2bf8eb4fc524f5e0ed6fec805df7d8624a3f902  apps/worker/src/jobs/enrich-strong-potential.integration.test.ts
2cd59e108ebc84e68d08cce483d24e92e05752b9abf915c63e51fdc34b9c360e  apps/worker/src/jobs/enrich-strong-potential.ts
af0a267349557ade2b106b51955fcaad86d155b4304dc109cc894954df7621e4  apps/worker/src/jobs/market-probe.integration.test.ts
6e3f12dde94de805ecffa304d5cb8707576632ce82483bf33915f95929aec154  apps/worker/src/jobs/market-probe.test.ts
a4ab8498fa4eb3b83f3167d13660b036c657a58a7c433d65f0aa47ab74a3edc9  apps/worker/src/jobs/market-probe.ts
a522fe2e6f2a854917f7f2856a6043be61711285f78fdb5a400b73cc19e938b9  apps/worker/src/jobs/milestone-3-pipeline.acceptance.test.ts
7f0dea0098601e19bfd7ac5e34056d5173e4c727ecb10baf4b19d24b0595e1ab  apps/worker/src/jobs/milestone-3.acceptance.test.ts
e80aa5d966f661475618bcd5e3c48ac511faddac28e71b4c629277248032d980  apps/worker/src/main.test.ts
29e67c693290f6029b6f0ff66c97415e544ade0d7c62d70d27855e8dd05a5ce9  apps/worker/src/main.ts
bf0b82217f63f753a1a51d40f6d5fb7f88182706f3467ce6c47b0feb9675d72b  packages/db/package.json
4277356fee09b9cfc25944fd493a6a681663d22af7d72fce6c5f2eb1b3072e3a  packages/db/src/automation-schema.integration.test.ts
8fd67325b930925f9bb426a0861767e946e3b451bcda1a7ca2c140caf772dd70  packages/db/src/core-schema.integration.test.ts
529e5962505141a34e9cd93d199104cf163f64bfda6815139c305944dddc945e  packages/db/src/types.ts
86b24ebe0e7d00041225b97f81dbda42c4a12e598743047b629e83875da272e0  packages/jungle-scout/src/client.test.ts
e210126f25383315deb550266d5a3a20b7205380a4d6b528fed16371e3f0ea9d  packages/jungle-scout/src/client.ts
2df70da7ab829256f98c84ef4f8394cddae840c578ff85fdec26b351443c1f95  packages/jungle-scout/src/product-database.test.ts
eb6a23162b117328c66aea68063b87be4b2663a27787251a1e3b9a1780526aec  packages/queue/src/queue.integration.test.ts
69645f61991bca556a82a87a7020686068965d6608eabe16245d0e7d3b0907f4  packages/queue/src/queue.test.ts
194224ecc780ebfb0c4c4b8a9666b951af943040d0668f00ecc70ef76c38b48a  packages/queue/src/queue.ts
7f46bded977152b2ce397d1334458ff8013fd24ee454e254383b34a5f74725fb  packages/research-engine/src/scoring/market-score.test.ts
0bd100e1dbd0cce282ae6821c39d025b15c1171fcdea4e2ec29b4508d88155cb  packages/research-engine/src/scoring/market-score.ts
16c377bd05e3a403fb3afee991d468493a004277ba2844008e186193629ac0dd  supabase/migrations/20260905024323_queue_authority_recovery.sql
df67c9180475d31120b88d8b3d53e0bbab0ca1be3c9930ca2d52bd81bd9d1b88  supabase/migrations/20260905024517_dashboard_exact_counts.sql
ec52b1b47a73f2668378726be29cb050b0d82edadc6ad5abece63b007018e932  supabase/migrations/20260905024826_login_guard_client_isolation.sql
```

Temporary journal/runtime helper는 검증 증거를 이 보고서로 옮긴 후 제거했고, 두 파일 부재를 확인했다. WSL build stage는 비밀정보 없는 빌드 산출물로 보존하며 운영 배포 아님. 최종 독립 리뷰는 위 37-file manifest 범위 APPROVE이며 운영 승인과 구분한다.
