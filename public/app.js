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

pages.dashboard = async function () {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  const [summary, bills] = await Promise.all([
    api(`/summary/${year}/${month}`),
    api(`/bills?year=${year}&month=${month}`),
  ]);

  const activeBills = bills.filter(b => b.active);
  const paidCount   = activeBills.filter(b => b.paid).length;

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Dashboard</h1>
      <span style="color:var(--muted);font-size:13px">${monthName(month)} ${year}</span>
    </div>
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
    </div>
    <div class="chart-grid">
      <div class="card">
        <div class="chart-title">Income vs Spending (6 months)</div>
        <canvas id="barChart" height="180"></canvas>
      </div>
      <div class="card">
        <div class="chart-title">Spending by Category</div>
        <canvas id="donutChart" height="180"></canvas>
      </div>
    </div>
    <div class="card">
      <div class="chart-title">Bills — ${monthName(month)} ${year}
        <span style="color:var(--muted);font-weight:400;font-size:12px;margin-left:8px">${paidCount}/${activeBills.length} paid</span>
      </div>
      <div class="list" style="margin-top:12px">
        ${activeBills.length === 0 ? '<p style="color:var(--muted)">No bills set up yet.</p>' :
          activeBills.map(b => {
            const today = new Date().getDate();
            const overdue = !b.paid && b.due_day < today;
            const badge = b.paid ? 'badge-paid' : overdue ? 'badge-overdue' : 'badge-unpaid';
            const effectiveDay = clampDueDay(b.due_day, year, month);
            const label = b.paid ? 'PAID' : overdue ? 'OVERDUE' : `DUE ${effectiveDay}${ordinal(effectiveDay)}`;
            return `<div class="list-item">
              <span class="dot" style="background:${b.category_colour}"></span>
              <span class="desc">${b.name}</span>
              <span class="amount">${fmt(b.amount)}</span>
              <span class="badge ${badge}">${label}</span>
            </div>`;
          }).join('')}
      </div>
    </div>
  `;

  if (barChart)   { barChart.destroy();   barChart = null; }
  if (donutChart) { donutChart.destroy(); donutChart = null; }

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
pages.spending = async function (year, month, categoryId = null) {
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;

  const catQuery = categoryId ? `&category_id=${categoryId}` : '';
  const [cats, txns] = await Promise.all([
    getCategories(),
    api(`/transactions?year=${year}&month=${month}${catQuery}`),
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
    <div class="card" style="margin-bottom:20px">
      <form id="txnForm" class="form-row" style="margin:0">
        <input type="number" id="txnAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:120px" required>
        <input type="text"   id="txnDesc"   placeholder="Description" style="flex:1;min-width:160px" required>
        <select id="txnCat" style="flex:1;min-width:140px">${catOptions}</select>
        <input type="date"   id="txnDate"   value="${toDateInput(now)}" style="width:150px" required>
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
                <span class="desc">${t.description} <span style="color:var(--muted);font-size:12px">${t.category_name}</span></span>
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
      date: $('txnDate').value,
    }});
    pages.spending(year, month);
  });

  $('catFilter').addEventListener('change', () => {
    const catId = $('catFilter').value;
    pages.spending(year, month, catId ? Number(catId) : null);
  });

  $('prevMonth').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.spending(d.getFullYear(), d.getMonth() + 1);
  });
  $('nextMonth').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.spending(d.getFullYear(), d.getMonth() + 1);
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

  const [cats, bills] = await Promise.all([
    getCategories(),
    api(`/bills?year=${year}&month=${month}`),
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
        <select id="bCat" style="flex:1">${catOptions}</select>
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
              <button class="btn btn-danger btn-sm" onclick="cancelBill(${b.id},'${b.name}')">Cancel</button>
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
      <h3>Cancel "${name}"?</h3>
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
pages.income = async function (year, month) {
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;

  const entries = await api(`/income?year=${year}&month=${month}`);
  const total = entries.reduce((s, e) => s + e.amount, 0);

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Income</h1></div>
    <div class="card" style="margin-bottom:20px">
      <form id="incForm" class="form-row" style="margin:0">
        <input type="number" id="incAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:140px" required>
        <input type="text"   id="incDesc"   placeholder="Source / description" style="flex:1" required>
        <input type="date"   id="incDate"   value="${toDateInput(now)}" style="width:150px" required>
        <button class="btn btn-primary" type="submit">Add Income</button>
      </form>
    </div>
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
      ${entries.length === 0 ? '<p style="color:var(--muted)">No income entries this month.</p>' :
        entries.map(e => `
          <div class="list-item" id="inc-${e.id}">
            <span class="dot" style="background:var(--accent)"></span>
            <span class="desc">${e.description}</span>
            <span class="date">${formatDate(e.date)}</span>
            <span class="amount">${fmt(e.amount)}</span>
            <button class="btn btn-danger btn-sm" onclick="deleteIncome(${e.id})">Del</button>
          </div>`).join('')}
    </div>
  `;

  $('incForm').addEventListener('submit', async e => {
    e.preventDefault();
    await api('/income', { method: 'POST', body: {
      amount: parseFloat($('incAmount').value),
      description: $('incDesc').value,
      date: $('incDate').value,
    }});
    pages.income(year, month);
  });

  $('incPrev').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.income(d.getFullYear(), d.getMonth() + 1);
  });
  $('incNext').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.income(d.getFullYear(), d.getMonth() + 1);
  });
};

