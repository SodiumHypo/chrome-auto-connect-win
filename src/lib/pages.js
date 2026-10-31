'use strict';

const { CacError } = require('./errors');

const PROBLEM_RULES = [
  {
    prefixes: ['chrome://', 'chrome-extension://'],
    issue: 'Chrome 内部页面，可能导致 list_pages 卡住'
  },
  { prefixes: ['devtools://'], issue: 'DevTools 页面，可能导致 list_pages 卡住' },
  { prefixes: ['data:'], issue: '数据 URL 页面，可能导致 list_pages 卡住' },
  { prefixes: ['about:'], issue: '关于页面，可能导致 list_pages 卡住' },
  { prefixes: ['file://'], issue: '本地文件页面，可能导致 list_pages 卡住' },
  { prefixes: ['blob:'], issue: 'Blob 页面，可能导致 list_pages 卡住' }
];

function classifyPage(url) {
  const value = String(url || '');
  for (const rule of PROBLEM_RULES) {
    if (rule.prefixes.some((prefix) => value.startsWith(prefix))) {
      return rule.issue;
    }
  }
  return null;
}

function checkPages(wsEndpoint, options = {}) {
  const timeoutMs = options.timeoutMs === undefined ? 10000 : options.timeoutMs;
  const WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;

  if (typeof WebSocketImpl !== 'function') {
    return Promise.reject(new CacError('This Node.js runtime does not provide a WebSocket client', {
      code: 'websocket_unavailable',
      hint: 'Use Node.js >= 22 (the built-in WebSocket client is required).'
    }));
  }

  return new Promise((resolve, reject) => {
    let socket;
    let timer;
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      if (error) reject(error);
      else resolve(result);
    };

    try {
      socket = new WebSocketImpl(wsEndpoint);
    } catch (error) {
      finish(new CacError(`Unable to create WebSocket: ${error.message}`, { code: 'ws_error' }));
      return;
    }

    timer = setTimeout(() => {
      finish(new CacError('CDP page check timed out', {
        code: 'ws_timeout',
        hint: 'If the "Allow remote debugging?" dialog is visible, run "chrome-auto-connect-win once" or keep the watcher running.'
      }));
    }, timeoutMs);

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
      } catch (error) {
        finish(new CacError(`Unable to send CDP command: ${error.message}`, { code: 'ws_error' }));
      }
    };

    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch (error) {
        finish(new CacError(`Invalid CDP response: ${error.message}`, { code: 'invalid_cdp_response' }));
        return;
      }

      if (message.id !== 1) return;

      if (!message.result || !Array.isArray(message.result.targetInfos)) {
        finish(new CacError('Invalid CDP Target.getTargets response', {
          code: 'invalid_cdp_response',
          details: message
        }));
        return;
      }

      const targets = message.result.targetInfos;
      const pages = targets.filter((target) => target && target.type === 'page');
      const problems = [];

      for (const page of pages) {
        const url = page.url || '';
        const issue = classifyPage(url);
        if (issue) {
          problems.push({
            url,
            title: page.title || '无标题',
            issue
          });
        }
      }

      finish(null, {
        targetCount: targets.length,
        pageCount: pages.length,
        problems
      });
    };

    socket.onerror = () => {
      finish(new CacError(`WebSocket connection failed: ${wsEndpoint}`, {
        code: 'ws_error',
        hint: 'Check that Chrome is running and that DevToolsActivePort points to a live debugging port.'
      }));
    };

    socket.onclose = () => {
      if (!settled) {
        finish(new CacError('WebSocket closed before Target.getTargets returned', {
          code: 'ws_closed'
        }));
      }
    };
  });
}

module.exports = {
  PROBLEM_RULES,
  classifyPage,
  checkPages
};