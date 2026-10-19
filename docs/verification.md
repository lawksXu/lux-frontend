# Minimal Frontend Verification

Initial verification: 2026-10-13. Latest container verification: 2026-10-14 (America/Los_Angeles).

## Executed checks

- `npm test`: 64 tests passed, zero failures or skipped tests.
- `npm run typecheck`: passed with strict TypeScript checking.
- `npm run build`: passed; Vite produces static files in `dist/`.
- Independent source review: lifecycle and retained-operation findings were reproduced, fixed and covered by regression tests.

| Suite | Tests | Behavior protected |
| --- | ---: | --- |
| API | 15 | Native fetch invocation, owner-scoped reads, original mutation IDs, multipart boundaries, ProblemDetail, named DTO/SSE decoding and paired plan cursors |
| Conversation controller | 6 | Initial snapshot watermark, disposed requests, refresh cursors, reconnect state, Tasks outside loaded history and stream restart |
| Fixture HTTP | 4 | Idempotent receipts, conflicts, SSE replay, multipart bytes, private media ranges and PNG integrity |
| Message input | 4 | Whitespace, content limits, restored inputs and identity-matched acceptance cleanup |
| Pending controls/Sessions | 12 | Navigation/reload retention, scope isolation, validation, fallback storage and delayed responses preserving newer requests |
| Session selection | 3 | Accessible remembered Sessions beyond the newest list, confirmed 404 fallback and aborted owner requests |
| Conversation state | 13 | Registration order, fragment gaps/duplicates, final replacement, source shells and snapshot/history merging |
| Upload retention | 3 | Original File/key across navigation and accepted messages preserving newer attachments |
| Execution status | 4 | Latest current-Run Turn errors, Run-error precedence, old execution isolation and completion clearing |

## Browser smoke

The Codex in-app browser loaded Vite through its same-origin proxy to the deterministic loopback fixture. The following were visibly confirmed:

1. Load the default owner and its existing Session.
2. Create a Session and rename it to `Frontend verified`.
3. Send text containing a newline; observe `PARTIAL` streaming text followed by `COMPLETED` replacement and a final answer.
4. Upload a generated PNG through the browser file chooser and multipart endpoint; send its Asset reference with text.
5. Display the uploaded image and generated Task/result images through Java-shaped private content routes. DOM image decoding reported a natural width of one pixel, matching the fixture.
6. Accept stop/continue controls and show acceptance feedback.
7. Switch Sessions, load older history, and display the focused draft plan plus its validation issue.
8. Select an unknown owner, show the API error with no previous owner's conversation, then restore the default owner.

An ignored local screenshot is saved at `artifacts/frontend-smoke.png`.

## Limits

The HTTP fixture is an in-memory test boundary shaped from current Java controllers and DTOs. It does not establish live Java/Agent/Connector execution, paid provider behavior, billing, database durability, deployment or media quality. Stop/continue browser checks establish HTTP acceptance only; the fixture does not execute cancellation. Native reconnect cursor handling and races have focused tests; broker/process failure recovery was not tested here.

Browser media verification used PNG only. Video/audio elements and download fallback are implemented, but codec/playback compatibility still needs real media tests. Paired plan pagination is API-tested; the seeded browser fixture contains one plan. Login and public plan mutation endpoints are absent from the current backend and are not invented by this client.

During the initial fixture verification, existing Lux backend and Python repository files were not modified. No live provider calls, infrastructure changes, commits, pushes or remote repository creation were performed at that stage.


## Running Java backend integration

On 2026-10-13, the frontend development proxy was connected to the already-running Java service at `http://127.0.0.1:18081`. The frontend remains available at `http://127.0.0.1:5173`; its ignored `.env.local` records `LUX_BACKEND_URL=http://127.0.0.1:18081`.

The integration used one new Session, two accepted USER inputs, one 70-byte PNG upload, and one stop/continue pair. Java, Agent and Connector real-provider execution flags were inspected and remained disabled; no provider configuration was changed.

