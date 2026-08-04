export function installTransfers(ctx) {
  const {
    $, main, fmt, api, getAccounts, invalidateAccounts, pages, esc,
    formatDate, renderPageHeader, renderSectionHeader, renderEmptyState,
    toDateInput, submitForm,
  } = ctx;
  let refreshTransfers = () => pages.transfers();
  let currentAccounts = [];
  const accountOptions = (selected) => currentAccounts.map(account => `
    <option value="${account.id}" ${Number(selected) === account.id ? 'selected' : ''}>
      ${esc(account.name)}
    </option>`).join('');

  pages.transfers = async function () {
    invalidateAccounts();
    const [transfers, accounts, recurringTransfers] = await Promise.all([
      api('/transfers'), getAccounts(), api('/recurring?kind=transfer'),
    ]);
    currentAccounts = accounts;
    const today = toDateInput(new Date());
    refreshTransfers = () => pages.transfers();

    main().innerHTML = `
      <div class="ui-page transfers-page">
        ${renderPageHeader({
          title: 'Transfers',
          subtitle: 'Move money between your accounts and review transfer history.',
        })}

        <section class="card ui-card transfers-add-card" aria-labelledby="transfers-add-title">
          ${renderSectionHeader({ title: 'New transfer', id: 'transfers-add-title' })}
          <form id="txfrForm" class="ui-responsive-form transfers-form">
            <label class="ui-field transfers-field">
              <span>From account</span>
              <select id="txfrFrom" required>${accountOptions()}</select>
            </label>
            <label class="ui-field transfers-field">
              <span>To account</span>
              <select id="txfrTo" required>${accountOptions(accounts[1]?.id)}</select>
            </label>
            <label class="ui-field transfers-field">
              <span>Amount</span>
              <input type="number" id="txfrAmount" placeholder="£0.00" min="0.01" max="1000000000000" step="0.01" required>
            </label>
            <label class="ui-field transfers-field">
              <span>Date</span>
              <input type="date" id="txfrDate" value="${today}" required>
            </label>
            <label class="ui-field transfers-field transfers-note-field">
              <span>Note</span>
              <input type="text" id="txfrNote" placeholder="Optional note">
            </label>
            <label class="ui-field transfers-repeat-field">
              <span>Repeat</span>
              <span class="transfers-repeat-toggle">
                <input type="checkbox" id="txfrRepeat">
                <span>Make this recurring</span>
              </span>
            </label>
            <div class="transfers-recurrence-fields" id="txfrRecurrenceFields" hidden>
              <label class="ui-field transfers-field">
                <span>Frequency</span>
                <select id="txfrFrequency">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="four_weekly">Four-weekly</option>
                  <option value="monthly" selected>Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <label class="ui-field transfers-field">
                <span>Ends</span>
                <select id="txfrEndMode">
                  <option value="never">Never</option>
                  <option value="date">On a date</option>
                  <option value="count">After occurrences</option>
                </select>
              </label>
              <label class="ui-field transfers-field" id="txfrEndDateField" hidden>
                <span>End date</span>
                <input type="date" id="txfrEndDate">
              </label>
              <label class="ui-field transfers-field" id="txfrCountField" hidden>
                <span>Occurrence count</span>
                <input type="number" id="txfrOccurrenceCount" min="1" max="10000" value="12">
              </label>
            </div>
            <button class="btn btn-primary transfers-submit" type="submit">Transfer</button>
          </form>
        </section>

        ${recurringTransfers.some(series => ['active', 'paused'].includes(series.status)) ? `
          <section class="card ui-card transfers-recurring-card" aria-labelledby="transfers-recurring-title">
            ${renderSectionHeader({
              title: 'Recurring transfers',
              subtitle: 'Transfers execute automatically only when due.',
              id: 'transfers-recurring-title',
            })}
            <div class="transfers-recurring-list">
              ${recurringTransfers.filter(series => ['active', 'paused'].includes(series.status)).map(series => `
                <article class="transfers-recurring-item">
                  <div class="transfers-recurring-copy">
                    <strong>${esc(series.from_account_name)} → ${esc(series.to_account_name)}</strong>
                    ${series.note ? `<span>${esc(series.note)}</span>` : ''}
                    <span>${fmt(series.amount)} · ${esc(series.frequency.replaceAll('_', '-'))}</span>
                    <span>${series.status === 'paused' ? 'Paused' : series.next_due_date
                      ? `Next: ${formatDate(series.next_due_date)}` : 'Pending completion'}</span>
                  </div>
                  <div class="ui-button-group transfers-recurring-actions">
                    ${series.status === 'active'
                      ? `<button class="btn btn-ghost btn-sm" data-transfer-series-action="pause" data-series-id="${series.id}">Pause</button>
                         <button class="btn btn-ghost btn-sm" data-transfer-series-action="skip-next" data-series-id="${series.id}">Skip next</button>`
                      : `<button class="btn btn-ghost btn-sm" data-transfer-series-action="resume" data-series-id="${series.id}">Resume</button>`}
                    <button class="btn btn-danger btn-sm" data-transfer-series-action="stop" data-series-id="${series.id}">Stop recurring</button>
                  </div>
                </article>`).join('')}
            </div>
          </section>` : ''}

        <section class="card ui-card transfers-history-card" aria-labelledby="transfers-history-title">
          ${renderSectionHeader({ title: 'History', id: 'transfers-history-title' })}
          <div class="list transfers-list" id="txfrList">
            ${transfers.length === 0 ? renderEmptyState({
              title: 'No transfers yet',
              description: 'Transfers between your accounts will appear here.',
            }) : transfers.map(transfer => `
              <article class="list-item transfers-item" id="txfr-${transfer.id}"
                data-from-account-id="${transfer.from_account_id}"
                data-to-account-id="${transfer.to_account_id}"
                data-amount="${transfer.amount}" data-date="${transfer.date}"
                data-note="${esc(transfer.note ?? '')}"
                data-recurring-series-id="${transfer.recurring_series_id ?? ''}">
                <div class="transfers-item-route">
                  <span class="dot" style="background:${esc(transfer.from_account_colour)}"></span>
                  <span>${esc(transfer.from_account_name)}</span>
                  <span class="transfers-arrow" aria-hidden="true">→</span>
                  <span class="dot" style="background:${esc(transfer.to_account_colour)}"></span>
                  <span>${esc(transfer.to_account_name)}</span>
                </div>
                <div class="transfers-item-copy">
                  ${transfer.note ? `<span>${esc(transfer.note)}</span>` : ''}
                  <span class="date">${formatDate(transfer.date)}</span>
                </div>
                <span class="amount">${fmt(transfer.amount)}</span>
                <div class="ui-button-group transfers-item-actions">
                  ${transfer.recurring_series_id
                    ? `<button class="btn btn-ghost btn-sm" onclick="editTransfer(${transfer.id})">Edit</button>` : ''}
                  <button class="btn btn-danger btn-sm" onclick="deleteTransfer(${transfer.id})">Delete</button>
                </div>
              </article>`).join('')}
          </div>
        </section>
      </div>`;

    $('txfrForm').addEventListener('submit', async event => {
      event.preventDefault();
      await submitForm(event.currentTarget, async () => {
      const fromId = Number($('txfrFrom').value);
      const toId = Number($('txfrTo').value);
      if (fromId === toId) {
        alert('From and To accounts must be different.');
        return;
      }
      const body = {
        from_account_id: fromId,
        to_account_id: toId,
        amount: $('txfrAmount').value,
        date: $('txfrDate').value,
        note: $('txfrNote').value || null,
      };
      if ($('txfrRepeat').checked) {
        const endMode = $('txfrEndMode').value;
        body.recurrence = {
          frequency: $('txfrFrequency').value,
          start_date: $('txfrDate').value,
          end_mode: endMode,
          ...(endMode === 'date' ? { end_date: $('txfrEndDate').value } : {}),
          ...(endMode === 'count' ? { max_occurrences: Number($('txfrOccurrenceCount').value) } : {}),
        };
      }
      await api('/transfers', { method: 'POST', body });
      invalidateAccounts();
      await refreshTransfers();
      });
    });

    const updateRecurrenceFields = () => {
      $('txfrRecurrenceFields').hidden = !$('txfrRepeat').checked;
      const endMode = $('txfrEndMode').value;
      $('txfrEndDateField').hidden = endMode !== 'date';
      $('txfrCountField').hidden = endMode !== 'count';
    };
    $('txfrRepeat').addEventListener('change', updateRecurrenceFields);
    $('txfrEndMode').addEventListener('change', updateRecurrenceFields);
    updateRecurrenceFields();

    document.querySelectorAll('[data-transfer-series-action]').forEach(button => {
      button.addEventListener('click', async () => {
        const action = button.dataset.transferSeriesAction;
        if (action === 'stop' && !confirm('Stop this recurring transfer? Existing transfers will be kept.')) return;
        await api(`/recurring/${button.dataset.seriesId}/${action}`, { method: 'POST', body: {} });
        refreshTransfers();
      });
    });
  };

  window.editTransfer = function (id) {
    const row = document.getElementById(`txfr-${id}`);
    if (!row) return;
    row.innerHTML = `
      <div class="ui-responsive-form transfers-edit-form">
        <label class="ui-field"><span>From</span><select id="editTxfrFrom">${accountOptions(row.dataset.fromAccountId)}</select></label>
        <label class="ui-field"><span>To</span><select id="editTxfrTo">${accountOptions(row.dataset.toAccountId)}</select></label>
            <label class="ui-field"><span>Amount</span><input type="number" id="editTxfrAmount" min="0.01" max="1000000000000" step="0.01" value="${esc(row.dataset.amount)}"></label>
        <label class="ui-field"><span>Note</span><input type="text" id="editTxfrNote" value="${esc(row.dataset.note)}"></label>
        <label class="ui-field"><span>Apply changes to</span><select id="editTxfrScope"><option value="single">This transfer only</option><option value="future">This and future occurrences</option></select></label>
        <div class="ui-button-group transfers-edit-actions">
          <button class="btn btn-primary btn-sm" onclick="saveTransfer(${id})">Save changes</button>
          <button class="btn btn-ghost btn-sm" onclick="pages.transfers()">Cancel</button>
        </div>
      </div>`;
  };

  window.saveTransfer = async function (id) {
    await api(`/transfers/${id}`, { method: 'PUT', body: {
      from_account_id: Number($('editTxfrFrom').value),
      to_account_id: Number($('editTxfrTo').value),
      amount: $('editTxfrAmount').value,
      note: $('editTxfrNote').value || null,
      scope: $('editTxfrScope').value,
    }});
    invalidateAccounts();
    refreshTransfers();
  };

  window.deleteTransfer = async function (id) {
    if (!confirm('Delete this transfer?')) return;
    await api(`/transfers/${id}`, { method: 'DELETE' });
    invalidateAccounts();
    refreshTransfers();
  };
}
