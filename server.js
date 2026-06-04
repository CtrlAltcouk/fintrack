const express     = require('express');
const path        = require('path');
const cookieParser = require('cookie-parser');
const requireAuth  = require('./middleware/auth');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Auth + user management — no requireAuth wrapper (handle their own auth)
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// All other routes require a valid session
app.use('/api/accounts',         requireAuth, require('./routes/accounts'));
app.use('/api/transfers',        requireAuth, require('./routes/transfers'));
app.use('/api/transactions',     requireAuth, require('./routes/transactions'));
app.use('/api/bills',            requireAuth, require('./routes/bills'));
app.use('/api/bill-months',      requireAuth, require('./routes/bills'));
app.use('/api/income/schedules', requireAuth, require('./routes/income-schedules').router);
app.use('/api/income',           requireAuth, require('./routes/income'));
app.use('/api/categories',       requireAuth, require('./routes/categories'));
app.use('/api/summary',          requireAuth, require('./routes/summary-range'));
app.use('/api/summary',          requireAuth, require('./routes/summary'));
app.use('/api/calendar',         requireAuth, require('./routes/calendar'));
app.use('/api/update',           requireAuth, require('./routes/update'));
app.use('/api/settings',         requireAuth, require('./routes/settings'));
app.use('/api/backup',           requireAuth, require('./routes/backup'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Outflow running on http://localhost:${PORT}`));
