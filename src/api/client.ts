import {
  decodeAsset, decodeControl, decodeFocus, decodeInputAcceptance, decodeItem, decodeList, decodePage,
  decodePlan, decodePlanPage, decodeProblem, decodeRun, decodeSession, decodeTask, parseJson,
} from './decode';
import type {
  AssetRecord, ControlAcceptanceResponse, GenerationPlanSnapshot, InputAcceptanceResponse,
  ItemProjection, MessageInput, PlanPage, PlansCursor, ProblemDetail, RunProjection,
  SessionPlanFocus, SessionProjectionPage, SessionRecord, SessionTitleInput, TaskBatchInput, TaskView,
} from './types';

export { referencedTaskIds } from './decode';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly problem: ProblemDetail | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class LuxApi {
  private readonly base: string;
  constructor(userId: string, private readonly fetcher: typeof fetch = fetch) {
    this.base = '/api/v1/users/' + encodeURIComponent(userId);
  }
  private sessionPath(sessionId: string): string { return this.base + '/sessions/' + encodeURIComponent(sessionId); }

  private async request<T>(path: string, decode: (value: unknown) => T, init: RequestInit = {}): Promise<T> {
    // Each call is one attempt. The caller retains identities and decides whether to retry an uncertain write.
    const fetcher = this.fetcher;
    const response = await fetcher(path, init);
    const body = await response.text();
    if (!response.ok) {
      let problem: ProblemDetail | null = null;
      try { problem = decodeProblem(parseJson(body)); } catch { /* Proxy failures may be plain text or HTML. */ }
      throw new ApiError(response.status, problem?.code, problem?.detail || problem?.title || 'Request failed (HTTP ' + response.status + ')', problem);
    }
    try { return decode(parseJson(body)); }
    catch (error) {
      const detail = error instanceof Error ? error.message : 'Malformed JSON';
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'Invalid API response: ' + detail);
    }
  }
  private json<T>(path: string, method: string, body: MessageInput | SessionTitleInput | TaskBatchInput, decode: (value: unknown) => T, key?: string, signal?: AbortSignal): Promise<T> {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (key !== undefined) headers.set('Idempotency-Key', key);
    return this.request(path, decode, { method, headers, body: JSON.stringify(body), signal });
  }
  sessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    return this.request(this.base + '/sessions', value => decodeList(value, decodeSession), { signal });
  }
  session(sessionId: string, signal?: AbortSignal): Promise<SessionRecord> {
    return this.request(this.sessionPath(sessionId), decodeSession, { signal });
  }
  createSession(title: string, key: string): Promise<SessionRecord> {
    return this.json(this.base + '/sessions', 'POST', { title }, decodeSession, key);
  }
  renameSession(id: string, title: string, key: string): Promise<SessionRecord> {
    return this.json(this.sessionPath(id), 'PATCH', { title }, decodeSession, key);
  }
  items(sessionId: string, before?: number, signal?: AbortSignal): Promise<SessionProjectionPage> {
    return this.request(this.sessionPath(sessionId) + '/items' + (before === undefined ? '' : '?before=' + encodeURIComponent(before)), decodePage, { signal });
  }
  item(sessionId: string, itemId: string, signal?: AbortSignal): Promise<ItemProjection> {
    return this.request(this.sessionPath(sessionId) + '/items/' + encodeURIComponent(itemId), decodeItem, { signal });
  }
  run(runId: string, signal?: AbortSignal): Promise<RunProjection> {
    return this.request(this.base + '/runs/' + encodeURIComponent(runId), decodeRun, { signal });
  }
  send(sessionId: string, input: MessageInput): Promise<InputAcceptanceResponse> {
    return this.json(this.sessionPath(sessionId) + '/messages', 'POST', input, decodeInputAcceptance);
  }
  control(sessionId: string, action: 'stop' | 'continue', key: string): Promise<ControlAcceptanceResponse> {
    return this.request(this.sessionPath(sessionId) + '/' + action, decodeControl, { method: 'POST', headers: { 'Idempotency-Key': key } });
  }
  upload(file: File, key: string): Promise<AssetRecord> {
    const body = new FormData();
    body.append('file', file);
    return this.request(this.base + '/assets', decodeAsset, { method: 'POST', headers: { 'Idempotency-Key': key }, body });
  }
  asset(assetId: string, signal?: AbortSignal): Promise<AssetRecord> {
    return this.request(this.base + '/assets/' + encodeURIComponent(assetId), decodeAsset, { signal });
  }
  tasks(ids: string[], signal?: AbortSignal): Promise<TaskView[]> {
    return this.json(this.base + '/tasks/batch', 'POST', { ids }, value => decodeList(value, decodeTask), undefined, signal);
  }
  async plans(sessionId: string, cursor?: PlansCursor, signal?: AbortSignal): Promise<PlanPage> {
    const query = new URLSearchParams();
    if (cursor !== undefined) {
      if (!cursor.before_created_at || !cursor.before_id) throw new Error('Both plan cursor fields are required');
      query.set('beforeCreatedAt', cursor.before_created_at);
      query.set('beforeId', cursor.before_id);
    }
    return this.request(this.sessionPath(sessionId) + '/plans' + (query.size ? '?' + query.toString() : ''), decodePlanPage, { signal });
  }
  plan(sessionId: string, planId: string, signal?: AbortSignal): Promise<GenerationPlanSnapshot> {
    return this.request(this.sessionPath(sessionId) + '/plans/' + encodeURIComponent(planId), decodePlan, { signal });
  }
  focus(sessionId: string, signal?: AbortSignal): Promise<SessionPlanFocus> {
    return this.request(this.sessionPath(sessionId) + '/plan-focus', decodeFocus, { signal });
  }
  eventsUrl(sessionId: string, after: number): string {
    return this.sessionPath(sessionId) + '/events?after=' + encodeURIComponent(after);
  }
  assetUrl(assetId: string): string { return this.base + '/assets/' + encodeURIComponent(assetId) + '/content'; }
}
