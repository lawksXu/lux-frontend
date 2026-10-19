import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { LuxApi } from '../api/client';
import { ConversationController } from './controller';

export function useConversation(api: LuxApi, userId: string, sessionId: string) {
  const controller = useMemo(() => new ConversationController(api, userId, sessionId), [api, userId, sessionId]);
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    void controller.start();
    return () => controller.close();
  }, [controller]);
  return { view, controller };
}
