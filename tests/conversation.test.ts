import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LuxApi } from '../src/api/client.ts';
import type { ConversationItem } from '../src/chat/state.ts';
import { Conversation } from '../src/components/Conversation.tsx';

const timestamp = '2026-10-19T12:00:00Z';

function item(changes: Partial<ConversationItem>): ConversationItem {
  return {
    id: 'reply', user_id: 'owner', session_id: 'session', sequence_no: 2, source: 'AGENT', kind: 'MESSAGE',
    run_id: 'run', turn_id: 'turn', item_index: 1, input_sequence_no: null, status: 'COMPLETED',
    call_id: null, tool_name: null, task_id: null, payload: { blocks: [] }, source_revision: 2,
    completed_at: timestamp, version: 2, created_at: timestamp, updated_at: timestamp, ...changes,
  };
}

function render(entry: ConversationItem): string {
  return renderToStaticMarkup(createElement(Conversation, {
    api: new LuxApi('owner'), items: [entry], finalItemIds: new Set<string>(),
  }));
}

test('an interrupted non-final assistant reply retains its partial text and interruption status', () => {
  const partialText = '  I found the first option.\nNext, ';
  const html = render(item({ status: 'INTERRUPTED', payload: { blocks: [{ type: 'text', text: partialText }] } }));
  assert.equal(html.match(/<span class="text">([\s\S]*?)<\/span>/)?.[1], partialText);
  assert.match(html, />Interrupted</);
  assert.doesNotMatch(html, /Writing…|>Complete</);
});

test('contiguous text blocks retain exact whitespace and escape unsafe HTML', () => {
  const html = render(item({ payload: { blocks: [
    { type: 'text', text: '  first \n' },
    { type: 'text', text: '\t<script>alert("unsafe")</script> & last  ' },
  ] } }));
  const fragments = [...html.matchAll(/<span class="text">([\s\S]*?)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(fragments, ['  first \n', '\t&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; &amp; last  ']);
  assert.doesNotMatch(html, /<script>/);
});

test('tool activity keeps its payload available inside a discoverable disclosure', () => {
  const html = render(item({ kind: 'TOOL_RESULT', payload: {
    type: 'task_query_snapshot', task_id: 'generation-task', version: 4, status: 'IMPORTING',
    assets: [], failure: null,
  } }));
  assert.match(html, /<details[^>]*><summary>[\s\S]*Activity result[\s\S]*<\/summary>[\s\S]*<pre>/);
  assert.match(html, /&quot;task_id&quot;: &quot;generation-task&quot;/);
  assert.match(html, /&quot;status&quot;: &quot;IMPORTING&quot;/);
  assert.match(html, /<\/pre>[\s\S]*<\/details>/);
});
