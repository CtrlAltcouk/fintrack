export function installSettings(ctx) {
  const {
    $, main, fmt, renderPageHeader, renderSectionHeader, renderEmptyState,
    mountModal, api, getCategories, invalidateCategories,
    invalidateAccounts, pages, esc, state, ACCENT_PRESETS,
    BG_DARK_PRESETS, BG_LIGHT_PRESETS, avatarCircle, applyUserPill,
    navigate,
  } = ctx;
let renderedCategories = [];
let renderedUsers = [];
pages.settings = async function (activeTab = 'categories') {
  const isAdmin = Boolean(state.currentUser?.is_admin);
  const allowedTabs = new Set(['categories', 'personalisation', 'system', 'users', ...(isAdmin ? ['updates'] : [])]);
  if (!allowedTabs.has(activeTab)) activeTab = 'categories';
  invalidateCategories();
  main().innerHTML = `
    <div class="ui-page settings-page">
      ${renderPageHeader({
        title: 'Settings',
        subtitle: 'Manage your preferences, categories, people and application tools.',
        className: 'settings-page-header',
      })}
      <div class="ui-loading-placeholder settings-loading" role="status" aria-live="polite">
        <span class="ui-loading-placeholder__bar ui-loading-placeholder__bar--wide" aria-hidden="true"></span>
        <span class="ui-loading-placeholder__bar" aria-hidden="true"></span>
        Loading settings…
      </div>
    </div>`;

  const [cats, version, allUsers, ppSettings, schedules] = await Promise.all([
    getCategories(),
    api('/update/version').catch(() => ({ hash: 'unknown', message: '', date: '', version: '?' })),
    state.currentUser?.is_admin ? api('/users') : Promise.resolve([]),
    api('/settings/pay-period'),
    api('/income/schedules'),
  ]);
  renderedCategories = cats;
  renderedUsers = allUsers;

  const tab = t => {
    const labels = { categories: 'Categories', personalisation: 'Personalisation', updates: 'Updates', system: 'System', users: isAdmin ? 'Users' : 'Account' };
    return `<button class="tab-btn ${activeTab === t ? 'active' : ''}" type="button"
      aria-pressed="${activeTab === t}" onclick="pages.settings('${t}')">${labels[t]}</button>`;
  };

  const categoriesHTML = `
    <section class="card ui-card settings-card settings-categories-card" aria-labelledby="settings-categories-title">
      ${renderSectionHeader({
        title: 'Spending categories',
        subtitle: 'Use colours and clear names to make transactions easier to scan.',
        id: 'settings-categories-title',
      })}
      <form id="catForm" class="ui-responsive-form settings-category-form">
        <label class="ui-field settings-category-name">
          <span>Category name</span>
          <input type="text" id="catName" placeholder="e.g. Groceries" required>
        </label>
        <label class="ui-field settings-category-colour">
          <span>Colour</span>
          <input type="color" id="catColour" value="#f7a4a2">
        </label>
        <button class="btn btn-primary settings-category-add" type="submit">Add Category</button>
      </form>
      ${cats.length ? `
      <div class="list settings-category-list" id="catList">
        ${cats.map(c => `
          <div class="list-item settings-category-item" id="cat-${c.id}">
            <span class="dot" style="background:${esc(c.colour)}"></span>
            <span class="desc">${esc(c.name)}</span>
            <div class="ui-button-group settings-category-actions">
              <button class="btn btn-ghost btn-sm settings-edit-category" type="button"
                data-category-id="${c.id}">Edit</button>
              <button class="btn btn-danger btn-sm" type="button" onclick="deleteCat(${c.id})">Delete</button>
            </div>
          </div>`).join('')}
      </div>` : renderEmptyState({
        title: 'No categories yet',
        description: 'Add a category above to start organising spending.',
        icon: '◌',
        className: 'settings-empty-state',
      })}
    </section>`;

  const updatesHTML = `
    <section class="card ui-card settings-card settings-update-card" aria-labelledby="settings-version-title">
      ${renderSectionHeader({
        title: 'Application updates',
        subtitle: 'Review the installed version and check for a newer release.',
        id: 'settings-version-title',
      })}
      <div class="settings-version-row">
        <span class="badge badge-paid settings-version-badge">v${version.version}</span>
        <code class="settings-version-hash">${esc(version.hash)}</code>
        ${version.message ? `<span class="settings-version-message">${esc(version.message)}</span>` : ''}
      </div>
      <div id="checkStatus" class="settings-action-status" aria-live="polite"></div>
      <div class="ui-button-group settings-card-actions">
        <button class="btn btn-ghost" id="checkBtn" onclick="checkForUpdates()">Check for Updates</button>
        <button class="btn btn-primary" id="updateBtn" onclick="triggerUpdate()">Update Now</button>
      </div>
      <p class="settings-help-text">
        Pulls the latest code from GitHub, installs any new dependencies, and restarts the app automatically.
      </p>
    </section>`;

  const systemHTML = `
    <div class="ui-responsive-grid settings-system-grid">
    ${state.currentUser?.is_admin ? `
    <section class="card ui-card settings-card settings-system-card settings-backup-card" aria-labelledby="settings-backup-title">
      ${renderSectionHeader({
        title: 'Backup & Restore',
        subtitle: 'Download a complete JSON backup or restore a previous snapshot.',
        id: 'settings-backup-title',
      })}
      <div class="settings-subsection">
        <h3 class="settings-subsection-title">Backup</h3>
        <button class="btn btn-ghost" type="button" onclick="window.location.href='/api/backup'">Download Backup</button>
      </div>
      <div class="settings-subsection settings-restore-section">
        <h3 class="settings-subsection-title">Restore</h3>
        <div class="ui-responsive-form settings-restore-form">
          <label class="ui-field">
            <span>Backup file</span>
            <input type="file" id="backupFile" accept=".json"
            onchange="document.getElementById('restoreBtn').disabled = !this.files.length">
          </label>
          <label class="ui-field">
            <span>Restore mode</span>
            <select id="restoreMode" onchange="updateRestoreWarning()">
              <option value="replace">Replace all data (recommended)</option>
              <option value="merge">Merge with existing data</option>
            </select>
          </label>
          <div id="restoreWarning" class="ui-status-message settings-restore-warning">
            All existing data will be permanently replaced. You will be logged out after restore.
          </div>
          <div id="restoreStatus" class="settings-action-status" aria-live="polite"></div>
          <button class="btn btn-ghost" id="restoreBtn" onclick="doRestore()" disabled>Restore</button>
        </div>
      </div>
    </section>` : ''}
    ${isAdmin ? `<section class="card ui-card settings-card settings-system-card" aria-labelledby="settings-restart-title">
      ${renderSectionHeader({
        title: 'Restart application',
        subtitle: 'Restart the Node.js process after making manual configuration changes.',
        id: 'settings-restart-title',
      })}
      <div id="restartStatus" class="settings-action-status" aria-live="polite"></div>
      <button class="btn btn-ghost" id="restartBtn" onclick="triggerRestart()">Restart App</button>
    </section>` : ''}
    <section class="card ui-card settings-card settings-system-card settings-danger-card" aria-labelledby="settings-danger-title">
      ${renderSectionHeader({
        title: 'Danger zone',
        subtitle: 'These actions permanently remove financial records and cannot be undone.',
        id: 'settings-danger-title',
      })}
      <div class="settings-danger-action">
        <p>
        Permanently deletes <strong>your</strong> transactions, income, bills, and accounts. Categories are kept. This cannot be undone.
        </p>
        <button class="btn btn-danger" onclick="clearMyData()">Clear My Data</button>
      </div>
      ${state.currentUser?.is_admin ? `
      <div class="settings-danger-action">
        <p>
          Permanently deletes all transactions, income, bills, and accounts for <strong>every user</strong>. Categories are kept. This cannot be undone.
        </p>
        <button class="btn btn-danger" onclick="clearAllData()">Clear All Data (All Users)</button>
      </div>` : ''}
    </section>
    <section class="card ui-card settings-card settings-system-card" aria-labelledby="settings-about-title">
      ${renderSectionHeader({
        title: 'About Outflow',
        subtitle: 'Application and runtime information.',
        id: 'settings-about-title',
      })}
      <p class="settings-about-copy">
        Outflow v${version.version}<br>
        Node.js &middot; Express &middot; SQLite &middot; Chart.js<br>
        <a href="https://github.com/CtrlAltcouk/fintrack" target="_blank" rel="noreferrer">github.com/CtrlAltcouk/fintrack</a>
      </p>
    </section>
    </div>`;

  const usersHTML = state.currentUser?.is_admin ? `
    <div class="ui-responsive-grid settings-users-grid">
    <section class="card ui-card settings-card settings-users-card" aria-labelledby="settings-users-title">
      ${renderSectionHeader({
        title: 'People with access',
        subtitle: 'Manage profiles that can sign in to this Outflow installation.',
        id: 'settings-users-title',
      })}
      <div class="list settings-users-list" id="usersList">
        ${allUsers.map(u => `
          <div class="list-item settings-user-item">
            ${avatarCircle(u, 28)}
            <span class="desc">${esc(u.display_name)}</span>
            <span class="badge settings-role-badge">${u.is_admin ? 'Admin' : 'User'}</span>
            ${u.id === state.currentUser.id ? '' : `<button class="btn btn-danger btn-sm settings-delete-user" type="button" data-user-id="${u.id}">Delete</button>`}
          </div>`).join('')}
      </div>
      <form id="addUserForm" class="ui-responsive-form settings-user-form">
        <label class="ui-field">
          <span>Display name</span>
          <input type="text" id="newUserDisplay" placeholder="e.g. Alex" required autocomplete="off">
        </label>
        <label class="ui-field">
          <span>Password</span>
          <input type="password" id="newUserPassword" placeholder="Choose a password" required>
        </label>
        <fieldset class="settings-colour-field">
          <legend>User colour</legend>
          <div class="ui-button-group colour-picker-row settings-colour-options" id="addUserColours">
            ${['#4a9eff','#f7a4a2','#a8d8a8','#ffd700','#c39bd3','#ff8c42','#76d7c4'].map((c,i) =>
              `<button class="colour-opt${i===0?' selected':''}" type="button" data-colour="${c}"
                aria-label="Use user colour ${c}" aria-pressed="${i===0}" style="background:${c}" onclick="pickColour(this)"></button>`
            ).join('')}
          </div>
        </fieldset>
        <button class="btn btn-primary settings-user-add" type="submit">Add User</button>
        <div id="addUserStatus" class="ui-status-message" role="status" aria-live="polite" hidden></div>
      </form>
    </section>
    <section class="card ui-card settings-card settings-password-card" aria-labelledby="settings-password-title">
      ${renderSectionHeader({
        title: 'Change password',
        subtitle: 'Update the password for your current profile.',
        id: 'settings-password-title',
      })}
      <form id="changePwForm" class="ui-responsive-form settings-password-form">
        <label class="ui-field">
          <span>Current password</span>
          <input type="password" id="cpCurrent" placeholder="Current password">
        </label>
        <label class="ui-field">
          <span>New password</span>
          <input type="password" id="cpNew" placeholder="New password">
        </label>
        <button type="submit" class="btn btn-ghost settings-password-submit">Update Password</button>
        <div id="changePwStatus" class="ui-status-message" role="status" aria-live="polite" hidden></div>
      </form>
    </section>
    </div>` : `
    <section class="card ui-card settings-card settings-password-card" aria-labelledby="settings-password-title">
      ${renderSectionHeader({
        title: 'Change password',
        subtitle: 'Update the password for your current profile.',
        id: 'settings-password-title',
      })}
      <form id="changePwForm" class="ui-responsive-form settings-password-form">
        <label class="ui-field">
          <span>Current password</span>
          <input type="password" id="cpCurrent" placeholder="Current password">
        </label>
        <label class="ui-field">
          <span>New password</span>
          <input type="password" id="cpNew" placeholder="New password">
        </label>
        <button type="submit" class="btn btn-ghost settings-password-submit">Update Password</button>
        <div id="changePwStatus" class="ui-status-message" role="status" aria-live="polite" hidden></div>
      </form>
    </section>`;

  const bgPresets = state.currentTheme.mode === 'dark' ? BG_DARK_PRESETS : BG_LIGHT_PRESETS;

  const personalisationHTML = `
    <div class="ui-responsive-grid settings-personalisation-grid">
      <section class="card ui-card settings-card settings-profile-card" aria-labelledby="settings-profile-title">
        ${renderSectionHeader({
          title: 'Profile',
          subtitle: 'Choose how your profile appears throughout Outflow.',
          id: 'settings-profile-title',
        })}
        <div class="settings-profile-layout">
          <div id="avatarPreview" class="settings-avatar-preview">
            ${avatarCircle(state.currentUser, 48)}
          </div>
          <fieldset class="settings-colour-field">
            <legend>Avatar colour</legend>
            <div class="ui-button-group colour-picker-row settings-colour-options" id="avatarColours">
              ${['#4a9eff','#f7a4a2','#a8d8a8','#ffd700','#c39bd3','#ff8c42','#76d7c4'].map(c =>
                `<button class="colour-opt${state.currentUser.colour === c ? ' selected' : ''}" type="button" data-colour="${c}"
                  aria-label="Use avatar colour ${c}" aria-pressed="${state.currentUser.colour === c}"
                  style="background:${c}" onclick="window.pickAvatarColour('${c}')"></button>`
              ).join('')}
            </div>
          </fieldset>
          <div class="settings-photo-field">
            <span class="settings-field-label">Profile photo</span>
            <div class="ui-button-group">
              <button class="btn btn-ghost btn-sm" type="button" onclick="document.getElementById('avatarFileInput').click()">Upload photo</button>
              ${state.currentUser.avatar ? `<button class="btn btn-ghost btn-sm settings-remove-photo" type="button" onclick="window.removeAvatar()">Remove photo</button>` : ''}
            </div>
            <input type="file" id="avatarFileInput" accept="image/*" style="display:none" onchange="window.uploadAvatar(this)">
          </div>
        </div>
      </section>

      <section class="card ui-card settings-card settings-appearance-card" aria-labelledby="settings-appearance-title">
        ${renderSectionHeader({
          title: 'Appearance',
          subtitle: 'Adjust the interface theme without changing your financial data.',
          id: 'settings-appearance-title',
        })}
        <div class="settings-preference-row">
          <div class="settings-preference-copy">
            <h3>Mode</h3>
            <p>Switch between dark and light theme.</p>
          </div>
          <div class="ui-button-group settings-segmented" role="group" aria-label="Appearance mode">
            <button class="btn btn-sm ${state.currentTheme.mode === 'dark' ? 'btn-primary' : 'btn-ghost'}"
              aria-pressed="${state.currentTheme.mode === 'dark'}" onclick="window.setMode('dark')">Dark</button>
            <button class="btn btn-sm ${state.currentTheme.mode === 'light' ? 'btn-primary' : 'btn-ghost'}"
              aria-pressed="${state.currentTheme.mode === 'light'}" onclick="window.setMode('light')">Light</button>
          </div>
        </div>
        <div class="settings-colour-settings">
          <fieldset class="settings-colour-field">
            <legend>Accent colour</legend>
            <p>Highlights, active links and primary buttons.</p>
            <div class="ui-button-group settings-swatches" id="accentSwatches">
              ${ACCENT_PRESETS.map(c => `<button class="swatch${state.currentTheme.accent.toLowerCase() === c ? ' selected' : ''}" type="button"
                aria-label="Use accent colour ${c}" aria-pressed="${state.currentTheme.accent.toLowerCase() === c}"
                data-colour="${c}" style="background:${c}" onclick="window.pickAccent('${c}')"></button>`).join('')}
              <button class="swatch swatch-custom" type="button" aria-label="Choose a custom accent colour"
                title="Custom colour" onclick="document.getElementById('accentCustom').click()"></button>
              <input type="color" id="accentCustom" style="display:none" value="${state.currentTheme.accent}" onchange="window.pickAccent(this.value)">
            </div>
          </fieldset>
          <fieldset class="settings-colour-field">
            <legend>Background colour</legend>
            <p>Sets the main application background.</p>
            <div class="ui-button-group settings-swatches" id="bgSwatches">
              ${bgPresets.map(c => `<button class="swatch${state.currentTheme.bg.toLowerCase() === c ? ' selected' : ''}" type="button"
                aria-label="Use background colour ${c}" aria-pressed="${state.currentTheme.bg.toLowerCase() === c}"
                data-colour="${c}" style="background:${c}" onclick="window.pickBg('${c}')"></button>`).join('')}
              <button class="swatch swatch-custom" type="button" aria-label="Choose a custom background colour"
                title="Custom colour" onclick="document.getElementById('bgCustom').click()"></button>
              <input type="color" id="bgCustom" style="display:none" value="${state.currentTheme.bg}" onchange="window.pickBg(this.value)">
            </div>
          </fieldset>
        </div>
        <div class="ui-button-group settings-reset-actions">
          <button class="btn btn-ghost btn-sm" onclick="window.resetTheme()">Reset to defaults</button>
        </div>
      </section>

      <section class="card ui-card settings-card settings-dashboard-card" aria-labelledby="settings-dashboard-title">
        ${renderSectionHeader({
          title: 'Dashboard view',
          subtitle: 'Choose how dashboard totals, charts and calendar periods are calculated.',
          id: 'settings-dashboard-title',
        })}
        <div class="settings-preference-row">
          <div class="settings-preference-copy">
            <h3>View mode</h3>
            <p>Use calendar months or your configured pay period.</p>
          </div>
          <div class="ui-button-group settings-segmented" role="group" aria-label="Dashboard view mode">
            <button class="btn btn-sm ${ppSettings.mode !== 'pay_period' ? 'btn-primary' : 'btn-ghost'}"
              aria-pressed="${ppSettings.mode !== 'pay_period'}" onclick="window.setDashModeSettings('monthly')">Monthly</button>
            <button class="btn btn-sm ${ppSettings.mode === 'pay_period' ? 'btn-primary' : 'btn-ghost'}"
              aria-pressed="${ppSettings.mode === 'pay_period'}" onclick="window.setDashModeSettings('pay_period')">Pay Period</button>
          </div>
        </div>
        <div class="settings-schedule-field">
          <label for="settingsPrimarySchedule">Primary pay schedule</label>
          <p>Defines the period boundaries in Pay Period mode.</p>
          ${schedules.filter(s => s.active).length === 0
            ? '<div class="settings-schedule-empty">No active recurring income schedules. <button class="btn btn-ghost btn-sm" onclick="navigate(\'income\')">Set up in Income →</button></div>'
            : '<select id="settingsPrimarySchedule" onchange="window.setPrimarySchedule(this.value)"><option value="">— None selected —</option>' +
              schedules.filter(s => s.active).map(s => {
                const fl = s.frequency === 'monthly'
                  ? 'monthly · day ' + s.day_of_month
                  : s.frequency === 'weekly'
                  ? 'weekly · from ' + esc(s.anchor_date)
                  : 'every 4 weeks · from ' + esc(s.anchor_date);
                return '<option value="' + s.id + '"' + (ppSettings.primary_schedule_id === s.id ? ' selected' : '') + '>' + esc(s.name) + ' · ' + fl + ' · ' + fmt(s.amount) + '</option>';
              }).join('') + '</select>'}
        </div>
      </section>
    </div>`;

  main().innerHTML = `
    <div class="ui-page settings-page">
      ${renderPageHeader({
        title: 'Settings',
        subtitle: 'Manage your preferences, categories, people and application tools.',
        className: 'settings-page-header',
      })}
      <div class="tabs-nav settings-tabs" role="group" aria-label="Settings sections">
        ${[tab('categories'), tab('personalisation'), ...(isAdmin ? [tab('updates')] : []), tab('system'), tab('users')].join('')}
      </div>
      <div class="settings-content">
        ${activeTab === 'categories' ? categoriesHTML : activeTab === 'personalisation' ? personalisationHTML : activeTab === 'updates' ? updatesHTML : activeTab === 'users' ? usersHTML : systemHTML}
      </div>
    </div>
  `;

  if (activeTab === 'categories') {
    $('catForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await api('/categories', { method: 'POST', body: {
          name: $('catName').value,
          colour: $('catColour').value,
        }});
        pages.settings('categories');
      } catch (error) {
        alert(error.message);
      }
    });
    document.querySelectorAll('.settings-edit-category').forEach(button => {
      button.addEventListener('click', () => window.editCat(Number(button.dataset.categoryId)));
    });
  }

  document.querySelectorAll('.settings-delete-user').forEach(button => {
    button.addEventListener('click', () => window.deleteUser(Number(button.dataset.userId)));
  });

  const addUserForm = document.getElementById('addUserForm');
  if (addUserForm) {
    addUserForm.addEventListener('submit', async event => {
      event.preventDefault();
      const status = document.getElementById('addUserStatus');
      status.hidden = true;
      try {
        const colour = addUserForm.querySelector('.colour-opt.selected')?.dataset.colour ?? '#4a9eff';
        await api('/users', { method: 'POST', body: {
          display_name: document.getElementById('newUserDisplay').value.trim(),
          password: document.getElementById('newUserPassword').value,
          colour,
        }});
        pages.settings('users');
      } catch (error) {
        status.textContent = error.message;
        status.hidden = false;
      }
    });
  }

  const changePasswordForm = document.getElementById('changePwForm');
  if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async event => {
      event.preventDefault();
      const status = document.getElementById('changePwStatus');
      status.hidden = true;
      try {
        await api(`/users/${state.currentUser.id}/password`, { method: 'PATCH', body: {
          current_password: document.getElementById('cpCurrent').value,
          new_password: document.getElementById('cpNew').value,
        }});
        document.getElementById('cpCurrent').value = '';
        document.getElementById('cpNew').value = '';
        status.textContent = 'Password updated.';
        status.hidden = false;
      } catch (error) {
        status.textContent = error.message;
        status.hidden = false;
      }
    });
  }
};


