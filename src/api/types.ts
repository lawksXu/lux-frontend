export type ContentBlock = { type: 'text'; text: string } | { type: 'asset'; asset_id: string };
export interface OrderedContent { blocks: ContentBlock[] }

// Provider/tool arguments are owned by Java and Python. The browser never interprets them.
export type OpaqueJson = null | boolean | number | string | OpaqueJson[] | { [key: string]: OpaqueJson };
export interface ToolCallContent { arguments: OpaqueJson }
export interface TaskAssetReference { asset_id: string; source_index: number }
export interface TaskFailure { stage: string; code: string; message: string }
export interface TaskSubmissionReceipt { type: 'task_submission_receipt'; task_id: string; accepted: boolean }
export interface TaskQuerySnapshot {
  type: 'task_query_snapshot'; task_id: string; version: number; status: string;
  assets: TaskAssetReference[]; failure: TaskFailure | null;
}
export interface ToolError { type: 'tool_error'; code: string; message: string }
export interface TaskEventContent { task_id: string }
export interface SubmittedTask { index: number; task_id: string; task_operation_id: string }
export interface PlanTaskSubmissionReceipt {
  type: 'plan_task_submission_receipt'; plan_id: string; frozen_plan_revision: number;
  accepted: true; requested_file_count: number; tasks: SubmittedTask[]; focus: SessionPlanFocus;
}
export interface PlanMutationReceipt {
  type: 'generation_plan_mutation_receipt'; action: string; source_plan_id: string | null;
  snapshot: GenerationPlanSnapshot; focus: SessionPlanFocus;
}
export interface PlanFocusReceipt { type: 'generation_plan_focus_receipt'; focus: SessionPlanFocus }
export interface PlanToolRejection {
  type: 'generation_plan_tool_rejection'; code: string; message: string;
  current_plan_revision: number | null; current_focus_revision: number | null;
  issues: ValidationIssue[]; business_execution: 'NOT_PERFORMED';
}
// Catalog content is displayed as tool activity; the browser does not read provider capabilities.
export interface ModelCatalogToolResult { type: 'model_catalog_snapshot' }
export type ItemPayload = OrderedContent | ToolCallContent | TaskSubmissionReceipt | TaskQuerySnapshot
  | ToolError | TaskEventContent | PlanTaskSubmissionReceipt | PlanMutationReceipt | PlanFocusReceipt
  | PlanToolRejection | ModelCatalogToolResult | PlanPage;

export interface SessionRecord {
  id: string; user_id: string; title: string; next_item_seq: number; version: number;
  created_at: string; updated_at: string;
}
export interface ItemProjection {
  id: string; user_id: string; session_id: string; sequence_no: number; source: string;
  kind: string | null; run_id: string | null; turn_id: string | null; item_index: number | null;
  input_sequence_no: number | null; status: string | null; call_id: string | null;
  tool_name: string | null; task_id: string | null; payload: ItemPayload | null;
  source_revision: number; completed_at: string | null; version: number; created_at: string; updated_at: string;
}
export interface RunProjection {
  id: string; user_id: string; session_id: string; run_index: number; source_revision: number;
  status: string | null; started_at: string | null; finished_at: string | null; final_item_id: string | null;
  error_code: string | null; error_message: string | null; last_seen_at: string | null;
  version: number; created_at: string; updated_at: string;
}
export interface TurnProjection {
  id: string; user_id: string; session_id: string; run_id: string; turn_index: number; source_revision: number;
  status: string | null; started_at: string | null; finished_at: string | null;
  error_code: string | null; error_message: string | null; version: number; created_at: string; updated_at: string;
}
export interface SessionProjectionPage {
  items: ItemProjection[]; runs: RunProjection[]; turns: TurnProjection[];
  next_before_sequence_no: number | null; last_event_sequence_no: number;
}
export interface AcceptedInputItem {
  id: string; sequence_no: number; input_sequence_no: number; source: string; kind: string; content: OrderedContent;
}
export interface InputAcceptanceResponse { item: AcceptedInputItem }
export interface SessionTitleInput { title: string }
export interface TaskBatchInput { ids: string[] }
export interface MessageInput { client_request_id: string; content: ContentBlock[] }
export interface ControlAcceptanceResponse { event_id: string }
export interface AssetRecord {
  id: string; user_id: string; task_id: string | null; filename: string; media_type: string;
  size_bytes: number; sha256: string; created_at: string;
}
export interface TaskView {
  id: string; session_id: string; kind: string; status: string; version: number;
  error_stage: string | null; error_code: string | null; error_message: string | null;
  finished_at: string | null; created_at: string; updated_at: string; assets: AssetRecord[]; plan_id: string | null;
}

