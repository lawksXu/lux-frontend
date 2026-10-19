import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, LuxApi, referencedTaskIds } from '../src/api/client';
import { decodeEvent } from '../src/api/decode';
import type { AssetRecord, GenerationPlanSnapshot, ItemProjection, MessageInput, PlansCursor, SessionRecord } from '../src/api/types';

const user = '00000000-0000-0000-0000-000000000001';
const session = '10000000-0000-0000-0000-000000000001';
const itemId = '10000000-0000-0000-0000-000000000002';
const runId = '10000000-0000-0000-0000-000000000003';
const turnId = '10000000-0000-0000-0000-000000000004';
const time = '2026-10-13T12:00:00Z';
const sessionRecord: SessionRecord = { id: session, user_id: user, title: 'New chat', next_item_seq: 1, version: 1, created_at: time, updated_at: time };
const shell: ItemProjection = {
  id: itemId, user_id: user, session_id: session, sequence_no: 3, source: 'AGENT', kind: null,
  run_id: null, turn_id: null, item_index: null, input_sequence_no: null, status: null,
  call_id: null, tool_name: null, task_id: null, payload: null, source_revision: 0,
  completed_at: null, version: 1, created_at: time, updated_at: time,
};
const asset: AssetRecord = {
  id: itemId, user_id: user, task_id: null, filename: 'a.txt', media_type: 'text/plain',
  size_bytes: 3, sha256: 'a'.repeat(64), created_at: time,
};
interface FetchCall { url: string; init?: RequestInit }
function recordingFetch(responses: Response[]): { fetcher: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected request');
    return response;
  }) as typeof fetch;
  return { fetcher, calls };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('calls the captured fetch function without binding the API client as its receiver', async () => {
  const fetcher: typeof fetch = async function (this: unknown, _url: RequestInfo | URL, _init?: RequestInit) {
    assert.equal(this, undefined, 'Native fetch must not receive LuxApi as its this value');
    return json([sessionRecord]);
  };
  const api = new LuxApi(user, fetcher);
  assert.deepEqual(await api.sessions(), [sessionRecord]);
});

test('restores one owner-scoped Session beyond the newest list and reports inaccessible Sessions', async () => {
  const { fetcher, calls } = recordingFetch([
    json(sessionRecord), json({ status: 404, detail: 'Resource not found', code: 'RESOURCE_NOT_FOUND' }, 404),
  ]);
  const api = new LuxApi(user, fetcher);
  const signal = new AbortController().signal;
  assert.deepEqual(await api.session(session, signal), sessionRecord);
  assert.equal(calls[0].url, `/api/v1/users/${user}/sessions/${session}`);
  assert.equal(calls[0].init?.signal, signal);
  await assert.rejects(api.session(itemId, signal), (error: unknown) =>
    error instanceof ApiError && error.status === 404 && error.code === 'RESOURCE_NOT_FOUND');
  assert.equal(calls[1].url, `/api/v1/users/${user}/sessions/${itemId}`);
  assert.equal(calls[1].init?.signal, signal);
});

test('owner-scoped reads forward abort signals and exact snapshot cursors', async () => {
  const page = { items: [shell], runs: [], turns: [], next_before_sequence_no: null, last_event_sequence_no: 8 };
  const { fetcher, calls } = recordingFetch([json([sessionRecord]), json(page), json(shell), json(asset)]);
  const api = new LuxApi(user, fetcher);
  const signal = new AbortController().signal;
  assert.deepEqual(await api.sessions(signal), [sessionRecord]);
  assert.deepEqual(await api.items(session, 3, signal), page);
  assert.deepEqual(await api.item(session, itemId, signal), shell);
  assert.deepEqual(await api.asset(itemId, signal), asset);
  assert.deepEqual(calls.map(call => call.url), [
    `/api/v1/users/${user}/sessions`, `/api/v1/users/${user}/sessions/${session}/items?before=3`,
    `/api/v1/users/${user}/sessions/${session}/items/${itemId}`, `/api/v1/users/${user}/assets/${itemId}`,
  ]);
  assert.ok(calls.every(call => call.init?.signal === signal));
  assert.equal(api.eventsUrl(session, 8), `/api/v1/users/${user}/sessions/${session}/events?after=8`);
  assert.equal(api.assetUrl(itemId), `/api/v1/users/${user}/assets/${itemId}/content`);
});

