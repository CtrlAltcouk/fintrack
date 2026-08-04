let shutdownHandler = null;

function setShutdownHandler(handler) {
  if (handler !== null && typeof handler !== 'function') {
    throw new TypeError('shutdown handler must be a function or null');
  }
  shutdownHandler = handler;
}

function requestShutdown(reason = 'requested', exitCode = 0) {
  if (shutdownHandler) return shutdownHandler(reason, { exitCode });
  process.exit(exitCode);
}

module.exports = { requestShutdown, setShutdownHandler };
