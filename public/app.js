// ── Helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const main = () => document.getElementById('main');

function fmt(n) {
  return '£' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function monthName(m) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1];
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  return res.json();
}

let _categories = [];
async function getCategories() {
  if (!_categories.length) _categories = await api('/categories');
  return _categories;
}
function invalidateCategories() { _categories = []; }

let _accounts = [];
async function getAccounts() {
  if (!_accounts.length) _accounts = await api('/accounts');
  return _accounts;
}
function invalidateAccounts() { _accounts = []; }

// ── Router ────────────────────────────────────────────────────────────────
const pages = {};

function navigate(page) {
  document.querySelectorAll('#sidebar a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });
  if (pages[page]) pages[page]();
}

document.querySelectorAll('#sidebar a').forEach(a => {
  a.addEventListener('click', () => navigate(a.dataset.page));
});

// ── Dashboard ─────────────────────────────────────────────────────────────
let barChart = null, donutChart = null;
let calYear = null, calMonth = null;
let _dashData = null; // cached for edit mode re-renders without API calls

const WIDGET_NAMES = {
  stats:       'Monthly Stats',
  accounts:    'Account Balances',
  bar_chart:   'Income vs Spending',
  donut_chart: 'Spending by Category',
  calendar:    'Calendar',
};

function _widgetHtml(id, summary, accounts) {
  if (id === 'stats') return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Income</div>
        <div class="value">${fmt(summary.income)}</div>
        <div class="sub">This month</div>
      </div>
      <div class="stat-card">
        <div class="label">Spent</div>
        <div class="value">${fmt(summary.spent)}</div>
        <div class="sub">${summary.income > 0 ? Math.round(summary.spent / summary.income * 100) : 0}% of income</div>
      </div>
      <div class="stat-card highlight">
        <div class="label">Remaining</div>
        <div class="value">${fmt(summary.remaining)}</div>
        <div class="sub">${summary.income > 0 ? Math.round(summary.remaining / summary.income * 100) : 0}% left</div>
      </div>
    </div>`;
  if (id === 'accounts') return `
    <div class="card">
      <div class="chart-title" style="margin-bottom:12px">Account Balances</div>
      <div class="stat-grid" style="margin:0">
        ${accounts.map(a => `
          <div class="stat-card" style="border-left:3px solid ${esc(a.colour)}">
            <div class="label">${esc(a.name)}</div>
            <div class="value" style="font-size:20px">${fmt(a.balance)}</div>
            <div class="sub" style="text-transform:capitalize">${esc(a.type)}</div>
          </div>`).join('')}
      </div>
    </div>`;
  if (id === 'bar_chart') return `
    <div class="card">
      <div class="chart-title">Income vs Spending (6 months)</div>
      <canvas id="barChart" height="180"></canvas>
    </div>`;
  if (id === 'donut_chart') return `
    <div class="card">
      <div class="chart-title">Spending by Category</div>
      <canvas id="donutChart" height="180"></canvas>
    </div>`;
  if (id === 'calendar') return `
    <div class="card">
      <div id="calWidget" style="min-height:280px;display:flex;align-items:center;justify-content:center">
        <span style="color:var(--muted)">Loading calendar…</span>
      </div>
    </div>`;
  return '';
}

function _renderDashboard(editMode, editOrder, editHidden, editSizes) {
  if (!_dashData) return;
  const { summary, accounts } = _dashData;

  if (barChart)   { barChart.destroy();   barChart = null; }
  if (donutChart) { donutChart.destroy(); donutChart = null; }

  const widgetsHtml = editOrder.map(id => {
    const isHidden = editHidden.includes(id);
    const span = editSizes[id] ?? 2;

    if (isHidden) {
      if (!editMode) return '';
      // Ghost slot — always full-width to avoid grid gaps
      return `
        <div class="dash-ghost" data-widget="${id}"
          style="grid-column:span 2;border:1px dashed #333;border-radius:8px;padding:10px 16px;
                 display:flex;align-items:center;justify-content:space-between;opacity:0.45">
          <span style="color:var(--muted);font-size:13px">${WIDGET_NAMES[id] ?? id}</span>
          <button class="dash-restore-btn btn btn-sm"
            data-widget="${id}"
            style="background:#4ade80;color:#111;border:none;border-radius:6px;
                   padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer">
            ＋ Restore
          </button>
        </div>`;
    }

    const inner = _widgetHtml(id, summary, accounts);

    if (!editMode) {
      return `<div data-widget="${id}" style="grid-column:span ${span}">${inner}</div>`;
    }

    // Visible widget in edit mode — wrap with drag bar + resize handle
    return `
      <div class="dash-widget" draggable="true" data-widget="${id}"
        style="position:relative;grid-column:span ${span};border:1px dashed #f7a4a244;
               border-radius:8px;padding-top:30px">
        <div style="position:absolute;top:0;left:0;right:0;height:30px;
                    display:flex;align-items:center;justify-content:space-between;
                    padding:0 10px;background:#1a1a1a;border-radius:8px 8px 0 0;
                    cursor:grab;user-select:none">
          <span style="color:var(--muted);font-size:13px">⠿ ${WIDGET_NAMES[id] ?? id}</span>
          <button class="dash-remove-btn btn btn-sm"
            data-widget="${id}"
            style="background:#ff4444;color:#fff;border:none;border-radius:50%;
                   width:20px;height:20px;font-size:11px;cursor:pointer;
                   display:flex;align-items:center;justify-content:center;padding:0">
            ✕
          </button>
        </div>
        ${inner}
        <div class="dash-resize-handle" data-widget="${id}"
          style="position:absolute;bottom:4px;right:4px;width:14px;height:14px;
                 border-right:2px solid #555;border-bottom:2px solid #555;
                 cursor:se-resize;border-radius:0 0 4px 0"></div>
      </div>`;
  }).join('');

  main().innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="color:var(--muted);font-size:13px">${monthName(calMonth)} ${calYear}</span>
        ${editMode
          ? `<button class="btn btn-primary btn-sm" id="dashDone">✓ Done</button>`
          : `<button class="btn btn-ghost btn-sm" id="dashEdit">✏️ Edit</button>`}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      ${widgetsHtml}
    </div>
  `;

  // Initialise bar chart if visible
  if (!editHidden.includes('bar_chart') && $('barChart')) {
    const trend = summary.monthlyTrend;
    barChart = new Chart($('barChart'), {
      type: 'bar',
      data: {
        labels: trend.map(m => monthName(Number(m.month))),
        datasets: [
          { label: 'Income',   data: trend.map(m => m.income), backgroundColor: '#ffffff44', borderColor: '#ffffff', borderWidth: 1 },
          { label: 'Spending', data: trend.map(m => m.spent),  backgroundColor: '#f7a4a288', borderColor: '#f7a4a2', borderWidth: 1 },
        ],
      },
      options: { responsive: true, plugins: { legend: { labels: { color: '#888' } } },
        scales: { x: { ticks: { color: '#888' }, grid: { color: '#2a2a2a' } },
                  y: { ticks: { color: '#888', callback: v => '£' + v }, grid: { color: '#2a2a2a' } } } },
    });
  }

  // Initialise donut chart if visible
  if (!editHidden.includes('donut_chart') && $('donutChart')) {
    const catData = summary.byCategory.filter(c => c.total > 0);
    donutChart = new Chart($('donutChart'), {
      type: 'doughnut',
      data: {
        labels: catData.map(c => c.name),
        datasets: [{ data: catData.map(c => c.total), backgroundColor: catData.map(c => c.colour), borderWidth: 0 }],
      },
      options: { responsive: true, cutout: '65%',
        plugins: { legend: { position: 'right', labels: { color: '#888', boxWidth: 12 } } } },
    });
  }

  // Initialise calendar if visible
  if (!editHidden.includes('calendar')) {
    renderCalendar(calYear, calMonth);
  }

  if (!editMode) {
    $('dashEdit')?.addEventListener('click', () => {
      _renderDashboard(true,
        [..._dashData.layout.order],
        [..._dashData.layout.hidden],
        { ..._dashData.layout.sizes });
    });
    return;
  }

  // ── Edit mode wiring ──────────────────────────────────────────────────────

  let dragSrc = null;

  // Drag and drop on visible widgets
  document.querySelectorAll('.dash-widget[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragSrc = e.currentTarget.dataset.widget;
      setTimeout(() => { e.currentTarget.style.opacity = '0.4'; }, 0);
    });
    el.addEventListener('dragend', e => {
      e.currentTarget.style.opacity = '';
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.currentTarget.style.outline = '2px dashed #f7a4a2';
    });
    el.addEventListener('dragleave', e => {
      e.currentTarget.style.outline = '';
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      e.currentTarget.style.outline = '';
      const dropTarget = e.currentTarget.dataset.widget;
      if (!dragSrc || dragSrc === dropTarget) return;
      const fromIdx = editOrder.indexOf(dragSrc);
      const toIdx   = editOrder.indexOf(dropTarget);
      editOrder.splice(fromIdx, 1);
      editOrder.splice(toIdx, 0, dragSrc);
      _renderDashboard(true, editOrder, editHidden, editSizes);
    });
  });

  // Drag events on ghost slots (allow drop + visual feedback)
  document.querySelectorAll('.dash-ghost[data-widget]').forEach(el => {
    el.addEventListener('dragover', e => {
      e.preventDefault();
      el.style.outline = '2px dashed #f7a4a2';
    });
    el.addEventListener('dragleave', () => {
      el.style.outline = '';
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.style.outline = '';
      const dropTarget = el.dataset.widget;
      if (!dragSrc || dragSrc === dropTarget) return;
      const fromIdx = editOrder.indexOf(dragSrc);
      const toIdx   = editOrder.indexOf(dropTarget);
      editOrder.splice(fromIdx, 1);
      editOrder.splice(toIdx, 0, dragSrc);
      _renderDashboard(true, editOrder, editHidden, editSizes);
    });
  });

  // Remove (✕) buttons
  document.querySelectorAll('.dash-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.widget;
      if (!editHidden.includes(id)) editHidden.push(id);
      _renderDashboard(true, editOrder, editHidden, editSizes);
    });
  });

  // Restore (＋) buttons
  document.querySelectorAll('.dash-restore-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.widget;
      const idx = editHidden.indexOf(id);
      if (idx !== -1) editHidden.splice(idx, 1);
      _renderDashboard(true, editOrder, editHidden, editSizes);
    });
  });

  // Resize handles — drag right to expand, drag left to shrink
  document.querySelectorAll('.dash-resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const widgetId = handle.dataset.widget;
      const startX = e.clientX;

      const onMove = () => {}; // snap-only: no live preview, resize commits on mouseup

      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const delta = ev.clientX - startX;
        const current = editSizes[widgetId] ?? 2;
        if (delta > 40 && current === 1) editSizes[widgetId] = 2;
        else if (delta < -40 && current === 2) editSizes[widgetId] = 1;
        _renderDashboard(true, editOrder, editHidden, editSizes);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  // Done button — save and exit edit mode
  $('dashDone')?.addEventListener('click', async () => {
    try {
      await api('/settings/dashboard', { method: 'POST', body: { order: editOrder, hidden: editHidden, sizes: editSizes } });
      _dashData.layout = { order: [...editOrder], hidden: [...editHidden], sizes: { ...editSizes } };
      _renderDashboard(false, [...editOrder], [...editHidden], { ...editSizes });
    } catch {
      alert('Failed to save layout. Please try again.');
    }
  });
}

