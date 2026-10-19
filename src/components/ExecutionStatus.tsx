import type { RunProjection, TurnProjection } from '../api/types';
import type { ConversationView } from '../chat/controller';

interface ExecutionStatusProps {
  streamStatus: ConversationView['streamStatus'];
  runs: RunProjection[];
  turns: TurnProjection[];
}

interface StatusPresentation {
  label: string;
  tone: 'neutral' | 'working' | 'success' | 'warning' | 'danger';
}

const connections: Record<ConversationView['streamStatus'], StatusPresentation> = {
  loading: { label: 'Loading', tone: 'neutral' },
  connecting: { label: 'Connecting', tone: 'neutral' },
  live: { label: 'Connected', tone: 'success' },
  reconnecting: { label: 'Reconnecting', tone: 'warning' },
  error: { label: 'Connection unavailable', tone: 'danger' },
};

function executionStatus(run: RunProjection, turn: TurnProjection | undefined): StatusPresentation {
  const status = run.status === 'RUNNING' && ['INTERRUPTED', 'FAILED', 'CANCELLED'].includes(turn?.status ?? '')
    ? turn?.status : run.status;
  switch (status) {
    case 'RUNNING': return { label: 'Working', tone: 'working' };
    case 'COMPLETED': return { label: 'Complete', tone: 'success' };
    case 'INTERRUPTED': return { label: 'Interrupted', tone: 'warning' };
    case 'FAILED': return { label: 'Failed', tone: 'danger' };
    case 'CANCELLED': return { label: 'Canceled', tone: 'neutral' };
    case null: case undefined: return { label: 'Synchronizing', tone: 'neutral' };
    default: return { label: status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' '), tone: 'neutral' };
  }
}

export function ExecutionStatus({ streamStatus, runs, turns }: ExecutionStatusProps) {
  const latestRun = [...runs].sort((a, b) => b.run_index - a.run_index)[0];
  const latestTurn = latestRun?.status === 'COMPLETED' ? undefined
    : turns.filter(turn => turn.run_id === latestRun?.id).sort((a, b) => b.turn_index - a.turn_index)[0];
  const failure = latestRun?.error_message || latestRun?.error_code ? latestRun : latestTurn;
  const connection = connections[streamStatus];
  const execution = latestRun ? executionStatus(latestRun, latestTurn) : null;
  return <div className="status-strip">
    <div className="status-summary" role="status">
      <span className={`status-connection status--${connection.tone}`}><span className="status-dot" aria-hidden="true" />{connection.label}</span>
      {execution && <span className={`status-execution status--${execution.tone}`}>{execution.label}</span>}
    </div>
    <details className="status-details">
      <summary>Details</summary>
      <div className="status-facts">
        <p>Stream: {streamStatus}</p>
        {latestRun && <p>Execution: {latestRun.status ?? 'Synchronizing'}</p>}
        {latestTurn && <p>Turn: {latestTurn.status ?? 'Synchronizing'}</p>}
      </div>
    </details>
    {(failure?.error_message || failure?.error_code) && <p className="status-error" role="alert">{failure.error_message}{failure.error_code && ` (${failure.error_code})`}</p>}
  </div>;
}