window.pickAvatarColour = async function(colour) {
  const result = await api(`/users/${state.currentUser.id}/colour`, { method: 'PATCH', body: { colour } });
  if (!result || result.error) return;
  state.currentUser.colour = colour;
  applyUserPill(state.currentUser);
  pages.settings('personalisation');
};

window.uploadAvatar = function(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 200 * 1024) {
    alert('Image too large — please choose a file under 200 KB.');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async function(e) {
    const avatar = e.target.result;
    const result = await api(`/users/${state.currentUser.id}/avatar`, { method: 'PATCH', body: { avatar } });
    if (!result || result.error) { alert('Upload failed.'); return; }
    state.currentUser.avatar = avatar;
    applyUserPill(state.currentUser);
    pages.settings('personalisation');
  };
  reader.readAsDataURL(file);
};

window.removeAvatar = async function() {
  const result = await api(`/users/${state.currentUser.id}/avatar`, { method: 'PATCH', body: { avatar: null } });
  if (!result || result.error) return;
  state.currentUser.avatar = null;
  applyUserPill(state.currentUser);
  pages.settings('personalisation');
};

window.updateRestoreWarning = function() {
  const mode    = document.getElementById('restoreMode')?.value;
  const warning = document.getElementById('restoreWarning');
  if (!warning) return;
  if (mode === 'replace') {
    warning.style.background = '#3a2e00';
    warning.style.color      = '#ffd666';
    warning.textContent      = 'All existing data will be permanently replaced. You will be logged out after restore.';
  } else {
    warning.style.background = '#3a0000';
    warning.style.color      = '#ff9999';
    warning.textContent      = 'Not recommended — merge may leave data in an inconsistent state if the backup conflicts with existing records.';
  }
};