window.deleteIncome = async function(id) {
  if (!confirm('Delete this income entry?')) return;
  await api(`/income/${id}`, { method: 'DELETE' });
  document.getElementById(`inc-${id}`)?.remove();
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
    <div class="chart-grid" style="margin-bottom:24px">
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
pages.settings = async function () {
  invalidateCategories();
  const [cats, version] = await Promise.all([
    getCategories(),
    api('/update/version').catch(() => ({ hash: 'unknown', message: '', date: '' })),
  ]);

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Settings</h1></div>

    <div class="card" style="margin-bottom:20px">
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
            <span class="desc" id="catname-${c.id}">${c.name}</span>
            <button class="btn btn-ghost btn-sm" onclick="editCat(${c.id},'${c.name}','${c.colour}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCat(${c.id})">Del</button>
          </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="chart-title" style="margin-bottom:4px">App Update</div>
      <p style="color:var(--muted);font-size:12px;margin-bottom:16px">
        Current version: <code style="background:var(--bg);padding:2px 6px;border-radius:4px;font-size:11px">${version.hash}</code>
        ${version.message ? `— ${version.message}` : ''}
      </p>
      <div id="updateStatus"></div>
      <button class="btn btn-primary" id="updateBtn" onclick="triggerUpdate()">Update Now</button>
      <p style="color:var(--muted);font-size:11px;margin-top:10px">
        Pulls the latest code from GitHub, installs any new dependencies, and restarts the app automatically.
      </p>
    </div>
  `;

  $('catForm').addEventListener('submit', async e => {
    e.preventDefault();
    await api('/categories', { method: 'POST', body: {
      name: $('catName').value,
      colour: $('catColour').value,
    }});
    pages.settings();
  });
};

window.triggerUpdate = async function () {
  const btn    = $('updateBtn');
  const status = $('updateStatus');

  btn.disabled = true;
  btn.textContent = 'Updating...';

  const setStatus = (msg, colour = 'var(--muted)') => {
    status.innerHTML = `<p style="color:${colour};font-size:13px;margin-bottom:12px">${msg}</p>`;
  };

  setStatus('Pulling latest code from GitHub...');

  try {
    await fetch('/api/update', { method: 'POST' });
  } catch (_) {
    // Expected — server may close connection as it restarts
  }

  setStatus('Restarting app — waiting for it to come back online...');

  // Poll /api/health until server responds again (up to 40s)
  const start = Date.now();
  const poll = setInterval(async () => {
    if (Date.now() - start > 40000) {
      clearInterval(poll);
      setStatus('Timed out waiting for restart. Check pm2 logs on the server.', 'var(--danger)');
      btn.disabled = false;
      btn.textContent = 'Update Now';
      return;
    }
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        clearInterval(poll);
        setStatus('Update complete! Reloading in 2 seconds...', 'var(--success)');
        setTimeout(() => location.reload(), 2000);
      }
    } catch (_) {
      // Server still restarting, keep polling
    }
  }, 1500);
};

window.editCat = function(id, name, colour) {
  const row = document.getElementById(`cat-${id}`);
  row.innerHTML = `
    <input type="color" id="ec-colour" value="${colour}" style="width:40px;padding:2px">
    <input type="text"  id="ec-name"   value="${name}" style="flex:1">
    <button class="btn btn-primary btn-sm" onclick="saveCat(${id})">Save</button>
    <button class="btn btn-ghost btn-sm"   onclick="pages.settings()">Cancel</button>
  `;
};

window.saveCat = async function(id) {
  await api(`/categories/${id}`, { method: 'PUT', body: {
    name:   $('ec-name').value,
    colour: $('ec-colour').value,
  }});
  invalidateCategories();
  pages.settings();
};

window.deleteCat = async function(id) {
  if (!confirm('Delete this category? Only works if no transactions use it.')) return;
  const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
  if (res.status === 409) {
    alert('Cannot delete — transactions are using this category.');
    return;
  }
  invalidateCategories();
  pages.settings();
};

navigate('dashboard');
