'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn: nodeSpawn } = require('child_process');
const { CacError } = require('./errors');
const { DEFAULT_CLICK_RESET_MS } = require('./defaults');
const { killProcessTree } = require('./process');

const DEFAULT_PS_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'allow-clicker.ps1');

function resolvePsPath(explicitPath) {
  return explicitPath || process.env.CAC_WIN_PS_PATH || 'powershell.exe';
}

function resolvePsScript(explicitPath) {
  return explicitPath ? path.resolve(explicitPath) : DEFAULT_PS_SCRIPT;
}

function buildPsConfig(options, overrides = {}) {
  return {
    buttonNames: options.buttonNames,
    titlePatterns: options.titlePatterns,
    processNames: options.processNames,
    dryRun: Boolean(options.dryRun),
    follow: Boolean(overrides.follow),
    probe: Boolean(overrides.probe),
    timeoutMs: options.timeoutMs,
    intervalMs: options.intervalMs,
    clickCooldownMs: options.clickCooldownMs,
    maxClicksPerDialog: options.maxClicksPerDialog,
    clickResetMs: DEFAULT_CLICK_RESET_MS,
    debug: options.logLevel === 'debug'
  };
}

function writeConfigFile(config, options = {}) {
  const dir = options.tempRoot
    ? fs.mkdtempSync(path.join(options.tempRoot, 'cac-win-'))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'cac-win-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { dir, file };
}

function safeRemoveDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Temp cleanup must never mask the actual result.
  }
}

function parseEventLines(lines) {
  const events = [];
  const errors = [];
  for (const raw of lines) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.event === 'string') events.push(parsed);
    } catch (error) {
      errors.push({ line, error: error.message });
    }
  }
  return { events, errors };
}

function runWatcher(config, options = {}) {
  const psPath = resolvePsPath(options.psPath);
  const psScript = resolvePsScript(options.psScript);
  const spawnImpl = options.spawnImpl || nodeSpawn;
  const env = { ...process.env, ...(options.env || {}) };
  const timeoutGraceMs = options.timeoutGraceMs === undefined ? 15000 : options.timeoutGraceMs;
  const maxRuntimeMs = options.maxRuntimeMs === undefined
    ? (config.follow ? 0 : config.timeoutMs + timeoutGraceMs)
    : options.maxRuntimeMs;

  if (!fs.existsSync(psScript)) {
    return Promise.reject(new CacError(`PowerShell helper script not found: ${psScript}`, {
      code: 'ps_script_missing',
      hint: 'Reinstall the package or pass --ps-script with a valid path.'
    }));
  }

  let configFile;
  try {
    configFile = writeConfigFile(config, { tempRoot: options.tempRoot });
  } catch (error) {
    return Promise.reject(new CacError(`Unable to write the PowerShell configuration file: ${error.message}`, {
      code: 'ps_config_failed'
    }));
  }

  return new Promise((resolve, reject) => {
    const events = [];
    const parseErrors = [];
    let stderr = '';
    let settled = false;
    let watchdog = null;
    let child;

    const cleanup = () => {
      if (watchdog) clearTimeout(watchdog);
      safeRemoveDir(configFile.dir);
    };

    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };

    try {
      child = spawnImpl(psPath, [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', psScript,
        '-ConfigFile', configFile.file
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      });
    } catch (error) {
      finish(null, new CacError(`Unable to start PowerShell (${psPath}): ${error.message}`, {
        code: 'ps_spawn_failed',
        hint: 'Install Windows PowerShell 5.1 or pass --ps-path with the full path to powershell.exe.'
      }));
      return;
    }

    if (options.onSpawn) {
      try { options.onSpawn(child); } catch { /* ignore */ }
    }

    const stdoutReader = readline.createInterface({ input: child.stdout });
    const stderrReader = readline.createInterface({ input: child.stderr });

    stdoutReader.on('line', (line) => {
      const { events: parsedEvents, errors } = parseEventLines([line]);
      for (const parseError of errors) parseErrors.push(parseError);
      for (const event of parsedEvents) {
        events.push(event);
        if (options.onEvent) {
          try { options.onEvent(event); } catch { /* observer errors must not break the watcher */ }
        }
      }
    });

    stderrReader.on('line', (line) => {
      if (stderr.length < 64 * 1024) stderr += `${line}\n`;
      if (options.onStderr) {
        try { options.onStderr(line); } catch { /* ignore */ }
      }
    });

    child.on('error', (error) => {
      finish(null, new CacError(`PowerShell failed to start: ${error.message}`, {
        code: 'ps_spawn_failed',
        hint: 'Check --ps-path and Windows execution policy.'
      }));
    });

    child.on('close', (code, signal) => {
      finish({
        exitCode: code === null ? 3 : code,
        signal,
        events,
        parseErrors,
        stderr,
        timedOut: false,
        config: configFile.file
      });
    });

    if (maxRuntimeMs > 0) {
      watchdog = setTimeout(async () => {
        if (settled) return;
        await killProcessTree(child.pid);
        finish({
          exitCode: 3,
          signal: 'SIGKILL',
          events,
          parseErrors,
          stderr,
          timedOut: true,
          config: configFile.file
        });
      }, maxRuntimeMs);
    }
  });
}

