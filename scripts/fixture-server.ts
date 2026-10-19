import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import type {
  AgentItemIdentity, AgentItemSnapshot, AssetRecord, ContentBlock, ControlAcceptanceResponse, GenerationPlan, GenerationPlanSnapshot,
  InputAcceptanceResponse, ItemProjection, RunProjection, SessionPlanFocus,
  SessionProjectionPage, SessionRecord, TaskView, TurnProjection, ItemTextDelta, PlanPage,
} from '../src/api/types.ts';

export const FIXTURE_IDS = {
  user: '00000000-0000-0000-0000-000000000001',
  session: '10000000-0000-0000-0000-000000000001',
  task: '20000000-0000-0000-0000-000000000001',
  plan: '30000000-0000-0000-0000-000000000001',
  asset: '40000000-0000-0000-0000-000000000001',
} as const;

// A deterministic 1 × 1 PNG, used only as fixture media.
export const FIXTURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQSDnxHwAEYAJUCzaSjAAAAABJRU5ErkJggg==', 'base64');
const TIME = '2026-10-13T12:00:00.000000Z';

interface TitleInput { title: string }
interface FixtureUser { id: string; display_name: string; created_at: string }
interface UploadIdentity { filename: string; media_type: string; sha256: string }
interface MessageInput { client_request_id: string; content: ContentBlock[] }
interface BatchInput { ids: string[] }
interface StoredAsset { record: AssetRecord; bytes: Buffer }
interface MessageReceipt { fingerprint: string; response: InputAcceptanceResponse }
interface SessionReceipt { fingerprint: string; response: SessionRecord }
interface UploadReceipt { fingerprint: string; response: AssetRecord }
interface ControlReceipt { action: string; response: ControlAcceptanceResponse }
interface ReplacedBody { snapshot: AgentItemSnapshot }
interface ItemNotification { item_id: string; item_sequence_no: number; body: ItemProjection | ItemTextDelta | ReplacedBody }
interface RunNotification { run_id: string }
interface TurnNotification { turn_id: string }
interface TaskNotification { task_id: string }
interface TitleNotification { title: string }
interface FixturePlan extends GenerationPlan { frozen_request: null }
interface FixturePlanSnapshot extends GenerationPlanSnapshot { plan: FixturePlan }
type FixturePayload = ItemNotification | RunNotification | TurnNotification | TaskNotification | TitleNotification;
interface FixtureNotification { sequence: number; name: string; payload: FixturePayload }
interface FixtureSession {
  record: SessionRecord; items: ItemProjection[]; runs: RunProjection[]; turns: TurnProjection[];
  events: FixtureNotification[]; subscribers: Set<ServerResponse>; plans: FixturePlanSnapshot[]; focus: SessionPlanFocus;
}
interface FixtureProblem { type: string; title: string; status: number; detail: string }
export interface FixtureServer {
  server: Server;
  start: (port?: number) => Promise<string>;
  close: () => Promise<void>;
}

