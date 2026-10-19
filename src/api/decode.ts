import type {
  AgentItemIdentity, AgentItemSnapshot, AssetRecord, ContentBlock, ControlAcceptanceResponse,
  DraftOutputSize, GenerationPlanSnapshot, ImageParameters, ImageRequirements, InputAcceptanceResponse,
  ItemPayload, ItemProjection, ItemTextDelta, ModelSelection, OpaqueJson, OrderedContent,
  ParameterOrigin, PlanConfiguration, PlanPage, PlansCursor, ProblemDetail, ReferenceAsset,
  RunProjection, SessionEvent, SessionPlanFocus, SessionProjectionPage, SessionRecord, TaskView,
  TurnProjection, ValidationIssue, VideoParameters, VideoRequirements,
} from './types';

export function referencedTaskIds(item: Pick<ItemProjection, 'kind' | 'task_id' | 'payload'>): string[] {
  const ids = new Set<string>();
  if (item.task_id) ids.add(item.task_id);
  const content = item.payload;
  if (content && 'task_id' in content) ids.add(content.task_id);
  if (content && 'type' in content && content.type === 'plan_task_submission_receipt') {
    for (const task of content.tasks) ids.add(task.task_id);
  }
  return [...ids];
}

// Anonymous JSON exists only at this ingress boundary; every return value is a named contract.
type JsonObject = Record<string, unknown>;
type Decoder<T> = (value: unknown) => T;
function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return value as JsonObject;
}
function string(value: unknown, field = 'string'): string {
  if (typeof value !== 'string') throw new Error('Invalid ' + field);
  return value;
}
function number(value: unknown, field = 'number', minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid ' + field);
  return value;
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid ' + field);
  return value;
}
function id(value: unknown, field = 'id'): string {
  const result = string(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result)) throw new Error('Invalid ' + field);
  return result;
}
function time(value: unknown, field: string): string {
  const result = string(value, field);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid ' + field);
  return result;
}
function nullable<T>(value: unknown, decode: Decoder<T>): T | null {
  return value === undefined || value === null ? null : decode(value);
}
export function decodeList<T>(value: unknown, decode: Decoder<T>): T[] {
  if (!Array.isArray(value)) throw new Error('Expected JSON array');
  return value.map(decode);
}
function literal<T extends string | number | boolean>(value: unknown, expected: T): T {
  if (value !== expected) throw new Error('Expected ' + expected);
  return expected;
}
export function parseJson(data: string): unknown { return JSON.parse(data) as unknown; }
function contentBlock(value: unknown): ContentBlock {
  const data = object(value);
  if (data.type === 'text') return { type: 'text', text: string(data.text, 'text') };
  if (data.type === 'asset') return { type: 'asset', asset_id: id(data.asset_id, 'asset_id') };
  throw new Error('Unsupported content block');
}
function orderedContent(value: unknown): OrderedContent {
  return { blocks: decodeList(object(value).blocks, contentBlock) };
}
function opaque(value: unknown): OpaqueJson {
  // Parsed JSON tool arguments are retained, but their provider-owned schema is never read here.
  if (value === undefined) throw new Error('Missing tool arguments');
  return value as OpaqueJson;
}
function payload(value: unknown, kind: string | null): ItemPayload {
  const data = object(value);
  if (kind === 'MESSAGE' || kind === 'REASONING_SUMMARY') return orderedContent(data);
  if (kind === 'TASK_EVENT') return { task_id: id(data.task_id, 'task_id') };
  if (kind === 'TOOL_CALL') return { arguments: opaque(data.arguments) };
  if (kind !== 'TOOL_RESULT') throw new Error('Unsupported Item payload kind');
  switch (data.type) {
    case 'task_submission_receipt': return {
      type: data.type, task_id: id(data.task_id, 'task_id'), accepted: bool(data.accepted, 'accepted'),
    };
    case 'task_query_snapshot': return {
      type: data.type, task_id: id(data.task_id, 'task_id'), version: number(data.version, 'version', 1),
      status: string(data.status, 'status'), assets: decodeList(data.assets, value => {
        const asset = object(value);
        return { asset_id: id(asset.asset_id, 'asset_id'), source_index: number(asset.source_index, 'source_index') };
      }), failure: nullable(data.failure, value => {
        const failure = object(value);
        return { stage: string(failure.stage, 'stage'), code: string(failure.code, 'code'), message: string(failure.message, 'message') };
      }),
    };
    case 'tool_error': return { type: data.type, code: string(data.code, 'code'), message: string(data.message, 'message') };
    case 'plan_task_submission_receipt': return {
      type: data.type, plan_id: id(data.plan_id, 'plan_id'), frozen_plan_revision: number(data.frozen_plan_revision, 'frozen_plan_revision', 1),
      accepted: literal(data.accepted, true),
      requested_file_count: number(data.requested_file_count, 'requested_file_count', 1),
      tasks: decodeList(data.tasks, value => {
        const task = object(value);
        return { index: number(task.index, 'index'), task_id: id(task.task_id, 'task_id'), task_operation_id: id(task.task_operation_id, 'task_operation_id') };
      }), focus: decodeFocus(data.focus),
    };
    case 'generation_plan_read_result': return decodePlanPage(data);
    case 'generation_plan_mutation_receipt': return {
      type: data.type, action: string(data.action, 'action'), source_plan_id: nullable(data.source_plan_id, value => id(value, 'source_plan_id')),
      snapshot: decodePlan(data.snapshot), focus: decodeFocus(data.focus),
    };
    case 'generation_plan_focus_receipt': return { type: data.type, focus: decodeFocus(data.focus) };
    case 'generation_plan_tool_rejection': return {
      type: data.type, code: string(data.code, 'code'), message: string(data.message, 'message'),
      current_plan_revision: nullable(data.current_plan_revision, value => number(value, 'current_plan_revision')),
      current_focus_revision: nullable(data.current_focus_revision, value => number(value, 'current_focus_revision')),
      issues: decodeList(data.issues, issue), business_execution: literal(data.business_execution, 'NOT_PERFORMED'),
    };
    case 'model_catalog_snapshot': return { type: data.type };
    default: throw new Error('Unsupported tool result');
  }
}
export function decodeSession(value: unknown): SessionRecord {
  const data = object(value);
  return { id: id(data.id), user_id: id(data.user_id, 'user_id'), title: string(data.title, 'title'),
    next_item_seq: number(data.next_item_seq, 'next_item_seq'), version: number(data.version, 'version', 1),
    created_at: time(data.created_at, 'created_at'), updated_at: time(data.updated_at, 'updated_at') };
}
export function decodeItem(value: unknown): ItemProjection {
  const data = object(value);
  const kind = nullable(data.kind, value => string(value, 'kind'));
  return {
    id: id(data.id), user_id: id(data.user_id, 'user_id'), session_id: id(data.session_id, 'session_id'),
    sequence_no: number(data.sequence_no, 'sequence_no', 1), source: string(data.source, 'source'), kind,
    run_id: nullable(data.run_id, value => id(value, 'run_id')), turn_id: nullable(data.turn_id, value => id(value, 'turn_id')),
    item_index: nullable(data.item_index, value => number(value, 'item_index', 1)),
    input_sequence_no: nullable(data.input_sequence_no, value => number(value, 'input_sequence_no', 1)),
    status: nullable(data.status, value => string(value, 'status')), call_id: nullable(data.call_id, value => string(value, 'call_id')),
    tool_name: nullable(data.tool_name, value => string(value, 'tool_name')), task_id: nullable(data.task_id, value => id(value, 'task_id')),
    payload: nullable(data.payload, value => payload(value, kind)), source_revision: number(data.source_revision, 'source_revision'),
    completed_at: nullable(data.completed_at, value => time(value, 'completed_at')), version: number(data.version, 'version', 1),
    created_at: time(data.created_at, 'created_at'), updated_at: time(data.updated_at, 'updated_at'),
  };
}
export function decodeRun(value: unknown): RunProjection {
  const data = object(value);
  return {
    id: id(data.id), user_id: id(data.user_id, 'user_id'), session_id: id(data.session_id, 'session_id'),
    run_index: number(data.run_index, 'run_index', 1), source_revision: number(data.source_revision, 'source_revision'),
    status: nullable(data.status, value => string(value, 'status')), started_at: nullable(data.started_at, value => time(value, 'started_at')),
    finished_at: nullable(data.finished_at, value => time(value, 'finished_at')), final_item_id: nullable(data.final_item_id, value => id(value, 'final_item_id')),
    error_code: nullable(data.error_code, value => string(value, 'error_code')), error_message: nullable(data.error_message, value => string(value, 'error_message')),
    last_seen_at: nullable(data.last_seen_at, value => time(value, 'last_seen_at')), version: number(data.version, 'version', 1),
    created_at: time(data.created_at, 'created_at'), updated_at: time(data.updated_at, 'updated_at'),
  };
}
export function decodeTurn(value: unknown): TurnProjection {
  const data = object(value);
  return {
    id: id(data.id), user_id: id(data.user_id, 'user_id'), session_id: id(data.session_id, 'session_id'), run_id: id(data.run_id, 'run_id'),
    turn_index: number(data.turn_index, 'turn_index', 1), source_revision: number(data.source_revision, 'source_revision'), status: nullable(data.status, value => string(value, 'status')),
    started_at: nullable(data.started_at, value => time(value, 'started_at')), finished_at: nullable(data.finished_at, value => time(value, 'finished_at')),
    error_code: nullable(data.error_code, value => string(value, 'error_code')), error_message: nullable(data.error_message, value => string(value, 'error_message')),
    version: number(data.version, 'version', 1), created_at: time(data.created_at, 'created_at'), updated_at: time(data.updated_at, 'updated_at'),
  };
}
export function decodePage(value: unknown): SessionProjectionPage {
  const data = object(value);
  return { items: decodeList(data.items, decodeItem), runs: decodeList(data.runs, decodeRun), turns: decodeList(data.turns, decodeTurn),
    next_before_sequence_no: nullable(data.next_before_sequence_no, value => number(value, 'next_before_sequence_no', 1)),
    last_event_sequence_no: number(data.last_event_sequence_no, 'last_event_sequence_no') };
}
export function decodeInputAcceptance(value: unknown): InputAcceptanceResponse {
  const data = object(object(value).item);
  return { item: { id: id(data.id), sequence_no: number(data.sequence_no, 'sequence_no', 1), input_sequence_no: number(data.input_sequence_no, 'input_sequence_no', 1),
    source: string(data.source, 'source'), kind: string(data.kind, 'kind'), content: orderedContent(data.content) } };
}
export function decodeControl(value: unknown): ControlAcceptanceResponse { return { event_id: id(object(value).event_id, 'event_id') }; }
export function decodeAsset(value: unknown): AssetRecord {
  const data = object(value);
  const sha256 = string(data.sha256, 'sha256');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Invalid sha256');
  return { id: id(data.id), user_id: id(data.user_id, 'user_id'), task_id: nullable(data.task_id, value => id(value, 'task_id')),
    filename: string(data.filename, 'filename'), media_type: string(data.media_type, 'media_type'), size_bytes: number(data.size_bytes, 'size_bytes'),
    sha256, created_at: time(data.created_at, 'created_at') };
}
export function decodeTask(value: unknown): TaskView {
  const data = object(value);
  return { id: id(data.id), session_id: id(data.session_id, 'session_id'), kind: string(data.kind, 'kind'), status: string(data.status, 'status'),
    version: number(data.version, 'version', 1), error_stage: nullable(data.error_stage, value => string(value, 'error_stage')),
    error_code: nullable(data.error_code, value => string(value, 'error_code')), error_message: nullable(data.error_message, value => string(value, 'error_message')),
    finished_at: nullable(data.finished_at, value => time(value, 'finished_at')), created_at: time(data.created_at, 'created_at'), updated_at: time(data.updated_at, 'updated_at'),
    assets: decodeList(data.assets, decodeAsset), plan_id: nullable(data.plan_id, value => id(value, 'plan_id')) };
}
function identity(value: unknown): AgentItemIdentity {
  const data = object(value);
  const turn = object(data.turn);
  const run = object(turn.run);
  return { id: id(data.id), item_index: number(data.item_index, 'item_index', 1), turn: {
    id: id(turn.id), turn_index: number(turn.turn_index, 'turn_index', 1), run: { id: id(run.id), run_index: number(run.run_index, 'run_index', 1) },
  } };
}
function agentItem(value: unknown): AgentItemSnapshot {
  const data = object(value);
  const kind = string(data.kind, 'kind');
  return { item: identity(data.item), source: string(data.source, 'source'), source_revision: number(data.source_revision, 'source_revision', 1), kind,
    status: string(data.status, 'status'), payload: payload(data.payload, kind), completed_at: nullable(data.completed_at, value => time(value, 'completed_at')),
    call_id: nullable(data.call_id, value => string(value, 'call_id')), tool_name: nullable(data.tool_name, value => string(value, 'tool_name')) };
}
function delta(value: unknown): ItemTextDelta {
  const data = object(value);
  return { item: identity(data.item), stream_seq: number(data.stream_seq, 'stream_seq', 1), text: string(data.text, 'text') };
}
export function decodeFocus(value: unknown): SessionPlanFocus {
  const data = object(value);
  return { session_id: id(data.session_id, 'session_id'), active_plan_id: nullable(data.active_plan_id, value => id(value, 'active_plan_id')), revision: number(data.revision, 'revision') };
}
function modelSelection(value: unknown): ModelSelection {
  const data = object(value);
  return { model_id: string(data.model_id, 'model_id'), profile_id: string(data.profile_id, 'profile_id'), capability_revision: number(data.capability_revision, 'capability_revision', 1) };
}
function outputSize(value: unknown): DraftOutputSize {
  const data = object(value);
  if (data.type === 'ratio_size') return { type: data.type, aspect_ratio: nullable(data.aspect_ratio, value => {
    const ratio = object(value);
    return { width_units: number(ratio.width_units, 'width_units', 1), height_units: number(ratio.height_units, 'height_units', 1) };
  }), resolution_id: nullable(data.resolution_id, value => string(value, 'resolution_id')) };
  if (data.type === 'pixel_size') {
    const dimensions = object(data.dimensions);
    return { type: data.type, dimensions: { width: number(dimensions.width, 'width', 1), height: number(dimensions.height, 'height', 1) } };
  }
  throw new Error('Unsupported output size');
}
function reference(value: unknown): ReferenceAsset {
  const data = object(value);
  return { type: literal(data.type, 'reference_asset'), asset_id: id(data.asset_id, 'asset_id') };
}
function imageRequirements(value: unknown): ImageRequirements {
  const data = object(value);
  return { type: literal(data.type, 'image_requirements'), prompt: nullable(data.prompt, value => string(value, 'prompt')),
    size: nullable(data.size, outputSize), requested_file_count: nullable(data.requested_file_count, value => number(value, 'requested_file_count', 1)),
    references: nullable(data.references, value => decodeList(value, reference)), output_format: nullable(data.output_format, value => string(value, 'output_format')),
    generation_mode: nullable(data.generation_mode, value => string(value, 'generation_mode')) };
}
function videoRequirements(value: unknown): VideoRequirements {
  const data = object(value);
  return { type: literal(data.type, 'video_requirements'), prompt: nullable(data.prompt, value => string(value, 'prompt')),
    size: nullable(data.size, outputSize), requested_file_count: nullable(data.requested_file_count, value => number(value, 'requested_file_count', 1)),
    references: nullable(data.references, value => decodeList(value, reference)), output_format: nullable(data.output_format, value => string(value, 'output_format')),
    duration_seconds: nullable(data.duration_seconds, value => number(value, 'duration_seconds', 1)), generate_audio: nullable(data.generate_audio, value => bool(value, 'generate_audio')),
    generation_mode: nullable(data.generation_mode, value => string(value, 'generation_mode')) };
}
function imageParameters(value: unknown): ImageParameters {
  const data = object(value);
  return { type: literal(data.type, 'image_parameters'), prompt: nullable(data.prompt, value => string(value, 'prompt')), size: nullable(data.size, outputSize),
    references: decodeList(data.references, reference), output_format: nullable(data.output_format, value => string(value, 'output_format')) };
}
function videoParameters(value: unknown): VideoParameters {
  const data = object(value);
  return { type: literal(data.type, 'video_parameters'), prompt: nullable(data.prompt, value => string(value, 'prompt')), size: nullable(data.size, outputSize),
    references: decodeList(data.references, reference), output_format: nullable(data.output_format, value => string(value, 'output_format')),
    duration_seconds: nullable(data.duration_seconds, value => number(value, 'duration_seconds', 1)), generate_audio: nullable(data.generate_audio, value => bool(value, 'generate_audio')) };
}
function origin(value: unknown): ParameterOrigin {
  const data = object(value);
  return { field: string(data.field, 'field'), source: string(data.source, 'source'), source_model: nullable(data.source_model, modelSelection) };
}
function configuration(value: unknown): PlanConfiguration {
  const data = object(value);
  const intent = object(data.intent);
  const model_selection = nullable(data.model_selection, modelSelection);
  const parameter_origins = decodeList(data.parameter_origins, origin);
  if (data.type === 'image_plan_configuration') return { type: data.type, model_selection, parameter_origins,
    intent: { type: literal(intent.type, 'image_intent'), description: string(intent.description, 'description'), requirements: imageRequirements(intent.requirements) },
    parameters: imageParameters(data.parameters) };
  if (data.type === 'video_plan_configuration') return { type: data.type, model_selection, parameter_origins,
    intent: { type: literal(intent.type, 'video_intent'), description: string(intent.description, 'description'), requirements: videoRequirements(intent.requirements) },
    parameters: videoParameters(data.parameters) };
  throw new Error('Unsupported plan configuration');
}
function issue(value: unknown): ValidationIssue {
  const data = object(value);
  return { code: string(data.code, 'code'), field: string(data.field, 'field'), reference_index: nullable(data.reference_index, value => number(value, 'reference_index')),
    message: string(data.message, 'message'), model_selection: nullable(data.model_selection, modelSelection) };
}
export function decodePlan(value: unknown): GenerationPlanSnapshot {
  const data = object(value);
  const plan = object(data.plan);
  const validation = object(data.validation);
  if (plan.state !== 'DRAFT' && plan.state !== 'FROZEN') throw new Error('Invalid plan state');
  if (plan.schema_version !== 1) throw new Error('Unsupported plan schema_version');
  return { plan: { type: literal(plan.type, 'generation_plan'), schema_version: 1, id: id(plan.id), user_id: id(plan.user_id, 'user_id'),
    session_id: id(plan.session_id, 'session_id'), revision: number(plan.revision, 'revision', 1), state: plan.state, configuration: configuration(plan.configuration),
    created_at: time(plan.created_at, 'created_at'), updated_at: time(plan.updated_at, 'updated_at'), frozen_at: nullable(plan.frozen_at, value => time(value, 'frozen_at')) },
    validation: { can_submit: bool(validation.can_submit, 'can_submit'), issues: decodeList(validation.issues, issue),
      validated_catalog_revision: number(validation.validated_catalog_revision, 'validated_catalog_revision') } };
}
function cursor(value: unknown): PlansCursor {
  const data = object(value);
  return { before_created_at: time(data.before_created_at, 'before_created_at'), before_id: id(data.before_id, 'before_id') };
}
export function decodePlanPage(value: unknown): PlanPage {
  const data = object(value);
  return { type: literal(data.type, 'generation_plan_read_result'), focus: decodeFocus(data.focus), plans: decodeList(data.plans, decodePlan), next_cursor: nullable(data.next_cursor, cursor) };
}
export function decodeProblem(value: unknown): ProblemDetail {
  const data = object(value);
  return {
    type: data.type === undefined ? undefined : string(data.type, 'type'), title: data.title === undefined ? undefined : string(data.title, 'title'),
    status: data.status === undefined ? undefined : number(data.status, 'status'), detail: data.detail === undefined ? undefined : string(data.detail, 'detail'),
    instance: data.instance === undefined ? undefined : string(data.instance, 'instance'), code: data.code === undefined ? undefined : string(data.code, 'code'),
  };
}
export function decodeEvent(type: string, sequence: number, data: string): SessionEvent {
  number(sequence, 'sequence', 1);
  const value = object(parseJson(data));
  if (type === 'ITEM_CREATED' || type === 'ITEM_TEXT_DELTA' || type === 'ITEM_CONTENT_REPLACED') {
    const item_id = id(value.item_id, 'item_id');
    const item_sequence_no = number(value.item_sequence_no, 'item_sequence_no', 1);
    if (type === 'ITEM_CREATED') {
      const body = decodeItem(value.body);
      if (body.id !== item_id || body.sequence_no !== item_sequence_no) throw new Error('Mismatched Item identity');
      return { type, sequence, payload: { item_id, item_sequence_no, body } };
    }
    if (type === 'ITEM_TEXT_DELTA') {
      const body = delta(value.body);
      if (body.item.id !== item_id) throw new Error('Mismatched Item identity');
      return { type, sequence, payload: { item_id, item_sequence_no, body } };
    }
    const snapshot = agentItem(object(value.body).snapshot);
    if (snapshot.item.id !== item_id) throw new Error('Mismatched Item identity');
    return { type, sequence, payload: { item_id, item_sequence_no, body: { snapshot } } };
  }
  switch (type) {
    case 'SESSION_UPDATED': return { type, sequence, payload: { title: string(value.title, 'title') } };
    case 'RUN_UPDATED': return { type, sequence, payload: { run_id: id(value.run_id, 'run_id') } };
    case 'TURN_UPDATED': return { type, sequence, payload: { turn_id: id(value.turn_id, 'turn_id') } };
    case 'TASK_UPDATED': return { type, sequence, payload: { task_id: id(value.task_id, 'task_id') } };
    case 'PLAN_UPDATED': return { type, sequence, payload: { plan_id: id(value.plan_id, 'plan_id'), revision: number(value.revision, 'revision', 1) } };
    case 'PLAN_FOCUS_CHANGED': return { type, sequence, payload: { focus: decodeFocus(value.focus) } };
    default: throw new Error('Unsupported session event: ' + type);
  }
}