const MESSAGES = {
  clicked: '成功点击「允许」按钮',
  would_click: '检测到「允许」按钮（dry-run，未点击）',
  timeout: '未检测到弹窗（超时）',
  no_chrome: 'Chrome 未运行',
  permission_denied: '权限不足，无法读取 Chrome 弹窗',
  error: '检测异常'
};

function lastEvent(events, name) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].event === name) return events[index];
  }
  return null;
}

function mapWatcherResult(result, options = {}) {
  const events = result.events || [];
  const clicked = lastEvent(events, 'clicked');
  const wouldClick = lastEvent(events, 'would_click');
  const permission = lastEvent(events, 'permission_denied');
  const errorEvent = lastEvent(events, 'error');
  const noChrome = lastEvent(events, 'no_chrome');
  const timeout = lastEvent(events, 'timeout');

  let kind;
  if (clicked) kind = 'clicked';
  else if (wouldClick) kind = 'would_click';
  else if (permission) kind = 'permission_denied';
  else if (errorEvent) kind = 'error';
  else if (noChrome) kind = 'no_chrome';
  else if (timeout) kind = 'timeout';
  else if (result.timedOut) kind = 'error';
  else kind = 'error';

  const event = clicked || wouldClick || permission || errorEvent || noChrome || timeout;
  const exitCodes = {
    clicked: 0,
    would_click: 0,
    timeout: 1,
    no_chrome: 2,
    permission_denied: 3,
    error: 3
  };

  // PowerShell event messages are English diagnostics. Keep the CLI summary
  // localized and expose the raw text as detail instead.
  const localized = ['clicked', 'would_click'].includes(kind)
    ? (event && event.message) || MESSAGES[kind]
    : MESSAGES[kind] || MESSAGES.error;

  const output = {
    status: ['timeout'].includes(kind) ? 'ok' : (kind === 'clicked' || kind === 'would_click' ? 'ok' : 'error'),
    result: kind,
    message: localized,
    exitCode: exitCodes[kind],
    dryRun: Boolean(options.dryRun),
    psExitCode: result.exitCode,
    timedOut: Boolean(result.timedOut)
  };

  if (event && event.message && event.message !== localized) output.detail = event.message;
  if (event && event.candidate) output.candidate = event.candidate;
  if (event && event.candidates) output.candidates = event.candidates;
  if (event && event.elapsedMs !== undefined) output.elapsedMs = event.elapsedMs;
  if (event && event.hint) output.hint = event.hint;
  if (event && event.code) output.code = event.code;
  if (errorEvent && result.stderr) output.stderr = result.stderr.trim();
  if (result.parseErrors && result.parseErrors.length > 0 && options.debug) {
    output.parseErrors = result.parseErrors;
  }

  return output;
}

function runOnce(options, deps = {}) {
  const config = buildPsConfig(options, { follow: false, probe: false });
  return runWatcher(config, {
    psPath: options.psPath,
    psScript: options.psScript,
    ...deps
  }).then((result) => mapWatcherResult(result, { dryRun: options.dryRun, debug: options.logLevel === 'debug' }));
}

function runProbe(options, deps = {}) {
  const config = buildPsConfig(options, { follow: false, probe: true });
  return runWatcher(config, {
    psPath: options.psPath,
    psScript: options.psScript,
    timeoutGraceMs: deps.timeoutGraceMs || 15000,
    ...deps
  }).then((result) => {
    const probe = lastEvent(result.events, 'probe');
    const errorEvent = lastEvent(result.events, 'error') || lastEvent(result.events, 'permission_denied');
    if (probe) {
      return { ok: true, ...probe, psExitCode: result.exitCode };
    }
    return {
      ok: false,
      error: errorEvent ? errorEvent.message : 'UI Automation probe returned no result',
      code: errorEvent && errorEvent.code,
      hint: errorEvent && errorEvent.hint,
      psExitCode: result.exitCode,
      stderr: result.stderr.trim()
    };
  });
}

function runFollow(options, deps = {}) {
  const config = buildPsConfig(options, { follow: true, probe: false });
  return runWatcher(config, {
    psPath: options.psPath,
    psScript: options.psScript,
    ...deps
  });
}

module.exports = {
  DEFAULT_PS_SCRIPT,
  MESSAGES,
  resolvePsPath,
  resolvePsScript,
  buildPsConfig,
  writeConfigFile,
  safeRemoveDir,
  parseEventLines,
  killProcessTree,
  runWatcher,
  mapWatcherResult,
  runOnce,
  runProbe,
  runFollow
};