import type { AssetRecord } from '../api/types';
export interface UploadEntry { file: File; key: string; asset: AssetRecord | null; status: 'pending' | 'uploading' | 'uploaded' | 'failed'; error: string | null }
// File bytes remain in this tab's memory; JSON storage cannot preserve a File for retries.
const uploadsByScope = new Map<string, UploadEntry[]>();
const listeners = new Set<() => void>();
const emptyUploads: UploadEntry[] = [];
export function completeUploads(scope: string, assetIds: string[]): void {
  const confirmed = new Set(assetIds);
  updateUploads(scope, entries => entries.filter(entry => !entry.asset || !confirmed.has(entry.asset.id)));
}
export function getUploads(scope: string): UploadEntry[] { return uploadsByScope.get(scope) ?? emptyUploads; }
export function updateUploads(scope: string, update: (current: UploadEntry[]) => UploadEntry[]): void {
  uploadsByScope.set(scope, update(getUploads(scope)));
  for (const listener of listeners) listener();
}
export function clearUploads(scope: string): void {
  uploadsByScope.delete(scope);
  for (const listener of listeners) listener();
}
export function subscribeUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
