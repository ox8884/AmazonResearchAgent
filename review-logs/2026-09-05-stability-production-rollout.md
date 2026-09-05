# 안정성 수정 운영 반영

## 계획 / 범위

- Outcome: 검증된 7개 결함 수정을 GitHub, production DB, Cloudflare web, 기존 Windows worker에 반영하고 실제 표면에서 확인.
- Non-goals: 사용자 파일/키/연구 데이터 삭제, DB reset, 과거 후보 재평가, 유료 연구 또는 구독 OAuth 실행, 추가 기능 개발.
- Files: 이전 보고서의 37-file manifest와 검증/배포 보고서. 기존 next-env.d.ts 및 프롬프트.md 제외.
- Proof: migration history와 RPC grants, exact source/commit identity, pinned-runtime build, production browser/HTTP, worker queue 상태 확인.

## 진행

1. Preflight 완료: Git HEAD 374a736322c982b36350d7a6ba68de03ad4bfbd6, origin/main 동일. 운영 migration 29개 일치, 신규 3개만 dry-run 대상.
2. 복구용 public schema/data export 완료. 저장은 저장소 밖 사용자 전용 ACL 디렉터리 `AppData/Local/ARA/release-backups/20260905-stability`. 비밀값/데이터 내용 출력하지 않음. data-only dump에는 raw_opportunity_keywords 순환 FK 경고가 있어 복원 시 trigger/constraint 순서를 고려해야 하며 전체 복원 검증은 아직 없음.
3. 이전 Cloudflare rollback version: b5a13309-2dfd-482b-84d5-151ab9c47007.
4. Worker preflight: Windows 실행기 없음. 운영 queued 0, running 2는 모두 TEST_AI_PROVIDER_CONNECTION, attempts=max_attempts=5, lease 만료. 신규 worker는 재호출 없이 terminalize 대상.
5. Commit/build/migration/deploy/manual QA: 아래 범위 완료. 전체 보안/복원/상시운영 인증과 구분한다.

## 완료된 운영 반영

- `dd83b692cd0d734055553940a1dc1df4c79171da`: login/queue/count DB authority와 직접 회귀검증 23파일.
- `acacda5e5b8facc21edc4ed38f26acaabd4e0712`: 연구 근거·관측시각·HTTP 예산 경계 14파일.
- `ce5c9232d1a2ef7001e055637a58e11b9c863362`: 기존 로컬 검증 보고서. 이 SHA가 배포 소스이며 origin/main push 확인.
- `supabase db push --linked --skip-vault --yes`: 승인된 migration 3개 적용. 이후 dry-run `Remote database is up to date`.
- RPC 5개 signature(기존 login 2-arg 포함)의 `anon=false`, `authenticated=false`, `service_role=true`를 운영 pg_catalog에서 확인.
- Node 24.20.0 Linux 공식 배포 SHA256 검증 후 해당 runtime으로 OpenNext build exit 0. pnpm 11.24.0, Next 16.3.3, OpenNext 1.20.6. 기존 Node 24.14 engine 경고 해소.
- HEAD archive를 WSL stage에 반영해 빌드. Windows publish artifact의 regular files 228개는 WSL 결과와 raw SHA256 일치. intermediate node_modules symlink는 비교 제외하며 publish dry-run 성공.
- `opennextjs-cloudflare deploy --tag stability-ce5c923 --message stability-remediation-ce5c923`: exit 0.
- Cloudflare version `238fc38c-5849-4439-8926-e39a6839ab15`, 100% active. Deployment UTC `2026-09-05T03:43:46.942Z`.
- `/BUILD_ID` HTTP 200: `-Ez_n4lsB69R0_XPz9hYz`.
- 기존 Windows production worker launcher 재기동: PID 25980, `start-production-worker.ps1`의 기존 env allowlist/remote canonical preflight 유지. 이번에 supervisor나 부팅 자동실행을 추가하지 않음.

## 이번 release 턴의 fresh 검증

