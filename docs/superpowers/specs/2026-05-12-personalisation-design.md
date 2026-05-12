# Personalisation Tab — Design Spec

**Date:** 2026-05-12  
**Version:** FinTrack v1.6.0 (target)  
**Status:** Approved

---

## Overview

Add a **Personalisation** tab to the Settings page that lets each user customise the appearance of their FinTrack portal. Settings are stored per user in the existing `settings` table and applied instantly on change without a save button. The default theme remains dark mode with black background and pink accent (`#f7a4a2`).

---

## Requirements

1. New **Personalisation** tab appears in the Settings tab bar (visible to all users, not admin-only).
2. **Mode toggle** — a pill switcher between Dark and Light. Each mode has its own default colour set.
3. **Accent colour picker** — preset swatches + a custom OS colour picker. Controls `--accent` CSS variable.
4. **Background colour picker** — preset swatches + a custom OS colour picker. Controls `--bg` CSS variable (card/border colours derive naturally from this).
5. **Reset to defaults** button — restores dark mode, `--accent: #f7a4a2`, `--bg: #111111`.
6. Changes apply **instantly** (CSS vars updated on `document.documentElement` immediately).
7. Preferences saved per user in the `settings` table under key `"theme"`.
8. Theme is loaded and applied on every page load (after login), before the first render.

---

## Theme Defaults

### Dark mode (default)
| Variable | Value |
|----------|-------|
| `--bg` | `#111111` |
| `--card` | `#1a1a1a` |
| `--border` | `#2a2a2a` |
| `--accent` | `#f7a4a2` |
| `--text` | `#ffffff` |
| `--muted` | `#888888` |

### Light mode (warm rose)
| Variable | Value |
|----------|-------|
| `--bg` | `#f0e8f0` |
| `--card` | `#ffffff` |
| `--border` | `#d9c8d9` |
| `--accent` | `#c45c5a` |
| `--text` | `#111111` |
| `--muted` | `#666666` |

---

## Data Model

No schema changes required. Theme is stored in the existing `settings` table:

```
user_id | key     | value (JSON)
--------|---------|----------------------------------------------
42      | "theme" | {"mode":"dark","accent":"#f7a4a2","bg":"#111111"}
```

The `accent` and `bg` fields store the user's explicit picks (which may equal the mode default). When a row for `"theme"` does not exist, the dark defaults are used.

---

## API

### `GET /api/settings/theme`
- Auth: required (`requireAuth`)
- Response: `{ mode, accent, bg }` — returns stored values or dark defaults if no row exists

### `POST /api/settings/theme`
- Auth: required
- Body: `{ mode, accent, bg }` (all optional — missing fields keep current values)
- Validation: `mode` must be `"dark"` or `"light"`; `accent` and `bg` must be valid 6-digit hex strings (`#rrggbb`)
- Upserts into `settings` table using existing `stmtUpsert` pattern

---

## Frontend

### Theme application (`applyTheme(theme)`)

A helper function called on page load and on every user change:

```
dark defaults   ← base layer
light overrides ← applied if mode === 'light' (replaces all 6 vars)
accent / bg     ← user's custom picks, always applied last
```

Sets variables directly on `document.documentElement.style.setProperty(...)`.

### Theme loading flow
1. After `doLogin()` / `init()` resolves the current user, call `GET /api/settings/theme`
2. Call `applyTheme(result)` before rendering any page
3. Store result in a module-level `currentTheme` variable

### Personalisation tab (`pages.settings('personalisation')`)

Three UI sections inside a `.card`:

**Appearance section**
- Label: "Mode"
- A two-button pill: `Dark` | `Light`
- Active mode is highlighted with `--accent` colour
- On click: update `currentTheme.mode`, derive the mode's default accent/bg, merge with any saved custom picks, call `applyTheme()`, call `PATCH /api/settings/theme`

**Colours section**
- **Accent colour** row — label + description + 6 preset swatches + rainbow custom swatch
  - Preset swatches: `#f7a4a2`, `#4a9eff`, `#a8d8a8`, `#ffd700`, `#c39bd3`, `#ff8c42`, `#76d7c4`
  - Custom swatch: rainbow circle, clicking opens a hidden `<input type="color">` via `.click()`
  - Selected swatch has a white border ring
- **Background colour** row — same pattern
  - Dark bg presets: `#111111`, `#1a1a2e`, `#0d1117`, `#1a0a2e`, `#0a1a0a`, `#1a0a0a`
  - Custom swatch available

**Reset section**
- "Reset to defaults" button (ghost style, right-aligned)
- Resets to `{ mode: 'dark', accent: '#f7a4a2', bg: '#111111' }`, applies immediately, saves

### Mode toggle behaviour
When the user switches mode:
- Apply the new mode's full default colour set (including accent)
- This replaces any custom accent/bg picks visually
- The new accent/bg are saved as the mode's defaults (not the user's previous custom picks)
- Rationale: switching mode should give a coherent look; users can re-customise after

### Tab registration
- Add `'personalisation'` to the labels map in `pages.settings`
- Add `tab('personalisation')` to the tab bar render (after `categories`, before `updates`) — visible to all users

### `invalidateTheme()` / logout
- On logout or user switch, call `applyTheme(DARK_DEFAULTS)` to reset to defaults before the next user's theme loads

---

## CSS changes

No new CSS variables needed. The existing 6 variables (`--bg`, `--card`, `--border`, `--accent`, `--text`, `--muted`) already drive the entire UI. Light mode works by overwriting all 6 on `document.documentElement.style`.

One addition to `style.css`: a `.swatch` utility class for the colour option circles, and a `.swatch.selected` ring style. (Small — ~10 lines.)

---

## Files changed

| File | Change |
|------|--------|
| `routes/settings.js` | Add `GET` and `POST /theme` endpoints |
| `public/app.js` | `applyTheme()`, `loadTheme()`, `currentTheme` var, personalisation tab HTML + event wiring |
| `public/style.css` | `.swatch` + `.swatch.selected` classes (~10 lines) |
| `tests/` | No new test file needed — existing `settings.test.js` covers the `stmtUpsert` pattern; theme endpoint follows the same contract |

---

## Out of scope

- Customising `--card`, `--border`, `--text`, `--muted` individually (can be added later)
- Per-page theme overrides
- Theme export / import
- Admin-defined theme presets
