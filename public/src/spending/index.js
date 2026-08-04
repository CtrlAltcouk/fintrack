export function installSpending(ctx) {
  const {
    $, main, fmt, monthName, renderPageHeader, renderSectionHeader,
    renderCurrency, renderEmptyState, api, getCategories, getAccounts,
    invalidateAccounts, pages, esc, computePeriods, toDateInput,
    formatDate, submitForm,
  } = ctx;
let _spendingRefresh = () => pages.spending();

pages.spending = async function (year, month, categoryId = null, accountId = null, periodIndex = 0) {
  invalidateAccounts();
  const now = new Date();

  const catQuery  = categoryId ? `&category_id=${categoryId}` : '';
  const acctQuery = accountId  ? `&account_id=${accountId}`   : '';

  const [cats, accounts, ppSettings, schedules, recurringTransactions] = await Promise.all([
    getCategories(),
    getAccounts(),
    api('/settings/pay-period'),
    api('/income/schedules'),
    api('/recurring?kind=transaction'),
  ]);

  const isPP = ppSettings.mode === 'pay_period';
  let paySchedule = null, periods = [], safeIndex = 0, period = null;

  if (isPP && ppSettings.primary_schedule_id) {
    paySchedule = schedules.find(s => s.id === ppSettings.primary_schedule_id && s.active) || null;
  }
  if (isPP && paySchedule) {
    periods = computePeriods(paySchedule, 8);
  }

  if (isPP && periods.length === 0) {
    main().innerHTML = `
      <div class="ui-page spending-page">
        ${renderPageHeader({ title: 'Daily Spending' })}
        <div class="ui-status-message">
        <span style="color:var(--muted)">Pay Period mode is active but no primary schedule is set.</span>
        <button class="btn btn-ghost btn-sm" onclick="pages.settings('personalisation')">Configure in Settings →</button>
        </div>
      </div>
    `;
    return;
  }

  let txns, navLabel;
  if (isPP) {
    safeIndex = Math.min(Math.max(0, periodIndex), periods.length - 1);
    period    = periods[safeIndex];
    txns      = await api(`/transactions?from=${period.from}&to=${period.to}${catQuery}${acctQuery}`);
    navLabel  = esc(period.label);
  } else {
    year     = year  ?? now.getFullYear();
    month    = month ?? now.getMonth() + 1;
    txns     = await api(`/transactions?year=${year}&month=${month}${catQuery}${acctQuery}`);
    navLabel = `${monthName(month)} ${year}`;
  }

  const grouped = {};
  for (const t of txns) {
    if (!grouped[t.date]) grouped[t.date] = [];
    grouped[t.date].push(t);
  }

  const catOptions = cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const filterOptions = cats.map(c =>
    `<option value="${c.id}" ${categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');
  const allOnclick   = isPP
    ? `pages.spending(null,null,${JSON.stringify(categoryId)},null,${safeIndex})`
    : `pages.spending(${year},${month},${JSON.stringify(categoryId)},null)`;
  const acctOnclick  = (aId) => isPP
    ? `pages.spending(null,null,${JSON.stringify(categoryId)},${aId},${safeIndex})`
    : `pages.spending(${year},${month},${JSON.stringify(categoryId)},${aId})`;
  const prevDisabled = isPP && safeIndex >= periods.length - 1 ? 'disabled' : '';
  const nextDisabled = isPP && safeIndex === 0 ? 'disabled' : '';
  _spendingRefresh = () => isPP
    ? pages.spending(null, null, categoryId, accountId, safeIndex)
    : pages.spending(year, month, categoryId, accountId);

  main().innerHTML = `
    <div class="ui-page spending-page">
      ${renderPageHeader({
        title: 'Daily Spending',
        subtitle: 'Add, review and manage your everyday transactions.',
        className: 'spending-page-header',
        introClass: 'spending-title-group',
        actions: `<div class="month-nav ui-action-bar spending-month-nav" aria-label="Transaction period">
          <button class="btn btn-ghost btn-sm" id="prevMonth" ${prevDisabled} aria-label="Previous period">◀</button>
          <span class="month-label">${navLabel}</span>
          <button class="btn btn-ghost btn-sm" id="nextMonth" ${nextDisabled} aria-label="Next period">▶</button>
        </div>`,
      })}

      <section class="ui-filter-bar spending-filters" aria-label="Transaction filters">
        <label class="ui-field spending-filter-field" for="catFilter">
          <span>Category</span>
          <select id="catFilter">
            <option value="">All categories</option>
            ${filterOptions}
          </select>
        </label>
        <div class="ui-button-group spending-account-filters" role="group" aria-label="Filter by account">
          <button class="ui-chip spending-filter-chip ${!accountId ? 'active' : ''}"
            onclick="${allOnclick}" aria-pressed="${!accountId}">All accounts</button>
          ${accounts.map(a => `
            <button class="ui-chip spending-filter-chip ${accountId === a.id ? 'active' : ''}"
              onclick="${acctOnclick(a.id)}" aria-pressed="${accountId === a.id}">
              <span class="spending-colour-dot" style="background:${esc(a.colour)}" aria-hidden="true"></span>
              ${esc(a.name)}
            </button>`).join('')}
        </div>
      </section>

      <section class="card ui-card spending-add-card" aria-labelledby="spending-add-title">
        ${renderSectionHeader({
          title: 'Add transaction',
          subtitle: 'Record spending without leaving this view.',
          id: 'spending-add-title',
        })}
        <form id="txnForm" class="ui-responsive-form spending-form-grid">
          <label class="ui-field spending-field spending-field-amount">
            <span>Amount</span>
            <input type="number" inputmode="decimal" id="txnAmount" placeholder="£0.00" min="0.01" max="1000000000000" step="0.01" required>
          </label>
          <label class="ui-field spending-field spending-field-description">
            <span>Description</span>
            <input type="text" id="txnDesc" placeholder="What did you spend on?" required>
          </label>
          <label class="ui-field spending-field spending-field-category">
            <span>Category</span>
            <select id="txnCat">${catOptions}</select>
          </label>
          <label class="ui-field spending-field spending-field-account">
            <span>Account</span>
            <select id="txnAcct">
              ${accounts.map(a => `<option value="${a.id}" ${accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            </select>
          </label>
          <label class="ui-field spending-field spending-field-date">
            <span>Date</span>
            <input type="date" id="txnDate" value="${toDateInput(now)}" required>
          </label>
          <label class="ui-field spending-repeat-field">
            <span>Repeat</span>
            <span class="spending-repeat-toggle">
              <input type="checkbox" id="txnRepeat">
              <span>Make this recurring</span>
            </span>
          </label>
          <div class="spending-recurrence-fields" id="txnRecurrenceFields" hidden>
            <label class="ui-field spending-field">
              <span>Frequency</span>
              <select id="txnFrequency">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="four_weekly">Four-weekly</option>
                <option value="monthly" selected>Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label class="ui-field spending-field">
              <span>Ends</span>
              <select id="txnEndMode">
                <option value="never">Never</option>
                <option value="date">On a date</option>
                <option value="count">After occurrences</option>
              </select>
            </label>
            <label class="ui-field spending-field" id="txnEndDateField" hidden>
              <span>End date</span>
              <input type="date" id="txnEndDate">
            </label>
            <label class="ui-field spending-field" id="txnCountField" hidden>
              <span>Occurrence count</span>
              <input type="number" id="txnOccurrenceCount" min="1" max="10000" value="12">
            </label>
          </div>
          <button class="btn btn-primary spending-add-button" type="submit">Add Transaction</button>
        </form>
      </section>

      ${recurringTransactions.some(series => ['active', 'paused'].includes(series.status)) ? `
        <section class="card ui-card spending-recurring-card" aria-labelledby="spending-recurring-title">
          ${renderSectionHeader({
            title: 'Recurring transactions',
            subtitle: 'Transactions are created automatically only when their scheduled date arrives.',
            id: 'spending-recurring-title',
          })}
          <div class="spending-recurring-list">
            ${recurringTransactions.filter(series => ['active', 'paused'].includes(series.status)).map(series => `
              <article class="spending-recurring-item">
                <div class="spending-recurring-copy">
                  <strong>${esc(series.description)}</strong>
                  <span>${fmt(series.amount)} · ${esc(series.frequency.replaceAll('_', '-'))}</span>
                  <span>${series.status === 'paused' ? 'Paused' : series.next_due_date
                    ? `Next: ${formatDate(series.next_due_date)}` : 'Pending completion'}</span>
                </div>
                <div class="ui-button-group spending-recurring-actions">
                  ${series.status === 'active'
                    ? `<button class="btn btn-ghost btn-sm" data-recurring-action="pause" data-series-id="${series.id}">Pause</button>
                       <button class="btn btn-ghost btn-sm" data-recurring-action="skip-next" data-series-id="${series.id}">Skip next</button>`
                    : `<button class="btn btn-ghost btn-sm" data-recurring-action="resume" data-series-id="${series.id}">Resume</button>`}
                  <button class="btn btn-danger btn-sm" data-recurring-action="stop" data-series-id="${series.id}">Stop recurring</button>
                </div>
              </article>`).join('')}
          </div>
        </section>` : ''}

      <div id="txnList" class="spending-transaction-list" data-empty-period="${isPP ? 'period' : 'month'}">
        ${Object.keys(grouped).sort((a,b) => b.localeCompare(a)).map(date => {
          const items    = grouped[date];
          const dayTotal = items.reduce((s, t) => s + t.amount, 0);
          return `<section class="day-group spending-day-group" aria-labelledby="spending-day-${date}">
            <div class="day-header spending-day-header" id="spending-day-${date}">
              <span>${formatDate(date)}</span>
              <span>${fmt(dayTotal)}</span>
            </div>
            <div class="list spending-day-list">
              ${items.map(t => `
                <article class="list-item ui-transaction-card spending-transaction" id="txn-${t.id}"
                  data-amount="${t.amount}" data-description="${esc(t.description)}"
                  data-category-id="${t.category_id}" data-date="${t.date}"
                  data-recurring-series-id="${t.recurring_series_id ?? ''}"
                  style="--transaction-colour:${esc(t.category_colour)}">
                  <span class="spending-category-marker" aria-hidden="true"></span>
                  <div class="desc spending-transaction-copy">
                    <div class="spending-transaction-description">${esc(t.description)}</div>
                    <div class="spending-transaction-meta">
                      <span class="spending-category-name">
                        <span class="spending-colour-dot" style="background:${esc(t.category_colour)}" aria-hidden="true"></span>
                        ${esc(t.category_name)}
                      </span>
                      <span>${formatDate(t.date)}</span>
                      <span class="spending-account-name">
                        <span class="spending-colour-dot" style="background:${esc(t.account_colour ?? 'var(--muted)')}" aria-hidden="true"></span>
                        ${t.account_name ? esc(t.account_name) : 'Unassigned'}
                      </span>
                    </div>
                  </div>
                  <div class="spending-transaction-side">
                    ${renderCurrency(t.amount, 'amount')}
                    <div class="ui-button-group spending-transaction-actions">
                      <button class="btn btn-ghost btn-sm" onclick="editTxn(${t.id})"
                        aria-label="Edit ${esc(t.description)}">Edit</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteTxn(${t.id})"
                        aria-label="Delete ${esc(t.description)}">Delete</button>
                    </div>
                  </div>
                </article>`).join('')}
            </div>
          </section>`;
        }).join('') || renderEmptyState({
          title: `No transactions this ${isPP ? 'period' : 'month'}`,
          description: 'Record everyday purchases here to keep your balances and spending reports up to date.',
          action: '<button class="btn btn-primary" id="emptyAddTxn">Add Transaction</button>',
          className: 'spending-empty-state',
        })}
      </div>
    </div>
  `;
  main().scrollTop = 0;

  $('txnForm').addEventListener('submit', async e => {
    e.preventDefault();
    await submitForm(e.currentTarget, async () => {
    const body = {
      amount:      $('txnAmount').value,
      description: $('txnDesc').value,
      category_id: Number($('txnCat').value),
      account_id:  $('txnAcct').value ? Number($('txnAcct').value) : null,
      date:        $('txnDate').value,
    };
    if ($('txnRepeat').checked) {
      const endMode = $('txnEndMode').value;
      body.recurrence = {
        frequency: $('txnFrequency').value,
        start_date: $('txnDate').value,
        end_mode: endMode,
        ...(endMode === 'date' ? { end_date: $('txnEndDate').value } : {}),
        ...(endMode === 'count' ? { max_occurrences: Number($('txnOccurrenceCount').value) } : {}),
      };
    }
    await api('/transactions', { method: 'POST', body });
    await _spendingRefresh();
    });
  });

  const updateRecurrenceFields = () => {
    $('txnRecurrenceFields').hidden = !$('txnRepeat').checked;
    const endMode = $('txnEndMode').value;
    $('txnEndDateField').hidden = endMode !== 'date';
    $('txnCountField').hidden = endMode !== 'count';
  };
  $('txnRepeat').addEventListener('change', updateRecurrenceFields);
  $('txnEndMode').addEventListener('change', updateRecurrenceFields);
  updateRecurrenceFields();

  document.querySelectorAll('[data-recurring-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.recurringAction;
      const seriesId = Number(button.dataset.seriesId);
      if (action === 'stop' && !confirm('Stop this recurring transaction? Existing transactions will be kept.')) return;
      await api(`/recurring/${seriesId}/${action}`, { method: 'POST', body: {} });
      _spendingRefresh();
    });
  });

  $('emptyAddTxn')?.addEventListener('click', () => {
    $('txnAmount').focus();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('txnAmount').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  });

  $('catFilter').addEventListener('change', () => {
    const catId = $('catFilter').value;
    isPP
      ? pages.spending(null, null, catId ? Number(catId) : null, accountId, safeIndex)
      : pages.spending(year, month, catId ? Number(catId) : null, accountId);
  });

  $('prevMonth').addEventListener('click', () => {
    if (isPP) {
      pages.spending(null, null, categoryId, accountId, safeIndex + 1);
    } else {
      const d = new Date(year, month - 2, 1);
      pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
    }
  });
  $('nextMonth').addEventListener('click', () => {
    if (isPP) {
      pages.spending(null, null, categoryId, accountId, safeIndex - 1);
    } else {
      const d = new Date(year, month, 1);
      pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
    }
  });
};

window.deleteTxn = async function(id) {
  if (!confirm('Delete this transaction?')) return;
  await api(`/transactions/${id}`, { method: 'DELETE' });
  _spendingRefresh();
};

window.editTxn = async function(id) {
  const cats = await getCategories();
  const row = document.getElementById(`txn-${id}`);
  if (!row) return;
  const currentCategoryId = Number(row.dataset.categoryId);
  const recurringSeriesId = Number(row.dataset.recurringSeriesId) || null;
  const catOptions = cats.map(c =>
    `<option value="${c.id}" ${c.id === currentCategoryId ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');
  row.classList.add('is-editing');
  row.innerHTML = `
    <div class="ui-responsive-form spending-edit-grid">
      <label class="ui-field spending-field">
        <span>Amount</span>
        <input type="number" inputmode="decimal" id="ea" value="${esc(row.dataset.amount)}" min="0.01" max="1000000000000" step="0.01">
      </label>
      ${recurringSeriesId ? `<label class="ui-field spending-field spending-edit-scope">
        <span>Apply changes to</span>
        <select id="editTxnScope">
          <option value="single">This transaction only</option>
          <option value="future">This and future occurrences</option>
        </select>
      </label>` : ''}
      <label class="ui-field spending-field spending-edit-description">
        <span>Description</span>
        <input type="text" id="ed" value="${esc(row.dataset.description)}">
      </label>
      <label class="ui-field spending-field">
        <span>Category</span>
        <select id="ec">${catOptions}</select>
      </label>
      <div class="ui-button-group spending-edit-actions">
        <button class="btn btn-primary btn-sm" onclick="saveEditTxn(${id})">Save Changes</button>
        <button class="btn btn-ghost btn-sm" onclick="cancelEditTxn()">Cancel</button>
      </div>
    </div>
  `;
};

window.cancelEditTxn = function() {
  _spendingRefresh();
};

window.saveEditTxn = async function(id) {
  await api(`/transactions/${id}`, { method: 'PUT', body: {
    amount: $('ea').value,
    description: $('ed').value,
    category_id: Number($('ec').value),
    scope: $('editTxnScope')?.value ?? 'single',
  }});
  _spendingRefresh();
};

}
