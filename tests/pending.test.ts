import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completePendingControl, completePendingSessionMutation,
  getPendingControl, getPendingSessionMutation, savePendingControl, savePendingSessionMutation,
  type PendingControl, type PendingStorage, type SessionMutation,
} from '../src/chat/pending.ts';

const owner = '00000000-0000-0000-0000-000000000001';
const otherOwner = '00000000-0000-0000-0000-000000000002';
const session = '00000000-0000-0000-0000-000000000003';
const otherSession = '00000000-0000-0000-0000-000000000004';
const operation = '00000000-0000-0000-0000-000000000005';

class MemoryStorage implements PendingStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test('restores the original control action and key after navigation-style rereads', () => {
  const storage = new MemoryStorage();
  const request: PendingControl = { action: 'stop', key: operation };
  savePendingControl(owner, session, request, storage);
  assert.equal(storage.values.size, 1);
  assert.deepEqual(JSON.parse([...storage.values.values()][0]!), request);
  assert.deepEqual(getPendingControl(owner, session, storage), request);
  request.key = otherSession;
  assert.equal(getPendingControl(owner, session, storage)?.key, operation);
  savePendingControl(owner, session, null, storage);
});

test('persists exact create and rename bodies and identities without trimming titles', () => {
  const storage = new MemoryStorage();
  const create: SessionMutation = { type: 'create', title: ' Original title ', key: operation };
  savePendingSessionMutation(owner, create, storage);
  assert.deepEqual(getPendingSessionMutation(owner, storage), create);
  const rename: SessionMutation = { type: 'rename', title: ' Renamed title ', sessionId: session, key: operation };
  savePendingSessionMutation(owner, rename, storage);
  assert.deepEqual(getPendingSessionMutation(owner, storage), rename);
  assert.deepEqual(JSON.parse([...storage.values.values()][0]!), rename);
  savePendingSessionMutation(owner, null, storage);
});

test('isolates controls by owner and Session and Session mutations by owner', () => {
  const storage = new MemoryStorage();
  const request: PendingControl = { action: 'continue', key: operation };
  savePendingControl(owner, session, request, storage);
  assert.equal(getPendingControl(otherOwner, session, storage), null);
  assert.equal(getPendingControl(owner, otherSession, storage), null);
  savePendingSessionMutation(owner, { type: 'create', title: 'A', key: operation }, storage);
  assert.equal(getPendingSessionMutation(otherOwner, storage), null);
  assert.equal(storage.values.size, 2);
  savePendingControl(owner, session, null, storage);
  savePendingSessionMutation(owner, null, storage);
});

test('rejects malformed browser data rather than resurrecting a cached request', () => {
  const storage = new MemoryStorage();
  savePendingControl(owner, session, { action: 'stop', key: operation }, storage);
  assert.equal(getPendingControl(owner, session, storage)?.key, operation);
  const controlKey = [...storage.values.keys()][0]!;
  for (const raw of ['invalid JSON', 'null', '[]', JSON.stringify({ action: 'restart', key: operation }),
    JSON.stringify({ action: 'stop', key: 'short-id' }), JSON.stringify({ action: 'stop', key: operation, extra: true })]) {
    savePendingControl(owner, session, { action: 'stop', key: operation }, storage);
    storage.values.set(controlKey, raw);
    assert.equal(getPendingControl(owner, session, storage), null);
  }
  savePendingSessionMutation(owner, { type: 'create', title: 'A', key: operation }, storage);
  const mutationKey = [...storage.values.keys()].find((key) => key !== controlKey)!;
  for (const request of [
    { type: 'create', key: operation },
    { type: 'create', title: '', key: operation },
    { type: 'create', title: 'A'.repeat(256), key: operation },
    { type: 'rename', title: 'A', key: operation, sessionId: 'short-id' },
    { type: 'delete', title: 'A', key: operation },
  ]) {
    savePendingSessionMutation(owner, { type: 'create', title: 'A', key: operation }, storage);
    storage.values.set(mutationKey, JSON.stringify(request));
    assert.equal(getPendingSessionMutation(owner, storage), null);
  }
  savePendingControl(owner, session, null, storage);
  savePendingSessionMutation(owner, null, storage);
});

test('clears browser and fallback state after confirmed acceptance', () => {
  const storage = new MemoryStorage();
  savePendingControl(owner, session, { action: 'stop', key: operation }, storage);
  savePendingSessionMutation(owner, { type: 'create', title: 'A', key: operation }, storage);
  assert.equal(getPendingControl(owner, session, storage)?.key, operation);
  assert.equal(getPendingSessionMutation(owner, storage)?.key, operation);
  savePendingControl(owner, session, null, storage);
  savePendingSessionMutation(owner, null, storage);
  assert.equal(storage.values.size, 0);
  assert.equal(getPendingControl(owner, session, storage), null);
  assert.equal(getPendingControl(owner, session, null), null);
  assert.equal(getPendingSessionMutation(owner, null), null);
});

