# Mobile Responsive Design Spec

## Overview

Make FinTrack usable on mobile (phones and small tablets) by adding a bottom navigation bar and responsive content layout. Desktop experience is entirely unchanged.

**Breakpoint:** `≤768px` = mobile. `>768px` = desktop (current behaviour, untouched).

---

## Navigation

### Desktop (>768px) — no change
The existing `#sidebar` remains exactly as-is: `220px` fixed-width left panel with all 8 page links and the user pill at the bottom.

### Mobile (≤768px) — bottom nav bar

**HTML additions (index.html):**
- Add `<nav id="bottom-nav">` directly before `</body>` with 5 buttons:
  - Dashboard (📊), Spending (💳), Bills (📅), Income (💼), More (☰)
- Add `<div id="more-sheet">` overlay: a slide-up sheet containing the 4 overflow pages + user pill
- Add `<div id="more-backdrop">` a full-screen semi-transparent backdrop behind the sheet

**Bottom nav structure:**
```html
<nav id="bottom-nav">
  <button data-page="dashboard">📊<span>Home</span></button>
  <button data-page="spending">💳<span>Spending</span></button>
  <button data-page="bills">📅<span>Bills</span></button>
  <button data-page="income">💼<span>Income</span></button>
  <button id="more-btn">☰<span>More</span></button>
</nav>
```

**More sheet contents (in order):**
1. Drag handle (decorative bar)
2. "More" heading label
3. Nav items: Accounts, Transfers, Reports, Settings (each tappable, closes sheet + navigates)
4. User pill (avatar + display name + switch-user icon) — mirrors the desktop sidebar pill

---

## CSS Changes (style.css)

All new rules live inside `@media (max-width: 768px)` blocks. No existing rules are modified.

### Sidebar hidden on mobile
```css
@media (max-width: 768px) {
  #sidebar { display: none; }
}
```

### Main content area
```css
@media (max-width: 768px) {
  #main {
    padding: 16px 16px 80px; /* 80px bottom clears the nav bar */
  }
}
```

### Bottom nav bar (always visible on mobile)
```css
#bottom-nav {
  display: none; /* hidden by default (desktop) */
}
@media (max-width: 768px) {
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
    font-size: 11px;
    min-width: 44px; /* accessibility tap target */
  }
  #bottom-nav button span { font-size: 10px; }
  #bottom-nav button.active { color: var(--accent); }
}
```

### More sheet + backdrop
```css
#more-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 200;
}
#more-sheet {
  display: none;
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: var(--card);
  border-top: 1px solid var(--border);
  border-radius: 14px 14px 0 0;
  z-index: 201;
  padding: 12px 16px 32px;
}
#more-backdrop.open,
#more-sheet.open {
  display: block;
}
/* Handle bar */
#more-sheet .sheet-handle {
  width: 40px; height: 4px;
  background: var(--border);
  border-radius: 2px;
  margin: 0 auto 16px;
}
/* Sheet nav items */
#more-sheet .sheet-nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text);
  font-size: 15px;
}
#more-sheet .sheet-nav-item:hover {
  background: var(--bg);
}
/* User pill inside sheet */
#more-sheet .sheet-user-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  margin-top: 12px;
  border-top: 1px solid var(--border);
  cursor: pointer;
  border-radius: 8px;
}
#more-sheet .sheet-user-pill:hover {
  background: var(--bg);
}
```

### Content layout adjustments
```css
@media (max-width: 768px) {
  /* Stack form rows vertically */
  .form-row { flex-direction: column; align-items: stretch; }
  /* Tab nav scrolls horizontally */
  .tabs-nav { overflow-x: auto; white-space: nowrap; }
  /* Stat cards: 2 columns on mobile (already grid-based, no change needed) */
}
```

---

## JavaScript Changes (app.js)

### Active state management
`navigate(page)` already sets the active class on sidebar links. Extend it to also:
- Update `.active` class on `#bottom-nav button[data-page]` matching buttons
- Set More button active if current page is one of: accounts, transfers, reports, settings

### More sheet open/close
Add these functions:
```js
function openMoreSheet() {
  document.getElementById('more-sheet').classList.add('open');
  document.getElementById('more-backdrop').classList.add('open');
}
function closeMoreSheet() {
  document.getElementById('more-sheet').classList.remove('open');
  document.getElementById('more-backdrop').classList.remove('open');
}
```

Wire up:
- `#more-btn` click → `openMoreSheet()`
- `#more-backdrop` click → `closeMoreSheet()`
- Each `.sheet-nav-item` click → `navigate(page)` + `closeMoreSheet()`
- Sheet user pill click → same as sidebar user pill (open switch-user flow) + `closeMoreSheet()`

### User pill in sheet
`renderUserPill()` (or equivalent) should also update `#sheet-user-pill` with the current user's avatar initial and display name — same data, two DOM targets.

---

## Behaviour Summary

| Trigger | Result |
|---------|--------|
| Screen ≤768px | Sidebar hidden, bottom nav appears, `#main` gets 80px bottom padding |
| Tap Dashboard/Spending/Bills/Income | Navigate + active state updates |
| Tap More (☰) | Backdrop + sheet slide up |
| Tap sheet nav item | Navigate + sheet closes |
| Tap backdrop | Sheet closes |
| Tap sheet user pill | Switch-user modal + sheet closes |
| Screen >768px | Bottom nav hidden, sidebar visible, no change |
| Active page in More group | More button gets accent colour in bottom nav |

---

## Out of Scope

- Swipe-to-close gesture on the sheet
- Tablet-specific collapsed icon sidebar (plain mobile-only)
- Any change to desktop layout
- PWA / install prompt
- Safe-area insets (notch / home indicator) — may add later if needed
