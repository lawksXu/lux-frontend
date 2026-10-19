# Lux Frontend Guide

- This repository is the minimal browser client for `lux-java-backend`.
- Use React, TypeScript, Vite, npm and native browser APIs. UI/UX refinement is deferred.
- Call only public owner-scoped Java `/api/v1` endpoints. Python services, Kafka, object storage and provider credentials stay behind Java.
- Model consumed business structures with named TypeScript types and discriminated unions. Validate untrusted input at decoding boundaries. Opaque provider/tool details may be retained only in a typed enclosing record without interpreting their fields.
- Keep Item registration order, Java SSE replay cursors and Python execution indexes distinct. Preserve text fragment whitespace and original mutation identities on retries.
- Write documentation and visible application text in English. Prefer focused files and minimal dependencies.
- Run `npm test`, `npm run typecheck` and `npm run build` before claiming completion. Browser fixture tests do not establish live provider acceptance.
- Keep `.env`, `node_modules`, build output and browser artifacts ignored. Keep this root guide available to Git and ignore nested instruction files.
- Do not modify instruction files, create commits/branches, publish a remote repository, deploy or start paid provider calls without explicit user approval.
