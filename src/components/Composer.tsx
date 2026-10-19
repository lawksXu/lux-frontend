import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { LuxApi } from '../api/client';
import type { MessageInput } from '../api/types';
import { buildMessage, getPendingMessage, savePendingMessage, completePendingMessage } from '../chat/message';

import { Icon, type IconName } from './Icon';

import { completeUploads, getUploads, subscribeUploads, updateUploads, type UploadEntry } from '../chat/uploads';

interface PromptStarter { icon: IconName; label: string; description: string; prompt: string }

export function Composer({ api, userId, sessionId, onAccepted, showStarters = false }: {
  api: LuxApi; userId: string; sessionId: string; onAccepted: () => void; showStarters?: boolean;
}) {
  const storageKey = `lux.pending-message.${userId}.${sessionId}`;
  const [pending, setPending] = useState<MessageInput | null>(() => getPendingMessage(storageKey));
  const draftKey = `lux.draft.${userId}.${sessionId}`;
  const [text, setText] = useState(() => { try { return sessionStorage.getItem(draftKey) ?? ''; } catch { return ''; } });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const wasPending = useRef(!!pending);
  useEffect(() => {
    if (wasPending.current && !pending) textarea.current?.focus();
    wasPending.current = !!pending;
  }, [pending]);
  useEffect(() => {
    try { if (text) sessionStorage.setItem(draftKey, text); else sessionStorage.removeItem(draftKey); } catch { /* Drafts remain usable when storage is unavailable. */ }
    if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 200)}px`; }
  }, [draftKey, text]);
  const uploadSnapshot = useCallback(() => getUploads(storageKey), [storageKey]);
  const uploads = useSyncExternalStore(subscribeUploads, uploadSnapshot);
  const setUploads = (update: (current: UploadEntry[]) => UploadEntry[]) => updateUploads(storageKey, update);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function upload(entry: UploadEntry) {
    setUploads(current => current.map(item => item.key === entry.key ? { ...item, status: 'uploading', error: null } : item));
    try {
      const asset = await api.upload(entry.file, entry.key);
      setUploads(current => current.map(item => item.key === entry.key ? { ...item, status: 'uploaded', asset } : item));
    } catch (problem) {
      setUploads(current => current.map(item => item.key === entry.key
        ? { ...item, status: 'failed', error: problem instanceof Error ? problem.message : 'Upload failed' } : item));
    }
  }

  function selectFiles(files: FileList | null) {
    if (!files) return;
    if (uploads.length + files.length > 63) { setError('Attach at most 63 files per message'); return; }
    const entries: UploadEntry[] = Array.from(files, file => ({ file, key: crypto.randomUUID(), asset: null, status: 'pending', error: null }));
    setUploads(current => [...current, ...entries]);
    for (const entry of entries) void upload(entry);
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current || (!pending && (uploads.some(entry => entry.status !== 'uploaded') || (!text.trim() && !uploads.length)))) return;
    let input: MessageInput;
    try { input = pending ?? buildMessage(text, uploads.flatMap(entry => entry.asset ? [entry.asset.id] : []), crypto.randomUUID()); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Invalid message'); return; }
    setPending(input);
    savePendingMessage(storageKey, input);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.send(sessionId, input);
      const confirmsPending = getPendingMessage(storageKey)?.client_request_id === input.client_request_id;
      completePendingMessage(storageKey, input.client_request_id);
      completeUploads(storageKey, input.content.flatMap(block => block.type === 'asset' ? [block.asset_id] : []));
      try { if (confirmsPending) sessionStorage.removeItem(draftKey); } catch { /* Acceptance is independent of browser storage. */ }
      if (!alive.current) return;
      setPending(null);
      setText('');
      onAccepted();
    } catch (problem) {
      if (alive.current) setError(problem instanceof Error ? problem.message : 'Message acceptance is unknown');
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const uploading = uploads.some(entry => entry.status !== 'uploaded');
  const sendDisabled = busy || (!pending && (uploading || (!text.trim() && !uploads.length)));
  const starters: PromptStarter[] = [
    { icon: 'image', label: 'Imagine an image', description: 'Give an idea a visual form', prompt: 'Help me create an image of ' },
    { icon: 'video', label: 'Plan a video', description: 'Turn a moment into motion', prompt: 'Help me plan a video about ' },
    { icon: 'sparkles', label: 'Explore an idea', description: 'Find a fresh starting point', prompt: 'Help me brainstorm creative ideas for ' },
  ];
  return <div className="composer-area">
    {showStarters && !pending && !text && !uploads.length && <div className="prompt-starters">{starters.map(starter => <button key={starter.label} type="button" onClick={() => { setText(starter.prompt); textarea.current?.focus(); }}><Icon name={starter.icon} /><strong>{starter.label}</strong><span>{starter.description}</span><Icon className="starter-arrow" name="arrow-right" /></button>)}</div>}
    <form className={`composer ${pending ? 'composer-pending' : ''}`} onSubmit={event => void send(event)}>
      {pending ? <div className="pending"><p>{busy ? 'Sending your message…' : 'Waiting to confirm your message.'}</p>
        {!busy && <p className="muted">Retry safely without sending a second copy.</p>}
        <pre>{pending.content.map(block => block.type === 'text' ? block.text : 'Attached file').join('\n')}</pre>
      </div> : <>
        <label className="sr-only" htmlFor="message">Message</label>
        <textarea ref={textarea} id="message" value={text} onChange={event => setText(event.target.value)} maxLength={64000} rows={2} placeholder="Describe what you’d like to create…" onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault();
            if (!sendDisabled) void send();
          }
        }} />
        {!!uploads.length && <ul className="uploads">{uploads.map(entry => <li key={entry.key}>
          <Icon name="file" /><div className="upload-info"><span>{entry.file.name}</span><small>{entry.status === 'uploaded' ? 'Ready' : entry.status === 'failed' ? 'Upload failed' : 'Uploading…'}</small>{entry.error && <span role="alert">{entry.error}</span>}</div>
          {entry.status === 'failed' && <button type="button" className="text-button" onClick={() => void upload(entry)}>Retry upload</button>}
          {entry.status !== 'uploading' && <button type="button" className="icon-button" aria-label={`Remove ${entry.file.name}`} onClick={() => setUploads(current => current.filter(item => item.key !== entry.key))}><Icon name="close" /></button>}
        </li>)}</ul>}
      </>}
      {error && <p className="composer-error" role="alert">{error}</p>}
      <div className="composer-tools">
        {!pending && <label className="file-label"><input className="sr-only" type="file" multiple onChange={event => { selectFiles(event.target.files); event.target.value = ''; }} /><Icon name="paperclip" /><span>Attach files</span></label>}
        <span className="composer-mode"><Icon name="sparkles" />Create with Lux</span>
        <button className={`send-button ${pending ? 'retry-send' : ''}`} type="submit" aria-label={busy ? 'Sending message' : pending ? 'Retry same message' : 'Send message'} disabled={sendDisabled}>{pending ? busy ? 'Sending…' : 'Retry message' : <Icon name="arrow-up" />}</button>
      </div>
    </form>
    <p className="composer-hint"><span><kbd>Enter</kbd> to send · <kbd>Shift + Enter</kbd> for a new line</span><span>Text, images & video</span></p>
  </div>;
}
