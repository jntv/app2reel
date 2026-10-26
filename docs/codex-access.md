# ChatGPT subscription access

App2Reel uses the installed open-source **Codex CLI**, authenticated with ChatGPT, for research, visual analysis, planning, and structured text. No OpenAI API key is required or used by this app. Each person runs a local copy and signs into their own account. The included Orbit sample uses no AI requests; see [the sample path](installation.md#try-the-sample-first).

## Install and sign in

Install a current CLI, run `codex login`, and choose ChatGPT:

```bash
npm install -g @openai/codex
codex login
codex login status
```

Codex supports ChatGPT sign-in for subscription access and reuses saved authentication for `codex exec`. The sign-in flow opens the official account page in your browser. Subscription/workspace restrictions, model availability, rate limits, and account data policies still apply. See the official [authentication](https://learn.chatgpt.com/docs/auth) and [non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode) documentation.

App2Reel can also start this browser sign-in from **Connect ChatGPT**. It discovers `codex` on `PATH`, then conventional macOS ChatGPT/Codex app locations. Override the executable with `CODEX_BIN` if necessary. macOS and Linux are the primary supported environments; on Windows, point `CODEX_BIN` at the native Codex executable rather than a `.cmd` wrapper.

The app calls `codex login status` to distinguish a ChatGPT session from an API-key session. An API-key session is rejected; no API key is requested or forwarded. An optional `CODEX_MODEL` selects a model available to the account; otherwise the CLI's default applies. A successful status check confirms login, **not** remaining quota or model entitlement. Only a completed request verifies access. Browser exploration can make many requests. App2Reel does not provide unlimited inference or grant access to every OpenAI media model.

## Authentication ownership

The CLI owns authentication and refresh. App2Reel does not read, copy, display, or transmit Codex credential files. Sign-in is shared with the user's CLI/IDE configuration. App2Reel deliberately has no logout endpoint, because logging out would also affect those clients. To change the account or switch an API-key session to ChatGPT, use the official CLI login/logout commands yourself. See [Codex authentication](https://learn.chatgpt.com/docs/auth).

## Inference isolation

Each inference runs in a fresh private temporary directory with `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, a read-only sandbox, and approvals disabled. Shell execution, app connectors, plugins, hooks, browser/computer tools, image generation, memory, and child agents are disabled. Optional OpenAI web search is enabled only for research.

Screenshot inputs and JSON schemas are copied into this directory; requests and outputs are removed afterward. The child process inherits a small environment allowlist without API keys, bearer tokens, custom model endpoints, or parent agent bridge variables. Calls have a three-minute timeout and support cancellation. A CLI too old to support isolation flags must be upgraded instead of running with weaker defaults. Administrator policies can still restrict or alter the CLI environment. These are App2Reel's bridge behavior; see `server/ai.ts` and its tests in the repository.

Captured screens and the product brief are sent to OpenAI for inference. Product login passwords are handled by the local browser controller and must stay out of AI prompts. Treat captured product data as confidential. Ephemeral CLI sessions do not make inference offline or change the account's data policies. See [product access and privacy](privacy.md).

## Why local browser and video tools

The model chooses structured actions; App2Reel's local Playwright browser executes them. Capturing screens and rendering video happen on the user's machine. This is not native OpenAI computer use. ChatGPT/Codex subscription access does not automatically grant video-generation, voice-generation, or arbitrary third-party media API access. The renderer creates composited screen demos and promotional motion graphics locally; it is not a generative CGI/VFX service.

## Direct Sign in with ChatGPT

OpenAI also documents an optional **Sign in with ChatGPT** flow through which open-source and locally hosted apps can request consent to use a user's ChatGPT plan for eligible Responses API requests. It includes app-owned OAuth registration, PKCE, host IDs, and credential storage. App2Reel currently uses the local Codex login; it does not implement a separate embedded OAuth client. A future adapter could retain the `LocalAI` interface. See the official [ChatGPT plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source).

The documented preview requires `store: false` and streaming for direct HTTP Responses requests. It excludes native computer use, hosted image generation, audio/video inputs, transcription, and several hosted tools. It can support local function/tool loops. A paid or remotely hosted offering has a separate access path; this repository is intended to run locally for its owner. Check [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) before implementing an adapter.

## Official references

Authentication, non-interactive execution, and direct plan-usage references were checked on **27 October 2026**. Availability and eligibility can change; follow the current official documentation.

- [Codex CLI installation](https://learn.chatgpt.com/docs/cli)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex CLI command reference](https://learn.chatgpt.com/docs/cli/reference)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [ChatGPT plan usage for open-source/local apps](https://developers.openai.com/siwc/token-sharing-open-source)
- [SIWC preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Manage ChatGPT usage](https://chatgpt.com/settings/usage)
