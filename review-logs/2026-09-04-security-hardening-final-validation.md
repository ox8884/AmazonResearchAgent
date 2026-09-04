# Security hardening final validation

## Verdict

**A for commit `9b7aa18`: CRITICAL 0 / IMPORTANT 0.**

This verdict applies to committed source `9b7aa18`. The hardened web build
has not replaced the existing Cloudflare deployment because the generated
OpenNext Worker exceeds the Cloudflare Free 3 MiB compressed Worker limit.

## Closed boundaries

- Every localized page that reads service-role-backed research data requires an
  active admin session before the data query.
- Admin sessions have a server-side database record. Login persists it before
  setting cookies; logout revokes it before clearing cookies; API and page reads
  reject a missing, expired, or revoked record.
- Malformed percent-encoded cookies fail closed rather than raising a server
  error.
- Provider base URLs reject credentials, query strings, and fragments at both
  save and worker-execution boundaries.
- Pinned provider HTTP forwards AbortSignal while retaining DNS pinning and
  redirect refusal.
- Jungle Scout override URLs require HTTPS except test-only loopback HTTP and
  reject credentials, query strings, fragments, and malformed URLs.
- Import preparation caps selected files at 20 MiB aggregate and reads files
  sequentially.
- Baseline CSP, HSTS, frame, MIME, referrer, and permissions headers apply to
  application responses.
- Windows production worker startup starts from a clean process environment,
  restores only required OS runtime variables, imports only the worker
  allowlist, and forces NODE_ENV=production. The systemd unit also forces
  NODE_ENV=production.

## Verification

- Web focused tests: 6 files, 50 tests passed.
- Worker focused tests: 2 files, 16 tests passed.
- Production launcher contract: 2 tests passed.
- Web and worker typecheck: passed.
- Web and worker lint: passed.
- Next production build: passed; 28 static pages generated.
- Production worker remote queue preflight: passed.
- Remote migration list: `202609040001` present locally and remotely.
- `git diff --check`: no whitespace errors; existing line-ending warnings only.
- Local manual HTTP QA:
  - `/ko/dashboard` without a session -> 307 `/ko/login`.
  - `/api/ai-providers` without a session -> 401.
  - `/ko/showcase` without a session -> 200.
  - CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and
    Permissions-Policy observed.
- Local browser QA: opening `/ko/settings/ai` without a session rendered the
  administrator login screen.
- Fresh independent bypass review of the exact final worktree:
  CRITICAL 0 / IMPORTANT 0.

## Deployment blocker

`pnpm deploy:cloudflare` built successfully and reached Wrangler, then failed
with Cloudflare error 10027. The upload was approximately 3.7 MiB compressed,
above the Free plan's 3 MiB Worker limit. No new Worker version was published.

## Residual risks

- `request.formData()` materializes multipart input before the application-level
  20 MiB aggregate-file check. A platform/body-parser limit is still needed if
  hostile authenticated clients are in scope.
- Encryption-key versioning and an offline re-encryption procedure are not yet
  implemented. Rotate the key only with a migration plan.
- The deployed URL remains on the previous version until the bundle-size/plan
  blocker is resolved.
