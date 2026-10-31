'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  isProcessAlive,
  readPidFile,
  inspectPidFile,
  writePidFile,
  removePidFile,
  acquireLock,
  releaseLock
} = require('../src/lib/pidfile');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-win-pid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('isProcessAlive handles current and invalid pids', () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(-1), false);
  assert.equal(isProcessAlive(99999999), false);
});

test('pid file round-trips JSON and plain integer formats', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'daemon.json');
  writePidFile(file, { pid: process.pid, app: 'chrome-auto-connect-win', token: 'abc' });
  const record = readPidFile(file);
  assert.equal(record.pid, process.pid);
  assert.equal(record.token, 'abc');
  assert.equal(inspectPidFile(file).alive, true);

  fs.writeFileSync(file, '1234\n', 'utf8');
  assert.deepEqual(readPidFile(file), { pid: 1234 });

  fs.writeFileSync(file, 'not-a-pid', 'utf8');
  assert.equal(readPidFile(file), null);
  assert.equal(inspectPidFile(file).stale, false);
});

test('inspectPidFile detects missing, alive and stale records', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'daemon.json');
  assert.deepEqual(inspectPidFile(file), {
    exists: false,
    record: null,
    alive: false,
    stale: false
  });

  writePidFile(file, { pid: 4321 });
  assert.equal(inspectPidFile(file, { isAlive: () => true }).alive, true);
  const stale = inspectPidFile(file, { isAlive: () => false });
  assert.equal(stale.alive, false);
  assert.equal(stale.stale, true);
});

test('removePidFile is idempotent', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'daemon.json');
  assert.equal(removePidFile(file), false);
  writePidFile(file, { pid: process.pid });
  assert.equal(removePidFile(file), true);
  assert.equal(removePidFile(file), false);
});

test('lock prevents concurrent holders but ignores stale locks', (t) => {
  const dir = tempDir(t);
  const lock = path.join(dir, 'daemon.lock');

  assert.equal(acquireLock(lock, { isAlive: () => true }), true);
  assert.equal(acquireLock(lock, { isAlive: () => true }), false);
  releaseLock(lock);
  assert.equal(acquireLock(lock, { isAlive: () => true }), true);
  releaseLock(lock);

  fs.writeFileSync(lock, JSON.stringify({ pid: 999999, at: Date.now() }), 'utf8');
  assert.equal(acquireLock(lock, { isAlive: () => false }), true);
  releaseLock(lock);
});