pages.dashboard = async function () {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  if (!calYear) { calYear = year; calMonth = month; }

  invalidateAccounts();
  try {
    const [summary, accounts, layout] = await Promise.all([
      api(`/summary/${year}/${month}`),
      getAccounts(),
      api('/settings/dashboard'),
    ]);
    _dashData = { summary, accounts, layout };
    _renderDashboard(false, [...layout.order], [...layout.hidden], { ...layout.sizes });
  } catch {
    main().innerHTML = `<div class="card" style="color:var(--muted);padding:24px">Failed to load dashboard. Please refresh.</div>`;
  }
};

async function renderCalendar(year, month) {
  calYear = year; calMonth = month;
  const data = await api(`/calendar/${year}/${month}`);
  const widget = document.getElementById('calWidget');
  if (!widget) return;

  const eventsByDate = {};
  for (const ev of data.events) {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
    eventsByDate[ev.date].push(ev);
  }

  const firstDow  = new Date(year, month - 1, 1).getDay();
  const dim       = new Date(year, month, 0).getDate();
  const todayStr  = new Date().toISOString().split('T')[0];
  const monthPad  = String(month).padStart(2, '0');
  const DOW       = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div class="cal-day cal-other"></div>`;

  for (let d = 1; d <= dim; d++) {
    const dayPad  = String(d).padStart(2, '0');
    const dateStr = `${year}-${monthPad}-${dayPad}`;
    const isToday = dateStr === todayStr;
    const dayEvs  = eventsByDate[dateStr] || [];

    const pills = dayEvs.map(ev => {
      if (ev.type === 'bill') {
        const bg = hexDarken(ev.colour);
        const opa = ev.paid ? 'opacity:0.5;' : '';
        const str = ev.paid ? 'text-decoration:line-through;' : '';
        return `<div class="event-pill" style="background:${bg};color:${ev.colour};${opa}">${esc(ev.name)} <span style="${str}">${fmt(ev.amount)}</span></div>`;
      }
      return `<div class="event-pill" style="background:#166534;color:#4ade80">${esc(ev.name)} ${fmt(ev.amount)}</div>`;
    }).join('');

    cells += `<div class="cal-day${dayEvs.length ? ' cal-has' : ''}">
      <div class="cal-num${isToday ? ' cal-today' : ''}">${d}</div>
      ${pills}
    </div>`;
  }

  const rem = (firstDow + dim) % 7;
  if (rem !== 0) for (let i = 0; i < 7 - rem; i++) cells += `<div class="cal-day cal-other"></div>`;

  widget.style.display = 'block';
  widget.innerHTML = `
    <style>
      .cal-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
      .cal-title{color:#fff;font-size:15px;font-weight:700}
      .cal-nav{background:#2a2a2a;border:none;color:#888;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
      .cal-nav:hover{color:#fff}
      .cal-dow-row{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:1px}
      .cal-dow{color:#555;font-size:11px;text-align:center;padding:5px 0;font-weight:600}
      .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#2a2a2a;border-radius:6px;overflow:hidden}
      .cal-day{background:#111;min-height:72px;padding:4px}
      .cal-other{background:#0d0d0d}
      .cal-num{color:#888;font-size:11px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;margin-bottom:3px;border-radius:50%}
      .cal-has .cal-num{color:#fff}
      .cal-today{background:#f7a4a2!important;color:#1a1a1a!important;font-weight:700}
      .event-pill{font-size:10px;border-radius:3px;padding:2px 4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;line-height:1.4}
    </style>
    <div class="cal-hdr">
      <button class="cal-nav" id="calPrev">◀</button>
      <span class="cal-title">${monthName(month)} ${year}</span>
      <button class="cal-nav" id="calNext">▶</button>
    </div>
    <div class="cal-dow-row">${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div style="margin-top:10px;display:flex;gap:16px;font-size:11px;color:#888">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#166534;margin-right:4px;vertical-align:middle"></span>Pay day / income</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#7f1d1d;margin-right:4px;vertical-align:middle"></span>Bill (category colour)</span>
    </div>
  `;

  document.getElementById('calPrev').addEventListener('click', () => {
    const d = new Date(calYear, calMonth - 2, 1);
    renderCalendar(d.getFullYear(), d.getMonth() + 1);
  });
  document.getElementById('calNext').addEventListener('click', () => {
    const d = new Date(calYear, calMonth, 1);
    renderCalendar(d.getFullYear(), d.getMonth() + 1);
  });
}

function hexDarken(hex) {
  const h = hex.replace('#', '');
  const r = Math.round(parseInt(h.slice(0, 2), 16) * 0.25);
  const g = Math.round(parseInt(h.slice(2, 4), 16) * 0.25);
  const b = Math.round(parseInt(h.slice(4, 6), 16) * 0.25);
  return `rgb(${r},${g},${b})`;
}

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Accounts ──────────────────────────────────────────────────────────────
const ACCT_SWATCHES = ['#4a9eff','#f7a4a2','#ff6b6b','#ffd700','#4ade80','#c39bd3'];

pages.accounts = async function(mode = null, editId = null) {
  invalidateAccounts();
  const accounts = await getAccounts();
  const editAcc = editId ? accounts.find(a => a.id === editId) : null;

  const cardsHtml = accounts.length === 0
    ? '<p style="color:var(--muted)">No accounts yet.</p>'
    : `<div class="stat-grid" style="margin-bottom:20px">${accounts.map(a => `
        <div class="stat-card" style="border-left:3px solid ${a.colour}">
          <div class="label">${esc(a.name)}</div>
          <div class="value">${fmt(a.balance)}</div>
          <div class="sub">Opening ${fmt(a.opening_balance)}</div>
          <div style="margin-top:12px">
            <button class="btn btn-ghost btn-sm" onclick="pages.accounts('edit',${a.id})">Edit</button>
          </div>
        </div>`).join('')}</div>`;

  const formAcc = editAcc ?? { name: '', type: 'current', opening_balance: 0, colour: ACCT_SWATCHES[0] };
  const swatchesHtml = ACCT_SWATCHES.map(c => `
    <div class="acct-swatch" data-colour="${c}"
      onclick="window._acctColour='${c}';document.querySelectorAll('.acct-swatch').forEach(s=>s.style.outline='none');this.style.outline='2px solid #fff';this.style.outlineOffset='2px'"
      style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;display:inline-block;${formAcc.colour===c?'outline:2px solid #fff;outline-offset:2px':''}">
    </div>`).join('');

  const formHtml = `
    <div class="card">
      <div class="chart-title" style="margin-bottom:14px">${mode === 'edit' ? 'Edit Account' : 'New Account'}</div>
      <div class="form-row">
        <input type="text"   id="accName"    placeholder="Account name" value="${esc(formAcc.name)}" style="flex:2;min-width:160px">
        <select id="accType" style="flex:1;min-width:120px">
          <option value="current" ${formAcc.type==='current'?'selected':''}>Current</option>
          <option value="savings" ${formAcc.type==='savings'?'selected':''}>Savings</option>
          <option value="card"    ${formAcc.type==='card'   ?'selected':''}>Card</option>
        </select>
        <input type="number" id="accOpening" placeholder="Opening balance (£)" value="${formAcc.opening_balance}" step="0.01" style="min-width:170px">
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:12px;color:var(--muted)">Colour:</span>
        ${swatchesHtml}
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" id="accSaveBtn">${mode === 'edit' ? 'Save Changes' : 'Save Account'}</button>
        <button class="btn btn-ghost" onclick="pages.accounts()">Cancel</button>
        ${mode === 'edit' ? `<button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="deactivateAccount(${editId})">Deactivate</button>` : ''}
      </div>
    </div>`;

  main().innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Accounts</h1>
      ${mode
        ? `<button class="btn btn-ghost" onclick="pages.accounts()">Cancel</button>`
        : `<button class="btn btn-primary" onclick="pages.accounts('add')">+ Add Account</button>`}
    </div>
    ${cardsHtml}
    ${mode ? formHtml : ''}
  `;

  if (mode) {
    window._acctColour = formAcc.colour;
    $('accSaveBtn').addEventListener('click', async () => {
      const name    = $('accName').value.trim();
      const type    = $('accType').value;
      const opening = parseFloat($('accOpening').value) || 0;
      const colour  = window._acctColour || ACCT_SWATCHES[0];
      if (!name) { $('accName').focus(); return; }
      if (mode === 'edit') {
        await api(`/accounts/${editId}`, { method: 'PATCH', body: { name, type, opening_balance: opening, colour } });
      } else {
        await api('/accounts', { method: 'POST', body: { name, type, opening_balance: opening, colour } });
      }
      pages.accounts();
    });
  }
};

window.deactivateAccount = async function(id) {
  const accts = await getAccounts();
  const acc = accts.find(a => a.id === id);
  const name = acc ? acc.name : 'this account';
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <h3>Deactivate "${esc(name)}"?</h3>
      <p>This account will be hidden. Existing transactions and balances are kept.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="dAccNo">Cancel</button>
        <button class="btn btn-danger" id="dAccYes">Deactivate</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  $('dAccNo').addEventListener('click', () => modal.remove());
  $('dAccYes').addEventListener('click', async () => {
    modal.remove();
    await api(`/accounts/${id}/deactivate`, { method: 'PATCH' });
    pages.accounts();
  });
};

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function clampDueDay(day, year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  return Math.min(day, lastDay);
}

// ── Daily Spending ────────────────────────────────────────────────────────
pages.spending = async function (year, month, categoryId = null, accountId = null) {
  invalidateAccounts();
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;

  const catQuery  = categoryId ? `&category_id=${categoryId}` : '';
  const acctQuery = accountId  ? `&account_id=${accountId}`   : '';
  const [cats, txns, accounts] = await Promise.all([
    getCategories(),
    api(`/transactions?year=${year}&month=${month}${catQuery}${acctQuery}`),
    getAccounts(),
  ]);

  const grouped = {};
  for (const t of txns) {
    if (!grouped[t.date]) grouped[t.date] = [];
    grouped[t.date].push(t);
  }

  const catOptions = cats.map(c =>
    `<option value="${c.id}">${c.name}</option>`).join('');

  main().innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Daily Spending</h1>
      <div style="display:flex;align-items:center;gap:8px">
        <label style="color:var(--muted);font-size:12px">Filter:</label>
        <select id="catFilter" style="min-width:140px">
          <option value="">All categories</option>
          ${catOptions}
        </select>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn ${!accountId ? 'btn-primary' : 'btn-ghost'} btn-sm"
        onclick="pages.spending(${year},${month},${JSON.stringify(categoryId)},null)">All</button>
      ${accounts.map(a => `
        <button class="btn ${accountId === a.id ? 'btn-primary' : 'btn-ghost'} btn-sm"
          style="display:flex;align-items:center;gap:5px"
          onclick="pages.spending(${year},${month},${JSON.stringify(categoryId)},${a.id})">
          <span style="width:8px;height:8px;border-radius:50%;background:${esc(a.colour)};display:inline-block;flex-shrink:0"></span>${esc(a.name)}
        </button>`).join('')}
    </div>
    <div class="card" style="margin-bottom:20px">
      <form id="txnForm" class="form-row" style="margin:0">
        <input type="number" id="txnAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:120px" required>
        <input type="text"   id="txnDesc"   placeholder="Description" style="flex:1;min-width:160px" required>
        <select id="txnCat"  style="flex:1;min-width:140px">${catOptions}</select>
        <select id="txnAcct" style="min-width:160px">
          ${accounts.map(a => `<option value="${a.id}" ${accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
        <input type="date" id="txnDate" value="${toDateInput(now)}" style="width:150px" required>
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
    </div>
    <div class="month-nav">
      <button class="btn btn-ghost btn-sm" id="prevMonth">◀</button>
      <span class="month-label">${monthName(month)} ${year}</span>
      <button class="btn btn-ghost btn-sm" id="nextMonth">▶</button>
    </div>
    <div id="txnList">
      ${Object.keys(grouped).sort((a,b) => b.localeCompare(a)).map(date => {
        const items = grouped[date];
        const dayTotal = items.reduce((s, t) => s + t.amount, 0);
        return `<div class="day-group">
          <div class="day-header"><span>${formatDate(date)}</span><span>${fmt(dayTotal)}</span></div>
          <div class="list">
            ${items.map(t => `
              <div class="list-item" id="txn-${t.id}">
                <span class="dot" style="background:${t.category_colour}"></span>
                <span class="desc">${esc(t.description)}
                  <br><span style="color:var(--muted);font-size:12px">${esc(t.category_name)} · <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${esc(t.account_colour ?? 'var(--muted)')};vertical-align:middle;margin-right:3px"></span>${t.account_name ? esc(t.account_name) : 'Unassigned'}</span>
                </span>
                <span class="amount">${fmt(t.amount)}</span>
                <button class="btn btn-ghost btn-sm" onclick="editTxn(${t.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteTxn(${t.id})">Del</button>
              </div>`).join('')}
          </div>
        </div>`;
      }).join('') || '<p style="color:var(--muted)">No transactions this month.</p>'}
    </div>
  `;

  $('txnForm').addEventListener('submit', async e => {
    e.preventDefault();
    await api('/transactions', { method: 'POST', body: {
      amount: parseFloat($('txnAmount').value),
      description: $('txnDesc').value,
      category_id: Number($('txnCat').value),
      account_id: $('txnAcct').value ? Number($('txnAcct').value) : null,
      date: $('txnDate').value,
    }});
    pages.spending(year, month, categoryId, accountId);
  });

  $('catFilter').addEventListener('change', () => {
    const catId = $('catFilter').value;
    pages.spending(year, month, catId ? Number(catId) : null, accountId);
  });

  $('prevMonth').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
  });
  $('nextMonth').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
  });
};

window.deleteTxn = async function(id) {
  if (!confirm('Delete this transaction?')) return;
  await api(`/transactions/${id}`, { method: 'DELETE' });
  document.getElementById(`txn-${id}`)?.closest('.day-group')?.remove();
};

window.editTxn = async function(id) {
  const cats = await getCategories();
  const row = document.getElementById(`txn-${id}`);
  const catOptions = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  row.innerHTML = `
    <input type="number" id="ea" value="${row.querySelector('.amount').textContent.replace('£','').replace(',','')}" style="width:90px">
    <input type="text" id="ed" value="${row.querySelector('.desc').childNodes[0].textContent.trim()}" style="flex:1">
    <select id="ec" style="min-width:120px">${catOptions}</select>
    <button class="btn btn-primary btn-sm" onclick="saveEditTxn(${id})">Save</button>
    <button class="btn btn-ghost btn-sm" onclick="pages.spending()">Cancel</button>
  `;
};

window.saveEditTxn = async function(id) {
  await api(`/transactions/${id}`, { method: 'PUT', body: {
    amount: parseFloat($('ea').value),
    description: $('ed').value,
    category_id: Number($('ec').value),
  }});
  pages.spending();
};

function toDateInput(d) {
  return d.toISOString().split('T')[0];
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
}

// ── Bills ─────────────────────────────────────────────────────────────────
pages.bills = async function (year, month) {
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;

  const [cats, bills, accounts] = await Promise.all([
    getCategories(),
    api(`/bills?year=${year}&month=${month}`),
    getAccounts(),
  ]);

  const active    = bills.filter(b => b.active);
  const cancelled = bills.filter(b => !b.active);
  const catOptions = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Bills</h1></div>
    <div class="month-nav">
      <button class="btn btn-ghost btn-sm" id="billPrev">◀</button>
      <span class="month-label">${monthName(month)} ${year}</span>
      <button class="btn btn-ghost btn-sm" id="billNext">▶</button>
    </div>

    <div class="card" style="margin-bottom:20px">
      <form id="billForm" class="form-row" style="margin:0">
        <input type="text"   id="bName"   placeholder="Bill name" style="flex:1" required>
        <input type="number" id="bAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:110px" required>
        <input type="number" id="bDay"    placeholder="Due day" min="1" max="31" style="width:90px" required>
        <select id="bCat"  style="flex:1">${catOptions}</select>
        <select id="bAcct" style="min-width:160px">
          ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" type="submit">Add Bill</button>
      </form>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="chart-title" style="margin-bottom:12px">Active Bills</div>
      <div class="list">
        ${active.length === 0 ? '<p style="color:var(--muted)">No active bills.</p>' :
          active.map(b => {
            const today = new Date().getDate();
            const overdue = !b.paid && b.due_day < today && year === now.getFullYear() && month === now.getMonth()+1;
            const badge = b.paid ? 'badge-paid' : overdue ? 'badge-overdue' : 'badge-unpaid';
            const effectiveDay = clampDueDay(b.due_day, year, month);
            const label = b.paid ? 'PAID' : overdue ? 'OVERDUE' : `DUE ${effectiveDay}${ordinal(effectiveDay)}`;
            return `<div class="list-item">
              <span class="dot" style="background:${b.category_colour}"></span>
              <span class="desc"><strong>${b.name}</strong> <span style="color:var(--muted);font-size:12px">${b.category_name}</span></span>
              <span class="amount">${fmt(b.amount)}</span>
              <span class="badge ${badge}">${label}</span>
              ${!b.paid ? `<button class="btn btn-primary btn-sm" onclick="payBill(${b.bill_month_id},${b.amount})">Mark Paid</button>` : ''}
              <button class="btn btn-danger btn-sm" data-bname="${esc(b.name)}" onclick="cancelBill(${b.id},this.dataset.bname)">Cancel</button>
            </div>`;
          }).join('')}
      </div>
    </div>

    ${cancelled.length > 0 ? `
    <div class="card">
      <div class="chart-title" style="margin-bottom:12px">Cancelled Bills</div>
      <div class="list">
        ${cancelled.map(b => `
          <div class="list-item" style="opacity:0.5">
            <span class="dot" style="background:${b.category_colour}"></span>
            <span class="desc">${b.name}</span>
            <span style="color:var(--muted);font-size:12px">Cancelled</span>
          </div>`).join('')}
      </div>
    </div>` : ''}
  `;

  $('billForm').addEventListener('submit', async e => {
    e.preventDefault();
    await api('/bills', { method: 'POST', body: {
      name: $('bName').value,
      amount: parseFloat($('bAmount').value),
      due_day: Number($('bDay').value),
      category_id: Number($('bCat').value),
      account_id: $('bAcct').value ? Number($('bAcct').value) : null,
    }});
    pages.bills(year, month);
  });

  $('billPrev').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.bills(d.getFullYear(), d.getMonth() + 1);
  });
  $('billNext').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.bills(d.getFullYear(), d.getMonth() + 1);
  });
};

window.payBill = async function(billMonthId, defaultAmount) {
  const input = prompt(`Amount paid (default: £${defaultAmount}):`, defaultAmount);
  if (input === null) return;
  const amount_paid = parseFloat(input) || defaultAmount;
  await api(`/bill-months/${billMonthId}/pay`, { method: 'POST', body: { amount_paid } });
  pages.bills();
};

window.cancelBill = async function(id, name) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <h3>Cancel "${esc(name)}"?</h3>
      <p>This bill will stop appearing in future months. All past payment history will be kept.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelNo">Keep it</button>
        <button class="btn btn-danger" id="cancelYes">Cancel Bill</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  $('cancelNo').addEventListener('click',  () => modal.remove());
  $('cancelYes').addEventListener('click', async () => {
    modal.remove();
    await api(`/bills/${id}/cancel`, { method: 'PATCH' });
    pages.bills();
  });
};

// ── Income ────────────────────────────────────────────────────────────────
pages.income = async function (year, month, mode) {
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;
  mode  = mode  ?? 'oneoff';

  const [entries, schedules, accounts] = await Promise.all([
    api(`/income?year=${year}&month=${month}`),
    api('/income/schedules'),
    getAccounts(),
  ]);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const activeSchedules = schedules.filter(s => s.active);

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Income</h1></div>

    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;gap:0;margin-bottom:16px">
        <button class="btn ${mode === 'oneoff' ? 'btn-primary' : 'btn-ghost'}"
          style="border-radius:6px 0 0 6px;border-right:none"
          onclick="pages.income(${year},${month},'oneoff')">One-off</button>
        <button class="btn ${mode === 'recurring' ? 'btn-primary' : 'btn-ghost'}"
          style="border-radius:0 6px 6px 0"
          onclick="pages.income(${year},${month},'recurring')">Recurring</button>
      </div>

      ${mode === 'oneoff' ? `
        <form id="incForm" class="form-row" style="margin:0">
          <input type="number" id="incAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:140px" required>
          <input type="text"   id="incDesc"   placeholder="Source / description" style="flex:1" required>
          <select id="incAcct" style="min-width:160px">
            ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
          </select>
          <input type="date"   id="incDate"   value="${toDateInput(now)}" style="width:150px" required>
          <button class="btn btn-primary" type="submit">Add Income</button>
        </form>
      ` : `
        <form id="incSchedForm" class="form-row" style="margin:0;flex-wrap:wrap">
          <input type="text"   id="schedName"   placeholder="Name (e.g. Salary)" style="flex:1;min-width:160px" required>
          <input type="number" id="schedAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:140px" required>
          <select id="schedFreq" style="min-width:190px" onchange="renderFreqFields()">
            <option value="monthly">Specific day each month</option>
            <option value="weekly">Weekly</option>
            <option value="four_weekly">Every 4 weeks</option>
          </select>
          <select id="schedAcct" style="min-width:160px">
            ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
          </select>
          <div id="schedFreqFields" style="display:contents"></div>
          <button class="btn btn-primary" type="submit">Add Schedule</button>
        </form>
      `}
    </div>

    ${mode === 'recurring' ? `
      <div class="card" style="margin-bottom:20px">
        <div class="chart-title">Recurring Sources</div>
        <div class="list" style="margin-top:12px">
          ${activeSchedules.length === 0
            ? '<p style="color:var(--muted)">No recurring income sources set up yet.</p>'
            : activeSchedules.map(s => {
                const freqLabel = s.frequency === 'monthly'
                  ? `Day ${s.day_of_month} each month`
                  : s.frequency === 'weekly'
                  ? `Weekly from ${s.anchor_date}`
                  : `Every 4 weeks from ${s.anchor_date}`;
                return `<div class="list-item" id="sched-${s.id}">
                  <span class="dot" style="background:#4ade80"></span>
                  <span class="desc">${s.name}
                    <span style="color:var(--muted);font-size:12px">${freqLabel}</span>
                  </span>
                  <span class="amount">${fmt(s.amount)}</span>
                  <button class="btn btn-danger btn-sm" onclick="deactivateSchedule(${s.id})">Deactivate</button>
                </div>`;
              }).join('')}
        </div>
      </div>
    ` : ''}

    <div class="month-nav">
      <button class="btn btn-ghost btn-sm" id="incPrev">◀</button>
      <span class="month-label">${monthName(month)} ${year}</span>
      <button class="btn btn-ghost btn-sm" id="incNext">▶</button>
    </div>
    <div class="stat-card" style="margin-bottom:20px;max-width:280px">
      <div class="label">Total Income</div>
      <div class="value">${fmt(total)}</div>
      <div class="sub">${monthName(month)} ${year}</div>
    </div>
    <div class="list">
      ${entries.length === 0
        ? '<p style="color:var(--muted)">No income entries this month.</p>'
        : entries.map(e => `
          <div class="list-item" id="inc-${e.id}">
            <span class="dot" style="background:${e.source_schedule_id != null ? '#4ade80' : 'var(--accent)'}"></span>
            <span class="desc">${e.description}${e.source_schedule_id != null
              ? ' <span style="color:var(--muted);font-size:11px">recurring</span>' : ''}</span>
            <span class="date">${formatDate(e.date)}</span>
            <span class="amount">${fmt(e.amount)}</span>
            ${e.source_schedule_id == null
              ? `<button class="btn btn-danger btn-sm" onclick="deleteIncome(${e.id})">Del</button>`
              : ''}
          </div>`).join('')}
    </div>
  `;

  if (mode === 'oneoff') {
    $('incForm').addEventListener('submit', async e => {
      e.preventDefault();
      await api('/income', { method: 'POST', body: {
        amount: parseFloat($('incAmount').value),
        description: $('incDesc').value,
        account_id: $('incAcct').value ? Number($('incAcct').value) : null,
        date: $('incDate').value,
      }});
      pages.income(year, month, 'oneoff');
    });
  }

  if (mode === 'recurring') {
    renderFreqFields();
    $('incSchedForm').addEventListener('submit', async e => {
      e.preventDefault();
      const freq = $('schedFreq').value;
      const body = {
        name: $('schedName').value,
        amount: parseFloat($('schedAmount').value),
        frequency: freq,
        account_id: $('schedAcct').value ? Number($('schedAcct').value) : null,
      };
      if (freq === 'monthly') {
        body.day_of_month = Number($('schedDay').value);
      } else {
        body.anchor_date = $('schedAnchor').value;
      }
      await api('/income/schedules', { method: 'POST', body });
      pages.income(year, month, 'recurring');
    });
  }

  $('incPrev').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.income(d.getFullYear(), d.getMonth() + 1, mode);
  });
  $('incNext').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.income(d.getFullYear(), d.getMonth() + 1, mode);
  });
};

window.renderFreqFields = function () {
  const freq = document.getElementById('schedFreq')?.value;
  const container = document.getElementById('schedFreqFields');
  if (!container) return;
  if (freq === 'monthly') {
    container.innerHTML = `<input type="number" id="schedDay" placeholder="Day of month (1–31)"
      min="1" max="31" style="width:185px" required>`;
  } else {
    container.innerHTML = `<input type="date" id="schedAnchor"
      title="First pay date" style="width:160px" required>`;
  }
};

window.deactivateSchedule = async function (id) {
  if (!confirm('Deactivate this recurring source? Existing entries stay; no new ones will be created.')) return;
  await api(`/income/schedules/${id}/deactivate`, { method: 'PATCH' });
  document.getElementById(`sched-${id}`)?.remove();
};

window.deleteIncome = async function (id) {
  if (!confirm('Delete this income entry?')) return;
  await api(`/income/${id}`, { method: 'DELETE' });
  document.getElementById(`inc-${id}`)?.remove();
};

// ── Transfers ─────────────────────────────────────────────────────────────
pages.transfers = async function () {
  invalidateAccounts();
  const [transfers, accounts] = await Promise.all([
    api('/transfers'),
    getAccounts(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const acctOptions = accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Transfers</h1></div>

    <div class="card" style="margin-bottom:20px">
      <form id="txfrForm" class="form-row" style="margin:0;flex-wrap:wrap">
        <select id="txfrFrom" style="min-width:160px" required>${acctOptions}</select>
        <span style="color:var(--muted);font-size:18px;align-self:center">→</span>
        <select id="txfrTo" style="min-width:160px" required>${acctOptions}</select>
        <input type="number" id="txfrAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:120px" required>
        <input type="date"   id="txfrDate"   value="${today}" style="width:150px" required>
        <input type="text"   id="txfrNote"   placeholder="Note (optional)" style="flex:1;min-width:160px">
        <button class="btn btn-primary" type="submit">Transfer</button>
      </form>
    </div>

    <div class="card">
      <div class="chart-title" style="margin-bottom:12px">History</div>
      <div class="list" id="txfrList">
        ${transfers.length === 0
          ? '<p style="color:var(--muted)">No transfers yet.</p>'
          : transfers.map(t => `
            <div class="list-item" id="txfr-${t.id}">
              <span class="dot" style="background:${esc(t.from_account_colour)}"></span>
              <span style="font-size:13px">${esc(t.from_account_name)}</span>
              <span style="color:var(--muted)">→</span>
              <span class="dot" style="background:${esc(t.to_account_colour)}"></span>
              <span class="desc">${esc(t.to_account_name)}${t.note ? ` <span style="color:var(--muted);font-size:12px">${esc(t.note)}</span>` : ''}</span>
              <span class="date">${formatDate(t.date)}</span>
              <span class="amount">${fmt(t.amount)}</span>
              <button class="btn btn-danger btn-sm" onclick="deleteTransfer(${t.id})">Del</button>
            </div>`).join('')}
      </div>
    </div>
  `;

  $('txfrForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fromId = Number($('txfrFrom').value);
    const toId   = Number($('txfrTo').value);
    if (fromId === toId) {
      alert('From and To accounts must be different.');
      return;
    }
    await api('/transfers', { method: 'POST', body: {
      from_account_id: fromId,
      to_account_id:   toId,
      amount:          parseFloat($('txfrAmount').value),
      date:            $('txfrDate').value,
      note:            $('txfrNote').value || null,
    }});
    invalidateAccounts();
    pages.transfers();
  });
};

window.deleteTransfer = async function (id) {
  if (!confirm('Delete this transfer?')) return;
  await api(`/transfers/${id}`, { method: 'DELETE' });
  invalidateAccounts();
  document.getElementById(`txfr-${id}`)?.remove();
  const list = document.getElementById('txfrList');
  if (list && list.children.length === 0)
    list.innerHTML = '<p style="color:var(--muted)">No transfers yet.</p>';
};

// ── Reports ───────────────────────────────────────────────────────────────
let reportChart = null;

pages.reports = async function (year, month) {
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;

  const prevDate = new Date(year, month - 2, 1);
  const prevYear = prevDate.getFullYear(), prevMonth = prevDate.getMonth() + 1;

  const [curr, prev] = await Promise.all([
    api(`/summary/${year}/${month}`),
    api(`/summary/${prevYear}/${prevMonth}`),
  ]);

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Reports</h1></div>
    <div class="month-nav">
      <button class="btn btn-ghost btn-sm" id="repPrev">◀</button>
      <span class="month-label">${monthName(month)} ${year}</span>
      <button class="btn btn-ghost btn-sm" id="repNext">▶</button>
    </div>
    <div style="margin-bottom:24px">
      <div class="card">
        <div class="chart-title">Spending by Category</div>
        <canvas id="reportChart" height="220"></canvas>
      </div>
      <div class="card">
        <div class="chart-title">Top Categories</div>
        <div class="list" style="margin-top:8px">
          ${curr.byCategory.filter(c => c.total > 0).slice(0, 6).map((c, i) => `
            <div class="list-item">
              <span style="color:var(--muted);font-size:12px;min-width:18px">#${i+1}</span>
              <span class="dot" style="background:${c.colour}"></span>
              <span class="desc">${c.name}</span>
              <span class="amount">${fmt(c.total)}</span>
            </div>`).join('') || '<p style="color:var(--muted)">No spending this month.</p>'}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="chart-title">Month Comparison: ${monthName(month)} vs ${monthName(prevMonth)}</div>
      <table style="width:100%;margin-top:12px;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="color:var(--muted)">
            <th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--border)">Category</th>
            <th style="text-align:right;padding:8px 0;border-bottom:1px solid var(--border)">${monthName(prevMonth)}</th>
            <th style="text-align:right;padding:8px 0;border-bottom:1px solid var(--border)">${monthName(month)}</th>
            <th style="text-align:right;padding:8px 0;border-bottom:1px solid var(--border)">Change</th>
          </tr>
        </thead>
        <tbody>
          ${curr.byCategory.filter(c => {
            const p = prev.byCategory.find(x => x.name === c.name);
            return c.total > 0 || (p && p.total > 0);
          }).map(c => {
            const p = prev.byCategory.find(x => x.name === c.name);
            const prevTotal = p ? p.total : 0;
            const diff = c.total - prevTotal;
            const colour = diff > 0 ? 'var(--danger)' : diff < 0 ? 'var(--success)' : 'var(--muted)';
            return `<tr>
              <td style="padding:8px 0;border-bottom:1px solid var(--border)">
                <span class="dot" style="background:${c.colour}"></span>${c.name}
              </td>
              <td style="text-align:right;padding:8px 0;border-bottom:1px solid var(--border);color:var(--muted)">${fmt(prevTotal)}</td>
              <td style="text-align:right;padding:8px 0;border-bottom:1px solid var(--border)">${fmt(c.total)}</td>
              <td style="text-align:right;padding:8px 0;border-bottom:1px solid var(--border);color:${colour}">
                ${diff === 0 ? '—' : (diff > 0 ? '+' : '') + fmt(diff)}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (reportChart) { reportChart.destroy(); reportChart = null; }
  const catData = curr.byCategory.filter(c => c.total > 0);
  if (catData.length > 0) {
    reportChart = new Chart($('reportChart'), {
      type: 'bar',
      data: {
        labels: catData.map(c => c.name),
        datasets: [{ data: catData.map(c => c.total), backgroundColor: catData.map(c => c.colour), borderWidth: 0 }],
      },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: '#888', callback: v => '£'+v }, grid: { color: '#2a2a2a' } },
                  y: { ticks: { color: '#888' }, grid: { color: '#2a2a2a' } } } },
    });
  }

  $('repPrev').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.reports(d.getFullYear(), d.getMonth() + 1);
  });
  $('repNext').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.reports(d.getFullYear(), d.getMonth() + 1);
  });
};

