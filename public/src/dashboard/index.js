export function installDashboard(ctx) {
  const {
    $, main, fmt, monthName, renderPageHeader, renderSectionHeader,
    renderCurrency, api, getAccounts, invalidateAccounts, pages, esc,
    computePeriods, calGridBounds, Chart, createChart, destroyChart,
  } = ctx;
let barChart = null, donutChart = null;
let calYear = null, calMonth = null;
let calPeriodIndex = 0;
let _dashData = null; // cached for edit mode re-renders without API calls
let _payPeriodSettings = null;

const WIDGET_NAMES = {
  stats:       'Monthly Stats',
  accounts:    'Account Balances',
  bar_chart:   'Income vs Spending',
  donut_chart: 'Spending by Category',
  calendar:    'Calendar',
};

function _widgetHtml(id, summary, accounts) {
  if (id === 'stats') {
    const isPP = !!_dashData?.payPeriodMode;
    const periodLabel = isPP && _dashData?.periods ? _dashData.periods[0].label : '';
    return `
    <div class="stat-grid ui-responsive-grid ui-responsive-grid--three dashboard-summary-grid">
      <div class="stat-card ui-stat-card ui-summary-card dashboard-stat dashboard-stat-income">
        <div class="dashboard-stat-heading">
          <span class="dashboard-stat-dot" aria-hidden="true"></span>
          <div class="label">Income</div>
        </div>
        <div class="value">${renderCurrency(summary.income)}</div>
        <div class="sub">${isPP ? periodLabel : 'Received this month'}</div>
      </div>
      <div class="stat-card ui-stat-card ui-summary-card dashboard-stat dashboard-stat-spent">
        <div class="dashboard-stat-heading">
          <span class="dashboard-stat-dot" aria-hidden="true"></span>
          <div class="label">Spent</div>
        </div>
        <div class="value">${renderCurrency(summary.spent)}</div>
        <div class="sub">${summary.income > 0 ? Math.round(summary.spent / summary.income * 100) : 0}% of income</div>
      </div>
      <div class="stat-card highlight ui-stat-card ui-summary-card dashboard-stat dashboard-stat-remaining">
        <div class="dashboard-stat-heading">
          <span class="dashboard-stat-dot" aria-hidden="true"></span>
          <div class="label">Remaining</div>
        </div>
        <div class="value">${renderCurrency(summary.remaining)}</div>
        <div class="sub">${summary.income > 0 ? Math.round(summary.remaining / summary.income * 100) : 0}% left${isPP ? ' · ' + periodLabel : ''}</div>
      </div>
    </div>`;
  }
  if (id === 'accounts') return `
    <section class="card ui-card dashboard-card dashboard-accounts-card" aria-labelledby="dashboard-accounts-title">
      ${renderSectionHeader({
        title: 'Account balances',
        subtitle: `${accounts.length} active account${accounts.length === 1 ? '' : 's'}`,
        id: 'dashboard-accounts-title',
      })}
      <div class="ui-responsive-grid ui-responsive-grid--auto dashboard-account-grid">
        ${accounts.map(a => `
          <div class="dashboard-account-card" style="border-left-color:${esc(a.colour)}">
            <div class="label">${esc(a.name)}</div>
            <div class="value">${renderCurrency(a.balance)}</div>
            <div class="sub" style="text-transform:capitalize">${esc(a.type)}</div>
          </div>`).join('')}
      </div>
    </section>`;
  if (id === 'bar_chart') return `
    <section class="card ui-card dashboard-card dashboard-chart-card" aria-labelledby="dashboard-bar-title">
      ${renderSectionHeader({
        title: 'Income vs spending',
        subtitle: _dashData?.payPeriodMode ? 'Last 6 pay periods' : 'Last 6 months',
        id: 'dashboard-bar-title',
      })}
      <div class="dashboard-chart-frame">
        <canvas id="barChart"></canvas>
      </div>
    </section>`;
  if (id === 'donut_chart') return `
    <section class="card ui-card dashboard-card dashboard-chart-card" aria-labelledby="dashboard-donut-title">
      ${renderSectionHeader({
        title: 'Spending by category',
        subtitle: 'Where your money went',
        id: 'dashboard-donut-title',
      })}
      <div class="dashboard-chart-frame dashboard-chart-frame-donut">
        <canvas id="donutChart"></canvas>
      </div>
    </section>`;
  if (id === 'calendar') return `
    <section class="card ui-card dashboard-card dashboard-calendar-card" aria-labelledby="dashboard-calendar-title">
      ${renderSectionHeader({
        title: 'Calendar',
        subtitle: 'Upcoming income and bills',
        id: 'dashboard-calendar-title',
      })}
      <div id="calWidget" class="ui-loading-placeholder dashboard-calendar-loading" role="status" aria-live="polite">
        <span class="ui-loading-placeholder__bar ui-loading-placeholder__bar--wide" aria-hidden="true"></span>
        <span class="ui-loading-placeholder__bar" aria-hidden="true"></span>
        <span>Loading calendar…</span>
      </div>
    </section>`;
  return '';
}

let _pickerCleanup = null;

function showPicker(el, currentSize, onHover, onCommit, onCancel) {
  if (_pickerCleanup) { _pickerCleanup(); _pickerCleanup = null; }
  const rows = [1, 2, 3];
  const cols = [1, 2, 3, 4];

  const labelEl = document.createElement('div');
  labelEl.className = 'dash-picker-label';
  labelEl.textContent = `${currentSize.w} wide × ${currentSize.h} tall`;

  const picker = document.createElement('div');
  picker.className = 'dash-picker';

  rows.forEach(h => {
    const row = document.createElement('div');
    row.className = 'dash-picker-row';
    cols.forEach(w => {
      const cell = document.createElement('div');
      cell.className = 'dash-picker-cell';
      cell.dataset.w = w;
      cell.dataset.h = h;
      if (w <= currentSize.w && h <= currentSize.h) cell.classList.add('active');
      row.appendChild(cell);
    });
    picker.appendChild(row);
  });
  picker.appendChild(labelEl);
  el.appendChild(picker);

  function updateHover(w, h) {
    picker.querySelectorAll('.dash-picker-cell').forEach(c => {
      c.classList.remove('active', 'hover');
      if (+c.dataset.w <= w && +c.dataset.h <= h) c.classList.add('hover');
    });
    labelEl.textContent = `${w} wide × ${h} tall`;
    onHover(w, h);
  }

  function cleanup() {
    _pickerCleanup = null;
    document.removeEventListener('mousemove', onDocMove);
    document.removeEventListener('mouseup',   onDocUp);
    document.removeEventListener('keydown',   onDocKey);
    if (picker.parentNode) picker.parentNode.removeChild(picker);
  }

  let ignoreNextUp = true;

  function onDocMove(e) {
    ignoreNextUp = false;
    const t = e.target;
    if (t.classList.contains('dash-picker-cell') && t.closest('.dash-picker') === picker) {
      updateHover(+t.dataset.w, +t.dataset.h);
    }
  }

  function onDocUp(e) {
    if (ignoreNextUp) { ignoreNextUp = false; return; }
    const t = e.target;
    if (t.classList.contains('dash-picker-cell') && t.closest('.dash-picker') === picker) {
      const w = +t.dataset.w, h = +t.dataset.h;
      cleanup();
      onCommit(w, h);
    } else {
      cleanup();
      onCancel();
    }
  }

  function onDocKey(e) {
    if (e.key === 'Escape') { cleanup(); onCancel(); }
  }

  document.addEventListener('mousemove', onDocMove);
  document.addEventListener('mouseup',   onDocUp);
  document.addEventListener('keydown',   onDocKey);
  _pickerCleanup = cleanup;
}

function _renderDashboard(editMode, editOrder, editHidden, editSizes) {
  if (!_dashData) return;
  const { summary, accounts } = _dashData;

  barChart = destroyChart(barChart);
  donutChart = destroyChart(donutChart);

  const widgetsHtml = editOrder.map(id => {
    const isHidden = editHidden.includes(id);
    const sz = editSizes[id] ?? { w: 4, h: 1 };

    if (isHidden) {
      if (!editMode) return '';
      // Ghost slot — always full-width to avoid grid gaps
      return `
        <div class="dash-ghost dashboard-widget" data-widget="${id}"
          style="--dash-w:4;--dash-h:1;border:1px dashed #333;border-radius:8px;padding:10px 16px;
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
      return `<div class="dashboard-widget dashboard-widget-${id}" data-widget="${id}" style="--dash-w:${sz.w};--dash-h:${sz.h}">${inner}</div>`;
    }

    // Visible widget in edit mode — wrap with drag bar + resize handle
    return `
      <div class="dash-widget dashboard-widget dashboard-widget-${id}" draggable="true" data-widget="${id}"
        style="--dash-w:${sz.w};--dash-h:${sz.h};position:relative;border:1px dashed #f7a4a244;
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
        <div class="dash-resize-handle" data-widget="${id}" draggable="false"
          style="position:absolute;bottom:4px;right:4px;width:14px;height:14px;
                 border-right:2px solid #555;border-bottom:2px solid #555;
                 cursor:se-resize;border-radius:0 0 4px 0"></div>
      </div>`;
  }).join('');

  const isPP = !!_dashData?.payPeriodMode;
  const headerLabel = isPP && _dashData.periods
    ? _dashData.periods[0].label
    : `${monthName(calMonth)} ${calYear}`;
  const modeToggle = !editMode ? `
    <div class="ui-button-group dashboard-period-toggle" aria-label="Dashboard period">
      <button class="dashboard-period-option${!isPP ? ' active' : ''}" aria-pressed="${!isPP}" onclick="window.setDashMode('monthly')">Monthly</button>
      <button class="dashboard-period-option${isPP ? ' active' : ''}" aria-pressed="${isPP}" onclick="window.setDashMode('pay_period')">Pay Period</button>
    </div>` : '';
  const noPrimaryBanner = _dashData.noPrimarySchedule ? `
    <div class="ui-status-message dashboard-notice">
      <span style="color:var(--muted)">Pay Period mode is active but no primary schedule is set.</span>
      <button class="btn btn-ghost btn-sm" onclick="pages.settings('personalisation')">Configure in Settings →</button>
    </div>` : '';

  main().innerHTML = `
    <div class="ui-page dashboard-shell">
      ${renderPageHeader({
        title: 'Dashboard',
        subtitle: 'Your money at a glance',
        className: 'dashboard-header',
        introClass: 'dashboard-title-group',
        actionsClass: 'dashboard-header-actions',
        actions: `
          <span class="dashboard-period-label">${headerLabel}</span>
          ${modeToggle}
          ${editMode
            ? `<button class="btn btn-primary btn-sm" id="dashDone">✓ Done</button>`
            : `<button class="btn btn-ghost btn-sm" id="dashEdit">✏️ Edit</button>`}`,
      })}
      ${noPrimaryBanner}
      <div class="content-grid content-grid-four ui-responsive-grid dashboard-grid">
        ${widgetsHtml}
      </div>
    </div>
  `;

  // Initialise bar chart if visible
  if (!editHidden.includes('bar_chart') && $('barChart')) {
    if (_dashData.payPeriodMode && _dashData.periodSummaries) {
      const chartPeriods   = [..._dashData.periods].reverse();
      const chartSummaries = [..._dashData.periodSummaries].reverse();
      barChart = createChart(Chart, $('barChart'), {
        type: 'bar',
        data: {
          labels: chartPeriods.map(p => p.label.split(' – ')[0]),
          datasets: [
            { label: 'Income',   data: chartSummaries.map(s => s.income), backgroundColor: '#ffffff44', borderColor: '#ffffff', borderWidth: 1 },
            { label: 'Spending', data: chartSummaries.map(s => s.spent),  backgroundColor: '#f7a4a288', borderColor: '#f7a4a2', borderWidth: 1 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#888', boxWidth: 10, padding: 16 } } },
          scales: { x: { ticks: { color: '#888' }, grid: { color: '#2a2a2a' } },
                    y: { ticks: { color: '#888', callback: v => '£' + v }, grid: { color: '#2a2a2a' } } } },
      });
    } else {
      const trend = summary.monthlyTrend;
      barChart = createChart(Chart, $('barChart'), {
        type: 'bar',
        data: {
          labels: trend.map(m => monthName(Number(m.month))),
          datasets: [
            { label: 'Income',   data: trend.map(m => m.income), backgroundColor: '#ffffff44', borderColor: '#ffffff', borderWidth: 1 },
            { label: 'Spending', data: trend.map(m => m.spent),  backgroundColor: '#f7a4a288', borderColor: '#f7a4a2', borderWidth: 1 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#888', boxWidth: 10, padding: 16 } } },
          scales: { x: { ticks: { color: '#888' }, grid: { color: '#2a2a2a' } },
                    y: { ticks: { color: '#888', callback: v => '£' + v }, grid: { color: '#2a2a2a' } } } },
      });
    }
  }

  // Initialise donut chart if visible
  if (!editHidden.includes('donut_chart') && $('donutChart')) {
    const catData = summary.byCategory.filter(c => c.total > 0);
    donutChart = createChart(Chart, $('donutChart'), {
      type: 'doughnut',
      data: {
        labels: catData.map(c => c.name),
        datasets: [{ data: catData.map(c => c.total), backgroundColor: catData.map(c => c.colour), borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { color: '#888', boxWidth: 10, padding: 16 } } } },
    });
  }

  // Initialise calendar if visible
  if (!editHidden.includes('calendar')) {
    if (_dashData.payPeriodMode && _dashData.periods) {
      if (!editMode) {
        const ps = new Date(_dashData.periods[0].from + 'T00:00:00');
        renderCalendar(ps.getFullYear(), ps.getMonth() + 1);
      } else {
        renderCalendar();
      }
    } else {
      renderCalendar(calYear, calMonth);
    }
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

  // Resize handles — open 2D grid picker on mousedown
  document.querySelectorAll('.dash-resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const widgetId = handle.dataset.widget;
      const el = handle.closest('[data-widget]');
      if (!el) return;
      const original = { ...(editSizes[widgetId] ?? { w: 4, h: 1 }) };

      showPicker(
        el,
        original,
        (w, h) => {
          el.style.setProperty('--dash-w', w);
          el.style.setProperty('--dash-h', h);
        },
        (w, h) => {
          editSizes[widgetId] = { w, h };
          _renderDashboard(true, editOrder, editHidden, editSizes);
        },
        () => {
          el.style.setProperty('--dash-w', original.w);
          el.style.setProperty('--dash-h', original.h);
          _renderDashboard(true, editOrder, editHidden, editSizes);
        },
      );
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
    const [summary, accounts, layout, ppSettings, schedules] = await Promise.all([
      api(`/summary/${year}/${month}`),
      getAccounts(),
      api('/settings/dashboard'),
      api('/settings/pay-period'),
      api('/income/schedules'),
    ]);
    _payPeriodSettings = ppSettings;

    let paySchedule = null;
    if (ppSettings.mode === 'pay_period' && ppSettings.primary_schedule_id) {
      paySchedule = schedules.find(s => s.id === ppSettings.primary_schedule_id && s.active);
    }

    if (paySchedule) {
      const periods = computePeriods(paySchedule, 6);
      if (periods.length > 0) {
        const periodSummaries = await Promise.all(
          periods.map(p => api(`/summary/by-range?from=${p.from}&to=${p.to}`))
        );
        _dashData = { summary: periodSummaries[0], periods, periodSummaries, accounts, layout, payPeriodMode: true, noPrimarySchedule: false };
      } else {
        _dashData = { summary, accounts, layout, payPeriodMode: false, noPrimarySchedule: true };
      }
    } else {
      _dashData = { summary, accounts, layout, payPeriodMode: false, noPrimarySchedule: ppSettings.mode === 'pay_period' };
    }

    _renderDashboard(false, [...layout.order], [...layout.hidden], { ...layout.sizes });
  } catch (e) {
    console.error('Dashboard load error:', e);
    main().innerHTML = `<div class="card" style="color:var(--muted);padding:24px">Failed to load dashboard. Please refresh.</div>`;
  }
};

window.setDashMode = async function(mode) {
  await api('/settings/pay-period', { method: 'POST', body: { mode } });
  return pages.dashboard();
};

async function renderCalendar(year, month) {
  if (year !== undefined) {
    calYear = year; calMonth = month;
    calPeriodIndex = 0;
  }

  const widget = document.getElementById('calWidget');
  if (!widget) return;

  const [ppSettings, schedules] = await Promise.all([
    api('/settings/pay-period'),
    api('/income/schedules'),
  ]);

  let paySchedule = null;
  if (ppSettings.mode === 'pay_period' && ppSettings.primary_schedule_id) {
    paySchedule = schedules.find(s => s.id === ppSettings.primary_schedule_id && s.active) || null;
  }

  if (ppSettings.mode === 'pay_period' && paySchedule) {
    const periods = computePeriods(paySchedule, 8);
    const safeIdx = Math.min(Math.max(0, calPeriodIndex), periods.length - 1);
    const period  = periods[safeIdx];

    const fromDate = new Date(period.from + 'T00:00:00');
    const toDate   = new Date(period.to   + 'T00:00:00');
    const fetches  = [api(`/calendar/${fromDate.getFullYear()}/${fromDate.getMonth() + 1}`)];
    if (fromDate.getFullYear() !== toDate.getFullYear() || fromDate.getMonth() !== toDate.getMonth()) {
      fetches.push(api(`/calendar/${toDate.getFullYear()}/${toDate.getMonth() + 1}`));
    }
    const results   = await Promise.all(fetches);
    const allEvents = results.flatMap(r => r.events).filter(ev => ev.date >= period.from && ev.date <= period.to);

    const eventsByDate = {};
    for (const ev of allEvents) {
      if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
      eventsByDate[ev.date].push(ev);
    }

    const { startSunday, endSaturday } = calGridBounds(period.from, period.to);
    const todayStr = new Date().toISOString().split('T')[0];
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    let cells = '';
    const cur = new Date(startSunday + 'T00:00:00');
    const end = new Date(endSaturday + 'T00:00:00');
    while (cur <= end) {
      const dateStr  = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      const inPeriod = dateStr >= period.from && dateStr <= period.to;
      const isToday  = dateStr === todayStr;
      if (!inPeriod) {
        cells += `<div class="cal-day cal-other"><div class="cal-num">${cur.getDate()}</div></div>`;
      } else {
        const dayEvs = eventsByDate[dateStr] || [];
        const pills  = dayEvs.map(ev => {
          if (ev.type === 'bill') {
            const bg  = hexDarken(ev.colour);
            const opa = ev.paid ? 'opacity:0.5;' : '';
            const str = ev.paid ? 'text-decoration:line-through;' : '';
            return `<div class="event-pill" style="background:${bg};color:${ev.colour};${opa}">${esc(ev.name)} <span style="${str}">${fmt(ev.amount)}</span></div>`;
          }
          return `<div class="event-pill" style="background:#166534;color:#4ade80">${esc(ev.name)} ${fmt(ev.amount)}</div>`;
        }).join('');
        cells += `<div class="cal-day${dayEvs.length ? ' cal-has' : ''}">
          <div class="cal-num${isToday ? ' cal-today' : ''}">${cur.getDate()}</div>
          ${pills}
        </div>`;
      }
      cur.setDate(cur.getDate() + 1);
    }

    const prevDisabled = safeIdx >= periods.length - 1;
    const nextDisabled = safeIdx === 0;

    widget.className = 'dashboard-calendar';
    widget.removeAttribute('role');
    widget.removeAttribute('aria-live');
    widget.innerHTML = `
      <div class="cal-hdr">
        <button class="cal-nav" id="calPrev" aria-label="Previous calendar period"${prevDisabled ? ' disabled' : ''}>◀</button>
        <span class="cal-title">${esc(period.label)}</span>
        <button class="cal-nav" id="calNext" aria-label="Next calendar period"${nextDisabled ? ' disabled' : ''}>▶</button>
      </div>
      <div class="cal-dow-row">${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-income"></span>Pay day / income</span>
        <span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-bill"></span>Bill (category colour)</span>
      </div>
    `;

    if (!prevDisabled) {
      document.getElementById('calPrev').addEventListener('click', () => {
        calPeriodIndex++;
        renderCalendar();
      });
    }
    if (!nextDisabled) {
      document.getElementById('calNext').addEventListener('click', () => {
        calPeriodIndex--;
        renderCalendar();
      });
    }
    return;
  }

  // ── Monthly path (unchanged behaviour) ──────────────────────────────────
  const data = await api(`/calendar/${calYear}/${calMonth}`);

  const eventsByDate = {};
  for (const ev of data.events) {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
    eventsByDate[ev.date].push(ev);
  }

  const firstDow = new Date(calYear, calMonth - 1, 1).getDay();
  const dim      = new Date(calYear, calMonth, 0).getDate();
  const todayStr = new Date().toISOString().split('T')[0];
  const monthPad = String(calMonth).padStart(2, '0');
  const DOW      = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div class="cal-day cal-other"></div>`;

  for (let d = 1; d <= dim; d++) {
    const dayPad  = String(d).padStart(2, '0');
    const dateStr = `${calYear}-${monthPad}-${dayPad}`;
    const isToday = dateStr === todayStr;
    const dayEvs  = eventsByDate[dateStr] || [];

    const pills = dayEvs.map(ev => {
      if (ev.type === 'bill') {
        const bg  = hexDarken(ev.colour);
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

  widget.className = 'dashboard-calendar';
  widget.removeAttribute('role');
  widget.removeAttribute('aria-live');
  widget.innerHTML = `
    <div class="cal-hdr">
      <button class="cal-nav" id="calPrev" aria-label="Previous month">◀</button>
      <span class="cal-title">${monthName(calMonth)} ${calYear}</span>
      <button class="cal-nav" id="calNext" aria-label="Next month">▶</button>
    </div>
    <div class="cal-dow-row">${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-income"></span>Pay day / income</span>
      <span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-bill"></span>Bill (category colour)</span>
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

  return {
    reset() {
      _payPeriodSettings = null;
      _dashData = null;
    },
  };
}
