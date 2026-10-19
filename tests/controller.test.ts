import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConversationController, type ConversationApi, type EventStream } from '../src/chat/controller.ts';
import type { SessionProjectionPage } from '../src/api/types.ts';

const page: SessionProjectionPage = { items: [], runs: [], turns: [], next_before_sequence_no: null, last_event_sequence_no: 7 };

class Stream implements EventStream {
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, EventListener>();
  addEventListener(type: string, listener: EventListener) { this.listeners.set(type, listener); }
  close() { this.closed = true; }
}

function api(overrides: Partial<ConversationApi> = {}): ConversationApi {
  return {
    items: async () => page,
    item: async () => { throw new Error('No Item'); },
    run: async () => { throw new Error('No Run'); },
    tasks: async () => [],
    plans: async () => ({ type: 'generation_plan_read_result', focus: { session_id: 'session', active_plan_id: null, revision: 0 }, plans: [], next_cursor: null }),
    plan: async () => { throw new Error('No plan'); },
    eventsUrl: (_session, after) => `/events?after=${after}`,
    ...overrides,
  };
}

test('subscribes after initial snapshot and closes native stream on Session disposal', async () => {
  const stream = new Stream();
  const urls: string[] = [];
  const controller = new ConversationController(api(), 'user', 'session', url => { urls.push(url); return stream; });
  await controller.start();
  assert.deepEqual(urls, ['/events?after=7']);
  assert.equal(controller.getSnapshot().state.cursor, 7);
  controller.close();
  assert.equal(stream.closed, true);
});

test('late initial response from a disposed Session cannot open a subscription or change state', async () => {
  let resolve!: (value: SessionProjectionPage) => void;
  const response = new Promise<SessionProjectionPage>(done => { resolve = done; });
  let opened = 0;
  const controller = new ConversationController(api({ items: async () => response }), 'user', 'session', () => { opened++; return new Stream(); });
  const start = controller.start();
  controller.close();
  resolve(page);
  await start;
  assert.equal(opened, 0);
  assert.equal(controller.getSnapshot().state.items.length, 0);
});

test('later projection refresh preserves an active event cursor', async () => {
  let reads = 0;
  const controller = new ConversationController(api({ items: async () => ({ ...page, last_event_sequence_no: ++reads === 1 ? 7 : 20 }) }), 'user', 'session', () => new Stream());
  await controller.start();
  await controller.refresh();
  assert.equal(controller.getSnapshot().state.cursor, 7);
  controller.close();
});

test('transient stream error keeps loaded state and reports reconnecting', async () => {
  const stream = new Stream();
  const controller = new ConversationController(api(), 'user', 'session', () => stream);
  await controller.start();
  stream.onopen?.();
  assert.equal(controller.getSnapshot().streamStatus, 'live');
  stream.onerror?.();
  assert.equal(controller.getSnapshot().streamStatus, 'reconnecting');
  assert.equal(controller.getSnapshot().state.cursor, 7);
  assert.equal(stream.closed, false);
  controller.close();
});

test('task invalidation loads a referenced Task even when its original Item is outside loaded history', async () => {
  const stream = new Stream();
  const observed: string[] = [];
  const taskId = '20000000-0000-0000-0000-000000000002';
  const controller = new ConversationController(api({ tasks: async ids => { observed.push(...ids); return []; } }), 'user', 'session', () => stream);
  await controller.start();
  stream.listeners.get('TASK_UPDATED')?.(new MessageEvent('TASK_UPDATED', { lastEventId: '8', data: JSON.stringify({ task_id: taskId }) }));
  await controller.refresh();
  assert.ok(observed.includes(taskId));
  controller.close();
});

test('restarting a stream cannot reuse a previous disposed refresh promise', async () => {
  let resolve!: (value: SessionProjectionPage) => void;
  let reads = 0;
  const oldResponse = new Promise<SessionProjectionPage>(done => { resolve = done; });
  const streams: Stream[] = [];
  const controller = new ConversationController(api({ items: async () => {
    reads++;
    return reads === 2 ? oldResponse : page;
  } }), 'user', 'session', () => { const stream = new Stream(); streams.push(stream); return stream; });
  await controller.start();
  const oldRefresh = controller.refresh();
  controller.close();
  await controller.start();
  streams[1].listeners.get('TURN_UPDATED')?.(new MessageEvent('TURN_UPDATED', { lastEventId: '8', data: JSON.stringify({ turn_id: '70000000-0000-0000-0000-000000000001' }) }));
  resolve(page);
  await oldRefresh;
  await new Promise<void>(done => setImmediate(done));
  assert.ok(reads >= 4);
  controller.close();
});
