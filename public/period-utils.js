function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
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
    if (todayDate.getUTCDate() < dom) {
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
  } else if (schedule.frequency === 'four_weekly') {
    let cur  = schedule.anchor_date;
    if (cur > todayStr) return [];   // anchor in the future — no periods
    let next = addDays(cur, 28);
    while (next <= todayStr) { cur = next; next = addDays(next, 28); }
    for (let i = 0; i < count; i++) {
      const from = addDays(cur, -28 * i);
      const to   = addDays(from, 27);
      periods.push({ from, to, label: mkLabel(from, to) });
    }
  } else if (schedule.frequency === 'weekly') {
    const anchorDow   = new Date(schedule.anchor_date + 'T00:00:00Z').getUTCDay();
    const todayDow    = todayDate.getUTCDay();
    const daysBack    = (todayDow - anchorDow + 7) % 7;
    const curStart    = addDays(todayStr, -daysBack);
    for (let i = 0; i < count; i++) {
      const from = addDays(curStart, -7 * i);
      const to   = addDays(from, 6);
      periods.push({ from, to, label: mkLabel(from, to) });
    }
  }

  return periods;
}

if (typeof module !== 'undefined') module.exports = { computePeriods };
