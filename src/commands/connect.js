'use strict';

const { inspectEndpoint } = require('../lib/chrome');
const { checkPages } = require('../lib/pages');
const { connectAndList } = require('../lib/devtools');

async function runConnect(options, deps = {}) {
  const inspect = deps.inspectEndpoint || inspectEndpoint;
  const endpoint = await inspect({
    portFile: options.portFile,
    userDataDir: options.userDataDir,
    timeoutMs: 1500
  });

  if (!endpoint.available) {
    return {
      exitCode: 1,
      result: {
        ok: false,
        stage: 'endpoint',
        endpoint,
        error: endpoint.exists
          ? `DevTools 端点不可用: ${endpoint.reason || 'unknown'}`
          : `未找到 DevToolsActivePort: ${endpoint.path}`,
        hint: '打开 chrome://inspect/#remote-debugging 并启用远程调试，或使用 --remote-debugging-port 启动 Chrome。'
      }
    };
  }

  const pageResult = { checked: false, reason: '--no-page-check' };
  if (!options.noPageCheck) {
    const check = deps.checkPages || checkPages;
    try {
      const pages = await check(endpoint.wsEndpoint, { timeoutMs: 5000 });
      pageResult.checked = true;
      pageResult.ok = true;
      pageResult.targetCount = pages.targetCount;
      pageResult.pageCount = pages.pageCount;
      pageResult.problemCount = pages.problems.length;
      pageResult.problems = pages.problems;
    } catch (error) {
      pageResult.checked = true;
      pageResult.ok = false;
      pageResult.error = error.message;
      pageResult.code = error.code;
      pageResult.hint = error.hint;
    }
  }

  const connect = deps.connectAndList || connectAndList;
  let devtoolsResult;
  try {
    devtoolsResult = await connect(endpoint.wsEndpoint, {
      command: options.devtoolsCommand,
      capture: true,
      timeoutMs: options.connectTimeoutMs
    });
  } catch (error) {
    return {
      exitCode: 1,
      result: {
        ok: false,
        stage: 'spawn',
        endpoint,
        pages: pageResult,
        error: error.message,
        hint: error.hint
      }
    };
  }

  if (!devtoolsResult.ok) {
    const stage = devtoolsResult.stage;
    const failed = stage === 'start' ? devtoolsResult.start : devtoolsResult.listPages;
    const detail = failed && failed.stderr && failed.stderr.trim();
    return {
      exitCode: 1,
      result: {
        ok: false,
        stage,
        endpoint,
        pages: pageResult,
        start: devtoolsResult.start,
        listPages: devtoolsResult.listPages,
        error: failed && failed.timedOut
          ? `chrome-devtools ${stage === 'start' ? 'start' : 'list_pages'} 超时`
          : `chrome-devtools ${stage === 'start' ? 'start' : 'list_pages'} 失败 (退出码 ${failed ? failed.code : 'unknown'})`,
        detail: detail || undefined,
        hint: '确认 chrome-devtools-mcp 已安装，且 Chrome 的远程调试确认弹窗已被允许。'
      }
    };
  }

  return {
    exitCode: 0,
    result: {
      ok: true,
      stage: 'done',
      endpoint,
      pages: pageResult,
      start: devtoolsResult.start,
      listPages: devtoolsResult.listPages
    }
  };
}

module.exports = {
  runConnect
};