export interface RunIdentity { id: string; run_index: number }
export interface TurnIdentity { id: string; turn_index: number; run: RunIdentity }
export interface AgentItemIdentity { id: string; item_index: number; turn: TurnIdentity }
export interface AgentItemSnapshot {
  item: AgentItemIdentity; source: string; source_revision: number; kind: string; status: string;
  payload: ItemPayload; completed_at: string | null; call_id: string | null; tool_name: string | null;
}
export interface ItemTextDelta { item: AgentItemIdentity; stream_seq: number; text: string }
export interface ItemNotification<Body> { item_id: string; item_sequence_no: number; body: Body }
export type SessionEvent =
  | { type: 'ITEM_CREATED'; sequence: number; payload: ItemNotification<ItemProjection> }
  | { type: 'ITEM_TEXT_DELTA'; sequence: number; payload: ItemNotification<ItemTextDelta> }
  | { type: 'ITEM_CONTENT_REPLACED'; sequence: number; payload: ItemNotification<{ snapshot: AgentItemSnapshot }> }
  | { type: 'SESSION_UPDATED'; sequence: number; payload: { title: string } }
  | { type: 'RUN_UPDATED'; sequence: number; payload: { run_id: string } }
  | { type: 'TURN_UPDATED'; sequence: number; payload: { turn_id: string } }
  | { type: 'TASK_UPDATED'; sequence: number; payload: { task_id: string } }
  | { type: 'PLAN_UPDATED'; sequence: number; payload: { plan_id: string; revision: number } }
  | { type: 'PLAN_FOCUS_CHANGED'; sequence: number; payload: { focus: SessionPlanFocus } };

export interface PlansCursor { before_created_at: string; before_id: string }
export interface SessionPlanFocus { session_id: string; active_plan_id: string | null; revision: number }
export interface ModelSelection { model_id: string; profile_id: string; capability_revision: number }
export interface AspectRatio { width_units: number; height_units: number }
export interface PixelDimensions { width: number; height: number }
export type DraftOutputSize =
  | { type: 'ratio_size'; aspect_ratio: AspectRatio | null; resolution_id: string | null }
  | { type: 'pixel_size'; dimensions: PixelDimensions };
export interface ReferenceAsset { type: 'reference_asset'; asset_id: string }
export interface ImageRequirements {
  type: 'image_requirements'; prompt: string | null; size: DraftOutputSize | null;
  requested_file_count: number | null; references: ReferenceAsset[] | null; output_format: string | null;
  generation_mode: string | null;
}
export interface VideoRequirements {
  type: 'video_requirements'; prompt: string | null; size: DraftOutputSize | null;
  requested_file_count: number | null; references: ReferenceAsset[] | null; output_format: string | null;
  duration_seconds: number | null; generate_audio: boolean | null; generation_mode: string | null;
}
export interface ImageIntent { type: 'image_intent'; description: string; requirements: ImageRequirements }
export interface VideoIntent { type: 'video_intent'; description: string; requirements: VideoRequirements }
export interface ImageParameters {
  type: 'image_parameters'; prompt: string | null; size: DraftOutputSize | null;
  references: ReferenceAsset[]; output_format: string | null;
}
export interface VideoParameters {
  type: 'video_parameters'; prompt: string | null; size: DraftOutputSize | null;
  references: ReferenceAsset[]; output_format: string | null; duration_seconds: number | null; generate_audio: boolean | null;
}
export interface ParameterOrigin { field: string; source: string; source_model: ModelSelection | null }
export type PlanConfiguration =
  | { type: 'image_plan_configuration'; model_selection: ModelSelection | null; intent: ImageIntent;
      parameters: ImageParameters; parameter_origins: ParameterOrigin[] }
  | { type: 'video_plan_configuration'; model_selection: ModelSelection | null; intent: VideoIntent;
      parameters: VideoParameters; parameter_origins: ParameterOrigin[] };
export interface GenerationPlan {
  type: 'generation_plan'; schema_version: 1; id: string; user_id: string; session_id: string;
  revision: number; state: 'DRAFT' | 'FROZEN'; configuration: PlanConfiguration;
  created_at: string; updated_at: string; frozen_at: string | null;
}
export interface ValidationIssue {
  code: string; field: string; reference_index: number | null; message: string; model_selection: ModelSelection | null;
}
export interface PlanValidation { can_submit: boolean; issues: ValidationIssue[]; validated_catalog_revision: number }
export interface GenerationPlanSnapshot { plan: GenerationPlan; validation: PlanValidation }
export interface PlanPage {
  type: 'generation_plan_read_result'; focus: SessionPlanFocus; plans: GenerationPlanSnapshot[]; next_cursor: PlansCursor | null;
}
export interface ProblemDetail {
  type?: string; title?: string; status?: number; detail?: string; instance?: string; code?: string;
}
