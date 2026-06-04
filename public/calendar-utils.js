// Local time intentional: grid renders in user's local timezone, matching app.js monthly path.
function calGridBounds(fromStr, toStr) {
  const fromDate = new Date(fromStr + 'T00:00:00');
  const toDate   = new Date(toStr   + 'T00:00:00');
  const s = new Date(fromDate);
  s.setDate(fromDate.getDate() - fromDate.getDay());
  const e = new Date(toDate);
  e.setDate(toDate.getDate() + (6 - toDate.getDay()));
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { startSunday: fmt(s), endSaturday: fmt(e) };
}

if (typeof module !== 'undefined') module.exports = { calGridBounds };
