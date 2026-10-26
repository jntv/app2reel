# Make your films

App2Reel turns a product brief into a recorded walkthrough and an animated promotional film. [Install the studio](installation.md) and try the included sample before exploring your own product.

## From brief to export

1. Enter the product name, URL, description, purpose, actors/roles, and features. Choose a brand color, walkthrough length (up to 180 seconds), motion-film length, and 720p or 1080p output. New projects start with a 90-second walkthrough and a 45-second motion-film target.
2. If the product needs an account, open **Behind a login?** and enter its username/password for automatic sign-in. For a reCAPTCHA, optionally authorize **Let App2Reel attempt a visible CAPTCHA** for that run. The current interface may still use this older product label. App2Reel can try the checkbox and a bounded sequence of visible challenge clicks through Codex; success is not guaranteed. Passwords stay out of model requests. For SSO, MFA, or a challenge the app cannot complete, use the separate unrecorded sign-in browser. App2Reel detects a successful sign-in and saves it automatically; **I've finished signing in** is an optional check. Add any required product/login origins to the brief first.
3. Start exploration. App2Reel researches public documentation and tutorials, visits the allowed product origins, records real interactions, and tracks which requested features were observed. Exploration has a configurable step budget; it does not guarantee exhaustive coverage of every product or role.
4. Review screenshots, research sources, feature evidence, and the storyboard. Switch between the independent walkthrough and motion-film plans. Edit scene titles, chapter captions, narration, duration, camera focus/zoom, context hold, move/release timing, focus delay, feature outline regions, and outgoing transitions. Add privacy masks over names, contact details or other source regions you want hidden in the demo. Use **AI editing plan** to request different lengths or creative direction from the existing recording without signing in again.
5. In **Your films**, refresh the product design if needed and save your theme, movement, motion-film format (landscape or portrait), narration, subtitle, and pointer preferences, then render both films. Preview and download the MP4s, storyboard JSON, research JSON, SRT/WebVTT subtitles, the narration script, and a spoken WAV track.

The studio performs one exploration, editing-plan or render job at a time. You can cancel a job; interrupted jobs are reported after a restart. Re-explore after changing product/access details. Film targets, resolution and color preserve the recording. Different roles need separate projects/sessions in this release; the app does not automatically impersonate every actor listed in a brief.

## Sample project

Click **Try a sample project** for the fictional Orbit app, which has four real interactive views. Sample exploration uses deterministic browser actions and a fixed storyboard, with no AI calls or external web research; it exercises real recording and rendering. **AI editing plan** still requires Codex if you choose it later.

For a first run without Python or model downloads, go to **Your films**, turn **Spoken narration** off, and click **Save film style** before rendering. To hear narration, [set up natural voices](voices.md) or explicitly choose **System (fallback)** when a system voice is available.

## Two outputs

| Output | What it contains |
| --- | --- |
| `demo.mp4` | Actual browser footage in a large rounded product window, selective held close-ups, visible pointer, feature outlines, dark word-highlighted caption panels, voiceover, and quiet music. |
| `promo.mp4` | Product-inspired interface models with changing states, kinetic headline beats, directional transitions, narrated word highlights, and a branded ending. Landscape or native portrait composition. |

Both use H.264 at 30 fps with AAC audio. By default they include local speech over a restrained original instrumental score. Spoken narration and background music can be disabled independently. Rendering both films frame by frame can take several minutes. Captured browser footage is recorded by Playwright and recompressed; a 1080p export cannot restore detail absent from the source recording.

Use **Cinematic** for stronger movement or **Subtle** for gentler camera and graphic motion. Save style changes before rendering; changing style or focus preserves the captured footage. Review the storyboard and final cuts for your product's creative direction.

### Background music

The original score uses warm keys, layered pads, soft bass and sparse plucks, with a calmer walkthrough arrangement and a gently moving promo arrangement. It is synthesized locally without downloading music or requiring another account. Music fades in, resolves softly at the end, and automatically lowers beneath narration.

In **Your films**, use **Background music** and **Music level** to choose **Very subtle**, **Subtle** (default), or **Warm**. When music is the only style change and finished films exist, **Update music** refreshes their audio without rerendering pictures or regenerating speech. The exact video stream, reviewed voice, captions, and film lengths are preserved. If the matching original voice track is missing or changed, render the films again first.

### Walkthrough footage and camera

