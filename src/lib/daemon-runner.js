'use strict';

const fs = require('fs');
const {
  APP_NAME,
  VERSION
} = require('./defaults');
const {
  AlreadyRunningError
} = require('./errors');
const {
  inspectPidFile,
  writePidFile,
  removePidFile,
  acquireLock,
  releaseLock
} = require('./pidfile');
const { appendJsonLine } = require('./output');
const { killProcessTree } = require('./process');
const { runFollow } = require('./uia');

function appendEvent(logFile, event) {
  try {
    appendJsonLine(logFile, { ts: new Date().toISOString(), ...event });
  } catch {
    // Logging must never stop the watcher.
  }
}

async function runDaemonProcess(config, deps = {}) {
  const pidFile = config.pidFile;
  const logFile = config.logFile;
  const lockFile = config.lockFile;
  const options = config.options;
  const token = config.token;

  const acquire = deps.acquireLock || acquireLock;
  const inspect = deps.inspectPidFile || inspectPidFile;
  const writePid = deps.writePidFile || writePidFile;
  const removePid = deps.removePidFile || removePidFile;
  const release = deps.releaseLock || releaseLock;
  const follow = deps.runFollow || runFollow;
  const killTree = deps.killProcessTree || killProcessTree;

  const locked = acquire(lockFile);
  if (locked === false) {
    throw new AlreadyRunningError('另一个 chrome-auto-connect-win 守护进程正在启动或运行。', {
      lockFile
    });
  }

  let cleanedUp = false;
  let child = null;
  let stopping = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      const current = inspect(pidFile);
      if (current.record && current.record.token === token) {
        removePid(pidFile);
      }
    } catch {
      // Best effort.
    }
    if (config.configFile && config.deleteConfigFile) {
      try { fs.unlinkSync(config.configFile); } catch { /* ignore */ }
    }
    try { release(lockFile); } catch { /* ignore */ }
  };

  try {
    const existing = inspect(pidFile);
    if (existing.alive && existing.record && existing.record.pid !== process.pid) {
      throw new AlreadyRunningError(
        `chrome-auto-connect-win 守护进程已在运行 (PID ${existing.record.pid})。`,
        { pid: existing.record.pid, pidFile }
      );
    }
  } catch (error) {
    cleanup();
    throw error;
  }

  const record = {
    pid: process.pid,
    app: APP_NAME,
    version: VERSION,
    token,
    startedAt: new Date().toISOString(),
    mode: 'daemon',
    dryRun: Boolean(options.dryRun),
    logFile,
    configFile: config.configFile || null,
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
    processNames: options.processNames,
    buttonNames: options.buttonNames,
    titlePatterns: options.titlePatterns
  };

  try {
    writePid(pidFile, record);
  } catch (error) {
    cleanup();
    throw error;
  }

  appendEvent(logFile, {
    event: 'daemon_start',
    pid: process.pid,
    dryRun: Boolean(options.dryRun),
    intervalMs: options.intervalMs,
    processNames: options.processNames,
    buttonNames: options.buttonNames
  });

  process.once('exit', cleanup);

  const stop = async (reason) => {
    if (stopping) return;
    stopping = true;
    appendEvent(logFile, { event: 'daemon_stopping', pid: process.pid, reason });
    if (child) await killTree(child.pid);
  };

  const onSignal = (signal) => {
    stop(signal)
      .catch(() => {})
      .finally(() => {
        cleanup();
        process.exit(0);
      });
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  let result;
  try {
    result = await follow(options, {
      onEvent: (event) => appendEvent(logFile, { source: 'watcher', ...event }),
      onSpawn: (spawned) => {
        child = spawned;
        if (stopping) {
          killTree(spawned.pid).catch(() => {});
        }
      }
    });
  } catch (error) {
    appendEvent(logFile, {
      event: 'daemon_error',
      pid: process.pid,
      code: error && error.code,
      message: error && error.message,
      hint: error && error.hint
    });
    cleanup();
    return { exitCode: 3, error };
  }

  appendEvent(logFile, {
    event: 'daemon_exit',
    pid: process.pid,
    watcherExitCode: result.exitCode,
    stopped: Boolean(stopping)
  });
  cleanup();
  return {
    exitCode: result.exitCode,
    stopped: Boolean(stopping),
    watcher: result
  };
}

module.exports = {
  appendEvent,
  runDaemonProcess
};