function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function daysBetween(from, to) {
  const fromDate = new Date(from + 'T00:00:00Z');
  const toDate = new Date(to + 'T00:00:00Z');
  return Math.round((toDate - fromDate) / 86400000);
}

// Returns array of {from, to, label} periods, newest first.
// todayOverride: optional YYYY-MM-DD string for testing (omit in production).
function computePeriods(schedule, count, todayOverride) {
  count = (count != null) ? count : 6;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const todayStr  = todayOverride || new Date().toISOString().split('T')[0];
  const todayDate = new Date(todayStr + 'T00:00:00Z');

  function fmtDate(ds) {
    const d = new Date(ds + 'T00:00:00Z');
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
  function mkLabel(from, to) { return `${fmtDate(from)} – ${fmtDate(to)}`; }

  const periods = [];

  if (schedule.frequency === 'monthly') {
    const dom = schedule.day_of_month;
    let sy = todayDate.getUTCFullYear(), sm = todayDate.getUTCMonth();
    const daysInCurrentMonth = new Date(Date.UTC(sy, sm + 1, 0)).getUTCDate();
    if (todayDate.getUTCDate() < Math.min(dom, daysInCurrentMonth)) {
      sm -= 1;
      if (sm < 0) { sm = 11; sy -= 1; }
    }
    for (let i = 0; i < count; i++) {
      let py = sy, pm = sm - i;
      while (pm < 0) { pm += 12; py -= 1; }
      const daysInPm  = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
      const startDay  = Math.min(dom, daysInPm);
      const from      = `${py}-${String(pm + 1).padStart(2,'0')}-${String(startDay).padStart(2,'0')}`;
      let ey = py, em = pm + 1;
      if (em > 11) { em -= 12; ey += 1; }
      const daysInEm = new Date(Date.UTC(ey, em + 1, 0)).getUTCDate();
      const endDay   = Math.min(dom, daysInEm) - 1;
      let to;
      if (endDay < 1) {
        const last = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
        to = `${py}-${String(pm + 1).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
      } else {
        to = `${ey}-${String(em + 1).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`;
      }
      periods.push({ from, to, label: mkLabel(from, to) });
    }
  } else if (['weekly', 'fortnightly', 'four_weekly'].includes(schedule.frequency)) {
    const intervalDays = {
      weekly: 7,
      fortnightly: 14,
      four_weekly: 28,
    }[schedule.frequency];
    const anchorDate = new Date(schedule.anchor_date + 'T00:00:00Z');
    if (Number.isNaN(anchorDate.getTime())) return [];
    // The anchor identifies one boundary in an indefinitely repeating cycle.
    // Math.floor also steps backwards correctly when the anchor is in the future.
    const cycle = Math.floor(daysBetween(schedule.anchor_date, todayStr) / intervalDays);
    const cur = addDays(schedule.anchor_date, cycle * intervalDays);
    for (let i = 0; i < count; i++) {
      const from = addDays(cur, -intervalDays * i);
      const to   = addDays(from, intervalDays - 1);
      periods.push({ from, to, label: mkLabel(from, to) });
    }
  }

  return periods;
}

if (typeof module !== 'undefined') module.exports = { computePeriods };
