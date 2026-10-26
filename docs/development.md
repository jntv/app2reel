# Develop App2Reel

Use **Node.js 22.13 or newer** and the pinned **pnpm 11.25.0**. Install the committed dependency versions with `pnpm install --frozen-lockfile`, then run `pnpm run setup` for Chromium. See [installation](installation.md) for the local studio, Codex sign-in, Linux browser libraries, and optional voices.

## Commands

```bash
pnpm run doctor
pnpm run check
pnpm test
pnpm run build
```

The npm equivalents are `npm run doctor`, `npm run check`, `npm test`, and `npm run build`. `doctor` checks local prerequisites. `check` runs TypeScript without emission. `build` checks types and creates the Vite interface build. Start development with `pnpm dev`; use `pnpm start` after a build for the built interface.

The pnpm lockfile is canonical. npm is supported for local installation but does not use that lockfile; avoid introducing a second lockfile. The `pnpm-workspace.yaml` configuration permits the `ffmpeg-static` and `esbuild` dependency build scripts.

## Code layout

| Path | Responsibility |
| --- | --- |
| `src/` | React studio UI. |
| `shared/` | Shared project and media types. |
| `server/index.ts` | Local HTTP routes and application startup. |
| `server/ai.ts` | Local Codex CLI bridge. |
| `server/browser.ts` | Browser exploration, recording, and pointer telemetry. |
| `server/pipeline.ts` | Research, exploration, storyboarding, and render orchestration. |
| `server/storyboard.ts` | Source chronology, speech budgets, and clip timing validation. |
| `server/edit-plan.ts` | Bounded AI editing language and compiler. |
| `server/render.ts` | Export coordination. |
| `server/demo-renderer.ts`, `server/demo-template.ts` | Live demo composition. |
| `server/promo-template.ts` | Graphics promo rendering. |
| `server/product-theme.ts` | Product design extraction. |
| `server/narration.ts` | Speech generation and fitting. |
| `server/brand-music.ts`, `server/audio-mix.ts` | Original local stereo score, speech-driven music ducking, and soundtrack muxing. |
| `server/local-voice.ts` | Isolated Python speech runtime bridge. |
| `server/voice-alignment.ts` | Spoken-word alignment. |
| `server/subtitles.ts` | Shared subtitle cue timeline. |
| `scripts/setup-voice.mjs` | Voice runtime installation and readiness checks. |
| `scripts/local-voice.py` | Local narration synthesis. |
| `assets/voices/` | Bundled generic synthetic voice references and provenance recipe. |
| `tests/` | Node test suite. |
| `project-context/` | Durable requirements and API contracts. |

## Editing-plan contract

`server/edit-plan.ts` gives Codex a bounded JSON editing language. It can select reviewed source moments, write a separate script for each film, allocate scene lengths, choose context/detail framing, set camera timing, and select cut, dissolve, fade or slide transitions. A compiler validates source bindings and chronology, applies a natural speech budget, preserves source cuts and privacy masks, and quantizes the clock to 30 fps. It rejects invalid plans and makes at most one correction request. The model cannot add an arbitrary asset path or remove masks through this language.

`Project.filmPlans.demo` and `.promo` have independent scenes, durations, narration, captions and caches. A visual or script edit to one plan preserves the other completed film. New renders publish film-specific files such as `demo-narration.wav`, `promo-narration.wav` and `promo-captions.vtt`. Older projects with only `scenes` keep the shared-timeline behavior until replanned. Legacy shared-timeline projects require both films to be rendered together if their shared narration track is missing or no longer matches.

The maximum is 20 scenes and 180 seconds per rendered film; the motion-film planner accepts targets up to 90 seconds. The renderer rejects excess duration rather than silently truncating it. An edit plan can reframe captured material but cannot create missing interactions. Short recordings hold their last real frame, and a longer duration does not establish extra feature coverage.

## Soundtrack updates

Music is an original deterministic 48 kHz stereo PCM score generated offline. The walkthrough and promo use distinct arrangements with extended chords, warm keys/pads, soft bass and sparse plucks. Music gain is independent of narration; a sidechain compressor keyed by the original mono speech lowers only the music. The final limiter disables automatic makeup gain and compensates lookahead latency to retain the subtitle clock.

`POST /api/projects/:id/music` accepts `{enabled:boolean, volume:number}` with volume bounded to 0–0.5. It takes the global cancellable job lock and validates each completed film's duration and original narration cache. It builds replacement audio from that cache and a fresh score, ignoring the MP4's previous mixed audio, while copying video packets unchanged. All replacements are staged before publication; fresh output revisions refresh browser playback. Voice, caption, timing and poster files remain unchanged. Missing or mismatched speech requires a full render rather than a silent fallback or a new voice take.

## Verification

Tests cover Codex isolation and subscription authentication, browser boundaries, real pointer capture, camera projection and zoom bounds, cursor detection without fabricated clicks, screenshot-free promo rendering, deterministic motion, spoken audio, audible subtitle timing, product CSS/font extraction, screenshot palette recovery, cancellation, and safe media publication.

For changes affecting media output, verification should also include actual recordings, MP4 encodes, full video decoding, and visual checks at the affected 720p/1080p resolutions. The included Orbit sample exercises the real recording and rendering pipeline without AI calls or external research. Turn **Spoken narration** off and save the style to check the media pipeline without Python, or set up the intended voice to verify speech output too.

The app performs one exploration, editing-plan or render job at a time, supports cancellation, and reports interrupted jobs after a restart. Include cancellation/restart checks when changing job orchestration. See [privacy](privacy.md) for browser, session, and local-server boundaries that changes must preserve.

## Configuration and local artifacts

See [environment settings](installation.md#configuration). `.env` is not automatically loaded. `.capture/` and `CAPTURE_*` settings retain their existing names for compatibility after the App2Reel rename.

Keep `.capture/`, credentials, `node_modules/`, and downloaded model/runtime packs ignored. Source, documentation, license, and the canonical lockfile belong in the repository. App2Reel source uses the [MIT license](../LICENSE); dependencies retain their own terms. See [voice dependency licenses](voices.md#dependency-licenses) before redistributing speech runtimes or models.
