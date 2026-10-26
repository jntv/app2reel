# ChatGPT subscription access

Capture Studio uses the installed open-source **Codex CLI**, authenticated with ChatGPT, for research, visual analysis, planning, and structured text. Install a current CLI with `npm install -g @openai/codex`, run `codex login`, and choose ChatGPT. Capture can also start this browser sign-in from its connection card. It discovers `codex` on `PATH`, then conventional macOS ChatGPT/Codex app locations. Override the executable with `CODEX_BIN` if necessary. macOS and Linux are the primary supported environments; on Windows, point `CODEX_BIN` at the native Codex executable rather than a `.cmd` wrapper.

The app calls `codex login status` to distinguish a ChatGPT session from an API-key session. An API-key session is rejected; no API key is requested or forwarded. An optional `CODEX_MODEL` selects a model available to the account; otherwise the CLI's default applies. A successful status check confirms login, **not** remaining quota or model entitlement. Only a completed request verifies access. Subscription/workspace restrictions and rate limits still apply, and browser exploration can make many requests.

The CLI owns authentication and refresh. Capture does not read, copy, display, or transmit Codex credential files. Sign-in is shared with the user's CLI/IDE configuration. Capture deliberately has no logout endpoint, because logging out would also affect those clients. To change the account, use the official CLI login/logout commands yourself.

Each inference runs in a fresh private temporary directory with `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, a read-only sandbox, and approvals disabled. Shell execution, app connectors, plugins, hooks, browser/computer tools, image generation, memory, and child agents are disabled. Optional OpenAI web search is enabled only for research. Screenshot inputs and JSON schemas are copied into this directory; requests and outputs are removed afterward. The child process inherits a small environment allowlist without API keys, bearer tokens, custom model endpoints, or parent agent bridge variables. Calls have a three-minute timeout and support cancellation. A CLI too old to support isolation flags must be upgraded instead of running with weaker defaults. Administrator policies can still restrict or alter the CLI environment.

Captured screens and the product brief are sent to OpenAI for inference. Product login passwords should be handled by the local browser controller, **not inserted in AI prompts**. Treat captured product data as confidential. Ephemeral CLI sessions do not make inference offline or change the account's data policies.

## Why local browser and video tools

The model chooses structured actions; Capture's local Playwright browser executes them. Capturing screens and rendering video happen on the user's machine. This is not native OpenAI computer use. ChatGPT/Codex subscription access does not automatically grant video-generation, voice-generation, or arbitrary third-party media API access. The initial renderer creates composited screen demos and promotional motion graphics locally; it is not a generative CGI/VFX service.

## Direct Sign in with ChatGPT

OpenAI also documents an optional **Sign in with ChatGPT** flow for eligible open-source and local apps, with app-owned OAuth registration, PKCE, host IDs, credential storage, and ChatGPT plan consent. Eligible Plus/Pro users can authorize supported Responses API requests without API keys. That is a separate integration from the CLI bridge implemented here; Capture does not claim to register its own OAuth client. A future direct adapter can use the official SIWC devkit and retain this `LocalAI` interface.

The SIWC preview requires streaming Responses with `store: false`, and currently excludes native computer use, hosted image generation, audio/video inputs, transcription, and several hosted tools. It can support local tool loops like Capture's browser controller. A paid or remotely hosted offering needs separate eligibility/access review; this repository is intended to run locally for its owner.

Official references checked on 26 October 2026:

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex CLI commands and structured output](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)
- [Sign in with ChatGPT for open-source/local apps](https://developers.openai.com/siwc/token-sharing-open-source)
- [Official Sign in with ChatGPT cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [SIWC preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Manage ChatGPT usage](https://chatgpt.com/settings/usage)
