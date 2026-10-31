#!/usr/bin/env node
'use strict';

const fs = require('fs');
const {
  inspectPidFile,
  writePidFile,
  removePidFile,
  acquireLock,
  releaseLock
} = require('./lib/pidfile');
const { appendJsonLine } = require('./lib/output');
const { AlreadyRunningError } = require('./lib/errors');
const { APP_NAME, VERSION } = require('./lib/defaults');
const { runOnce } = require('./lib/uia');

function appendEvent(logFile, event) {
  try {
    appendJsonLine(logFile, { ts: new Date().toISOString(), ...event });
  } catch {
    // Logging must never affect the click result.
  }
}

function fail(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code || 3);
}

async function main() {
  const configFile = process.env.CAC_WIN_ALLOW_CONFIG;
  if (!configFile) {
    fail('CAC_WIN_ALLOW_CONFIG is not set.', 3);
    return;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    fail(`Unable to read async watcher config: ${error.message}`, 3);
    return;
  }

  const { token, pidFile, logFile, lockFile, options } = config;
  if (!token || !pidFile || !logFile || !lockFile || !options) {
    fail('Async watcher config is missing required fields.', 3);
    return;
  }

  process.title = 'chrome-auto-connect-win allow watcher';

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      const current = inspectPidFile(pidFile);
      if (current.record && current.record.token === token) {
        removePidFile(pidFile);
      }
    } catch {
      // Best effort.
    }
    if (config.configFile && config.deleteConfigFile) {
      try { fs.unlinkSync(config.configFile); } catch { /* ignore */ }
    }
    try { releaseLock(lockFile); } catch { /* ignore */ }
  };

  try {
    if (acquireLock(lockFile) === false) {
      throw new AlreadyRunningError('另一个一次性监听进程正在运行。', { lockFile });
    }
    const existing = inspectPidFile(pidFile);
    if (existing.alive && existing.record && existing.record.pid !== process.pid) {
      throw new AlreadyRunningError(`一次性监听已在运行 (PID ${existing.record.pid})。`, {
        pid: existing.record.pid,
        pidFile
      });
    }
    writePidFile(pidFile, {
      pid: process.pid,
      app: APP_NAME,
      version: VERSION,
      token,
      startedAt: new Date().toISOString(),
      mode: 'once',
      dryRun: Boolean(options.dryRun),
      logFile
    });
  } catch (error) {
    cleanup();
    throw error;
  }

  process.once('exit', cleanup);
  const onSignal = (signal) => {
    appendEvent(logFile, { event: 'async_stopping', pid: process.pid, reason: signal });
    cleanup();
    process.exit(0);
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  appendEvent(logFile, {
    event: 'async_start',
    pid: process.pid,
    dryRun: Boolean(options.dryRun),
    timeoutMs: options.timeoutMs
  });

  const result = await runOnce(options, {
    onEvent: (event) => appendEvent(logFile, { source: 'watcher', ...event })
  });
  appendEvent(logFile, {
    event: 'async_result',
    pid: process.pid,
    ...result
  });
  cleanup();
  process.exitCode = result.exitCode;
}

main().catch((error) => {
  process.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : 3;
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
});