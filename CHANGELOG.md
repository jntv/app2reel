# Changelog

## 0.1.0 — Unreleased

Initial source release preparation. No GitHub release has been published yet.

### Added

- Local studio for product exploration, recording, storyboard review, and video export.
- AI-assisted research and editing through a signed-in local Codex CLI.
- Independent demo and promotional film plans, privacy masks, narration, and subtitle exports.
- Product-themed full-screen intros and closing invitations for both films, with a saved Film style toggle.
- Local speech setup and a fictional sample project for trying recording and rendering.
- Installation and development guides, contribution guidelines, issue forms, and release-note categories.

### Fixed

- Keep opaque intro cards and transparent walkthrough artwork on one RGBA frame format, preventing encoder filter resets from advancing held footage into the next page.
- Keep an exact frame clock through mixed cuts and transitions on Linux FFmpeg.
- Preserve the full narration duration at 48 kHz so visual-only rerenders can reuse reviewed speech and captions.
- Keep ducked background music present through the final audio frame when replacing a film's existing mix.
