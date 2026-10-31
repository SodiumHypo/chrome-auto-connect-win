'use strict';

const { runOnce } = require('../lib/uia');

async function runOnceCommand(options, deps = {}) {
  const runner = deps.runOnce || runOnce;
  const result = await runner(options, deps.runOnceDeps || {});
  return { exitCode: result.exitCode, result };
}

module.exports = {
  runOnceCommand
};