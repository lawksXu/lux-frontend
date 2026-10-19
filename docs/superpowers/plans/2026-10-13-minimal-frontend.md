# Minimal Lux Frontend Implementation Plan

**Goal:** Connect an independent local React frontend to current Java public APIs.

**Architecture:** Named HTTP contracts and one API client isolate transport. A pure conversation reducer maintains ordered Item projections and SSE replay state. Components provide session selection, composition, activity, tasks/media and read-only plans.

**Tech stack:** React, TypeScript, Vite, npm, Node test runner with tsx; native fetch/EventSource/FormData.

## Constraints

- Only public Java `/api/v1` routes; development proxy to loopback Java.
- Preserve snake_case wire fields, exclusive history cursors, immutable Item ordering and original request IDs.
- Initial snapshot starts SSE; later snapshots never advance the active replay cursor.
- Tool/provider schemas not interpreted by this client stay opaque within named structures.
- No existing backend changes, paid calls, commits, branches, remote publication or deployment.
- New root AGENTS.md is explicitly approved; existing instruction files stay unchanged.
- UI/UX polish is deferred.

## Task 1: Typed HTTP boundary

Files: `src/api/types.ts`, `src/api/decode.ts`, `src/api/client.ts`, `tests/api.test.ts`.

- [x] Define the exact consumed Session, Item, execution, Task, Asset, plan and SSE types from current Java controllers and records.
- [x] Write failing tests for owner-scoped URLs, stable send/control identities on retry, ProblemDetail, multipart upload and paired plan cursors; run with `npm test`.
- [x] Implement `LuxApi` with methods `sessions`, `createSession`, `renameSession`, `items`, `item`, `run`, `send`, `control`, `upload`, `asset`, `tasks`, `plans`, `focus`, `eventsUrl`, `assetUrl`.
- [x] Decode untrusted consumed fields into named types; do not auto-retry mutations. Re-run boundary tests.

## Task 2: Conversation state

Files: `src/chat/state.ts`, `tests/state.test.ts`.

- [x] Write failing tests with interleaved USER/AGENT Items, duplicated deltas, whitespace, gaps, complete replacement, stale snapshot refresh and historical-page merge.
- [x] Implement `initialConversation(page)`, `mergePage(state, page)`, `mergeItem(state, item)` and `applyEvent(state, event)` as pure functions.
- [x] Persist contiguous per-Item fragments using stream_seq, buffer gaps and ignore post-terminal deltas. State includes ordered Items, Runs, Turns and a separate SSE cursor.
- [x] Run state tests; verify snapshot merges do not advance an already active cursor.

## Task 3: Functional UI and lifecycle

Files: `src/App.tsx`, `src/chat/useConversation.ts`, `src/chat/message.ts`, `src/chat/pending.ts`, `src/chat/uploads.ts`, `src/chat/sessions.ts`, `src/components/Conversation.tsx`, `src/components/Composer.tsx`, `src/components/Resources.tsx`, `src/style.css`, `src/main.tsx`.

- [x] Load the configured local user and sessions, restore accessible selection, create/rename with retained UUIDs after uncertain errors.
- [x] Load the initial snapshot before subscribing to named SSE; close stale subscriptions and guard old requests on owner/Session changes.
- [x] Render ordered text/media and collapsed tool activity. Fetch current Tasks and Assets through owner-scoped public endpoints.
- [x] Send bounded text and uploaded Asset references with one immutable request ID/body per attempt; expose explicit same-operation retries.
- [x] Implement stop/continue acceptance feedback, history pagination, stream state, read-only plan validation/focus and paired plan pagination.

## Task 4: Fixture, review and verification

Files: `scripts/fixture-server.ts`, `README.md`, `docs/verification.md`.

- [x] Implement a loopback deterministic fixture matching Java DTO/SSE shapes without paid providers.
- [x] Run `npm test`, `npm run typecheck`, `npm run build` and browser smoke through the same-origin proxy.
- [x] Review spec coverage and race/error paths; fix demonstrated defects and re-run affected checks.
- [x] Document startup, endpoint scope, fixture evidence, limitations and dependencies.
- [x] Place the verified repository at `/Users/xuwenjie/lux-frontend`, initialize local Git without committing, and confirm existing backend state is unchanged.
