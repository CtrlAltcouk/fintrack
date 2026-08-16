export function installIncome(ctx) {
  const {
    $, main, monthName, renderPageHeader, renderSectionHeader,
    renderCurrency, renderEmptyState, api, getAccounts, pages, esc, fmt,
    toDateInput, formatDate, submitForm, mountModal,
  } = ctx;
let _incomeView = { year: null, month: null, mode: 'oneoff' };
let _scheduleEditData = null;
let _incomeEntryData = null;

function incomeFrequencyLabel(schedule) {
  const frequency = schedule.recurrence_frequency || schedule.frequency;
  const labels = {
    daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly',
    four_weekly: 'Every 4 weeks', monthly: `Day ${schedule.day_of_month} each month`,
    quarterly: `Quarterly from ${schedule.anchor_date}`,
    yearly: `Yearly from ${schedule.anchor_date}`,
  };
  let label = labels[frequency] || frequency;
  if (['daily', 'weekly', 'fortnightly', 'four_weekly'].includes(frequency)) {
    label += ` from ${schedule.anchor_date}`;
  }
  if (schedule.end_mode === 'date') label += ` until ${formatDate(schedule.end_date)}`;
  if (schedule.end_mode === 'count') label += ` · ${schedule.max_occurrences} occurrence${schedule.max_occurrences === 1 ? '' : 's'}`;
  return label;
}

pages.income = async function (year, month, mode) {
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;
  mode  = mode  ?? 'oneoff';
  _incomeView = { year, month, mode };

  main().innerHTML = `
    <div class="ui-page income-page">
      ${renderPageHeader({
        title: 'Income',
        subtitle: 'Manage one-off income and recurring pay schedules.',
        className: 'income-page-header',
      })}
      <div class="ui-loading-placeholder income-loading" role="status" aria-live="polite">
        <span class="ui-loading-placeholder__bar ui-loading-placeholder__bar--wide" aria-hidden="true"></span>
        <span class="ui-loading-placeholder__bar" aria-hidden="true"></span>
        <span>Loading income…</span>
      </div>
    </div>`;

  const [entries, schedules, accounts] = await Promise.all([
    api(`/income?year=${year}&month=${month}`),
    api('/income/schedules'),
    getAccounts(),
  ]);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const activeSchedules = schedules.filter(s => s.active);
  const accountById = new Map(accounts.map(account => [account.id, account]));
  _scheduleEditData = { schedules: activeSchedules, accounts };
  _incomeEntryData = { entries, accounts };
  const monthNavigation = `
    <div class="month-nav ui-action-bar income-month-nav" aria-label="Income period">
      <button class="btn btn-ghost btn-sm" id="incPrev" aria-label="Previous month">◀</button>
      <span class="month-label">${monthName(month)} ${year}</span>
      <button class="btn btn-ghost btn-sm" id="incNext" aria-label="Next month">▶</button>
    </div>`;

  main().innerHTML = `
    <div class="ui-page income-page">
      ${renderPageHeader({
        title: 'Income',
        subtitle: 'Manage one-off income and recurring pay schedules.',
        className: 'income-page-header',
        introClass: 'income-title-group',
        actionsClass: 'income-header-actions',
        actions: monthNavigation,
      })}

      <section class="ui-filter-bar income-mode-bar" aria-label="Income type">
        <span class="income-mode-label">Manage</span>
        <div class="ui-button-group income-mode-options">
          <button class="ui-chip income-mode-option ${mode === 'oneoff' ? 'active' : ''}"
            aria-pressed="${mode === 'oneoff'}"
            onclick="pages.income(${year},${month},'oneoff')">One-off income</button>
          <button class="ui-chip income-mode-option ${mode === 'recurring' ? 'active' : ''}"
            aria-pressed="${mode === 'recurring'}"
            onclick="pages.income(${year},${month},'recurring')">Recurring schedules</button>
        </div>
      </section>

      <section class="ui-responsive-grid ui-responsive-grid--three income-summary-grid" aria-label="Income summary">
        <div class="stat-card ui-stat-card ui-summary-card income-summary-card income-summary-total">
          <div class="label">Total income</div>
          <div class="value">${renderCurrency(total)}</div>
          <div class="sub">${monthName(month)} ${year}</div>
        </div>
        <div class="stat-card ui-stat-card ui-summary-card income-summary-card">
          <div class="label">Entries</div>
          <div class="value">${entries.length}</div>
          <div class="sub">Recorded this month</div>
        </div>
        <div class="stat-card ui-stat-card ui-summary-card income-summary-card">
          <div class="label">Recurring sources</div>
          <div class="value">${activeSchedules.length}</div>
          <div class="sub">Active schedules</div>
        </div>
      </section>

      <section class="card ui-card income-form-card" aria-labelledby="income-form-title">
        ${renderSectionHeader({
          title: mode === 'oneoff' ? 'Add one-off income' : 'Add recurring income',
          subtitle: mode === 'oneoff'
            ? 'Record money received outside your regular schedule.'
            : 'Set the amount, frequency and destination account.',
          id: 'income-form-title',
        })}
        ${mode === 'oneoff' ? `
          <form id="incForm" class="ui-responsive-form income-form-grid income-oneoff-form">
            <label class="ui-field income-field-amount">
              <span>Amount</span>
              <input type="number" inputmode="decimal" id="incAmount" placeholder="£0.00" min="0.01" max="1000000000000" step="0.01" required>
            </label>
            <label class="ui-field income-field-description">
              <span>Source or description</span>
              <input type="text" id="incDesc" placeholder="e.g. Freelance project" required>
            </label>
            <label class="ui-field income-field-account">
              <span>Account</span>
              <select id="incAcct">
                ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
              </select>
            </label>
            <label class="ui-field income-field-date">
              <span>Date received</span>
              <input type="date" id="incDate" value="${toDateInput(now)}" required>
            </label>
            <button class="btn btn-primary income-add-button" type="submit">Add Income</button>
          </form>
        ` : `
          <form id="incSchedForm" class="ui-responsive-form income-form-grid income-schedule-form">
            <label class="ui-field income-field-name">
              <span>Income name</span>
              <input type="text" id="schedName" placeholder="e.g. Salary" required>
            </label>
            <label class="ui-field income-field-amount">
              <span>Amount</span>
              <input type="number" inputmode="decimal" id="schedAmount" placeholder="£0.00" min="0.01" max="1000000000000" step="0.01" required>
            </label>
            <label class="ui-field income-field-frequency">
              <span>Frequency</span>
              <select id="schedFreq" onchange="renderFreqFields()">
                <option value="monthly">Specific day each month</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="four_weekly">Every 4 weeks</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label class="ui-field income-field-account">
              <span>Account</span>
              <select id="schedAcct">
                ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
              </select>
            </label>
            <div id="schedFreqFields" class="income-frequency-fields"></div>
            <label class="ui-field income-field-schedule-end-mode">
              <span>Ends</span>
              <select id="schedEndMode">
                <option value="never">Never</option>
                <option value="date">On a date</option>
                <option value="count">After occurrences</option>
              </select>
            </label>
            <div id="schedEndFields" class="income-frequency-fields"></div>
            <button class="btn btn-primary income-add-button" type="submit">Add Schedule</button>
          </form>
        `}
      </section>

      ${mode === 'recurring' ? `
        <section class="income-schedules-section" aria-labelledby="income-schedules-title">
          ${renderSectionHeader({
            title: 'Recurring sources',
            subtitle: 'Active schedules generate future income automatically.',
            id: 'income-schedules-title',
          })}
          <div class="ui-responsive-grid income-schedule-list">
            ${activeSchedules.length === 0 ? renderEmptyState({
              title: 'No recurring income yet',
              description: 'Add a salary, benefit or other repeating payment to generate future income entries automatically.',
              action: '<button class="btn btn-primary" id="emptyAddSchedule">Add Recurring Income</button>',
              icon: '↻',
              className: 'income-schedules-empty',
            }) : activeSchedules.map(s => {
              const account = accountById.get(s.account_id);
              return `
                <article class="card ui-card income-schedule-card" id="sched-${s.id}">
                  <span class="income-card-marker income-card-marker-recurring" aria-hidden="true"></span>
                  <div class="income-card-main">
                    <div class="income-card-heading">
                      <h3>${esc(s.name)}</h3>
                      <span class="badge income-badge-active">${s.recurrence_status === 'paused' ? 'Paused' : s.recurrence_status === 'completed' ? 'Completed' : 'Active'}</span>
                    </div>
                    <div class="income-card-meta">
                      <span><strong>Frequency</strong> ${esc(incomeFrequencyLabel(s))}</span>
                      <span class="income-account">
                        <strong>Account</strong>
                        ${account ? `<span class="income-account-dot" style="background:${esc(account.colour)}" aria-hidden="true"></span>${esc(account.name)}` : 'Unassigned'}
                      </span>
                    </div>
                  </div>
                  <div class="income-card-side">
                    ${renderCurrency(s.amount, 'income-card-amount')}
                    <div class="ui-button-group income-card-actions">
                      <button class="btn btn-ghost btn-sm" onclick="editSchedule(${s.id})">Edit</button>
                      ${s.recurrence_status === 'active'
                        ? `<button class="btn btn-ghost btn-sm" onclick="pauseIncomeSeries(${s.recurring_series_id})">Pause</button>`
                        : s.recurrence_status === 'paused'
                          ? `<button class="btn btn-primary btn-sm" onclick="resumeIncomeSeries(${s.recurring_series_id})">Resume</button>`
                          : ''}
                      <button class="btn btn-danger btn-sm" onclick="deactivateSchedule(${s.id})">Delete</button>
                    </div>
                  </div>
                </article>`;
            }).join('')}
          </div>
        </section>
      ` : ''}

      <section class="income-entries-section" aria-labelledby="income-entries-title">
        ${renderSectionHeader({
          title: 'Income entries',
          subtitle: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in ${monthName(month)} ${year}`,
          id: 'income-entries-title',
          actions: renderCurrency(total, 'income-entries-total'),
        })}
        <div class="income-entry-list">
          ${entries.length === 0 ? renderEmptyState({
            title: 'No income this month',
            description: 'Add a one-off payment or create a recurring schedule to start tracking money coming in.',
            action: '<button class="btn btn-primary" id="emptyAddIncome">Add Income</button>',
            icon: '＋',
            className: 'income-entries-empty',
          }) : entries.map(e => {
            const recurring = e.source_schedule_id != null;
            const account = accountById.get(e.account_id);
            return `
              <article class="list-item ui-transaction-card income-entry-card" id="inc-${e.id}">
                <span class="income-card-marker ${recurring ? 'income-card-marker-recurring' : 'income-card-marker-oneoff'}" aria-hidden="true"></span>
                <div class="desc income-card-main">
                  <div class="income-card-heading">
                    <h3>${esc(e.description)}</h3>
                    <span class="badge ${recurring ? 'income-badge-recurring' : 'income-badge-oneoff'}">
                      ${recurring ? 'Recurring' : 'One-off'}
                    </span>
                  </div>
                  <div class="income-card-meta">
                    <span><strong>Date</strong> ${formatDate(e.date)}</span>
                    <span class="income-account">
                      <strong>Account</strong>
                      ${account ? `<span class="income-account-dot" style="background:${esc(account.colour)}" aria-hidden="true"></span>${esc(account.name)}` : 'Unassigned'}
                    </span>
                  </div>
                </div>
                <div class="income-card-side">
                  ${renderCurrency(e.amount, 'income-card-amount')}
                  ${recurring ? `
                    <div class="ui-button-group income-card-actions">
                      <button class="btn btn-danger btn-sm" onclick="deleteRecurringIncomeEntry(${e.id})"
                        aria-label="Delete ${esc(e.description)} income entry">Delete</button>
                    </div>` : `
                    <div class="ui-button-group income-card-actions">
                      <button class="btn btn-danger btn-sm" onclick="deleteIncome(${e.id})"
                        aria-label="Delete ${esc(e.description)}">Delete</button>
                    </div>`}
                </div>
              </article>`;
          }).join('')}
        </div>
      </section>
    </div>
  `;
  main().scrollTop = 0;

  if (mode === 'oneoff') {
    $('incForm').addEventListener('submit', async e => {
      e.preventDefault();
      await submitForm(e.currentTarget, async () => {
      await api('/income', { method: 'POST', body: {
        amount: $('incAmount').value,
        description: $('incDesc').value,
        account_id: $('incAcct').value ? Number($('incAcct').value) : null,
        date: $('incDate').value,
      }});
      await pages.income(year, month, 'oneoff');
      });
    });
  }

  if (mode === 'recurring') {
    renderFreqFields();
    renderIncomeEndFields();
    $('schedEndMode').addEventListener('change', renderIncomeEndFields);
    $('incSchedForm').addEventListener('submit', async e => {
      e.preventDefault();
      await submitForm(e.currentTarget, async () => {
      const freq = $('schedFreq').value;
      const body = {
        name: $('schedName').value,
        amount: $('schedAmount').value,
        frequency: freq,
        account_id: $('schedAcct').value ? Number($('schedAcct').value) : null,
      };
      if (freq === 'monthly') {
        body.day_of_month = Number($('schedDay').value);
      } else {
        body.anchor_date = $('schedAnchor').value;
      }
      const endMode = $('schedEndMode').value;
      body.recurrence = {
        frequency: freq,
        start_date: freq === 'monthly'
          ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Math.min(Number($('schedDay').value), new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())).padStart(2, '0')}`
          : $('schedAnchor').value,
        end_mode: endMode,
      };
      if (endMode === 'date') body.recurrence.end_date = $('schedEndDate').value;
      if (endMode === 'count') body.recurrence.max_occurrences = Number($('schedEndCount').value);
      await api('/income/schedules', { method: 'POST', body });
      await pages.income(year, month, 'recurring');
      });
    });
  }

  $('emptyAddSchedule')?.addEventListener('click', () => {
    $('schedName')?.focus();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('schedName')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  });
  $('emptyAddIncome')?.addEventListener('click', async () => {
    if (mode !== 'oneoff') await pages.income(year, month, 'oneoff');
    $('incAmount')?.focus();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('incAmount')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  });

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
    container.innerHTML = `
      <label class="ui-field income-field-schedule-day">
        <span>Day of month</span>
        <input type="number" inputmode="numeric" id="schedDay" placeholder="1–31" min="1" max="31" required>
      </label>`;
  } else {
    container.innerHTML = `
      <label class="ui-field income-field-schedule-anchor">
        <span>First pay date</span>
        <input type="date" id="schedAnchor" title="First pay date" required>
      </label>`;
  }
};

