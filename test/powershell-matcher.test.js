'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function parseSummary(output) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

test('PowerShell matcher handles English/Chinese buttons and dialog titles', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const script = path.join(__dirname, 'powershell', 'matcher.tests.ps1');
  const matcher = path.join(__dirname, '..', 'scripts', 'uia-matcher.ps1');
  const cases = path.join(__dirname, 'powershell', 'matcher-cases.json');

  let stdout;
  try {
    const result = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-CasesFile', cases,
      '-MatcherPath', matcher
    ], {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
    stdout = result.stdout;
  } catch (error) {
    if (error.code === 'ENOENT') {
      t.skip('Windows PowerShell is not available');
      return;
    }
    if (error.stdout) {
      const summary = parseSummary(error.stdout);
      assert.fail(`PowerShell matcher failures: ${JSON.stringify(summary.failures)}`);
    }
    throw error;
  }

  const summary = parseSummary(stdout);
  assert.equal(summary.ok, true, JSON.stringify(summary.failures));
  assert.equal(summary.total, summary.passed);
  assert.ok(summary.total >= 16);
});