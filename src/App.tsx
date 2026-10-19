import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LuxApi } from './api/client';
import type { SessionRecord } from './api/types';
import { useConversation } from './chat/useConversation';
import { loadSessions } from './chat/sessions';
import { completePendingControl, completePendingSessionMutation, getPendingControl, getPendingSessionMutation, savePendingControl, savePendingSessionMutation,
  type PendingControl, type SessionMutation } from './chat/pending';
import { Conversation } from './components/Conversation';
import { ExecutionStatus } from './components/ExecutionStatus';
import { Composer } from './components/Composer';
import { PlanList, TaskList } from './components/Resources';
import { Icon, LuxMark } from './components/Icon';

interface ScrollAnchor { height: number; top: number; firstItemId: string | null }

const defaultUser = '00000000-0000-0000-0000-000000000001';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* The app also works without persistent browser storage. */ }
}
function initialUser(): string {
  const selected = stored('lux.user', import.meta.env.VITE_LUX_USER_ID || defaultUser);
  return uuid.test(selected) ? selected : defaultUser;
}

export default function App() {
  const [userId, setUserId] = useState(initialUser);
  const [userInput, setUserInput] = useState(userId);
  function connect(event: FormEvent) {
    event.preventDefault();
    const owner = userInput.trim().toLowerCase();
    if (!uuid.test(owner)) return;
    remember('lux.user', owner);
    setUserId(owner);
  }
  return <Workspace key={userId} userId={userId} ownerSettings={
    <details className="owner-settings">
      <summary><span className="owner-avatar">L</span><span>Local workspace<small>Personal space</small></span><Icon name="settings" /></summary>
      <form onSubmit={connect} className="user-selector">
        <label htmlFor="user-id">Local user ID</label>
        <input id="user-id" value={userInput} onChange={event => setUserInput(event.target.value)} required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" />
        <p className="muted">For local development. This selector does not sign you in.</p>
        <button type="submit" className="secondary-button">Connect</button>
      </form>
    </details>
  } />;
}

