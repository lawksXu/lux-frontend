import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AgentItemSnapshot,
  ItemProjection,
  RunProjection,
  SessionEvent,
  SessionProjectionPage,
  TurnProjection,
} from '../src/api/types.ts';
import {
  applyEvent,
  emptyConversation,
  initialConversation,
  mergeItem,
  mergePage,
  mergeRun,
} from '../src/chat/state.ts';

const context = { userId: 'owner', sessionId: 'session' };
const timestamp = '2026-10-13T12:00:00Z';

function item(id: string, sequence: number, changes: Partial<ItemProjection> = {}): ItemProjection {
  return {
    id, user_id: context.userId, session_id: context.sessionId, sequence_no: sequence,
    source: 'AGENT', kind: 'MESSAGE', run_id: 'run', turn_id: 'turn', item_index: sequence,
    input_sequence_no: null, status: 'PARTIAL', call_id: null, tool_name: null, task_id: null,
    payload: { blocks: [] }, source_revision: 1, completed_at: null,
    version: 1, created_at: timestamp, updated_at: timestamp, ...changes,
  };
}

function page(items: ItemProjection[], next: number | null = null, cursor = 0): SessionProjectionPage {
  return { items, runs: [], turns: [], next_before_sequence_no: next, last_event_sequence_no: cursor };
}

function created(sequence: number, projection: ItemProjection): SessionEvent {
  return {
    type: 'ITEM_CREATED', sequence,
    payload: { item_id: projection.id, item_sequence_no: projection.sequence_no, body: projection },
  };
}

function delta(sequence: number, projection: ItemProjection, streamSequence: number, text: string): SessionEvent {
  return {
    type: 'ITEM_TEXT_DELTA', sequence,
    payload: {
      item_id: projection.id, item_sequence_no: projection.sequence_no,
      body: { item: identity(projection), stream_seq: streamSequence, text },
    },
  };
}

function identity(projection: ItemProjection): AgentItemSnapshot['item'] {
  return {
    id: projection.id, item_index: projection.item_index ?? 1,
    turn: { id: projection.turn_id ?? 'turn', turn_index: 1, run: { id: projection.run_id ?? 'run', run_index: 1 } },
  };
}

function replaced(sequence: number, projection: ItemProjection, text: string, revision = 2): SessionEvent {
  return {
    type: 'ITEM_CONTENT_REPLACED', sequence,
    payload: {
      item_id: projection.id, item_sequence_no: projection.sequence_no,
      body: {
        snapshot: {
          item: identity(projection), source: projection.source, source_revision: revision,
          kind: projection.kind ?? 'MESSAGE', status: 'FINAL', payload: { blocks: [{ type: 'text', text }] },
          completed_at: timestamp, call_id: projection.call_id, tool_name: projection.tool_name,
        },
      },
    },
  };
}

test('keeps M1 A1 M2 A2 registration order within a shared Run', () => {
  const m1 = item('M1', 1, { source: 'USER', status: 'FINAL', run_id: null, turn_id: null });
  const a1 = item('A1', 2);
  const m2 = item('M2', 3, { source: 'USER', status: 'FINAL', run_id: null, turn_id: null });
  const a2 = item('A2', 4);
  let state = initialConversation(page([m1, a1]), context);
  state = applyEvent(state, created(1, m2));
  state = applyEvent(state, created(2, a2));
  state = mergeItem(state, { ...a1, sequence_no: 99, version: 3 });
  assert.deepEqual(state.items.map((entry) => entry.id), ['M1', 'A1', 'M2', 'A2']);
  assert.equal(state.items[1]?.sequence_no, 2);
});

test('preserves whitespace as separate contiguous fragments and ignores duplicate events', () => {
  const a1 = item('A1', 2);
  const original = initialConversation(page([a1]));
  let state = applyEvent(original, delta(1, a1, 1, ' hello '));
  state = applyEvent(state, delta(2, a1, 2, '\nworld\t'));
  const duplicate = applyEvent(state, delta(2, a1, 2, 'wrong'));
  assert.strictEqual(duplicate, state);
  assert.deepEqual(state.items[0]?.payload, {
    blocks: [{ type: 'text', text: ' hello ' }, { type: 'text', text: '\nworld\t' }],
  });
  assert.deepEqual(original.items[0]?.payload, { blocks: [] });
});

test('buffers stream gaps and ignores a repeated fragment with a new SSE sequence', () => {
  const a1 = item('A1', 2);
  let state = initialConversation(page([a1]));
  state = applyEvent(state, delta(1, a1, 2, ' second'));
  assert.deepEqual(state.items[0]?.payload, { blocks: [] });
  state = applyEvent(state, delta(2, a1, 1, 'first'));
  state = applyEvent(state, delta(3, a1, 1, 'wrong'));
  assert.deepEqual(state.items[0]?.payload, {
    blocks: [{ type: 'text', text: 'first' }, { type: 'text', text: ' second' }],
  });
  assert.equal(state.cursor, 3);
});

test('resumes streamed content after the initial snapshot fragment prefix', () => {
  const a1 = item('A1', 2, { payload: { blocks: [{ type: 'text', text: 'first' }] } });
  let state = initialConversation(page([a1], null, 5));
  state = applyEvent(state, delta(6, a1, 1, 'first'));
  state = applyEvent(state, delta(7, a1, 2, ' second'));
  assert.deepEqual(state.items[0]?.payload, {
    blocks: [{ type: 'text', text: 'first' }, { type: 'text', text: ' second' }],
  });
});

