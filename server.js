const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/accounts',          require('./routes/accounts'));
app.use('/api/transfers',         require('./routes/transfers'));
app.use('/api/transactions',      require('./routes/transactions'));
app.use('/api/bills',             require('./routes/bills'));
app.use('/api/bill-months',       require('./routes/bills'));
app.use('/api/income/schedules',  require('./routes/income-schedules').router);
app.use('/api/income',            require('./routes/income'));
app.use('/api/categories',        require('./routes/categories'));
app.use('/api/summary',           require('./routes/summary'));
app.use('/api/calendar',          require('./routes/calendar'));
app.use('/api/update',            require('./routes/update'));
app.use('/api/settings',          require('./routes/settings'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FinTrack running on http://localhost:${PORT}`));