- `pnpm exec turbo run typecheck lint --force`: 22/22, cache 0, exit 0.
- `pnpm exec turbo run test --filter=@ara/web --filter=@ara/jungle-scout --filter=@ara/research-engine --force`: web 101 + Jungle Scout 29 + research-engine 46 = 176 pass, 0 skip/fail.
- `node --test scripts/start-production-worker.test.mjs`: 2 pass.
- 이전 턴 전체 806 pass/5 platform skip은 이전 검증 기록이다. 이번 턴 전체 suite를 다시 실행한 것으로 합산하지 않는다. 37-file manifest raw hash 재검증 완료, code 변경 없음.
- 새 commit SHA에 대한 별도 independent release review는 이번 턴 수행하지 않았다. 이전 독립 검토의 승인 범위는 로컬 보고서에 명시된 manifest다.

## 실제 운영 관찰

- In-app browser tab 6의 기존 세션 유지. 새 배포에서 `/ko/runs`의 만료된 최종시도 2건이 `실행 중` → `실패`, attempts 5/5 그대로 표시.
- worker 실제 로그 UTC `03:44:21.976`: `Terminalized 2 exhausted expired queue jobs.` 운영 DB도 completed 32 / failed 2 / running 0 / queued 0 일치. provider 재시도나 결과 추정으로 바꾸지 않았다.
- `/ko/dashboard`: 대기 0 / 실행 중 0 / 완료 32, 후보 검토 필요 1. 직접 SQL 집계와 일치.
- 비인증 `/ko/dashboard`: 307 `/ko/login`, private/no-store. 비인증 `/api/ai-providers`: 401. cross-origin login: 401. 동일 origin 잘못된 비밀번호 1회: 401.
- 정상 CF edge 요청으로 새 hashed client bucket 생성 확인. 위조 IP/분산 공격을 운영에서 실행한 것은 아니다.
- 사용자가 로그아웃 후 기존 비밀번호 재로그인 성공을 알렸고, 인앱에서 authenticated AI settings(3 활성/3 등록) 재확인. 서버 latest session 발급 UTC `2026-09-05 03:46:17.847238+00`. 비밀번호를 읽거나 변경하지 않았다.
- API usage는 UTC 03:30 이후 새 행 0. 유료 연구/provider 연결 테스트를 새로 실행하지 않았다.
- 스크린샷 파일을 남겼다고 주장하지 않는다. 실제 CUA AX와 HTTP/DB 결과가 이번 QA 근거다.

## 보존 / 실패 시도 / 한계

- 사용자 기존 dirty는 `apps/web/next-env.d.ts`, `프롬프트.md` 그대로. next-env SHA256 `0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc` 유지. 역사 untracked 문서는 추가 stage하지 않았다.
- PowerShell→WSL PATH quoting 1회 실패 후 고정 Linux PATH로 빌드 성공. Windows Copy-Item은 intermediate Linux node_modules symlink 경고를 냈지만 publish 대상 regular 파일 228개 hash 일치 및 Wrangler dry-run/실배포/운영 검증으로 확인했다.
- 공백 포함 deploy message 전달이 wrapper에서 분리돼 적용 전 실패. 공백 없는 tag/message로 재실행해 성공했다. 미확인 실패를 성공으로 취급하지 않았다.
- 원격 backup export는 public schema/data만이다. auth/storage 전량 disaster-recovery backup 또는 복원 rehearsal이라고 주장하지 않는다.
- worker는 사용자 Windows PC의 실행 프로세스다. PC 종료/재부팅 후 무중단 자동복구를 이번 작업이 보장하지 않는다. Cloudflare 웹과 worker 실행 수명은 별개다.
- 최종 만료 작업 2건은 실패 상태로 보존했고 삭제하지 않았다. 과거 후보/평가 자료를 소급 수정하지 않았다.
- 배포 rollback은 이전 Cloudflare version 사용 가능, 기존 login overload 유지. DB를 reset하거나 additive migration을 역삭제하지 말 것. worker rollback 필요 시 이전 source release와 대기 작업을 먼저 확인할 것.

## 후속 정정: Oracle 운영 실행기

이 보고서의 Windows 실행기 설명은 Oracle 확인이 누락된 당시 상태 기록이다.
실제로 Oracle에는 이전 release worker와 daily timer가 이미 enabled/active였다.
후속 작업에서 Windows 중복 실행기를 종료하고 Oracle만 최신 release로 전환했다.
현재 실행 위치와 재시작 검증은 [Oracle production correction](2026-09-05-oracle-worker-production-correction.md)을 따른다.
