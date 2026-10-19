import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getUploads, updateUploads, clearUploads, completeUploads, subscribeUploads, type UploadEntry } from '../src/chat/uploads.ts';

test('retains upload bytes and original request key across Session navigation', () => {
  const file = new File(['bytes'], 'reference.png', { type: 'image/png' });
  const entry: UploadEntry = { file, key: 'original', asset: null, status: 'failed', error: 'Timeout' };
  updateUploads('owner:session', () => [entry]);
  assert.equal(getUploads('owner:session')[0].file, file);
  assert.equal(getUploads('owner:session')[0].key, 'original');
  assert.deepEqual(getUploads('owner:other-session'), []);
  clearUploads('owner:session');
});
test('notifies a remounted composer of the original upload response and clears confirmed inputs', () => {
  let notifications = 0;
  const unsubscribe = subscribeUploads(() => { notifications++; });
  updateUploads('owner:session', () => []);
  clearUploads('owner:session');
  assert.equal(notifications, 2);
  assert.deepEqual(getUploads('owner:session'), []);
  unsubscribe();
});

test('a late accepted message removes only its own attachments and preserves newly uploaded files', () => {
  const file = new File(['bytes'], 'reference.png');
  const first: UploadEntry = { file, key: 'upload-a', asset: { id: 'asset-a', user_id: 'user', task_id: null, filename: file.name, media_type: 'image/png', size_bytes: 5, sha256: 'hash', created_at: 'time' }, status: 'uploaded', error: null };
  const second: UploadEntry = { file, key: 'upload-b', asset: null, status: 'uploading', error: null };
  updateUploads('scope', () => [first, second]);
  completeUploads('scope', ['asset-a']);
  assert.deepEqual(getUploads('scope'), [second]);
  clearUploads('scope');
});