test('message retries preserve original client_request_id and untrimmed content without automatic retries', async () => {
  const acceptance = { item: { id: itemId, sequence_no: 1, input_sequence_no: 1, source: 'USER', kind: 'MESSAGE', content: { blocks: [{ type: 'text', text: '  hi\n' }] } } };
  const { fetcher, calls } = recordingFetch([json({ status: 503, detail: 'Try later', code: 'UNAVAILABLE' }, 503), json(acceptance, 202)]);
  const api = new LuxApi(user, fetcher);
  const input: MessageInput = { client_request_id: itemId, content: [{ type: 'text', text: '  hi\n' }] };
  await assert.rejects(api.send(session, input), ApiError);
  assert.equal(calls.length, 1);
  assert.deepEqual(await api.send(session, input), acceptance);
  assert.equal(calls[0].init?.body, JSON.stringify(input));
  assert.equal(calls[1].init?.body, calls[0].init?.body);
  assert.equal(new Headers(calls[0].init?.headers).get('Idempotency-Key'), null);
});

test('create, rename and controls retain explicit Idempotency-Key values', async () => {
  const { fetcher, calls } = recordingFetch([json(sessionRecord, 201), json(sessionRecord), json({ event_id: itemId }, 202), json({ event_id: itemId }, 202)]);
  const api = new LuxApi(user, fetcher);
  await api.createSession('New chat', itemId);
  await api.renameSession(session, 'Renamed', runId);
  await api.control(session, 'stop', turnId);
  await api.control(session, 'stop', turnId);
  assert.deepEqual(calls.map(call => new Headers(call.init?.headers).get('Idempotency-Key')), [itemId, runId, turnId, turnId]);
  assert.deepEqual(calls.map(call => call.init?.method), ['POST', 'PATCH', 'POST', 'POST']);
  assert.equal(calls[1].init?.body, JSON.stringify({ title: 'Renamed' }));
});

test('multipart uploads let the browser create Content-Type and preserve the file and operation identity', async () => {
  const { fetcher, calls } = recordingFetch([json(asset)]);
  const api = new LuxApi(user, fetcher);
  const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
  assert.deepEqual(await api.upload(file, itemId), asset);
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get('Content-Type'), null);
  assert.equal(headers.get('Idempotency-Key'), itemId);
  const body = calls[0].init?.body;
  assert.ok(body instanceof FormData);
  assert.equal(await (body.get('file') as File).text(), 'abc');
});

test('plan pagination translates both wire cursor fields to the controller query names', async () => {
  const focus = { session_id: session, active_plan_id: null, revision: 0 };
  const page = { type: 'generation_plan_read_result', focus, plans: [], next_cursor: null };
  const { fetcher, calls } = recordingFetch([json(page), json(focus), json([])]);
  const api = new LuxApi(user, fetcher);
  assert.deepEqual(await api.plans(session, { before_created_at: time, before_id: itemId }), page);
  assert.deepEqual(await api.focus(session), focus);
  assert.deepEqual(await api.tasks([itemId]), []);
  const url = new URL(calls[0].url, 'http://localhost');
  assert.equal(url.searchParams.get('beforeCreatedAt'), time);
  assert.equal(url.searchParams.get('beforeId'), itemId);
  assert.equal(url.searchParams.get('before_created_at'), null);
  assert.equal(calls[2].init?.body, JSON.stringify({ ids: [itemId] }));
});

test('ProblemDetail errors retain HTTP status and business code, while non-JSON errors remain useful', async () => {
  const { fetcher } = recordingFetch([json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'Identity conflict', code: 'STATE_CONFLICT' }, 409), new Response('proxy unavailable', { status: 502 })]);
  const api = new LuxApi(user, fetcher);
  await assert.rejects(api.sessions(), (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'STATE_CONFLICT' && error.message === 'Identity conflict');
  await assert.rejects(api.sessions(), (error: unknown) => error instanceof ApiError && error.status === 502);
});

test('SSE decoder accepts incomplete Item shells and preserves fragment whitespace', () => {
  assert.deepEqual(decodeEvent('ITEM_CREATED', 9, JSON.stringify({ item_id: itemId, item_sequence_no: 3, body: shell })), {
    type: 'ITEM_CREATED', sequence: 9, payload: { item_id: itemId, item_sequence_no: 3, body: shell },
  });
  const body = { item: { id: itemId, item_index: 2, turn: { id: turnId, turn_index: 1, run: { id: runId, run_index: 1 } } }, stream_seq: 1, text: ' \nhello ' };
  const event = decodeEvent('ITEM_TEXT_DELTA', 10, JSON.stringify({ item_id: itemId, item_sequence_no: 3, body }));
  assert.equal(event.type, 'ITEM_TEXT_DELTA');
  if (event.type === 'ITEM_TEXT_DELTA') assert.equal(event.payload.body.text, ' \nhello ');
});

