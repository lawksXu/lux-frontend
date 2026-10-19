import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMessage, restoreMessage, getPendingMessage, savePendingMessage, completePendingMessage } from '../src/chat/message.ts';

test('builds one immutable accepted-message request while preserving original whitespace', () => {
  const input = buildMessage(' Hello\n ', ['asset'], 'original-id');
  assert.deepEqual(input, { client_request_id: 'original-id', content: [{ type: 'text', text: ' Hello\n ' }, { type: 'asset', asset_id: 'asset' }] });
  assert.deepEqual(restoreMessage(JSON.stringify(input)), input);
});
test('allows attachment-only input and rejects empty or oversized input', () => {
  assert.equal(buildMessage(' ', ['asset'], 'id').content.length, 1);
  assert.throws(() => buildMessage(' ', [], 'id'), /message|attachment/i);
  assert.throws(() => buildMessage('x'.repeat(64001), [], 'id'), /64,000/);
  assert.throws(() => buildMessage('text', Array(64).fill('asset'), 'id'), /64/);
});
test('restores original identity and body, rejects malformed browser storage', () => {
  assert.equal(restoreMessage('{"client_request_id":"original","content":[{"type":"text","text":"hello"}]}')?.client_request_id, 'original');
  assert.equal(restoreMessage('broken JSON'), null);
  assert.equal(restoreMessage('{"client_request_id":"id","content":[{"type":"unknown"}]}'), null);
  assert.equal(restoreMessage('{"client_request_id":"id","content":[{"type":"text","text":" "}]}'), null);
});

test('a late response for message A cannot erase the original identity of newer pending message B', () => {
  const first = buildMessage('A', [], 'first-id');
  const second = buildMessage('B', [], 'second-id');
  savePendingMessage('scope', first, null);
  completePendingMessage('scope', first.client_request_id, null);
  savePendingMessage('scope', second, null);
  completePendingMessage('scope', first.client_request_id, null);
  assert.deepEqual(getPendingMessage('scope', null), second);
  completePendingMessage('scope', second.client_request_id, null);
  assert.equal(getPendingMessage('scope', null), null);
});
