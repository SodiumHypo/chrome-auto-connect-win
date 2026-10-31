#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { runDaemonProcess, appendEvent } = require('./lib/daemon-runner');

function fail(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code || 3);
}

async function main() {
  const configFile = process.env.CAC_WIN_DAEMON_CONFIG;
  if (!configFile) {
    fail('CAC_WIN_DAEMON_CONFIG is not set.', 3);
    return;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    fail(`Unable to read daemon config: ${error.message}`, 3);
    return;
  }

  if (!config.token || !config.pidFile || !config.logFile || !config.lockFile || !config.options) {
    fail('Daemon config is missing required fields.', 3);
    return;
  }

  process.title = 'chrome-auto-connect-win daemon';

  process.on('uncaughtException', (error) => {
    appendEvent(config.logFile, {
      event: 'daemon_crash',
      code: error && error.code,
      message: error && error.message,
      stack: error && error.stack
    });
    process.exit(3);
  });
  process.on('unhandledRejection', (reason) => {
    appendEvent(config.logFile, {
      event: 'daemon_crash',
      code: reason && reason.code,
      message: reason && reason.message ? reason.message : String(reason),
      stack: reason && reason.stack
    });
    process.exit(3);
  });

  const result = await runDaemonProcess(config);
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
  }
  process.exitCode = result.exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 3;
});