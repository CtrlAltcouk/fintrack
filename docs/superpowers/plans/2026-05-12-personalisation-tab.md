# Personalisation Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Personalisation tab to Settings that lets each user customise their accent colour, background colour, and dark/light mode — saved per user in the `settings` table.

**Architecture:** CSS custom properties are set directly on `document.documentElement.style` via an `applyTheme()` helper. Theme is stored as `{ mode, accent, bg }` JSON in the existing `settings` table under key `"theme"`. A `GET/POST /api/settings/theme` endpoint handles persistence. Changes apply instantly with no save button.

**Tech Stack:** Node.js/Express, better-sqlite3, vanilla JS, CSS custom properties

---

## File Map

| File | Change |
|------|--------|
| `routes/settings.js` | Add `parseTheme()` helper (exported), `GET /theme`, `POST /theme` |
| `public/style.css` | Add `.swatch`, `.swatch.selected`, `.swatch-custom` (~12 lines) |
| `public/app.js` | Add theme constants, `applyTheme()`, `loadTheme()`, wire into `init()`/`doLogin()`/`logout()`, add Personalisation tab HTML and event handlers |
| `tests/theme.test.js` | New test file for `parseTheme()` pure function |

---

## Task 1: Theme API — `parseTheme` helper + tests

**Files:**
- Modify: `routes/settings.js`
- Create: `tests/theme.test.js`

- [ ] **Step 1: Write the failing test file**

Create `tests/theme.test.js`:

```js
// tests/theme.test.js
const assert = require('assert');
// _parseTheme will be exported in the next step
const { _parseTheme } = require('../routes/settings');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

test('returns dark defaults for invalid JSON', () => {
  const r = _parseTheme('not-json');
  assert.strictEqual(r.mode,   'dark');
  assert.strictEqual(r.accent, '#f7a4a2');
  assert.strictEqual(r.bg,     '#111111');
});

test('returns dark defaults when mode is missing', () => {
  const r = _parseTheme('{"accent":"#f7a4a2","bg":"#111111"}');
  assert.strictEqual(r.mode, 'dark');
});

test('returns dark defaults for invalid mode value', () => {
  const r = _parseTheme('{"mode":"purple","accent":"#f7a4a2","bg":"#111111"}');
  assert.strictEqual(r.mode, 'dark');
});

test('parses valid dark theme', () => {
  const r = _parseTheme('{"mode":"dark","accent":"#4a9eff","bg":"#0d1117"}');
  assert.strictEqual(r.mode,   'dark');
  assert.strictEqual(r.accent, '#4a9eff');
  assert.strictEqual(r.bg,     '#0d1117');
});

test('parses valid light theme', () => {
  const r = _parseTheme('{"mode":"light","accent":"#c45c5a","bg":"#f0e8f0"}');
  assert.strictEqual(r.mode,   'light');
  assert.strictEqual(r.accent, '#c45c5a');
  assert.strictEqual(r.bg,     '#f0e8f0');
});

test('falls back accent to dark default when hex invalid', () => {
  const r = _parseTheme('{"mode":"dark","accent":"red","bg":"#111111"}');
  assert.strictEqual(r.accent, '#f7a4a2');
});

test('falls back accent to light default when hex invalid', () => {
  const r = _parseTheme('{"mode":"light","accent":"bad","bg":"#f0e8f0"}');
  assert.strictEqual(r.accent, '#c45c5a');
});

test('falls back bg to dark default when hex invalid', () => {
  const r = _parseTheme('{"mode":"dark","accent":"#f7a4a2","bg":"black"}');
  assert.strictEqual(r.bg, '#111111');
});

test('falls back bg to light default when hex invalid', () => {
  const r = _parseTheme('{"mode":"light","accent":"#c45c5a","bg":"white"}');
  assert.strictEqual(r.bg, '#f0e8f0');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node tests/theme.test.js
```

Expected: `Error: _parseTheme is not a function` or similar — `_parseTheme` is not yet exported.

- [ ] **Step 3: Add `parseTheme` to `routes/settings.js`**

