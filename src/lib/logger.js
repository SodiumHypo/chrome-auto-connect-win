'use strict';

const LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function supportsColor(stream) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream && stream.isTTY);
}

function createLogger(options = {}) {
  const levelName = LEVELS[options.level] === undefined ? 'info' : options.level;
  const threshold = LEVELS[levelName];
  const json = Boolean(options.json);
  const stream = options.stream || process.stderr;
  const color = options.color === undefined ? supportsColor(stream) : Boolean(options.color);
  const prefix = options.prefix || '';

  const paint = (name, text) => {
    if (!color) return text;
    return `${COLORS[name] || ''}${text}${COLORS.reset}`;
  };

  const write = (level, message, data) => {
    if (LEVELS[level] > threshold) return;
    const timestamp = new Date().toISOString();
    if (json) {
      const record = { timestamp, level, message };
      if (prefix) record.scope = prefix;
      if (data && typeof data === 'object') Object.assign(record, data);
      stream.write(`${JSON.stringify(record)}\n`);
      return;
    }
    const labels = {
      error: paint('red', '[ERROR]'),
      warn: paint('yellow', '[WARN]'),
      info: paint('green', '[INFO]'),
      debug: paint('gray', '[DEBUG]')
    };
    const scope = prefix ? `${prefix} ` : '';
    let line = `${labels[level]} ${scope}${message}`;
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      line += ` ${JSON.stringify(data)}`;
    }
    stream.write(`${line}\n`);
  };

  return {
    level: levelName,
    json,
    stream,
    error: (message, data) => write('error', message, data),
    warn: (message, data) => write('warn', message, data),
    info: (message, data) => write('info', message, data),
    debug: (message, data) => write('debug', message, data),
    child: (scope) => createLogger({ ...options, prefix: scope, level: levelName, json, stream, color })
  };
}

function silentLogger() {
  return createLogger({ level: 'silent' });
}

module.exports = {
  LEVELS,
  COLORS,
  supportsColor,
  createLogger,
  silentLogger
};