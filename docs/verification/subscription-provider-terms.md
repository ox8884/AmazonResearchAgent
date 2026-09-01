# Subscription provider terms and supported-automation gate

- Gate: Design §29 Gate 1
- Access date: 2026-09-01
- Scope: local evidence-and-contract decision only. No provider login, request, subscription consumption, Oracle action, activation, Ready issuance, or routing occurred.
- Canonical evidence record SHA-256: `900da500b6fc1c43b2d4dbcddf8b5a7b16209c0aeb4ce799c52d7695dbdea51c`

## Decision matrix

| Adapter | Tier/product eligibility | Supported client and authentication | Noninteractive/headless automation | Terms/policy reconciliation | Decision |
| --- | --- | --- | --- | --- | --- |
| Codex | PASS — Codex is included across ChatGPT plans. | PASS — the OpenAI Help article lists Codex CLI and says to sign in with a ChatGPT account; the CLI guide describes `codex exec`. | PASS for CLI scripting only — the CLI guide says `codex exec` can be used in repeatable workflows and pipelines. | FAIL — no cited first-party source authorizes this project’s dedicated service-identity/headless **subscription** workflow. The consumer Terms additionally prohibit automatically or programmatically extracting Output. | **FAIL — insufficient/ambiguous Gate 1 evidence; disabled and unroutable.** |
| Grok | PASS — the xAI announcement says Grok Build is available to SuperGrok and X Premium Plus subscribers. | PASS for the announced subscriber client — install and “sign in with your account.” | PASS for CLI capability only — the announcement says `-p` headless mode runs agents in scripts and automations. | FAIL — no cited first-party source authorizes this project’s dedicated service-identity subscription workflow. The AUP prohibits access through “unauthorized automated or non-human means”; no written authorization resolves that condition. | **FAIL — insufficient/ambiguous Gate 1 evidence; disabled and unroutable.** |

A CLI’s script or headless capability is not evidence that a subscription may be used by this project’s dedicated service identity. Per the Gate 1 rule, ambiguity is FAIL. Neither row creates an approved production terms digest, version, or profile binding.

## Codex evidence

1. [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan/) — publisher: OpenAI Help Center; page title: *Using Codex with your ChatGPT plan*; updated: “2 days ago” as displayed; accessed 2026-09-01.
   - Tier: “Codex is included across ChatGPT plans, including Free and Go.”
   - Client/authentication: lists “Codex CLI” and directs the user to “Sign in with your ChatGPT account.”
   - Terms: says ChatGPT Terms of Use apply when signing in with an existing ChatGPT account.
2. [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) — publisher: OpenAI; page title: *Codex CLI*; version/date not published; accessed 2026-09-01.
   - Client identity: documents the terminal Codex CLI and its ChatGPT sign-in flow.
   - Automation: “Use Codex interactively or call `codex exec` from repeatable workflows and pipelines.”
3. [Terms of Use](https://openai.com/policies/row-terms-of-use/) — publisher: OpenAI; page title: *Terms of Use*; effective 2026-01-01; accessed 2026-09-01.
   - Applies to individual Services including ChatGPT and associated software applications.
   - Conflict: the prohibited-use list includes “Automatically or programmatically extract data or Output.”

**Codex result:** FAIL. The CLI and plan evidence establish ordinary account use and scripting capability, not explicit permission for a dedicated service-identity/headless subscription workflow. The unqualified programmatic-output restriction is a conflicting term for the intended automated worker output path.

## Grok evidence

1. [Introducing Grok Build](https://x.ai/news/grok-build-cli) — publisher: xAI; page title: *Introducing Grok Build*; published 2026-05-25; accessed 2026-09-01.
   - Tier: “Available now to all SuperGrok and X Premium Plus subscribers.”
   - Client/authentication: provides the Grok Build installer and says to “sign in with your account.”
   - Automation: “Headless mode (`-p`) allows easily running agents inside scripts and automations.”
2. [Terms of Service - Consumer](https://x.ai/legal/terms-of-service) — publisher: SpaceXAI; page title: *Terms of Service - Consumer*; effective 2026-08-24; accessed 2026-09-01.
   - Applies to individual Grok services, including associated tools and software; Enterprise Terms govern developer and business use.
   - Account boundary: account credentials may not be shared or made available to anyone else.
   - No cited provision expressly authorizes the required dedicated service-identity subscription workflow.
3. [Acceptable Use Policy](https://x.ai/legal/acceptable-use-policy) — publisher: SpaceXAI; page title: *Acceptable Use Policy*; effective 2026-08-14; accessed 2026-09-01.
   - Applies to consumers, developers, and businesses.
   - Conflict: prohibits “Accessing the Services through unauthorized automated or non-human means, whether through a bot, script, or otherwise.” No written product confirmation was obtained to establish that this workflow is authorized.

**Grok result:** FAIL. The announcement establishes subscriber CLI headless capability, not authorization for this dedicated service-identity subscription use; the AUP makes its authorization status material and unresolved.

## Canonical evidence record

The following UTF-8, LF-terminated record is the sole preimage for the digest above. It deliberately records only public source metadata and conclusions; it contains no account, credential, cookie, token, or authorization-page data.

```text
schema-version: 1
access-date: 2026-09-01
adapter: codex
decision: FAIL
failure: The official CLI documentation supports ChatGPT-account CLI sign-in and noninteractive scripting, but it does not expressly authorize the required dedicated service-identity/headless subscription workflow; the consumer terms prohibit automatically or programmatically extracting Output.
sources:
- https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan/ | Using Codex with your ChatGPT plan | OpenAI Help Center | Updated: 2 days ago
- https://learn.chatgpt.com/docs/codex/cli | Codex CLI | OpenAI | Version/date not published
- https://openai.com/policies/row-terms-of-use/ | Terms of Use | OpenAI | Effective: 2026-01-01
adapter: grok
decision: FAIL
failure: The official announcement supports SuperGrok/X Premium Plus access and -p headless mode, but no first-party source authorizes the required dedicated service-identity subscription workflow; the AUP prohibits access through unauthorized automated or non-human means, and no written authorization was obtained.
sources:
- https://x.ai/news/grok-build-cli | Introducing Grok Build | xAI | Published: 2026-05-25
- https://x.ai/legal/terms-of-service | Terms of Service - Consumer | SpaceXAI | Effective: 2026-08-24
- https://x.ai/legal/acceptable-use-policy | Acceptable Use Policy | SpaceXAI | Effective: 2026-08-14
```

## Local contract and runtime state

- `ApprovedProviderTermsEvidence` requires the adapter, canonical evidence digest, version, and reference before any readiness/acceptance inspection starts. The inspection’s `termsDigest` must exactly match that record’s digest; missing, cross-adapter, malformed, or mismatched evidence throws `ProviderTermsEvidenceRequiredError` before persistence or Ready. A future resolver may supply one only after a new independently reviewed Gate 1 PASS.
- No approved production evidence exists for either adapter. `subscription-profiles.ts` remains unchanged: Codex is `activation: 'disabled'`; Grok is `activation: 'disabled'` with `clientAcceptance: 'setup_required'`.
- The worker’s production probe resolver remains a fail-closed `ProviderSetupRequiredError`, so no profile can become Ready or routable from this change.

## Remaining boundary

Gate 2, Gate 3, Task 18, Oracle access, service authentication, provider calls, provider activation, Ready issuance, PAYG, migration, and production deployment remain out of scope and unperformed. A future PASS requires new first-party evidence or written product confirmation that expressly covers the exact service-identity/headless subscription workflow; it must be independently reviewed before an adapter-specific disabled manifest can bind its digest.
