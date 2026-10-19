import type {
  AgentItemSnapshot,
  ItemPayload,
  ItemProjection,
  ItemTextDelta,
  OrderedContent,
  RunProjection,
  SessionEvent,
  SessionProjectionPage,
  TurnProjection,
} from '../api/types.ts';

export interface ConversationContext {
  userId: string;
  sessionId: string;
}

// Replacement events contain source facts but omit Java persistence metadata.
export type ConversationItem = Omit<ItemProjection, 'user_id' | 'session_id' | 'version' | 'created_at' | 'updated_at'> & {
  user_id: string | null;
  session_id: string | null;
  version: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export interface PendingItemText {
  itemSequenceNo: number;
  fragments: Record<number, ItemTextDelta>;
}

export interface ConversationState {
  items: ConversationItem[];
  runs: RunProjection[];
  turns: TurnProjection[];
  nextBefore: number | null;
  cursor: number;
  pending: Record<string, PendingItemText>;
  userId: string | null;
  sessionId: string | null;
}

interface VersionedProjection {
  id: string;
  source_revision: number;
  version: number;
}

function ordered(payload: ItemPayload | null): payload is OrderedContent {
  return payload !== null && 'blocks' in payload;
}

function finalized(item: ConversationItem): boolean {
  return item.status !== null && item.status !== 'PARTIAL';
}

export function emptyConversation(context?: ConversationContext): ConversationState {
  return {
    items: [], runs: [], turns: [], nextBefore: null, cursor: 0, pending: {},
    userId: context?.userId ?? null, sessionId: context?.sessionId ?? null,
  };
}

export function initialConversation(page: SessionProjectionPage, context?: ConversationContext): ConversationState {
  return { ...mergePage(emptyConversation(context), page), cursor: page.last_event_sequence_no };
}

export function mergePage(
  state: ConversationState,
  page: SessionProjectionPage,
  mode: 'older' | 'refresh' = 'older',
): ConversationState {
  let merged = state;
  for (const item of page.items) merged = mergeItem(merged, item);
  return {
    ...merged,
    runs: mergeVersions(merged.runs, page.runs).sort((a, b) => a.run_index - b.run_index),
    turns: mergeVersions(merged.turns, page.turns).sort((a, b) => a.turn_index - b.turn_index),
    nextBefore: mode === 'older' ? page.next_before_sequence_no : state.nextBefore,
  };
}

function mergeVersions<T extends VersionedProjection>(existing: T[], incoming: T[]): T[] {
  const merged = new Map(existing.map((projection) => [projection.id, projection]));
  for (const projection of incoming) {
    const previous = merged.get(projection.id);
    if (!previous || projection.source_revision > previous.source_revision
      || (projection.source_revision === previous.source_revision && projection.version > previous.version)) {
      merged.set(projection.id, projection);
    }
  }
  return [...merged.values()];
}

export function mergeRun(state: ConversationState, run: RunProjection): ConversationState {
  return { ...state, runs: mergeVersions(state.runs, [run]).sort((a, b) => a.run_index - b.run_index) };
}

export function mergeItem(state: ConversationState, item: ItemProjection): ConversationState {
  return mergeProjection(state, item);
}

function mergeProjection(state: ConversationState, incoming: ConversationItem): ConversationState {
  const previous = state.items.find((item) => item.id === incoming.id);
  let item = {
    ...incoming,
    sequence_no: state.pending[incoming.id]?.itemSequenceNo ?? incoming.sequence_no,
  };
  if (previous) {
    const newer = incoming.source_revision > previous.source_revision
      || (incoming.source_revision === previous.source_revision
        && (incoming.version ?? -1) >= (previous.version ?? -1));
    item = newer ? incoming : previous;
    if (finalized(previous) && incoming.status === 'PARTIAL') item = previous;
    if (previous.status === 'PARTIAL' && item.status === 'PARTIAL'
      && ordered(previous.payload) && ordered(item.payload)
      && previous.payload.blocks.length > item.payload.blocks.length) {
      item = { ...item, payload: previous.payload };
    }
    item = {
      ...item,
      sequence_no: previous.sequence_no,
      user_id: previous.user_id ?? incoming.user_id,
      session_id: previous.session_id ?? incoming.session_id,
      version: item.version ?? incoming.version,
      created_at: previous.created_at ?? incoming.created_at,
      updated_at: item.updated_at ?? incoming.updated_at,
    };
  }
  const pending = { ...state.pending };
  if (finalized(item)) {
    delete pending[item.id];
  } else if (item.status === 'PARTIAL' && ordered(item.payload)) {
    const fragments = { ...pending[item.id]?.fragments };
    const blocks = [...item.payload.blocks];
    for (const key of Object.keys(fragments)) {
      if (Number(key) <= blocks.length) delete fragments[Number(key)];
    }
    while (fragments[blocks.length + 1]) {
      const next = fragments[blocks.length + 1];
      delete fragments[blocks.length + 1];
      blocks.push({ type: 'text', text: next.text });
    }
    item = { ...item, payload: { blocks } };
    pending[item.id] = { itemSequenceNo: item.sequence_no, fragments };
  }
  return {
    ...state,
    items: [...state.items.filter((entry) => entry.id !== item.id), item]
      .sort((a, b) => a.sequence_no - b.sequence_no),
    pending,
    userId: state.userId ?? item.user_id,
    sessionId: state.sessionId ?? item.session_id,
  };
}

function appendDelta(state: ConversationState, position: number, delta: ItemTextDelta): ConversationState {
  const item = state.items.find((entry) => entry.id === delta.item.id);
  if (item && (finalized(item)
    || (ordered(item.payload) && delta.stream_seq <= item.payload.blocks.length))) return state;
  const previous = state.pending[delta.item.id];
  if (previous?.fragments[delta.stream_seq]) return state;
  const next = {
    ...state,
    pending: {
      ...state.pending,
      [delta.item.id]: {
        itemSequenceNo: previous?.itemSequenceNo ?? position,
        fragments: { ...previous?.fragments, [delta.stream_seq]: delta },
      },
    },
  };
  return item ? mergeProjection(next, item) : next;
}

function replaceContent(state: ConversationState, position: number, snapshot: AgentItemSnapshot): ConversationState {
  const previous = state.items.find((entry) => entry.id === snapshot.item.id);
  return mergeProjection(state, {
    id: snapshot.item.id,
    user_id: previous?.user_id ?? state.userId,
    session_id: previous?.session_id ?? state.sessionId,
    sequence_no: previous?.sequence_no ?? state.pending[snapshot.item.id]?.itemSequenceNo ?? position,
    source: snapshot.source,
    kind: snapshot.kind,
    run_id: snapshot.item.turn.run.id,
    turn_id: snapshot.item.turn.id,
    item_index: snapshot.item.item_index,
    input_sequence_no: previous?.input_sequence_no ?? null,
    status: snapshot.status,
    call_id: snapshot.call_id,
    tool_name: snapshot.tool_name,
    task_id: previous?.task_id ?? null,
    payload: snapshot.payload,
    source_revision: snapshot.source_revision,
    completed_at: snapshot.completed_at,
    version: previous?.version ?? null,
    created_at: previous?.created_at ?? null,
    updated_at: previous?.updated_at ?? null,
  });
}

export function applyEvent(state: ConversationState, event: SessionEvent): ConversationState {
  if (event.sequence <= state.cursor) return state;
  const next = { ...state, cursor: event.sequence };
  switch (event.type) {
    case 'ITEM_CREATED':
      return mergeItem(next, event.payload.body);
    case 'ITEM_TEXT_DELTA':
      return appendDelta(next, event.payload.item_sequence_no, event.payload.body);
    case 'ITEM_CONTENT_REPLACED':
      return replaceContent(next, event.payload.item_sequence_no, event.payload.body.snapshot);
    default:
      return next;
  }
}
