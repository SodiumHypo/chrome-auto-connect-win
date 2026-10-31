'use strict';

const path = require('path');
const {
  DEFAULT_BUTTON_NAMES,
  DEFAULT_TITLE_PATTERNS,
  DEFAULT_PROCESS_NAMES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_CLICK_COOLDOWN_MS,
  DEFAULT_MAX_CLICKS_PER_DIALOG,
  LOG_LEVELS,
  getStateDir,
  getDefaultPidFile,
  getDefaultAllowPidFile,
  getDefaultLogFile,
  getDefaultPortFile
} = require('./defaults');
const { UsageError } = require('./errors');

const COMMANDS = new Set(['status', 'start', 'stop', 'allow', 'once', 'connect', 'help', 'version']);

const BOOLEAN_OPTIONS = new Map([
  ['--debug', 'debug'],
  ['--json', 'json'],
  ['--sync', 'sync'],
  ['--dry-run', 'dryRun'],
  ['--foreground', 'foreground'],
  ['--connect', 'connect'],
  ['--no-connect', 'noConnect'],
  ['--no-page-check', 'noPageCheck'],
  ['--probe', 'probe'],
  ['--quiet', 'quiet'],
  ['--help', 'help'],
  ['--version', 'version']
]);

const VALUE_OPTIONS = new Map([
  ['--timeout', 'timeout'],
  ['--timeout-ms', 'timeoutMs'],
  ['--interval', 'interval'],
  ['--button', 'button'],
  ['--title', 'title'],
  ['--process-name', 'processName'],
  ['--log-level', 'logLevel'],
  ['--log-file', 'logFile'],
  ['--pid-file', 'pidFile'],
  ['--state-dir', 'stateDir'],
  ['--user-data-dir', 'userDataDir'],
  ['--port-file', 'portFile'],
  ['--ps-path', 'psPath'],
  ['--ps-script', 'psScript'],
  ['--devtools-command', 'devtoolsCommand'],
  ['--click-cooldown', 'clickCooldown'],
  ['--max-clicks', 'maxClicks']
]);

const SHORT_OPTIONS = new Map([
  ['-h', '--help'],
  ['-v', '--version']
]);

