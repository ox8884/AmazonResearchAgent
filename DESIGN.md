# Amazon Research Agent Design System

## 0. Research Log
- Embedded refs: shortlisted Linear, Notion, Sentry → picked Minimalist + Linear because a personal research dashboard needs precise hierarchy without enterprise chrome.
- Lazyweb: skipped — product implementation is local-only and no shipped-product browser research was required for this approved milestone.
- Concept drafts: skipped — no image-generation lane is available in the current coding runtime; the primitive showcase is the visual contract.
- Adaptation: Linear's precision and scarce accent are translated to a warm light canvas for long Korean/English research sessions.

## 1. Atmosphere & Identity
A quiet evidence desk: calm enough for daily review, dense enough to expose why a candidate passed or failed. The signature is the evidence rule—a thin blue marker beside the current decision, with every score and rejection reason kept visually close to its source.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--canvas` | `#F7F6F2` | Page background |
| Surface | `--surface` | `#FFFFFF` | Cards, inputs, header |
| Surface muted | `--surface-muted` | `#F0EFEB` | Secondary rows, disabled areas |
| Ink | `--ink` | `#20211F` | Primary text |
| Ink muted | `--ink-muted` | `#696B66` | Supporting text |
| Ink quiet | `--ink-quiet` | `#94968F` | Metadata |
| Border | `--border` | `#DDDCD6` | Structural outlines |
| Border strong | `--border-strong` | `#B9BBB3` | Focused outlines |
| Accent | `--accent` | `#315C82` | Primary actions, links, focus |
| Accent hover | `--accent-hover` | `#244866` | Hover/active |
| Strong | `--strong` | `#276749` | Strong/accepted evidence |
| Strong surface | `--strong-surface` | `#E8F2EC` | Strong status background |
| Watch | `--watch` | `#8A5A18` | Watch/pending evidence |
| Watch surface | `--watch-surface` | `#F7EEDB` | Watch/queued background |
| Reject | `--reject` | `#9B3A34` | Reject/error evidence |
| Reject surface | `--reject-surface` | `#F8E8E6` | Reject/error background |

Rules: accent is interactive only. Status colors are semantic only. Raw hex values live only in this document and `globals.css` token declarations.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
|---|---:|---:|---:|---|
| H1 | 32px | 650 | 1.2 | Page title |
| H2 | 24px | 620 | 1.3 | Section title |
| H3 | 18px | 620 | 1.4 | Card title |
| Body | 16px | 400 | 1.6 | Main text |
| Body small | 14px | 400 | 1.5 | Supporting text |
| Label | 13px | 600 | 1.4 | Controls, table labels |
| Meta | 12px | 520 | 1.4 | Timestamps, counts |

Primary: `Segoe UI Variable`, `Apple SD Gothic Neo`, `Noto Sans KR`, system sans-serif. Mono: `Cascadia Code`, `SFMono-Regular`, monospace. Headings use tight `-0.02em` tracking; body remains neutral.

## 4. Spacing & Layout
Base unit: 4px. Tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px, `--space-16` 64px.

- Max content width: 1180px; page gutters `clamp(16px, 4vw, 48px)`.
- Header stays at the top with document scroll; no nested primary scrollbar.
- Summary and candidate grids use `repeat(auto-fit, minmax(min(16rem, 100%), 1fr))`.
- At 375px all controls and data rows reflow to one readable column without horizontal page scroll.

## 5. Components

### App Shell
- Structure: root layout → fixed-height header/navigation → document-scrolling main.
- States: active locale/navigation, narrow wrapping navigation.
- Accessibility: landmarks, skip link, visible focus.
- Layout: sticky-header + content-limiter; document owns scroll.

### Action Button
- Variants: primary dark-accent, secondary surface.
- States: default, hover, active, focus-visible, disabled, loading.
- Accessibility: 44px minimum touch target, semantic button/link.
- Motion: 120ms opacity/transform only.

### Status Badge
- Variants: queued/Watch, processing/accent, completed/Strong, failed/Reject.
- States: static semantic label; never color-only.
- Accessibility: text label remains visible.

### Metric Card
- Structure: label, numeric value, optional supporting line.
- States: value, zero/empty.
- Layout: intrinsic card grid; no internal scroll.

### Import Form
- Structure: labelled multi-file input, help text, selected-file list, submit/status region.
- States: idle, selected, uploading, queued, validation error, server error.
- Accessibility: explicit label, `aria-live` status, keyboard-native file input.

### Data List
- Structure: semantic list/table-like rows with keyword, score/state, reasons.
- States: populated, empty, long keyword, long reason.
- Layout: rows reflow from columns to stack; `overflow-wrap:anywhere`.

## 6. Motion & Interaction
- Micro: 120ms ease-out for button active/hover via opacity/transform.
- Standard: 200ms ease-in-out for status/background changes.
- No scroll animation in Milestone 1; research work should feel stable.
- `prefers-reduced-motion` disables transforms and transitions.

## 7. Depth & Surface
Strategy: borders-only. Cards and fields use `1px solid var(--border)`; focused controls use accent outline. No box shadows, gradients, glass, or nested card stacks. Radius: 6px controls, 10px cards.

## 8. Accessibility Constraints & Accepted Debt
- WCAG 2.2 AA; body contrast >= 4.5:1, large text >= 3:1.
- Every interactive element has visible `:focus-visible` treatment.
- Korean and English labels fit without clipping at 375/768/1280px.
- Status is never conveyed by color alone.
- Accepted debt: none.
