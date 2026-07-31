export function installAuth(ctx) {
  const {
    api, invalidateCategories, invalidateAccounts, pages, esc, state,
    applyTheme, loadTheme, DARK_DEFAULTS, LIGHT_DEFAULTS, avatarCircle,
    applyUserPill, navigate, closeMoreSheet,
  } = ctx;
async function init() {
  const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!me) { showLogin(); return; }
  state.currentUser = me;
  const pill = document.getElementById('user-pill');
  applyUserPill(me);
  pill.style.display = 'flex';
  pill.onclick = logout;
  document.getElementById('sheet-user-pill').style.display = 'flex';
  await loadTheme();
  navigate('dashboard');
}

async function logout() {
  closeMoreSheet();
  await fetch('/api/auth/logout', { method: 'POST' });
  invalidateAccounts();
  invalidateCategories();
  ctx.resetDashboard();
  state.currentUser = null;
  applyTheme({ ...DARK_DEFAULTS });
  document.getElementById('user-pill').style.display = 'none';
  document.getElementById('sheet-user-pill').style.display = 'none';
  showLogin();
}

async function showLogin() {
  invalidateAccounts();
  invalidateCategories();
  const overlay = document.getElementById('login-overlay');
  overlay.style.display = 'flex';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Sign in to Outflow');
  let users;
  try {
    const response = await fetch('/api/users/picker');
    if (!response.ok) throw new Error('picker unavailable');
    users = await response.json();
    if (!Array.isArray(users)) throw new Error('invalid picker response');
  } catch (_) {
    overlay.innerHTML = `
      <div class="login-box">
        <p class="ui-status-message" role="alert">Unable to load Outflow users. Please try again.</p>
        <button type="button" id="retryLogin" class="btn btn-primary">Try Again</button>
      </div>`;
    document.getElementById('retryLogin').addEventListener('click', showLogin);
    document.getElementById('retryLogin').focus();
    return;
  }

  if (users.length === 0) {
    overlay.innerHTML = `
      <div class="login-box">
        <div class="login-logo" style="display:flex;align-items:center;gap:10px">
          <svg width="36" height="36" viewBox="72 112 116 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs><clipPath id="oc-l"><circle cx="130" cy="170" r="58"/></clipPath></defs>
            <circle cx="130" cy="170" r="58" fill="#f8a4a2"/>
            <g clip-path="url(#oc-l)">
              <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168 L 188 228 L 72 228 Z" fill="white" opacity="0.35"/>
              <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M 72 205 Q 95 188 115 200 Q 135 214 158 196 Q 172 184 188 190" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
            </g>
          </svg>
          <div>
            <div style="font-size:20px;font-weight:600;color:#faf9f5;letter-spacing:-0.3px">Outflow</div>
            <div style="font-size:12px;color:var(--muted)">personal finance tracker</div>
          </div>
        </div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;text-align:center">Create your admin account to get started.</p>
        <form id="firstRunForm">
          <input type="text" id="frName" placeholder="Your name" required autocomplete="off" style="width:100%;margin-bottom:10px">
          <input type="password" id="frPass" placeholder="Password" required style="width:100%;margin-bottom:12px">
          <div style="margin-bottom:14px">
            <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Avatar colour</div>
            <div class="colour-picker-row" id="frColours">
              ${['#4a9eff','#f7a4a2','#a8d8a8','#ffd700','#c39bd3','#ff8c42','#76d7c4'].map((c,i) =>
                `<button type="button" class="colour-opt${i===0?' selected':''}" data-colour="${c}" style="background:${c}"
                  aria-label="Use colour ${c}" aria-pressed="${i === 0}"></button>`
              ).join('')}
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%">Create Account</button>
        </form>
      </div>`;
    document.getElementById('firstRunForm').addEventListener('submit', async e => {
      e.preventDefault();
      const name   = document.getElementById('frName').value.trim();
      const pass   = document.getElementById('frPass').value;
      const colour = document.querySelector('.colour-opt.selected')?.dataset.colour ?? '#4a9eff';
      let response;
      let result;
      try {
        response = await fetch('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ display_name: name, password: pass, colour }) });
        result = await response.json();
      } catch (_) {
        result = { error: 'Unable to create the account. Please try again.' };
      }
      if (!response?.ok || result.error) { alert(result.error || 'Unable to create the account.'); return; }
      await doLogin(name, pass);
    });
    document.querySelectorAll('#frColours .colour-opt').forEach(button => {
      button.addEventListener('click', () => window.pickColour(button));
    });
    document.getElementById('frName').focus();
  } else {
    overlay.innerHTML = `
      <div class="login-box">
        <div class="login-logo" style="display:flex;align-items:center;gap:10px">
          <svg width="36" height="36" viewBox="72 112 116 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs><clipPath id="oc-l2"><circle cx="130" cy="170" r="58"/></clipPath></defs>
            <circle cx="130" cy="170" r="58" fill="#f8a4a2"/>
            <g clip-path="url(#oc-l2)">
              <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168 L 188 228 L 72 228 Z" fill="white" opacity="0.35"/>
              <path d="M 72 185 Q 95 160 115 180 Q 135 200 158 172 Q 175 150 188 168" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M 72 205 Q 95 188 115 200 Q 135 214 158 196 Q 172 184 188 190" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
            </g>
          </svg>
          <div>
            <div style="font-size:20px;font-weight:600;color:#faf9f5;letter-spacing:-0.3px">Outflow</div>
            <div style="font-size:12px;color:var(--muted)">personal finance tracker</div>
          </div>
        </div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;text-align:center">Who's using Outflow?</p>
        <div class="user-picker-grid" id="pickerGrid">
          ${users.map(u => `
            <button type="button" class="user-picker-item" data-id="${u.id}" aria-label="Sign in as ${esc(u.display_name)}">
              ${avatarCircle(u, 48)}
              <div class="user-picker-name">${esc(u.display_name)}</div>
            </button>`).join('')}
        </div>
        <form id="pwPrompt" style="display:none;margin-top:16px;width:100%">
          <p id="pwPromptLabel" style="text-align:center;font-size:13px;color:var(--muted);margin-bottom:10px"></p>
          <input type="password" id="pwInput" placeholder="Password" style="width:100%;margin-bottom:10px" autocomplete="current-password">
          <div id="loginError" class="ui-status-message" role="alert" style="display:none;margin-bottom:10px"></div>
          <button type="submit" class="btn btn-primary" style="width:100%;margin-bottom:6px">Enter</button>
          <button type="button" id="loginBack" class="btn btn-ghost" style="width:100%">← Back</button>
        </form>
      </div>`;
    document.querySelectorAll('#pickerGrid .user-picker-item').forEach(button => {
      button.addEventListener('click', () => {
        const user = users.find(candidate => candidate.id === Number(button.dataset.id));
        if (user) window.selectUser(user.id, user.display_name);
      });
    });
    document.getElementById('pwPrompt').addEventListener('submit', async event => {
      event.preventDefault();
      await window.submitPw();
    });
    document.getElementById('loginBack').addEventListener('click', showLogin);
    document.querySelector('#pickerGrid .user-picker-item')?.focus();
  }
}

let _loginUserId = null, _loginUserName = null;

window.selectUser = function(id, name) {
  _loginUserId   = id;
  _loginUserName = name;
  document.getElementById('pickerGrid').style.display   = 'none';
  document.getElementById('pwPrompt').style.display      = 'block';
  document.getElementById('pwPromptLabel').textContent   = `Enter password for ${name}`;
  document.getElementById('pwInput').value = '';
  document.getElementById('pwInput').focus();
};

window.submitPw = async function() {
  await doLogin(_loginUserName, document.getElementById('pwInput').value);
};

window.pickColour = function(el) {
  document.querySelectorAll('.colour-opt').forEach(e => {
    e.classList.remove('selected');
    e.setAttribute('aria-pressed', 'false');
  });
  el.classList.add('selected');
  el.setAttribute('aria-pressed', 'true');
};

window.setMode = async function(mode) {
  const defaults = mode === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
  applyTheme({ ...defaults });
  await api('/settings/theme', { method: 'POST', body: { ...defaults } });
  pages.settings('personalisation');
};

window.pickAccent = async function(colour) {
  applyTheme({ ...state.currentTheme, accent: colour });
  const customInput = document.getElementById('accentCustom');
  if (customInput) customInput.value = colour;
  const swatches = document.querySelectorAll('#accentSwatches .swatch:not(.swatch-custom)');
  await api('/settings/theme', { method: 'POST', body: { accent: colour } });
  swatches.forEach(el => {
    const selected = el.dataset.colour === colour.toLowerCase();
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', String(selected));
  });
};

window.pickBg = async function(colour) {
  applyTheme({ ...state.currentTheme, bg: colour });
  const customInput = document.getElementById('bgCustom');
  if (customInput) customInput.value = colour;
  const swatches = document.querySelectorAll('#bgSwatches .swatch:not(.swatch-custom)');
  await api('/settings/theme', { method: 'POST', body: { bg: colour } });
  swatches.forEach(el => {
    const selected = el.dataset.colour === colour.toLowerCase();
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', String(selected));
  });
};

window.resetTheme = async function() {
  applyTheme({ ...DARK_DEFAULTS });
  await api('/settings/theme', { method: 'POST', body: { ...DARK_DEFAULTS } });
  pages.settings('personalisation');
};

window.setDashModeSettings = async function(mode) {
  await api('/settings/pay-period', { method: 'POST', body: { mode } });
  pages.settings('personalisation');
};

window.setPrimarySchedule = async function(id) {
  await api('/settings/pay-period', { method: 'POST', body: { primary_schedule_id: id ? Number(id) : null } });
};

async function doLogin(display_name, password) {
  let response;
  let r;
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name, password }),
    });
    r = await response.json();
  } catch (_) {
    r = { error: 'Unable to contact Outflow. Please try again.' };
  }
  if (!response?.ok || r.error) {
    const error = document.getElementById('loginError');
    if (error) {
      error.textContent = response?.status === 401 ? 'Incorrect password.' : (r.error || 'Sign in failed.');
      error.style.display = 'block';
    } else {
      alert(r.error || 'Sign in failed.');
    }
    return false;
  }
  state.currentUser = r;
  document.getElementById('login-overlay').style.display = 'none';
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = r.colour;
  document.getElementById('user-pill-avatar').textContent = r.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = r.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  const sheetPill = document.getElementById('sheet-user-pill');
  document.getElementById('sheet-pill-avatar').style.background = r.colour;
  document.getElementById('sheet-pill-avatar').textContent = r.display_name[0].toUpperCase();
  document.getElementById('sheet-pill-name').textContent = r.display_name;
  sheetPill.style.display = 'flex';
  await loadTheme();
  navigate('dashboard');
  return true;
}

  return { init, logout, showLogin };
}
