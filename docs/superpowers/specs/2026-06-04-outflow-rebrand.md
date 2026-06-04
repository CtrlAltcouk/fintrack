# Outflow Rebrand Design Spec

**Date:** 2026-06-04  
**Status:** Approved  
**Version target:** 2.0.0

---

## Goal

Rename the app from "FinTrack" to "Outflow" across all current files. Replace the emoji logo with the new circle icon (dusty-rose circle with white wave) in the sidebar and login screen. Add an SVG favicon. Bump version to 2.0.0.

---

## What Does NOT Change

- `fintrack_session` — cookie name (invisible to users; renaming forces logout and risks data)
- `fintrack.db` — database filename (renaming requires manual `mv` on the LXC server and risks data loss)
- `pm2 restart fintrack` — deploy command in HANDOFF (pm2 process name on the server; must be changed on the LXC separately, not in code)
- GitHub repo URLs (`github.com/CtrlAltcouk/fintrack`) — repo not being renamed
- `docs/superpowers/` plan and spec files — archived historical documents, never served

---

## Favicon — `public/favicon.svg` (new file)

Extract the circle icon from the logo as a standalone SVG:
- Viewbox scoped to the circle: `0 0 116 116`
- Dusty-rose circle fill: `#f8a4a2`
- White wave path (main line, stroke-width 6, opacity 1)
- White wave fill area (opacity 0.35)
- White trailing wave (stroke-width 3.5, opacity 0.6)

Add to `public/index.html` `<head>`:
```html
<link rel="icon" href="favicon.svg" type="image/svg+xml">
```

---

## Sidebar Logo — `public/index.html`

Replace:
```html
<div class="logo">💰 FinTrack</div>
```

With a flex row: 28px circle SVG icon inline + "Outflow" text. The circle SVG is inlined directly (no external image request). Use the same circle geometry as the favicon.

---

## Login Screen Logo — `public/app.js`

Both login screen instances (first-run setup and user picker) currently render:
```html
<div class="login-logo">💰 FinTrack</div>
```

Replace with: 36px circle SVG icon + "Outflow" text (larger than sidebar) + "personal finance tracker" subtitle line below.

Change the user picker prompt:
```
Who's using FinTrack?  →  Who's using Outflow?
```

---

## Settings About section — `public/app.js`

Change:
```
FinTrack v${version.version}
```
to:
```
Outflow v${version.version}
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `public/favicon.svg` | **New.** Circle icon SVG for browser tab |
| `public/index.html` | Page title, favicon link, sidebar logo element |
| `public/app.js` | Login logos (×2), "Who's using" text, settings About label |
| `package.json` | `name`: `fintrack` → `outflow`; `version`: `1.7.0` → `2.0.0` |
| `server.js` | Startup console log: `FinTrack running` → `Outflow running` |
| `README.md` | Title and all "FinTrack" text references → "Outflow" |
| `HANDOFF.md` | Title, project description, version → 2.0.0 |

---

## Circle Icon SVG Geometry

Used inline in sidebar (28px rendered), login screen (36px rendered), and as favicon.

Source coordinates from `Logo/outflow_logo_wave.svg`:
- Circle: `cx="130" cy="170" r="58"` fill `#f8a4a2`
- Wave fill area: `M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168 L 188 228 L 72 228 Z` white opacity 0.35
- Main wave: `M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168` white stroke-width 6 round caps
- Trailing wave: `M 72 205 Q 95 188 115 200 Q 135 214 158 196 Q 172 184 188 190` white stroke-width 3.5 opacity 0.6

Favicon viewBox: `"72 112 116 116"` (circle centred at 130,170 with r=58, padded to square).

---

## Testing

1. Browser tab shows the dusty-rose circle favicon
2. Sidebar shows circle icon + "Outflow" (no emoji)
3. Login screen (first-run and user-picker) shows circle icon + "Outflow" + subtitle
4. User picker prompt reads "Who's using Outflow?"
5. Settings → About reads "Outflow v2.0.0"
6. Page title in browser tab reads "Outflow"
7. No regressions — all existing pages, navigation, and data load correctly
8. `package.json` version is `2.0.0`
