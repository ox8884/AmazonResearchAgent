# Amazon Research Agent Design System

## 0. Research Log

### Product experience rebuild (2026-09-02, decision-desk pass)

Prompt: `session-prompts/2026-09-02-product-experience-rebuild-prompt.md`. Previous passes fixed tokens and per-surface structure, but the app still reads as a well-made internal tool because each page is an isolated, rhythmically identical composition: page title → wide margin → same-size panels → row list. Three root causes:

1. **No screen owns the decision grammar.** The shell announces six destinations of equal weight; nothing shows where the operator stands in `발견 → 판단 → 실행 → 운영`. Navigation is a link list, not a workflow spine.
2. **Equal-weight section rhythm.** Every surface composes the same: heading, inset panel, hairline rows, a chip per value. Dashboard sections compete as peers; candidates read as rows not comparable objects; runs/imports read as tables not provenance; AI Settings reads as a polished form, not the capability view that feeds the desk.
3. **Data has no written voice.** Numbers are styled, but screens never narrate recorded state (what deserves attention, what is missing, what the next move is) in editorial type; after the briefing sentence the page falls back to admin cadence.

Directions considered:

1. **"Desk sections"** (cosmetic rework) — keep the shell, restyle each page with more asymmetric proportion and larger numerals. Rejected: repeats the anti-reference — prettier admin pages, still six disconnected surfaces.
2. **"Decision desk" (chosen)** — one product grammar `decision object → evidence → confidence gap → next action`, expressed differently per surface, plus a **workflow spine** in the shell: nav items grouped by the phase of the research loop they serve (판단 = dashboard/candidates, 실행·운영 = runs/imports/settings + AI settings), the active phase marked in the masthead, and each surface's role changing its density and rhythm:
   - **Dashboard** = the desk's front page: one focal decision (a review call backed by reason, confidence gap, and the next action in one reading flow), then pipeline signal and provenance strip at subordinate weight.
   - **Candidates** = comparison ledger: each row a compact research object (keyword, judgment phase, confidence state, score, next action) with verdict-first column order.
   - **Candidate detail** = review brief: verdict question first, core signals, evidence, then what is missing — not a metadata wall.
   - **Runs / Imports** = provenance traces: freshness and origin of the data behind judgments; date-led with perceived hierarchy between status/time/source/count; no badge-per-value.
   - **AI Settings** = capability fleet console preserved (directory, workspace, scoped results) but rebalanced to read as the desk's engine: fleet summary as the opening read, identity/role/connection before technical meta.

**Choice: Decision desk.** Material and colour roles stay Ink & Signal (paper, ink, rules, one cobalt signal — no gradients, glass, or dark-SaaS regression); the reset comes from the workflow spine, editorial narration of recorded state, and per-surface rhythm. No new dependencies.

Conservation: all routes, data derivation (recorded state counts, scores, budget record only), provider semantics, auth/locale routing, and E2E contracts (`지금 리서치`, import flow, showcase headings, provider result scoping, masked keys) unchanged.

### Direction reset (2026-09-02, visual direction reset pass)

The information architecture now follows `signal → evidence → confidence → decision → action` (previous passes), but the surfaces still read as a safe admin dashboard: dark left rail, warm canvas, stacked identical white cards, thin borders, small badges. This pass resets the aesthetic direction itself. Two directions were considered:

1. **"Signal Terminal"** — a dark graphite operator console: near-black surfaces, phosphor data in mono, amber/green status readouts. Rejected as the primary direction: it keeps the product inside the generic dark-SaaS gravity well, works against long Korean review sessions, and the current shell is already dark-chromed, so it would read as a re-tint rather than a reset.

2. **"Ink & Signal" (chosen)** — an analyst's printed desk: a deep **ink masthead** across the top (the only dark chrome, and it is horizontal, not a rail), a **cool paper** work surface (not warm beige), **ruled ledgers instead of floating cards** (column hairlines, 2px ink scotch rules above section titles), and **instrument-scale numerals** for the data that decisions depend on. One cobalt signal color carries interaction and the single primary action; decision colors (good/hold/stop) appear only on semantic state. Depth comes from type scale, rules, and surface steps — never from shadows, gradients, or glass.

**Choice: Ink & Signal.** It keeps light-surface Korean readability for long sessions while making the product read as an analyst-grade intelligence workspace: the briefing is set like a headline, the decision queue reads like a ruled ledger sheet, and the AI provider area reads like an operator console.

