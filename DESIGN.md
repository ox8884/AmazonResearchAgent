# Amazon Research Agent Design System

## 0. Research Log

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
- Below 64rem: one column; the masthead condenses to two rows — brand + locale on row one, navigation as a **horizontal scroll strip** (no wrap, no hidden items).
- Document owns scrolling. No nested viewport scrollers anywhere, including the provider directory.
- Panels reflow with grid/flex; at 375px rows stack, controls stay full-width, long values break with `overflow-wrap: anywhere`.
- Numbers align to the end with tabular numerals; mobile keeps labels beside values.

## 5. Reusable Primitives

### App shell and navigation
`skip-link`, `masthead` (ink command bar): `wordmark`, `primary-nav` (horizontal strip; pills with `aria-current="page"` and an inverse ink-on-paper active pill), `language-switcher`. Below 64rem the nav becomes an edge-faded horizontal scroll strip; the information structure (6 items + group label) never collapses into an accidental wrap. Locale links preserve the current non-locale path.

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
- Evidence payloads render as bounded, non-secret summaries; raw provider responses and secrets are never rendered.
- The showcase page keeps its exact `동작/상태/지표` heading contract for E2E.
