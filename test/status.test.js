'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseArgs } = require('../src/lib/args');
const { APP_NAME } = require('../src/lib/defaults');
const { runStatus } = require('../src/commands/status');

function inspectByFile(daemon, allow) {
  return (file) => {
    if (file.endsWith('daemon.json')) return daemon;
    if (file.endsWith('allow.json')) return allow;
    throw new Error(`unexpected pid file: ${file}`);
  };
}

const missing = { exists: false, record: null, alive: false, stale: false };

function optionsFor(extra = []) {
  return parseArgs(['status', '--state-dir', path.join(process.cwd(), '.status-test'), ...extra]).options;
}

test('status reports daemon, Chrome, endpoint, UIA and pages', async () => {
  const probe = {
    ok: true,
    chromeRunning: true,
    chromeProcessCount: 2,
    candidates: [{ name: '允许', dialogName: '要允许远程调试吗？' }],
    selected: { name: '允许', dialogName: '要允许远程调试吗？' },
    reason: 'title_match',
    permissionIssues: 0
  };

  const { exitCode, report } = await runStatus(optionsFor(), {
    inspectPidFile: inspectByFile(
      { exists: true, alive: true, stale: false, record: { pid: 123, app: APP_NAME } },
      missing
    ),
    listProcesses: async () => [
      { name: 'chrome.exe', pid: 10 },
      { name: 'chrome.exe', pid: 11 }
    ],
    inspectEndpoint: async () => ({
      exists: true,
      available: true,
      port: 9222,
      wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/x',
      path: 'DevToolsActivePort'
    }),
    checkPowerShell: async () => ({ available: true, path: 'powershell.exe', flavor: 'windows-powershell' }),
    checkDevtoolsCli: async () => ({ available: true, path: 'chrome-devtools.cmd' }),
    runProbe: async () => probe,
    checkPages: async () => ({
      targetCount: 3,
      pageCount: 2,
      problems: [{ url: 'chrome://inspect/', title: 'Inspect', issue: 'internal' }]
    }),
    readLastJsonLine: () => ({ event: 'clicked', ts: '2026-01-01T00:00:00.000Z' })
  });

  assert.equal(exitCode, 0);
  assert.equal(report.status, 'ok');
  assert.equal(report.daemon.running, true);
  assert.equal(report.daemon.pid, 123);
  assert.equal(report.daemon.lastEvent.event, 'clicked');
  assert.equal(report.allow.running, false);
  assert.equal(report.chrome.running, true);
  assert.equal(report.chrome.count, 2);
  assert.equal(report.endpoint.available, true);
  assert.equal(report.uia.ok, true);
  assert.equal(report.uia.candidateCount, 1);
  assert.equal(report.uia.candidates, undefined);
  assert.equal(report.pages.checked, true);
  assert.equal(report.pages.problemCount, 1);
});

test('--probe keeps full candidate details', async () => {
  const { report } = await runStatus(optionsFor(['--probe']), {
    inspectPidFile: inspectByFile(missing, missing),
    listProcesses: async () => [],
    inspectEndpoint: async () => ({ exists: false, available: false, reason: 'missing', path: 'p' }),
    checkPowerShell: async () => ({ available: true, path: 'powershell.exe' }),
    checkDevtoolsCli: async () => ({ available: false, path: null }),
    runProbe: async () => ({
      ok: true,
      chromeRunning: true,
      candidates: [{ name: 'Allow' }],
      selected: { name: 'Allow' },
      reason: 'title_match'
    }),
    checkPages: async () => {
      throw new Error('should not be called');
    },
    readLastJsonLine: () => null
  });

  assert.equal(report.uia.candidates.length, 1);
  assert.equal(report.pages.checked, false);
  assert.equal(report.pages.reason, 'endpoint_unavailable');
});

test('status degrades gracefully when subsystems fail', async () => {
  let pagesCalled = false;
  const { exitCode, report } = await runStatus(optionsFor(['--no-page-check']), {
    inspectPidFile: inspectByFile(missing, missing),
    listProcesses: async () => { throw new Error('tasklist failed'); },
    inspectEndpoint: async () => { throw new Error('port file failed'); },
    checkPowerShell: async () => { throw new Error('no powershell'); },
    checkDevtoolsCli: async () => ({ available: false, path: null, install: 'npm i -g chrome-devtools-mcp' }),
    runProbe: async () => { throw new Error('probe failed'); },
    checkPages: async () => { pagesCalled = true; },
    readLastJsonLine: () => null
  });

  assert.equal(exitCode, 0);
  assert.equal(report.chrome.running, false);
  assert.equal(report.chrome.error, 'tasklist failed');
  assert.equal(report.endpoint.available, false);
  assert.equal(report.endpoint.reason, 'error');
  assert.equal(report.powershell.available, false);
  assert.equal(report.uia.ok, false);
  assert.equal(report.uia.error, 'probe failed');
  assert.equal(report.pages.checked, false);
  assert.equal(report.pages.reason, '--no-page-check');
  assert.equal(pagesCalled, false);
});