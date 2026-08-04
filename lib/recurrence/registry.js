const adapters = new Map();
const CAPABILITIES = Object.freeze({
  PROJECTION_ONLY: 'projection-only',
  AUTOMATIC_EXECUTION: 'automatic-execution',
});

function registerRecurrenceAdapter(kind, adapter) {
  if (!kind || !adapter || typeof adapter.materializeRange !== 'function') {
    throw new Error('A recurrence adapter requires a kind and materializeRange function');
  }
  const capability = adapter.capability ?? CAPABILITIES.PROJECTION_ONLY;
  if (!Object.values(CAPABILITIES).includes(capability)) {
    throw new Error(`Unsupported recurrence adapter capability: ${capability}`);
  }
  if (capability === CAPABILITIES.AUTOMATIC_EXECUTION
      && typeof adapter.executeOccurrence !== 'function') {
    throw new Error('An automatic recurrence adapter requires executeOccurrence');
  }
  adapter.capability = capability;
  adapters.set(kind, adapter);
  return adapter;
}

function getRecurrenceAdapter(kind) {
  const adapter = adapters.get(kind);
  if (!adapter) throw new Error(`Unsupported recurring kind: ${kind}`);
  return adapter;
}

function automaticExecutionKinds() {
  return [...adapters.entries()]
    .filter(([, adapter]) => adapter.capability === CAPABILITIES.AUTOMATIC_EXECUTION)
    .map(([kind]) => kind)
    .sort();
}

function automaticSchedulingKinds() {
  return [...adapters.entries()]
    .filter(([, adapter]) => adapter.capability === CAPABILITIES.AUTOMATIC_EXECUTION
      && adapter.scheduleOccurrences === true)
    .map(([kind]) => kind)
    .sort();
}

function unregisterRecurrenceAdapter(kind) {
  adapters.delete(kind);
}

module.exports = {
  CAPABILITIES,
  automaticExecutionKinds,
  automaticSchedulingKinds,
  getRecurrenceAdapter,
  registerRecurrenceAdapter,
  unregisterRecurrenceAdapter,
};
