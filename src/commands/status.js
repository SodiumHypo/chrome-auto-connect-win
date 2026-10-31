'use strict';

const {
  APP_NAME,
  VERSION
} = require('../lib/defaults');
const { inspectPidFile } = require('../lib/pidfile');
const {
  listProcesses,
  inspectEndpoint,
  checkPowerShell,
  checkDevtoolsCli
} = require('../lib/chrome');
const { checkPages } = require('../lib/pages');
const { runProbe } = require('../lib/uia');
const { readLastJsonLine } = require('../lib/logtail');

function safeErrorMessage(error) {
  return error && error.message ? error.message : String(error);
}

async function runStatus(options, deps = {}) {
  const inspectPid = deps.inspectPidFile || inspectPidFile;
  const list = deps.listProcesses || listProcesses;
  const inspectEp = deps.inspectEndpoint || inspectEndpoint;
  const psCheck = deps.checkPowerShell || checkPowerShell;
  const devtoolsCheck = deps.checkDevtoolsCli || checkDevtoolsCli;
  const probe = deps.runProbe || runProbe;
  const pageCheck = deps.checkPages || checkPages;
  const lastLine = deps.readLastJsonLine || readLastJsonLine;

  const daemonInspect = inspectPid(options.pidFile);
  const allowInspect = inspectPid(options.allowPidFile);

  const report = {
    status: 'ok',
    app: APP_NAME,
    version: VERSION,
    platform: process.platform,
    node: process.version,
    daemon: {
      running: daemonInspect.alive,
      stale: daemonInspect.stale,
      pid: daemonInspect.record ? daemonInspect.record.pid : null,
      record: daemonInspect.record,
      pidFile: options.pidFile,
      logFile: options.logFile,
      lastEvent: lastLine(options.logFile)
    },
    allow: {
      running: allowInspect.alive,
      stale: allowInspect.stale,
      pid: allowInspect.record ? allowInspect.record.pid : null,
      record: allowInspect.record,
      pidFile: options.allowPidFile
    }
  };

  const [chromeResult, endpointResult, psResult, devtoolsResult, probeResult] = await Promise.all([
    list(options.processNames).then(
      (processes) => ({ ok: true, processes }),
      (error) => ({ ok: false, error })
    ),
    inspectEp({
      portFile: options.portFile,
      userDataDir: options.userDataDir,
      timeoutMs: 1500
    }).then(
      (endpoint) => ({ ok: true, endpoint }),
      (error) => ({ ok: false, error })
    ),
    psCheck(options.psPath).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    ),
    devtoolsCheck(options.devtoolsCommand).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    ),
    probe(options).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    )
  ]);

  if (chromeResult.ok) {
    const processes = chromeResult.processes;
    report.chrome = {
      running: processes.length > 0,
      count: processes.length,
      processes: processes.map((item) => ({ name: item.name, pid: item.pid }))
    };
  } else {
    report.chrome = {
      running: false,
      count: 0,
      processes: [],
      error: safeErrorMessage(chromeResult.error),
      code: chromeResult.error && chromeResult.error.code
    };
  }

  if (endpointResult.ok) {
    report.endpoint = endpointResult.endpoint;
  } else {
    report.endpoint = {
      exists: false,
      available: false,
      path: options.portFile,
      reason: 'error',
      error: safeErrorMessage(endpointResult.error)
    };
  }

  if (psResult.ok) {
    report.powershell = psResult.value;
  } else {
    report.powershell = {
      available: false,
      path: options.psPath || null,
      error: safeErrorMessage(psResult.error)
    };
  }

  if (devtoolsResult.ok) {
    report.devtools = devtoolsResult.value;
  } else {
    report.devtools = {
      available: false,
      path: null,
      error: safeErrorMessage(devtoolsResult.error)
    };
  }

  if (probeResult.ok) {
    const value = probeResult.value;
    if (value.ok) {
      report.uia = {
        ...value,
        candidateCount: Array.isArray(value.candidates) ? value.candidates.length : 0
      };
      if (!options.probe && report.uia.candidates) {
        report.uia.candidates = undefined;
      }
    } else {
      report.uia = {
        ok: false,
        error: value.error,
        code: value.code,
        hint: value.hint
      };
    }
  } else {
    report.uia = {
      ok: false,
      error: safeErrorMessage(probeResult.error),
      code: probeResult.error && probeResult.error.code,
      hint: probeResult.error && probeResult.error.hint
    };
  }

  if (!options.noPageCheck && report.endpoint.available) {
    try {
      const pages = await pageCheck(report.endpoint.wsEndpoint, { timeoutMs: 5000 });
      report.pages = {
        checked: true,
        ok: true,
        targetCount: pages.targetCount,
        pageCount: pages.pageCount,
        problemCount: pages.problems.length,
        problems: pages.problems
      };
    } catch (error) {
      report.pages = {
        checked: true,
        ok: false,
        error: safeErrorMessage(error),
        code: error && error.code,
        hint: error && error.hint
      };
    }
  } else {
    report.pages = {
      checked: false,
      reason: options.noPageCheck ? '--no-page-check' : 'endpoint_unavailable'
    };
  }

  return { exitCode: 0, report };
}

module.exports = {
  runStatus
};