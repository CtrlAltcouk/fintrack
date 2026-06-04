# Outflow Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the app from "FinTrack" to "Outflow" across all current files, replace the emoji logo with the circle icon SVG in the sidebar and login screen, add an SVG favicon, and bump the version to 2.0.0.

**Architecture:** Pure find-and-replace plus new SVG asset. The circle icon is inlined directly in HTML/JS template strings (no external image request). A standalone `public/favicon.svg` serves the browser tab icon. No schema changes, no new routes, no cookie/DB renames.

**Tech Stack:** Vanilla HTML/JS, SVG, Node.js/Express

**DO NOT change:** `fintrack_session` cookie name, `fintrack.db` filename, `pm2 restart fintrack` deploy command, GitHub repo URLs.

---

## File Map

| File | Change |
|------|--------|
| `public/favicon.svg` | **New.** Circle icon for browser tab |
| `public/index.html` | Title, favicon `<link>`, sidebar logo element |
| `public/app.js` | Login logo ×2, "Who's using Outflow?", settings About label |
| `package.json` | `name` → `outflow`, `version` → `2.0.0` |
| `server.js` | Startup console log |
| `README.md` | Title only (`# FinTrack` → `# Outflow`) |
| `HANDOFF.md` | Title, description, version |

---

## Shared SVG geometry (reference — do not change)

The circle icon used everywhere is extracted from `Logo/outflow_logo_wave.svg`:

```
viewBox: "72 112 116 116"   ← square crop of the circle (cx=130 cy=170 r=58)
Circle:  cx="130" cy="170" r="58" fill="#f8a4a2"
Wave fill area:  M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168 L 188 228 L 72 228 Z   fill="white" opacity="0.35"
Wave main line:  M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168   stroke="white" stroke-width="6" stroke-linecap="round"
Wave trail:      M 72 205 Q 95 188 115 200 Q 135 214 158 196 Q 172 184 188 190   stroke="white" stroke-width="3.5" opacity="0.6" stroke-linecap="round"
```

---

## Task 1: Create `public/favicon.svg`

**Files:**
- Create: `public/favicon.svg`

- [ ] **Step 1: Create the file**

Write `public/favicon.svg` with this exact content:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="72 112 116 116">
  <circle cx="130" cy="170" r="58" fill="#f8a4a2"/>
  <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168 L 188 228 L 72 228 Z" fill="white" opacity="0.35"/>
  <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M 72 205 Q 95 188 115 200 Q 135 214 158 196 Q 172 184 188 190" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
</svg>
```

- [ ] **Step 2: Commit**

```bash
git add public/favicon.svg
git commit -m "feat: add Outflow circle favicon"
```

---

## Task 2: Update `public/index.html`

**Files:**
- Modify: `public/index.html`

Three changes: page title, favicon `<link>`, sidebar logo.

- [ ] **Step 1: Update title and add favicon link**

Find:
```html
  <title>FinTrack</title>
  <link rel="stylesheet" href="style.css">
```

Replace with:
```html
  <title>Outflow</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css">
```

- [ ] **Step 2: Replace sidebar logo**

Find:
```html
    <div class="logo">💰 FinTrack</div>
```

Replace with:
```html
    <div class="logo" style="display:flex;align-items:center;gap:8px">
      <svg width="28" height="28" viewBox="72 112 116 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="130" cy="170" r="58" fill="#f8a4a2"/>
        <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168 L 188 228 L 72 228 Z" fill="white" opacity="0.35"/>
        <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M 72 205 Q 95 188 115 200 Q 135 214 158 196 Q 172 184 188 190" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
      </svg>
      <span style="font-size:16px;font-weight:600;color:#faf9f5;letter-spacing:-0.3px">Outflow</span>
    </div>
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: update index.html — Outflow title, favicon, sidebar logo"
```

---

## Task 3: Update `public/app.js`

**Files:**
- Modify: `public/app.js`

Four changes: login logo on first-run screen, login logo on user-picker screen, "Who's using" text, settings About label.

- [ ] **Step 1: Replace first-run login logo (line ~1924)**

Find:
```js
        <div class="login-logo">💰 FinTrack</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;text-align:center">Create your admin account to get started.</p>
```

Replace with:
```js
        <div class="login-logo" style="display:flex;align-items:center;gap:10px">
          <svg width="36" height="36" viewBox="72 112 116 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="130" cy="170" r="58" fill="#f8a4a2"/>
            <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168 L 188 228 L 72 228 Z" fill="white" opacity="0.35"/>
            <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M 72 205 Q 95 188 115 200 Q 135 214 158 196 Q 172 184 188 190" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
          </svg>
          <div>
            <div style="font-size:20px;font-weight:600;color:#faf9f5;letter-spacing:-0.3px">Outflow</div>
            <div style="font-size:12px;color:var(--muted)">personal finance tracker</div>
          </div>
        </div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;text-align:center">Create your admin account to get started.</p>
