'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/lib/logger');

function captureStream() {
  const chunks = [];
  return {
    isTTY: false,
    chunks,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    text() {
      return chunks.join('');
    }
  };
}

test('logger filters by level and writes to the supplied stream', () => {
  const stream = captureStream();
  const logger = createLogger({ level: 'warn', stream, color: false });
  logger.debug('hidden');
  logger.info('hidden');
  logger.warn('visible');
  logger.error('visible too');
  const text = stream.text();
  assert.doesNotMatch(text, /hidden/);
  assert.match(text, /\[WARN\] visible/);
  assert.match(text, /\[ERROR\] visible too/);
});

test('logger emits JSON records with scope and data', () => {
  const stream = captureStream();
  const logger = createLogger({ level: 'debug', stream, color: false, json: true }).child('watcher');
  logger.info('clicked', { button: '允许' });
  const record = JSON.parse(stream.text().trim());
  assert.equal(record.level, 'info');
  assert.equal(record.message, 'clicked');
  assert.equal(record.scope, 'watcher');
  assert.equal(record.button, '允许');
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('silent logger suppresses everything', () => {
  const stream = captureStream();
  const logger = createLogger({ level: 'silent', stream, color: false });
  logger.error('nope');
  assert.equal(stream.text(), '');
});