- Real health and default-user queries succeeded.
- Session creation exposed a frontend decoder defect: Java's empty Session has `next_item_seq=0`. The decoder now accepts zero and still rejects negatives. A regression covers creation, list and single-Session reads; the fixture now starts at zero and increments before allocation, matching Java.
- Replaying the original browser creation request returned its original receipt. The real Session list still contained exactly one test Session.
- Rename and both message submissions succeeded through the frontend proxy. SSE delivered registration and execution changes to the browser.
- The real Agent emitted Run/Turn facts ending with `FAILED` / `MODEL_NOT_CONFIGURED`; the frontend displayed the error. This proves current local command/projection delivery, not model generation.
- Browser multipart upload returned Asset `e27cd0ef-865b-44d6-8807-d6bf2d04b966`. Its metadata size was 70 bytes, its SHA-256 matched the original bytes, and the browser decoded the PNG as 1 by 1 pixels.
- `Range: bytes=0-7` returned HTTP 206, the expected Content-Range and the original PNG signature bytes.
- SSE replay with `Last-Event-ID: 19` returned IDs 20 and 21, despite a conflicting `after=999999` query, confirming header precedence.
- Stop and continue returned accepted control receipts; this was not a cancellation-of-running-model test.
- Real public plan list and focus reads succeeded with no plans and no active focus. Live plan content and Task result generation remain untested.
- After the fix, all 60 tests, strict type checking and the production build passed.

Test Session: `82e6c874-56d9-4f0d-8fd8-4f71432df825`, titled `Frontend Java API verified`. Its two inputs and uploaded Asset remain in the user's local stack. No existing data was deleted or reset.

Ignored evidence files: `artifacts/real-backend-evidence.json` and `artifacts/real-backend-smoke.png`. At this stage, actual text deltas, paid provider execution, generated Task outputs and full restart/durability acceptance were not exercised because real execution was disabled.


## Authorized real provider verification

On 2026-10-14, explicit user authorization enabled OpenAI, Connector execution and Java BytePlus generation in the existing `lux-dev` stack. Credentials and Compose overrides are confined to Git-ignored backend files with mode `0600`; no provider key is present in frontend configuration. Existing infrastructure and data volumes were retained.

- Java, Agent and Connector health endpoints returned HTTP 200. Container inspection confirmed all three provider flags enabled and the required keys present, without printing key values.
- Browser text Session `4d5092e9-cfc4-457c-a507-bd41c3630c4e` completed with the exact answer `Lux live integration OK.`
- A separate read-only Agent tool diagnostic completed `get_model_catalog` and returned four enabled models.
- An earlier image model invocation (`18f16022-5b5d-4b37-a1fb-d90c2f143c99`, Session `054b4af2-1485-4abd-a887-fd9267cc38cd`) remains `UNKNOWN` without a provider response ID. It was not resubmitted. Offline mock replays passed in both installed SDK versions; existing evidence cannot identify its original HTTP/transport error. The Agent now logs only execution ID, exception class and HTTP status for uncertain SDK failures.
- The independent Java-plan image Task `95fc434b-656e-4d1c-8631-77cd4936865b` definitively failed: BytePlus rejected `output_format` for Seedream 4.5. The Connector now omits that unsupported provider field only for 4.5 and retains JPEG verification; Lite/Pro keep explicit output formats.
- A fresh frontend Session `c7c3cf70-4a9f-4ac2-82de-5366a9e13545` then completed the actual chat-to-plan-to-Task-to-Asset workflow. Its observed tool calls were `create_generation_plan`, one `submit_generation_plan`, and `get_task`. Task `07f30df1-ec2d-4a90-ace7-953c64ed41dd` reached `SUCCEEDED`; both the initiating Run and result-notice Run reached `COMPLETED`.
- The result Asset `701c36d2-78c8-3ede-bb41-593c5b44a4d8` is one 560844-byte JPEG. Browser decoding reported 2048 by 2048 pixels; fetched bytes matched metadata SHA-256 and the JPEG signature. The browser displayed the Task image and focused FROZEN revision-2 plan.
- The frontend now displays the current Run's latest Turn status/error, including `OUTCOME_UNKNOWN`, while preserving the actual Run status. Older Run/Turn errors do not leak into the active execution.
- Final checks passed: frontend 64 tests, type checking and production build; Agent 34 targeted tests; Connector 96 targeted tests with 15 environment-dependent cases skipped; modified Python files passed Ruff lint/format, and diffs passed whitespace checks.

Docker Desktop's usual socket stalled application startup; the repository's documented raw socket started the same containers successfully. A full Agent image rebuild was blocked by the local proxy while fetching Docker Hub authorization. The tested Agent diagnostic and Connector adapter changes were instead applied as offline COPY layers on existing local images, without dependency changes. A future clean image build still depends on registry connectivity.

This verifies one live text flow, a read-only model tool call and one successful Seedream 4.5 image flow. Other image models and video generation are enabled but were not called. Running-model cancellation, billing reconciliation, and comprehensive process-failure recovery were not exercised. The original unresolved model invocation and test Sessions/Tasks remain retained for inspection.

