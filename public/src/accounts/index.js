export function installAccounts(ctx) {
  const {
    $, main, renderPageHeader, renderSectionHeader, renderCurrency,
    renderEmptyState, mountModal, api, getAccounts, invalidateAccounts,
    pages, esc, submitForm,
  } = ctx;
const ACCT_SWATCHES = ['#4a9eff','#f7a4a2','#ff6b6b','#ffd700','#4ade80','#c39bd3'];
const ACCOUNT_TYPE_LABELS = {
  current: 'Current account',
  savings: 'Savings',
  card: 'Card',
};

pages.accounts = async function(mode = null, editId = null) {
  invalidateAccounts();

  main().innerHTML = `
    <div class="ui-page accounts-page">
      ${renderPageHeader({
        title: 'Accounts',
        subtitle: 'Manage the accounts that power your balances and transactions.',
        className: 'accounts-page-header',
      })}
      <div class="ui-loading-placeholder accounts-loading" role="status" aria-live="polite">
        <span class="ui-loading-placeholder__bar ui-loading-placeholder__bar--wide" aria-hidden="true"></span>
        <span class="ui-loading-placeholder__bar" aria-hidden="true"></span>
        <span>Loading accounts…</span>
      </div>
    </div>`;

  const accounts = await getAccounts();
  const editAcc = editId ? accounts.find(a => a.id === editId) : null;

  const formAcc = editAcc ?? { name: '', type: 'current', opening_balance: 0, colour: ACCT_SWATCHES[0] };
  const swatchesHtml = ACCT_SWATCHES.map(c => `
    <button class="accounts-colour-swatch${formAcc.colour === c ? ' active' : ''}"
      type="button" data-colour="${c}" aria-label="Use account colour ${c}"
      aria-pressed="${formAcc.colour === c}" style="background:${c}"></button>`).join('');

  const formHtml = `
    <section class="card ui-card accounts-form-card" aria-labelledby="accounts-form-title">
      ${renderSectionHeader({
        title: mode === 'edit' ? 'Edit account' : 'Add account',
        subtitle: mode === 'edit'
          ? 'Update this account without changing its transaction history.'
          : 'Add another place where you hold or spend money.',
        id: 'accounts-form-title',
      })}
      <div class="ui-responsive-form accounts-form-grid">
        <label class="ui-field accounts-field-name">
          <span>Account name</span>
          <input type="text" id="accName" placeholder="e.g. Everyday account" value="${esc(formAcc.name)}">
        </label>
        <label class="ui-field accounts-field-type">
          <span>Account type</span>
          <select id="accType">
            <option value="current" ${formAcc.type==='current'?'selected':''}>Current</option>
            <option value="savings" ${formAcc.type==='savings'?'selected':''}>Savings</option>
            <option value="card"    ${formAcc.type==='card'   ?'selected':''}>Card</option>
          </select>
        </label>
        <label class="ui-field accounts-field-opening">
          <span>Opening balance</span>
          <input type="number" inputmode="decimal" id="accOpening" placeholder="£0.00" value="${formAcc.opening_balance}" min="-1000000000000" max="1000000000000" step="0.01">
        </label>
      </div>
      <div class="accounts-colour-field">
        <span class="accounts-field-label">Account colour</span>
        <div class="ui-button-group accounts-colour-options" role="group" aria-label="Account colour">
          ${swatchesHtml}
        </div>
      </div>
      <div class="ui-button-group accounts-form-actions">
        <button class="btn btn-primary" id="accSaveBtn" type="button">${mode === 'edit' ? 'Save Changes' : 'Save Account'}</button>
        <button class="btn btn-ghost" onclick="pages.accounts()">Cancel</button>
        ${mode === 'edit' ? `<button class="btn btn-danger accounts-deactivate-button" onclick="deactivateAccount(${editId})">Deactivate</button>` : ''}
      </div>
    </section>`;

  main().innerHTML = `
    <div class="ui-page accounts-page">
      ${renderPageHeader({
        title: 'Accounts',
        subtitle: `${accounts.length} active account${accounts.length === 1 ? '' : 's'} connected to your finances.`,
        className: 'accounts-page-header',
        introClass: 'accounts-title-group',
        actionsClass: 'accounts-header-actions',
        actions: mode
          ? '<button class="btn btn-ghost" onclick="pages.accounts()">Cancel</button>'
          : '<button class="btn btn-primary" id="accountsAddButton">Add Account</button>',
      })}
      ${mode ? formHtml : ''}
      <section class="accounts-list-section" aria-labelledby="accounts-list-title">
        ${renderSectionHeader({
          title: 'Your accounts',
          subtitle: 'Balances include recorded income, spending, bills and transfers.',
          id: 'accounts-list-title',
        })}
        <div class="ui-responsive-grid accounts-grid">
          ${accounts.length === 0 ? renderEmptyState({
            title: 'No active accounts',
            description: 'Add an account to start assigning income, transactions, bills and transfers.',
            action: '<button class="btn btn-primary" id="accountsEmptyAdd">Add Account</button>',
            icon: '＋',
            className: 'accounts-empty-state',
          }) : accounts.map(account => `
            <article class="stat-card ui-stat-card ui-summary-card accounts-card"
              style="--account-colour:${esc(account.colour)}">
              <div class="accounts-card-heading">
                <div class="accounts-card-identity">
                  <span class="accounts-card-dot" style="background:${esc(account.colour)}" aria-hidden="true"></span>
                  <h3>${esc(account.name)}</h3>
                </div>
                <span class="badge accounts-type-badge">${ACCOUNT_TYPE_LABELS[account.type] ?? esc(account.type)}</span>
              </div>
              <div class="accounts-balance-label">Available balance</div>
              <div class="accounts-balance">${renderCurrency(account.balance)}</div>
              <div class="accounts-opening">Opening balance ${renderCurrency(account.opening_balance)}</div>
              <div class="ui-button-group accounts-card-actions">
                <button class="btn btn-ghost btn-sm" onclick="pages.accounts('edit',${account.id})"
                  aria-label="Edit ${esc(account.name)}">Edit</button>
              </div>
            </article>`).join('')}
        </div>
      </section>
    </div>
  `;
  main().scrollTop = 0;

  const openAddAccount = async () => {
    await pages.accounts('add');
    $('accName')?.focus();
  };
  $('accountsAddButton')?.addEventListener('click', openAddAccount);
  $('accountsEmptyAdd')?.addEventListener('click', openAddAccount);

  if (mode) {
    window._acctColour = formAcc.colour;
    document.querySelectorAll('.accounts-colour-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        window._acctColour = swatch.dataset.colour;
        document.querySelectorAll('.accounts-colour-swatch').forEach(option => {
          const selected = option === swatch;
          option.classList.toggle('active', selected);
          option.setAttribute('aria-pressed', String(selected));
        });
      });
    });
    $('accSaveBtn').addEventListener('click', async event => {
      await submitForm(event.currentTarget, async () => {
      const name    = $('accName').value.trim();
      const type    = $('accType').value;
      const opening = $('accOpening').value || '0';
      const colour  = window._acctColour || ACCT_SWATCHES[0];
      if (!name) { $('accName').focus(); return; }
      if (mode === 'edit') {
        await api(`/accounts/${editId}`, { method: 'PATCH', body: { name, type, opening_balance: opening, colour } });
      } else {
        await api('/accounts', { method: 'POST', body: { name, type, opening_balance: opening, colour } });
      }
      await pages.accounts();
      });
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
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="deactivate-account-title">
      <h3 id="deactivate-account-title">Deactivate "${esc(name)}"?</h3>
      <p>Only accounts that are no longer used by financial items can be deactivated.</p>
      <div class="ui-status-message ui-status-message--danger" id="deactivateAccountStatus"
        role="alert" aria-live="assertive" tabindex="-1" hidden></div>
      <div class="modal-actions ui-modal-footer">
        <button class="btn btn-ghost" id="dAccNo">Cancel</button>
        <button class="btn btn-danger" id="dAccYes">Deactivate</button>
      </div>
    </div>`;
  const closeModal = mountModal(modal, '#dAccNo');
  $('dAccNo').addEventListener('click', closeModal);
  $('dAccYes').addEventListener('click', async () => {
    const button = $('dAccYes');
    const status = $('deactivateAccountStatus');
    button.disabled = true;
    try {
      await api(`/accounts/${id}/deactivate`, { method: 'PATCH' });
      closeModal();
      await pages.accounts();
    } catch (error) {
      const labels = {
        bills: 'Bills',
        income: 'Income',
        transfers: 'Transfers',
        transactions: 'Transactions',
        recurring_items: 'Recurring items',
      };
      if (error.code === 'ACCOUNT_HAS_DEPENDENCIES' && error.details) {
        status.innerHTML = `<strong>This account is still used by active items.</strong>
          <ul>${Object.entries(labels).map(([key, label]) =>
            `<li>${label}: ${Number(error.details[key] ?? 0)}</li>`).join('')}</ul>`;
      } else {
        status.textContent = error.message;
      }
      status.hidden = false;
      status.focus();
      button.disabled = false;
    }
  });
};

}
