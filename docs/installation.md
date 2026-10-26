# Install App2Reel

App2Reel runs on your laptop. Install from source; there is no published App2Reel npm package or hosted service to sign up for.

## Requirements

- **Node.js 22.13 or newer** and Git.
- **pnpm 11.25.0** for the reproducible install below (`npm install -g pnpm@11.25.0`). The repository pins this version and the committed `pnpm-lock.yaml` is the canonical dependency lockfile. npm is an alternative.
- **Chromium**, installed by the setup command, and **FFmpeg**, supplied by `ffmpeg-static` unless you set an override.
- For AI-assisted exploration and editing: a current [Codex CLI](https://learn.chatgpt.com/docs/cli), signed into your own ChatGPT account with Codex access and remaining usage. The included sample works without AI calls or a Codex sign-in.
- Optional narration: Python **3.12 or 3.13** for natural local voices, or a supported system voice. See [voice setup](voices.md).

macOS and Linux are the primary environments. Natural voice setup has been verified on Apple Silicon CPU; its pinned macOS runtime needs macOS 14 or newer. The optional Qwen voices require Apple Silicon and macOS 14 or newer. On Windows, native Codex executable discovery and voice compatibility require additional care; see [Codex access](codex-access.md).

## Install from source

```bash
git clone https://github.com/jntv/app2reel.git
cd app2reel
pnpm install --frozen-lockfile
pnpm run setup
pnpm run doctor
pnpm dev
```

Open **[http://127.0.0.1:4310](http://127.0.0.1:4310)**. Keep the terminal running while using the studio. `setup` downloads Playwright's Chromium browser; `doctor` checks your local prerequisites and reports what still needs attention. Codex login and natural voices are optional for the sample path below.

The workspace configuration allows the `ffmpeg-static` and `esbuild` dependency build scripts. Approve those scripts if your pnpm version asks. On a restricted network, supply an existing FFmpeg executable with `FFMPEG_PATH`.

On Linux, Chromium also needs operating-system libraries. Install them with Playwright's supported setup command if they are missing; it may ask for administrator access to the system package manager:

```bash
pnpm exec playwright install --with-deps chromium
```

With npm, use this alternative after cloning:

```bash
npm install
npm run setup
npm run doctor
npm run dev
```

npm resolves dependencies from `package.json`; it does not use the pnpm lockfile. Use pnpm when you want the dependency versions tested by this repository. Avoid committing a second package-manager lockfile.

## Try the sample first

1. In the studio, click **Try a sample project** to create the included fictional Orbit workspace.
2. Start exploration. Orbit has four interactive views; App2Reel records real browser actions and creates a fixed storyboard without AI requests or external web research.
3. Open **Your films**. Turn **Spoken narration** off and click **Save film style** to skip Python and voice-model setup for your first render.
4. Render the films, preview them, and download the MP4s.

The default voice quality is **Natural (local)**, so a narrated render requires [voice setup](voices.md) or an explicit switch to **System (fallback)**. For the sample, keep the fixed storyboard: **AI editing plan** uses Codex even when the recording came from Orbit.

Rendering both films frame by frame can take several minutes. The sample verifies the local recording and export workflow before you provide real product access.

## Connect ChatGPT for your own product

Install and sign into the Codex CLI:

```bash
npm install -g @openai/codex
codex login
codex login status
```

Choose **Sign in with ChatGPT**. Each person uses their own account and runs their own copy of App2Reel. No OpenAI API key is required or used by this app.

If Codex is installed but not signed in, click **Connect ChatGPT** in the studio. Codex opens the official account sign-in in your system browser. App2Reel never asks for your ChatGPT password or reads its token files. If your CLI uses an API-key session, switch it to ChatGPT yourself in the terminal; changing the CLI login can also affect your CLI/IDE sessions. See [Codex access and isolation](codex-access.md).

## Later launches and built interface

After installation, run `pnpm dev` in the repository whenever you want to launch the studio. On macOS, you can also double-click **Start App2Reel.command** and leave its terminal window open. The launcher checks normal Node paths and the Node runtime bundled with Codex when available.

To use the built interface:

```bash
pnpm run build
pnpm start
```

The npm equivalents are `npm run build` and `npm start`.

The app binds only to `127.0.0.1`. It is a local, single-user app without multi-user server authentication. Keep it on your laptop.

## Configuration

Set environment variables in the shell before starting. [`.env.example`](../.env.example) lists the available settings; **`.env` is not automatically loaded**. Storage and voice environment names retain the `CAPTURE_` prefix for compatibility.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4310` | Local HTTP port. |
| `DATA_DIR` | `<repository>/.capture` | Project and media storage. |
| `CODEX_BIN` | Auto-detect `codex` or macOS app binary | Absolute path to a supported Codex CLI. |
| `CODEX_MODEL` | Codex CLI default | Optional model available to the signed-in account. |
| `FFMPEG_PATH` | `ffmpeg-static` package binary | Local FFmpeg override. |
| `CAPTURE_PYTHON` | Existing voice environment, then `python3.12`, `python3.13`, or compatible `python3` | Python executable for one-time natural voice setup. Requires Python 3.12 or 3.13. |
| `CAPTURE_VOICE_DIR` | Server: `<DATA_DIR>/voice-runtime`; setup CLI: `.capture/voice-runtime` | Shared local voice runtime override. Use the same path for setup and the studio. |

For example:

```bash
PORT=4311 CODEX_BIN=/absolute/path/to/codex pnpm dev
```

## Troubleshooting

Run `pnpm run doctor` (or `npm run doctor`) after installation or when prerequisites change. It checks dependencies, Chromium, FFmpeg, and optional Codex/voice prerequisites without installing software or changing authentication. You can run `node scripts/doctor.mjs` before installing dependencies too. A successful login check verifies authentication; it cannot guarantee remaining usage or access to a particular model.

| Problem | Next step |
| --- | --- |
| Chromium is missing | Run `pnpm run setup` again. On Linux, follow any Playwright message about missing operating-system libraries. |
| FFmpeg is unavailable | Check dependency build-script approval, or start with `FFMPEG_PATH=/absolute/path/to/ffmpeg pnpm dev`. |
| Codex cannot be found | Install a current CLI or set `CODEX_BIN` to its executable. |
| Codex session uses an API key | Run the official CLI login/logout commands in your terminal to switch to ChatGPT. |
| Codex isolation flags are unsupported | Upgrade the CLI. App2Reel rejects incompatible versions rather than weakening isolation. |
| Natural voice rendering is blocked | Follow [voice setup](voices.md), explicitly choose **System (fallback)**, or turn off **Spoken narration** and save the film style. |
| Voice setup succeeds but the server cannot find it | Set `CAPTURE_VOICE_DIR` to the same absolute directory during setup and when launching the studio, especially with a custom `DATA_DIR`. |
| Port 4310 is occupied | Set `PORT` to another local port and open that address. |

Continue with [making your films](usage.md), [voice setup](voices.md), and [product access and privacy](privacy.md).