// ── Settings ──────────────────────────────────────────────────────────────
pages.settings = async function (activeTab = 'categories') {
  invalidateCategories();
  const [cats, version] = await Promise.all([
    getCategories(),
    api('/update/version').catch(() => ({ hash: 'unknown', message: '', date: '', version: '?' })),
  ]);

  const tab = t => {
    const labels = { categories: 'Categories', updates: 'Updates', system: 'System' };
    return `<button class="tab-btn ${activeTab === t ? 'active' : ''}" onclick="pages.settings('${t}')">${labels[t]}</button>`;
  };

  const categoriesHTML = `
    <div class="card">
      <div class="chart-title" style="margin-bottom:16px">Categories</div>
      <form id="catForm" class="form-row" style="margin-bottom:20px">
        <input type="text"  id="catName"   placeholder="Category name" style="flex:1" required>
        <input type="color" id="catColour" value="#f7a4a2" style="width:50px;padding:2px">
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
      <div class="list" id="catList">
        ${cats.map(c => `
          <div class="list-item" id="cat-${c.id}">
            <span class="dot" style="background:${c.colour}"></span>
            <span class="desc">${c.name}</span>
            <button class="btn btn-ghost btn-sm" onclick="editCat(${c.id},'${c.name}','${c.colour}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCat(${c.id})">Del</button>
          </div>`).join('')}
      </div>
    </div>`;

  const updatesHTML = `
    <div class="card">
      <div class="chart-title" style="margin-bottom:8px">Version Info</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <span class="badge badge-paid" style="font-size:12px;padding:4px 12px">v${version.version}</span>
        <code style="background:var(--bg);border:1px solid var(--border);padding:3px 8px;border-radius:6px;font-size:12px;color:var(--muted)">${version.hash}</code>
        ${version.message ? `<span style="color:var(--muted);font-size:12px">${version.message}</span>` : ''}
      </div>
      <div id="checkStatus" style="margin-bottom:12px"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="checkBtn" onclick="checkForUpdates()">Check for Updates</button>
        <button class="btn btn-primary" id="updateBtn" onclick="triggerUpdate()">Update Now</button>
      </div>
      <p style="color:var(--muted);font-size:11px;margin-top:12px">
        Pulls the latest code from GitHub, installs any new dependencies, and restarts the app automatically.
      </p>
    </div>`;

  const systemHTML = `
    <div class="card" style="margin-bottom:20px">
      <div class="chart-title" style="margin-bottom:8px">Restart App</div>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px">
        Restarts the Node.js process. The app will be offline for a few seconds. Use after making manual config changes.
      </p>
      <div id="restartStatus" style="margin-bottom:12px"></div>
      <button class="btn btn-ghost" id="restartBtn" onclick="triggerRestart()">Restart App</button>
    </div>
    <div class="card" style="margin-bottom:20px;border-color:#ff4444">
      <div class="chart-title" style="margin-bottom:8px;color:#ff4444">Danger Zone</div>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px">
        Permanently deletes all transactions, income, bills, and accounts. Categories are kept. This cannot be undone.
      </p>
      <button class="btn btn-danger" onclick="clearAllData()">Clear All Data</button>
    </div>
    <div class="card">
      <div class="chart-title" style="margin-bottom:8px">About</div>
      <p style="color:var(--muted);font-size:13px;line-height:2">
        FinTrack v${version.version}<br>
        Node.js &middot; Express &middot; SQLite &middot; Chart.js<br>
        <a href="https://github.com/CtrlAltcouk/fintrack" target="_blank" style="color:var(--accent)">github.com/CtrlAltcouk/fintrack</a>
      </p>
    </div>`;

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Settings</h1></div>
    <div class="tabs-nav">
      ${tab('categories')}${tab('updates')}${tab('system')}
    </div>
    ${activeTab === 'categories' ? categoriesHTML : ''}
    ${activeTab === 'updates'    ? updatesHTML    : ''}
    ${activeTab === 'system'     ? systemHTML     : ''}
  `;

  if (activeTab === 'categories') {
    $('catForm').addEventListener('submit', async e => {
      e.preventDefault();
      await api('/categories', { method: 'POST', body: {
        name: $('catName').value,
        colour: $('catColour').value,
      }});
      pages.settings('categories');
    });
  }
};

// ── Settings helpers ──────────────────────────────────────────────────────

window.clearAllData = function() {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <h3 style="color:#ff4444">Clear All Data?</h3>
      <p>This will permanently delete all transactions, income, bills, and accounts. Categories are kept.</p>
      <p style="margin-top:12px;font-size:13px;color:var(--muted)">Type <strong>DELETE</strong> to confirm:</p>
      <input type="text" id="clearConfirmInput" placeholder="DELETE" style="margin-top:8px;width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 12px;font-size:13px">
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn btn-ghost" id="clearNo">Cancel</button>
        <button class="btn btn-danger" id="clearYes">Clear All Data</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  $('clearNo').addEventListener('click', () => modal.remove());
  $('clearYes').addEventListener('click', async () => {
    if ($('clearConfirmInput').value.trim() !== 'DELETE') {
      $('clearConfirmInput').style.borderColor = '#ff4444';
      $('clearConfirmInput').focus();
      return;
    }
    modal.remove();
    await api('/update/clear-data', { method: 'POST' });
    invalidateAccounts();
    invalidateCategories();
    navigate('dashboard');
  });
};

function pollForRestart(statusEl, btnEl, btnLabel, onSuccess) {
  // Phase 1: wait for server to go DOWN (up to 15s)
  // Phase 2: wait for server to come back UP (up to 45s)
  let wentDown = false;
  const start = Date.now();

  statusEl.innerHTML = `<p style="color:var(--muted);font-size:13px">Waiting for app to restart...</p>`;

  const poll = setInterval(async () => {
    const elapsed = Date.now() - start;

    if (!wentDown && elapsed > 15000) {
      // Server never went down — likely the update command failed before exit
      clearInterval(poll);
      statusEl.innerHTML = `<p style="color:var(--danger);font-size:13px">Server did not restart. Run <code>pct exec 104 -- pm2 logs fintrack --lines 20 --nostream</code> on your Proxmox shell to see the error.</p>`;
      btnEl.disabled = false;
      btnEl.textContent = btnLabel;
      return;
    }

    if (wentDown && elapsed > 60000) {
      clearInterval(poll);
      statusEl.innerHTML = `<p style="color:var(--danger);font-size:13px">Timed out waiting for restart. Check pm2 logs on the server.</p>`;
      btnEl.disabled = false;
      btnEl.textContent = btnLabel;
      return;
    }

    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok && wentDown) {
        clearInterval(poll);
        onSuccess();
      }
      // Server still up — keep waiting for it to go down
    } catch (_) {
      // Server is down — now wait for it to come back
      if (!wentDown) {
        wentDown = true;
        statusEl.innerHTML = `<p style="color:var(--muted);font-size:13px">Restarting — waiting for app to come back online...</p>`;
      }
    }
  }, 1500);
}

window.checkForUpdates = async function () {
  const btn    = $('checkBtn');
  const status = $('checkStatus');
  btn.disabled = true;
  btn.textContent = 'Checking...';
  status.innerHTML = `<p style="color:var(--muted);font-size:13px">Fetching from GitHub...</p>`;
  try {
    const data = await api('/update/check');
    if (data.error) {
      status.innerHTML = `<p style="color:var(--danger);font-size:13px">${data.error}</p>`;
    } else if (data.upToDate) {
      status.innerHTML = `<p style="color:var(--success);font-size:13px">You're up to date.</p>`;
    } else {
      status.innerHTML = `<p style="color:var(--accent);font-size:13px">${data.behind} new commit${data.behind > 1 ? 's' : ''} available — click <strong>Update Now</strong> to install.</p>`;
    }
  } catch (_) {
    status.innerHTML = `<p style="color:var(--danger);font-size:13px">Could not check for updates.</p>`;
  }
  btn.disabled = false;
  btn.textContent = 'Check for Updates';
};

