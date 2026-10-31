'use strict';

const fs = require('fs');
const path = require('path');
const {
  getDaemonConfigFile,
  getDaemonLockFile
} = require('../lib/defaults');
const {
  AlreadyRunningError,
  CacError
} = require('../lib/errors');
const {
  inspectPidFile,
  writePidFile,
  removePidFile
} = require('../lib/pidfile');
const { readLastJsonLine } = require('../lib/logtail');
const {
  newToken,
  serializeOptions,
  spawnDetachedNode,
  safeUnlink,
  waitForPidRecord
} = require('../lib/spawn-helper');
const { runDaemonProcess } = require('../lib/daemon-runner');
const { runConnect } = require('./connect');

const DAEMON_SCRIPT = path.join(__dirname, '..', 'daemon.js');

function logTailReader(logFile) {
  return () => readLastJsonLine(logFile);
}

async function runForeground(options, deps = {}) {
  const token = newToken();
  const stateDir = options.stateDir;
  fs.mkdirSync(stateDir, { recursive: true });

  const config = {
    token,
    pidFile: options.pidFile,
    logFile: options.logFile,
    lockFile: getDaemonLockFile(stateDir),
    configFile: null,
    deleteConfigFile: false,
    options: serializeOptions(options)
  };

  const runner = deps.runDaemonProcess || runDaemonProcess;
  const stream = options.json ? process.stderr : process.stdout;
  stream.write(`守护进程前台运行中 (PID ${process.pid})，按 Ctrl+C 停止。\n`);
  stream.write(`日志文件: ${options.logFile}\n`);

  const result = await runner(config, deps.runnerDeps || {});
  if (result.error) throw result.error;

  return {
    exitCode: result.exitCode,
    result: {
      ok: result.exitCode === 0,
      daemon: {
        pid: process.pid,
        pidFile: options.pidFile,
        logFile: options.logFile
      },
      foreground: true,
      dryRun: Boolean(options.dryRun),
      connect: null
    }
  };
}

async function runStartCommand(options, deps = {}) {
  if (options.foreground) {
    return runForeground(options, deps);
  }

  const stateDir = options.stateDir;
  fs.mkdirSync(stateDir, { recursive: true });

  const existing = inspectPidFile(options.pidFile);
  if (existing.alive && existing.record) {
    throw new AlreadyRunningError(
      `chrome-auto-connect-win 守护进程已在运行 (PID ${existing.record.pid})。`,
      { pid: existing.record.pid, pidFile: options.pidFile }
    );
  }
  if (existing.exists) {
    removePidFile(options.pidFile);
  }

  const token = newToken();
  const configFile = getDaemonConfigFile(stateDir);
  const lockFile = getDaemonLockFile(stateDir);
  const config = {
    token,
    pidFile: options.pidFile,
    logFile: options.logFile,
    lockFile,
    configFile,
    deleteConfigFile: true,
    options: serializeOptions(options)
  };

  try {
    writePidFile(configFile, config);
  } catch (error) {
    throw new CacError(`Unable to write daemon config: ${error.message}`, {
      code: 'daemon_config_failed'
    });
  }

  try {
    spawnDetachedNode(DAEMON_SCRIPT, 'CAC_WIN_DAEMON_CONFIG', configFile, deps);
  } catch (error) {
    safeUnlink(configFile);
    throw error;
  }

  const started = await waitForPidRecord(options.pidFile, token, {
    timeoutMs: deps.startTimeoutMs || 8000,
    intervalMs: deps.startPollMs || 100,
    isAlive: deps.isProcessAlive,
    logTail: logTailReader(options.logFile)
  });

  if (!started.ok) {
    safeUnlink(configFile);
    if (started.reason === 'already_running') {
      throw new AlreadyRunningError(
        `chrome-auto-connect-win 守护进程已在运行 (PID ${started.record.pid})。`,
        { pid: started.record.pid, pidFile: options.pidFile }
      );
    }
    const detail = started.logTail
      ? ` 最近日志: ${JSON.stringify(started.logTail)}`
      : '';
    throw new CacError(`守护进程启动失败 (${started.reason})。${detail}`, {
      code: 'daemon_start_failed',
      hint: `请检查日志文件: ${options.logFile}`
    });
  }

  const result = {
    ok: true,
    daemon: {
      pid: started.record.pid,
      pidFile: options.pidFile,
      logFile: options.logFile,
      configFile
    },
    foreground: false,
    dryRun: Boolean(options.dryRun),
    connect: null
  };

  // Match the macOS command: "start" connects through chrome-devtools by
  // default. --no-connect keeps the watcher only.
  if (!options.noConnect) {
    try {
      const connect = await runConnect({ ...options, noPageCheck: true }, deps.connectDeps || {});
      result.connect = connect.result;
    } catch (error) {
      result.connect = {
        ok: false,
        stage: 'connect',
        error: error.message,
        hint: error.hint
      };
    }
  }

  return { exitCode: 0, result };
}

module.exports = {
  DAEMON_SCRIPT,
  runForeground,
  runStartCommand
};