Add these lines immediately after the `stmtUpsert` declaration (after line 22) and before the `_migrate` function:

```js
const DARK_THEME_DEFAULTS  = { mode: 'dark',  accent: '#f7a4a2', bg: '#111111' };
const LIGHT_THEME_DEFAULTS = { mode: 'light', accent: '#c45c5a', bg: '#f0e8f0' };
const HEX_RE = /^#[0-9a-f]{6}$/i;

function parseTheme(raw) {
  let t;
  try { t = JSON.parse(raw); } catch { return { ...DARK_THEME_DEFAULTS }; }
  if (!['dark', 'light'].includes(t?.mode)) return { ...DARK_THEME_DEFAULTS };
  const defs = t.mode === 'dark' ? DARK_THEME_DEFAULTS : LIGHT_THEME_DEFAULTS;
  return {
    mode:   t.mode,
    accent: HEX_RE.test(t.accent) ? t.accent : defs.accent,
    bg:     HEX_RE.test(t.bg)     ? t.bg     : defs.bg,
  };
}
```

At the bottom of the file, add `_parseTheme` to the exports (after `module.exports._migrate = _migrate;`):

```js
module.exports._parseTheme = parseTheme;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node tests/theme.test.js
```

Expected:
```
  ✓ returns dark defaults for invalid JSON
  ✓ returns dark defaults when mode is missing
  ✓ returns dark defaults for invalid mode value
  ✓ parses valid dark theme
  ✓ parses valid light theme
  ✓ falls back accent to dark default when hex invalid
  ✓ falls back accent to light default when hex invalid
  ✓ falls back bg to dark default when hex invalid
  ✓ falls back bg to light default when hex invalid

9 passed, 0 failed
```

- [ ] **Step 5: Confirm existing tests still pass**

```bash
node tests/settings.test.js && node tests/auth.test.js && node tests/db-migration.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add routes/settings.js tests/theme.test.js
git commit -m "feat: add parseTheme helper with tests"
```

---

## Task 2: Theme API — GET and POST endpoints

**Files:**
- Modify: `routes/settings.js`

- [ ] **Step 1: Add the endpoints to `routes/settings.js`**

Add immediately before `module.exports = router;`:

```js
// GET /api/settings/theme
router.get('/theme', (req, res) => {
  const row = stmtGet.get(req.userId, 'theme');
  if (!row) return res.json({ ...DARK_THEME_DEFAULTS });
  res.json(parseTheme(row.value));
});

// POST /api/settings/theme
router.post('/theme', (req, res) => {
  const { mode, accent, bg } = req.body;
  if (mode !== undefined && !['dark', 'light'].includes(mode))
    return res.status(400).json({ error: 'mode must be "dark" or "light"' });
  if (accent !== undefined && !HEX_RE.test(accent))
    return res.status(400).json({ error: 'accent must be a valid hex colour (#rrggbb)' });
  if (bg !== undefined && !HEX_RE.test(bg))
    return res.status(400).json({ error: 'bg must be a valid hex colour (#rrggbb)' });

  const row = stmtGet.get(req.userId, 'theme');
  const current = row ? parseTheme(row.value) : { ...DARK_THEME_DEFAULTS };
  const updated = {
    mode:   mode   ?? current.mode,
    accent: accent ?? current.accent,
    bg:     bg     ?? current.bg,
  };
  stmtUpsert.run(req.userId, 'theme', JSON.stringify(updated));
  res.json({ ok: true });
});
```

- [ ] **Step 2: Start the dev server and verify endpoints manually**

```bash
npm run dev
```

In a separate terminal (or browser DevTools console after logging in), test:

```bash
# GET — should return dark defaults the first time
curl -s -b "fintrack_session=<your-token>" http://localhost:3000/api/settings/theme

# POST — save a custom theme
curl -s -X POST -b "fintrack_session=<your-token>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"dark","accent":"#4a9eff","bg":"#111111"}' \
  http://localhost:3000/api/settings/theme

# GET again — should return the saved values
curl -s -b "fintrack_session=<your-token>" http://localhost:3000/api/settings/theme
```

