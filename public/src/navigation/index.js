export function installNavigation(ctx) {
  const { pages } = ctx;
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

document.querySelectorAll('#sidebar a').forEach(a => {
  a.addEventListener('click', () => navigate(a.dataset.page));
});

document.querySelectorAll('#bottom-nav button[data-page]').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.page));
});

// ── Mobile More sheet ──────────────────────────────────────────────────────
function openMoreSheet() {
  const sheet = document.getElementById('more-sheet');
  const backdrop = document.getElementById('more-backdrop');
  const closeBtn = document.getElementById('more-sheet-close');
  const moreBtn = document.getElementById('more-btn');
  if (!sheet || !backdrop) return;
  sheet.classList.add('open');
  backdrop.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  if (closeBtn) { closeBtn.style.display = 'block'; closeBtn.focus(); }
  if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
}

function closeMoreSheet() {
  const sheet = document.getElementById('more-sheet');
  const backdrop = document.getElementById('more-backdrop');
  const closeBtn = document.getElementById('more-sheet-close');
  const moreBtn = document.getElementById('more-btn');
  if (!sheet || !backdrop) return;
  sheet.classList.remove('open');
  backdrop.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  if (closeBtn) closeBtn.style.display = 'none';
  if (moreBtn) { moreBtn.setAttribute('aria-expanded', 'false'); moreBtn.focus(); }
}

document.getElementById('more-btn').addEventListener('click', openMoreSheet);
document.getElementById('more-backdrop').addEventListener('click', closeMoreSheet);
document.getElementById('more-sheet-close').addEventListener('click', closeMoreSheet);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMoreSheet(); return; }
  const sheet = document.getElementById('more-sheet');
  if (!sheet || !sheet.classList.contains('open')) return;
  if (e.key !== 'Tab') return;
  const focusable = Array.from(sheet.querySelectorAll('button:not([disabled])'));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

document.querySelectorAll('.sheet-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    navigate(item.dataset.page);
    closeMoreSheet();
  });
});

document.getElementById('sheet-user-pill').addEventListener('click', async () => {
  closeMoreSheet();
  await ctx.logout();
});
  return { navigate, openMoreSheet, closeMoreSheet };
}
