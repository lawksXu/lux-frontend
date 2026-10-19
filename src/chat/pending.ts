export interface PendingControl { action: 'stop' | 'continue'; key: string }
export type SessionMutation = { type: 'create'; title: string; key: string }
  | { type: 'rename'; title: string; sessionId: string; key: string };
export interface PendingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type PendingRequest = PendingControl | SessionMutation;
const controls = new Map<string, PendingControl | null>();
const mutations = new Map<string, SessionMutation | null>();
const unpersisted = new Set<string>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalId(value: string): string {
  if (!uuid.test(value)) throw new Error('A canonical UUID is required');
  return value.toLowerCase();
}

function browserStorage(): PendingStorage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

function decodeControl(value: unknown): PendingControl | null {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 2
    || !('action' in value) || (value.action !== 'stop' && value.action !== 'continue')
    || !('key' in value) || typeof value.key !== 'string' || !uuid.test(value.key)) return null;
  return { action: value.action, key: value.key };
}

function decodeMutation(value: unknown): SessionMutation | null {
  if (!value || typeof value !== 'object' || !('type' in value)
    || !('title' in value) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 255
    || !('key' in value) || typeof value.key !== 'string' || !uuid.test(value.key)) return null;
  if (value.type === 'create' && Object.keys(value).length === 3) {
    return { type: 'create', title: value.title, key: value.key };
  }
  if (value.type === 'rename' && Object.keys(value).length === 4
    && 'sessionId' in value && typeof value.sessionId === 'string' && uuid.test(value.sessionId)) {
    return { type: 'rename', title: value.title, sessionId: value.sessionId, key: value.key };
  }
  return null;
}

function read<T extends PendingRequest>(
  key: string, cache: Map<string, T | null>, decode: (value: unknown) => T | null, storage: PendingStorage | null,
): T | null {
  const cached = cache.get(key);
  // A cleared request must stay cleared even if browser removal failed.
  if (cached === null) return null;
  const fallback = cached ? { ...cached } : null;
  if (unpersisted.has(key)) return fallback;
  let raw: string | null;
  try { raw = storage?.getItem(key) ?? null; } catch { return fallback; }
  if (raw === null) return fallback;
  let restored: T | null;
  try { const value: unknown = JSON.parse(raw); restored = decode(value); } catch { restored = null; }
  cache.set(key, restored);
  return restored ? { ...restored } : null;
}

function write<T extends PendingRequest>(key: string, cache: Map<string, T | null>, request: T | null, storage: PendingStorage | null): void {
  cache.set(key, request ? { ...request } : null);
  unpersisted.add(key);
  try {
    if (!storage) return;
    if (request) storage?.setItem(key, JSON.stringify(request));
    else storage?.removeItem(key);
    unpersisted.delete(key);
  } catch { /* Keep the original request or its confirmed clearance in memory. */ }
}

export function getPendingControl(userId: string, sessionId: string, storage: PendingStorage | null = browserStorage()): PendingControl | null {
  const key = `lux.pending.control.${canonicalId(userId)}.${canonicalId(sessionId)}`;
  return read(key, controls, decodeControl, storage);
}

export function savePendingControl(userId: string, sessionId: string, request: PendingControl | null, storage: PendingStorage | null = browserStorage()): void {
  const key = `lux.pending.control.${canonicalId(userId)}.${canonicalId(sessionId)}`;
  if (request) canonicalId(request.key);
  write(key, controls, request, storage);
}

export function getPendingSessionMutation(userId: string, storage: PendingStorage | null = browserStorage()): SessionMutation | null {
  return read(`lux.pending.session.${canonicalId(userId)}`, mutations, decodeMutation, storage);
}

export function savePendingSessionMutation(userId: string, request: SessionMutation | null, storage: PendingStorage | null = browserStorage()): void {
  const key = `lux.pending.session.${canonicalId(userId)}`;
  if (request) {
    canonicalId(request.key);
    if (request.type === 'rename') canonicalId(request.sessionId);
  }
  write(key, mutations, request, storage);
}

export function completePendingControl(userId: string, sessionId: string, key: string, storage: PendingStorage | null = browserStorage()): void {
  if (getPendingControl(userId, sessionId, storage)?.key === key) {
    savePendingControl(userId, sessionId, null, storage);
  }
}

export function completePendingSessionMutation(userId: string, key: string, storage: PendingStorage | null = browserStorage()): void {
  if (getPendingSessionMutation(userId, storage)?.key === key) {
    savePendingSessionMutation(userId, null, storage);
  }
}
