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

## Make your films

1. Enter the product name, URL, description, purpose, actors/roles, and features. Choose a brand color, film length, and 720p or 1080p output.
2. If the product needs an account, open **Behind a login?** and enter its username/password for automatic sign-in. For a reCAPTCHA, optionally authorize **Let Capture attempt a visible CAPTCHA** for that run. Capture can try the checkbox and a bounded sequence of visible challenge clicks through Codex; success is not guaranteed. Passwords stay out of model requests. For SSO, MFA, or a challenge the app cannot complete, use the separate unrecorded sign-in browser and choose **I've finished signing in**. Add any required product/login origins to the brief first.
3. Start exploration. Capture researches public documentation and tutorials, visits the allowed product origins, records real interactions, and tracks which requested features were observed. Exploration has a configurable step budget; it does not guarantee exhaustive coverage of every product or role.
4. Review screenshots, research sources, feature evidence, and the storyboard. Edit scene titles, captions, narration scripts, and duration.
5. Render both films. Preview and download the MP4s, storyboard JSON, research JSON, captions, and narration script.

Use **Try a sample project** first. The included fictional Orbit app has four real interactive views. Sample mode uses deterministic browser actions and a fixed storyboard, with no AI calls or external web research; it exercises real recording and rendering.

### Two outputs

| Output | What it contains |
| --- | --- |
| `demo.mp4` | Actual browser footage trimmed to selected moments, retimed to scene lengths, with a cinematic browser frame, titles, captions, fades, and soundtrack. |
| `promo.mp4` | Frame-rendered motion design: perspective product cards textured with captured screenshots, kinetic typography, animated spheres/rings, and soundtrack. |

Both use H.264 at 30 fps with AAC audio. The original ambient sound bed is synthesized locally. Narration is exported as TXT/SRT; **spoken voiceover is not generated**. Perspective scenes and geometric shapes are template-driven graphics. This first release does not produce arbitrary photorealistic CGI or generative video. Bespoke studio creative direction, asset production, and editorial polish remain iterative work.

Rendering takes time: on the development laptop, a three-second pair took about 13 seconds at 1080p; a longer film can take several minutes. Captured browser footage is recorded by Playwright and recompressed; a 1080p export cannot restore detail absent from a product's assets or the source recording.

## Product access and privacy

- The brief, account screenshots, and visible page text are sent to OpenAI through Codex for AI-assisted runs. Public web research also sends product context to search. Raw video encoding and motion rendering happen locally.
- Projects, screenshots, raw footage, storyboards, and exports are stored in ignored `.capture/` directories. Recordings can contain private account data: review what you intend to export. Delete a project's directory while the server is stopped to remove its local data.
- Product passwords are used only in an unrecorded login attempt. They are never given to the model or saved in project metadata or logs. Authentication cookies and browser storage are kept in memory, consumed by the next exploration, and expire after an hour. They disappear when the server stops.
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

Tests cover Codex configuration isolation, subscription-only authentication, structured completion, cancellation, URL validation/origin boundaries, dangerous actions, and job reservation. Development verification also includes a real Codex subscription request, actual browser recordings, 720p/1080p MP4 encodes, cancellation, full video decoding, and desktop/mobile interface checks. A sample is included so you can verify the complete workflow before using a real product.

Code layout: `src/` is the React studio; `server/ai.ts` is the local Codex bridge; `server/browser.ts` implements browser actions and recording; `server/pipeline.ts` orchestrates research and storyboarding; `server/render.ts` and `server/film-template.ts` encode and design the films. Durable requirements and API contracts are in `project-context/`.

## Subscription access

[Codex authentication](https://developers.openai.com/codex/auth) and [non-interactive execution](https://developers.openai.com/codex/noninteractive) document the path used here. Plan eligibility, rate limits, model availability, and organizational policies still apply. Capture does not provide unlimited inference or grant access to every OpenAI media model.

OpenAI also documents a newer [open-source Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source). That can support a future direct OAuth adapter; this release uses the supported local Codex login and does not implement a separate embedded OAuth client. See [Codex access details](docs/codex-access.md).

## Sharing the repository

Source is ready to put in a Git repository under the MIT license. No remote has been created or published. Commit the source, README, license, and lockfile; leave `.capture/`, credentials, and `node_modules/` ignored. Replace the clone URL above with your repository URL after publication.