Expected GET responses: `{"mode":"dark","accent":"#f7a4a2","bg":"#111111"}` then `{"mode":"dark","accent":"#4a9eff","bg":"#111111"}`.

Expected POST response: `{"ok":true}`.

- [ ] **Step 3: Commit**

```bash
git add routes/settings.js
git commit -m "feat: add GET/POST /api/settings/theme endpoints"
```

---

## Task 3: CSS swatch styles

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add swatch classes to `style.css`**

Append at the end of `public/style.css`:

```css
/* ── Colour swatches (Personalisation tab) ───────────────────────────────── */
.swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.15s;
}
.swatch:hover   { border-color: var(--muted); }
.swatch.selected { border-color: var(--text); }
.swatch-custom  { background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); }
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: add swatch CSS classes for personalisation tab"
```

---

## Task 4: Frontend theme engine

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add theme constants and `applyTheme` / `loadTheme` after line 36**

After `function invalidateAccounts() { _accounts = []; }` (line 36), insert:

```js
// ── Theme ─────────────────────────────────────────────────────────────────
const DARK_DEFAULTS  = { mode: 'dark',  accent: '#f7a4a2', bg: '#111111' };
const LIGHT_DEFAULTS = { mode: 'light', accent: '#c45c5a', bg: '#f0e8f0' };
const DARK_VARS  = { '--card': '#1a1a1a', '--border': '#2a2a2a', '--text': '#ffffff', '--muted': '#888888' };
const LIGHT_VARS = { '--card': '#ffffff', '--border': '#d9c8d9', '--text': '#111111', '--muted': '#666666' };

let currentTheme = { ...DARK_DEFAULTS };

function applyTheme(theme) {
  const vars = theme.mode === 'light' ? LIGHT_VARS : DARK_VARS;
  for (const [k, v] of Object.entries(vars)) {
    document.documentElement.style.setProperty(k, v);
  }
  document.documentElement.style.setProperty('--accent', theme.accent);
  document.documentElement.style.setProperty('--bg', theme.bg);
  currentTheme = { ...theme };
}

async function loadTheme() {
  const t = await api('/settings/theme').catch(() => ({ ...DARK_DEFAULTS }));
  if (t) applyTheme(t);
}
```

- [ ] **Step 2: Wire `loadTheme()` into `doLogin()` (line ~1687)**

In `doLogin`, add `await loadTheme();` before `navigate('dashboard')`:

Find this block:
```js
  currentUser = r;
  document.getElementById('login-overlay').style.display = 'none';
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = r.colour;
  document.getElementById('user-pill-avatar').textContent = r.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = r.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  navigate('dashboard');
```

Replace with:
```js
  currentUser = r;
  document.getElementById('login-overlay').style.display = 'none';
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = r.colour;
  document.getElementById('user-pill-avatar').textContent = r.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = r.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  await loadTheme();
  navigate('dashboard');
```

- [ ] **Step 3: Wire `loadTheme()` into `init()` (line ~1587)**

In `init`, add `await loadTheme();` before `navigate('dashboard')`:

Find this block:
```js
  currentUser = me;
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = me.colour;
  document.getElementById('user-pill-avatar').textContent = me.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = me.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  navigate('dashboard');
```

Replace with:
```js
  currentUser = me;
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = me.colour;
  document.getElementById('user-pill-avatar').textContent = me.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = me.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  await loadTheme();
  navigate('dashboard');
```

- [ ] **Step 4: Wire `applyTheme(DARK_DEFAULTS)` into `logout()` (line ~1600)**

In `logout`, add `applyTheme({ ...DARK_DEFAULTS });` after `currentUser = null;`:

Find:
```js
  await fetch('/api/auth/logout', { method: 'POST' });
  invalidateAccounts();
  invalidateCategories();
  currentUser = null;
  document.getElementById('user-pill').style.display = 'none';
  showLogin();
```