window.renderIncomeEndFields = function () {
  const mode = document.getElementById('schedEndMode')?.value;
  const container = document.getElementById('schedEndFields');
  if (!container) return;
  if (mode === 'date') {
    container.innerHTML = `<label class="ui-field income-field-schedule-end">
      <span>End date</span><input type="date" id="schedEndDate" required>
    </label>`;
  } else if (mode === 'count') {
    container.innerHTML = `<label class="ui-field income-field-schedule-end">
      <span>Occurrences</span><input type="number" inputmode="numeric" id="schedEndCount" min="1" max="10000" value="12" required>
    </label>`;
  } else {
    container.innerHTML = '';
  }
};

window.deactivateSchedule = async function (id) {
  const { schedules, accounts } = _scheduleEditData || {};
  const schedule = (schedules || []).find(item => item.id === id);
  if (!schedule) return;
  const account = (accounts || []).find(item => item.id === schedule.account_id);
  const retainsHistory = Number(schedule.historical_income_count) > 0;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-income-schedule-title">
      <h3 id="delete-income-schedule-title">Delete recurring income?</h3>
      <p><strong>${esc(schedule.name)}</strong> · ${fmt(schedule.amount)}</p>
      <p>Account: ${account ? esc(account.name) : 'Unassigned'}</p>
      <p>Future recurring income will be removed. ${retainsHistory
        ? 'Income already recorded in your history will be kept.'
        : 'No historical income has been recorded, so the unused schedule will be removed completely.'}</p>
      <div class="modal-actions ui-modal-footer">
        <button class="btn btn-ghost" id="deleteIncomeScheduleNo">Cancel</button>
        <button class="btn btn-danger" id="deleteIncomeScheduleYes">Delete recurring income</button>
      </div>
    </div>`;
  const closeModal = mountModal(modal, '#deleteIncomeScheduleNo');
  $('deleteIncomeScheduleNo').addEventListener('click', closeModal);
  $('deleteIncomeScheduleYes').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      await api(`/income/schedules/${id}/deactivate`, { method: 'PATCH' });
      closeModal();
      await pages.income(_incomeView.year, _incomeView.month, _incomeView.mode);
    } catch (error) {
      event.currentTarget.disabled = false;
      throw error;
    }
  });
};

window.deleteIncome = async function (id) {
  if (!confirm('Delete this income entry?')) return;
  await api(`/income/${id}`, { method: 'DELETE' });
  await pages.income(_incomeView.year, _incomeView.month, _incomeView.mode);
};

window.deleteRecurringIncomeEntry = function (id) {
  const { entries, accounts } = _incomeEntryData || {};
  const entry = (entries || []).find(item => item.id === id && item.recurring_occurrence_id != null);
  if (!entry) return;
  const account = (accounts || []).find(item => item.id === entry.account_id);
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="deleteRecurringIncomeEntryTitle">
    <h3 id="deleteRecurringIncomeEntryTitle">Delete this income entry?</h3>
    <p><strong>${fmt(entry.amount)} from ${esc(entry.description)}</strong> will be removed from your income and account balance.</p>
    ${account ? `<p>Account: ${esc(account.name)}</p>` : ''}
    <p>The recurring schedule will remain active.</p>
    <div class="modal-actions ui-modal-footer">
      <button class="btn btn-ghost" id="deleteRecurringIncomeEntryNo">Cancel</button>
      <button class="btn btn-danger" id="deleteRecurringIncomeEntryYes">Delete income entry</button>
    </div>
  </div>`;
  const closeModal = mountModal(modal, '#deleteRecurringIncomeEntryNo');
  $('deleteRecurringIncomeEntryNo').addEventListener('click', closeModal);
  $('deleteRecurringIncomeEntryYes').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      await api(`/income/${id}`, { method: 'DELETE' });
      closeModal();
      await pages.income(_incomeView.year, _incomeView.month, _incomeView.mode);
    } catch (error) {
      event.currentTarget.disabled = false;
      throw error;
    }
  });
};

