export function installTransfers(ctx) {
  const {
    $, main, fmt, api, getAccounts, invalidateAccounts, pages, esc,
    formatDate,
  } = ctx;
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

    <div class="card card-spaced">
      <form id="txfrForm" class="form-row form-row-compact">
        <select class="form-control-medium" id="txfrFrom" aria-label="From account" required>${acctOptions}</select>
        <span style="color:var(--muted);font-size:18px;align-self:center" aria-hidden="true">→</span>
        <select class="form-control-medium" id="txfrTo" aria-label="To account" required>${acctOptions}</select>
        <input class="form-control-compact" type="number" id="txfrAmount" aria-label="Transfer amount" placeholder="Amount £" min="0.01" step="0.01" required>
        <input class="form-control-medium" type="date" id="txfrDate" aria-label="Transfer date" value="${today}" required>
        <input class="form-control-grow" type="text" id="txfrNote" aria-label="Transfer note" placeholder="Note (optional)">
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
              <button class="btn btn-danger btn-sm" onclick="deleteTransfer(${t.id})">Delete</button>
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
}
