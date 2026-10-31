'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseArgs } = require('../src/lib/args');
const { APP_NAME } = require('../src/lib/defaults');
const { runStopCommand } = require('../src/commands/stop');

const missing = { exists: false, record: null, alive: false, stale: false };

function optionsFor(extra = []) {
  return parseArgs(['stop', '--state-dir', path.join(process.cwd(), '.stop-test'), ...extra]).options;
}

function stateByFile(states) {
  return (file) => states[file] || missing;
}

test('stop kills daemon and once watchers then removes pid/lock files', async () => {
  const options = optionsFor();
  const removed = [];
  const killed = [];
  const states = {
    [options.pidFile]: {
      exists: true,
      alive: true,
      stale: false,
      record: { pid: 111, app: APP_NAME, mode: 'daemon', token: 'a' }
    },
    [options.allowPidFile]: {
      exists: true,
      alive: true,
      stale: false,
      record: { pid: 222, app: APP_NAME, mode: 'once', token: 'b' }
    }
  };

  const { exitCode, result } = await runStopCommand(options, {
    inspectPidFile: stateByFile(states),
    killProcessTree: async (pid) => { killed.push(pid); return true; },
    isProcessAlive: () => false,
    removePidFile: (file) => { removed.push(file); return true; }
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(killed, [111, 222]);
  assert.deepEqual(result.stopped.map((item) => item.pid), [111, 222]);
  assert.ok(removed.includes(options.pidFile));
  assert.ok(removed.includes(options.allowPidFile));
  assert.ok(removed.some((file) => file.endsWith('daemon.lock')));
  assert.ok(removed.some((file) => file.endsWith('allow.lock')));
});

test('stop is idempotent and cleans stale pid files', async () => {
  const options = optionsFor();
  const removed = [];
  const states = {
    [options.pidFile]: { exists: true, alive: false, stale: true, record: { pid: 333 } }
  };

  const { exitCode, result } = await runStopCommand(options, {
    inspectPidFile: stateByFile(states),
    killProcessTree: async () => { throw new Error('must not kill stale pids'); },
    removePidFile: (file) => { removed.push(file); return true; }
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(result.stale, [options.pidFile]);
  assert.deepEqual(result.stopped, []);
  assert.ok(removed.includes(options.pidFile));
});

test('stop --dry-run reports without killing or removing', async () => {
  const options = optionsFor(['--dry-run']);
  const states = {
    [options.pidFile]: {
      exists: true,
      alive: true,
      stale: false,
      record: { pid: 111, app: APP_NAME, mode: 'daemon' }
    },
    [options.allowPidFile]: { exists: true, alive: false, stale: true, record: { pid: 333 } }
  };
  let killed = 0;
  let removed = 0;

  const { exitCode, result } = await runStopCommand(options, {
    inspectPidFile: stateByFile(states),
    killProcessTree: async () => { killed += 1; return true; },
    removePidFile: () => { removed += 1; return true; }
  });

  assert.equal(exitCode, 0);
  assert.equal(killed, 0);
  assert.equal(removed, 0);
  assert.equal(result.wouldStop.length, 1);
  assert.deepEqual(result.stale, [options.allowPidFile]);
});

test('stop refuses to kill unrelated PID files', async () => {
  const options = optionsFor();
  const states = {
    [options.pidFile]: {
      exists: true,
      alive: true,
      stale: false,
      record: { pid: 444 }
    }
  };
  let killed = 0;

  const { exitCode, result } = await runStopCommand(options, {
    inspectPidFile: stateByFile(states),
    killProcessTree: async () => { killed += 1; return true; },
    removePidFile: () => true
  });

  assert.equal(exitCode, 0);
  assert.equal(killed, 0);
  assert.equal(result.ignored.length, 1);
  assert.equal(result.ignored[0].pid, 444);
});

test('stop exits 1 when taskkill fails', async () => {
  const options = optionsFor();
  const states = {
    [options.pidFile]: {
      exists: true,
      alive: true,
      stale: false,
      record: { pid: 555, app: APP_NAME, mode: 'daemon' }
    }
  };

  const { exitCode, result } = await runStopCommand(options, {
    inspectPidFile: stateByFile(states),
    killProcessTree: async () => false,
    removePidFile: () => true
  });

  assert.equal(exitCode, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /taskkill/);
});