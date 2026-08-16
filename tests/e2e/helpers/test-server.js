const fs = require('fs');
const os = require('os');
const path = require('path');
const dbModulePath = require.resolve('../../../db');

function waitForListening(server) {
  if (server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };

    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

module.exports = async function setupTestServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-e2e-'));
  const previousDbPath = process.env.FINTRACK_DB_PATH;
  const previousPort = process.env.PORT;
  const previousTestProcess = process.env.OUTFLOW_TEST_PROCESS;
  const restoreEnvironment = () => {
    if (previousDbPath === undefined) delete process.env.FINTRACK_DB_PATH;
    else process.env.FINTRACK_DB_PATH = previousDbPath;

    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;

    if (previousTestProcess === undefined) delete process.env.OUTFLOW_TEST_PROCESS;
    else process.env.OUTFLOW_TEST_PROCESS = previousTestProcess;
  };

  process.env.FINTRACK_DB_PATH = path.join(tempDir, 'fintrack-e2e.db');
  process.env.OUTFLOW_TEST_PROCESS = '1';
  process.env.PORT = '3100';

  let server;
  let db;
  let recurrenceRunner;
  try {
    ({ recurrenceRunner, server } = require('../../../server'));
    db = require('../../../db');
    await waitForListening(server);
  } catch (error) {
    db ??= require.cache[dbModulePath]?.exports;
    try {
      if (recurrenceRunner) await recurrenceRunner.stop();
      if (server?.listening) await closeServer(server);
    } finally {
      try {
        if (db?.open) db.close();
      } finally {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } finally {
          restoreEnvironment();
        }
      }
    }
    throw error;
  }

  return async function teardownTestServer() {
    try {
      await recurrenceRunner.stop();
      await closeServer(server);
    } finally {
      try {
        if (db.open) db.close();
      } finally {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } finally {
          restoreEnvironment();
        }
      }
    }
  };
};
