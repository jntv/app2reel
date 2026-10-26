# Local narration

App2Reel's default **Natural (local)** voice quality uses neural speech on your computer. **Indian English** (female, MeloTTS ONNX) is the default; **Heart** (female US English) and **Michael** (male US English) use Kokoro ONNX. Narration needs no paid voice API or additional account. Codex continues to handle research and storyboarding for AI-assisted projects.

For a first export without voice setup, turn **Spoken narration** off in **Your films**, then click **Save film style**. You can also explicitly choose **System (fallback)**. That uses Samantha on macOS or an installed `espeak-ng`/`espeak` on Linux. A missing natural runtime blocks narrated rendering until setup succeeds or you choose another option.

## Set up natural voices

Install **Python 3.12 or 3.13** first. The pinned runtime requires **macOS 14 or newer on macOS** and has been verified on Apple Silicon CPU. Setup downloads about **165 MB for Indian English** as a compressed archive, plus Python packages, once. The extracted Indian-English model files use about 175 MB; setup retains the verified archive for reuse. Heart/Michael share an optional **350 MB** model pack. Setup installs only the selected voice's model pack. Files stay in ignored `.capture/voice-runtime/`.

```bash
pnpm setup:voice
```

The npm equivalent is:

```bash
npm run setup:voice
```

Setup creates an isolated Python environment, installs pinned packages, and verifies the official model downloads with SHA-256. It reuses verified files on later runs. If Python is outside your `PATH`, provide its executable explicitly:

```bash
CAPTURE_PYTHON=/absolute/path/to/python3.12 pnpm setup:voice
```

You can also open **Your films → Voice quality → Natural (local)** and click **Set up natural voices**. The studio shows download progress and readiness; **Preview voice** plays a sample of the current script. Choose Indian English, Heart, or Michael, preview it, then click **Save film style** before rendering. After setup, speech is generated offline on your laptop.

## Select and check a voice

The terminal defaults to Indian English. Check readiness for the specific voice you intend to use:

```bash
node scripts/setup-voice.mjs --status --voice melo_india
```

Install and check the optional US voice pack:

```bash
pnpm setup:voice --voice af_heart
node scripts/setup-voice.mjs --status --voice af_heart
```

With npm, forward voice options after `--`:

```bash
npm run setup:voice -- --voice af_heart
```

| Voice ID | Voice | Model pack |
| --- | --- | --- |
| `melo_india` | Indian English, female | MeloTTS ONNX |
| `af_heart` | Heart, female US English | Kokoro ONNX |
| `am_michael` | Michael, male US English | Same Kokoro pack as Heart |

The setup CLI also accepts `--dir /absolute/runtime/path`; set `CAPTURE_VOICE_DIR` to that same path when starting the studio. Use this shared override when your command-line setup and a custom `DATA_DIR` would otherwise select different runtime directories. Environment variable names retain the `CAPTURE_` prefix for compatibility.

Indian English reads English narration. Unknown product names receive an approximate pronunciation from a bundled local dictionary and pronunciation engine. Spell a name phonetically in the narration if needed. Unsupported scripts or sounds produce an error rather than silently omitting words. Indian-English word highlights use estimated timings within the measured audible speech span.

## Optional designed adult Indian-English voices

On an **Apple Silicon Mac with macOS 14 or newer**, choose **Designed Indian English · adult male** or **adult woman**, then preview it. These optional Qwen3-TTS voices use English with an Indian accent requested during voice design; judge accent and timbre from the audition. Each is anchored to a bundled generic synthetic voice reference, not a real person's recording. Every scene uses that fixed reference and a fixed seed. No pitch shifting is applied.

```bash
pnpm setup:voice --voice qwen_indian_male
```

Either choice installs the same pack and enables both voices:

```bash
node scripts/setup-voice.mjs --status --voice qwen_indian_female
```

Setup downloads the pinned **~2.34 GB Qwen3-TTS 1.7B Base 4-bit** pack plus Python packages, checks each asset's SHA-256, and creates a separate `qwen-venv`. VoiceDesign is used only to create the bundled references and is not installed. Rendering is offline. The recipe in [`assets/voices/qwen-recipes.json`](../assets/voices/qwen-recipes.json) records model revisions, reference hashes, transcripts and synthesis settings; its digest participates in narration cache identity. See [reference provenance](../assets/voices/README.md).

Qwen word highlights use estimated timings within the measured speech span rather than forced word alignment. This optional engine currently rejects other platforms with a clear error; the lightweight voices remain available there subject to their runtime requirements.

## Timing and rendering

Speech is normalized, gently fitted to each scene, and mixed above the quiet music bed. Overlong scripts are rejected instead of being rushed. Heart/Michael use their model's phoneme timings for word highlights when alignment succeeds. Indian English, system speech and rejected alignments use estimated weighted timings within the measured audible speech span; timing JSON records which method was used. The subtitles, WAV narration, and TXT script are exported alongside the video. See [narration and subtitles](usage.md#narration-and-subtitles).

## Dependency licenses

App2Reel's [MIT license](../LICENSE) covers its own source. Separately installed voice components retain their upstream licenses:

| Component | Upstream license |
| --- | --- |
| [Kokoro model weights](https://huggingface.co/hexgrad/Kokoro-82M) | Apache-2.0 |
| [MeloTTS](https://github.com/myshell-ai/MeloTTS/blob/main/LICENSE) | MIT |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) | Apache-2.0 |
| [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx/blob/main/LICENSE) | MIT |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) | MIT |
| [phonemizer](https://github.com/bootphon/phonemizer#licence) and bundled [eSpeak NG](https://github.com/espeak-ng/espeak-ng#license-information) | GPLv3 or later |
| [Qwen3-TTS models](https://github.com/QwenLM/Qwen3-TTS) and [MLX Base conversion](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit) | Apache-2.0 |
| [MLX Audio](https://github.com/Blaizzy/mlx-audio) | MIT |

Other dependencies retain their own license terms. Keep model/runtime downloads out of the source repository. If you redistribute these dependencies, include their required notices and source/license materials under their respective terms. Model weights remain separate downloads; bundled voice-reference provenance is recorded with the recipe.
