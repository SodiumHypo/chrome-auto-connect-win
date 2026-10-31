#!/usr/bin/env node
'use strict';

const { parseArgs } = require('./lib/args');
const {
  APP_NAME,
  VERSION
} = require('./lib/defaults');
const { CacError } = require('./lib/errors');
const {
  writeJson,
  renderStatus,
  renderOnceResult,
  renderStopResult,
  renderStartResult,
  renderConnectResult
} = require('./lib/output');
const { HELP_TEXT } = require('./commands/help');
const { runStatus } = require('./commands/status');
const { runOnceCommand } = require('./commands/once');
const { runAllowCommand } = require('./commands/allow');
const { runStartCommand } = require('./commands/start');
const { runStopCommand } = require('./commands/stop');
const { runConnect } = require('./commands/connect');

function errorExitCode(error) {
  if (error && Number.isInteger(error.exitCode)) return error.exitCode;
  return 3;
}

function reportError(error, options, rawArgv) {
  const exitCode = errorExitCode(error);
  const json = Boolean((options && options.json) || rawArgv.includes('--json'));
  const message = error && error.message ? error.message : String(error);

  if (json) {
    const payload = error instanceof CacError
      ? { ...error.toJSON(), exitCode }
      : { status: 'error', code: 'unexpected_error', message, exitCode };
    writeJson(process.stdout, payload);
    return exitCode;
  }

  process.stderr.write(`[ERROR] ${message}\n`);
  if (error && error.hint) process.stderr.write(`提示: ${error.hint}\n`);
  if (options && options.debug && error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  return exitCode;
}

function printAllowAsync(result, options) {
  if (options.json) {
    writeJson(process.stdout, result);
    return;
  }
  process.stdout.write(`${result.message}\n`);
  process.stdout.write(`  PID: ${result.pid}\n`);
  process.stdout.write(`  PID 文件: ${result.pidFile}\n`);
  process.stdout.write(`  日志文件: ${result.logFile}\n`);
  if (result.dryRun) process.stdout.write('  dry-run: 不会实际点击\n');
  process.stdout.write(`  ${result.timeoutMs}ms 内未检测到弹窗则自动退出；可用 "chrome-auto-connect-win status" 查看。\n`);
}

async function dispatch(command, options) {
  switch (command) {
    case 'help':
      process.stdout.write(`${HELP_TEXT}\n`);
      return 0;
    case 'version':
      process.stdout.write(`${APP_NAME} ${VERSION}\n`);
      return 0;
    case 'status': {
      const { exitCode, report } = await runStatus(options);
      if (options.json) writeJson(process.stdout, report);
      else process.stdout.write(`${renderStatus(report)}\n`);
      return exitCode;
    }
    case 'once': {
      const { exitCode, result } = await runOnceCommand(options);
      if (options.json) writeJson(process.stdout, result);
      else process.stdout.write(`${renderOnceResult(result)}\n`);
      return exitCode;
    }
    case 'allow': {
      const { exitCode, result } = await runAllowCommand(options);
      if (options.json) writeJson(process.stdout, result);
      else if (result.async) printAllowAsync(result, options);
      else process.stdout.write(`${renderOnceResult(result)}\n`);
      return exitCode;
    }
    case 'start': {
      const { exitCode, result } = await runStartCommand(options);
      if (options.json) writeJson(process.stdout, result);
      else process.stdout.write(`${renderStartResult(result)}\n`);
      return exitCode;
    }
    case 'stop': {
      const { exitCode, result } = await runStopCommand(options);
      if (options.json) writeJson(process.stdout, { ...result, exitCode });
      else process.stdout.write(`${renderStopResult(result)}\n`);
      return exitCode;
    }
    case 'connect': {
      const { exitCode, result } = await runConnect(options);
      if (options.json) writeJson(process.stdout, { ...result, exitCode });
      else process.stdout.write(`${renderConnectResult(result)}\n`);
      return exitCode;
    }
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      return 1;
  }
}

async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    return reportError(error, null, argv);
  }

  const { command, options } = parsed;
  try {
    return await dispatch(command, options);
  } catch (error) {
    return reportError(error, options, argv);
  }
}

module.exports = {
  main,
  dispatch,
  reportError
};