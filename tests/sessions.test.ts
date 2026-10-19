import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/api/client.ts';
import { loadSessions } from '../src/chat/sessions.ts';
import type { SessionRecord } from '../src/api/types.ts';

const remembered = '10000000-0000-0000-0000-000000000002';
const newest: SessionRecord = { id: '10000000-0000-0000-0000-000000000001', user_id: '00000000-0000-0000-0000-000000000001', title: 'Newest', next_item_seq: 1, version: 1, created_at: '2026-10-13T12:00:00Z', updated_at: '2026-10-13T12:00:00Z' };

test('restores an accessible remembered Session outside the latest list', async () => {
  const older = { ...newest, id: remembered, title: 'Older' };
  const result = await loadSessions({ sessions: async () => [newest], session: async id => { assert.equal(id, remembered); return older; } }, remembered);
  assert.equal(result.selectedId, remembered);
  assert.deepEqual(result.sessions, [older, newest]);
});
test('falls back for a missing remembered Session while preserving uncertain network errors', async () => {
  const source = { sessions: async () => [newest], session: async () => { throw new ApiError(404, 'NOT_FOUND', 'Missing'); } };
  assert.equal((await loadSessions(source, remembered)).selectedId, newest.id);
  await assert.rejects(loadSessions({ ...source, session: async () => { throw new Error('Network unavailable'); } }, remembered), /Network/);
});
test('never looks up remembered history after its owner request was aborted', async () => {
  const abort = new AbortController();
  abort.abort();
  let lookedUp = false;
  await assert.rejects(loadSessions({ sessions: async () => [newest], session: async () => { lookedUp = true; return newest; } }, remembered, abort.signal), /abort/i);
  assert.equal(lookedUp, false);
});