window.editSchedule = function (id) {
  const existing = document.getElementById(`sched-edit-${id}`);
  if (existing) { existing.remove(); return; }

  const { schedules, accounts } = _scheduleEditData || {};
  const s = (schedules || []).find(x => x.id === id);
  if (!s) return;

  const acctOptions = (accounts || []).map(a =>
    `<option value="${a.id}" ${s.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`
  ).join('');

  const freqOptions = [
    ['monthly',    'Specific day each month'],
    ['daily',      'Daily'],
    ['weekly',     'Weekly'],
    ['fortnightly','Fortnightly'],
    ['four_weekly','Every 4 weeks'],
    ['quarterly',  'Quarterly'],
    ['yearly',     'Yearly'],
  ].map(([v, l]) => `<option value="${v}" ${s.frequency === v ? 'selected' : ''}>${l}</option>`).join('');

  const freqField = s.frequency === 'monthly'
    ? `<label class="ui-field income-edit-frequency-value">
        <span>Day of month</span>
        <input type="number" inputmode="numeric" id="sedit-day-${id}" value="${s.day_of_month || ''}" placeholder="1–31" min="1" max="31" required>
      </label>`
    : `<label class="ui-field income-edit-frequency-value">
        <span>First pay date</span>
        <input type="date" id="sedit-anchor-${id}" value="${s.anchor_date || ''}" title="First pay date" required>
      </label>`;

  const endMode = s.end_mode || 'never';
  const endField = endMode === 'date'
    ? `<label class="ui-field income-edit-end-value">
        <span>End date</span>
        <input type="date" id="sedit-enddate-${id}" value="${s.end_date || ''}" required>
      </label>`
    : endMode === 'count'
      ? `<label class="ui-field income-edit-end-value">
          <span>Occurrences</span>
          <input type="number" inputmode="numeric" id="sedit-endcount-${id}"
            min="1" max="10000" value="${s.max_occurrences || ''}" required>
        </label>`
      : '';

  const el = document.createElement('div');
  el.id = `sched-edit-${id}`;
  el.className = 'card ui-card income-schedule-edit';
  el.innerHTML = `
    <div class="ui-responsive-form income-schedule-edit-grid">
      <label class="ui-field income-edit-name">
        <span>Income name</span>
        <input type="text" id="sedit-name-${id}" value="${esc(s.name)}" placeholder="Name" required>
      </label>
      <label class="ui-field income-edit-amount">
        <span>Amount</span>
          <input type="number" inputmode="decimal" id="sedit-amount-${id}" value="${s.amount}" placeholder="£0.00" min="0.01" max="1000000000000" step="0.01" required>
      </label>
      <label class="ui-field income-edit-frequency">
        <span>Frequency</span>
        <select id="sedit-freq-${id}" onchange="window._seditFreqChange(${id})">${freqOptions}</select>
      </label>
      <label class="ui-field income-edit-account">
        <span>Account</span>
        <select id="sedit-acct-${id}">${acctOptions}</select>
      </label>
      <div id="sedit-freqfield-${id}" class="income-edit-frequency-fields">${freqField}</div>
      <label class="ui-field income-edit-end-mode">
        <span>Ends</span>
        <select id="sedit-endmode-${id}" onchange="window._seditEndChange(${id})">
          <option value="never" ${endMode === 'never' ? 'selected' : ''}>Never</option>
          <option value="date" ${endMode === 'date' ? 'selected' : ''}>On a date</option>
          <option value="count" ${endMode === 'count' ? 'selected' : ''}>After occurrences</option>
        </select>
      </label>
      <div id="sedit-endfield-${id}" class="income-edit-end-fields">${endField}</div>
      <div class="ui-button-group income-edit-actions">
        <button class="btn btn-primary btn-sm" onclick="window.saveScheduleEdit(${id})">Save Changes</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('sched-edit-${id}').remove()">Cancel</button>
      </div>
    </div>
    <p class="income-edit-note">Entries from today onward will be regenerated with the new values. Past entries are unchanged.</p>
  `;

  const row = document.getElementById(`sched-${id}`);
  row?.insertAdjacentElement('afterend', el);
};