```

- [ ] **Step 2: Replace user-picker login logo and "Who's using" text (line ~1952)**

Find:
```js
        <div class="login-logo">💰 FinTrack</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;text-align:center">Who's using FinTrack?</p>
```

Replace with:
```js
        <div class="login-logo" style="display:flex;align-items:center;gap:10px">
          <svg width="36" height="36" viewBox="72 112 116 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="130" cy="170" r="58" fill="#f8a4a2"/>
            <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168 L 188 228 L 72 228 Z" fill="white" opacity="0.35"/>
            <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M 72 205 Q 95 188 115 200 Q 135 214 158 196 Q 172 184 188 190" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
          </svg>
          <div>
            <div style="font-size:20px;font-weight:600;color:#faf9f5;letter-spacing:-0.3px">Outflow</div>
            <div style="font-size:12px;color:var(--muted)">personal finance tracker</div>
          </div>
        </div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;text-align:center">Who's using Outflow?</p>
```

- [ ] **Step 3: Update settings About label (line ~1585)**

Find:
```js
        FinTrack v${version.version}<br>
```

Replace with:
```js
        Outflow v${version.version}<br>
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: update app.js — Outflow login logos, who's using, about label"
```

---

## Task 4: Update `package.json` and `server.js`

**Files:**
- Modify: `package.json`
- Modify: `server.js`

- [ ] **Step 1: Update `package.json`**

Find:
```json
  "name": "fintrack",
  "version": "1.7.0",
```

Replace with:
```json
  "name": "outflow",
  "version": "2.0.0",
```

- [ ] **Step 2: Update `server.js` startup log**

Find:
```js
app.listen(PORT, () => console.log(`FinTrack running on http://localhost:${PORT}`));
```

Replace with:
```js
app.listen(PORT, () => console.log(`Outflow running on http://localhost:${PORT}`));
```

- [ ] **Step 3: Commit**

```bash
git add package.json server.js
git commit -m "chore: rename package to outflow, bump version to 2.0.0"
```

---

## Task 5: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README title**

Find:
```markdown
# FinTrack
```

Replace with:
```markdown
# Outflow
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rename FinTrack to Outflow in README"
```

---

## Task 6: Update `HANDOFF.md` and push

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update HANDOFF title**

Find:
```markdown
# FinTrack — AI Handoff Document
```

Replace with:
```markdown
# Outflow — AI Handoff Document
```

- [ ] **Step 2: Update project description**

Find:
```markdown
**FinTrack** is a self-hosted personal finance web app running on a Proxmox LXC container.
```

Replace with:
```markdown
**Outflow** is a self-hosted personal finance web app running on a Proxmox LXC container.
```

- [ ] **Step 3: Update current version**

Find:
```markdown
**Current version:** `1.7.0`
```

Replace with:
```markdown
**Current version:** `2.0.0`
```

- [ ] **Step 4: Add rebrand entry to Core features list**

Find:
```markdown
- **Daily Spending pay period mode** — spending page respects the global pay period toggle; ◀ Period ▶ nav replaces month nav when active (v1.7.0)
```

Replace with:
```markdown
- **Daily Spending pay period mode** — spending page respects the global pay period toggle; ◀ Period ▶ nav replaces month nav when active (v1.7.0)
- **Outflow rebrand** — renamed from FinTrack; circle SVG logo in sidebar and login; SVG favicon; version 2.0.0
```

- [ ] **Step 5: Replace Current Progress section**

Read `HANDOFF.md` first. Find the entire `## Current Progress — Last Session` section — everything from that heading up to (but not including) `## Active Work-in-Progress` — and replace it with:

```markdown
## Current Progress — Last Session (2026-06-04)

### Outflow Rebrand (v2.0.0)

Full rename from FinTrack to Outflow. Circle SVG icon (dusty-rose with white wave) replaces the emoji in the sidebar and login screen. SVG favicon added. Internal names left unchanged: `fintrack_session` cookie, `fintrack.db` database file, pm2 process name, GitHub repo URLs.

| Area | What changed |
|------|-------------|
| `public/favicon.svg` | New — circle icon SVG for browser tab |
| `public/index.html` | Title → Outflow, favicon link, sidebar logo |
| `public/app.js` | Login logos ×2, "Who's using Outflow?", About label |
| `package.json` | name → outflow, version → 2.0.0 |
| `server.js` | Startup log → "Outflow running on..." |
| `README.md` | Title updated |

---

```

- [ ] **Step 6: Commit HANDOFF**

```bash
git add HANDOFF.md
git commit -m "docs: update HANDOFF for Outflow rebrand v2.0.0"
```

- [ ] **Step 8: Push to GitHub**

```bash
git push origin main
```

Expected: `main -> main` confirmed in output.
