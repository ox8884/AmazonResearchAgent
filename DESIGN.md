# Amazon Research Agent Design System

## 0. Research Log
- Direction: **Evidence Ledger** — a research notebook meets an operations desk.
- Evidence: the current shell has no active location, the dashboard repeats nine equal cards, and detail pages hide payloads behind raw identifiers.
- Decision: organize every surface around **evidence → decision → action**; use a restrained rail, ledger rows, semantic status labels, and one clear action per context.
- Adaptation: retain a warm, Korean-safe light canvas for long review sessions, then add ink chrome and shallow elevation so panels have hierarchy without glass or gradients.
- Non-goals: no new product workflow, API route, provider fallback, storage format, or business rule.

## 1. Atmosphere & Identity
The product should feel like a dependable research control room: quiet, exact, and operational. The visual spine is a **decision rail**—a 3px inline-start marker paired with a visible text badge on every candidate, run, import, or provider state. Color supports the label; it never replaces it.

The shell uses a compact ink rail at desktop and a wrapping top bar on smaller screens. The content canvas remains warm and calm. Evidence is shown near the decision it explains; actions sit next to the state that makes them safe to use.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--canvas` | `#F4F3EE` | Document background |
| Canvas deep | `--canvas-deep` | `#EAE9E3` | Rail and table headers |
| Surface | `--surface` | `#FFFFFF` | Raised panels, inputs |
| Surface muted | `--surface-muted` | `#F1F0EB` | Inset rows and disabled areas |
| Ink | `--ink` | `#191C1A` | Primary text and primary controls |
| Ink muted | `--ink-muted` | `#555956` | Supporting text; must remain readable |
| Ink quiet | `--ink-quiet` | `#6B706B` | Metadata only, never essential instructions |
| Border | `--border` | `#D5D5CE` | Structural rules |
| Border strong | `--border-strong` | `#A9ADA5` | Emphasis and control borders |
| Accent | `--accent` | `#23517D` | Links, focus, active navigation, processing |
| Accent hover | `--accent-hover` | `#173B5D` | Accent hover and active |
| Accent surface | `--accent-surface` | `#E8EFF5` | Informational state background |
| Strong | `--strong` | `#256044` | Accepted/strong outcome |
| Strong surface | `--strong-surface` | `#E7F1EA` | Strong outcome background |
| Watch | `--watch` | `#835615` | Watch, waiting, attention |
| Watch surface | `--watch-surface` | `#F7EEDB` | Watch/waiting background |
| Reject | `--reject` | `#963B36` | Reject and failure |
| Reject surface | `--reject-surface` | `#F8E8E5` | Reject/failure background |
| Rail ink | `--rail-ink` | `#F4F3EE` | Text on the ink rail |
| Rail muted | `--rail-muted` | `#B8C0BA` | Supporting rail text |

Rules: hue is semantic or interactive only; primary buttons use ink, not a decorative gradient. No gradients, transparency effects, or color-only state indicators. Raw hex values live only in this document and `apps/web/app/globals.css`.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
|---|---:|---:|---:|---|
| Display | `clamp(2rem, 4vw, 3.5rem)` | 700 | 1.05 | Lead number or exceptional page title |
| H1 | `clamp(1.75rem, 3vw, 2.5rem)` | 700 | 1.15 | Page title |
| H2 | 1.35rem | 680 | 1.25 | Section title |
| H3 | 1.05rem | 680 | 1.35 | Panel title |
| Body | 1rem | 400 | 1.6 | Main text |
| Small | .875rem | 400 | 1.5 | Supporting text |
| Label | .75rem | 700 | 1.35 | Controls, table headings, eyebrow |
| Meta | .75rem | 500 | 1.4 | IDs and timestamps |

Primary stack: `Segoe UI Variable`, `Apple SD Gothic Neo`, `Noto Sans KR`, `system-ui`, sans-serif. Mono stack: `Cascadia Code`, `SFMono-Regular`, monospace. Headings use `letter-spacing: -.02em`; prose uses `overflow-wrap:anywhere` and a readable measure. Numeric values and IDs use `font-variant-numeric: tabular-nums`.