Ignored evidence: `artifacts/live-provider-evidence.json` and `artifacts/live-provider-smoke.png`.


## Frontend Docker Compose deployment

On 2026-10-14, the default `frontend` service was added to the existing local stack and deployed at `http://127.0.0.1:18082`. The image built from the frontend Dockerfile with `npm ci` and `npm run build` in Node 22, then served the static bundle with non-root Nginx on container port 8080. The runtime container is healthy with a read-only root filesystem and bounded writable `/tmp`; it receives no provider credentials.

- Merged Compose configuration preserved the current generated extras and private provider overrides. Only the frontend container was added; all seven pre-existing container identities were unchanged and their healthchecks remained healthy.
- The deterministic integration override places frontend in an inactive profile. Configuration validation still produced the original eight active acceptance services; the existing full acceptance stack was not rerun for this change.
- `nginx -t` passed. Frontend health, HTML, hashed JavaScript/CSS and owner-scoped Java Session reads returned HTTP 200 through port 18082. HTML was marked `no-cache`; hashed assets were immutable, and missing static/API resources returned HTTP 404.
- Two short text inputs in Session `bef948dd-6565-4ed9-8c58-986e489a3d26` completed. The browser displayed `Lux Docker frontend OK.` and `Lux Docker SSE OK.`. No media generation was submitted during this deployment verification.
- The live SSE observer received USER/Run/Turn events and text deltas before the final replacement. For the browser message, the first event arrived at 5093 ms and final replacement at 9649 ms after observer startup. The actual Java replacement status was `COMPLETED`; the initial observer expected `FINAL` and timed out after that first message had completed. Only the observer condition was corrected, and the original completed request was not resubmitted.
- A 2097169-byte multipart upload succeeded, exceeding Nginx's usual one-MiB default. Its size and SHA-256 matched the source. Reusing the original upload key returned the same Asset ID; a byte-range read in its second MiB returned the original bytes. The configured 101 MiB request ceiling was not fully exercised.
- The retained generated JPEG was served through the same frontend origin with its original size and SHA-256. `Range: bytes=0-7` returned HTTP 206 and the correct Content-Range. The browser decoded it at 2048 by 2048 pixels and displayed the successful Task and focused plan.
- SSE replay with `Last-Event-ID: 15` returned event 16 even with `after=999999`, confirming header forwarding and query preservation. Nginx disables response/request buffering, proxy cache and automatic upstream retries; Docker DNS resolves the Java service inside the shared network. Java replacement/DNS failure recovery was not simulated.
- Fresh frontend tests passed 64/64, strict type checking passed, and the actual multi-stage production image build passed. Runtime environment and built static files contained none of the supplied provider keys.

Ignored evidence: `artifacts/docker-compose-evidence.json`, `artifacts/docker-compose-chat.png` and `artifacts/docker-compose-smoke.png`. The test Session and upload remain in the existing local stack. This is a local container deployment; public hosting, TLS, authentication and remote deployment were not configured.


## UI/UX refinement — 2026-10-19

- Applied a responsive, light workspace with chat navigation, a persistent composer, an optional Studio inspector, accessible control labels, keyboard focus restoration, and reduced-motion support. No dependencies or backend contracts changed.
- Verified against Node.js 22.22.1: `npm test` passed all 71 tests; `npm run typecheck` and `npm run build` passed. The seven added tests protect interrupted reply labels, exact streamed-text rendering and HTML escaping, discoverable activity payloads, transport/execution status separation, media downloads, and plan validation/focus.
- Browser verification used the existing in-memory API fixture, isolated from real Java/Python services and providers. Checked a 1280 × 720 desktop view and a 390 × 640 iframe viewport for the mobile CSS layout. This is responsive browser evidence, not a physical-device test.
- Verified chat creation and rename, prompt starters that fill without sending, Shift+Enter/newline and Enter/send, draft restoration after switching chats, partial-to-final streaming, the pinned composer with long history, older-history anchoring, Back to latest, Studio creations/plans, mobile navigation/search, and Studio Escape/focus restoration. The observed existing-message position moved by less than 0.1 CSS pixel after prepending older history.
- Review fixed a late-response draft-clearing race and preserved interrupted-message status. IME protection and upload readiness are enforced in the send handler; native input-method interaction and browser upload-failure retries were not exercised during this UI pass. Existing fixture/API/upload tests remain green.
- No provider calls, paid generation, deployment, Git commits or instruction-file edits were performed. The existing Docker frontend must be rebuilt separately to serve these source changes.
