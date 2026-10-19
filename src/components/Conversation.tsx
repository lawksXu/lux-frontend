import type { LuxApi } from '../api/client';
import type { ConversationItem } from '../chat/state';
import { AssetView } from './Resources';
import { Icon, LuxMark } from './Icon';

export function Conversation({ api, items, finalItemIds }: { api: LuxApi; items: ConversationItem[]; finalItemIds: Set<string> }) {
  return <div className={`timeline ${!items.length ? 'timeline-empty' : ''}`} aria-label="Conversation">
    {!items.length && <div className="conversation-welcome"><span className="welcome-symbol"><LuxMark /></span><h2>What’s on your mind?</h2><p>An image, a story, a spark of an idea.<br />Start anywhere. We’ll take it from there.</p></div>}
    {items.map(item => {
      const activity = item.kind === 'TOOL_CALL' || item.kind === 'TOOL_RESULT' || item.kind === 'TASK_EVENT' || item.kind === 'REASONING_SUMMARY';
      const content = item.payload && 'blocks' in item.payload ? item.payload.blocks.map((block, index) => block.type === 'text'
        ? <span className="text" key={index}>{block.text}</span>
        : <AssetView key={index} api={api} assetId={block.asset_id} />)
        : item.kind === 'TASK_EVENT' ? <p className="muted">Your creation has an update. Open Studio to see its progress.</p>
        : item.payload ? <pre>{JSON.stringify(item.payload, null, 2)}</pre>
        : <p className="muted">Waiting for content…</p>;
      return activity ? <details key={item.id} className="activity-item">
        <summary><Icon name={item.kind === 'REASONING_SUMMARY' ? 'sparkles' : 'layers'} /><span>{label(item)}</span><small>{item.status === 'PARTIAL' ? 'In progress' : item.status === 'COMPLETED' ? 'Done' : item.status?.toLowerCase().replaceAll('_', ' ') ?? 'Waiting'}</small><Icon name="chevron-right" /></summary>
        <div className="activity-content">{content}</div>
      </details> : <article key={item.id} className={`item ${item.source === 'USER' ? 'user-item' : 'assistant-item'}`}>
        <div className="message-avatar">{item.source === 'USER' ? 'Y' : <LuxMark />}</div>
        <div className="message-body"><div className="item-heading"><strong>{label(item)}</strong>{item.status === 'PARTIAL' && <small className="writing-indicator">Writing…</small>}{item.status === 'INTERRUPTED' && <small className="status--warning">Interrupted</small>}{finalItemIds.has(item.id) && <small className="final-label"><Icon name="check" />Complete</small>}</div>
          <div className="message-content">{content}</div>
        </div>
      </article>;
    })}
  </div>;
}

function label(item: ConversationItem): string {
  if (item.kind === 'TOOL_CALL') return item.tool_name ? `Using ${item.tool_name}` : 'Working on your request';
  if (item.kind === 'TOOL_RESULT') return 'Activity result';
  if (item.kind === 'TASK_EVENT') return 'Creation update';
  if (item.kind === 'REASONING_SUMMARY') return 'Thinking';
  return item.source === 'USER' ? 'You' : item.source === 'SYSTEM' ? 'System' : 'Lux';
}
