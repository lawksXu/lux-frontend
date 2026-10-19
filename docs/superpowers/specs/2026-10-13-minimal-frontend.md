# Minimal Lux Frontend

Date: 2026-10-13
Status: Approved by the user; implemented locally

## Goal

Create an independent local frontend repository at `/Users/xuwenjie/lux-frontend` that connects to the current Java backend. Deliver a usable chat and generation-result flow with basic semantic HTML and CSS. Visual design and UX refinement are deferred.

## Approach

Use React, TypeScript, Vite and npm. Use browser `fetch`, `EventSource`, `FormData` and native media elements. Avoid a router, global state library, component library, server-rendering framework or additional backend. React components separate connection/session selection, conversation, composer and task/result presentation. Named TypeScript contracts represent the backend fields actually consumed.

Plain TypeScript would reduce dependencies but require more manual UI state management as the chat evolves. Next.js adds server and routing capabilities that this local integration does not require. React with Vite provides the smallest component-based foundation for later UI work.

## Integration boundary

The browser calls only public Java `/api/v1` routes. Vite proxies `/api` to configurable `LUX_BACKEND_URL` (default `http://127.0.0.1:8080`) so JSON, multipart uploads, SSE and private media share one browser origin. Keep the frontend server bound to loopback. A static deployment later needs an equivalent reverse proxy; Vite development configuration is not a deployment.

The current backend selects an existing user by path and has no login. Use configurable `VITE_LUX_USER_ID`, defaulting to the documented local bootstrap UUID, with a simple editable local user selector. Do not invent authentication or expose the local stack publicly. Provider credentials remain outside the frontend.

## Functional scope

- List, create, select and rename Sessions; retain the selected Session locally when it remains accessible.
- Load the newest Item page and older history. Render user/assistant text in immutable `sequence_no` registration order with whitespace preserved. Show execution and tool activity simply without presenting tool output as an assistant answer.
- Send text and uploaded Asset references together. Upload through multipart `file` with `Idempotency-Key`; use `client_request_id` for accepted messages. Show request errors and pending/accepted state accurately.
- Read the initial `/items` snapshot and start SSE after its `last_event_sequence_no`. Reconnect with native EventSource replay; close the previous subscription when user/Session changes. Apply immediate text fragments and complete replacement/invalidations, reject duplicates and preserve Item positions. Later reads must not advance an active SSE cursor past unseen events.
- Expose Session stop and continue controls. Treat HTTP 202 as acceptance; display execution results from backend projections.
- Query Tasks referenced by conversation activity and task invalidations; display their current state, failure and resulting Assets. Use owner-scoped Java media content URLs for image/video/audio previews and download links.
- Display generation plans/focus read-only using their public query endpoints, with basic pagination. Plan changes and submissions remain agent-owned because the current public frontend API does not expose mutations.

## Failure handling

Use a single typed HTTP adapter and named API errors. Keep original request identities and bodies when an outcome is uncertain; allow an explicit retry with the same identity rather than creating a second operation automatically. Disable concurrent duplicate submissions. Guard asynchronous responses so a previous user or Session cannot replace the current view. Show reconnecting state and preserve loaded content during transient stream failure.

## Repository and documentation

Create the local repository without a commit, push or remote service. Add a root AGENTS.md for English documentation, explicit TypeScript structures, Java-only public API access, minimal changes and verification commands; do this only with the user's approval of this proposal. Keep existing instruction files unchanged. Include README, `.env.example`, ignore rules and a lockfile for reproducible installation. Document startup, local user selection, proxy configuration, endpoint scope and limitations.

## Verification

Run TypeScript checking, the production build and focused tests of SSE ordering/replay/replacement, stable request identity, HTTP errors and stale Session responses. Use a local deterministic Java-contract fixture for a browser smoke test of Session creation, sending, streaming, upload and result rendering when browser tooling is available. Record fixture verification separately from any real Java/Agent/Connector/provider acceptance. Do not start paid model/provider calls or modify databases, existing infrastructure or existing backend APIs.

## Deferred work

UI/UX polish, login, remote repository publication, deployment, public plan mutation APIs, direct Python service calls, provider activation and paid acceptance are outside this change.
