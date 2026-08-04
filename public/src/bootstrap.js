import { $, main } from './utils/dom.js';
import { fmt, monthName, esc, ordinal, clampDueDay, toDateInput, formatDate } from './utils/format.js';
import { createApi } from './core/api.js';
import { createTheme, DARK_DEFAULTS, LIGHT_DEFAULTS, ACCENT_PRESETS, BG_DARK_PRESETS, BG_LIGHT_PRESETS } from './core/theme.js';
import { createRenderHelpers } from './shared/rendering.js';
import { mountModal } from './shared/modal.js';
import { createChart, destroyChart } from './shared/chart.js';
import { createUserHelpers } from './shared/user.js';
import { createFormHelpers } from './shared/forms.js';
import { installNavigation } from './navigation/index.js';
import { installDashboard } from './dashboard/index.js';
import { installAccounts } from './accounts/index.js';
import { installSpending } from './spending/index.js';
import { installBills } from './bills/index.js';
import { installIncome } from './income/index.js';
import { installTransfers } from './transfers/index.js';
import { installReports } from './reports/index.js';
import { installSettings } from './settings/index.js';
import { installAuth } from './core/auth.js';

const pages = {};
window.pages = pages;
const state = {
  currentUser: null,
  currentTheme: { ...DARK_DEFAULTS },
};
const ctx = {
  $, main, fmt, monthName, esc, ordinal, clampDueDay, toDateInput, formatDate,
  pages, state, mountModal, DARK_DEFAULTS, LIGHT_DEFAULTS, ACCENT_PRESETS,
  BG_DARK_PRESETS, BG_LIGHT_PRESETS, computePeriods: window.computePeriods,
  calGridBounds: window.calGridBounds, Chart: window.Chart, createChart,
  destroyChart,
};

Object.assign(ctx, createRenderHelpers({ esc, fmt }));
Object.assign(ctx, createUserHelpers(esc));
Object.assign(ctx, createFormHelpers());
Object.assign(ctx, createApi(() => ctx.showLogin?.()));
Object.assign(ctx, createTheme({ state, api: (...args) => ctx.api(...args) }));
Object.assign(ctx, installNavigation(ctx));
window.navigate = ctx.navigate;
ctx.resetDashboard = installDashboard(ctx).reset;
installAccounts(ctx);
installSpending(ctx);
installBills(ctx);
installIncome(ctx);
installTransfers(ctx);
installReports(ctx);
installSettings(ctx);
Object.assign(ctx, installAuth(ctx));
window.showLogin = ctx.showLogin;
ctx.init();
