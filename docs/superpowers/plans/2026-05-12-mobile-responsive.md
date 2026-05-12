# Mobile Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FinTrack fully usable on mobile (≤768px) with a bottom navigation bar, a slide-up "More" sheet, and responsive content layout — zero change to the desktop experience.

**Architecture:** Three small, sequential changes to the existing files. First add the new HTML elements (bottom nav bar, backdrop, sheet). Then add all mobile CSS inside a single `@media (max-width: 768px)` block. Finally update `navigate()` and add sheet open/close JS. No new files needed.

**Tech Stack:** Vanilla HTML/CSS/JS, CSS custom properties, CSS media queries.

---

## File Map

| File | Change |
|------|--------|
| `public/index.html` | Add `#bottom-nav`, `#more-backdrop`, `#more-sheet` before `</body>` |
| `public/style.css` | Append mobile CSS block (~110 lines) |
| `public/app.js` | Extend `navigate()`, add `openMoreSheet`/`closeMoreSheet`, update user pill helpers |

---

### Task 1: Add mobile HTML elements to index.html

**Files:**
- Modify: `public/index.html`

`index.html` is 32 lines. The new elements go between `<script src="app.js"></script>` and `</body>`.

- [ ] **Step 1: Open `public/index.html`**

Read the file to confirm current content (32 lines, `<script>` tag on line 30).

- [ ] **Step 2: Replace the closing lines**

Replace:
```html
  <script src="app.js"></script>
</body>
</html>
```

With:
```html
  <script src="app.js"></script>

  <!-- Mobile: bottom nav bar -->
  <nav id="bottom-nav">
    <button data-page="dashboard">
      <span class="bnav-icon">📊</span>
      <span class="bnav-label">Home</span>
    </button>
    <button data-page="spending">
      <span class="bnav-icon">💳</span>
      <span class="bnav-label">Spending</span>
    </button>
    <button data-page="bills">
      <span class="bnav-icon">📅</span>
      <span class="bnav-label">Bills</span>
    </button>
    <button data-page="income">
      <span class="bnav-icon">💼</span>
      <span class="bnav-label">Income</span>
    </button>
    <button id="more-btn">
      <span class="bnav-icon">☰</span>
      <span class="bnav-label">More</span>
    </button>
  </nav>

  <!-- Mobile: backdrop behind More sheet -->
  <div id="more-backdrop"></div>

  <!-- Mobile: More slide-up sheet -->
  <div id="more-sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-section-label">More</div>
    <div class="sheet-nav-item" data-page="accounts">
      <span>🏦</span><span>Accounts</span>
    </div>
    <div class="sheet-nav-item" data-page="transfers">
      <span>🔁</span><span>Transfers</span>
    </div>
    <div class="sheet-nav-item" data-page="reports">
      <span>📈</span><span>Reports</span>
    </div>
    <div class="sheet-nav-item" data-page="settings">
      <span>⚙️</span><span>Settings</span>
    </div>
    <div id="sheet-user-pill" class="sheet-user-pill" style="display:none">
      <div id="sheet-pill-avatar" class="user-pill-avatar"></div>
      <span id="sheet-pill-name" class="user-pill-name"></span>
      <span class="user-pill-switch">⇄</span>
    </div>
  </div>

</body>
</html>
```

- [ ] **Step 3: Verify the file renders without errors**

