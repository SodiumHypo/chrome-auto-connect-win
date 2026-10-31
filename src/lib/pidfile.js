'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'EPERM') return true;
    return false;
  }
}

function readPidFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  const text = raw.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed && Number.isInteger(parsed.pid) && parsed.pid > 0) {
      return parsed;
    }
  } catch {
    // Fall back to the plain "1234" format used by some tools.
  }

  if (/^\d+$/.test(text)) {
    const pid = Number(text);
    if (pid > 0) return { pid };
  }
  return null;
}

function inspectPidFile(file, options = {}) {
  const isAlive = options.isAlive || isProcessAlive;
  const record = readPidFile(file);
  if (!record) {
    return { exists: fs.existsSync(file), record: null, alive: false, stale: false };
  }
  const alive = isAlive(record.pid);
  return { exists: true, record, alive, stale: !alive };
}

function writePidFile(file, record) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    // Windows can refuse to replace an existing file in a few edge cases.
    try {
      fs.unlinkSync(file);
    } catch {
      // Ignore: rename will report the useful error below.
    }
    try {
      fs.renameSync(temp, file);
    } catch (renameError) {
      try { fs.unlinkSync(temp); } catch { /* ignore */ }
      throw renameError;
    }
  }
}

function removePidFile(file) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function acquireLock(lockFile, options = {}) {
  const staleMs = options.staleMs === undefined ? 15000 : options.staleMs;
  const isAlive = options.isAlive || isProcessAlive;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      return true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      let holder = null;
      try {
        holder = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      } catch {
        holder = null;
      }
      const age = Date.now() - (holder && Number(holder.at) || fs.statSync(lockFile).mtimeMs);
      const holderAlive = holder && isAlive(holder.pid);
      if (holderAlive && age < staleMs) return false;
      try {
        fs.unlinkSync(lockFile);
      } catch {
        // Another process may have removed it first.
      }
    }
  }
  return false;
}

function releaseLock(lockFile) {
  try {
    fs.unlinkSync(lockFile);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  isProcessAlive,
  readPidFile,
  inspectPidFile,
  writePidFile,
  removePidFile,
  acquireLock,
  releaseLock
};