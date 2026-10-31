'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {
  parseTasklistCsv,
  imageNameForProcessName,
  listProcesses,
  parseDevToolsActivePort,
  readDevToolsActivePort,
  isPortListening,
  inspectEndpoint,
  findExecutable,
  checkPowerShell
} = require('../src/lib/chrome');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-win-chrome-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('parses tasklist CSV and ignores informational lines', () => {
  const csv = [
    '"chrome.exe","1234","Console","1","100,000 K"',
    '"chrome.exe","5678","Console","1","90,000 K"',
    'INFO: No tasks are running which match the specified criteria.'
  ].join('\r\n');
  assert.deepEqual(parseTasklistCsv(csv), [
    { name: 'chrome.exe', pid: 1234 },
    { name: 'chrome.exe', pid: 5678 }
  ]);
});

test('normalizes process names to image names', () => {
  assert.equal(imageNameForProcessName('chrome'), 'chrome.exe');
  assert.equal(imageNameForProcessName('chrome-beta'), 'chrome-beta.exe');
  assert.equal(imageNameForProcessName('CHROME.EXE'), 'CHROME.EXE');
  assert.equal(imageNameForProcessName('C:\\Program Files\\Google\\Chrome\\chrome.exe'), 'chrome.exe');
});

test('listProcesses deduplicates PIDs and builds tasklist filters', async () => {
  const calls = [];
  const execFile = async (file, args) => {
    calls.push({ file, args });
    if (args[1] === 'IMAGENAME eq chrome.exe') {
      return { stdout: '"chrome.exe","10","Console","1","1 K"\r\n"chrome.exe","11","Console","1","1 K"\r\n' };
    }
    return { stdout: '"chrome.exe","11","Console","1","1 K"\r\n' };
  };

  const processes = await listProcesses(['chrome', 'chrome.exe'], { execFile });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.args[1]), [
    'IMAGENAME eq chrome.exe',
    'IMAGENAME eq chrome.exe'
  ]);
  assert.deepEqual(processes.map((item) => item.pid), [10, 11]);
});

test('parses DevToolsActivePort and rejects malformed files', () => {
  const parsed = parseDevToolsActivePort('9222\n/devtools/browser/abc-123\n');
  assert.equal(parsed.port, 9222);
  assert.equal(parsed.wsEndpoint, 'ws://127.0.0.1:9222/devtools/browser/abc-123');

  assert.throws(() => parseDevToolsActivePort('9222'), /Invalid DevToolsActivePort/);
  assert.throws(() => parseDevToolsActivePort('not-a-port\n/devtools/browser/x'), /Invalid port/);
  assert.throws(() => parseDevToolsActivePort('9222\nnot-a-path'), /Invalid WebSocket path/);
});

test('readDevToolsActivePort reports a missing file', (t) => {
  const dir = tempDir(t);
  const result = readDevToolsActivePort(path.join(dir, 'DevToolsActivePort'));
  assert.equal(result.exists, false);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'missing');
});

test('isPortListening detects open and closed local ports', async (t) => {
  const server = net.createServer();
  const port = await listen(server);
  t.after(() => close(server));
  assert.equal(await isPortListening(port, { timeoutMs: 500 }), true);
  await close(server);
  assert.equal(await isPortListening(port, { timeoutMs: 500 }), false);
});

test('inspectEndpoint reports stale when the port is closed', async (t) => {
  const dir = tempDir(t);
  const server = net.createServer();
  const port = await listen(server);
  await close(server);

  const portFile = path.join(dir, 'DevToolsActivePort');
  fs.writeFileSync(portFile, `${port}\n/devtools/browser/test\n`, 'utf8');
  const result = await inspectEndpoint({ portFile, timeoutMs: 300 });
  assert.equal(result.exists, true);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'stale');
  assert.equal(result.listening, false);
});

test('findExecutable and checkPowerShell use where.exe', async () => {
  const execFile = async (file, args) => {
    assert.equal(file, 'where.exe');
    if (args[0] === 'powershell.exe') {
      return { stdout: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n' };
    }
    const error = new Error('not found');
    error.code = 'ENOENT';
    throw error;
  };

  assert.equal(
    await findExecutable('powershell.exe', { execFile }),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  );
  assert.equal(await findExecutable('missing.exe', { execFile }), null);

  const ps = await checkPowerShell(undefined, { execFile });
  assert.equal(ps.available, true);
  assert.equal(ps.flavor, 'windows-powershell');

  const explicit = await checkPowerShell('powershell.exe', { execFile });
  assert.equal(explicit.explicit, true);
});