Open the app in a browser (or run `node server.js` and open http://localhost:3000). The page should look identical on desktop — the new elements are invisible until CSS is added.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add mobile bottom-nav and more-sheet HTML"
```

---

### Task 2: Add mobile CSS

**Files:**
- Modify: `public/style.css` (append after line 474)

Append the entire block below to the **end** of `public/style.css`. Do not modify any existing rules.

- [ ] **Step 1: Append to `public/style.css`**

Add this entire block at the end of the file:

```css
/* ── Mobile: bottom nav + More sheet ──────────────────────────────────────── */

/* Hidden on desktop by default */
#bottom-nav,
#more-backdrop,
#more-sheet { display: none; }

@media (max-width: 768px) {

  /* Hide desktop sidebar */
  #sidebar { display: none; }

  /* Main content — reduce padding + clear the fixed bottom nav */
  #main { padding: 16px 16px 80px; }

  /* ── Bottom nav bar ── */
  #bottom-nav {
    display: flex;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    height: 60px;
    background: var(--card);
    border-top: 1px solid var(--border);
    z-index: 100;
    justify-content: space-around;
    align-items: center;
  }

  #bottom-nav button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 8px;
    color: var(--muted);
    min-width: 44px;
    min-height: 44px;
    justify-content: center;
    border-radius: 8px;
  }

  #bottom-nav button.active { color: var(--accent); }

  .bnav-icon  { font-size: 18px; line-height: 1; }
  .bnav-label { font-size: 10px; }

  /* ── Backdrop ── */
  #more-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: 200;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }

  #more-backdrop.open {
    opacity: 1;
    pointer-events: auto;
  }

  /* ── More sheet ── */
  #more-sheet {
    display: block;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: var(--card);
    border-top: 1px solid var(--border);
    border-radius: 14px 14px 0 0;
    z-index: 201;
    padding: 12px 16px 40px;
    transform: translateY(100%);
    transition: transform 0.25s ease;
  }

  #more-sheet.open { transform: translateY(0); }

  .sheet-handle {
    width: 40px; height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin: 0 auto 16px;
  }

  .sheet-section-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    padding: 0 8px;
  }

  .sheet-nav-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 13px 8px;
    border-radius: 8px;
    cursor: pointer;
    color: var(--text);
    font-size: 15px;
    transition: background 0.15s;
  }

  .sheet-nav-item:hover,
  .sheet-nav-item:active { background: var(--bg); }

  .sheet-user-pill {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 8px;
    margin-top: 12px;
    border-top: 1px solid var(--border);
    cursor: pointer;
    border-radius: 8px;
    transition: background 0.15s;
  }

  .sheet-user-pill:hover { background: var(--bg); }

  /* ── Content layout adjustments ── */
  .form-row { flex-direction: column; align-items: stretch; }

  .tabs-nav { overflow-x: auto; white-space: nowrap; }

}
```

- [ ] **Step 2: Verify desktop layout unchanged**

Open http://localhost:3000 in a desktop browser (viewport > 768px). The sidebar should be visible, no bottom bar should appear. Everything looks identical to before.

- [ ] **Step 3: Verify mobile CSS applies**

Open DevTools → Toggle device toolbar → set to a phone preset (e.g. iPhone 12, 390px). You should see:
- Sidebar hidden
- Bottom nav bar visible with 5 buttons
- More sheet and backdrop not visible yet (they're off-screen)
- `#main` has extra bottom padding

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "feat: add mobile CSS — bottom nav and more sheet"
```

---

### Task 3: Wire up JavaScript

**Files:**
- Modify: `public/app.js`

Three changes:
1. Extend `navigate()` (line 69) to sync the bottom nav active state
2. Add `openMoreSheet` / `closeMoreSheet` functions and event wiring
3. Extend user pill rendering (in `init` and `doLogin`) to also update the sheet pill

#### 3a — Extend `navigate()`

- [ ] **Step 1: Update `navigate()` at line 69**

Current code (lines 69–74):
```js
function navigate(page) {
  document.querySelectorAll('#sidebar a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });
  if (pages[page]) pages[page]();
}
```

Replace with:
```js
const MORE_PAGES = new Set(['accounts', 'transfers', 'reports', 'settings']);

function navigate(page) {
  document.querySelectorAll('#sidebar a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });
  document.querySelectorAll('#bottom-nav button[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
  const moreBtn = document.getElementById('more-btn');
  if (moreBtn) moreBtn.classList.toggle('active', MORE_PAGES.has(page));
  if (pages[page]) pages[page]();
}
```

- [ ] **Step 2: Verify sidebar active state still works on desktop**

Open the app on desktop, click through sidebar links — active highlight should work as before.

#### 3b — Add sheet open/close + wiring

- [ ] **Step 3: Add sheet functions after the `navigate` event wiring at line 78**

After the block:
```js
document.querySelectorAll('#sidebar a').forEach(a => {
  a.addEventListener('click', () => navigate(a.dataset.page));
});
```

Insert:
```js
// ── Mobile More sheet ──────────────────────────────────────────────────────
function openMoreSheet() {
  document.getElementById('more-sheet').classList.add('open');
  document.getElementById('more-backdrop').classList.add('open');
}

function closeMoreSheet() {
  document.getElementById('more-sheet').classList.remove('open');
  document.getElementById('more-backdrop').classList.remove('open');
}

document.getElementById('more-btn').addEventListener('click', openMoreSheet);
document.getElementById('more-backdrop').addEventListener('click', closeMoreSheet);

document.querySelectorAll('.sheet-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    navigate(item.dataset.page);
    closeMoreSheet();
  });
});

