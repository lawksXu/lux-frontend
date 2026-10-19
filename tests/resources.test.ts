import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LuxApi } from '../src/api/client.ts';
import type { AssetRecord, GenerationPlanSnapshot, TaskView } from '../src/api/types.ts';
import { PlanList, TaskList } from '../src/components/Resources.tsx';

const timestamp = '2026-10-19T12:00:00Z';

test('creation cards retain every media preview and download with task facts in details', () => {
  const assets: AssetRecord[] = ['image/png', 'video/mp4', 'audio/mpeg', 'application/pdf'].map((mediaType, index) => ({
    id: `asset-${index}`, user_id: 'owner', task_id: 'task', filename: `creation-${index}`, media_type: mediaType,
    size_bytes: 1024, sha256: 'hash', created_at: timestamp,
  }));
  const task: TaskView = {
    id: 'task', session_id: 'session', kind: 'IMAGE', status: 'SUCCEEDED', version: 1,
    error_stage: null, error_code: null, error_message: null, finished_at: timestamp,
    created_at: timestamp, updated_at: timestamp, assets, plan_id: null,
  };
  const html = renderToStaticMarkup(createElement(TaskList, { api: new LuxApi('owner'), tasks: [task] }));
  assert.match(html, />Creations</);
  assert.match(html, />Ready</);
  assert.match(html, /<img[^>]*src="\/api\/v1\/users\/owner\/assets\/asset-0\/content"/);
  assert.match(html, /<video[^>]*controls=""/);
  assert.match(html, /<audio[^>]*controls=""/);
  for (const asset of assets) assert.ok(html.includes(`download="${asset.filename}"`));
  assert.match(html, /<details[^>]*>.*SUCCEEDED.*<\/details>/);
});

test('plan cards retain current focus, exact prompts and all validation issues without a submit action', () => {
  const snapshot: GenerationPlanSnapshot = {
    plan: {
      type: 'generation_plan', schema_version: 1, id: 'plan', user_id: 'owner', session_id: 'session',
      revision: 3, state: 'DRAFT', created_at: timestamp, updated_at: timestamp, frozen_at: null,
      configuration: {
        type: 'image_plan_configuration', model_selection: null,
        intent: { type: 'image_intent', description: 'A quiet coastline', requirements: {
          type: 'image_requirements', prompt: null, size: null, requested_file_count: 1,
          references: null, output_format: null, generation_mode: null,
        } },
        parameters: { type: 'image_parameters', prompt: '  coast\n at dawn  ', size: null, references: [], output_format: null },
        parameter_origins: [],
      },
    },
    validation: { can_submit: false, validated_catalog_revision: 1, issues: [
      { code: 'MODEL_REQUIRED', field: 'MODEL', reference_index: null, message: 'Choose a model', model_selection: null },
      { code: 'SIZE_REQUIRED', field: 'SIZE', reference_index: null, message: 'Choose an output size', model_selection: null },
    ] },
  };
  const html = renderToStaticMarkup(createElement(PlanList, {
    plans: [snapshot], focus: { session_id: 'session', active_plan_id: 'plan', revision: 1 }, more: true, onMore: () => {},
  }));
  assert.match(html, />Current</);
  assert.ok(html.includes('  coast\n at dawn  '));
  assert.match(html, /Choose a model/);
  assert.match(html, /Choose an output size/);
  assert.match(html, /Ask in chat to create, change or submit a plan/);
  assert.match(html, /<details[^>]*>.*Revision.*3.*No model selected.*<\/details>/s);
  assert.match(html, />Load older plans<\/button>/);
  assert.doesNotMatch(html, /<button[^>]*>[^<]*(Submit|Generate)/);
});
