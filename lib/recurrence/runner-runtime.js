let runner = null;

function setRecurrenceRunner(value) {
  runner = value;
}

function getRecurrenceRunner() {
  return runner;
}

module.exports = { getRecurrenceRunner, setRecurrenceRunner };
