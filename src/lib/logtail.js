'use strict';

const fs = require('fs');

const DEFAULT_MAX_BYTES = 64 * 1024;

function readLastJsonLine(file, options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  let fd;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return null;
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, length, stat.size - length);
    const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch {
        // The first line may be truncated when reading a tail window.
      }
    }
    return null;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  readLastJsonLine
};