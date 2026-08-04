const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const {
  parseIsoDate, parseOptionalPositiveInteger, parsePositiveInteger,
} = require('../finance-validation');

const FREQUENCIES = Object.freeze({
  daily:        { unit: 'day',   interval: 1 },
  weekly:       { unit: 'week',  interval: 1 },
  fortnightly:  { unit: 'week',  interval: 2 },
  four_weekly:  { unit: 'week',  interval: 4 },
  monthly:      { unit: 'month', interval: 1 },
  quarterly:    { unit: 'month', interval: 3 },
  yearly:       { unit: 'year',  interval: 1 },
});

function parseDate(value) {
  if (typeof value !== 'string') return null;
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, date };
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(value, amount) {
  const parsed = parseDate(value);
  if (!parsed) throw new Error('invalid date');
  parsed.date.setUTCDate(parsed.date.getUTCDate() + amount);
  return formatDate(parsed.date.getUTCFullYear(), parsed.date.getUTCMonth() + 1, parsed.date.getUTCDate());
}

function dateInTimeZone(date, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function currentDateForSeries(series, now = new Date()) {
  return dateInTimeZone(now, series?.time_zone ?? 'UTC');
}

function frequencyConfig(frequency) {
  return FREQUENCIES[frequency] ?? null;
}

function frequencyName(unit, interval) {
  return Object.entries(FREQUENCIES)
    .find(([, config]) => config.unit === unit && config.interval === Number(interval))?.[0] ?? null;
}

function occurrenceAt(series, sequence) {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('sequence must be a positive integer');
  const start = parseDate(series.start_date);
  if (!start) throw new Error('series start_date is invalid');
  const interval = Number(series.frequency_interval);
  if (!Number.isInteger(interval) || interval < 1) throw new Error('frequency_interval is invalid');
  const offset = sequence - 1;

  if (series.frequency_unit === 'day') return addDays(series.start_date, interval * offset);
  if (series.frequency_unit === 'week') return addDays(series.start_date, 7 * interval * offset);

  if (series.frequency_unit === 'month') {
    const monthIndex = (start.year * 12 + start.month - 1) + interval * offset;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const anchorDay = Number(series.anchor_day || start.day);
    return formatDate(year, month, Math.min(anchorDay, daysInMonth(year, month)));
  }

  if (series.frequency_unit === 'year') {
    const year = start.year + interval * offset;
    const month = Number(series.anchor_month || start.month);
    const anchorDay = Number(series.anchor_day || start.day);
    return formatDate(year, month, Math.min(anchorDay, daysInMonth(year, month)));
  }

  throw new Error('frequency_unit is invalid');
}

function approximateSequence(series, value) {
  const start = parseDate(series.start_date);
  const target = parseDate(value);
  if (!start || !target || value <= series.start_date) return 1;
  const interval = Number(series.frequency_interval);

  if (series.frequency_unit === 'day' || series.frequency_unit === 'week') {
    const days = Math.floor((target.date - start.date) / 86400000);
    const step = interval * (series.frequency_unit === 'week' ? 7 : 1);
    return Math.max(1, Math.floor(days / step) + 1);
  }

  const months = (target.year - start.year) * 12 + target.month - start.month;
  const step = series.frequency_unit === 'year' ? interval * 12 : interval;
  return Math.max(1, Math.floor(months / step) + 1);
}

function isWithinEnd(series, date, sequence) {
  if (series.end_mode === 'count' && sequence > Number(series.max_occurrences)) return false;
  if (series.end_mode === 'date' && date > series.end_date) return false;
  return true;
}

function occurrencesBetween(series, from, to, { limit = 1000 } = {}) {
  if (!parseDate(from) || !parseDate(to) || from > to) throw new Error('invalid occurrence range');
  let sequence = approximateSequence(series, from);
  let date = occurrenceAt(series, sequence);
  while (date < from) {
    sequence += 1;
    date = occurrenceAt(series, sequence);
  }

  const occurrences = [];
  while (date <= to && isWithinEnd(series, date, sequence)) {
    occurrences.push({ date, sequence });
    if (occurrences.length > limit) throw new Error('occurrence range exceeds limit');
    sequence += 1;
    date = occurrenceAt(series, sequence);
  }
  return occurrences;
}

function nextOccurrence(series, afterDate) {
  if (!parseDate(afterDate)) throw new Error('invalid date');
  let sequence = approximateSequence(series, afterDate);
  let date = occurrenceAt(series, sequence);
  while (date < afterDate) {
    sequence += 1;
    date = occurrenceAt(series, sequence);
  }
  return isWithinEnd(series, date, sequence) ? { date, sequence } : null;
}

function validateRecurrence(input, { dueDay, defaultStartDate, defaultTimeZone = 'UTC' } = {}) {
  const source = input ?? {};
  const frequency = source.frequency ?? 'monthly';
  const config = frequencyConfig(frequency);
  if (!config) return { error: 'frequency must be daily, weekly, fortnightly, four_weekly, monthly, quarterly, or yearly' };

  const startDate = source.start_date ?? defaultStartDate;
  const parsedStart = parseDate(startDate);
  if (!parsedStart) return { error: 'start_date must be a valid date (YYYY-MM-DD)' };

  const endMode = source.end_mode ?? 'never';
  if (!['never', 'date', 'count'].includes(endMode)) return { error: 'end_mode must be never, date, or count' };
  let endDate = null;
  let maxOccurrences = null;
  if (endMode === 'date') {
    if (!parseDate(source.end_date)) return { error: 'end_date must be a valid date' };
    endDate = source.end_date;
  }
  if (endMode === 'count') {
    try { maxOccurrences = parseOptionalPositiveInteger(source.max_occurrences, 'max_occurrences'); }
    catch {
      return { error: 'max_occurrences must be an integer between 1 and 10000' };
    }
  }

  let anchorDay;
  try { anchorDay = parsePositiveInteger(source.anchor_day ?? dueDay ?? parsedStart.day, 'anchor_day', 31); }
  catch {
    return { error: 'anchor_day must be an integer between 1 and 31' };
  }
  let anchorMonth = null;
  if (config.unit === 'year') {
    try { anchorMonth = parsePositiveInteger(source.anchor_month ?? parsedStart.month, 'anchor_month', 12); }
    catch { return { error: 'anchor_month must be an integer between 1 and 12' }; }
  }

  let normalizedStartDate = startDate;
  if (config.unit === 'month') {
    normalizedStartDate = formatDate(
      parsedStart.year, parsedStart.month,
      Math.min(anchorDay, daysInMonth(parsedStart.year, parsedStart.month))
    );
  } else if (config.unit === 'year') {
    normalizedStartDate = formatDate(
      parsedStart.year, anchorMonth,
      Math.min(anchorDay, daysInMonth(parsedStart.year, anchorMonth))
    );
  }
  if (endMode === 'date' && endDate < normalizedStartDate) {
    return { error: 'end_date must be on or after the first occurrence' };
  }

  const timeZone = String(source.time_zone ?? defaultTimeZone);
  try { new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date()); }
  catch { return { error: 'time_zone must be a valid IANA timezone' }; }

  return {
    value: {
      frequency,
      frequency_unit: config.unit,
      frequency_interval: config.interval,
      start_date: normalizedStartDate,
      anchor_day: anchorDay,
      anchor_month: anchorMonth,
      time_zone: timeZone,
      end_mode: endMode,
      end_date: endDate,
      max_occurrences: maxOccurrences,
    },
  };
}

module.exports = {
  FREQUENCIES,
  addDays,
  currentDateForSeries,
  dateInTimeZone,
  daysInMonth,
  frequencyConfig,
  frequencyName,
  isWithinEnd,
  nextOccurrence,
  occurrenceAt,
  occurrencesBetween,
  parseDate,
  validateRecurrence,
};