test('a stale partial refresh cannot overwrite text already applied through SSE', () => {
  const a1 = item('A1', 2);
  let state = initialConversation(page([a1], 2, 10));
  state = applyEvent(state, delta(11, a1, 1, 'longer'));
  state = mergePage(state, page([{ ...a1, version: 2 }], 2, 20), 'refresh');
  assert.deepEqual(state.items[0]?.payload, { blocks: [{ type: 'text', text: 'longer' }] });
  assert.equal(state.cursor, 11);
});

test('terminal replacement wins over late deltas and older fetched snapshots', () => {
  const a1 = item('A1', 2);
  let state = initialConversation(page([a1]));
  state = applyEvent(state, delta(1, a1, 1, 'partial'));
  state = applyEvent(state, replaced(2, a1, 'complete'));
  state = applyEvent(state, delta(3, a1, 2, 'late'));
  state = mergeItem(state, { ...a1, version: 50 });
  assert.equal(state.items[0]?.status, 'FINAL');
  assert.equal(state.items[0]?.source_revision, 2);
  assert.deepEqual(state.items[0]?.payload, { blocks: [{ type: 'text', text: 'complete' }] });
});

test('constructs a faithful replacement before CREATE and fills projection metadata later', () => {
  const a1 = item('A1', 2, { call_id: 'call', tool_name: 'get_task' });
  let state = applyEvent(emptyConversation(context), replaced(1, a1, 'complete'));
  assert.equal(state.items[0]?.id, 'A1');
  assert.equal(state.items[0]?.sequence_no, 2);
  assert.equal(state.items[0]?.run_id, 'run');
  assert.equal(state.items[0]?.user_id, 'owner');
  assert.equal(state.items[0]?.created_at, null);
  assert.equal(state.items[0]?.version, null);
  state = applyEvent(state, created(2, a1));
  assert.equal(state.items[0]?.created_at, timestamp);
  assert.equal(state.items[0]?.call_id, 'call');
  assert.equal(state.items[0]?.status, 'FINAL');
  assert.deepEqual(state.items[0]?.payload, { blocks: [{ type: 'text', text: 'complete' }] });
});

test('retains a delta before CREATE while advancing the SSE replay cursor', () => {
  const a1 = item('A1', 2);
  let state = applyEvent(emptyConversation(context), delta(1, a1, 1, 'queued'));
  assert.equal(state.cursor, 1);
  assert.deepEqual(state.items, []);
  state = applyEvent(state, created(2, a1));
  assert.deepEqual(state.items[0]?.payload, { blocks: [{ type: 'text', text: 'queued' }] });
});

test('buffers text on an incomplete Java Item shell until PARTIAL content arrives', () => {
  const a1 = item('A1', 2);
  const shell = { ...a1, kind: null, status: null, payload: null, source_revision: 0 };
  let state = initialConversation(page([shell]));
  state = applyEvent(state, delta(1, a1, 1, 'queued'));
  state = applyEvent(state, created(2, a1));
  assert.equal(state.items[0]?.status, 'PARTIAL');
  assert.deepEqual(state.items[0]?.payload, { blocks: [{ type: 'text', text: 'queued' }] });
});

test('retains the registration position already observed by an early delta', () => {
  const a1 = item('A1', 2);
  let state = applyEvent(emptyConversation(context), delta(1, a1, 1, 'queued'));
  state = applyEvent(state, created(2, { ...a1, sequence_no: 99 }));
  assert.equal(state.items[0]?.sequence_no, 2);
});

test('merges history without moving the active SSE cursor or refresh pagination boundary', () => {
  let state = initialConversation(page([item('A4', 4)], 4, 10));
  state = mergePage(state, page([item('A2', 2), item('A3', 3)], 2, 99));
  assert.equal(state.nextBefore, 2);
  state = mergePage(state, page([item('A4', 4)], 4, 120), 'refresh');
  assert.equal(state.nextBefore, 2);
  assert.equal(state.cursor, 10);
  state = mergePage(state, page([item('A1', 1)], null, 125));
  assert.equal(state.nextBefore, null);
  assert.deepEqual(state.items.map((entry) => entry.sequence_no), [1, 2, 3, 4]);
});

test('merges Run and Turn snapshots by source and database versions', () => {
  const run: RunProjection = {
    id: 'run', user_id: 'owner', session_id: 'session', run_index: 1, source_revision: 3,
    status: 'COMPLETED', started_at: timestamp, finished_at: timestamp, final_item_id: 'A1',
    error_code: null, error_message: null, last_seen_at: timestamp, version: 5,
    created_at: timestamp, updated_at: timestamp,
  };
  const turn: TurnProjection = {
    id: 'turn', user_id: 'owner', session_id: 'session', run_id: 'run', turn_index: 1, source_revision: 3,
    status: 'COMPLETED', started_at: timestamp, finished_at: timestamp,
    error_code: null, error_message: null, version: 5, created_at: timestamp, updated_at: timestamp,
  };
  const first = { ...page([item('A1', 1)]), runs: [run], turns: [turn] };
  let state = initialConversation(first);
  state = mergePage(state, {
    ...page([]), runs: [{ ...run, status: 'RUNNING', source_revision: 2, version: 99 }],
    turns: [{ ...turn, status: 'RUNNING', version: 4 }],
  }, 'refresh');
  assert.equal(state.runs[0]?.status, 'COMPLETED');
  assert.equal(state.turns[0]?.status, 'COMPLETED');
  state = mergeRun(state, { ...run, last_seen_at: 'later', version: 6 });
  assert.equal(state.runs[0]?.last_seen_at, 'later');
});

test('advances the SSE cursor for execution invalidations without altering loaded content', () => {
  const state = initialConversation(page([item('A1', 1)], null, 10));
  const next = applyEvent(state, { type: 'RUN_UPDATED', sequence: 11, payload: { run_id: 'run' } });
  assert.equal(next.cursor, 11);
  assert.deepEqual(next.items, state.items);
});