test('SSE decoding rejects malformed identities, ordering values and consumed fields', () => {
  assert.throws(() => decodeEvent('TASK_UPDATED', 1, JSON.stringify({ task_id: 'not-an-id' })), /task_id/);
  assert.throws(() => decodeEvent('TASK_UPDATED', 0, JSON.stringify({ task_id: itemId })), /sequence/);
  assert.throws(() => decodeEvent('ITEM_CREATED', 1, JSON.stringify({ item_id: itemId, item_sequence_no: 3, body: { ...shell, payload: { blocks: [{ type: 'text', text: 1 }] }, kind: 'MESSAGE' } })), /text/);
  assert.throws(() => decodeEvent('ITEM_CREATED', 1, JSON.stringify({ item_id: runId, item_sequence_no: 3, body: shell })), /identity/);
  assert.throws(() => decodeEvent('UNKNOWN', 1, '{}'), /Unsupported/);
});

test('task references include every task accepted by a generation plan tool', () => {
  const task = runId;
  const payload = { type: 'plan_task_submission_receipt' as const, plan_id: turnId, frozen_plan_revision: 1,
    accepted: true as const, requested_file_count: 2, tasks: [
      { index: 0, task_id: itemId, task_operation_id: itemId }, { index: 1, task_id: task, task_operation_id: task },
    ], focus: { session_id: session, active_plan_id: turnId, revision: 1 } };
  assert.deepEqual(referencedTaskIds({ kind: 'TOOL_RESULT', task_id: itemId, payload }), [itemId, task]);
});

test('single plan invalidations read typed intent, model and validation without a list refresh', async () => {
  const plan: GenerationPlanSnapshot = {
    plan: { type: 'generation_plan', schema_version: 1, id: itemId, user_id: user, session_id: session, revision: 1, state: 'DRAFT',
      configuration: { type: 'image_plan_configuration', model_selection: null,
        intent: { type: 'image_intent', description: 'Draw a cat', requirements: { type: 'image_requirements', prompt: null, size: null, requested_file_count: 2, references: null, output_format: null, generation_mode: null } },
        parameters: { type: 'image_parameters', prompt: '  a cat ', size: null, references: [], output_format: null }, parameter_origins: [] },
      created_at: time, updated_at: time, frozen_at: null },
    validation: { can_submit: false, issues: [{ code: 'MODEL_REQUIRED', field: 'MODEL', reference_index: null, message: 'Select a model', model_selection: null }], validated_catalog_revision: 1 },
  };
  const { fetcher, calls } = recordingFetch([json(plan)]);
  const api = new LuxApi(user, fetcher);
  assert.deepEqual(await api.plan(session, itemId), plan);
  assert.equal(calls[0].url, `/api/v1/users/${user}/sessions/${session}/plans/${itemId}`);
  await assert.rejects(api.plans(session, { before_created_at: time } as PlansCursor), /cursor/i);
  assert.equal(calls.length, 1);
});

test('untrusted successful HTTP responses cannot enter state with malformed required fields', async () => {
  const { fetcher } = recordingFetch([json([{ ...sessionRecord, title: 12 }])]);
  const api = new LuxApi(user, fetcher);
  await assert.rejects(api.sessions(), /title/);
});

test('Run and Turn identity skeletons retain null lifecycle state until source snapshots arrive', async () => {
  const run = { id: runId, user_id: user, session_id: session, run_index: 1, source_revision: 0, status: null,
    started_at: null, finished_at: null, final_item_id: null, error_code: null, error_message: null,
    last_seen_at: time, version: 1, created_at: time, updated_at: time };
  const turn = { id: turnId, user_id: user, session_id: session, run_id: runId, turn_index: 1, source_revision: 0,
    status: null, started_at: null, finished_at: null, error_code: null, error_message: null,
    version: 1, created_at: time, updated_at: time };
  const page = { items: [shell], runs: [run], turns: [turn], next_before_sequence_no: null, last_event_sequence_no: 1 };
  const { fetcher } = recordingFetch([json(run), json(page)]);
  const api = new LuxApi(user, fetcher);
  assert.deepEqual(await api.run(runId), run);
  assert.deepEqual(await api.items(session), page);
});


test('fresh Java sessions accept a zero registration counter for creation and reads', async () => {
  const fresh: SessionRecord = { ...sessionRecord, next_item_seq: 0 };
  const { fetcher } = recordingFetch([json(fresh, 201), json([fresh]), json(fresh)]);
  const api = new LuxApi(user, fetcher);
  assert.deepEqual(await api.createSession(fresh.title, itemId), fresh);
  assert.deepEqual(await api.sessions(), [fresh]);
  assert.deepEqual(await api.session(fresh.id), fresh);
  const invalid = recordingFetch([json({ ...fresh, next_item_seq: -1 })]);
  await assert.rejects(new LuxApi(user, invalid.fetcher).session(fresh.id), ApiError);
});