window.triggerUpdate = async function () {
  const btn    = $('updateBtn');
  const status = $('checkStatus');
  btn.disabled = true;
  btn.textContent = 'Updating...';
  if ($('checkBtn')) $('checkBtn').disabled = true;
  status.innerHTML = `<p style="color:var(--muted);font-size:13px">Pulling latest code from GitHub...</p>`;
  try { await fetch('/api/update', { method: 'POST' }); } catch (_) {}
  pollForRestart(status, btn, 'Update Now', () => {
    status.innerHTML = `<p style="color:var(--success);font-size:13px">Update complete! Reloading...</p>`;
    setTimeout(() => location.reload(), 2000);
  });
};

window.triggerRestart = async function () {
  const btn    = $('restartBtn');
  const status = $('restartStatus');
  btn.disabled = true;
  btn.textContent = 'Restarting...';
  try { await fetch('/api/update/restart', { method: 'POST' }); } catch (_) {}
  pollForRestart(status, btn, 'Restart App', () => {
    status.innerHTML = `<p style="color:var(--success);font-size:13px">App restarted successfully.</p>`;
    btn.disabled = false;
    btn.textContent = 'Restart App';
  });
};

window.editCat = function(id, name, colour) {
  const row = document.getElementById(`cat-${id}`);
  row.innerHTML = `
    <input type="color" id="ec-colour" value="${colour}" style="width:40px;padding:2px">
    <input type="text"  id="ec-name"   value="${name}" style="flex:1">
    <button class="btn btn-primary btn-sm" onclick="saveCat(${id})">Save</button>
    <button class="btn btn-ghost btn-sm"   onclick="pages.settings('categories')">Cancel</button>
  `;
};

window.saveCat = async function(id) {
  await api(`/categories/${id}`, { method: 'PUT', body: {
    name:   $('ec-name').value,
    colour: $('ec-colour').value,
  }});
  invalidateCategories();
  pages.settings('categories');
};

window.deleteCat = async function(id) {
  if (!confirm('Delete this category? Only works if no transactions use it.')) return;
  const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
  if (res.status === 409) {
    alert('Cannot delete — transactions are using this category.');
    return;
  }
  invalidateCategories();
  pages.settings('categories');
};

navigate('dashboard');
