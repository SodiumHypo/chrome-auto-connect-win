'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { isProcessAlive } = require('../src/lib/pidfile');

const BIN = path.join(__dirname, '..', 'bin', 'chrome-auto-connect-win.js');
const MOCK_PS = path.join(__dirname, 'fixtures', 'mock-watcher.ps1');

function runCli(args, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out: ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function makeStateDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-win-cli-'));
  t.after(async () => {
    await runCli(['stop', '--state-dir', dir], { timeoutMs: 15000 }).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

function commonArgs(stateDir) {
  return ['--state-dir', stateDir, '--ps-script', MOCK_PS];
}

test('help and version do not require Chrome', async () => {
  const help = await runCli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /用法:/);
  assert.match(help.stdout, /chrome-auto-connect-win start/);

  const version = await runCli(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /^chrome-auto-connect-win \d+\.\d+\.\d+/);

  const unknown = await runCli(['not-a-command']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Unknown command/);
});

test('daemon lifecycle: start, duplicate start, status, stop', {
  timeout: 120000
}, async (t) => {
  const stateDir = makeStateDir(t);
  const args = commonArgs(stateDir);

  const started = await runCli(['start', '--no-connect', ...args]);
  assert.equal(started.code, 0, started.stderr);
  assert.match(started.stdout, /守护进程已启动/);

  const pidFile = path.join(stateDir, 'daemon.json');
  const record = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(record.mode, 'daemon');
  assert.equal(isProcessAlive(record.pid), true);

  const duplicate = await runCli(['start', '--no-connect', ...args]);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr, /已在运行/);

  const status = await runCli([
    'status',
    '--no-page-check',
    '--port-file', path.join(stateDir, 'missing-DevToolsActivePort'),
    ...args
  ]);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /守护进程: 运行中/);
  assert.match(status.stdout, /UI Automation: 检测到确认弹窗/);

  const stopped = await runCli(['stop', '--state-dir', stateDir]);
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.match(stopped.stdout, /已停止/);
  assert.equal(fs.existsSync(pidFile), false);

  const stoppedAgain = await runCli(['stop', '--state-dir', stateDir]);
  assert.equal(stoppedAgain.code, 0);
  assert.match(stoppedAgain.stdout, /未发现运行中/);
});

test('once reports clicked, dry-run, no_chrome, timeout and permission errors', {
  timeout: 120000
}, async (t) => {
  const stateDir = makeStateDir(t);
  const args = commonArgs(stateDir);

  const clicked = await runCli(['once', ...args], { env: { CAC_WIN_MOCK_SCENARIO: 'clicked' } });
  assert.equal(clicked.code, 0, clicked.stderr);
  assert.match(clicked.stdout, /成功点击「允许」按钮/);
  assert.match(clicked.stdout, /要允许远程调试吗？/);

  const dry = await runCli(['once', '--dry-run', ...args], {
    env: { CAC_WIN_MOCK_SCENARIO: 'would_click' }
  });
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /dry-run/);

  const noChrome = await runCli(['once', ...args], {
    env: { CAC_WIN_MOCK_SCENARIO: 'no_chrome' }
  });
  assert.equal(noChrome.code, 2);
  assert.match(noChrome.stdout, /Chrome 未运行/);

  const timeout = await runCli(['once', ...args], {
    env: { CAC_WIN_MOCK_SCENARIO: 'timeout' }
  });
  assert.equal(timeout.code, 1);
  assert.match(timeout.stdout, /未检测到弹窗/);

  const permission = await runCli(['once', ...args], {
    env: { CAC_WIN_MOCK_SCENARIO: 'permission_denied' }
  });
  assert.equal(permission.code, 3);
  assert.match(permission.stdout, /权限不足/);
});

test('once --json returns a machine-readable result', {
  timeout: 60000
}, async (t) => {
  const stateDir = makeStateDir(t);
  const result = await runCli(['once', '--dry-run', '--json', ...commonArgs(stateDir)], {
    env: { CAC_WIN_MOCK_SCENARIO: 'would_click' }
  });
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.result, 'would_click');
  assert.equal(payload.exitCode, 0);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.candidate.name, 'Allow');
});

test('async allow starts a background watcher and rejects duplicates', {
  timeout: 120000
}, async (t) => {
  const stateDir = makeStateDir(t);
  const args = commonArgs(stateDir);
  const env = { CAC_WIN_MOCK_SCENARIO: 'follow' };

  const started = await runCli(['allow', ...args], { env });
  assert.equal(started.code, 0, started.stderr);
  assert.match(started.stdout, /已启动后台监听/);

  const pidFile = path.join(stateDir, 'allow.json');
  const record = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(record.mode, 'once');
  assert.equal(isProcessAlive(record.pid), true);

  const duplicate = await runCli(['allow', ...args], { env });
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr, /已在运行/);

  const status = await runCli([
    'status',
    '--no-page-check',
    '--port-file', path.join(stateDir, 'missing-DevToolsActivePort'),
    ...args
  ]);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /一次性监听: 运行中/);

  const stopped = await runCli(['stop', '--state-dir', stateDir]);
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.match(stopped.stdout, /已停止/);
  assert.equal(fs.existsSync(pidFile), false);
});