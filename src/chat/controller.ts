import type { LuxApi } from '../api/client';
import { decodeEvent, referencedTaskIds } from '../api/decode';
import type { GenerationPlanSnapshot, PlansCursor, SessionPlanFocus, TaskView } from '../api/types';
import { applyEvent, emptyConversation, initialConversation, mergePage, mergeRun, type ConversationState } from './state';

export type ConversationApi = Pick<LuxApi, 'items' | 'item' | 'run' | 'tasks' | 'plans' | 'plan' | 'eventsUrl'>;

export interface EventStream {
  onopen: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  addEventListener(type: string, listener: EventListener): void;
  close(): void;
}
export interface ConversationView {
  state: ConversationState;
  loading: boolean;
  streamStatus: 'loading' | 'connecting' | 'live' | 'reconnecting' | 'error';
  error: string | null;
  tasks: TaskView[];
  plans: GenerationPlanSnapshot[];
  focus: SessionPlanFocus | null;
  nextPlanCursor: PlansCursor | null;
  sessionTitle: string | null;
}

const notificationTypes = ['ITEM_CREATED', 'ITEM_TEXT_DELTA', 'ITEM_CONTENT_REPLACED', 'SESSION_UPDATED',
  'RUN_UPDATED', 'TURN_UPDATED', 'TASK_UPDATED', 'PLAN_UPDATED', 'PLAN_FOCUS_CHANGED'];

/** One owner/Session owns all requests and the native reconnecting EventSource. */
export class ConversationController {
  private view: ConversationView;
  private listeners = new Set<() => void>();
  private stream: EventStream | null = null;
  private abort = new AbortController();
  private epoch = 0;
  private disposed = false;
  private refreshPromise: Promise<void> | null = null;
  private refreshRequested = false;
  private plansInitialized = false;
  private notifiedTaskIds = new Set<string>();

  constructor(private api: ConversationApi, private userId: string, private sessionId: string,
    private createStream: (url: string) => EventStream = url => new EventSource(url)) {
    this.view = { state: emptyConversation({ userId, sessionId }), loading: true, streamStatus: 'loading',
      error: null, tasks: [], plans: [], focus: null, nextPlanCursor: null, sessionTitle: null };
  }

  getSnapshot = (): ConversationView => this.view;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private active(epoch: number): boolean { return !this.disposed && this.epoch === epoch; }
  private update(change: Partial<ConversationView>): void {
    if (this.disposed) return;
    this.view = { ...this.view, ...change };
    for (const listener of this.listeners) listener();
  }
  private failure(error: unknown, epoch: number): void {
    if (this.active(epoch)) this.update({ error: error instanceof Error ? error.message : 'Request failed' });
  }

  async start(): Promise<void> {
    this.abort.abort();
    this.stream?.close();
    this.abort = new AbortController();
    this.disposed = false;
    const epoch = ++this.epoch;
    this.refreshPromise = null;
    this.refreshRequested = false;
    this.update({ loading: true, error: null, streamStatus: 'loading' });
    try {
      const page = await this.api.items(this.sessionId, undefined, this.abort.signal);
      if (!this.active(epoch)) return;
      this.update({ state: initialConversation(page, { userId: this.userId, sessionId: this.sessionId }), loading: false, streamStatus: 'connecting' });
      const stream = this.createStream(this.api.eventsUrl(this.sessionId, page.last_event_sequence_no));
      this.stream = stream;
      stream.onopen = () => { if (this.active(epoch)) this.update({ streamStatus: 'live' }); };
      stream.onerror = () => { if (this.active(epoch)) this.update({ streamStatus: 'reconnecting' }); };
      for (const type of notificationTypes) stream.addEventListener(type, event => this.receive(type, event as MessageEvent<string>, epoch));
      await this.resources(epoch);
    } catch (error) {
      if (this.active(epoch)) this.update({ loading: false, streamStatus: 'error' });
      this.failure(error, epoch);
    }
  }

  close(): void {
    this.disposed = true;
    this.epoch++;
    this.abort.abort();
    this.stream?.close();
    this.stream = null;
  }

