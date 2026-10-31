'use strict';

const { spawn: nodeSpawn } = require('child_process');
const { CacError } = require('./errors');
const { killProcessTree } = require('./process');

const WS_ENDPOINT_RE = /^ws:\/\/127\.0\.0\.1:(\d{1,5})\/devtools\/browser\/[A-Za-z0-9._-]+$/;
const MAX_CAPTURE = 64 * 1024;

function validateWsEndpoint(endpoint) {
  const match = WS_ENDPOINT_RE.exec(String(endpoint || ''));
  if (!match) {
    throw new CacError(`Refusing to pass an unexpected WebSocket endpoint to chrome-devtools: ${endpoint}`, {
      code: 'invalid_ws_endpoint',
      hint: 'The endpoint must be the local browser endpoint read from DevToolsActivePort.'
    });
  }
  const port = Number(match[1]);
  if (port <= 0 || port > 65535) {
    throw new CacError(`Invalid port in WebSocket endpoint: ${port}`, { code: 'invalid_ws_endpoint' });
  }
  return endpoint;
}

function spawnCommand(command, args, options = {}) {
  const spawnImpl = options.spawnImpl || nodeSpawn;
  const capture = Boolean(options.capture);
  const timeoutMs = options.timeoutMs === undefined ? 120000 : options.timeoutMs;
  const shellCommand = /\s/.test(command) ? `"${command}"` : command;

  return new Promise((resolve, reject) => {
    let child;
    let timer = null;
    let settled = false;
    let timedOut = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };

    try {
      child = spawnImpl(shellCommand, args, {
        shell: true,
        windowsHide: true,
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['inherit', 'inherit', 'inherit']
      });
    } catch (error) {
      reject(new CacError(`Unable to start ${command}: ${error.message}`, { code: 'spawn_failed' }));
      return;
    }

    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (chunk) => {
        if (stdout.length < MAX_CAPTURE) stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < MAX_CAPTURE) stderr += chunk.toString();
      });
    }

    child.on('error', (error) => {
      finish(reject, new CacError(`Unable to run ${command}: ${error.message}`, {
        code: 'spawn_failed',
        hint: 'Install chrome-devtools-mcp globally: npm install -g chrome-devtools-mcp@latest'
      }));
    });

    child.on('close', (code, signal) => {
      finish(resolve, {
        code: code === null ? 1 : code,
        signal,
        stdout,
        stderr,
        timedOut
      });
    });

    if (timeoutMs > 0) {
      timer = setTimeout(async () => {
        if (settled) return;
        timedOut = true;
        await killProcessTree(child.pid);
      }, timeoutMs);
    }
  });
}

async function connectAndList(endpoint, options = {}) {
  validateWsEndpoint(endpoint);
  const command = options.command || 'chrome-devtools';
  const spawnImpl = options.spawnImpl;
  const capture = Boolean(options.capture);
  const timeoutMs = options.timeoutMs;
  const logger = options.logger;

  if (logger) logger.debug(`Running: ${command} start --wsEndpoint ${endpoint}`);
  const start = await spawnCommand(command, ['start', '--wsEndpoint', endpoint], { spawnImpl, capture, timeoutMs });
  if (start.code !== 0) {
    return {
      ok: false,
      stage: 'start',
      start,
      listPages: null
    };
  }

  if (logger) logger.debug('Running: chrome-devtools list_pages');
  const listPages = await spawnCommand(command, ['list_pages'], { spawnImpl, capture, timeoutMs });
  return {
    ok: listPages.code === 0,
    stage: listPages.code === 0 ? 'done' : 'list_pages',
    start,
    listPages
  };
}

module.exports = {
  WS_ENDPOINT_RE,
  validateWsEndpoint,
  spawnCommand,
  connectAndList
};