- Adaptation: system font stacks stay (Korean-safe, dependency-free); the reset is achieved with palette, shell structure, rules, scale, and rhythm — no new UI dependencies.
- Non-goals: no new product workflow, API route, provider fallback, storage format, or business rule. Backend semantics unchanged.

### Earlier log (retained for context)
- Direction: **Evidence Ledger** — a research notebook meets an operations desk; surfaces follow `evidence → decision → action`.
- Dashboard second pass (2026-09-02): dashboard leads with a data-derived briefing header, a decision queue hero, a compact pipeline pulse, and one lightweight evidence strip; briefing sentences, ordering, and alerts may only be derived from recorded candidate states, scores, and counts.

## 1. Atmosphere & Identity
An **intelligence desk**: quiet, exact, editorial. The top **ink masthead** carries navigation as a horizontal command strip; the work surface below is cool paper organized by ruled sections. Hierarchy is typographic first: headlines for briefings, instrument-scale tabular numerals for the numbers decisions depend on, quiet mono for identifiers, small bold labels for metadata. Color is rationed: cobalt `signal` marks interaction and the one primary action; `good`/`hold`/`stop` appear only on decision state; everything else is ink on paper.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Paper | `--paper` | `#F6F6F2` | Document canvas (neutral, cool) |
| Paper deep | `--paper-deep` | `#EDEEE8` | Inset surfaces, masthead pill hover |
| Surface | `--surface` | `#FFFFFF` | Panels, inputs |
| Ink | `--ink` | `#151A22` | Primary text, scotch rules, ink controls |
| Ink muted | `--ink-muted` | `#4E555F` | Supporting text |
| Ink quiet | `--ink-quiet` | `#6F7680` | Metadata only |
| Line | `--line` | `#DBDCD5` | Hairline rules, row separators |
| Line strong | `--line-strong` | `#A7ABAC` | Control borders, column rules |
| Signal | `--signal` | `#1F4FC0` | Links, focus, active nav, primary action, progress fill |
| Signal hover | `--signal-hover` | `#16389A` | Hover/active |
| Signal surface | `--signal-surface` | `#E9EEFB` | Informational state background |
| Good | `--good` / `--good-surface` | `#1E6E4A` / `#E4F1E9` | Accepted/strong outcome |
| Hold | `--hold` / `--hold-surface` | `#8A5A10` / `#F6EDDA` | Waiting/watch/attention |
| Stop | `--stop` / `--stop-surface` | `#A03A32` / `#F8E9E6` | Reject/failure |
| Masthead | `--masthead` | `#10151D` | Top command bar background |
| Masthead ink | `--masthead-ink` | `#F3F4F1` | Text on the masthead |
| Masthead muted | `--masthead-muted` | `#A8B0BD` | Secondary masthead text |
| Focus ring | `--ring` | `rgb(31 79 192 / 30%)` | Focus outlines |

Rules: hue is semantic or interactive only. No gradients, no glass/blur, no neon, no decorative charts or sparkles. State is never color-only; every chip carries a text label. Raw hex values live only in this document and `apps/web/app/globals.css`.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
|---|---:|---:|---:|---|
| Display | `clamp(1.9rem, 3.2vw, 2.75rem)` | 740 | 1.08 | Briefing headline only |
| Instrument numeral | `1.6rem+`, tabular | 700 | 1.1 | Scores, counts that drive decisions |
| Title (H1) | `clamp(1.3rem, 2vw, 1.55rem)` | 740 | 1.2 | Page titles (compact; data gets the scale) |
| Section (H2) | 1rem | 750 | 1.3 | Section titles under a 2px ink scotch rule |
| Sub (H3) | .9rem | 750 | 1.35 | Group titles inside forms/panels |
| Body | 1rem | 400 | 1.6 | Main text |
| Small | .875rem | 400 | 1.5 | Supporting text |
| Label | .75rem | 700 | 1.35 | Controls, table headings |
| Meta | .75rem | 500 | 1.4 | IDs, timestamps, reasons — mono stack |

