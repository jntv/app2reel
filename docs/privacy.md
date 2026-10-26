# Product access and privacy

App2Reel is a local, single-user app. Browser recording, speech generation after voice setup, raw video encoding, and motion rendering happen on your laptop. **AI-assisted runs send the product brief, account screenshots, and visible page text to OpenAI through Codex.** Public web research also sends product context to search. The included Orbit sample uses no AI calls or external web research.

## Local project data

Projects, screenshots, raw footage, storyboards, and exports are stored in ignored `.capture/` directories by default. `DATA_DIR` can change the storage location. Recordings can contain private account data; review what you intend to export. Stop the server and delete a project's directory to remove its local data.

Privacy masks are opaque rectangles applied to source video pixels before camera zoom/pan. They affect the exported demo and remain attached as the camera moves. **Original recordings and screenshots are unchanged**, so they can still contain the covered details. The promo draws product-inspired interface models rather than private screenshot pixels or video, but its observed labels and generated text still need review before sharing.

Keep `.capture/`, model/runtime downloads, credentials, and `node_modules/` out of the public source repository. Retain the committed ignore rules when contributing.

## Product sign-in

Product passwords are used only in an unrecorded login attempt. They are never given to the model or saved in project metadata or logs. Manual sign-in windows stay available for up to four hours. Verified cookies, localStorage, IndexedDB and sessionStorage are saved automatically in memory and remain reusable across explorations and retries until eight hours after they were first saved. Restoring a session does not extend its expiry.

Supplying credentials for exploration, changing the brief, opening a new manual sign-in browser, or stopping the server discards the saved session. Per-origin sessionStorage is restored before product scripts run. Manual sign-in supports external identity providers before recording begins. Add the required product/login origins to the brief first.

Automatic CAPTCHA attempts require a checkbox opt-in for that run. Only a cropped visible CAPTCHA image is sent to Codex, with editable credential fields masked. Clicks are constrained to that visible challenge. Temporary challenge screenshots are deleted. The app does not inject CAPTCHA tokens, use a solver service, or bypass the site's challenge. Success is not guaranteed; use the unrecorded browser for challenges requiring your input.

## Codex authentication and inference

Codex manages its own sign-in. App2Reel never asks for your ChatGPT password and does not read, copy, display or transmit Codex credential files. It invokes isolated ephemeral runs, disables inherited app/tool/skill configuration and shell tools, uses a read-only sandbox, and passes prompts through stdin. Supported isolation flags are checked; an incompatible CLI is rejected with an upgrade message.

Screenshots and page text are still inference inputs sent to OpenAI. Ephemeral CLI sessions do not make inference offline or change the account's data policies. Treat captured product data as confidential. See [Codex access and isolation](codex-access.md) for the full process and official references.

## Exploration boundaries

Exploration is read-only by default. It blocks non-GET/HEAD/OPTIONS requests and excludes dangerous action labels. Some products load even read-only data over POST, so they may require enabling changes with a disposable test account. A navigation/filter policy is not a complete security boundary against a hostile product; use a sandbox or test environment.

User-specified product origins bound automated navigation. Popups and downloads are disabled during automated exploration. Read-only mode may miss workflows requiring state changes or external authentication. Exploration has a configurable step budget and does not guarantee exhaustive feature coverage or every role listed in the brief.

## Local server

The studio binds only to `127.0.0.1` and has no multi-user server authentication. It rejects cross-site mutation requests, unexpected Host/Origin headers, and iframe embedding. It serves only current project artifacts and keeps credentials out of responses. Keep it local to the person using the laptop.

For installation and environment settings, see [installation](installation.md#configuration). For masks and exports, see [usage](usage.md#privacy-masks).
