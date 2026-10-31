'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const {
  validateWsEndpoint,
  spawnCommand,
  connectAndList
} = require('../src/lib/devtools');

const ENDPOINT = 'ws://127.0.0.1:9222/devtools/browser/abc-123';

function makeSpawn(outputs) {
  const calls = [];
  let index = 0;
  const spawnImpl = (command, args, options) => {
    const spec = outputs[index] || {};
    index += 1;
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.pid = 100000 + index;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const delay = spec.delayMs || 0;
    const emit = () => {
      if (spec.error) {
        child.emit('error', spec.error);
        return;
      }
      if (spec.stdout) child.stdout.write(spec.stdout);
      if (spec.stderr) child.stderr.write(spec.stderr);
      child.stdout.end();
      child.stderr.end();
      child.emit('close', spec.code === undefined ? 0 : spec.code, spec.signal || null);
    };
    if (delay > 0) setTimeout(emit, delay);
    else setImmediate(emit);
    return child;
  };
  return { spawnImpl, calls };
}

test('validateWsEndpoint accepts local browser endpoints only', () => {
  assert.equal(validateWsEndpoint(ENDPOINT), ENDPOINT);
  assert.throws(() => validateWsEndpoint('ws://127.0.0.1:9222/devtools/page/abc'), /Refusing/);
  assert.throws(() => validateWsEndpoint('http://127.0.0.1:9222/devtools/browser/abc'), /Refusing/);
  assert.throws(() => validateWsEndpoint('ws://192.168.1.2:9222/devtools/browser/abc'), /Refusing/);
  assert.throws(() => validateWsEndpoint('ws://127.0.0.1:0/devtools/browser/abc'), /Invalid port/);
  assert.throws(() => validateWsEndpoint(''), /Refusing/);
});

test('spawnCommand captures stdout/stderr and exit code', async () => {
  const { spawnImpl, calls } = makeSpawn([{ stdout: 'pages\n', stderr: '', code: 0 }]);
  const result = await spawnCommand('chrome-devtools', ['list_pages'], {
    spawnImpl,
    capture: true,
    timeoutMs: 0
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'pages\n');
  assert.equal(result.timedOut, false);
  assert.deepEqual(calls[0].args, ['list_pages']);
  assert.equal(calls[0].options.shell, true);
});

test('spawnCommand reports spawn errors', async () => {
  const { spawnImpl } = makeSpawn([{ error: new Error('not installed') }]);
  await assert.rejects(
    spawnCommand('missing-command', ['x'], { spawnImpl, capture: true, timeoutMs: 0 }),
    /Unable to run missing-command/
  );
});

test('spawnCommand reports timeouts', async () => {
  const { spawnImpl } = makeSpawn([{ code: 1, delayMs: 120 }]);
  const result = await spawnCommand('chrome-devtools', ['start'], {
    spawnImpl,
    capture: true,
    timeoutMs: 20
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, 1);
});

test('connectAndList runs start then list_pages', async () => {
  const { spawnImpl, calls } = makeSpawn([
    { stdout: 'started\n' },
    { stdout: 'page-1\npage-2\n' }
  ]);
  const result = await connectAndList(ENDPOINT, {
    command: 'chrome-devtools',
    spawnImpl,
    capture: true,
    timeoutMs: 0
  });
  assert.equal(result.ok, true);
  assert.equal(result.stage, 'done');
  assert.equal(result.listPages.stdout, 'page-1\npage-2\n');
  assert.deepEqual(calls.map((call) => call.args), [
    ['start', '--wsEndpoint', ENDPOINT],
    ['list_pages']
  ]);
});

test('connectAndList stops when start fails', async () => {
  const { spawnImpl, calls } = makeSpawn([
    { stderr: 'connection refused\n', code: 1 }
  ]);
  const result = await connectAndList(ENDPOINT, {
    command: 'chrome-devtools',
    spawnImpl,
    capture: true,
    timeoutMs: 0
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'start');
  assert.equal(result.start.code, 1);
  assert.equal(calls.length, 1);
});