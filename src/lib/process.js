'use strict';

const { execFile: nodeExecFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(nodeExecFile);

function killProcessTree(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(false);
  if (process.platform !== 'win32') {
    try {
      process.kill(pid);
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  const run = options.execFile || execFileAsync;
  return run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  })
    .then(() => true)
    .catch(() => {
      try {
        process.kill(pid);
        return true;
      } catch {
        return false;
      }
    });
}

module.exports = {
  killProcessTree
};