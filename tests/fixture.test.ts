import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { createFixtureServer, FIXTURE_IDS, FIXTURE_PNG } from '../scripts/fixture-server.ts';
import type { InputAcceptanceResponse, SessionProjectionPage, AssetRecord, SessionRecord } from '../src/api/types.ts';

test('fixture PNG contains a decodable one-pixel image', () => {
  assert.equal(FIXTURE_PNG.readUInt32BE(16), 1);
  assert.equal(FIXTURE_PNG.readUInt32BE(20), 1);
  assert.deepEqual(inflateSync(FIXTURE_PNG.subarray(41, FIXTURE_PNG.length - 16)), Buffer.from([0, 40, 100, 200, 255]));
});

test('fixture accepts a send once and replays only events after the SSE cursor', async () => {
  const fixture = createFixtureServer();
  const base = await fixture.start();
  const path = `${base}/api/v1/users/${FIXTURE_IDS.user}/sessions/${FIXTURE_IDS.session}`;
  try {
    const before = await (await fetch(`${path}/items`)).json() as SessionProjectionPage;
    assert.equal(before.items.length, 50);
    assert.ok(before.next_before_sequence_no);
    const body = JSON.stringify({ client_request_id: '70000000-0000-0000-0000-000000000001', content: [{ type: 'text', text: 'Create a local image\nplease.' }] });
    const send = () => fetch(`${path}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const first = await send();
    assert.equal(first.status, 202);
    const receipt = await first.json() as InputAcceptanceResponse;
    assert.deepEqual(await (await send()).json(), receipt);
    const conflict = await fetch(`${path}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_request_id: '70000000-0000-0000-0000-000000000001', content: [{ type: 'text', text: 'Changed request' }] }) });
    assert.equal(conflict.status, 409);

    const controller = new AbortController();
    const stream = await fetch(`${path}/events?after=${before.last_event_sequence_no}`, { signal: controller.signal });
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.ok(stream.body);
    const reader = stream.body.getReader();
    let text = '';
    while (!text.includes('event: ITEM_CONTENT_REPLACED')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      text += new TextDecoder().decode(chunk.value);
    }
    controller.abort();
    assert.match(text, /event: ITEM_CREATED/);
    assert.match(text, /event: ITEM_TEXT_DELTA/);
    assert.match(text, /event: RUN_UPDATED/);
    const eventIds = Array.from(text.matchAll(/^id: (\d+)$/gm), (match) => Number(match[1]));
    assert.ok(eventIds.length >= 5);
    assert.deepEqual(eventIds, [...new Set(eventIds)].sort((a, b) => a - b));
    const cursor = eventIds[1];
    const replayController = new AbortController();
    const replay = await fetch(`${path}/events?after=999999`, { headers: { 'Last-Event-ID': String(cursor) }, signal: replayController.signal });
    assert.ok(replay.body);
    const replayChunk = await replay.body.getReader().read();
    replayController.abort();
    const replayText = new TextDecoder().decode(replayChunk.value);
    const replayIds = Array.from(replayText.matchAll(/^id: (\d+)$/gm), (match) => Number(match[1]));
    assert.ok(replayIds.length > 0);
    assert.ok(replayIds.every((id) => id > cursor));
    const after = await (await fetch(`${path}/items?limit=200`)).json() as SessionProjectionPage;
    assert.equal(after.items.filter((item) => item.id === receipt.item.id).length, 1);
  } finally { await fixture.close(); }
});

test('fixture uploads bytes with a stable receipt and serves scoped media ranges', async () => {
  const fixture = createFixtureServer();
  const base = await fixture.start();
  const path = `${base}/api/v1/users/${FIXTURE_IDS.user}/assets`;
  try {
    const upload = () => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(FIXTURE_PNG)], { type: 'image/png' }), 'reference.png');
      return fetch(path, { method: 'POST', headers: { 'Idempotency-Key': '70000000-0000-0000-0000-000000000002' }, body: form });
    };
    const response = await upload();
    assert.equal(response.status, 200);
    const asset = await response.json() as AssetRecord;
    assert.equal(asset.size_bytes, FIXTURE_PNG.length);
    assert.deepEqual(await (await upload()).json(), asset);
    const content = await fetch(`${path}/${asset.id}/content`, { headers: { Range: 'bytes=0-7' } });
    assert.equal(content.status, 206);
    assert.equal(content.headers.get('content-range'), `bytes 0-7/${FIXTURE_PNG.length}`);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), FIXTURE_PNG.subarray(0, 8));
    assert.equal((await fetch(`${base}/api/v1/users/00000000-0000-0000-0000-000000000002/assets/${asset.id}`)).status, 404);
    assert.equal((await fetch(`${base}/internal/v2/users/${FIXTURE_IDS.user}/tasks`)).status, 404);
  } finally { await fixture.close(); }
});

test('fixture keeps create, rename and control identities on explicit retries', async () => {
  const fixture = createFixtureServer();
  const base = await fixture.start();
  const sessions = `${base}/api/v1/users/${FIXTURE_IDS.user}/sessions`;
  try {
    const create = () => fetch(sessions, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': '70000000-0000-0000-0000-000000000003' }, body: JSON.stringify({ title: 'Browser smoke' }) });
    const created = await create();
    assert.equal(created.status, 201);
    const session = await created.json() as SessionRecord;
    assert.equal(session.next_item_seq, 0, "Fresh fixture Sessions must match Java zero allocation counter");
    assert.deepEqual(await (await create()).json(), session);
    const rename = () => fetch(`${sessions}/${session.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': '70000000-0000-0000-0000-000000000004' }, body: JSON.stringify({ title: 'Renamed smoke' }) });
    assert.equal((await (await rename()).json() as SessionRecord).title, 'Renamed smoke');
    assert.equal((await (await rename()).json() as SessionRecord).version, 2);
    const stop = () => fetch(`${sessions}/${session.id}/stop`, { method: 'POST', headers: { 'Idempotency-Key': '70000000-0000-0000-0000-000000000005' } });
    const accepted = await stop();
    assert.equal(accepted.status, 202);
    assert.deepEqual(await (await stop()).json(), await accepted.json());
    assert.equal((await fetch(`${sessions}/${session.id}/plans?beforeId=${FIXTURE_IDS.plan}`)).status, 400);
  } finally { await fixture.close(); }
});