class FixtureError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new FixtureError(400, 'Expected a JSON object');
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new FixtureError(400, `Invalid ${field}`);
  return value;
}
function uuid(value: unknown, field: string): string {
  const identity = string(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity)) throw new FixtureError(400, `Invalid ${field} UUID`);
  return identity.toLowerCase();
}
function titleInput(value: unknown): TitleInput {
  const input = object(value);
  const title = string(input.title, 'title');
  if (title.length > 255) throw new FixtureError(400, 'Title is too long');
  return { title };
}
function messageInput(value: unknown): MessageInput {
  const input = object(value);
  const client_request_id = uuid(input.client_request_id, 'client_request_id');
  if (!Array.isArray(input.content) || input.content.length === 0) throw new FixtureError(400, 'Content must contain a block');
  const content: ContentBlock[] = input.content.map((value: unknown): ContentBlock => {
    const block = object(value);
    if (block.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text };
    if (block.type === 'asset') return { type: 'asset', asset_id: string(block.asset_id, 'asset_id') };
    throw new FixtureError(400, 'Unsupported content block');
  });
  return { client_request_id, content };
}
function batchInput(value: unknown): BatchInput {
  const input = object(value);
  if (!Array.isArray(input.ids)) throw new FixtureError(400, 'Expected ids');
  return { ids: input.ids.map((id: unknown) => string(id, 'task id')) };
}
async function bytes(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    length += buffer.length;
    if (length > 10 * 1024 * 1024) throw new FixtureError(413, 'Fixture upload limit is 10 MiB');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  try { return JSON.parse((await bytes(request)).toString('utf8')) as unknown; }
  catch (error) { if (error instanceof FixtureError) throw error; throw new FixtureError(400, 'Invalid JSON'); }
}
function respond<T>(response: ServerResponse, body: T, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
function key(request: IncomingMessage): string {
  return uuid(request.headers['idempotency-key'], 'Idempotency-Key');
}
function numberParam(url: URL, name: string, fallback: number, maximum: number): number {
  const value = Number(url.searchParams.get(name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new FixtureError(400, `Invalid ${name}`);
  return value;
}

export function createFixtureServer(): FixtureServer {
  let counter = 100;
  const id = (): string => `90000000-0000-0000-0000-${String(++counter).padStart(12, '0')}`;
  const sessions = new Map<string, FixtureSession>();
  const assets = new Map<string, StoredAsset>();
  const tasks = new Map<string, TaskView>();
  const messageReceipts = new Map<string, MessageReceipt>();
  const sessionReceipts = new Map<string, SessionReceipt>();
  const uploadReceipts = new Map<string, UploadReceipt>();
  const controlReceipts = new Map<string, ControlReceipt>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function publish(session: FixtureSession, name: string, payload: FixturePayload): void {
    const event: FixtureNotification = { sequence: session.events.length + 1, name, payload };
    session.events.push(event);
    for (const subscriber of session.subscribers) subscriber.write(frame(event));
  }
  function frame(event: FixtureNotification): string {
    return `id: ${event.sequence}\nevent: ${event.name}\ndata: ${JSON.stringify(event.payload)}\n\n`;
  }
  function schedule(delay: number, callback: () => void): void {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  }
  function sessionRecord(sessionId: string, title: string): SessionRecord {
    return { id: sessionId, user_id: FIXTURE_IDS.user, title, next_item_seq: 0, version: 1, created_at: TIME, updated_at: TIME };
  }
  function makeSession(sessionId: string, title: string): FixtureSession {
    return { record: sessionRecord(sessionId, title), items: [], runs: [], turns: [], events: [], subscribers: new Set(), plans: [], focus: { session_id: sessionId, active_plan_id: null, revision: 0 } };
  }
  function item(session: FixtureSession, source: string, kind: string, blocks: ContentBlock[]): ItemProjection {
    const sequence = session.record.next_item_seq + 1;
    session.record = { ...session.record, next_item_seq: sequence };
    return { id: id(), user_id: FIXTURE_IDS.user, session_id: session.record.id, sequence_no: sequence, source, kind,
      run_id: null, turn_id: null, item_index: null, input_sequence_no: source === 'USER' ? session.items.filter((value) => value.source === 'USER').length + 1 : null,
      status: 'COMPLETED', call_id: null, tool_name: null, task_id: null, payload: { blocks },
      source_revision: 1, completed_at: TIME, version: 1, created_at: TIME, updated_at: TIME };
  }
  const seed = makeSession(FIXTURE_IDS.session, 'Local fixture conversation');
  const image: AssetRecord = { id: FIXTURE_IDS.asset, user_id: FIXTURE_IDS.user, task_id: FIXTURE_IDS.task,
    filename: 'fixture-result.png', media_type: 'image/png', size_bytes: FIXTURE_PNG.length,
    sha256: createHash('sha256').update(FIXTURE_PNG).digest('hex'), created_at: TIME };
  assets.set(image.id, { record: image, bytes: FIXTURE_PNG });
  const task: TaskView = { id: FIXTURE_IDS.task, session_id: seed.record.id, kind: 'IMAGE', status: 'SUCCEEDED', version: 3,
    error_stage: null, error_code: null, error_message: null, finished_at: TIME, created_at: TIME, updated_at: TIME,
    assets: [image], plan_id: null };
  tasks.set(task.id, task);
  for (let index = 1; index <= 54; index++) {
    seed.items.push(item(seed, index % 2 ? 'USER' : 'AGENT', 'MESSAGE', [{ type: 'text', text: index % 2 ? `Earlier request ${Math.ceil(index / 2)}.` : `Earlier local response ${index / 2}.` }]));
  }
  const taskResult = item(seed, 'AGENT', 'TOOL_RESULT', []);
  taskResult.call_id = id(); taskResult.task_id = task.id;
  taskResult.payload = { type: 'task_query_snapshot', task_id: task.id, version: task.version, status: task.status,
    assets: [{ asset_id: image.id, source_index: 0 }], failure: null };
  seed.items.push(taskResult);
  const result = item(seed, 'AGENT', 'MESSAGE', [{ type: 'text', text: 'Your local image is ready.\nThis result uses deterministic fixture bytes.' }, { type: 'asset', asset_id: image.id }]);
  seed.items.push(result);
  const seedRun: RunProjection = { id: '50000000-0000-0000-0000-000000000001', user_id: FIXTURE_IDS.user,
    session_id: seed.record.id, run_index: 1, source_revision: 2, status: 'COMPLETED', started_at: TIME, finished_at: TIME,
    final_item_id: result.id, error_code: null, error_message: null, last_seen_at: TIME, version: 2, created_at: TIME, updated_at: TIME };
  const seedTurn: TurnProjection = { id: '60000000-0000-0000-0000-000000000001', user_id: FIXTURE_IDS.user,
    session_id: seed.record.id, run_id: seedRun.id, turn_index: 1, source_revision: 2, status: 'COMPLETED', started_at: TIME,
    finished_at: TIME, error_code: null, error_message: null, version: 2, created_at: TIME, updated_at: TIME };
  seed.runs.push(seedRun); seed.turns.push(seedTurn);
  let seedItemIndex = 0;
  for (const projection of seed.items) if (projection.source === 'AGENT') {
    projection.run_id = seedRun.id; projection.turn_id = seedTurn.id; projection.item_index = ++seedItemIndex;
  }
  seed.plans = [{ plan: { type: 'generation_plan', schema_version: 1, id: FIXTURE_IDS.plan, user_id: FIXTURE_IDS.user,
    session_id: seed.record.id, revision: 1, state: 'DRAFT', created_at: TIME, updated_at: TIME, frozen_at: null, frozen_request: null,
    configuration: { type: 'image_plan_configuration', model_selection: null,
      intent: { type: 'image_intent', description: 'A small local sample image', requirements: { type: 'image_requirements', prompt: 'A calm lake at dawn', size: null, requested_file_count: 1, references: [], output_format: 'PNG', generation_mode: 'IMAGE' } },
      parameters: { type: 'image_parameters', prompt: 'A calm lake at dawn', size: null, references: [], output_format: 'PNG' }, parameter_origins: [] } },
    validation: { can_submit: false, validated_catalog_revision: 1, issues: [{ code: 'MODEL_REQUIRED', field: 'MODEL', reference_index: null, message: 'Select a model through the agent before submission.', model_selection: null }] } }];
  seed.focus = { session_id: seed.record.id, active_plan_id: FIXTURE_IDS.plan, revision: 1 };
  sessions.set(seed.record.id, seed);

  function requireSession(sessionId: string): FixtureSession {
    const session = sessions.get(sessionId);
    if (!session) throw new FixtureError(404, 'Session not found');
    return session;
  }
  function requireAsset(assetId: string): StoredAsset {
    const asset = assets.get(assetId);
    if (!asset) throw new FixtureError(404, 'Asset not found');
    return asset;
  }
  function requireTask(taskId: string): TaskView {
    const value = tasks.get(taskId);
    if (!value) throw new FixtureError(404, 'Task not found');
    return value;
  }
  function streamReply(session: FixtureSession): void {
    const run: RunProjection = { id: id(), user_id: FIXTURE_IDS.user, session_id: session.record.id, run_index: session.runs.length + 1,
      source_revision: 1, status: 'RUNNING', started_at: TIME, finished_at: null, final_item_id: null, error_code: null,
      error_message: null, last_seen_at: TIME, version: 1, created_at: TIME, updated_at: TIME };
    const turn: TurnProjection = { id: id(), user_id: FIXTURE_IDS.user, session_id: session.record.id, run_id: run.id, turn_index: 1,
      source_revision: 1, status: 'RUNNING', started_at: TIME, finished_at: null, error_code: null, error_message: null,
      version: 1, created_at: TIME, updated_at: TIME };
    session.runs.push(run); session.turns.push(turn);
    publish(session, 'RUN_UPDATED', { run_id: run.id });
    publish(session, 'TURN_UPDATED', { turn_id: turn.id });
    const assistant = item(session, 'AGENT', 'MESSAGE', []);
    assistant.run_id = run.id; assistant.turn_id = turn.id; assistant.item_index = 1; assistant.status = 'PARTIAL'; assistant.completed_at = null;
    session.items.push(assistant);
    const identity: AgentItemIdentity = { id: assistant.id, item_index: 1, turn: { id: turn.id, turn_index: 1, run: { id: run.id, run_index: run.run_index } } };
    publish(session, 'ITEM_CREATED', { item_id: assistant.id, item_sequence_no: assistant.sequence_no, body: { ...assistant } });
    const fragments = ['Local fixture response.\n', 'Your image is ready.'];
    fragments.forEach((text, index) => schedule(120 + index * 140, () => {
      assistant.payload = { blocks: fragments.slice(0, index + 1).map((part) => ({ type: 'text', text: part })) };
      publish(session, 'ITEM_TEXT_DELTA', { item_id: assistant.id, item_sequence_no: assistant.sequence_no, body: { item: identity, stream_seq: index + 1, text } });
    }));
    schedule(500, () => {
      const taskId = id();
      const generatedAsset: AssetRecord = { ...image, id: id(), task_id: taskId };
      assets.set(generatedAsset.id, { record: generatedAsset, bytes: FIXTURE_PNG });
      const generatedTask: TaskView = { ...task, id: taskId, session_id: session.record.id, assets: [generatedAsset] };
      tasks.set(generatedTask.id, generatedTask);
      assistant.task_id = generatedTask.id; assistant.status = 'COMPLETED'; assistant.completed_at = TIME; assistant.source_revision = 2; assistant.version = 2;
      const blocks: ContentBlock[] = [{ type: 'text', text: fragments.join('') }, { type: 'asset', asset_id: generatedAsset.id }];
      assistant.payload = { blocks };
      publish(session, 'ITEM_CONTENT_REPLACED', { item_id: assistant.id, item_sequence_no: assistant.sequence_no,
        body: { snapshot: { item: identity, source: 'AGENT', source_revision: 2, kind: 'MESSAGE', status: 'COMPLETED', payload: { blocks }, completed_at: TIME, call_id: null, tool_name: null } } });
      publish(session, 'TASK_UPDATED', { task_id: generatedTask.id });
      run.status = 'COMPLETED'; run.finished_at = TIME; run.final_item_id = assistant.id; run.source_revision = 2; run.version = 2;
      turn.status = 'COMPLETED'; turn.finished_at = TIME; turn.source_revision = 2; turn.version = 2;
      publish(session, 'TURN_UPDATED', { turn_id: turn.id }); publish(session, 'RUN_UPDATED', { run_id: run.id });
    });
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'users' || parts[3] !== FIXTURE_IDS.user) throw new FixtureError(404, 'Resource not found');
    if (parts.length === 4 && request.method === 'GET') {
      const user: FixtureUser = { id: FIXTURE_IDS.user, display_name: 'Local fixture user', created_at: TIME };
      return respond(response, user);
    }
    if (parts[4] === 'runs' && request.method === 'GET') {
      const run = [...sessions.values()].flatMap((session) => session.runs).find((value) => value.id === parts[5]);
      if (!run) throw new FixtureError(404, 'Run not found');
      return respond(response, run);
    }
    if (parts[4] === 'tasks') {
      if (parts[5] === 'batch' && request.method === 'POST') return respond(response, batchInput(await jsonBody(request)).ids.map(requireTask));
      if (parts.length === 6 && request.method === 'GET') return respond(response, requireTask(parts[5]));
    }
    if (parts[4] === 'assets') {
      if (parts.length === 5 && request.method === 'POST') {
        const operation = key(request);
        const body = await bytes(request);
        const uploadRequest = new Request('http://127.0.0.1', { method: 'POST', headers: { 'Content-Type': request.headers['content-type'] ?? '' }, body: new Uint8Array(body) });
        let form: FormData;
        try { form = await uploadRequest.formData(); } catch { throw new FixtureError(400, 'Expected multipart file'); }
        const file = form.get('file');
        if (!(file instanceof File)) throw new FixtureError(400, 'Missing multipart file');
        const fileBytes = Buffer.from(await file.arrayBuffer());
        const sha256 = createHash('sha256').update(fileBytes).digest('hex');
        const identity: UploadIdentity = { filename: file.name, media_type: file.type, sha256 };
        const fingerprint = JSON.stringify(identity);
        const prior = uploadReceipts.get(operation);
        if (prior) { if (prior.fingerprint !== fingerprint) throw new FixtureError(409, 'Operation identity conflict'); return respond(response, prior.response); }
        const record: AssetRecord = { id: id(), user_id: FIXTURE_IDS.user, task_id: null, filename: file.name, media_type: file.type || 'application/octet-stream', size_bytes: fileBytes.length, sha256, created_at: TIME };
        assets.set(record.id, { record, bytes: fileBytes }); uploadReceipts.set(operation, { fingerprint, response: record });
        return respond(response, record);
      }
      const asset = requireAsset(parts[5]);
      if (parts.length === 6 && request.method === 'GET') return respond(response, asset.record);
      if (parts.length === 7 && parts[6] === 'content' && (request.method === 'GET' || request.method === 'HEAD')) {
        let start = 0; let end = asset.bytes.length - 1; let status = 200;
        const range = request.headers.range;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) throw new FixtureError(416, 'Invalid byte range');
          start = match[1] ? Number(match[1]) : Math.max(0, asset.bytes.length - Number(match[2]));
          end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
          if (start > end || start >= asset.bytes.length) throw new FixtureError(416, 'Unsatisfiable byte range');
          status = 206;
        }
        response.setHeader('Content-Type', asset.record.media_type); response.setHeader('Content-Length', end - start + 1);
        response.setHeader('Accept-Ranges', 'bytes'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
        if (status === 206) response.setHeader('Content-Range', `bytes ${start}-${end}/${asset.bytes.length}`);
        response.writeHead(status); response.end(request.method === 'HEAD' ? undefined : asset.bytes.subarray(start, end + 1)); return;
      }
    }
    if (parts[4] !== 'sessions') throw new FixtureError(404, 'Resource not found');
    if (parts.length === 5) {
      if (request.method === 'GET') return respond(response, [...sessions.values()].map((session) => session.record).reverse().slice(0, numberParam(url, 'limit', 50, 100)));
      if (request.method === 'POST') {
        const input = titleInput(await jsonBody(request)); const operation = `create:${key(request)}`; const fingerprint = JSON.stringify(input);
        const prior = sessionReceipts.get(operation);
        if (prior) { if (prior.fingerprint !== fingerprint) throw new FixtureError(409, 'Operation identity conflict'); return respond(response, prior.response, 201); }
        const session = makeSession(id(), input.title); sessions.set(session.record.id, session); sessionReceipts.set(operation, { fingerprint, response: session.record });
        return respond(response, session.record, 201);
      }
    }
    const session = requireSession(parts[5]);
    if (parts.length === 6) {
      if (request.method === 'GET') return respond(response, session.record);
      if (request.method === 'PATCH') {
        const input = titleInput(await jsonBody(request)); const operation = `rename:${session.record.id}:${key(request)}`; const fingerprint = JSON.stringify(input);
        const prior = sessionReceipts.get(operation);
        if (prior) { if (prior.fingerprint !== fingerprint) throw new FixtureError(409, 'Operation identity conflict'); return respond(response, prior.response); }
        session.record = { ...session.record, title: input.title, version: session.record.version + 1 };
        sessionReceipts.set(operation, { fingerprint, response: session.record }); publish(session, 'SESSION_UPDATED', input);
        return respond(response, session.record);
      }
    }
    if (parts[6] === 'items' && request.method === 'GET') {
      if (parts.length === 8) { const projection = session.items.find((value) => value.id === parts[7]); if (!projection) throw new FixtureError(404, 'Item not found'); return respond(response, projection); }
      const limit = numberParam(url, 'limit', 50, 200); const before = numberParam(url, 'before', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      const available = session.items.filter((value) => value.sequence_no < before);
      const pageItems = available.slice(-limit);
      const page: SessionProjectionPage = { items: pageItems, runs: session.runs, turns: session.turns,
        next_before_sequence_no: available.length > limit ? pageItems[0].sequence_no : null, last_event_sequence_no: session.events.length };
      return respond(response, page);
    }
    if (parts[6] === 'messages' && request.method === 'POST') {
      const input = messageInput(await jsonBody(request)); const operation = `${session.record.id}:${input.client_request_id}`; const fingerprint = JSON.stringify(input);
      const prior = messageReceipts.get(operation);
      if (prior) { if (prior.fingerprint !== fingerprint) throw new FixtureError(409, 'Message identity conflict'); return respond(response, prior.response, 202); }
      for (const block of input.content) if (block.type === 'asset') requireAsset(block.asset_id);
      const projection = item(session, 'USER', 'MESSAGE', input.content); session.items.push(projection);
      const receipt: InputAcceptanceResponse = { item: { id: projection.id, sequence_no: projection.sequence_no, input_sequence_no: projection.input_sequence_no!, source: 'USER', kind: 'MESSAGE', content: { blocks: input.content } } };
      messageReceipts.set(operation, { fingerprint, response: receipt }); publish(session, 'ITEM_CREATED', { item_id: projection.id, item_sequence_no: projection.sequence_no, body: projection });
      schedule(30, () => streamReply(session));
      return respond(response, receipt, 202);
    }
    if ((parts[6] === 'stop' || parts[6] === 'continue') && request.method === 'POST') {
      const action = `${session.record.id}:${parts[6]}`; const operation = key(request); const prior = controlReceipts.get(operation);
      if (prior) { if (prior.action !== action) throw new FixtureError(409, 'Operation identity conflict'); return respond(response, prior.response, 202); }
      const receipt: ControlAcceptanceResponse = { event_id: id() }; controlReceipts.set(operation, { action, response: receipt }); return respond(response, receipt, 202);
    }
    if (parts[6] === 'events' && request.method === 'GET') {
      const after = Number(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) throw new FixtureError(400, 'Invalid event cursor');
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      response.write(': fixture connected\n\n');
      for (const event of session.events) if (event.sequence > after) response.write(frame(event));
      session.subscribers.add(response); response.on('close', () => session.subscribers.delete(response)); return;
    }
    if (parts[6] === 'plan-focus' && request.method === 'GET') return respond(response, session.focus);
    if (parts[6] === 'plans' && request.method === 'GET') {
      if (parts.length === 8) { const plan = session.plans.find((value) => value.plan.id === parts[7]); if (!plan) throw new FixtureError(404, 'Plan not found'); return respond(response, plan); }
      const beforeCreatedAt = url.searchParams.get('beforeCreatedAt'); const beforeId = url.searchParams.get('beforeId');
      if ((beforeCreatedAt === null) !== (beforeId === null)) throw new FixtureError(400, 'Both cursor fields are required');
      const plans = session.plans.filter((value) => beforeCreatedAt === null || value.plan.created_at < beforeCreatedAt || (value.plan.created_at === beforeCreatedAt && value.plan.id < beforeId!));
      const limit = numberParam(url, 'limit', 20, 100); const selected = plans.slice(0, limit); const last = selected.at(-1);
      const page: PlanPage = { type: 'generation_plan_read_result', focus: session.focus, plans: selected,
        next_cursor: plans.length > limit && last ? { before_created_at: last.plan.created_at, before_id: last.plan.id } : null };
      return respond(response, page);
    }
    if (parts[6] === 'execution-events' && request.method === 'GET') return respond(response, []);
    throw new FixtureError(404, 'Resource not found');
  }
  const server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      const status = error instanceof FixtureError ? error.status : 500;
      const detail = error instanceof Error ? error.message : 'Fixture error';
      const problem: FixtureProblem = { type: 'about:blank', title: status === 404 ? 'Not Found' : 'Request failed', status, detail };
      if (!response.headersSent) respond(response, problem, status); else response.end();
    });
  });
  return {
    server,
    start: (port = 0) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const address = server.address();
        if (address === null || typeof address === 'string') return reject(new Error('No fixture TCP address'));
        resolve(`http://127.0.0.1:${address.port}`);
      });
    }),
    close: () => new Promise((resolve, reject) => {
      for (const timer of timers) clearTimeout(timer);
      for (const session of sessions.values()) for (const subscriber of session.subscribers) subscriber.end();
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = createFixtureServer();
  const port = Number(process.env.FIXTURE_PORT ?? 18080);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid FIXTURE_PORT');
  console.log(`Lux local fixture listening at ${await fixture.start(port)}`);
  const shutdown = (): void => { void fixture.close().then(() => process.exit(0)); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
