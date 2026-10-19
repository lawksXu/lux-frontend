# Lux Frontend

A React and TypeScript creative workspace for the current Lux Java public API. It supports Sessions, ordered conversation history, streaming replies, text and Asset inputs, execution controls, Task results, private media previews, and read-only generation plans. The responsive workspace keeps conversation, creation progress and media together. Authentication remains deferred.

Use Node.js **22.12 or newer** and npm. If your shell defaults to an older Node version, select a compatible version with `nvm use 22` before installing or running commands.

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite binds to loopback and proxies `/api` to `LUX_BACKEND_URL`, which defaults to `http://127.0.0.1:8080`. The browser uses one origin for JSON, multipart uploads, SSE and media. The container deployment below provides the same reverse proxy.

The default owner is the Java local bootstrap user `00000000-0000-0000-0000-000000000001`. Set `VITE_LUX_USER_ID` before starting Vite or open **Local workspace** in the sidebar to edit the local user selector. Selecting an owner by path is **not authentication**; use this client only with the local stack. The development server does not start Java, Python, Kafka or databases.

```sh
LUX_BACKEND_URL=http://127.0.0.1:8080 VITE_LUX_USER_ID=00000000-0000-0000-0000-000000000001 npm run dev
npm run typecheck
npm test
npm run build
npm run preview
```

`npm run build` produces `dist/`; preview uses loopback port 4173. `.env.example` documents the two configuration variables. Keep local `.env` files and credentials out of Git. Provider credentials never belong in the frontend.

## Workspace interaction

- Create a named chat or leave its title blank for **Untitled chat**. Search filters the loaded chat list locally.
- Press **Enter** to send and **Shift + Enter** for a new line. IME composition does not submit. Empty messages and unresolved uploads cannot be submitted; attachment-only messages remain supported.
- Prompt starters fill the composer without sending. Unsent text drafts are saved in tab session storage, scoped to the owner and chat; confirmed sends clear only their own pending draft.
- Conversation history scrolls independently of the composer. Loading older messages preserves the reading position; **Back to latest** resumes following new replies.
- Open **Studio** for creations, downloads and read-only plans. On narrow screens it replaces the chat area; close it or press **Escape** to return. The mobile navigation button expands the chat list.
- Rename a chat using its pencil button. Connection and execution labels are separate; expand **Details** for raw status facts. Interrupted replies retain an explicit label, and tool activity stays available in disclosures.

## Container deployment

The sibling `lux-java-backend` repository owns the shared Docker Compose stack. Follow its `deploy/local/README.md` to build and start the `frontend` service alongside Java and the Python services. Open [http://127.0.0.1:18082](http://127.0.0.1:18082); `LUX_FRONTEND_PORT` overrides the host port. Vite development on port 5173 remains available.

The Docker image builds `dist/` with Node.js 22 and `npm ci`, then serves it with Nginx as the unprivileged `nginx` user on container port 8080. Nginx forwards `/api/` to `java-backend:8080` in the Compose network, preserving request paths and queries. Streaming responses and uploads use the same origin; SSE buffering and automatic upstream retries are disabled. Docker DNS refreshes the Java service address after container replacement. The `/health` endpoint checks Nginx availability; it does not establish backend or provider health.

Compose runs the frontend with a read-only root filesystem and a temporary `/tmp` filesystem for Nginx runtime files. Local environment files, credentials, dependencies and browser artifacts are excluded from the build context. The built browser bundle uses the default bootstrap owner; use the local user selector to change it. Runtime environment variables do not reconfigure the already built browser bundle, and provider credentials stay in the backend services.

For a deterministic browser smoke test, run the in-memory fixture in one terminal and Vite in another:

```sh
npm run fixture
```

```sh
LUX_BACKEND_URL=http://127.0.0.1:18080 npm run dev
```

The fixture binds to `127.0.0.1:18080`; `FIXTURE_PORT` overrides the port. Restarting clears its in-memory Sessions, receipts and uploaded bytes. It seeds the default user and a Session titled **Local fixture conversation**, with 56 Items for history pagination, a completed image Task, a one-pixel PNG result, and a draft image plan with a `MODEL_REQUIRED` validation issue. It implements only public owner-scoped `/api/v1` paths. Sending produces deterministic partial text, a complete replacement, Run notifications and local Task/media metadata. Stop and continue return stable acceptance receipts; the fixture does not simulate execution cancellation.

| Fixture resource | ID |
| --- | --- |
| Session | `10000000-0000-0000-0000-000000000001` |
| Task | `20000000-0000-0000-0000-000000000001` |
| Plan | `30000000-0000-0000-0000-000000000001` |
| Result Asset | `40000000-0000-0000-0000-000000000001` |

The client calls only Java public endpoints under `/api/v1/users/{user_id}`: Sessions and their Items/events, messages, stop/continue, read-only Run projections, Asset uploads/metadata/content, Task queries/batches, and plan/focus queries. Plans are displayed with their validation and focus; current public endpoints do not expose plan mutations or submission. Those operations remain agent-owned.

HTTP 202 means accepted input or control, not execution completion. Java Task states are `CREATED`, `SUBMITTED`, `RUNNING`, `IMPORTING`, `SUCCEEDED` and `FAILED`; `IMPORTING` means generated files are being imported and verified. A connector result is not a Java Asset until import completes.

The initial Item snapshot supplies the SSE replay cursor. Item `sequence_no` controls registration order; Python execution indexes and Java SSE event IDs are separate sequences. Later history or refresh snapshots do not advance an active SSE cursor past unseen notifications. Native EventSource reconnects with `Last-Event-ID`; the backend gives that header precedence over the initial `after` query. Text fragments preserve whitespace, while complete replacements determine the final content.

Mutation retries retain their original request identity and body. After an uncertain response, use the explicit retry for that operation; changing the body requires a new operation. Sessions and uploads use `Idempotency-Key`, while messages use `client_request_id`. The application closes stale subscriptions and guards asynchronous responses when changing owner or Session.

Pending messages, Session mutations and controls are retained in browser session storage, scoped by owner and Session as appropriate. Original upload Files and keys remain in this tab's memory across Session navigation; File bytes cannot survive a page reload. Confirm acceptance or retry an uncertain upload before reloading. Removing an attachment removes it from the composer; it does not delete the backend Asset. Sessions remembered outside the latest list are checked through the single-Session endpoint before falling back.

Fixture tests cover stable send/create/rename/control/upload receipts, identity conflicts, SSE cursor replay, multipart bytes and owner-scoped media ranges. These checks and the browser fixture smoke flow do not establish live Java/Python/provider behavior, billing, image quality, database durability or deployment acceptance. See [verification notes](docs/verification.md) for the checks actually completed.