Replace with:
```js
  await fetch('/api/auth/logout', { method: 'POST' });
  invalidateAccounts();
  invalidateCategories();
  currentUser = null;
  applyTheme({ ...DARK_DEFAULTS });
  document.getElementById('user-pill').style.display = 'none';
  showLogin();
```

- [ ] **Step 5: Manual verification**

With the dev server running, log in and open DevTools console. Run:

```js
applyTheme({ mode: 'light', accent: '#c45c5a', bg: '#f0e8f0' })
```

Expected: the entire UI switches to a light warm-rose theme instantly. Run:

```js
applyTheme({ ...DARK_DEFAULTS })
```

Expected: reverts to black/pink dark theme.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: add theme engine (applyTheme, loadTheme) and wire into login/logout"
```

---

## Task 5: Personalisation tab UI and event handlers

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add preset colour arrays at module level (after `DARK_DEFAULTS` block from Task 4)**

Add immediately after the `async function loadTheme()` block:

```js
const ACCENT_PRESETS   = ['#f7a4a2','#4a9eff','#a8d8a8','#ffd700','#c39bd3','#ff8c42','#76d7c4'];
const BG_DARK_PRESETS  = ['#111111','#1a1a2e','#0d1117','#1a0a2e','#0a1a0a','#1a0a0a'];
const BG_LIGHT_PRESETS = ['#f0e8f0','#f5f5f5','#f8f6f2','#e8f0e8','#f0e8e8','#e8e8f0'];
```

- [ ] **Step 2: Add `personalisationHTML` inside `pages.settings`**

Inside the `pages.settings = async function(activeTab = 'categories')` body, after the `usersHTML` const and before the `main().innerHTML = ...` line, add:

```js
  const bgPresets = currentTheme.mode === 'dark' ? BG_DARK_PRESETS : BG_LIGHT_PRESETS;

  const personalisationHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.5px;margin-bottom:14px">APPEARANCE</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:500">Mode</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Switch between dark and light theme</div>
        </div>
        <div style="display:flex;background:var(--border);border-radius:20px;padding:3px;gap:3px">
          <button class="btn btn-sm ${currentTheme.mode === 'dark'  ? 'btn-primary' : 'btn-ghost'}" onclick="window.setMode('dark')">Dark</button>
          <button class="btn btn-sm ${currentTheme.mode === 'light' ? 'btn-primary' : 'btn-ghost'}" onclick="window.setMode('light')">Light</button>
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.5px;margin-bottom:16px">COLOURS</div>
      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:500;margin-bottom:3px">Accent colour</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Highlights, active links, buttons</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap" id="accentSwatches">
          ${ACCENT_PRESETS.map(c => `<div class="swatch${currentTheme.accent.toLowerCase() === c ? ' selected' : ''}" data-colour="${c}" style="background:${c}" onclick="window.pickAccent('${c}')"></div>`).join('')}
          <div class="swatch swatch-custom" title="Custom colour" onclick="document.getElementById('accentCustom').click()"></div>
          <input type="color" id="accentCustom" style="display:none" value="${currentTheme.accent}" onchange="window.pickAccent(this.value)">
        </div>
      </div>
      <div>
        <div style="font-size:13px;font-weight:500;margin-bottom:3px">Background colour</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Page background</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap" id="bgSwatches">
          ${bgPresets.map(c => `<div class="swatch${currentTheme.bg.toLowerCase() === c ? ' selected' : ''}" data-colour="${c}" style="background:${c}" onclick="window.pickBg('${c}')"></div>`).join('')}
          <div class="swatch swatch-custom" title="Custom colour" onclick="document.getElementById('bgCustom').click()"></div>
          <input type="color" id="bgCustom" style="display:none" value="${currentTheme.bg}" onchange="window.pickBg(this.value)">
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" onclick="window.resetTheme()">Reset to defaults</button>
    </div>`;
```

- [ ] **Step 3: Update the labels map in `pages.settings`**

Find:
```js
  const labels = { categories: 'Categories', updates: 'Updates', system: 'System', users: 'Users' };
```