window.doRestore = async function() {
  const fileInput = document.getElementById('backupFile');
  const mode      = document.getElementById('restoreMode').value;
  const statusEl  = document.getElementById('restoreStatus');
  const btn       = document.getElementById('restoreBtn');
  if (!fileInput?.files[0]) return;
  if (!confirm(`Restore from "${fileInput.files[0].name}"? This cannot be undone.`)) return;
  btn.disabled         = true;
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Restoring…';
  try {
    const backup = JSON.parse(await fileInput.files[0].text());
    const result = await api(`/backup/restore?mode=${mode}`, { method: 'POST', body: backup });
    if (!result || result.error) throw new Error(result?.error || 'Unknown error');
    statusEl.style.color = '#4caf50';
    statusEl.textContent = 'Restore complete!';
    if (mode === 'replace') {
      setTimeout(() => ctx.showLogin(), 1500);
    } else {
      setTimeout(() => pages.settings('system'), 1500);
    }
  } catch (err) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = `Error: ${err.message}`;
    btn.disabled         = false;
  }
};

function _clearDataModal({ title, body, buttonLabel, endpoint }) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal settings-clear-modal" role="dialog" aria-modal="true" aria-labelledby="settings-clear-title">
      <h3 id="settings-clear-title" class="settings-danger-title">${title}</h3>
      <p>${body}</p>
      <label class="ui-field settings-clear-field">
        <span>Type DELETE to confirm</span>
        <input type="text" id="clearConfirmInput" placeholder="DELETE" autocomplete="off">
      </label>
      <div class="modal-actions modal-actions-spaced ui-modal-footer">
        <button class="btn btn-ghost" id="clearNo">Cancel</button>
        <button class="btn btn-danger" id="clearYes">${buttonLabel}</button>
      </div>
    </div>`;
  const closeModal = mountModal(modal, '#clearConfirmInput');
  $('clearNo').addEventListener('click', closeModal);
  $('clearYes').addEventListener('click', async () => {
    if ($('clearConfirmInput').value.trim() !== 'DELETE') {
      $('clearConfirmInput').style.borderColor = '#ff4444';
      $('clearConfirmInput').focus();
      return;
    }
    closeModal();
    try {
      await api(endpoint, { method: 'POST' });
      invalidateAccounts();
      invalidateCategories();
      navigate('dashboard');
    } catch (error) {
      alert(error.message);
    }
  });
}

window.clearMyData = function() {
  _clearDataModal({
    title: 'Clear My Data?',
    body: 'This will permanently delete your transactions, income, bills, and accounts. Categories are kept.',
    buttonLabel: 'Clear My Data',
    endpoint: '/update/clear-my-data',
  });
};

window.clearAllData = function() {
  _clearDataModal({
    title: 'Clear All Data For Every User?',
    body: 'This will permanently delete all transactions, income, bills, and accounts for every user. Categories are kept.',
    buttonLabel: 'Clear All Data',
    endpoint: '/update/clear-data',
  });
};

function pollForRestart(statusEl, btnEl, btnLabel, onSuccess, phase1TimeoutMs = 15000, phase2TimeoutMs = 45000) {
  // Phase 1: wait for server to go DOWN (up to phase1TimeoutMs)
  // Phase 2: wait for server to come back UP (up to phase2TimeoutMs, measured from when it went down)
  let wentDown = false;
  let downAt   = null;
  const start  = Date.now();

  statusEl.innerHTML = `<p style="color:var(--muted);font-size:13px">Waiting for app to restart...</p>`;

  const poll = setInterval(async () => {
    if (!wentDown && Date.now() - start > phase1TimeoutMs) {
      // Server never went down — likely the update command failed before exit
      clearInterval(poll);
      statusEl.innerHTML = `<p style="color:var(--danger);font-size:13px">Server did not restart. Run <code>pct exec 104 -- pm2 logs fintrack --lines 20 --nostream</code> on your Proxmox shell to see the error.</p>`;
      btnEl.disabled = false;
      btnEl.textContent = btnLabel;
      return;
    }

    if (wentDown && Date.now() - downAt > phase2TimeoutMs) {
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
        downAt   = Date.now();
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
  try {
    await api('/update', { method: 'POST' });
  } catch (error) {
    status.innerHTML = `<p style="color:var(--danger);font-size:13px">${esc(error.message)}</p>`;
    btn.disabled = false;
    btn.textContent = 'Update Now';
    if ($('checkBtn')) $('checkBtn').disabled = false;
    return;
  }
  // Update runs `git pull && npm install` before the process exits, which can take
  // well over 15s on a slow host — give it a much longer phase-1 window than a bare restart.
  pollForRestart(status, btn, 'Update Now', () => {
    status.innerHTML = `<p style="color:var(--success);font-size:13px">Update complete! Reloading...</p>`;
    setTimeout(() => location.reload(), 2000);
  }, 90000);
};

window.triggerRestart = async function () {
  const btn    = $('restartBtn');
  const status = $('restartStatus');
  btn.disabled = true;
  btn.textContent = 'Restarting...';
  try {
    await api('/update/restart', { method: 'POST' });
  } catch (error) {
    status.innerHTML = `<p style="color:var(--danger);font-size:13px">${esc(error.message)}</p>`;
    btn.disabled = false;
    btn.textContent = 'Restart App';
    return;
  }
  pollForRestart(status, btn, 'Restart App', () => {
    status.innerHTML = `<p style="color:var(--success);font-size:13px">App restarted successfully.</p>`;
    btn.disabled = false;
    btn.textContent = 'Restart App';
  });
};

window.editCat = function(id) {
  const category = renderedCategories.find(item => item.id === id);
  if (!category) return;
  const { name, colour } = category;
  const row = document.getElementById(`cat-${id}`);
  row.innerHTML = `
    <label class="ui-field settings-category-edit-colour">
      <span>Colour</span>
      <input type="color" id="ec-colour" value="${esc(colour)}">
    </label>
    <label class="ui-field settings-category-edit-name">
      <span>Category name</span>
      <input type="text" id="ec-name" value="${esc(name)}">
    </label>
    <div class="ui-button-group settings-category-edit-actions">
      <button class="btn btn-primary btn-sm" onclick="saveCat(${id})">Save</button>
      <button class="btn btn-ghost btn-sm" onclick="pages.settings('categories')">Cancel</button>
    </div>
  `;
  row.classList.add('settings-category-item--editing');
  $('ec-name').focus();
};

window.deleteUser = async function(id) {
  const user = renderedUsers.find(item => item.id === id);
  if (!user || !confirm(`Delete ${user.display_name} and all their data? This cannot be undone.`)) return;
  try {
    await api(`/users/${id}`, { method: 'DELETE' });
    pages.settings('users');
  } catch (error) {
    alert(error.message);
  }
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
  try {
    await api(`/categories/${id}`, { method: 'DELETE' });
    invalidateCategories();
    pages.settings('categories');
  } catch (error) {
    if (error.status === 409) {
      alert('Cannot delete — transactions are using this category.');
      return;
    }
    alert(error.message);
  }
};
}