function Workspace({ userId, ownerSettings }: { userId: string; ownerSettings: ReactNode }) {
  const api = useMemo(() => new LuxApi(userId), [userId]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SessionMutation | null>(() => getPendingSessionMutation(userId));
  const alive = useRef(true);
  const mutationInFlight = useRef(false);
  const selectionKey = `lux.session.${userId}`;

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    void loadSessions(api, stored(selectionKey, ''), abort.signal).then(result => {
      if (abort.signal.aborted) return;
      setSessions(result.sessions);
      setSelectedId(result.selectedId);
      setLoading(false);
    }).catch(problem => {
      if (!abort.signal.aborted) { setError(problem instanceof Error ? problem.message : 'Sessions unavailable'); setLoading(false); }
    });
    return () => { alive.current = false; abort.abort(); };
  }, [api, selectionKey, loadAttempt]);

  function select(id: string) { setSelectedId(id); remember(selectionKey, id); setNavigationOpen(false); }
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && navigationOpen) { setNavigationOpen(false); navigationToggle.current?.focus(); }
    }
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [navigationOpen]);
  const renamed = useCallback((id: string, newTitle: string) => {
    setSessions(current => current.map(session => session.id === id ? { ...session, title: newTitle } : session));
  }, []);

  async function mutate(change: SessionMutation) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setPending(change);
    savePendingSessionMutation(userId, change);
    setBusy(true);
    setError(null);
    try {
      const record = change.type === 'create' ? await api.createSession(change.title, change.key)
        : await api.renameSession(change.sessionId, change.title, change.key);
      completePendingSessionMutation(userId, change.key);
      if (!alive.current) return;
      setSessions(current => [record, ...current.filter(session => session.id !== record.id)]);
      if (change.type === 'create') select(record.id);
      setTitle('');
      setCreating(false);
      setSearch('');
      setPending(null);
    } catch (problem) {
      if (alive.current) setError(problem instanceof Error ? problem.message : 'Session acceptance is unknown');
    } finally { mutationInFlight.current = false; if (alive.current) setBusy(false); }
  }
  const selected = sessions.find(session => session.id === selectedId);
  const visibleSessions = sessions.filter(session => session.title.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className={`workspace ${navigationOpen ? 'navigation-open' : ''}`}>
    <a className="skip-link" href="#workspace-main">Skip to conversation</a>
    <div className="mobile-topbar">
      <span className="brand"><LuxMark />lux<span className="brand-caption">studio</span></span>
      <button ref={navigationToggle} className="icon-button" aria-label="Toggle conversations" aria-expanded={navigationOpen} aria-controls="conversation-navigation" onClick={() => setNavigationOpen(!navigationOpen)}><Icon name={navigationOpen ? 'close' : 'menu'} /></button>
    </div>
    <aside className="sessions" id="conversation-navigation" aria-label="Conversation navigation">
      <div className="sidebar-brand brand"><LuxMark />lux<span className="brand-caption">studio</span></div>
      <button className="new-chat-button" disabled={loading || busy || !!pending} onClick={() => setCreating(!creating)} aria-expanded={creating}><Icon name="plus" />New chat</button>
      {creating && <form className="new-chat-form" onSubmit={event => {
        event.preventDefault();
        if (!loading && !pending && !busy) void mutate({ type: 'create', title: title.trim() || 'Untitled chat', key: crypto.randomUUID() });
      }}>
        <label className="sr-only" htmlFor="session-title">New chat title</label>
        <input autoFocus id="session-title" placeholder="Name your chat (optional)" value={title} onChange={event => setTitle(event.target.value)} maxLength={255} disabled={loading || !!pending} />
        <div className="form-actions"><button className="text-button" type="button" onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" disabled={loading || busy || !!pending} type="submit">Create chat</button></div>
      </form>}
      <label className="session-search"><Icon name="search" /><input aria-label="Search chats" placeholder="Search chats" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="nav-heading"><span>Your chats</span><span>{sessions.length}</span></div>
      {loading && <p className="sidebar-notice" role="status">Loading your chats…</p>}
      {pending && <div className="sidebar-notice pending-notice"><p>{pending.type === 'create' ? 'Chat creation' : 'Rename'} needs confirmation.</p><p className="muted">{pending.title}</p><button className="text-button" disabled={loading || busy} onClick={() => void mutate(pending)}>Retry same request</button></div>}
      {error && <div className="sidebar-notice"><p role="alert">{error}</p>{!pending && <button className="text-button" onClick={() => setLoadAttempt(current => current + 1)}>Retry connection</button>}</div>}
      <nav className="session-list" aria-label="Chats">{visibleSessions.map(session => <button key={session.id} className="session-button" aria-current={session.id === selectedId ? 'page' : undefined} onClick={() => select(session.id)}><Icon name="message" /><span>{session.title}</span>{session.id === selectedId && <span className="selected-dot" />}</button>)}</nav>
      {!loading && !visibleSessions.length && <p className="sidebar-notice muted">{search ? 'No matching chats.' : 'A little space for your next idea.'}</p>}
      <div className="sidebar-footer"><div className="workspace-note"><LuxMark /><p>From a thought<br /><strong>to something new.</strong></p></div>{ownerSettings}</div>
    </aside>
    {selected ? <SessionWorkspace key={selected.id} api={api} userId={userId} session={selected} onTitle={renamed}
      onRename={newTitle => void mutate({ type: 'rename', sessionId: selected.id, title: newTitle, key: crypto.randomUUID() })} renameDisabled={loading || busy || !!pending} />
      : <main id="workspace-main" tabIndex={-1} className="workspace-empty">
        <span className="welcome-symbol"><LuxMark /></span><p className="eyebrow">YOUR CREATIVE SPACE</p><h1>A little idea.<br />A world of possibility.</h1>
        <p>{loading ? 'Getting your workspace ready…' : 'Bring your words, images and stories to life with Lux.'}</p>
        {!loading && <button className="primary-button" disabled={busy || !!pending} onClick={() => { setCreating(true); setNavigationOpen(true); }}><Icon name="plus" />Start a new chat</button>}
      </main>}
  </div>;
}

