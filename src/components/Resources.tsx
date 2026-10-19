import { useEffect, useState } from 'react';
import type { LuxApi } from '../api/client';
import type { AssetRecord, GenerationPlanSnapshot, SessionPlanFocus, TaskView } from '../api/types';
import { Icon } from './Icon';

interface ResourceStatus {
  label: string;
  tone: 'neutral' | 'working' | 'success' | 'danger';
}

const taskStatuses: Readonly<Record<string, ResourceStatus | undefined>> = {
  CREATED: { label: 'Queued', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'working' },
  RUNNING: { label: 'Generating', tone: 'working' },
  IMPORTING: { label: 'Preparing files', tone: 'working' },
  SUCCEEDED: { label: 'Ready', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

export function AssetView({ api, assetId, asset: provided }: { api: LuxApi; assetId: string; asset?: AssetRecord }) {
  const [asset, setAsset] = useState<AssetRecord | null>(provided ?? null);
  const [error, setError] = useState<string | null>(null);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setAsset(provided ?? null);
    setError(null);
    setPlaybackFailed(false);
    if (!provided) void api.asset(assetId, abort.signal).then(record => {
      if (!abort.signal.aborted) setAsset(record);
    }).catch(problem => {
      if (!abort.signal.aborted) setError(problem instanceof Error ? problem.message : 'Asset unavailable');
    });
    return () => abort.abort();
  }, [api, assetId, provided]);
  const url = api.assetUrl(assetId);
  if (error) return <p className="resource-error" role="alert">{error}</p>;
  if (!asset) return <p className="asset-fallback">Loading attachment…</p>;
  const hasPreview = /^(image|video|audio)\//.test(asset.media_type);
  return <figure className="asset-preview">
    {!playbackFailed && asset.media_type.startsWith('image/') && <img src={url} alt={asset.filename} loading="lazy" onError={() => setPlaybackFailed(true)} />}
    {!playbackFailed && asset.media_type.startsWith('video/') && <video src={url} controls preload="metadata" onError={() => setPlaybackFailed(true)} />}
    {!playbackFailed && asset.media_type.startsWith('audio/') && <audio src={url} controls preload="metadata" onError={() => setPlaybackFailed(true)} />}
    {playbackFailed && <p className="asset-fallback">Preview unavailable. Download the file to open it.</p>}
    {!hasPreview && <div className="asset-file"><Icon name="file" /><span>File attachment</span></div>}
    <figcaption className="asset-caption">
      <span className="asset-name" title={asset.filename}>{asset.filename}<small>{formatBytes(asset.size_bytes)}</small></span>
      <a className="asset-download" href={url} download={asset.filename} aria-label={`Download ${asset.filename}`} title={`Download ${asset.filename}`}><Icon name="download" /></a>
    </figcaption>
  </figure>;
}

export function TaskList({ api, tasks }: { api: LuxApi; tasks: TaskView[] }) {
  return <section className="resource-panel" aria-label="Creations">
    <div className="resource-heading"><h2>Creations</h2><span className="resource-count">{tasks.length}</span></div>
    {!tasks.length && <div className="resource-empty"><Icon name="image" /><p>Your creations live here.</p><span>Ask Lux to make an image or video.</span></div>}
    {tasks.map(task => {
      const status = taskStatuses[task.status] ?? { label: friendlyLabel(task.status), tone: 'neutral' };
      return <article key={task.id} className="resource-card">
        <div className="resource-card-heading">
          <h3 className="resource-kind"><Icon name={task.kind === 'IMAGE' ? 'image' : task.kind === 'VIDEO' ? 'video' : 'file'} />{friendlyLabel(task.kind)}</h3>
          <span className={`resource-badge resource-badge--${status.tone}`}>{status.label}</span>
        </div>
        {task.status === 'IMPORTING' && <p className="resource-note">Verifying generated files…</p>}
        {task.error_message && <p className="resource-error" role="alert">{task.error_stage}: {task.error_message} ({task.error_code})</p>}
        {task.assets.map(asset => <AssetView key={asset.id} api={api} assetId={asset.id} asset={asset} />)}
        <details className="resource-details">
          <summary>Creation details</summary>
          <dl className="resource-facts"><dt>Task ID</dt><dd>{task.id}</dd><dt>Status</dt><dd>{task.status}</dd></dl>
        </details>
      </article>;
    })}
  </section>;
}

export function PlanList({ plans, focus, more, onMore }: {
  plans: GenerationPlanSnapshot[]; focus: SessionPlanFocus | null; more: boolean; onMore: () => void;
}) {
  return <section className="resource-panel" aria-label="Plans">
    <div className="resource-heading"><h2>Plans</h2><span className="resource-count">{plans.length}</span></div>
    <p className="resource-note">Ask in chat to create, change or submit a plan.</p>
    {!plans.length && <div className="resource-empty"><Icon name="layers" /><p>No plans yet.</p><span>Describe what you want to create in chat.</span></div>}
    {plans.map(({ plan, validation }) => <article key={plan.id} className="resource-card">
      <div className="resource-card-heading">
        <h3 className="resource-kind"><Icon name={plan.configuration.type === 'image_plan_configuration' ? 'image' : 'video'} />{plan.configuration.type === 'image_plan_configuration' ? 'Image' : 'Video'} plan</h3>
        {focus?.active_plan_id === plan.id && <span className="plan-focus">Current</span>}
      </div>
      <p className="plan-intent">{plan.configuration.intent.description}</p>
      <span className="resource-badge resource-badge--neutral">{plan.state === 'DRAFT' ? 'Draft' : 'Locked'}</span>
      {plan.configuration.parameters.prompt && <details className="plan-prompt"><summary>Prompt</summary><p>{plan.configuration.parameters.prompt}</p></details>}
      <p className={`plan-readiness${validation.can_submit ? ' plan-readiness--ready' : ''}`}><Icon name={validation.can_submit ? 'check' : 'alert'} />{validation.can_submit ? 'Ready to submit through chat' : 'Needs attention'}</p>
      {!!validation.issues.length && <ul className="plan-issues">{validation.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
      <details className="resource-details">
        <summary>Plan details</summary>
        <dl className="resource-facts">
          <dt>Plan ID</dt><dd>{plan.id}</dd><dt>State</dt><dd>{plan.state}</dd>
          <dt>Revision</dt><dd>{plan.revision}</dd><dt>Model</dt><dd>{plan.configuration.model_selection?.model_id ?? 'No model selected'}</dd>
        </dl>
      </details>
    </article>)}
    {more && <button className="plan-more" onClick={onMore}>Load older plans</button>}
  </section>;
}

function formatBytes(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function friendlyLabel(value: string): string {
  const words = value.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
