const MONEY_MAX_ABS = 1_000_000_000_000;
const RECURRENCE_INTEGER_MAX = 10_000;
const DECIMAL_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

class FinanceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FinanceValidationError';
    this.status = 400;
  }
}

function fail(message) {
  throw new FinanceValidationError(message);
}

function strictNumber(value, field) {
  let number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string' && DECIMAL_RE.test(value)) {
    number = Number(value);
  } else {
    fail(`${field} must be a valid number`);
  }
  if (!Number.isFinite(number)) fail(`${field} must be a finite number`);
  return Object.is(number, -0) ? 0 : number;
}

function parseMoney(value, field = 'amount') {
  const number = strictNumber(value, field);
  if (Math.abs(number) > MONEY_MAX_ABS) {
    fail(`${field} must be between -${MONEY_MAX_ABS} and ${MONEY_MAX_ABS}`);
  }
  return number;
}

function parsePositiveMoney(value, field = 'amount') {
  const number = parseMoney(value, field);
  if (number <= 0) fail(`${field} must be greater than zero`);
  return number;
}

function parseNonNegativeMoney(value, field = 'amount') {
  const number = parseMoney(value, field);
  if (number < 0) fail(`${field} must be zero or greater`);
  return number;
}

function parseInteger(value, field, { min, max } = {}) {
  const number = strictNumber(value, field);
  if (!Number.isSafeInteger(number)) fail(`${field} must be a safe integer`);
  if (min !== undefined && number < min) fail(`${field} must be at least ${min}`);
  if (max !== undefined && number > max) fail(`${field} must be at most ${max}`);
  return number;
}

function parseIntegerId(value, field = 'id') {
  return parseInteger(value, field, { min: 1, max: Number.MAX_SAFE_INTEGER });
}

function parseOptionalIntegerId(value, field = 'id') {
  return value === undefined || value === null ? null : parseIntegerId(value, field);
}

function parsePositiveInteger(value, field = 'value', max = RECURRENCE_INTEGER_MAX) {
  return parseInteger(value, field, { min: 1, max });
}

function parseOptionalPositiveInteger(value, field = 'value', max = RECURRENCE_INTEGER_MAX) {
  return value === undefined || value === null ? null : parsePositiveInteger(value, field, max);
}

function parseIsoDate(value, field = 'date') {
  if (typeof value !== 'string') fail(`${field} must be a valid date (YYYY-MM-DD)`);
  const match = ISO_DATE_RE.exec(value);
  if (!match) fail(`${field} must be a valid date (YYYY-MM-DD)`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail(`${field} must be a valid date (YYYY-MM-DD)`);
  }
  return value;
}

function parseOptionalIsoDate(value, field = 'date') {
  return value === undefined || value === null ? null : parseIsoDate(value, field);
}

function validateDateRange(startDate, endDate, startField = 'start_date', endField = 'end_date') {
  const start = parseIsoDate(startDate, startField);
  const end = parseIsoDate(endDate, endField);
  if (end < start) fail(`${endField} must be on or after ${startField}`);
  return { start, end };
}

function validationMessage(error) {
  return error instanceof FinanceValidationError ? error.message : null;
}

module.exports = {
  FinanceValidationError,
  MONEY_MAX_ABS,
  RECURRENCE_INTEGER_MAX,
  parseIntegerId,
  parseIsoDate,
  parseMoney,
  parseNonNegativeMoney,
  parseOptionalIntegerId,
  parseOptionalIsoDate,
  parseOptionalPositiveInteger,
  parsePositiveInteger,
  parsePositiveMoney,
  validateDateRange,
  validationMessage,
};