test('retains the original operation in memory when browser storage is unavailable', () => {
  const storage: PendingStorage = {
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Storage blocked'); },
    removeItem() { throw new Error('Storage blocked'); },
  };
  const request: PendingControl = { action: 'continue', key: operation };
  savePendingControl(owner, session, request, storage);
  assert.deepEqual(getPendingControl(owner, session, storage), request);
  const restored = getPendingControl(owner, session, null)!;
  restored.key = otherSession;
  assert.equal(getPendingControl(owner, session, null)?.key, operation);
  savePendingSessionMutation(owner, { type: 'rename', title: 'A', sessionId: session, key: operation }, null);
  assert.equal(getPendingSessionMutation(owner, null)?.key, operation);
  savePendingControl(owner, session, null, storage);
  savePendingSessionMutation(owner, null, null);
  assert.equal(getPendingControl(owner, session, null), null);
  assert.equal(getPendingSessionMutation(owner, null), null);
});

test('restored request edits cannot change the fallback identity', () => {
  const storage = new MemoryStorage();
  savePendingControl(owner, session, { action: 'stop', key: operation }, storage);
  const restored = getPendingControl(owner, session, storage)!;
  restored.key = otherSession;
  assert.equal(getPendingControl(owner, session, null)?.key, operation);
  savePendingControl(owner, session, null, storage);
});

test('a failed browser removal cannot resurrect a confirmed operation', () => {
  const storage = new MemoryStorage();
  savePendingControl(owner, session, { action: 'stop', key: operation }, storage);
  const removalFails: PendingStorage = {
    getItem: storage.getItem.bind(storage),
    setItem: storage.setItem.bind(storage),
    removeItem() { throw new Error('Storage blocked'); },
  };
  savePendingControl(owner, session, null, removalFails);
  assert.equal(storage.values.size, 1);
  assert.equal(getPendingControl(owner, session, removalFails), null);
});

test('rejects noncanonical identities before saving an operation', () => {
  const storage = new MemoryStorage();
  assert.throws(() => savePendingControl(owner, session, { action: 'stop', key: 'invalid' }, storage), /UUID/);
  assert.throws(() => savePendingSessionMutation(owner, { type: 'rename', title: 'A', key: operation, sessionId: 'invalid' }, storage), /UUID/);
  assert.equal(storage.values.size, 0);
});

test('a late accepted control A cannot clear a newer pending control B', () => {
  const storage = new MemoryStorage();
  savePendingControl(owner, session, { action: 'stop', key: operation }, storage);
  completePendingControl(owner, session, operation, storage);
  savePendingControl(owner, session, { action: 'continue', key: otherSession }, storage);
  completePendingControl(owner, session, operation, storage);
  assert.deepEqual(getPendingControl(owner, session, storage), { action: 'continue', key: otherSession });
  completePendingControl(owner, session, otherSession, storage);
  assert.equal(getPendingControl(owner, session, storage), null);
});

test('a late accepted session mutation A cannot clear a newer pending mutation B', () => {
  const storage = new MemoryStorage();
  savePendingSessionMutation(owner, { type: 'create', title: 'A', key: operation }, storage);
  completePendingSessionMutation(owner, operation, storage);
  const next: SessionMutation = { type: 'rename', title: 'B', sessionId: session, key: otherSession };
  savePendingSessionMutation(owner, next, storage);
  completePendingSessionMutation(owner, operation, storage);
  assert.deepEqual(getPendingSessionMutation(owner, storage), next);
  completePendingSessionMutation(owner, otherSession, storage);
  assert.equal(getPendingSessionMutation(owner, storage), null);
});

test('stale browser data cannot replace a newer fallback request after failed writes', () => {
  const storage = new MemoryStorage();
  const blockedWrites: PendingStorage = {
    getItem: storage.getItem.bind(storage),
    setItem() { throw new Error('Storage writes blocked'); },
    removeItem() { throw new Error('Storage writes blocked'); },
  };
  savePendingControl(owner, session, { action: 'stop', key: operation }, storage);
  completePendingControl(owner, session, operation, blockedWrites);
  savePendingControl(owner, session, { action: 'continue', key: otherSession }, blockedWrites);
  completePendingControl(owner, session, operation, blockedWrites);
  assert.deepEqual(getPendingControl(owner, session, blockedWrites), { action: 'continue', key: otherSession });
  completePendingControl(owner, session, otherSession, blockedWrites);
  assert.equal(getPendingControl(owner, session, blockedWrites), null);
});