window._seditFreqChange = function (id) {
  const freq = document.getElementById(`sedit-freq-${id}`)?.value;
  const container = document.getElementById(`sedit-freqfield-${id}`);
  if (!container) return;
  if (freq === 'monthly') {
    container.innerHTML = `
      <label class="ui-field income-edit-frequency-value">
        <span>Day of month</span>
        <input type="number" inputmode="numeric" id="sedit-day-${id}" placeholder="1–31" min="1" max="31" required>
      </label>`;
  } else {
    container.innerHTML = `
      <label class="ui-field income-edit-frequency-value">
        <span>First pay date</span>
        <input type="date" id="sedit-anchor-${id}" title="First pay date" required>
      </label>`;
  }
};

window._seditEndChange = function (id) {
  const mode = document.getElementById(`sedit-endmode-${id}`)?.value;
  const container = document.getElementById(`sedit-endfield-${id}`);
  if (!container) return;
  if (mode === 'date') {
    container.innerHTML = `<label class="ui-field income-edit-end-value">
      <span>End date</span><input type="date" id="sedit-enddate-${id}" required>
    </label>`;
  } else if (mode === 'count') {
    container.innerHTML = `<label class="ui-field income-edit-end-value">
      <span>Occurrences</span><input type="number" inputmode="numeric"
        id="sedit-endcount-${id}" min="1" max="10000" value="12" required>
    </label>`;
  } else {
    container.innerHTML = '';
  }
};

