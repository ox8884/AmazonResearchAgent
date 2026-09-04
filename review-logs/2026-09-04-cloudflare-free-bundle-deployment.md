# Cloudflare Free 번들 최적화 및 배포

## 결과

- Verdict: A
- Production URL: `https://amazon-research-agent.hyj5317.workers.dev`
- Cloudflare version: `d0a20bef-de53-4e61-85e6-4b698c59193e`
- 압축 업로드 크기: `3717.07 KiB`에서 `2491.67 KiB`로 감소하여 Free Worker의 3 MiB 제한 통과
- 구현 commit: `4cdd642a491bb1d922e9d0ad4896b8e6146b7b4d`

## 변경

- 루트 `/`의 `/ko` 임시 redirect를 Next middleware/proxy에서 `next.config.ts`의 정적 redirect로 이동했다.
- 전용 middleware bundle을 제거해 사용자 동작은 유지하면서 Cloudflare 압축 번들을 줄였다.
- redirect 계약을 `next-config.test.ts`에 추가했다.

## 검증

- `pnpm --filter @ara/web exec vitest run next-config.test.ts`: 2 passed
- `pnpm --filter @ara/web typecheck`: pass
- `pnpm --filter @ara/web lint`: pass
- `pnpm --filter @ara/web build`: pass; middleware/proxy route 없음
- `git diff --check`: whitespace error 없음; 기존 CRLF 변환 warning만 있음
- Cloudflare deploy: 성공, gzip `2491.67 KiB`, startup `32 ms`

## 실서비스 확인

- `/`: `307`, `Location: /ko`
- `/ko/dashboard`: `307`, `Location: /ko/login`
- `/ko/settings/ai`: `307`, `Location: /ko/login`
- `/api/ai-providers`: `401`
- `/ko/showcase`: `200`
- 실제 브라우저에서 `/ko/settings/ai`가 관리자 로그인 화면으로 전환됨을 확인했다.
- 실제 브라우저에서 `/ko/showcase`의 UI primitive 화면이 렌더링됨을 확인했다.
- dashboard redirect 응답에서 CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, camera/microphone/geolocation 차단 Permissions-Policy를 확인했다.

## 제한

- 관리자 비밀번호나 인증정보는 읽거나 출력하지 않았다.
- 실서비스의 인증된 AI Provider 화면 및 실제 Provider 호출은 이번 배포 QA에서 수행하지 않았다. 미인증 차단과 공개 화면만 비용 없이 검증했다.
- 사용자 소유의 기존 dirty/untracked 파일은 수정하거나 stage하지 않았다.
