'use strict';

const fs = require('fs');
const path = require('path');

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonLine(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '未知';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function yesNo(value) {
  return value ? '是' : '否';
}

function renderStatus(report) {
  const lines = [];
  lines.push(`${report.app} ${report.version} (${report.platform}, Node ${report.node})`);
  lines.push('');

  const daemon = report.daemon || {};
  if (daemon.running) {
    lines.push(`守护进程: 运行中 (PID ${daemon.pid})`);
    if (daemon.record && daemon.record.startedAt) {
      lines.push(`  启动时间: ${daemon.record.startedAt}`);
    }
    if (daemon.record && daemon.record.dryRun) lines.push('  模式: dry-run（不会点击）');
    lines.push(`  PID 文件: ${daemon.pidFile}`);
    lines.push(`  日志文件: ${daemon.logFile}`);
  } else if (daemon.stale) {
    lines.push(`守护进程: 未运行（发现陈旧的 PID 文件: ${daemon.pidFile}）`);
  } else {
    lines.push('守护进程: 未运行');
  }
  if (daemon.lastEvent) {
    lines.push(`  最近事件: ${daemon.lastEvent.event}${daemon.lastEvent.ts ? ` @ ${daemon.lastEvent.ts}` : ''}`);
  }

  const allow = report.allow || {};
  if (allow.running) {
    lines.push(`一次性监听: 运行中 (PID ${allow.pid})`);
  } else if (allow.stale) {
    lines.push('一次性监听: 未运行（发现陈旧 PID 文件）');
  } else {
    lines.push('一次性监听: 未运行');
  }

  const chrome = report.chrome || {};
  if (chrome.error) {
    lines.push(`Chrome 进程: 查询失败 (${chrome.error})`);
  } else if (chrome.running) {
    const pids = (chrome.processes || []).map((item) => item.pid).join(', ');
    lines.push(`Chrome 进程: 运行中（${chrome.count} 个进程: ${pids}）`);
  } else {
    lines.push('Chrome 进程: 未运行');
  }

  const endpoint = report.endpoint || {};
  if (endpoint.available) {
    lines.push(`DevTools 端点: 可用 (${endpoint.wsEndpoint})`);
    lines.push(`  端口文件: ${endpoint.path}`);
  } else if (endpoint.exists) {
    lines.push(`DevTools 端点: 不可用 (${endpoint.reason || 'unknown'})`);
    lines.push(`  端口文件: ${endpoint.path}`);
    if (endpoint.error) lines.push(`  错误: ${endpoint.error}`);
  } else {
    lines.push(`DevTools 端点: 未找到 (${endpoint.path || 'DevToolsActivePort'})`);
  }

  const powershell = report.powershell || {};
  if (powershell.available) {
    lines.push(`PowerShell: ${powershell.path}${powershell.flavor ? ` (${powershell.flavor})` : ''}`);
    if (powershell.warning) lines.push(`  注意: ${powershell.warning}`);
  } else {
    lines.push('PowerShell: 不可用（Windows PowerShell 5.1 是必需的）');
  }

  const uia = report.uia || {};
  if (uia.ok) {
    if (!uia.chromeRunning) {
      lines.push('UI Automation: 可用（Chrome 未运行）');
    } else if (uia.selected) {
      lines.push(`UI Automation: 检测到确认弹窗（按钮: ${uia.selected.name}，窗口: ${uia.selected.dialogName || '未知'}）`);
    } else if (uia.candidateCount > 0) {
      lines.push(`UI Automation: 发现 ${uia.candidateCount} 个疑似按钮，但未匹配到 Chrome 远程调试弹窗`);
    } else {
      lines.push('UI Automation: 可用（当前无确认弹窗）');
    }
    if (uia.permissionIssues > 0) {
      lines.push(`  权限问题: ${uia.permissionIssues} 个窗口无法读取（请检查是否以管理员身份运行 Chrome）`);
    }
  } else if (uia.error) {
    lines.push(`UI Automation: 不可用 (${uia.error})`);
  }

  const devtools = report.devtools || {};
  if (devtools.available) {
    lines.push(`chrome-devtools CLI: ${devtools.path}`);
  } else {
    lines.push('chrome-devtools CLI: 未安装（可选）');
    if (devtools.install) lines.push(`  安装: ${devtools.install}`);
  }

  const pages = report.pages || {};
  if (pages.checked) {
    if (pages.ok) {
      lines.push(`页面检查: ${pages.pageCount} 个页面，${pages.problemCount || 0} 个可能阻塞的页面`);
    } else {
      lines.push(`页面检查: 失败 (${pages.error})`);
    }
  } else if (pages.reason) {
    lines.push(`页面检查: 已跳过 (${pages.reason})`);
  }

  return lines.join('\n');
}

function renderOnceResult(result) {
  const lines = [result.message];
  if (result.candidate) {
    const parts = [];
    if (result.candidate.name) parts.push(`按钮: ${result.candidate.name}`);
    if (result.candidate.dialogName) parts.push(`窗口: ${result.candidate.dialogName}`);
    if (result.candidate.processId) parts.push(`PID: ${result.candidate.processId}`);
    if (parts.length > 0) lines.push(`  ${parts.join('，')}`);
  }
  if (result.elapsedMs !== undefined) lines.push(`  耗时: ${formatDuration(result.elapsedMs)}`);
  if (result.dryRun) lines.push('  dry-run: 未实际点击');
  if (result.detail) lines.push(`  详情: ${result.detail}`);
  if (result.hint) lines.push(`  提示: ${result.hint}`);
  if (result.code) lines.push(`  错误代码: ${result.code}`);
  if (result.stderr) lines.push(`  PowerShell stderr: ${result.stderr}`);
  return lines.join('\n');
}

function renderStopResult(result) {
  const lines = [];
  const stopped = result.stopped || [];
  const wouldStop = result.wouldStop || [];
  const stale = result.stale || [];
  const ignored = result.ignored || [];
  const failed = result.failed || [];

  if (wouldStop.length > 0) {
    lines.push(`dry-run: 将停止 ${wouldStop.map((item) => `${item.kind} (PID ${item.pid})`).join(', ')}`);
  }
  if (stopped.length > 0) {
    lines.push(`已停止: ${stopped.map((item) => `${item.kind} (PID ${item.pid})`).join(', ')}`);
  }
  if (stale.length > 0) {
    lines.push(`已清理陈旧 PID 文件: ${stale.join(', ')}`);
  }
  if (ignored.length > 0) {
    lines.push(`跳过（PID 文件不属于 chrome-auto-connect-win）: ${ignored.map((item) => `${item.kind} (PID ${item.pid})`).join(', ')}`);
  }
  if (failed.length > 0) {
    lines.push(`停止失败: ${failed.map((item) => `${item.kind} (PID ${item.pid}): ${item.reason}`).join('; ')}`);
  }
  if (lines.length === 0) {
    return '未发现运行中的 chrome-auto-connect-win 进程。';
  }
  return lines.join('\n');
}

function renderStartResult(result) {
  const lines = [`守护进程已启动 (PID ${result.daemon.pid})`];
  lines.push(`  PID 文件: ${result.daemon.pidFile}`);
  lines.push(`  日志文件: ${result.daemon.logFile}`);
  if (result.foreground) lines.push('  前台模式：按 Ctrl+C 停止');
  if (result.connect) {
    if (result.connect.ok) {
      lines.push('chrome-devtools 已连接并成功列出页面。');
      if (result.connect.listPages && result.connect.listPages.stdout.trim()) {
        lines.push(result.connect.listPages.stdout.trim());
      }
    } else {
      lines.push(`警告: chrome-devtools 连接失败 (${result.connect.stage || 'unknown'})`);
      if (result.connect.error) lines.push(`  ${result.connect.error}`);
      if (result.connect.hint) lines.push(`  提示: ${result.connect.hint}`);
    }
  } else {
    lines.push(`提示: 使用 "chrome-auto-connect-win status" 查看状态，使用 "chrome-auto-connect-win stop" 停止。`);
  }
  return lines.join('\n');
}

function renderPagesProblems(pages) {
  if (!pages || !pages.problems || pages.problems.length === 0) return '';
  return pages.problems
    .map((item) => `- ${item.title} ${item.url}: ${item.issue}`)
    .join('\n');
}

function renderConnectResult(result) {
  if (!result.ok) {
    const lines = [`连接失败 (${result.stage || 'unknown'}): ${result.error || '未知错误'}`];
    if (result.hint) lines.push(`提示: ${result.hint}`);
    if (result.start && result.start.stderr.trim()) lines.push(result.start.stderr.trim());
    if (result.listPages && result.listPages.stderr.trim()) lines.push(result.listPages.stderr.trim());
    return lines.join('\n');
  }
  const lines = [`已连接: ${result.endpoint.wsEndpoint}`];
  if (result.pages && result.pages.checked) {
    lines.push(`页面检查: ${result.pages.pageCount} 个页面，${result.pages.problemCount || 0} 个可能阻塞的页面`);
    const problems = renderPagesProblems(result.pages);
    if (problems) lines.push(problems);
  }
  if (result.listPages && result.listPages.stdout.trim()) {
    lines.push(result.listPages.stdout.trim());
  }
  return lines.join('\n');
}

module.exports = {
  writeJson,
  appendJsonLine,
  formatDuration,
  yesNo,
  renderStatus,
  renderOnceResult,
  renderStopResult,
  renderStartResult,
  renderConnectResult
};