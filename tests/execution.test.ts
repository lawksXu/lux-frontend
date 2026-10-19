import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunProjection, TurnProjection } from '../src/api/types.ts';
import { ExecutionStatus } from '../src/components/ExecutionStatus.tsx';

const timestamp = '2026-10-14T12:00:00Z';
const run: RunProjection = {
  id: 'current-run', user_id: 'owner', session_id: 'session', run_index: 2, source_revision: 2,
  status: 'RUNNING', started_at: timestamp, finished_at: null, final_item_id: null,
  error_code: null, error_message: null, last_seen_at: timestamp, version: 2,
  created_at: timestamp, updated_at: timestamp,
};
const interrupted: TurnProjection = {
  id: 'current-turn', user_id: 'owner', session_id: 'session', run_id: run.id, turn_index: 1,
  source_revision: 3, status: 'INTERRUPTED', started_at: timestamp, finished_at: timestamp,
  error_code: 'OUTCOME_UNKNOWN', error_message: 'External outcome requires reconciliation',
  version: 3, created_at: timestamp, updated_at: timestamp,
};

function render(runs: RunProjection[], turns: TurnProjection[]): string {
  return renderToStaticMarkup(createElement(ExecutionStatus, { streamStatus: 'live', runs, turns }));
}

test('shows an interrupted current Turn error while retaining the running Run status', () => {
  const html = render([run], [interrupted]);
  assert.match(html, /Connected/);
  assert.match(html, /Interrupted/);
  assert.match(html, /Execution: RUNNING/);
  assert.match(html, /Turn: INTERRUPTED/);
  assert.match(html, /role="alert">External outcome requires reconciliation \(OUTCOME_UNKNOWN\)/);
});

test('keeps a current Run error ahead of Turn errors from any Run', () => {
  const failed = { ...run, status: 'FAILED', error_code: 'MODEL_PROVIDER_REJECTED', error_message: 'Current Run failed' };
  const html = render([failed], [interrupted, { ...interrupted, id: 'unrelated', run_id: 'old-run', turn_index: 99 }]);
  assert.match(html, /Current Run failed/);
  assert.doesNotMatch(html, /External outcome requires reconciliation/);
});

test('selects the latest Turn within the latest Run without leaking older execution errors', () => {
  const html = render([
    run, { ...run, id: 'old-run', run_index: 1, status: 'FAILED', error_message: 'Old Run failed' },
  ], [
    { ...interrupted, id: 'new-turn', turn_index: 2, status: 'RUNNING', error_code: null, error_message: null },
    interrupted, { ...interrupted, id: 'old-turn', run_id: 'old-run', turn_index: 99 },
  ]);
  assert.match(html, /Execution: RUNNING/);
  assert.match(html, /Turn: RUNNING/);
  assert.doesNotMatch(html, /Old Run failed|External outcome requires reconciliation|OUTCOME_UNKNOWN/);
});

test('ignores stale Turn errors after the Run has completed', () => {
  const html = render([{ ...run, status: 'COMPLETED', finished_at: timestamp }], [interrupted]);
  assert.match(html, /Execution: COMPLETED/);
  assert.doesNotMatch(html, /INTERRUPTED|OUTCOME_UNKNOWN|External outcome requires reconciliation/);
});

test('a live connection does not imply a completed execution', () => {
  const idle = render([], []);
  assert.match(idle, /Connected/);
  assert.doesNotMatch(idle, /Complete|Working/);
  const working = render([run], [{ ...interrupted, status: 'COMPLETED', error_code: null, error_message: null }]);
  assert.match(working, /Working/);
  assert.doesNotMatch(working, />Complete</);
});

test('keeps execution facts available when the connection is interrupted', () => {
  const html = renderToStaticMarkup(createElement(ExecutionStatus, {
    streamStatus: 'reconnecting', runs: [{ ...run, status: 'COMPLETED' }], turns: [],
  }));
  assert.match(html, /Reconnecting/);
  assert.match(html, />Complete</);
  assert.match(html, /<details[^>]*>.*Execution: COMPLETED.*<\/details>/);
});
