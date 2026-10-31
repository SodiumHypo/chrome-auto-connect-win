'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile: nodeExecFile } = require('child_process');
const { promisify } = require('util');
const { CacError } = require('./errors');
const { getDefaultPortFile } = require('./defaults');

const execFileAsync = promisify(nodeExecFile);

function parseTasklistCsv(text) {
  const processes = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^"([^"]+)","(\d+)"/);
    if (!match) continue;
    processes.push({ name: match[1], pid: Number(match[2]) });
  }
  return processes;
}

function imageNameForProcessName(name) {
  const base = path.basename(String(name).trim());
  return /\.exe$/i.test(base) ? base : `${base}.exe`;
}

async function listProcesses(processNames, options = {}) {
  const run = options.execFile || execFileAsync;
  const processes = [];
  const seen = new Set();

  for (const processName of processNames) {
    const imageName = imageNameForProcessName(processName);
    let stdout;
    try {
      const result = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      stdout = typeof result === 'string' ? result : result.stdout;
    } catch (error) {
      throw new CacError(`Unable to query running processes with tasklist: ${error.message}`, {
        code: 'tasklist_failed',
        hint: 'Run this command on Windows 10/11 where tasklist.exe is available.',
        details: { imageName }
      });
    }

    for (const item of parseTasklistCsv(stdout)) {
      if (seen.has(item.pid)) continue;
      seen.add(item.pid);
      processes.push({ ...item, imageName });
    }
  }

  return processes;
}

function parseDevToolsActivePort(content, portFile = 'DevToolsActivePort') {
  const lines = String(content || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new CacError(`Invalid DevToolsActivePort file: ${portFile}`, {
      code: 'invalid_port_file',
      hint: 'Open chrome://inspect/#remote-debugging and enable "Allow remote debugging for this browser instance".'
    });
  }

  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new CacError(`Invalid port in DevToolsActivePort: ${lines[0]}`, {
      code: 'invalid_port_file'
    });
  }

  const wsPath = lines[1];
  if (!wsPath.startsWith('/')) {
    throw new CacError(`Invalid WebSocket path in DevToolsActivePort: ${wsPath}`, {
      code: 'invalid_port_file'
    });
  }

  return {
    port,
    wsPath,
    wsEndpoint: `ws://127.0.0.1:${port}${wsPath}`
  };
}

function readDevToolsActivePort(portFile = getDefaultPortFile()) {
  let content;
  try {
    content = fs.readFileSync(portFile, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, path: portFile, available: false, reason: 'missing' };
    }
    throw error;
  }
  const parsed = parseDevToolsActivePort(content, portFile);
  return { exists: true, path: portFile, available: true, ...parsed };
}

function isPortListening(port, options = {}) {
  const timeoutMs = options.timeoutMs === undefined ? 1000 : options.timeoutMs;
  const netImpl = options.net || net;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(value);
    };

    const socket = netImpl.connect({ host: '127.0.0.1', port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function inspectEndpoint(options = {}) {
  const portFile = options.portFile || getDefaultPortFile(options.userDataDir);
  let parsed;
  try {
    parsed = readDevToolsActivePort(portFile);
  } catch (error) {
    return {
      exists: fs.existsSync(portFile),
      available: false,
      path: portFile,
      reason: 'invalid',
      error: error.message
    };
  }

  if (!parsed.exists) {
    return { ...parsed, reason: 'missing' };
  }

  const listening = await isPortListening(parsed.port, { timeoutMs: options.timeoutMs });
  return {
    ...parsed,
    listening,
    available: listening,
    reason: listening ? 'ok' : 'stale',
    stale: !listening
  };
}

async function findExecutable(command, options = {}) {
  const run = options.execFile || execFileAsync;
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return fs.existsSync(command) ? command : null;
  }
  try {
    const result = await run('where.exe', [command], { windowsHide: true, maxBuffer: 1024 * 1024 });
    const stdout = typeof result === 'string' ? result : result.stdout;
    const first = String(stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

async function checkDevtoolsCli(command = 'chrome-devtools', options = {}) {
  const resolved = await findExecutable(command, options);
  if (resolved) {
    return { available: true, command, path: resolved };
  }

  const local = path.join(
    __dirname,
    '..',
    '..',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'chrome-devtools.cmd' : 'chrome-devtools'
  );
  if (fs.existsSync(local)) {
    return { available: true, command, path: local, local: true };
  }

  return {
    available: false,
    command,
    path: null,
    install: 'npm install -g chrome-devtools-mcp@latest',
    github: 'https://github.com/ChromeDevTools/chrome-devtools-mcp'
  };
}

async function checkPowerShell(explicitPath, options = {}) {
  if (explicitPath) {
    const resolved = await findExecutable(explicitPath, options);
    return resolved
      ? { available: true, path: resolved, explicit: true }
      : { available: false, path: explicitPath, explicit: true };
  }

  const windowsPowerShell = await findExecutable('powershell.exe', options);
  if (windowsPowerShell) {
    return { available: true, path: windowsPowerShell, flavor: 'windows-powershell' };
  }

  const pwsh = await findExecutable('pwsh.exe', options);
  if (pwsh) {
    return {
      available: true,
      path: pwsh,
      flavor: 'pwsh',
      warning: 'PowerShell 7 may not include UIAutomationClient. Windows PowerShell 5.1 is recommended.'
    };
  }

  return { available: false, path: null };
}

module.exports = {
  parseTasklistCsv,
  imageNameForProcessName,
  listProcesses,
  parseDevToolsActivePort,
  readDevToolsActivePort,
  isPortListening,
  inspectEndpoint,
  findExecutable,
  checkDevtoolsCli,
  checkPowerShell
};