function splitList(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value, label, { integer = false, min = 0, allowZero = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new UsageError(`${label} requires a value`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new UsageError(`${label} must be a number, got: ${value}`);
  }
  if (integer && !Number.isInteger(number)) {
    throw new UsageError(`${label} must be an integer, got: ${value}`);
  }
  if (number < min || (!allowZero && number === 0)) {
    throw new UsageError(`${label} must be ${allowZero ? `>= ${min}` : `> ${min}`}, got: ${value}`);
  }
  return number;
}

function createDefaultOptions() {
  return {
    debug: false,
    json: false,
    sync: false,
    dryRun: false,
    foreground: false,
    connect: false,
    noConnect: false,
    noPageCheck: false,
    probe: false,
    quiet: false,
    help: false,
    version: false,

    timeoutMs: DEFAULT_TIMEOUT_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
    clickCooldownMs: DEFAULT_CLICK_COOLDOWN_MS,
    maxClicksPerDialog: DEFAULT_MAX_CLICKS_PER_DIALOG,

    buttonNames: [...DEFAULT_BUTTON_NAMES],
    titlePatterns: [...DEFAULT_TITLE_PATTERNS],
    processNames: [...DEFAULT_PROCESS_NAMES],
    logLevel: 'info',
    logFile: null,
    pidFile: null,
    allowPidFile: null,
    stateDir: null,
    userDataDir: null,
    portFile: null,
    psPath: null,
    psScript: null,
    devtoolsCommand: 'chrome-devtools',
    connectTimeoutMs: 120000
  };
}

function requireValue(argv, index, optionName, inlineValue) {
  if (inlineValue !== undefined) return { value: inlineValue, consumed: 0 };
  if (index + 1 >= argv.length) {
    throw new UsageError(`${optionName} requires a value`);
  }
  return { value: argv[index + 1], consumed: 1 };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = createDefaultOptions();
  const explicit = {
    button: false,
    title: false,
    processName: false,
    logLevel: false,
    timeout: false,
    timeoutMs: false,
    interval: false
  };
  let command = null;

  const applyBoolean = (name, optionName) => {
    if (optionName === 'help') options.help = true;
    else if (optionName === 'version') options.version = true;
    else options[optionName] = true;
  };

  const applyValue = (optionName, value, optionNameForError) => {
    switch (optionName) {
      case 'timeout': {
        const seconds = parseNumber(value, optionNameForError, { min: 0, allowZero: true });
        options.timeoutMs = Math.round(seconds * 1000);
        explicit.timeout = true;
        break;
      }
      case 'timeoutMs':
        options.timeoutMs = Math.round(parseNumber(value, optionNameForError, { min: 0, allowZero: true }));
        explicit.timeoutMs = true;
        break;
      case 'interval':
        options.intervalMs = Math.round(parseNumber(value, optionNameForError, { integer: true, min: 0, allowZero: false }));
        explicit.interval = true;
        break;
      case 'button':
        if (!explicit.button) {
          options.buttonNames = [];
          explicit.button = true;
        }
        options.buttonNames.push(...splitList(value));
        break;
      case 'title':
        if (!explicit.title) {
          options.titlePatterns = [];
          explicit.title = true;
        }
        options.titlePatterns.push(...splitList(value));
        break;
      case 'processName':
        if (!explicit.processName) {
          options.processNames = [];
          explicit.processName = true;
        }
        options.processNames.push(...splitList(value));
        break;
      case 'logLevel':
        if (!LOG_LEVELS.includes(value)) {
          throw new UsageError(`--log-level must be one of: ${LOG_LEVELS.join(', ')}`);
        }
        options.logLevel = value;
        explicit.logLevel = true;
        break;
      case 'logFile':
        options.logFile = value;
        break;
      case 'pidFile':
        options.pidFile = value;
        break;
      case 'stateDir':
        options.stateDir = value;
        break;
      case 'userDataDir':
        options.userDataDir = value;
        break;
      case 'portFile':
        options.portFile = value;
        break;
      case 'psPath':
        options.psPath = value;
        break;
      case 'psScript':
        options.psScript = value;
        break;
      case 'devtoolsCommand':
        options.devtoolsCommand = value;
        break;
      case 'clickCooldown':
        options.clickCooldownMs = Math.round(parseNumber(value, optionNameForError, { integer: true, min: 0, allowZero: true }));
        break;
      case 'maxClicks':
        options.maxClicksPerDialog = Math.round(parseNumber(value, optionNameForError, { integer: true, min: 0, allowZero: false }));
        break;
      default:
        throw new UsageError(`Unhandled option: ${optionNameForError}`);
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    let arg = argv[index];

    if (arg === '--') {
      const rest = argv.slice(index + 1);
      if (rest.length === 0) break;
      throw new UsageError(`Unexpected argument: ${rest[0]}`);
    }

    if (arg.startsWith('--')) {
      const equalsAt = arg.indexOf('=');
      let optionName = arg;
      let inlineValue;
      if (equalsAt !== -1) {
        optionName = arg.slice(0, equalsAt);
        inlineValue = arg.slice(equalsAt + 1);
      }

      if (BOOLEAN_OPTIONS.has(optionName)) {
        if (inlineValue !== undefined) {
          throw new UsageError(`${optionName} does not accept a value`);
        }
        applyBoolean(optionName, BOOLEAN_OPTIONS.get(optionName));
        continue;
      }

      if (VALUE_OPTIONS.has(optionName)) {
        const { value, consumed } = requireValue(argv, index, optionName, inlineValue);
        applyValue(VALUE_OPTIONS.get(optionName), value, optionName);
        index += consumed;
        continue;
      }

      throw new UsageError(`Unknown option: ${optionName}`);
    }

    if (arg.startsWith('-') && arg !== '-') {
      if (!SHORT_OPTIONS.has(arg)) {
        throw new UsageError(`Unknown option: ${arg}`);
      }
      const longName = SHORT_OPTIONS.get(arg);
      applyBoolean(longName, BOOLEAN_OPTIONS.get(longName));
      continue;
    }

    if (command) {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
    if (!COMMANDS.has(arg)) {
      throw new UsageError(`Unknown command: ${arg}`);
    }
    command = arg;
  }

  if (options.version) command = 'version';
  else if (options.help) command = 'help';
  else if (!command) command = 'help';

  if (command === 'help' || command === 'version') {
    return { command, options };
  }

  if (options.debug && options.quiet) {
    throw new UsageError('--debug cannot be combined with --quiet');
  }
  if (options.debug && !explicit.logLevel) options.logLevel = 'debug';
  if (options.quiet && !explicit.logLevel) options.logLevel = 'silent';

  if (options.sync && !['allow', 'once'].includes(command)) {
    throw new UsageError('--sync is only supported by the "allow" and "once" commands');
  }
  if ((options.connect || options.noConnect) && command !== 'start') {
    throw new UsageError('--connect and --no-connect are only supported by the "start" command');
  }
  if (options.connect && options.noConnect) {
    throw new UsageError('--connect cannot be combined with --no-connect');
  }
  if (options.foreground && command !== 'start') {
    throw new UsageError('--foreground is only supported by the "start" command');
  }
  if (options.foreground && options.connect) {
    throw new UsageError('--connect cannot be combined with --foreground; run "start" in the background to auto-connect');
  }
  if (options.noPageCheck && !['status', 'connect'].includes(command)) {
    throw new UsageError('--no-page-check is only supported by the "status" and "connect" commands');
  }
  if (options.probe && command !== 'status') {
    throw new UsageError('--probe is only supported by the "status" command');
  }
  if (options.dryRun && command === 'connect') {
    throw new UsageError('--dry-run cannot be used with the "connect" command because the connection would block waiting for a click');
  }
  if (options.connect && command === 'start' && options.dryRun) {
    throw new UsageError('--dry-run cannot be combined with --connect because the DevTools connection would block');
  }

  if (options.buttonNames.length === 0) {
    throw new UsageError('At least one --button value is required');
  }
  if (options.titlePatterns.length === 0) {
    throw new UsageError('At least one --title value is required');
  }
  if (options.processNames.length === 0) {
    throw new UsageError('At least one --process-name value is required');
  }

  const stateDir = options.stateDir ? path.resolve(options.stateDir) : getStateDir();
  options.stateDir = stateDir;

  if (!options.pidFile) {
    options.pidFile = options.stateDir === getStateDir() ? getDefaultPidFile() : path.join(stateDir, 'daemon.json');
  } else {
    options.pidFile = path.resolve(options.pidFile);
  }

  if (!options.logFile) {
    options.logFile = options.stateDir === getStateDir() ? getDefaultLogFile() : path.join(stateDir, 'daemon.log');
  } else {
    options.logFile = path.resolve(options.logFile);
  }

  options.allowPidFile = path.join(path.dirname(options.pidFile), 'allow.json');

  if (!options.portFile) {
    options.portFile = getDefaultPortFile(options.userDataDir ? path.resolve(options.userDataDir) : undefined);
  } else {
    options.portFile = path.resolve(options.portFile);
  }

  return { command, options };
}

module.exports = {
  COMMANDS,
  BOOLEAN_OPTIONS,
  VALUE_OPTIONS,
  splitList,
  parseNumber,
  createDefaultOptions,
  parseArgs
};