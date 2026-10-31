'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyPage,
  checkPages
} = require('../src/lib/pages');

const ENDPOINT = 'ws://127.0.0.1:9222/devtools/browser/test';

function makeSocketClass(behavior) {
  const instances = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.closed = false;
      instances.push(this);
      setTimeout(() => {
        if (behavior.open !== false && this.onopen) this.onopen();
        if (behavior.error && this.onerror) this.onerror(new Error('boom'));
        if (behavior.close && this.onclose) this.onclose();
      }, 0);
    }

    send(raw) {
      if (behavior.send) behavior.send(this, JSON.parse(raw));
    }

    close() {
      this.closed = true;
    }
  }
  return { FakeSocket, instances };
}

function targetInfos() {
  return [
    { type: 'page', url: 'https://example.com/', title: 'Example' },
    { type: 'page', url: 'chrome://inspect/', title: 'Inspect' },
    { type: 'page', url: 'file:///C:/tmp/a.html', title: 'Local' },
    { type: 'service_worker', url: 'chrome-extension://abc/worker.js', title: 'SW' }
  ];
}

test('classifies pages that may block list_pages', () => {
  assert.equal(classifyPage('https://example.com/'), null);
  assert.match(classifyPage('chrome://inspect/'), /Chrome 内部页面/);
  assert.match(classifyPage('chrome-extension://abc/page.html'), /Chrome 内部页面/);
  assert.match(classifyPage('devtools://devtools/bundled/inspector.html'), /DevTools/);
  assert.match(classifyPage('data:text/html,hi'), /数据 URL/);
  assert.match(classifyPage('about:blank'), /关于页面/);
  assert.match(classifyPage('file:///C:/tmp/a.html'), /本地文件/);
  assert.match(classifyPage('blob:https://example.com/x'), /Blob/);
});

test('checkPages returns target counts and problem pages', async () => {
  const { FakeSocket, instances } = makeSocketClass({
    send(socket, message) {
      socket.onmessage({
        data: JSON.stringify({ id: message.id, result: { targetInfos: targetInfos() } })
      });
    }
  });

  const result = await checkPages(ENDPOINT, { WebSocketImpl: FakeSocket, timeoutMs: 500 });
  assert.equal(result.targetCount, 4);
  assert.equal(result.pageCount, 3);
  assert.equal(result.problems.length, 2);
  assert.deepEqual(result.problems.map((item) => item.url), [
    'chrome://inspect/',
    'file:///C:/tmp/a.html'
  ]);
  assert.equal(instances[0].closed, true);
});

test('checkPages rejects an invalid CDP response', async () => {
  const { FakeSocket } = makeSocketClass({
    send(socket, message) {
      socket.onmessage({ data: JSON.stringify({ id: message.id, result: {} }) });
    }
  });
  await assert.rejects(
    checkPages(ENDPOINT, { WebSocketImpl: FakeSocket, timeoutMs: 500 }),
    /Invalid CDP Target.getTargets response/
  );
});

test('checkPages times out and closes the socket', async () => {
  const { FakeSocket, instances } = makeSocketClass({ send() {} });
  await assert.rejects(
    checkPages(ENDPOINT, { WebSocketImpl: FakeSocket, timeoutMs: 30 }),
    (error) => error.code === 'ws_timeout'
  );
  assert.equal(instances[0].closed, true);
});

test('checkPages reports socket errors and early closes', async () => {
  const errored = makeSocketClass({ error: true });
  await assert.rejects(
    checkPages(ENDPOINT, { WebSocketImpl: errored.FakeSocket, timeoutMs: 500 }),
    (error) => error.code === 'ws_error'
  );

  const closed = makeSocketClass({ close: true });
  await assert.rejects(
    checkPages(ENDPOINT, { WebSocketImpl: closed.FakeSocket, timeoutMs: 500 }),
    (error) => error.code === 'ws_closed'
  );
});

test('checkPages requires a WebSocket implementation', async () => {
  await assert.rejects(
    checkPages(ENDPOINT, { WebSocketImpl: 'missing', timeoutMs: 100 }),
    (error) => error.code === 'websocket_unavailable'
  );
});