window.saveScheduleEdit = async function (id) {
  const freq    = document.getElementById(`sedit-freq-${id}`)?.value;
  const name    = document.getElementById(`sedit-name-${id}`)?.value?.trim();
  const amount  = document.getElementById(`sedit-amount-${id}`)?.value;
  const acctEl  = document.getElementById(`sedit-acct-${id}`);
  const account_id = acctEl?.value ? Number(acctEl.value) : null;

  const body = { name, amount, frequency: freq, account_id };
  if (freq === 'monthly') {
    body.day_of_month = Number(document.getElementById(`sedit-day-${id}`)?.value);
  } else {
    body.anchor_date = document.getElementById(`sedit-anchor-${id}`)?.value;
  }
  const endMode = document.getElementById(`sedit-endmode-${id}`)?.value || 'never';
  body.recurrence = {
    frequency: freq,
    start_date: freq === 'monthly' ? undefined : body.anchor_date,
    end_mode: endMode,
  };
  if (endMode === 'date') {
    body.recurrence.end_date = document.getElementById(`sedit-enddate-${id}`)?.value;
  }
  if (endMode === 'count') {
    body.recurrence.max_occurrences = Number(document.getElementById(`sedit-endcount-${id}`)?.value);
  }

  if (!name || !amount) return;
  await api(`/income/schedules/${id}`, { method: 'PATCH', body });
  pages.income(_incomeView.year, _incomeView.month, 'recurring');
};

window.pauseIncomeSeries = async function (seriesId) {
  if (!confirm('Pause this recurring income? Occurrences while paused will be skipped.')) return;
  await api(`/recurring/${seriesId}/pause`, { method: 'POST' });
  await pages.income(_incomeView.year, _incomeView.month, 'recurring');
};

window.resumeIncomeSeries = async function (seriesId) {
  await api(`/recurring/${seriesId}/resume`, { method: 'POST' });
  await pages.income(_incomeView.year, _incomeView.month, 'recurring');
};

}