  private receive(type: string, message: MessageEvent<string>, epoch: number): void {
    if (!this.active(epoch)) return;
    try {
      const event = decodeEvent(type, Number(message.lastEventId), message.data);
      if (event.sequence <= this.view.state.cursor) return;
      this.update({ state: applyEvent(this.view.state, event) });
      if (event.type === 'TASK_UPDATED') this.notifiedTaskIds.add(event.payload.task_id);
      if (event.type === 'SESSION_UPDATED') this.update({ sessionTitle: event.payload.title });
      if (event.type === 'PLAN_FOCUS_CHANGED') this.update({ focus: event.payload.focus });
      if (event.type === 'PLAN_UPDATED') {
        void this.api.plan(this.sessionId, event.payload.plan_id, this.abort.signal).then(plan => {
          if (this.active(epoch)) this.update({ plans: mergePlans(this.view.plans, [plan]) });
        }).catch(error => this.failure(error, epoch));
      } else if (event.type === 'RUN_UPDATED') {
        void this.api.run(event.payload.run_id, this.abort.signal).then(run => {
          if (this.active(epoch)) this.update({ state: mergeRun(this.view.state, run) });
        }).catch(error => this.failure(error, epoch));
      } else if (event.type !== 'ITEM_TEXT_DELTA') {
        // Coalesce invalidations; streaming text remains an immediate local update.
        void this.refresh();
      }
    } catch (error) {
      this.stream?.close();
      this.update({ streamStatus: 'error' });
      this.failure(error, epoch);
    }
  }

  async refresh(): Promise<void> {
    this.refreshRequested = true;
    if (this.refreshPromise) return this.refreshPromise;
    const epoch = this.epoch;
    const promise = (async () => {
      do {
        this.refreshRequested = false;
        try {
          const page = await this.api.items(this.sessionId, undefined, this.abort.signal);
          if (!this.active(epoch)) return;
          this.update({ state: mergePage(this.view.state, page, 'refresh'), error: null });
          await this.resources(epoch);
        } catch (error) { this.failure(error, epoch); }
      } while (this.refreshRequested && this.active(epoch));
    })();
    this.refreshPromise = promise;
    try { await promise; } finally { if (this.refreshPromise === promise) this.refreshPromise = null; }
  }

  async older(): Promise<void> {
    const before = this.view.state.nextBefore;
    if (before === null) return;
    const epoch = this.epoch;
    try {
      const page = await this.api.items(this.sessionId, before, this.abort.signal);
      if (!this.active(epoch)) return;
      this.update({ state: mergePage(this.view.state, page, 'older') });
      await this.resources(epoch);
    } catch (error) { this.failure(error, epoch); }
  }

  async morePlans(): Promise<void> {
    const cursor = this.view.nextPlanCursor;
    if (!cursor) return;
    const epoch = this.epoch;
    try {
      const page = await this.api.plans(this.sessionId, cursor, this.abort.signal);
      if (this.active(epoch)) this.update({ plans: mergePlans(this.view.plans, page.plans), nextPlanCursor: page.next_cursor });
    } catch (error) { this.failure(error, epoch); }
  }

  private async resources(epoch: number): Promise<void> {
    const ids = [...new Set([...this.notifiedTaskIds, ...this.view.tasks.map(task => task.id), ...this.view.state.items.flatMap(referencedTaskIds)])];
    const taskPages: Promise<TaskView[]>[] = [];
    for (let index = 0; index < ids.length; index += 100) taskPages.push(this.api.tasks(ids.slice(index, index + 100), this.abort.signal));
    const [tasks, page] = await Promise.all([Promise.all(taskPages), this.api.plans(this.sessionId, undefined, this.abort.signal)]);
    if (!this.active(epoch)) return;
    const byId = new Map(this.view.tasks.map(task => [task.id, task]));
    for (const task of tasks.flat()) {
      if (task.session_id === this.sessionId && task.version >= (byId.get(task.id)?.version ?? -1)) byId.set(task.id, task);
    }
    const focus = this.view.focus && this.view.focus.revision > page.focus.revision ? this.view.focus : page.focus;
    this.update({ tasks: [...byId.values()], plans: mergePlans(this.view.plans, page.plans), focus,
      nextPlanCursor: this.plansInitialized ? this.view.nextPlanCursor : page.next_cursor });
    this.plansInitialized = true;
  }
}

function mergePlans(current: GenerationPlanSnapshot[], incoming: GenerationPlanSnapshot[]): GenerationPlanSnapshot[] {
  const byId = new Map(current.map(snapshot => [snapshot.plan.id, snapshot]));
  for (const snapshot of incoming) {
    if (snapshot.plan.revision >= (byId.get(snapshot.plan.id)?.plan.revision ?? -1)) byId.set(snapshot.plan.id, snapshot);
  }
  return [...byId.values()].sort((a, b) => b.plan.created_at.localeCompare(a.plan.created_at) || b.plan.id.localeCompare(a.plan.id));
}
