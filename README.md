# Capture Studio

Turn a product brief into a recorded product demo and an animated promotional film, on your own laptop.

Capture is a local, single-user, MIT-licensed app. It uses your **ChatGPT subscription through the installed Codex CLI** for research, screenshot-based browser decisions, and storyboarding. Playwright explores and records the product; Chromium and FFmpeg render the films locally. No OpenAI API key is required or used by this app.

## Run locally

Install **Node.js 22 or newer** and a current [Codex CLI](https://developers.openai.com/codex/cli/). You need a ChatGPT account with Codex access and remaining usage. Each person runs their own copy and signs into their own account.

```bash
git clone <your-repository-url>
cd Capture
npm install
npm install -g @openai/codex
codex login
npm run setup
npm run dev
```

Open **[http://127.0.0.1:4310](http://127.0.0.1:4310)**. If Codex is installed but not signed in, use **Connect ChatGPT** in the studio. Codex opens the official account sign-in in your system browser. Capture never asks for your ChatGPT password or reads its token files. Existing API-key Codex sessions must be switched to ChatGPT explicitly in your terminal.

On macOS after setup, double-click **Start Capture Studio.command** to launch the app. On this development laptop it also finds the Node runtime bundled with Codex when Node is absent from the shell PATH. Keep the terminal window open while using the app.

The repository includes a pnpm lockfile. With pnpm installed, `pnpm install --frozen-lockfile`, `pnpm run setup`, and `pnpm dev` are equivalent. Approve the `ffmpeg-static` and `esbuild` dependency build scripts if your package manager requires it. On a restricted network, supply an existing FFmpeg executable with `FFMPEG_PATH`.

For the built interface:

```bash
npm run build
npm start
```

The app binds only to `127.0.0.1`. Keep it local; it is designed for the person using this laptop and has no multi-user server authentication.

### Natural narration setup

**Natural (local)** is the default voice quality. It uses local neural speech on your computer. **Indian English** (female, MeloTTS ONNX) is the default; **Heart** (female US English) and **Michael** (male US English) use Kokoro ONNX. Narration needs no paid voice API or additional account; Codex continues to handle research and storyboarding.

Install **Python 3.12 or 3.13** first. The pinned runtime requires **macOS 14 or newer on macOS** and has been verified on Apple Silicon CPU. Setup downloads about **165 MB for Indian English** as a compressed archive, plus Python packages, once. The extracted Indian-English model files use about 175 MB; setup retains the verified archive for reuse. Heart/Michael share an optional **350 MB** model pack. Setup installs only the selected voice's model pack. Files stay in ignored `.capture/voice-runtime/`.

```bash
pnpm setup:voice
# Equivalent with npm:
npm run setup:voice
```

Setup creates an isolated Python environment, installs pinned packages, and verifies the official model downloads with SHA-256. It reuses verified files on later runs. If Python is outside your PATH, provide its executable explicitly:

```bash
CAPTURE_PYTHON=/absolute/path/to/python3.12 pnpm setup:voice
```

You can also open **Your films → Voice quality → Natural (local)** and click **Set up natural voices**. The studio shows download progress and readiness; **Preview voice** plays a sample of the current script. Choose Indian English, Heart, or Michael, preview it, then **Save film style** before rendering. After setup, speech is generated offline on your laptop. A missing natural runtime blocks narrated rendering until setup succeeds or you explicitly choose **System (fallback)**. System uses Samantha on macOS, or an installed `espeak-ng`/`espeak` on Linux. Turn off **Spoken narration** for music-only films.

The terminal defaults to Indian English. Check readiness for the specific voice you intend to use:

```bash
node scripts/setup-voice.mjs --status --voice melo_india
# Install and check the optional US voice pack:
pnpm setup:voice --voice af_heart
node scripts/setup-voice.mjs --status --voice af_heart
# With npm, forward voice options after --:
npm run setup:voice -- --voice af_heart
```

The accepted voice IDs are `melo_india`, `af_heart`, and `am_michael`; Michael uses the same model pack as Heart. The setup CLI also accepts `--dir /absolute/runtime/path`; set `CAPTURE_VOICE_DIR` to that same path when starting the studio. Use this shared override when your command-line setup and a custom `DATA_DIR` would otherwise select different runtime directories.

Indian English reads English narration. Unknown product names receive an approximate pronunciation from a bundled local dictionary and pronunciation engine. Spell a name phonetically in the narration if needed. Unsupported scripts or sounds produce an error rather than silently omitting words. Indian-English word highlights use estimated timings within the measured audible speech span.

## Make your films

1. Enter the product name, URL, description, purpose, actors/roles, and features. Choose a brand color, film length, and 720p or 1080p output.
2. If the product needs an account, open **Behind a login?** and enter its username/password for automatic sign-in. For a reCAPTCHA, optionally authorize **Let Capture attempt a visible CAPTCHA** for that run. Capture can try the checkbox and a bounded sequence of visible challenge clicks through Codex; success is not guaranteed. Passwords stay out of model requests. For SSO, MFA, or a challenge the app cannot complete, use the separate unrecorded sign-in browser. Capture detects a successful sign-in and saves it automatically; **I've finished signing in** is an optional check. Add any required product/login origins to the brief first.
3. Start exploration. Capture researches public documentation and tutorials, visits the allowed product origins, records real interactions, and tracks which requested features were observed. Exploration has a configurable step budget; it does not guarantee exhaustive coverage of every product or role.
4. Review screenshots, research sources, feature evidence, and the storyboard. Edit scene titles, chapter captions, narration, duration, camera focus/zoom, focus delay, and feature outline regions. Add privacy masks over names, contact details or other source regions you want hidden in the demo.
5. In **Your films**, refresh the product design if needed and save your theme, movement, motion-film format (landscape or portrait), narration, subtitle, and pointer preferences, then render both films. Preview and download the MP4s, storyboard JSON, research JSON, SRT/WebVTT subtitles, the narration script, and a spoken WAV track.

Use **Try a sample project** first. The included fictional Orbit app has four real interactive views. Sample mode uses deterministic browser actions and a fixed storyboard, with no AI calls or external web research; it exercises real recording and rendering.

### Two outputs

| Output | What it contains |
| --- | --- |
| `demo.mp4` | Actual browser footage in a large rounded product window, selective held close-ups, visible pointer, feature outlines, dark word-highlighted caption panels, voiceover, and quiet music. |
| `promo.mp4` | Product-inspired interface models with changing states, kinetic headline beats, directional transitions, narrated word highlights, and a branded ending. Landscape or native portrait composition. |

Both use H.264 at 30 fps with AAC audio. By default they include real local speech over a quiet synthesized music bed. The promo rebuilds safe interface models from the observed product’s labels, layouts, palette, typography and component radius; it does not show private screenshot pixels or video. Colors and models come from the actual product URL, with saved screenshot palettes available for older projects. Bounded public fonts are copied into the project and embedded for offline rendering when available. The demo composites real video with frame-driven motion artwork; it does not substitute still screenshots for footage. New explorations capture pointer coordinates and actual clicks. Local image analysis follows the orange recording marker on the exact retimed output frames, including held tails, so the replacement pointer stays attached during fast travel. Trusted telemetry supplies real click events; when no marker can be found, new recordings can fall back to approximate telemetry positions. Legacy recordings never acquire invented clicks. Camera focus and outlined regions remain editable. Storyboard → Source edit can retain up to six ordered source intervals per scene, cutting loading or waiting between a real action and its result. The render builds a temporary lossless edit and remaps pointer evidence to that same clock; raw footage stays intact. The camera holds context for broad views, then uses a selective push and sustained detail hold for smaller controls. Focus delay prevents a highlight appearing before its incoming view settles; it does not chase the pointer. Small active regions allow closer framing while larger regions limit zoom to preserve readable controls. Capture records interaction/settled timestamps and distinguishes incoming actions from outgoing explorer intent. The planner orders unique source moments chronologically, gives them variable narration-paced durations, and selects real incoming actions plus a short result hold, excluding AI thinking pauses. Long clips play at most 1.12×; short ones hold their final frame.

Privacy masks are opaque rectangles applied to original video pixels before camera zoom/pan, so covered details remain hidden as the camera moves. The storyboard previews their position and validates their bounds. Masks affect the exported demo; original recordings and screenshots remain local and unchanged. Focus/mask-only changes preserve a completed graphics promo, since it uses no screen assets.

The demo keeps editorial chrome out of the product window and uses compact caption panels. The promo uses distinct opening, feature, and closing layouts with kinetic headlines. Spoken narration defaults to local Indian-English neural speech after the one-time setup above. Speech is normalized, gently fitted to each scene, and mixed above the quiet music bed. Overlong scripts are rejected instead of being rushed. Heart/Michael align word highlights to their model’s phoneme timings when alignment succeeds. Indian English, system speech and rejected alignments use estimated weighted timings within the measured audible speech span; the timing JSON records this distinction. The same phrases are exported as SRT/WebVTT. The WAV voiceover, timing JSON and TXT script remain editable. Review the storyboard and final cuts for your product’s creative direction.

Rendering both films frame by frame can take several minutes. Captured browser footage is recorded by Playwright and recompressed; a 1080p export cannot restore detail absent from the source recording. Use Cinematic for stronger movement or Subtle for gentler camera and graphic motion. Save style changes before rendering; changing style or focus preserves the captured footage.

## Product access and privacy

- The brief, account screenshots, and visible page text are sent to OpenAI through Codex for AI-assisted runs. Public web research also sends product context to search. Raw video encoding and motion rendering happen locally.
- Projects, screenshots, raw footage, storyboards, and exports are stored in ignored `.capture/` directories. Recordings can contain private account data: review what you intend to export. Delete a project's directory while the server is stopped to remove its local data.
- Product passwords are used only in an unrecorded login attempt. They are never given to the model or saved in project metadata or logs. Manual sign-in windows stay available for up to four hours. Verified cookies, localStorage, IndexedDB and sessionStorage are saved automatically in memory and remain reusable across explorations and retries until eight hours after they were first saved. Restoring a session does not extend its expiry. Supplying credentials for exploration, changing the brief, opening a new manual sign-in browser, or stopping the server discards the saved session. Per-origin sessionStorage is restored before product scripts run.
- Automatic CAPTCHA attempts require a run-specific checkbox opt-in. Only a cropped visible CAPTCHA image is sent to Codex, with editable credential fields masked. Clicks are constrained to that visible challenge. Temporary challenge screenshots are deleted. The app does not inject CAPTCHA tokens, use a solver service, or bypass the site's challenge.
- Codex manages its own sign-in. Capture invokes isolated ephemeral runs, disables inherited app/tool/skill configuration and shell tools, uses a read-only sandbox, and passes prompts through stdin. Supported isolation flags are checked; an incompatible CLI is rejected with an upgrade message.
- Exploration is read-only by default. It blocks non-GET/HEAD/OPTIONS requests and excludes dangerous action labels. Some products load even read-only data over POST, so they may require enabling changes with a disposable test account. A navigation/filter policy is not a complete security boundary against a hostile product; use a sandbox or test environment.
- User-specified product origins bound navigation. Popups and downloads are disabled during automated exploration. Read-only mode may miss workflows requiring state changes or external authentication. Manual sign-in supports external identity providers before recording begins.
- The studio rejects cross-site mutation requests, unexpected Host/Origin headers, and iframe embedding. It serves only current project artifacts and keeps credentials out of responses.

## Configuration

Set environment variables in the shell before starting. `.env.example` documents them; `.env` is **not automatically loaded**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4310` | Local HTTP port. |
| `DATA_DIR` | `<repository>/.capture` | Project and media storage. |
| `CODEX_BIN` | Auto-detect `codex` or macOS app binary | Absolute path to a supported Codex CLI. |
| `CODEX_MODEL` | Codex CLI default | Optional model available to the signed-in account. |
| `FFMPEG_PATH` | `ffmpeg-static` package binary | Local FFmpeg override. |
| `CAPTURE_PYTHON` | Existing voice environment, then `python3.12`, `python3.13`, or compatible `python3` | Python executable override for one-time natural voice setup. Requires Python 3.12 or 3.13. |
| `CAPTURE_VOICE_DIR` | Server: `<DATA_DIR>/voice-runtime`; setup CLI: `.capture/voice-runtime` | Shared local voice runtime override. Use the same path for setup and the studio. |

Example:

```bash
PORT=4311 CODEX_BIN=/absolute/path/to/codex npm run dev
```

The studio performs one exploration or render job at a time, supports cancellation, and reports interrupted jobs after a restart. Re-explore after changing the brief. Different roles need separate projects/sessions in this release; it does not automatically impersonate every actor listed in a brief.

## Development and verification

```bash
npm run check
npm test
npm run build
```

Tests cover Codex isolation and subscription authentication, browser boundaries, real pointer capture, camera projection and zoom bounds, cursor detection without fabricated clicks, screenshot-free promo rendering, deterministic motion, spoken audio, audible subtitle timing, product CSS/font extraction, screenshot palette recovery, cancellation, and safe media publication. Development verification also includes actual recordings, MP4 encodes, full video decoding and visual checks at 720p/1080p. A sample is included so you can verify the complete workflow before using a real product.

Code layout: `src/` is the React studio; `server/ai.ts` is the local Codex bridge; `server/browser.ts` records exploration and pointer telemetry; `server/pipeline.ts` orchestrates research and storyboarding; `server/storyboard.ts` validates source chronology, speech budgets and clip timing. `server/render.ts` coordinates exports, `demo-renderer.ts`/`demo-template.ts` compose the live demo, `promo-template.ts` draws the graphics promo, `product-theme.ts` captures the product’s design, `narration.ts` generates and fits speech, `local-voice.ts` calls the isolated Python runtime, `voice-alignment.ts` aligns spoken words, and `subtitles.ts` supplies the shared cue timeline. `scripts/setup-voice.mjs` installs the runtime and `scripts/local-voice.py` synthesizes local narration. Durable requirements and API contracts are in `project-context/`.

## Subscription access

[Codex authentication](https://developers.openai.com/codex/auth) and [non-interactive execution](https://developers.openai.com/codex/noninteractive) document the path used here. Plan eligibility, rate limits, model availability, and organizational policies still apply. Capture does not provide unlimited inference or grant access to every OpenAI media model.

OpenAI also documents a newer [open-source Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source). That can support a future direct OAuth adapter; this release uses the supported local Codex login and does not implement a separate embedded OAuth client. See [Codex access details](docs/codex-access.md).

## Sharing the repository

Source is ready to put in a Git repository under the MIT license. No remote has been created or published. Commit the source, README, license, and lockfile; leave `.capture/`, credentials, and `node_modules/` ignored. Replace the clone URL above with your repository URL after publication.

Capture’s MIT license covers its own source. The separately installed speech components retain their upstream licenses: [Kokoro model weights](https://huggingface.co/hexgrad/Kokoro-82M) use Apache-2.0; [MeloTTS](https://github.com/myshell-ai/MeloTTS/blob/main/LICENSE) uses MIT; [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) uses Apache-2.0; [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx/blob/main/LICENSE) and [ONNX Runtime](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) use MIT; [phonemizer](https://github.com/bootphon/phonemizer#licence) and the bundled [eSpeak NG](https://github.com/espeak-ng/espeak-ng#license-information) use **GPLv3 or later**. Other dependencies retain their own license terms. Keep the model/runtime downloads out of the source repository; if you redistribute these dependencies, include their required notices and source/license materials under their respective terms.
