# Outflow design system

This document defines the reusable UI primitives for Outflow’s vanilla HTML, CSS, and JavaScript pages. Use the `ui-*` classes for structure and keep page-prefixed classes only for genuine page-specific layout or behaviour. Components may be combined with existing `.btn`, `.card`, `.stat-card`, `.list`, and `.modal` classes while older pages are migrated.

## Foundations

### Spacing

The spacing scale is exposed as `--space-1` through `--space-6`: 4, 8, 12, 16, 20, and 24 pixels. Prefer these values for gaps, padding, and margins. Use the smallest value that preserves clear grouping; use 16–24 pixels between distinct sections.

### Shape and elevation

- `--radius-sm` (8px): controls and compact elements.
- `--radius-md` (12px): standard cards.
- `--radius-lg` (16px): prominent cards and empty states.
- `--shadow-card`: subtle elevation for prominent dashboard-style cards.

### Typography

Page titles use `.page-title`/`.ui-page-header__title`. Section titles use `.ui-section-header__title`. Supporting text uses the muted 12px subtitle treatment. Currency uses `.ui-currency`, which enables tabular numerals and safe wrapping. Do not encode hierarchy with colour alone.

### Colour

Use the theme variables `--bg`, `--card`, `--border`, `--accent`, `--text`, `--muted`, `--danger`, and `--success`. Inline colour is acceptable only when it represents user data, such as an account or category colour. Keep text/background contrast suitable for the active theme.

## Components

### Page header

Use `renderPageHeader({ title, subtitle, actions, className, introClass, actionsClass })`. It produces `.ui-page-header`, an intro group, and an optional `.ui-page-header__actions` region.

The header wraps on desktop and gives actions a full row on narrow screens. Titles may wrap at any word boundary. Actions must remain normal buttons or labeled controls so keyboard and accessible names are preserved.

### Section header

Use `renderSectionHeader({ title, subtitle, id, actions })` at the top of cards or sections. It emits `.ui-section-header` with optional actions. When a section has an accessible label, pass its heading `id` and reference it with `aria-labelledby`.

### Action bar

Use `.ui-action-bar` for navigation or primary page controls that belong together. It wraps and distributes its children without fixed widths. On touch layouts, controls should be at least 44px high.

### Filter bar

Use `.ui-filter-bar` around labeled filters and filter chip groups. It is horizontal and compact at larger widths and stacks below 768px. Preserve selected state with the native `selected` attribute or `aria-pressed="true"`.

### Stat card

Combine `.stat-card.ui-stat-card` for standard statistics. Keep a `.label`, `.value`, and optional `.sub` in that order. Values must use `.ui-currency` when monetary.

### Standard card

Combine `.card.ui-card`. The primitive guarantees safe shrinking and text wrapping; the existing `.card` supplies the standard surface, border, radius, and padding. Page classes may adjust padding only when the information density requires it.

### Transaction card

Combine `.list-item.ui-transaction-card`. The default layout reserves a narrow category marker, flexible description content, and a right-aligned amount/action area. Below 768px it becomes a two-column card so descriptions wrap and actions remain visible.

### Summary card

Combine `.stat-card.ui-stat-card.ui-summary-card` for prominent financial summaries. It supplies the larger radius, padding, minimum height, and subtle elevation. At mobile widths its padding and minimum height reduce without changing hierarchy.

### Empty state

Use `renderEmptyState({ title, description, action, icon, className })`. It emits `.ui-empty-state` with icon, title, description, and optional action. The action must explain the next useful step and be keyboard reachable. Do not use an empty state for loading or errors.

### Badge and chip

Use `.badge` for read-only compact status and `.ui-chip` for an interactive selection. Chips use `aria-pressed` and have a 44px touch target below 768px. Badge text must remain understandable without relying on its colour.

### Currency display

Use `renderCurrency(value, className)` or add `.ui-currency` to formatted monetary text. The renderer delegates to the existing `fmt` function, so currency formatting remains centralized and calculations remain numeric.

### Responsive grid

Use `.ui-responsive-grid` for grid mechanics. Add `.ui-responsive-grid--three` for an explicit three-column summary layout or `.ui-responsive-grid--auto` for cards that should repeat from a 180px minimum. Page classes may define intentional breakpoint-specific spans.

### Responsive form

Use `.ui-responsive-form` on the form and `.ui-field` on each label wrapper. The form supplies grid alignment and spacing; the page defines its desktop column proportions. Controls become 44px high below 768px. Keep the label text inside the `.ui-field`.

### Button group

Use `.ui-button-group` for related buttons or selectable chips. It wraps with a 6px gap. Do not use it to merge unrelated primary and destructive actions.

### Modal footer

Use `.ui-modal-footer` for new modal action rows. Existing `.modal-actions` remains compatible while older markup is migrated. Put the primary action last in DOM order, retain visible focus styles, and allow wrapping. Mobile modal footers should remain inside the scrollable modal and safe-area padding.

### Table toolbar

Use `.ui-table-toolbar` above tabular or list data for search, filters, export, and row actions. It wraps with a 16px separation from the data. Each control needs a visible label or accessible name.

### Loading placeholder

Use `.ui-loading-placeholder` with one or more `.ui-loading-placeholder__bar` elements. Add `--wide` to a lead bar. The container should use `role="status"` and `aria-live="polite"` with concise loading text. Animation is disabled when reduced motion is requested.

### Inline validation

Place `.ui-inline-validation` immediately after its control and associate it through `aria-describedby`. Set `aria-invalid="true"` on the invalid control. Validation should state how to fix the value, not merely that it is invalid.

### Status message

Use `.ui-status-message` for page-level information with optional actions. Add `--success` or `--danger` when the semantic state requires it. Use `role="status"` for non-urgent updates and `role="alert"` only when immediate announcement is necessary.

## Responsive and accessibility rules

- Avoid fixed content widths; use `minmax(0, 1fr)`, wrapping flex layouts, and `max-width: 100%`.
- Test at 320, 390, 430, 768, and desktop widths.
- Maintain a logical DOM and tab order when visual columns change.
- Every icon-only button needs an accessible name.
- Preserve native labels for inputs and selects.
- Use `:focus-visible`; never remove focus without a replacement.
- Honour `prefers-reduced-motion`.
- Keep amounts aligned with tabular numerals and allow exceptionally large values to wrap.
- User-data colours may supplement, but never replace, text labels.

## Migration guidance

When modernising another page, add shared primitives first and retain its page class only for unique presentation. Remove the page rule when the equivalent `ui-*` rule supplies every declaration. Do not alter event handling, API calls, calculations, or data shape during a visual migration.