function SessionWorkspace({ api, userId, session, onTitle, onRename, renameDisabled }: {
  api: LuxApi; userId: string; session: SessionRecord; onTitle: (id: string, title: string) => void;
  onRename: (title: string) => void; renameDisabled: boolean;
}) {
  const { view, controller } = useConversation(api, userId, session.id);
  const [rename, setRename] = useState(session.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [resourceTab, setResourceTab] = useState<'creations' | 'plans'>('creations');
  const [showLatest, setShowLatest] = useState(false);
  const scrollArea = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const historyPosition = useRef<ScrollAnchor | null>(null);
  const resourceToggle = useRef<HTMLButtonElement>(null);
  const closeResource = useRef<HTMLButtonElement>(null);
  const wasResourceOpen = useRef(false);
  const renameToggle = useRef<HTMLButtonElement>(null);
  const [pendingControl, setPendingControl] = useState<PendingControl | null>(() => getPendingControl(userId, session.id));
  const [controlBusy, setControlBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageBusy, setPageBusy] = useState(false);
  const alive = useRef(true);
  const controlInFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setRename(session.title); }, [session.title]);
  useEffect(() => { if (view.sessionTitle !== null) onTitle(session.id, view.sessionTitle); }, [onTitle, session.id, view.sessionTitle]);

  async function control(request: PendingControl) {
    if (controlInFlight.current) return;
    controlInFlight.current = true;
    setPendingControl(request);
    savePendingControl(userId, session.id, request);
    setControlBusy(true);
    setNotice(null);
    try {
      await api.control(session.id, request.action, request.key);
      completePendingControl(userId, session.id, request.key);
      if (!alive.current) return;
      setPendingControl(null);
      setNotice(`${request.action === 'stop' ? 'Stop' : 'Continue'} accepted. Execution updates will appear below.`);
    } catch (problem) { if (alive.current) setNotice(problem instanceof Error ? problem.message : 'Control acceptance is unknown'); }
    finally { controlInFlight.current = false; if (alive.current) setControlBusy(false); }
  }
  async function page(action: () => Promise<void>) {
    if (pageBusy) return;
    setPageBusy(true);
    try { await action(); } finally { if (alive.current) setPageBusy(false); }
  }
  useLayoutEffect(() => {
    const container = scrollArea.current;
    if (!container) return;
    if (historyPosition.current) {
      if (historyPosition.current.firstItemId === (view.state.items[0]?.id ?? null)) return;
      container.scrollTop = historyPosition.current.top + container.scrollHeight - historyPosition.current.height;
      historyPosition.current = null;
    } else if (followLatest.current) container.scrollTop = view.state.items.length ? container.scrollHeight : 0;
  }, [view.state.items, view.loading]);

  useEffect(() => {
    if (resourceOpen) closeResource.current?.focus();
    else if (wasResourceOpen.current) resourceToggle.current?.focus();
    wasResourceOpen.current = resourceOpen;
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && resourceOpen) setResourceOpen(false);
    }
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [resourceOpen]);

  const finalIds = new Set(view.state.runs.flatMap(run => run.final_item_id ? [run.final_item_id] : []));
  const resourceCount = view.tasks.length + view.plans.length;
  return <div className={`session-workspace ${resourceOpen ? 'inspector-open' : ''}`}>
    <main id="workspace-main" tabIndex={-1} className="chat">
      <header className="session-header">
        <div className="session-heading">
          <div className="session-title-group"><span className="eyebrow">WORKSPACE</span><h1>{session.title}</h1></div>
          <button ref={renameToggle} className="icon-button rename-toggle" title="Rename chat" aria-label="Rename chat" aria-expanded={editingTitle} disabled={renameDisabled} onClick={() => setEditingTitle(!editingTitle)}><Icon name="edit" /></button>
          <button ref={resourceToggle} className={`inspector-toggle ${resourceOpen ? 'active' : ''}`} aria-expanded={resourceOpen} aria-controls="resource-inspector" onClick={() => setResourceOpen(!resourceOpen)}><Icon name="panel" /><span>Studio</span>{resourceCount > 0 && <span className="count-badge">{resourceCount}</span>}</button>
        </div>
        {editingTitle && <form className="rename-form" onSubmit={event => { event.preventDefault(); if (rename.trim()) { onRename(rename.trim()); setEditingTitle(false); renameToggle.current?.focus(); } }}>
          <input autoFocus aria-label="Rename chat" value={rename} onChange={event => setRename(event.target.value)} required maxLength={255} disabled={renameDisabled} onKeyDown={event => { if (event.key === 'Escape') { setEditingTitle(false); setRename(session.title); renameToggle.current?.focus(); } }} />
          <button className="primary-button" disabled={renameDisabled}>Save</button><button type="button" className="text-button" onClick={() => { setEditingTitle(false); setRename(session.title); renameToggle.current?.focus(); }}>Cancel</button>
        </form>}
        <div className="session-toolbar">
          <ExecutionStatus streamStatus={view.streamStatus} runs={view.state.runs} turns={view.state.turns} />
          <div className="controls">
            <button className="text-button" disabled={controlBusy || !!pendingControl} onClick={() => void control({ action: 'stop', key: crypto.randomUUID() })}><Icon name="stop" />Stop</button>
            <button className="text-button" disabled={controlBusy || !!pendingControl} onClick={() => void control({ action: 'continue', key: crypto.randomUUID() })}><Icon name="play" />Continue</button>
            <button className="icon-button" title="Refresh conversation" aria-label="Refresh conversation" onClick={() => void (view.streamStatus === 'error' ? controller.start() : controller.refresh())}><Icon name="refresh" /></button>
          </div>
        </div>
        {pendingControl && <div className="pending-notice"><span>Waiting to confirm your {pendingControl.action} request.</span><button className="text-button" disabled={controlBusy} onClick={() => void control(pendingControl)}>Retry {pendingControl.action}</button></div>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {view.error && <p className="notice" role="alert">{view.error}</p>}
      </header>
      <div className="conversation-scroll" ref={scrollArea} onScroll={() => {
        const container = scrollArea.current;
        if (!container) return;
        followLatest.current = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        setShowLatest(!followLatest.current);
      }} onLoadCapture={() => { if (followLatest.current && scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight; }}>
        {view.loading ? <div className="conversation-loading" role="status"><LuxMark /><span>Opening your conversation…</span><div className="skeleton" /><div className="skeleton short" /></div> : <>
          {view.state.nextBefore !== null && <div className="history-control"><button className="text-button" disabled={pageBusy} onClick={() => void page(async () => {
            const container = scrollArea.current;
            if (container) historyPosition.current = { height: container.scrollHeight, top: container.scrollTop, firstItemId: view.state.items[0]?.id ?? null };
            followLatest.current = false;
            await controller.older();
            requestAnimationFrame(() => { historyPosition.current = null; });
          })}>{pageBusy ? 'Loading history…' : 'Load older messages'}</button></div>}
          <Conversation api={api} items={view.state.items} finalItemIds={finalIds} />
        </>}
      </div>
      {showLatest && !view.loading && <button className="jump-latest" onClick={() => {
        if (scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
        followLatest.current = true;
        setShowLatest(false);
      }}><Icon name="arrow-down" />Back to latest</button>}
      {!view.loading && <Composer api={api} userId={userId} sessionId={session.id} showStarters={!view.state.items.length} onAccepted={() => { followLatest.current = true; void controller.refresh(); }} />}
    </main>
    <aside className="resources" id="resource-inspector" aria-label="Studio" hidden={!resourceOpen}>
      <header className="inspector-header"><div><span className="eyebrow">YOUR WORK, IN ONE PLACE</span><h2>Studio</h2></div><button ref={closeResource} className="icon-button" aria-label="Close studio" onClick={() => setResourceOpen(false)}><Icon name="close" /></button></header>
      <div className="resource-tabs" role="group" aria-label="Studio view"><button aria-pressed={resourceTab === 'creations'} onClick={() => setResourceTab('creations')}>Creations <span>{view.tasks.length}</span></button><button aria-pressed={resourceTab === 'plans'} onClick={() => setResourceTab('plans')}>Plans <span>{view.plans.length}</span></button></div>
      <div className="inspector-content"><div hidden={resourceTab !== 'creations'}><TaskList api={api} tasks={view.tasks} /></div>
        <div hidden={resourceTab !== 'plans'}><PlanList plans={view.plans} focus={view.focus} more={!!view.nextPlanCursor && !pageBusy} onMore={() => void page(() => controller.morePlans())} /></div>
      </div>
      <p className="inspector-footer"><Icon name="message" />Shape your next creation in chat.</p>
    </aside>
  </div>;
}