document.getElementById('sheet-user-pill').addEventListener('click', () => {
  closeMoreSheet();
  logout();
});
```

- [ ] **Step 4: Verify the sheet opens and closes**

In mobile DevTools view:
- Tap the ☰ More button → sheet slides up, backdrop dims the page
- Tap the backdrop → sheet slides back down
- Tap Accounts, Transfers, Reports, or Settings → navigates to page, sheet closes
- The More button should be accent-coloured when any of those pages is active

#### 3c — Sync user pill into sheet

The sheet has `#sheet-user-pill`, `#sheet-pill-avatar`, `#sheet-pill-name`. These need to be populated alongside the sidebar pill.

- [ ] **Step 5: Update `init()` to also populate the sheet pill**

Find `init()` at line 1655. Current user pill block (lines 1659–1664):
```js
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = me.colour;
  document.getElementById('user-pill-avatar').textContent = me.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = me.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
```

Replace with:
```js
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = me.colour;
  document.getElementById('user-pill-avatar').textContent = me.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = me.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  const sheetPill = document.getElementById('sheet-user-pill');
  document.getElementById('sheet-pill-avatar').style.background = me.colour;
  document.getElementById('sheet-pill-avatar').textContent = me.display_name[0].toUpperCase();
  document.getElementById('sheet-pill-name').textContent = me.display_name;
  sheetPill.style.display = 'flex';
```

- [ ] **Step 6: Update `doLogin()` to also populate the sheet pill**

Find `doLogin()` at line 1792. Current user pill block (lines 1801–1806):
```js
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = r.colour;
  document.getElementById('user-pill-avatar').textContent = r.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = r.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
```

Replace with:
```js
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = r.colour;
  document.getElementById('user-pill-avatar').textContent = r.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = r.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  const sheetPill = document.getElementById('sheet-user-pill');
  document.getElementById('sheet-pill-avatar').style.background = r.colour;
  document.getElementById('sheet-pill-avatar').textContent = r.display_name[0].toUpperCase();
  document.getElementById('sheet-pill-name').textContent = r.display_name;
  sheetPill.style.display = 'flex';
```

- [ ] **Step 7: Update `logout()` to hide the sheet pill**

Find `logout()` at line 1669. Current line hiding sidebar pill (line 1675):
```js
  document.getElementById('user-pill').style.display = 'none';
```

Replace with:
```js
  document.getElementById('user-pill').style.display = 'none';
  document.getElementById('sheet-user-pill').style.display = 'none';
```

- [ ] **Step 8: Verify user pill in sheet**

In mobile DevTools view after logging in:
- Tap ☰ More — the sheet shows the user's avatar initial and name at the bottom
- Tap the user pill in the sheet — sheet closes and user is logged out (login screen appears)

- [ ] **Step 9: Commit**

```bash
git add public/app.js
git commit -m "feat: wire up mobile bottom-nav JS and more sheet"
```

---

### Task 4: Manual end-to-end verification

No code changes — this is a checklist-driven test pass.

**Files:** None

- [ ] **Step 1: Start the server**

```bash
node server.js
```

Open http://localhost:3000.

- [ ] **Step 2: Desktop smoke test**

Browser at full width (>768px):
- [ ] Sidebar visible with all 8 links
- [ ] Bottom nav NOT visible
- [ ] Click every sidebar link — active highlight works
- [ ] User pill shows at bottom of sidebar
- [ ] Personalisation / theme still works

- [ ] **Step 3: Mobile smoke test**

DevTools → device toolbar → iPhone 12 (390×844):
- [ ] Sidebar hidden
- [ ] Bottom nav shows 5 items: Home, Spending, Bills, Income, More
- [ ] Tap Home → Dashboard loads, Home button accent-coloured
- [ ] Tap Spending → Spending page loads
- [ ] Tap Bills → Bills page loads
- [ ] Tap Income → Income page loads
- [ ] Tap More → sheet slides up, backdrop visible
- [ ] Tap Accounts in sheet → Accounts page loads, sheet closes, More button accent-coloured
- [ ] Tap Transfers in sheet → works
- [ ] Tap Reports in sheet → works
- [ ] Tap Settings in sheet → works
- [ ] Tap backdrop → sheet closes
- [ ] User pill visible in sheet with correct name + avatar colour
- [ ] Tap user pill in sheet → logs out, sheet closes

- [ ] **Step 4: Form layout on mobile**

Navigate to Spending on mobile — the "Add spending" form row should stack vertically.

Navigate to Settings on mobile — the tabs row should scroll horizontally if too wide.

- [ ] **Step 5: Commit verification note**

No code changes needed — if all checks pass:

```bash
git commit --allow-empty -m "chore: mobile responsive manual verification passed"
```

---

### Task 5: Push to GitHub

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Confirm**

Expected output: `Branch 'main' set up to track remote branch 'main' from 'origin'.` or similar push confirmation.
