'use strict';

class CacError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || 'error';
    this.exitCode = Number.isInteger(options.exitCode) ? options.exitCode : 1;
    this.hint = options.hint || '';
    this.details = options.details || undefined;
  }

  toJSON() {
    const out = {
      status: 'error',
      code: this.code,
      message: this.message
    };
    if (this.hint) out.hint = this.hint;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

class UsageError extends CacError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'usage', exitCode: 1 });
  }
}

class AlreadyRunningError extends CacError {
  constructor(message, details) {
    super(message, {
      code: 'already_running',
      exitCode: 1,
      hint: 'Use "chrome-auto-connect-win stop" before starting a new watcher.',
      details
    });
  }
}

class NotRunningError extends CacError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'not_running', exitCode: 1 });
  }
}

module.exports = {
  CacError,
  UsageError,
  AlreadyRunningError,
  NotRunningError
};