Primary stack: `Segoe UI Variable`, `Apple SD Gothic Neo`, `Noto Sans KR`, `system-ui`, sans-serif. Mono stack: `Cascadia Code`, `SFMono-Regular`, monospace — reserved for identifiers, codes, and technical values only; never decorative. Headings track `-0.02em`; display tracks `-0.03em`. All counters use `font-variant-numeric: tabular-nums`. Metadata is differentiated from decisions by weight, spacing, placement, and mono — not by size alone.

## 4. Density & Layout
Base unit: 4px; the `--space-*` scale is kept. Page gutters `clamp(16px, 4vw, 40px)`. Main content is capped at **82rem** so wide viewports are used well; narrow forms stay near 52rem.

- Desktop (≥64rem): single-column document under the masthead; dashboard splits into queue (fluid) + 21rem aside.
- Below 64rem: one column; brand and locale precede navigation groups that wrap as intact units. All six destinations remain visible without horizontal scrolling.
- Document owns scrolling. No nested viewport scrollers anywhere, including the provider directory.
- Panels reflow with grid/flex; at 375px rows stack, controls stay full-width, long values break with `overflow-wrap: anywhere`.
- Numbers align to the end with tabular numerals; mobile keeps labels beside values.

## 5. Reusable Primitives

### App shell and navigation
`skip-link`, `masthead` (ink command bar): `wordmark`, `primary-nav` (pills with `aria-current="page"` and an inverse ink-on-paper active pill), `language-switcher`. Below 64rem whole workflow groups wrap, keeping all six destinations visible. The current page is also named above the navigation. Locale links preserve the current non-locale path. Read-only settings label/value rows stack below 48rem so long timezone values remain readable.

### Page header
`page-heading` holds one compact H1 and purpose copy; at most one primary action sits with it. The dashboard replaces it with the `briefing` primitive (below). No page hides its main action below the fold.

### Briefing (dashboard)
`briefing`: a data-as-of meta line, the briefing sentence set in **Display** type under a 3px signal rule, purpose copy, and the action row — one primary (Research Now), one secondary (New import), and the reserved-budget variant as a quiet ghost with its confirm intact. Briefing text derives only from recorded candidate-state counts; pending/queued/error states are explicit.

### Scotch rule and sections
`.section-heading` opens with a **2px ink rule** (scotch rule) above the section title — the editorial device that replaces floating-card repetition. Panels group with rules and spacing, never cards-in-cards.

### Ledgers (candidates, runs, imports, decision queue)
`ledger` / `queue-row` rows align on a shared grid with **column rules** (1px `--line-strong` vertical hairlines between data zones). Rows carry a 3px state-toned decision rail plus a labeled status chip. Scores render as instrument numerals. Every queue row exposes keyword link, state chip, recorded rationale (or an explicit hollow `hold`-tone "no recorded rationale" tag — repetition there reads as a data-trust warning, not an empty page), score, and one explicit `Open candidate` action. Queue order (review-needed first, then preliminary score) is stated in the UI and uses only recorded data. Empty states name the next action.

### Status chip
`status` chips are labeled rectangles (radius 6) with tinted surface, 1px semantic border, and the small marker dot. Tones: neutral, signal/active, hold/waiting, good, stop. Unknown backend values fall back to a neutral visible label.

### Buttons
Primary = signal cobalt fill (one per context), secondary = paper fill with strong line, ghost = text-only muted (guarded variants such as reserved-budget). Pending state disables and swaps copy; success/error use `role="status"`/`role="alert"` notices.

### Pipeline pulse and evidence strip
`pulse` (inset) lists pipeline stages as text label + count, the conditional review-needed alert in hold tone, job counts, and the budget as a quiet detail that becomes a stop-toned alert only when it actually blocks waiting candidates. Supporting evidence is limited to the three most recent imports in an inset strip; no UUIDs on the dashboard.

### Provider console (AI Settings)
`provider-admin` = directory (inset) + editor. Directory entries keep `aria-pressed`, accessible `"{name} 수정"` names, and stay in document flow. The editor groups fields in **setup order and risk**: Provider identity → Capability and role → Routing and priority → Secure connection. Connection results stay scoped to the provider whose Test action was pressed (`section.provider-result`), secrets stay write-only (`••••{secretLast4}`), and subscription products expose only safe status/Test/Disable. Provider names, products, roles, and connection state — not internal UUIDs — are the readable surface.

### Form field, notice, and empty state
Every control has an explicit label, help text where needed, visible signal focus ring, and native validation semantics. `notice` distinguishes error/status/success. `empty-state` is an inset sheet with the reason and the next possible action — never bare whitespace.

