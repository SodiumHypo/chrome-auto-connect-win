'use strict';

const {
  APP_NAME,
  getDaemonLockFile,
  getAllowLockFile
} = require('../lib/defaults');
const {
  inspectPidFile,
  isProcessAlive,
  removePidFile
} = require('../lib/pidfile');
const { killProcessTree } = require('../lib/process');

function isOurRecord(record) {
  if (!record) return false;
  return record.app === APP_NAME
    || record.mode === 'daemon'
    || record.mode === 'once'
    || typeof record.token === 'string';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(pid, deps, timeoutMs) {
  const alive = deps.isProcessAlive || isProcessAlive;
  const wait = deps.sleep || sleep;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await wait(50);
  }
  return !alive(pid);
}

async function runStopCommand(options, deps = {}) {
  const inspect = deps.inspectPidFile || inspectPidFile;
  const kill = deps.killProcessTree || killProcessTree;
  const remove = deps.removePidFile || removePidFile;

  const targets = [
    {
      kind: 'daemon',
      pidFile: options.pidFile,
      lockFile: getDaemonLockFile(options.stateDir)
    },
    {
      kind: 'once',
      pidFile: options.allowPidFile,
      lockFile: getAllowLockFile(options.stateDir)
    }
  ];

  const result = {
    stopped: [],
    wouldStop: [],
    stale: [],
    ignored: [],
    failed: []
  };

  for (const target of targets) {
    const state = inspect(target.pidFile);
    if (state.alive && state.record) {
      if (!isOurRecord(state.record)) {
        result.ignored.push({
          kind: target.kind,
          pid: state.record.pid,
          pidFile: target.pidFile,
          reason: 'PID file does not look like a chrome-auto-connect-win process'
        });
        continue;
      }

      if (options.dryRun) {
        result.wouldStop.push({
          kind: target.kind,
          pid: state.record.pid,
          pidFile: target.pidFile
        });
        continue;
      }

      const killed = await kill(state.record.pid);
      const exited = killed && await waitForExit(state.record.pid, deps, 5000);
      if (!exited) {
        result.failed.push({
          kind: target.kind,
          pid: state.record.pid,
          pidFile: target.pidFile,
          reason: killed ? 'process did not exit within 5s' : 'taskkill failed'
        });
        continue;
      }

      try { remove(target.pidFile); } catch { /* ignore */ }
      try { remove(target.lockFile); } catch { /* ignore */ }
      result.stopped.push({
        kind: target.kind,
        pid: state.record.pid,
        pidFile: target.pidFile
      });
      continue;
    }

    if (state.exists) {
      result.stale.push(target.pidFile);
      if (!options.dryRun) {
        try { remove(target.pidFile); } catch { /* ignore */ }
        try { remove(target.lockFile); } catch { /* ignore */ }
      }
    }
  }

  const exitCode = result.failed.length > 0 ? 1 : 0;
  return { exitCode, result };
}

module.exports = {
  isOurRecord,
  runStopCommand,
  waitForExit
};