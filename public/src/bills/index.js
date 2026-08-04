export function installBills(ctx) {
  const {
    $, main, monthName, renderPageHeader, renderSectionHeader,
    renderCurrency, renderEmptyState, mountModal, api, getCategories,
    getAccounts, pages, esc, computePeriods, formatDate, ordinal,
    clampDueDay, toDateInput, submitForm,
  } = ctx;
let _billsView = { isPP: false, year: null, month: null, periodIndex: 0 };
let _billsFilters = { status: 'all', categoryId: null, accountId: null };
let _billsRefresh = () => pages.bills();

function getBillPresentation(bill, { isPP, safeIndex, year, month, now, todayStr }) {
  const paid = !!bill.paid;
  let overdue = false;
  let dueToday = false;
  let dueLabel;

  if (paid) return { key: 'paid', label: 'Paid', badge: 'badge-paid', dueLabel: bill.due_date ? formatDate(bill.due_date) : `Day ${bill.due_day}` };
  if (bill.recurrence_status === 'paused') {
    return { key: 'paused', label: 'Paused', badge: 'badge-unpaid', dueLabel: 'Paused' };
  }
  if (bill.recurrence_status === 'completed') {
    return { key: 'completed', label: 'Completed', badge: 'badge-paid', dueLabel: 'Finished' };
  }

  if (bill.due_date) {
    const currentPeriod = isPP
      ? safeIndex === 0
      : year === now.getFullYear() && month === now.getMonth() + 1;
    overdue = !paid && bill.due_date < todayStr && currentPeriod;
    dueToday = !paid && bill.due_date === todayStr && currentPeriod;
    dueLabel = formatDate(bill.due_date);
  } else {
    const currentPeriod = year === now.getFullYear() && month === now.getMonth() + 1;
    const effectiveDay = clampDueDay(bill.due_day, year, month);
    overdue = !paid && bill.due_day < now.getDate() && currentPeriod;
    dueToday = !paid && effectiveDay === now.getDate() && currentPeriod;
    dueLabel = `${effectiveDay}${ordinal(effectiveDay)}`;
  }

  if (overdue) return { key: 'overdue', label: 'Overdue', badge: 'badge-overdue', dueLabel };
  if (dueToday) return { key: 'due-today', label: 'Due today', badge: 'badge-due-today', dueLabel };
  return { key: 'upcoming', label: 'Upcoming', badge: 'badge-upcoming', dueLabel };
}

function recurrenceLabel(bill) {
  const labels = {
    daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly',
    four_weekly: 'Every four weeks', monthly: 'Monthly',
    quarterly: 'Quarterly', yearly: 'Yearly',
  };
  const base = labels[bill.recurrence_frequency] || 'Monthly';
  if (bill.end_mode === 'date') return `${base} until ${formatDate(bill.end_date)}`;
  if (bill.end_mode === 'count') return `${base} · ${bill.max_occurrences} occurrences`;
  return base;
}

pages.bills = async function (year, month, periodIndex = 0) {
  const now = new Date();
  const todayStr = toDateInput(now);

  const [cats, accounts, ppSettings, schedules] = await Promise.all([
    getCategories(),
    getAccounts(),
    api('/settings/pay-period'),
    api('/income/schedules'),
  ]);

  const isPP = ppSettings.mode === 'pay_period';
  let paySchedule = null, periods = [], safeIndex = 0;

  if (isPP && ppSettings.primary_schedule_id) {
    paySchedule = schedules.find(s => s.id === ppSettings.primary_schedule_id && s.active) || null;
  }
  if (isPP && paySchedule) {
    periods = computePeriods(paySchedule, 8);
  }

  if (isPP && periods.length === 0) {
    _billsView = { isPP: true, year: null, month: null, periodIndex: 0 };
    main().innerHTML = `
      <div class="ui-page bills-page">
        ${renderPageHeader({ title: 'Bills', subtitle: 'Manage recurring payments and monthly commitments.' })}
        <div class="ui-status-message">
          <span style="color:var(--muted)">Pay Period mode is active but no primary schedule is set.</span>
          <button class="btn btn-ghost btn-sm" onclick="pages.settings('personalisation')">Configure in Settings →</button>
        </div>
      </div>
    `;
    return;
  }

  let bills, navLabel;
  if (isPP) {
    safeIndex     = Math.min(Math.max(0, periodIndex), periods.length - 1);
    const period  = periods[safeIndex];
    bills         = await api(`/bills/by-range?from=${period.from}&to=${period.to}`);
    navLabel      = esc(period.label);
  } else {
    year  = year  ?? now.getFullYear();
    month = month ?? now.getMonth() + 1;
    bills = await api(`/bills?year=${year}&month=${month}`);
    navLabel = `${monthName(month)} ${year}`;
  }

  const active    = bills.filter(b => b.active);
  const cancelled = bills.filter(b => !b.active);
  const accountById = new Map(accounts.map(account => [account.id, account]));
  const billViews = active.map(bill => ({
    ...bill,
    account: accountById.get(bill.account_id),
    presentation: getBillPresentation(bill, { isPP, safeIndex, year, month, now, todayStr }),
  }));
  const visibleBills = billViews.filter(bill =>
    (_billsFilters.status === 'all' || bill.presentation.key === _billsFilters.status) &&
    (!_billsFilters.categoryId || bill.category_id === _billsFilters.categoryId) &&
    (!_billsFilters.accountId || bill.account_id === _billsFilters.accountId)
  );
  const total = visibleBills.reduce((sum, bill) => sum + (bill.management_only ? 0 : bill.amount), 0);
  const catOptions = cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  _billsView = isPP
    ? { isPP: true, year: null, month: null, periodIndex: safeIndex }
    : { isPP: false, year, month, periodIndex: 0 };
  _billsRefresh = () => isPP
    ? pages.bills(null, null, safeIndex)
    : pages.bills(year, month);

  const prevDisabled = isPP && safeIndex >= periods.length - 1 ? 'disabled' : '';
  const nextDisabled = isPP && safeIndex === 0 ? 'disabled' : '';
  const monthNavigation = `
    <div class="month-nav ui-action-bar bills-month-nav" aria-label="Bill period">
      <button class="btn btn-ghost btn-sm" id="billPrev" ${prevDisabled} aria-label="Previous period">◀</button>
      <span class="month-label">${navLabel}</span>
      <button class="btn btn-ghost btn-sm" id="billNext" ${nextDisabled} aria-label="Next period">▶</button>
    </div>
    <button class="btn btn-primary btn-sm" id="showBillForm">Add Bill</button>`;

  main().innerHTML = `
    <div class="ui-page bills-page">
      ${renderPageHeader({
        title: 'Bills',
        subtitle: 'Manage recurring payments and monthly commitments.',
        className: 'bills-page-header',
        actionsClass: 'bills-header-actions',
        actions: monthNavigation,
      })}

      <section class="ui-filter-bar bills-filter-bar" aria-label="Bill filters">
        <label class="ui-field bills-filter-field">
          <span>Status</span>
          <select id="billStatusFilter">
            <option value="all" ${_billsFilters.status === 'all' ? 'selected' : ''}>All statuses</option>
            <option value="overdue" ${_billsFilters.status === 'overdue' ? 'selected' : ''}>Overdue</option>
            <option value="due-today" ${_billsFilters.status === 'due-today' ? 'selected' : ''}>Due today</option>
            <option value="upcoming" ${_billsFilters.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
            <option value="paid" ${_billsFilters.status === 'paid' ? 'selected' : ''}>Paid</option>
          </select>
        </label>
        <label class="ui-field bills-filter-field">
          <span>Category</span>
          <select id="billCategoryFilter">
            <option value="">All categories</option>
            ${cats.map(c => `<option value="${c.id}" ${_billsFilters.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="ui-field bills-filter-field">
          <span>Account</span>
          <select id="billAccountFilter">
            <option value="">All accounts</option>
            ${accounts.map(a => `<option value="${a.id}" ${_billsFilters.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </label>
      </section>

      <section class="card ui-card bills-form-card" aria-labelledby="bills-add-title">
        ${renderSectionHeader({
          title: 'Add recurring bill',
          subtitle: 'Create a monthly commitment and choose where it will be paid from.',
          id: 'bills-add-title',
        })}
        <form id="billForm" class="ui-responsive-form bills-form-grid">
          <label class="ui-field bills-field-name">
            <span>Bill name</span>
            <input type="text" id="bName" placeholder="e.g. Council tax" required>
          </label>
          <label class="ui-field bills-field-amount">
            <span>Amount</span>
            <input type="number" inputmode="decimal" id="bAmount" placeholder="£0.00" min="0.01" max="1000000000000" step="0.01" required>
          </label>
          <label class="ui-field bills-field-day">
            <span>Due day</span>
            <input type="number" inputmode="numeric" id="bDay" placeholder="1–31" min="1" max="31" required>
          </label>
          <label class="ui-field bills-field-category">
            <span>Category</span>
            <select id="bCat">${catOptions}</select>
          </label>
          <label class="ui-field bills-field-account">
            <span>Account</span>
            <select id="bAcct">
              ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
            </select>
          </label>
          <div class="bills-recurrence-fields" role="group" aria-label="Recurrence schedule">
            <label class="ui-field bills-field-frequency">
              <span>Frequency</span>
              <select id="bFrequency">
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="four_weekly">Every four weeks</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label class="ui-field bills-field-start">
              <span>Start date</span>
              <input type="date" id="bStartDate" value="${todayStr}" required>
            </label>
            <label class="ui-field bills-field-end-mode">
              <span>Ends</span>
              <select id="bEndMode">
                <option value="never">Never</option>
                <option value="date">On a date</option>
                <option value="count">After occurrences</option>
              </select>
            </label>
            <label class="ui-field bills-field-end-date" id="bEndDateField" hidden>
              <span>End date</span>
              <input type="date" id="bEndDate">
            </label>
            <label class="ui-field bills-field-end-count" id="bEndCountField" hidden>
              <span>Occurrences</span>
              <input type="number" inputmode="numeric" id="bEndCount" min="1" max="10000" value="12">
            </label>
          </div>
          <button class="btn btn-primary bills-add-button" type="submit">Add Bill</button>
        </form>
      </section>

      <section class="bills-active-section" aria-labelledby="bills-active-title">
        ${renderSectionHeader({
          title: 'Active bills',
          subtitle: `${visibleBills.length} of ${active.length} bill${active.length === 1 ? '' : 's'} shown`,
          id: 'bills-active-title',
          actions: `<div class="bills-total"><span>Period total</span>${renderCurrency(total)}</div>`,
        })}
        <div class="bills-card-list">
          ${visibleBills.length === 0 ? renderEmptyState({
            title: active.length === 0 ? 'No active bills yet' : 'No bills match these filters',
            description: active.length === 0
              ? 'Add recurring payments here to see what is due and keep monthly commitments organised.'
              : 'Try changing or clearing the filters to see more recurring payments.',
            action: active.length === 0
              ? '<button class="btn btn-primary" id="emptyAddBill">Add Bill</button>'
              : '<button class="btn btn-ghost" id="clearBillFilters">Clear Filters</button>',
            icon: '↻',
            className: 'bills-empty-state',
          }) : visibleBills.map(b => `
            <article class="card ui-card bills-card" data-bill-id="${b.id}" data-status="${b.presentation.key}">
              <span class="bills-category-marker" style="background:${esc(b.category_colour)}" aria-hidden="true"></span>
              <div class="bills-card-main">
                <div class="bills-card-heading">
                  <h3>${esc(b.name)}</h3>
                  <span class="badge ${b.presentation.badge}">${b.presentation.label}</span>
                </div>
                <div class="bills-card-meta">
                  <span><strong>Due</strong> ${esc(b.presentation.dueLabel)}</span>
                  <span><strong>Account</strong> ${b.account ? esc(b.account.name) : 'Unassigned'}</span>
                  <span><strong>Category</strong> ${esc(b.category_name)}</span>
                  <span><strong>Recurrence</strong> ${esc(recurrenceLabel(b))}</span>
                </div>
              </div>
              <div class="bills-card-side">
                ${renderCurrency(b.amount, 'bills-card-amount')}
                <div class="ui-button-group bills-card-actions">
                  ${b.bill_month_id && !b.paid ? `<button class="btn btn-primary btn-sm" onclick="payBill(${b.bill_month_id},${b.amount})">Mark Paid</button>` : ''}
                  ${b.recurrence_status === 'active' ? `
                    <button class="btn btn-ghost btn-sm" onclick="pauseBillSeries(${b.recurring_series_id})">Pause</button>
                    ${b.due_date && !b.paid ? `<button class="btn btn-ghost btn-sm" onclick="skipBillOccurrence(${b.recurring_series_id},'${b.due_date}')">Skip</button>` : ''}
                  ` : b.recurrence_status === 'paused' ? `
                    <button class="btn btn-primary btn-sm" onclick="resumeBillSeries(${b.recurring_series_id})">Resume</button>
                  ` : ''}
                  <button class="btn btn-danger btn-sm bills-cancel-button" type="button" data-bill-id="${b.id}">Cancel</button>
                </div>
              </div>
            </article>`).join('')}
        </div>
      </section>

      ${cancelled.length > 0 ? `
      <section class="card ui-card bills-cancelled-section" aria-labelledby="bills-cancelled-title">
        ${renderSectionHeader({
          title: 'Cancelled bills',
          subtitle: 'Past commitments retained for payment history.',
          id: 'bills-cancelled-title',
        })}
        <div class="bills-cancelled-list">
          ${cancelled.map(b => `
            <div class="bills-cancelled-item">
              <span class="bills-colour-dot" style="background:${esc(b.category_colour)}" aria-hidden="true"></span>
              <span>${esc(b.name)}</span>
              <span class="badge badge-unpaid">Cancelled</span>
            </div>`).join('')}
        </div>
      </section>` : ''}
    </div>
  `;
  main().scrollTop = 0;

  $('billForm').addEventListener('submit', async e => {
    e.preventDefault();
    await submitForm(e.currentTarget, async () => {
    const endMode = $('bEndMode').value;
    const recurrence = {
      frequency: $('bFrequency').value,
      start_date: $('bStartDate').value,
      end_mode: endMode,
    };
    if (endMode === 'date') recurrence.end_date = $('bEndDate').value;
    if (endMode === 'count') recurrence.max_occurrences = Number($('bEndCount').value);
    await api('/bills', { method: 'POST', body: {
      name: $('bName').value,
      amount: $('bAmount').value,
      due_day: Number($('bDay').value),
      category_id: Number($('bCat').value),
      account_id: $('bAcct').value ? Number($('bAcct').value) : null,
      recurrence,
    }});
    await (isPP ? pages.bills(null, null, safeIndex) : pages.bills(year, month));
    });
  });

  const updateEndFields = () => {
    const mode = $('bEndMode').value;
    $('bEndDateField').hidden = mode !== 'date';
    $('bEndCountField').hidden = mode !== 'count';
    $('bEndDate').required = mode === 'date';
    $('bEndCount').required = mode === 'count';
  };
  $('bEndMode').addEventListener('change', updateEndFields);
  updateEndFields();

  $('showBillForm')?.addEventListener('click', () => {
    $('bName').focus();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('bName').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  });
  $('emptyAddBill')?.addEventListener('click', () => $('showBillForm')?.click());
  $('clearBillFilters')?.addEventListener('click', () => {
    _billsFilters = { status: 'all', categoryId: null, accountId: null };
    _billsRefresh();
  });
  document.querySelectorAll('.bills-cancel-button').forEach(button => {
    button.addEventListener('click', () => {
      const bill = bills.find(item => item.id === Number(button.dataset.billId));
      if (bill) window.cancelBill(bill.id, bill.name);
    });
  });

  const updateBillsFilters = () => {
    _billsFilters = {
      status: $('billStatusFilter').value,
      categoryId: $('billCategoryFilter').value ? Number($('billCategoryFilter').value) : null,
      accountId: $('billAccountFilter').value ? Number($('billAccountFilter').value) : null,
    };
    _billsRefresh();
  };
  $('billStatusFilter').addEventListener('change', updateBillsFilters);
  $('billCategoryFilter').addEventListener('change', updateBillsFilters);
  $('billAccountFilter').addEventListener('change', updateBillsFilters);

  $('billPrev').addEventListener('click', () => {
    if (isPP) {
      pages.bills(null, null, safeIndex + 1);
    } else {
      const d = new Date(year, month - 2, 1);
      pages.bills(d.getFullYear(), d.getMonth() + 1);
    }
  });
  $('billNext').addEventListener('click', () => {
    if (isPP) {
      pages.bills(null, null, safeIndex - 1);
    } else {
      const d = new Date(year, month, 1);
      pages.bills(d.getFullYear(), d.getMonth() + 1);
    }
  });
};

window.payBill = async function(billMonthId, defaultAmount) {
  const input = prompt(`Amount paid (default: £${defaultAmount}):`, defaultAmount);
  if (input === null) return;
  const amount_paid = input === '' ? defaultAmount : input;
  await api(`/bill-months/${billMonthId}/pay`, { method: 'POST', body: { amount_paid } });
  _billsView.isPP
    ? pages.bills(null, null, _billsView.periodIndex)
    : pages.bills(_billsView.year, _billsView.month);
};

window.cancelBill = async function(id, name) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-bill-title">
      <h3 id="cancel-bill-title">Cancel "${esc(name)}"?</h3>
      <p>This bill will stop appearing in future months. All past payment history will be kept.</p>
      <div class="modal-actions ui-modal-footer">
        <button class="btn btn-ghost" id="cancelNo">Keep it</button>
        <button class="btn btn-danger" id="cancelYes">Cancel Bill</button>
      </div>
    </div>`;
  const closeModal = mountModal(modal, '#cancelNo');
  $('cancelNo').addEventListener('click', closeModal);
  $('cancelYes').addEventListener('click', async () => {
    closeModal();
    await api(`/bills/${id}/cancel`, { method: 'PATCH' });
    _billsView.isPP
      ? pages.bills(null, null, _billsView.periodIndex)
      : pages.bills(_billsView.year, _billsView.month);
  });
};

window.pauseBillSeries = async function(seriesId) {
  if (!confirm('Pause this recurring bill? Occurrences while paused will be skipped.')) return;
  await api(`/recurring/${seriesId}/pause`, { method: 'POST' });
  _billsRefresh();
};

window.resumeBillSeries = async function(seriesId) {
  await api(`/recurring/${seriesId}/resume`, { method: 'POST' });
  _billsRefresh();
};

window.skipBillOccurrence = async function(seriesId, date) {
  if (!confirm(`Skip the bill due ${formatDate(date)}?`)) return;
  await api(`/recurring/${seriesId}/skip`, { method: 'POST', body: { date } });
  _billsRefresh();
};
}
