import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENT_TYPE, handleMailWatch, validateGraphDeltaUrl } from '../dist/js/mail-watch.js';

const INITIAL = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,receivedDateTime,from&$top=10';

class FixtureBroker {
  constructor(documents) {
    this.documents = [...documents];
    this.requests = [];
    this.cancelled = [];
    this.dropped = [];
    this.nextHandle = 1;
  }

  httpStart(request) {
    this.requests.push(request);
    const document = this.documents.shift();
    if (document instanceof Error) throw document;
    const handle = this.nextHandle++;
    this.active ??= new Map();
    this.active.set(handle, { bytes: new TextEncoder().encode(JSON.stringify(document)), offset: 0 });
    return { ok: true, value: handle };
  }

  httpStatus(handle) { return this.active.has(handle) ? { ok: true, value: 200 } : { ok: false, error: 'missing' }; }
  httpResponseHeaders() { return { ok: true, value: [{ name: 'content-type', value: 'application/json' }] }; }
  httpRead(handle, maxBytes) {
    const row = this.active.get(handle);
    if (!row) return { ok: false, error: 'missing' };
    if (row.offset === row.bytes.length) return { ok: true, value: undefined };
    const bytes = row.bytes.slice(row.offset, row.offset + maxBytes);
    row.offset += bytes.length;
    return { ok: true, value: bytes };
  }
  httpCancel(handle) { this.cancelled.push(handle); }
  httpDrop(handle) { this.dropped.push(handle); this.active.delete(handle); }
}

const state = { get() { return undefined; }, set() {}, list() { return []; }, delete() { return false; } };
function request(operation, checkpoint, extra = {}) {
  return {
    kind: 'backgroundServices', contributionId: 'mail-watch',
    configuration: { maxPagesPerWake: 5 },
    input: { operation, checkpoint },
    context: { resourceHandles: { oauth: 'secret-slot-lease' } },
    ...extra,
  };
}

test('initial sync advances delta cursor without emitting historical messages', () => {
  const broker = new FixtureBroker([{ value: [{ id: 'old', receivedDateTime: '2026-01-01T00:00:00Z' }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?token=seed' }]);
  const result = handleMailWatch(request('initialize', null), broker, state);
  assert.equal(result.checkpoint.initialized, true);
  assert.deepEqual(result.events, []);
  assert.equal(broker.requests[0].url, INITIAL);
  assert.equal(broker.requests[0].method, 'GET');
  assert.equal(broker.requests[0].secretHandle, 'oauth');
  assert.equal(broker.requests[0].body, undefined);
  assert.deepEqual(broker.dropped, [1]);
});

test('poll follows bounded delta pages and emits metadata with repeatable keys', () => {
  const msg = { id: 'AAMkAGI1', receivedDateTime: '2026-10-01T10:00:00Z', from: { emailAddress: { address: 'sender@example.test' } }, body: { content: 'must not be emitted' } };
  const next = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=opaque';
  const delta = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque';
  const broker = new FixtureBroker([{ value: [msg], '@odata.nextLink': next }, { value: [msg], '@odata.deltaLink': delta }]);
  const checkpoint = { initialized: true, deltaUrl: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=prior' };
  const result = handleMailWatch(request('wake', checkpoint), broker, state);
  assert.equal(result.checkpoint.deltaUrl, delta);
  assert.deepEqual(broker.requests.map(row => row.url), [checkpoint.deltaUrl, next]);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].type, EVENT_TYPE);
  assert.equal(result.events[0].idempotencyKey, result.events[1].idempotencyKey);
  assert.deepEqual(result.events[0].payload, { messageId: 'AAMkAGI1', receivedAt: '2026-10-01T10:00:00Z', sender: 'sender@example.test' });
  assert.equal(JSON.stringify(result.events).includes('must not be emitted'), false);
  assert.equal(result.events[0].schemaVersion, undefined);
  assert.equal(result.events[0].subject, undefined);
});

test('partial initial sync persists its opaque next link and emits no old mail', () => {
  const next = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=opaque';
  const broker = new FixtureBroker([{ value: [{ id: 'old', receivedDateTime: '2026-01-01T00:00:00Z' }], '@odata.nextLink': next }]);
  const result = handleMailWatch(request('initialize', null, { configuration: { maxPagesPerWake: 1 } }), broker, state);
  assert.equal(result.checkpoint.initializing, true);
  assert.equal(result.checkpoint.pendingUrl, next);
  assert.deepEqual(result.events, []);
});

test('delta cursors cannot change Graph host, scheme, path, or credentials', () => {
  for (const value of [
    'http://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta',
    'https://evil.example/v1.0/me/mailFolders/inbox/messages/delta',
    'https://graph.microsoft.com.evil.example/v1.0/me/mailFolders/inbox/messages/delta',
    'https://user@graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta',
    'https://graph.microsoft.com/v1.0/me/messages',
    'https://graph.microsoft.com:444/v1.0/me/mailFolders/inbox/messages/delta',
  ]) assert.throws(() => validateGraphDeltaUrl(value));
});

test('an unsafe next link is rejected before a second broker request', () => {
  const broker = new FixtureBroker([{ value: [], '@odata.nextLink': 'https://evil.example/v1.0/me/mailFolders/inbox/messages/delta' }]);
  assert.throws(() => handleMailWatch(request('wake', { initialized: true, deltaUrl: INITIAL }), broker, state));
  assert.equal(broker.requests.length, 1);
  assert.deepEqual(broker.dropped, [1]);
});

test('lifecycle health and stop do not acquire Graph credentials', () => {
  for (const operation of ['health', 'stop']) {
    const result = handleMailWatch({ kind: 'backgroundServices', contributionId: 'mail-watch', input: { operation } }, new FixtureBroker([]), state);
    assert.equal(result.health, 'healthy');
    assert.deepEqual(result.events, []);
  }
});
