'use strict';

const os = require('os');
const path = require('path');
const pkg = require('../../package.json');

const APP_NAME = 'chrome-auto-connect-win';
const VERSION = pkg.version;

// The Chrome UI uses the exact labels "Allow" (English) and "允许" (Chinese).
// Extra variants are kept for older / future localized builds.
const DEFAULT_BUTTON_NAMES = ['Allow', '允许'];
const DEFAULT_TITLE_PATTERNS = ['remote debugging', '远程调试'];
const DEFAULT_PROCESS_NAMES = ['chrome'];

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_CLICK_COOLDOWN_MS = 2000;
const DEFAULT_MAX_CLICKS_PER_DIALOG = 3;
const DEFAULT_CLICK_RESET_MS = 60000;

const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];

function getLocalAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

function getStateDir() {
  return path.join(getLocalAppData(), APP_NAME);
}

function getDefaultPidFile() {
  return path.join(getStateDir(), 'daemon.json');
}

function getDefaultAllowPidFile() {
  return path.join(getStateDir(), 'allow.json');
}

function getDefaultLogFile() {
  return path.join(getStateDir(), 'daemon.log');
}

function getDaemonConfigFile(stateDir) {
  return path.join(stateDir || getStateDir(), 'daemon-config.json');
}

function getDaemonLockFile(stateDir) {
  return path.join(stateDir || getStateDir(), 'daemon.lock');
}

function getAllowLogFile(stateDir) {
  return path.join(stateDir || getStateDir(), 'allow.log');
}

function getAllowConfigFile(stateDir) {
  return path.join(stateDir || getStateDir(), 'allow-config.json');
}

function getAllowLockFile(stateDir) {
  return path.join(stateDir || getStateDir(), 'allow.lock');
}

function getUserDataDir() {
  return path.join(getLocalAppData(), 'Google', 'Chrome', 'User Data');
}

function getDefaultPortFile(userDataDir) {
  return path.join(userDataDir || getUserDataDir(), 'DevToolsActivePort');
}

module.exports = {
  APP_NAME,
  VERSION,
  DEFAULT_BUTTON_NAMES,
  DEFAULT_TITLE_PATTERNS,
  DEFAULT_PROCESS_NAMES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_CLICK_COOLDOWN_MS,
  DEFAULT_MAX_CLICKS_PER_DIALOG,
  DEFAULT_CLICK_RESET_MS,
  LOG_LEVELS,
  getLocalAppData,
  getStateDir,
  getDefaultPidFile,
  getDefaultAllowPidFile,
  getDefaultLogFile,
  getDaemonConfigFile,
  getDaemonLockFile,
  getAllowLogFile,
  getAllowConfigFile,
  getAllowLockFile,
  getUserDataDir,
  getDefaultPortFile
};