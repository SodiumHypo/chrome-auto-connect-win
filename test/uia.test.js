'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('../src/lib/args');
const {
  buildPsConfig,
  writeConfigFile,
  safeRemoveDir,
  parseEventLines,
  runWatcher,
  mapWatcherResult,
  runOnce,
  runProbe
} = require('../src/lib/uia');

const MOCK_PS = path.join(__dirname, 'fixtures', 'mock-watcher.ps1');

function baseConfig(overrides = {}) {
  return {
    buttonNames: ['Allow', '允许'],
    titlePatterns: ['remote debugging', '远程调试'],
    processNames: ['chrome'],
    dryRun: false,
    follow: false,
    probe: false,
    timeoutMs: 1000,
    intervalMs: 100,
    clickCooldownMs: 0,
    maxClicksPerDialog: 3,
    clickResetMs: 1000,
    debug: false,
    mockScenario: 'clicked',
    ...overrides
  };
}

test('buildPsConfig carries localization and watcher settings', () => {
  const { options } = parseArgs(['once', '--timeout', '2', '--button', '允许', '--title', '远程调试']);
  const config = buildPsConfig(options, { follow: true });
  assert.deepEqual(config.buttonNames, ['允许']);
  assert.deepEqual(config.titlePatterns, ['远程调试']);
  assert.equal(config.timeoutMs, 2000);
  assert.equal(config.follow, true);
  assert.equal(config.probe, false);
  assert.equal(config.intervalMs, 500);
  assert.equal(config.maxClicksPerDialog, 3);
  assert.equal(config.clickResetMs, 60000);
});

test('writeConfigFile persists UTF-8 JSON and can be removed', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-win-uia-'));
  const result = writeConfigFile(baseConfig({ buttonNames: ['允许'] }), { tempRoot });
  try {
    const raw = fs.readFileSync(result.file, 'utf8');
    assert.match(raw, /允许/);
    assert.equal(JSON.parse(raw).buttonNames[0], '允许');
  } finally {
    safeRemoveDir(result.dir);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(result.dir), false);
});

test('parseEventLines tolerates BOM, blank lines and garbage', () => {
  const { events, errors } = parseEventLines([
    '',
    '﻿{"event":"start","mode":"once"}',
    'not json',
    '{"noEvent":true}',
    '{"event":"clicked","candidate":{"name":"允许"}}'
  ]);
  assert.deepEqual(events.map((event) => event.event), ['start', 'clicked']);
  assert.equal(events[1].candidate.name, '允许');
  assert.equal(errors.length, 1);
});

test('mapWatcherResult maps every watcher outcome to an exit code', () => {
  const candidate = { name: 'Allow', dialogName: 'Allow remote debugging?' };

  assert.deepEqual(
    [mapWatcherResult({ exitCode: 0, events: [{ event: 'clicked', candidate }] }).exitCode, 'clicked'],
    [0, 'clicked']
  );
  const dry = mapWatcherResult({ exitCode: 0, events: [{ event: 'would_click', candidate }] }, { dryRun: true });
  assert.equal(dry.result, 'would_click');
  assert.equal(dry.exitCode, 0);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.candidate.name, 'Allow');

  const timeout = mapWatcherResult({ exitCode: 1, events: [{ event: 'timeout' }] });
  assert.equal(timeout.result, 'timeout');
  assert.equal(timeout.exitCode, 1);

  const noChrome = mapWatcherResult({ exitCode: 2, events: [{ event: 'no_chrome' }] });
  assert.equal(noChrome.result, 'no_chrome');
  assert.equal(noChrome.exitCode, 2);

  const permission = mapWatcherResult({
    exitCode: 3,
    events: [{ event: 'permission_denied', code: 'uia_access_denied', message: 'denied', hint: 'elevate' }]
  });
  assert.equal(permission.result, 'permission_denied');
  assert.equal(permission.exitCode, 3);
  assert.equal(permission.code, 'uia_access_denied');
  assert.equal(permission.hint, 'elevate');

  const failed = mapWatcherResult({
    exitCode: 3,
    stderr: 'boom',
    events: [{ event: 'error', code: 'uia_unavailable', message: 'missing' }]
  });
  assert.equal(failed.result, 'error');
  assert.equal(failed.exitCode, 3);
  assert.equal(failed.stderr, 'boom');

  const watchdog = mapWatcherResult({ exitCode: 3, timedOut: true, events: [] });
  assert.equal(watchdog.result, 'error');
  assert.equal(watchdog.timedOut, true);
});

test('runWatcher bridges PowerShell JSON events including Chinese text', async () => {
  const result = await runWatcher(baseConfig(), { psScript: MOCK_PS, timeoutGraceMs: 5000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.events[0].event, 'start');
  assert.equal(result.events[1].event, 'clicked');
  assert.equal(result.events[1].candidate.name, '允许');
  assert.equal(result.events[1].candidate.dialogName, '要允许远程调试吗？');
  assert.equal(result.parseErrors.length, 0);

  const mapped = mapWatcherResult(result);
  assert.equal(mapped.result, 'clicked');
  assert.equal(mapped.message, '成功点击「允许」按钮');
});

test('runWatcher/runOnce honor mock no_chrome, timeout and permission outcomes', async () => {
  const noChrome = await runOnce(parseArgs(['once']).options, {
    psScript: MOCK_PS,
    env: { CAC_WIN_MOCK_SCENARIO: 'no_chrome' }
  });
  assert.equal(noChrome.result, 'no_chrome');
  assert.equal(noChrome.exitCode, 2);

  const timeout = await runOnce(parseArgs(['once']).options, {
    psScript: MOCK_PS,
    env: { CAC_WIN_MOCK_SCENARIO: 'timeout' }
  });
  assert.equal(timeout.result, 'timeout');
  assert.equal(timeout.exitCode, 1);

  const permission = await runOnce(parseArgs(['once']).options, {
    psScript: MOCK_PS,
    env: { CAC_WIN_MOCK_SCENARIO: 'permission_denied' }
  });
  assert.equal(permission.result, 'permission_denied');
  assert.equal(permission.exitCode, 3);
});

test('runProbe returns selected Chinese/dialog metadata', async () => {
  const { options } = parseArgs(['status']);
  const probe = await runProbe({ ...options, psScript: MOCK_PS });
  assert.equal(probe.ok, true);
  assert.equal(probe.chromeRunning, true);
  assert.equal(probe.selected.name, '允许');
  assert.equal(probe.reason, 'title_match');
  assert.equal(probe.candidates.length, 1);
});

test('runWatcher watchdog kills a follow watcher that never exits', async () => {
  const result = await runWatcher(baseConfig({ follow: true, mockScenario: 'follow' }), {
    psScript: MOCK_PS,
    maxRuntimeMs: 500
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, 3);
});