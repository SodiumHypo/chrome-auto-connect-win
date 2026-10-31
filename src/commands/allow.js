'use strict';

const fs = require('fs');
const path = require('path');
const {
  getAllowConfigFile,
  getAllowLockFile,
  getAllowLogFile
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
const { runOnceCommand } = require('./once');

const ASYNC_SCRIPT = path.join(__dirname, '..', 'async-watcher.js');

async function startAsyncAllow(options, deps = {}) {
  const stateDir = options.stateDir;
  fs.mkdirSync(stateDir, { recursive: true });

  const existing = inspectPidFile(options.allowPidFile);
  if (existing.alive && existing.record) {
    throw new AlreadyRunningError(
      `一次性监听已在运行 (PID ${existing.record.pid})。`,
      { pid: existing.record.pid, pidFile: options.allowPidFile }
    );
  }
  if (existing.exists) {
    removePidFile(options.allowPidFile);
  }

  const token = newToken();
  const configFile = getAllowConfigFile(stateDir);
  const logFile = getAllowLogFile(stateDir);
  const lockFile = getAllowLockFile(stateDir);
  const config = {
    token,
    pidFile: options.allowPidFile,
    logFile,
    lockFile,
    configFile,
    deleteConfigFile: true,
    options: serializeOptions(options)
  };

  try {
    writePidFile(configFile, config);
  } catch (error) {
    throw new CacError(`Unable to write async watcher config: ${error.message}`, {
      code: 'allow_config_failed'
    });
  }

  try {
    spawnDetachedNode(ASYNC_SCRIPT, 'CAC_WIN_ALLOW_CONFIG', configFile, deps);
  } catch (error) {
    safeUnlink(configFile);
    throw error;
  }

  const started = await waitForPidRecord(options.allowPidFile, token, {
    timeoutMs: deps.startTimeoutMs || 8000,
    intervalMs: deps.startPollMs || 100,
    isAlive: deps.isProcessAlive,
    logTail: () => readLastJsonLine(logFile)
  });

  if (!started.ok) {
    safeUnlink(configFile);
    if (started.reason === 'already_running') {
      throw new AlreadyRunningError(
        `一次性监听已在运行 (PID ${started.record.pid})。`,
        { pid: started.record.pid, pidFile: options.allowPidFile }
      );
    }
    throw new CacError(`后台监听启动失败 (${started.reason})。`, {
      code: 'allow_start_failed',
      hint: `请检查日志文件: ${logFile}`
    });
  }

  return {
    exitCode: 0,
    result: {
      ok: true,
      async: true,
      message: '已启动后台监听；检测到「允许」按钮时会自动点击。',
      dryRun: Boolean(options.dryRun),
      pid: started.record.pid,
      pidFile: options.allowPidFile,
      logFile,
      timeoutMs: options.timeoutMs
    }
  };
}

async function runAllowCommand(options, deps = {}) {
  if (options.sync) {
    return runOnceCommand(options, deps);
  }
  return startAsyncAllow(options, deps);
}

module.exports = {
  ASYNC_SCRIPT,
  runAllowCommand,
  startAsyncAllow
};