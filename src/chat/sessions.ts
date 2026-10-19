import { ApiError, type LuxApi } from '../api/client';
import type { SessionRecord } from '../api/types';
export interface SessionSelection { sessions: SessionRecord[]; selectedId: string | null }
export async function loadSessions(api: Pick<LuxApi, 'sessions' | 'session'>, remembered: string, signal?: AbortSignal): Promise<SessionSelection> {
  const sessions = await api.sessions(signal);
  if (signal?.aborted) throw new DOMException('Session lookup aborted', 'AbortError');
  if (sessions.some(session => session.id === remembered)) return { sessions, selectedId: remembered };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(remembered)) {
    try {
      const session = await api.session(remembered, signal);
      return { sessions: [session, ...sessions], selectedId: session.id };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
  }
  return { sessions, selectedId: sessions[0]?.id ?? null };
}
