export const DARK_DEFAULTS = { mode: 'dark', accent: '#f7a4a2', bg: '#111111' };
export const LIGHT_DEFAULTS = { mode: 'light', accent: '#c45c5a', bg: '#f0e8f0' };
export const ACCENT_PRESETS = ['#f7a4a2','#4a9eff','#a8d8a8','#ffd700','#c39bd3','#ff8c42','#76d7c4'];
export const BG_DARK_PRESETS = ['#111111','#1a1a2e','#0d1117','#1a0a2e','#0a1a0a','#1a0a0a'];
export const BG_LIGHT_PRESETS = ['#f0e8f0','#f5f5f5','#f8f6f2','#e8f0e8','#f0e8e8','#e8e8f0'];

const DARK_VARS = { '--card': '#1a1a1a', '--border': '#2a2a2a', '--text': '#ffffff', '--muted': '#888888' };
const LIGHT_VARS = { '--card': '#ffffff', '--border': '#d9c8d9', '--text': '#111111', '--muted': '#666666' };

export function createTheme({ state, api }) {
  function applyTheme(theme) {
    const vars = theme.mode === 'light' ? LIGHT_VARS : DARK_VARS;
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value);
    }
    document.documentElement.style.setProperty('--accent', theme.accent);
    document.documentElement.style.setProperty('--bg', theme.bg);
    state.currentTheme = { ...theme };
  }

  async function loadTheme() {
    const theme = await api('/settings/theme').catch(() => ({ ...DARK_DEFAULTS }));
    if (theme) applyTheme(theme);
  }

  return { applyTheme, loadTheme };
}
