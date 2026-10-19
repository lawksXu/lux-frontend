import type { ContentBlock, MessageInput } from '../api/types';
import type { PendingStorage } from './pending';

const pendingMessages = new Map<string, MessageInput | null>();
function browserStorage(): PendingStorage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}
export function getPendingMessage(scope: string, storage: PendingStorage | null = browserStorage()): MessageInput | null {
  const cached = pendingMessages.get(scope);
  if (cached !== undefined) return cached ? { client_request_id: cached.client_request_id, content: cached.content.map(block => ({ ...block })) } : null;
  try {
    const serialized = storage?.getItem(scope);
    if (serialized) {
      const input = restoreMessage(serialized);
      pendingMessages.set(scope, input);
      return input;
    }
  } catch { /* Retain the original input in memory when storage is unavailable. */ }
  return null;
}
export function savePendingMessage(scope: string, input: MessageInput, storage: PendingStorage | null = browserStorage()): void {
  pendingMessages.set(scope, { client_request_id: input.client_request_id, content: input.content.map(block => ({ ...block })) });
  try { storage?.setItem(scope, JSON.stringify(input)); } catch { /* Memory still protects navigation retries. */ }
}
export function completePendingMessage(scope: string, id: string, storage: PendingStorage | null = browserStorage()): void {
  if (getPendingMessage(scope, storage)?.client_request_id !== id) return;
  pendingMessages.set(scope, null);
  try { storage?.removeItem(scope); } catch { /* Keep the confirmed clearance in memory. */ }
}

export function buildMessage(text: string, assets: string[], id: string): MessageInput {
  if (text.length > 64000) throw new Error('Text must be at most 64,000 characters');
  const content: ContentBlock[] = text.trim() ? [{ type: 'text', text }] : [];
  for (const assetId of assets) content.push({ type: 'asset', asset_id: assetId });
  if (!content.length) throw new Error('Add a message or attachment');
  if (content.length > 64) throw new Error('A message can contain at most 64 content blocks');
  return { client_request_id: id, content };
}

/** Browser session storage is untrusted; restore only a complete original input. */
export function restoreMessage(json: string | null): MessageInput | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object' || !('client_request_id' in value) || typeof value.client_request_id !== 'string'
      || !value.client_request_id || !('content' in value) || !Array.isArray(value.content) || !value.content.length || value.content.length > 64) return null;
    const content: ContentBlock[] = [];
    for (const block of value.content as unknown[]) {
      if (!block || typeof block !== 'object' || !('type' in block)) return null;
      if (block.type === 'text' && 'text' in block && typeof block.text === 'string' && block.text.trim() && block.text.length <= 64000) content.push({ type: 'text', text: block.text });
      else if (block.type === 'asset' && 'asset_id' in block && typeof block.asset_id === 'string' && block.asset_id) content.push({ type: 'asset', asset_id: block.asset_id });
      else return null;
    }
    return { client_request_id: value.client_request_id, content };
  } catch { return null; }
}
