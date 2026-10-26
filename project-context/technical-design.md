# Technical design

Last reviewed: 2026-10-27. Sources: `server/`, `shared/types.ts`, `src/`, `package.json`, README and user requirements. Architecture below describes implemented v0.1 behavior; extensions are proposed only.

## Components

REQ-001/003: React/Vite interface served by a loopback Express process. Zod validates requests. A per-project JSON file is atomically replaced through a serialized write queue; memory emits SSE state. There is no database migration, cloud hosting, or tenant model. Artifacts live under ignored `.capture/<uuid>/`.

REQ-002/005: `LocalAI` calls the installed Codex CLI with schema-constrained ephemeral read-only runs. It checks ChatGPT login, required safety flags, timeout and structured turn completion. It strips inherited API keys, shell tools, app integrations, MCP and skill discovery. Only the CLI handles credentials. Screenshot input and optional live web search are explicit.

REQ-004: Playwright uses separate unrecorded login contexts and isolated recorded exploration. Saved manual auth stays in memory for reuse across explorations and retries until its original expiry or explicit discard. Action IDs reference visible DOM controls. Allowed origins, dangerous-label checks, default method blocking, popup/download rejection and login detection bound actions. These are defense in depth, not a guarantee against hostile applications. Browser observations are untrusted model input.

REQ-009: `server/signin.ts` handles automatic account sign-in before recording. A run-specific authorization enables bounded reCAPTCHA checkbox/challenge attempts. Only a cropped challenge image, with inputs masked, goes to the Codex planner; no credentials or general page text do. Coordinate clicks must remain inside the current visible challenge bounds. Temporary screenshots and the unrecorded context are cleaned up on all exit paths. Fixed safe errors distinguish blocked, timed out, and failed authentication. No token injection, solver service or challenge bypass is used.

Manual fallback is managed by `server/login-sessions.ts`. It watches the unrecorded browser for verified sign-in and automatically captures cookies, localStorage, IndexedDB and origin-scoped sessionStorage, without waiting for a manual confirmation button. Automatic sign-in returns the same storage bundle; sessionStorage is restored before product scripts execute. Pending windows can remain open for four hours. Saved manual auth can be restored for multiple explorations and retries until eight hours after the original save; neither restoration nor duplicate confirmation extends that deadline. Supplying explicit exploration credentials, editing the brief, opening a new manual login, or shutting down discards the saved session. The UI polls a credential-free status endpoint, including after reload. This replaces the original 15-minute handoff that could discard a successful sign-in before the user confirmed it. Thirteen local-browser manager regressions cover autosave, duplicate confirmation, repeated storage restoration with fixed expiry, div-based sidebars, incomplete iframe MFA, public landing rejection, concurrent windows, origin boundaries and cleanup.

REQ-006/007: FFmpeg trims and retimes real recording clips into demo scenes. Promotional scenes are rendered frame by frame in network-blocked Chromium from fixed templates and screenshot textures, then encoded to H.264 MP4. CSS perspective and animated geometry provide the first-release 3D aesthetic. An original synthesized sound bed is local. Temporary output publication is staged; aborts stop encoder/browser and clean temporary media. Safe local asset containment is enforced.

REQ-008: Pipeline plans scenes from shots and observed findings, exports JSON/SRT/TXT and waits for review. It reserves a single global job before asynchronous persistence. Cancellable state reports through SSE and is recovered as interrupted after restart.

## Security, deployment, operations

Loopback host/origin validation and JSON-only mutations mitigate cross-site access; frame embedding is denied. No local multi-user auth exists, so do not expose the server on a public interface. Keep product test accounts disposable; recordings/screenshots can include PII. Credentials must never enter AI prompts/logs. Project URL query strings and link queries are excluded from model observations. Raw browser footage is published only after a successful exploration with no detected login form.

Run through Node22+, installed dependencies, current Codex CLI and Playwright Chromium. Configured environment values have no checked-in secrets. Logs are bounded project events, without raw CLI output. Stop the server to roll back code; remove ignored project directories for local data cleanup. Upgrade or re-explore rather than migrating old in-flight jobs. Existing source has no remote identity.

## Verification and limitations

TypeScript, frontend production build, authentication and security regressions, real Codex inference, renderer smoke tests and sample exploration/rendering provide current verification. Browser-login variants and arbitrary real platforms are not comprehensively tested. See README for setup and limitations. Direct open-source SIWC integration, richer role simulation, TTS and generative media are proposed future adapters only.