## 6. Accessibility & Interaction
- WCAG 2.2 AA: essential text ≥ 4.5:1, large text ≥ 3:1; the cobalt signal on white and on `--signal-surface` meets AA for its uses; focus rings (3px `--ring`) stay visible on every surface.
- Status is never hue-only; chips always carry labels.
- Interactive targets ≥ 44px where practical. No icon-only actions; no emoji glyphs in UI.
- Keyboard order follows reading order: masthead → briefing/actions → queue → aside. `aria-live="polite"` limited to async save/test/upload feedback; failures use `role="alert"`.
- Korean and English copy must wrap naturally without clipping at 375/768/1280 (`word-break: keep-all` + `overflow-wrap`).
- Motion is limited to save/test/upload/state feedback with short `ease-out` transitions; everything collapses under `prefers-reduced-motion`.

## 7. Surface Strategy
Three steps only: paper (recessed), panel (white, 1px hairline, **no shadow**), inset (paper-deep). Radius scale is documented, not mixed: panels 12, controls/buttons/inputs 8, chips/badges 6. Grouping is done with scotch rules, column rules, and spacing rather than stacked boxes.

## 8. Accepted Debt
- Settings remains read-only because no settings mutation contract is in scope; the UI says so rather than implying editability.
- Existing API/server data contracts and provider authorization flows remain unchanged.
- Evidence payloads render as bounded, non-secret research summaries; raw provider responses and secrets are never rendered. Recognized research fields may be expanded under technical disclosures, never mixed into the missing-evidence section.
- The showcase page keeps its exact `동작/상태/지표` heading contract for E2E.

## 9. Evidence display contract (2026-09-04 correction)

- Dashboard, candidate list and detail use the same candidate-bound evidence projection. Rule-filter reasons are not collection or completeness evidence.
- Read failures and capped reads have distinct labels; neither may claim evidence is absent or complete.
- Detail reading order is review brief, demand/competition, economics, next checks, then source records and score provenance. Imported preliminary scores and later analysis totals remain separate.
- Existing panel, evidence-list and disclosure primitives are reused for this data-correctness pass. The requested full visual redesign remains a separate representative-design approval step.
- Technical research JSON uses the existing metadata type and spacing tokens, wrapping long values inside its parent without a second scroll viewport. Never show authentication material or unrecognized arbitrary payload fields.

## 10. Representative redesign: research desk (2026-09-04, awaiting direction approval)

This section supersedes the layout for the dashboard and candidate detail only. Other surfaces and shell expansion await the representative-screen review requested in the UX report. Existing color and type tokens are retained for this prototype; this is a structural comparison, not a completed brand redesign.

- Persona: Korean-speaking solo researcher checking whether a candidate merits more work, often on a narrow screen. First read: candidate → known market signals → missing costs → open evidence. Neither score nor completed scheduling implies GO.
- Dashboard: compact title/action toolbar, single candidate dossier with paired search/analysis readings, evidence summary, explicit next check. Supporting operations occupy a narrow right column at ≥64rem rather than another equal-width card. The full candidate collection remains available below.
- Detail: one review band; a main market-evidence column and a cost/next-check aside. Source disclosures remain full-width below. Each source names observed/estimated, confidence and period. Absent economics remain text, not zero-value charts.
- Primitives: `desk-toolbar` (wrapping title/actions), `desk-columns` (fluid main plus 20rem aside), `desk-readings` (two real metrics with labels and explanatory units), `desk-review` (review text plus score), `desk-sheet` (white dossier surface using panel tokens). All collapse in DOM reading order below 64rem. Document is the only vertical scroll owner.
- Existing tokens used: surface/paper-deep/line/signal/hold; type-title/section/supporting/instrument-lg; space-2/3/4/5/6/8; radius-control/panel. No new palette, dependency, font download, or decorative illustration. Numeric units and evidence provenance outweigh visual symmetry.
- Required state checks: unavailable/none/partial/missing-required/reviewable/truncated, keyboard link and disclosure focus, readable KO/EN at 375/768/1280. Evidence capture must not trigger research, test providers, upload files or mutate DB.
- This prototype does not claim Lighthouse or final visual-review approval. User direction approval precedes extending the new layout to other screens.