The demo composites real video with frame-driven motion artwork; it does not substitute still screenshots for footage. New explorations capture pointer coordinates and actual clicks. Local image analysis follows the orange recording marker on the exact retimed output frames, including held tails, so the replacement pointer stays attached during fast travel. Trusted telemetry supplies real click events; when no marker can be found, new recordings can fall back to approximate telemetry positions. Legacy recordings never acquire invented clicks.

Camera focus and outlined regions remain editable. **Storyboard → Source edit** can retain up to six ordered source intervals per scene, cutting loading or waiting between a real action and its result. The render builds a temporary lossless edit and remaps pointer evidence to that same clock; raw footage stays intact.

The camera holds context for broad views, then uses a selective push and sustained detail hold for smaller controls. Pan and zoom share a smoothly eased viewport transform, including near screen edges. For a page change, give the outgoing shot a release duration: it returns to context and settles before the dissolve begins. Strong close-ups benefit from a longer move and release. Focus delay prevents a highlight appearing before its incoming view settles; it does not chase the pointer. Small active regions allow closer framing while larger regions limit zoom to preserve readable controls. Focus boxes fade gently, labels keep one side of their region throughout the shot, and caption panels ease at phrase changes while word highlights follow speech.

App2Reel records interaction/settled timestamps and distinguishes incoming actions from outgoing explorer intent. The planner orders unique source moments chronologically, gives them variable narration-paced durations, and selects real incoming actions plus a short result hold, excluding AI thinking pauses. Long clips play at most 1.12×; short ones hold their final frame.

### Motion-film design

The promo rebuilds safe interface models from the observed product's labels, layouts, palette, typography and component radius; it does not show private screenshot pixels or video. Colors and models come from the actual product URL, with saved screenshot palettes available for older projects. Bounded public fonts are copied into the project and embedded for offline rendering when available. The promo uses distinct opening, feature, and closing layouts with kinetic headlines.

### Privacy masks

Privacy masks are opaque rectangles applied to original video pixels before camera zoom/pan, so covered details remain hidden as the camera moves. The storyboard previews their position and validates their bounds. Masks affect the exported demo; original recordings and screenshots remain local and unchanged. Review the original and exported artifacts before sharing. See [privacy and local data](privacy.md).

### Narration and subtitles

Spoken narration defaults to local Indian-English neural speech after the one-time [voice setup](voices.md). Speech is normalized, gently fitted to each scene, and mixed above the quiet music bed. Overlong scripts are rejected instead of being rushed.

Heart/Michael align word highlights to their model's phoneme timings when alignment succeeds. Indian English, system speech and rejected alignments use estimated weighted timings within the measured audible speech span; the timing JSON records this distinction. The same phrases are exported as SRT/WebVTT. The WAV voiceover, timing JSON and TXT script remain editable.

Visual rerenders reuse the matching saved narration and word timing. Independent film plans have separate voice caches. Legacy shared-timeline projects require both films to be rendered together if the shared track is missing or no longer matches.

Long silent padding between otherwise connected explanations can make a walkthrough feel segmented. Use narration-paced scene lengths, leaving a short breath within a page and slightly more time for a page change. The renderer rejects lengths that would rush speech. Internally, an explicitly reviewed old/new timeline can re-pad validated original takes without synthesizing a new voice; its assembly metadata records source clocks and exact sample intervals. This operation preserves spoken samples and shifts their captions together.

## AI editing plans and limits

An editing plan can select reviewed source moments, write a separate script for each film, allocate scene lengths, choose context/detail framing, set camera timing, and select cut, dissolve, fade or slide transitions. Its compiler validates source bindings and chronology, applies a natural speech budget, preserves source cuts and privacy masks, and quantizes the clock to 30 fps. It rejects invalid plans and makes at most one correction request. The model cannot add an arbitrary asset path or remove masks through this language.

The walkthrough and motion-film plans have independent scenes, durations, narration, captions and caches. A visual or script edit to one plan preserves the other completed film. New renders publish film-specific files such as `demo-narration.wav`, `promo-narration.wav` and `promo-captions.vtt`.

Older projects with only a shared storyboard keep shared-timeline behavior until replanned. The maximum is 20 scenes and 180 seconds per rendered film; the motion-film planner accepts targets up to 90 seconds. The renderer rejects excess duration rather than silently truncating it.

An edit plan can explain and reframe captured material; it cannot create missing product interactions. Short recordings hold their last real frame. Requesting a longer film does not prove more feature coverage, and empty dashboards remain empty. For implementation details, see [development](development.md#editing-plan-contract).
