'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const defaults = require('../src/lib/defaults');

test('package name does not impersonate the macOS original', () => {
  assert.equal(defaults.APP_NAME, 'chrome-auto-connect-win');
  assert.equal(defaults.VERSION, require('../package.json').version);
});

test('localized defaults cover English and Chinese Chrome dialogs', () => {
  assert.ok(defaults.DEFAULT_BUTTON_NAMES.includes('Allow'));
  assert.ok(defaults.DEFAULT_BUTTON_NAMES.includes('允许'));
  assert.ok(defaults.DEFAULT_TITLE_PATTERNS.some((item) => item.includes('remote debugging')));
  assert.ok(defaults.DEFAULT_TITLE_PATTERNS.some((item) => item.includes('远程调试')));
  assert.deepEqual(defaults.DEFAULT_PROCESS_NAMES, ['chrome']);
});

test('state paths live under LOCALAPPDATA', () => {
  const stateDir = defaults.getStateDir();
  assert.ok(stateDir.includes(defaults.APP_NAME));
  assert.equal(defaults.getDefaultPidFile(), path.join(stateDir, 'daemon.json'));
  assert.equal(defaults.getDefaultAllowPidFile(), path.join(stateDir, 'allow.json'));
  assert.equal(defaults.getDefaultLogFile(), path.join(stateDir, 'daemon.log'));
  assert.equal(defaults.getDaemonConfigFile(), path.join(stateDir, 'daemon-config.json'));
  assert.equal(defaults.getDaemonLockFile(), path.join(stateDir, 'daemon.lock'));
  assert.equal(defaults.getAllowLogFile(), path.join(stateDir, 'allow.log'));
});

test('custom Chrome user data directory changes the port file', () => {
  const custom = path.join(process.cwd(), 'profile');
  assert.equal(defaults.getDefaultPortFile(custom), path.join(custom, 'DevToolsActivePort'));
  assert.match(defaults.getDefaultPortFile(), /Google[\\/]Chrome[\\/]User Data[\\/]DevToolsActivePort$/);
});