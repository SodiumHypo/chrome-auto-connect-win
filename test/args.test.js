'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseArgs } = require('../src/lib/args');
const {
  DEFAULT_BUTTON_NAMES,
  DEFAULT_TITLE_PATTERNS,
  DEFAULT_PROCESS_NAMES
} = require('../src/lib/defaults');

test('start uses macOS-compatible defaults', () => {
  const { command, options } = parseArgs(['start']);
  assert.equal(command, 'start');
  assert.deepEqual(options.buttonNames, DEFAULT_BUTTON_NAMES);
  assert.deepEqual(options.titlePatterns, DEFAULT_TITLE_PATTERNS);
  assert.deepEqual(options.processNames, DEFAULT_PROCESS_NAMES);
  assert.equal(options.timeoutMs, 5000);
  assert.equal(options.intervalMs, 500);
  assert.equal(options.clickCooldownMs, 2000);
  assert.equal(options.maxClicksPerDialog, 3);
  assert.equal(options.connect, false);
  assert.equal(options.noConnect, false);
  assert.match(options.pidFile, /daemon\.json$/);
  assert.match(options.logFile, /daemon\.log$/);
  assert.match(options.allowPidFile, /allow\.json$/);
});

test('supports seconds and milliseconds timeouts', () => {
  assert.equal(parseArgs(['once', '--timeout', '1.5']).options.timeoutMs, 1500);
  assert.equal(parseArgs(['once', '--timeout-ms', '250']).options.timeoutMs, 250);
  assert.equal(parseArgs(['once', '--timeout', '0']).options.timeoutMs, 0);
  assert.throws(() => parseArgs(['once', '--timeout', '-1']), /must be >= 0/);
  assert.throws(() => parseArgs(['once', '--interval', '0']), /must be > 0/);
});

test('repeatable and comma-separated localized options replace defaults', () => {
  const { options } = parseArgs([
    'once',
    '--button', '允许,Allow',
    '--button', 'Yes',
    '--title', '远程调试',
    '--title', 'remote debugging',
    '--process-name', 'chrome,chrome-beta'
  ]);
  assert.deepEqual(options.buttonNames, ['允许', 'Allow', 'Yes']);
  assert.deepEqual(options.titlePatterns, ['远程调试', 'remote debugging']);
  assert.deepEqual(options.processNames, ['chrome', 'chrome-beta']);
});

test('state directory rewrites default pid/log/allow paths', () => {
  const stateDir = path.join(process.cwd(), '.test-state');
  const { options } = parseArgs(['status', '--state-dir', stateDir]);
  assert.equal(options.stateDir, path.resolve(stateDir));
  assert.equal(options.pidFile, path.join(path.resolve(stateDir), 'daemon.json'));
  assert.equal(options.logFile, path.join(path.resolve(stateDir), 'daemon.log'));
  assert.equal(options.allowPidFile, path.join(path.resolve(stateDir), 'allow.json'));
});

test('log levels follow debug/quiet and reject conflicts', () => {
  assert.equal(parseArgs(['once', '--debug']).options.logLevel, 'debug');
  assert.equal(parseArgs(['once', '--quiet']).options.logLevel, 'silent');
  assert.equal(parseArgs(['once', '--log-level', 'warn']).options.logLevel, 'warn');
  assert.throws(() => parseArgs(['once', '--debug', '--quiet']), /cannot be combined/);
  assert.throws(() => parseArgs(['once', '--log-level', 'verbose']), /must be one of/);
});

test('rejects invalid commands, options and command-specific flags', () => {
  assert.throws(() => parseArgs(['nope']), /Unknown command/);
  assert.throws(() => parseArgs(['once', '--unknown']), /Unknown option/);
  assert.throws(() => parseArgs(['start', '--sync']), /only supported by/);
  assert.throws(() => parseArgs(['once', '--connect']), /only supported by/);
  assert.throws(() => parseArgs(['start', '--connect', '--no-connect']), /cannot be combined/);
  assert.throws(() => parseArgs(['start', '--dry-run', '--connect']), /dry-run cannot be combined/);
  assert.throws(() => parseArgs(['start', '--foreground', '--connect']), /cannot be combined with --foreground/);
  assert.throws(() => parseArgs(['connect', '--dry-run']), /dry-run cannot be used/);
  assert.throws(() => parseArgs(['once', '--probe']), /only supported by/);
  assert.throws(() => parseArgs(['start', '--no-page-check']), /only supported by/);
  assert.throws(() => parseArgs(['once', '--button', ',']), /At least one --button/);
  assert.throws(() => parseArgs(['once', '--max-clicks', '0']), /must be > 0/);
});

test('help/version short-circuit command validation', () => {
  assert.equal(parseArgs(['--help']).command, 'help');
  assert.equal(parseArgs(['-h']).command, 'help');
  assert.equal(parseArgs(['--version']).command, 'version');
  assert.equal(parseArgs(['-v']).command, 'version');
  assert.equal(parseArgs([]).command, 'help');
});

test('connect and status accept --no-page-check', () => {
  assert.equal(parseArgs(['connect', '--no-page-check']).options.noPageCheck, true);
  assert.equal(parseArgs(['status', '--no-page-check']).options.noPageCheck, true);
  assert.equal(parseArgs(['status', '--probe']).options.probe, true);
});