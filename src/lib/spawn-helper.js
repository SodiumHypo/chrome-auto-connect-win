'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn: nodeSpawn } = require('child_process');
const { CacError } = require('./errors');
const { inspectPidFile, isProcessAlive } = require('./pidfile');

function newToken() {
  return crypto.randomBytes(12).toString('hex');
}

function serializeOptions(options) {
  return {
    buttonNames: options.buttonNames,
    titlePatterns: options.titlePatterns,
    processNames: options.processNames,
    dryRun: Boolean(options.dryRun),
    timeoutMs: options.timeoutMs,
    intervalMs: options.intervalMs,
    clickCooldownMs: options.clickCooldownMs,
    maxClicksPerDialog: options.maxClicksPerDialog,
    logLevel: options.logLevel,
    psPath: options.psPath || null,
    psScript: options.psScript ? path.resolve(options.psScript) : null,
    userDataDir: options.userDataDir || null,
    portFile: options.portFile || null
  };
}

function spawnDetachedNode(scriptPath, envName, configFile, deps = {}) {
  const spawnImpl = deps.spawn || nodeSpawn;
  try {
    const child = spawnImpl(process.execPath, [scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, [envName]: configFile }
    });
    // A detached child still emits 'error' asynchronously; without a listener
    // Node would treat ENOENT as an uncaught exception in the parent.
    child.on('error', () => {});
    child.unref();
    return child;
  } catch (error) {
    throw new CacError(`Unable to start background process: ${error.message}`, {
      code: 'spawn_failed'
    });
  }
}

function safeUnlink(file) {
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

function waitForPidRecord(pidFile, token, options = {}) {
  const timeoutMs = options.timeoutMs === undefined ? 8000 : options.timeoutMs;
  const intervalMs = options.intervalMs === undefined ? 100 : options.intervalMs;
  const isAlive = options.isAlive || isProcessAlive;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const poll = () => {
      let state;
      try {
        state = inspectPidFile(pidFile, { isAlive });
      } catch (error) {
        resolve({ ok: false, reason: 'inspect_failed', error });
        return;
      }

      if (state.record && state.record.token === token) {
        if (state.alive) {
          resolve({ ok: true, record: state.record });
          return;
        }
        resolve({
          ok: false,
          reason: 'exited',
          record: state.record,
          logTail: options.logTail ? options.logTail() : null
        });
        return;
      }

      if (state.alive && state.record) {
        resolve({ ok: false, reason: 'already_running', record: state.record });
        return;
      }

      if (Date.now() >= deadline) {
        resolve({
          ok: false,
          reason: 'timeout',
          record: state.record || null,
          logTail: options.logTail ? options.logTail() : null
        });
        return;
      }

      setTimeout(poll, intervalMs);
    };

    poll();
  });
}

module.exports = {
  newToken,
  serializeOptions,
  spawnDetachedNode,
  safeUnlink,
  waitForPidRecord
};