Replace with:
```js
  const labels = { categories: 'Categories', personalisation: 'Personalisation', updates: 'Updates', system: 'System', users: 'Users' };
```

- [ ] **Step 4: Add the tab to the tab bar**

Find:
```js
      ${[tab('categories'), tab('updates'), tab('system'), ...(currentUser?.is_admin ? [tab('users')] : [])].join('')}
```

Replace with:
```js
      ${[tab('categories'), tab('personalisation'), tab('updates'), tab('system'), ...(currentUser?.is_admin ? [tab('users')] : [])].join('')}
```

- [ ] **Step 5: Add personalisation to the content render**

Find:
```js
    ${activeTab === 'categories' ? categoriesHTML : activeTab === 'updates' ? updatesHTML : activeTab === 'users' ? usersHTML : systemHTML}
```

Replace with:
```js
    ${activeTab === 'categories' ? categoriesHTML : activeTab === 'personalisation' ? personalisationHTML : activeTab === 'updates' ? updatesHTML : activeTab === 'users' ? usersHTML : systemHTML}
```

- [ ] **Step 6: Add event handler functions**

After `window.pickColour = function(el) { ... };` (around line 1682), add:

```js
window.setMode = async function(mode) {
  const defaults = mode === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
  applyTheme({ ...defaults });
  await api('/settings/theme', { method: 'POST', body: { ...defaults } });
  pages.settings('personalisation');
};

window.pickAccent = async function(colour) {
  applyTheme({ ...currentTheme, accent: colour });
  const customInput = document.getElementById('accentCustom');
  if (customInput) customInput.value = colour;
  await api('/settings/theme', { method: 'POST', body: { accent: colour } });
  document.querySelectorAll('#accentSwatches .swatch:not(.swatch-custom)').forEach(el => {
    el.classList.toggle('selected', el.dataset.colour === colour.toLowerCase());
  });
};

window.pickBg = async function(colour) {
  applyTheme({ ...currentTheme, bg: colour });
  const customInput = document.getElementById('bgCustom');
  if (customInput) customInput.value = colour;
  await api('/settings/theme', { method: 'POST', body: { bg: colour } });
  document.querySelectorAll('#bgSwatches .swatch:not(.swatch-custom)').forEach(el => {
    el.classList.toggle('selected', el.dataset.colour === colour.toLowerCase());
  });
};

window.resetTheme = async function() {
  applyTheme({ ...DARK_DEFAULTS });
  await api('/settings/theme', { method: 'POST', body: { ...DARK_DEFAULTS } });
  pages.settings('personalisation');
};
```

- [ ] **Step 7: Run all tests to confirm nothing is broken**

```bash
node tests/theme.test.js && node tests/settings.test.js && node tests/auth.test.js && node tests/db-migration.test.js
```

Expected: all pass.

- [ ] **Step 8: Manual UI test checklist**

With the dev server running (`npm run dev`), open `http://localhost:3000` and log in.

Go to **Settings → Personalisation** and verify:

- [ ] The Personalisation tab appears between Categories and Updates
- [ ] Dark mode button is highlighted (active) on first load
- [ ] The pink swatch (`#f7a4a2`) is selected in Accent colour
- [ ] The black swatch (`#111111`) is selected in Background colour
- [ ] Clicking the blue accent swatch (`#4a9eff`) instantly changes all highlights/buttons to blue
- [ ] Refreshing the page preserves the blue accent (persisted to DB)
- [ ] Clicking the rainbow custom swatch opens the OS colour picker; choosing a colour applies it
- [ ] Clicking the Light button switches to warm-rose theme (light bg, dark text) instantly
- [ ] After switching to Light, the bg presets change to light options
- [ ] Clicking Reset to defaults restores black background + pink accent + dark mode
- [ ] Logging out and back in loads the saved theme before the dashboard renders
- [ ] A second user has their own theme (log in as another user; their theme is independent)

- [ ] **Step 9: Commit**

```bash
git add public/app.js
git commit -m "feat: add Personalisation settings tab with theme customisation"
```