## 4. Density & Layout
Base unit: 4px. Keep the existing `--space-*` scale and add only tokens required by the shell. Default page gutters use `clamp(16px, 4vw, 48px)`. The main content is capped at 72rem; prose blocks are capped near 44rem.

- Desktop (`min-width: 64rem`): 16rem command rail + flexible document column.
- Below 64rem: one document column; the rail becomes a top navigation bar whose links wrap rather than forcing horizontal page scroll.
- The document owns scrolling. No primary or nested navigation scroller; `.provider-list` is intrinsic content and never uses a `100vh` max-height.
- Panels use grid/flex reflow, not minimum widths that create overflow. At 375px, rows become stacked, controls stay full-width where needed, and long IDs/reasons break safely.
- Data columns align numbers to the end and use tabular numerals. Mobile keeps labels visible beside values.

## 5. Reusable Primitives

### App shell and navigation
`skip-link`, `app-shell`, `app-rail`, `wordmark`, `primary-nav`, and `language-switcher`. Navigation items expose an active visual marker and `aria-current="page"`; locale links preserve the current non-locale path. States: active, hover, focus, narrow wrapped layout.

### Page header
`page-heading` contains an eyebrow, one H1, purpose copy, and at most one primary action. Secondary links remain visually subordinate. No page hides its main action below the fold when the action is available.

### Stat lede and operational band
`stat-lede` gives one dominant value context; `stat-row` holds compact companions with ruled separators; `meter` pairs a labelled progress bar with used/limit/reserve values. This replaces repeated identical metric-card walls.

### Ledger row
`ledger`, `ledger__head`, and `ledger__row` provide table-like alignment for candidates, runs, and imports. Rows carry a state rail and visible status badge. Empty, loading, error, long-content, and populated states are explicit.

### Status badge and decision marker
`status-badge` always includes a localized text label. Tones: neutral, accent/active, waiting/watch, strong, reject, and attention. Unknown backend values fall back to a neutral visible label rather than crashing.

### Provider directory and editor
`provider-admin` contains a stable provider directory, one active editor, and one connection-result region per saved provider. Directory entries retain `aria-pressed`; the provider name remains adjacent to the edit action for stable accessible names. The directory has document flow and no nested viewport scroller.

The editor preserves product selection, enabled state, role assignment, billing method, priority, network scope, save, disable, connection test, and result attribution. Results are scoped to the provider whose Test action was pressed. Secrets remain write-only and display only as `••••{secretLast4}`.

### Form field, notice, and empty state
Every control has an explicit label, help text where needed, visible focus, and native validation semantics. `notice` distinguishes alert/status/success states. `empty-state` explains what is absent and the next available action without inventing data.

## 6. Accessibility & Interaction
- WCAG 2.2 AA target: essential body text >= 4.5:1, large text >= 3:1, and focus rings remain visible against every surface.
- Status is never conveyed by hue alone; labels, icons/markers, or text context remain present.
- Interactive targets are at least 44px high where practical. No icon-only action; hand-authored inline SVG must have a text alternative.
- Keyboard order follows evidence → decision → action. `aria-live="polite"` is limited to asynchronous save/test/upload feedback; failures use `role="alert"`.
- Korean and English copy must wrap naturally and must not clip at 375/768/1280px.
- Motion is limited to save, test, upload, error, and panel-state feedback. No scroll choreography. All motion is disabled or reduced under `prefers-reduced-motion`.

## 7. Surface Strategy
Three layers only: canvas (recessed), panel (raised), and inset (sunken). Panels use a 1px border plus a restrained shadow token; controls use a border and focus ring. Radius is 8px for controls and 12px for panels. Avoid cards inside cards: use ruled sections and whitespace for grouping.

## 8. Accepted Debt
- Settings remains read-only because no settings mutation contract is in scope; the UI must say so rather than imply editability.
- Existing API/server data contracts and provider authorization flows remain unchanged.
- Evidence payloads are rendered as bounded, non-secret summaries; raw provider responses and secrets are never rendered.
