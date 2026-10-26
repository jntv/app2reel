# Capture Studio product context

Last reviewed: 2026-10-27. Sources: user brief in this chat; `shared/types.ts`; `src/main.tsx`; backend and renderer implementation; live SmartSevak exploration and exported films. No ERP linkage requested; identifiers remain empty. Calendar target was not specified. No effort estimate or publication date is promised.

## Purpose and users

Help a product owner turn a product name, description, purpose, URL, actors and features into a screen-based demo and a promotional motion film. Today this generally requires manual research, recording, editing, and motion design. The app serves product founders, marketers, and demo creators running a local copy on their own laptop. A product test account is distinct from the ChatGPT account used for AI.

## Requirements and acceptance

| ID | User requirement / approval | Observable acceptance / coverage |
| --- | --- | --- |
| REQ-001 | Approved: cloneable locally run open-source tool | MIT license, README, package scripts, loopback app. Source prepared; no remote publication requested or performed. |
| REQ-002 | Approved: AI uses ChatGPT/Codex subscription login | Local Codex login/status + live structured inference verified. Model and plan limits apply. Uses CLI-mediated OAuth, not independent app account authentication. |
| REQ-003 | Approved: product name/URL/description/actors/purpose/features input | Validated brief form and JSON persistence; optional test credentials held in memory. |
| REQ-004 | Approved: explore product deeply, including signed-in features | Screenshot-guided bounded action loop, observation evidence and scoped origins. Manual sign-in and simple login forms implemented. Exhaustive traversal and automatic role switching remain gaps. |
| REQ-005 | Approved: search product information/tutorials | Codex web research returns linked sources; best effort fallback if search unavailable; sources distinguished from observed product evidence. |
| REQ-006 | Approved: polished live demo video | Real footage with eased camera zoom/pan, cursor following/highlights, animated chapter graphics and captions, word-highlighted subtitles, soundtrack and 30fps H.264. Camera focus is editable. Original SmartSevak cuts are preserved; the updated treatment uses their reviewed recording intervals. |
| REQ-007 | Approved: motion/3D promotional video | Screenshot-free procedural 3D forms, feature diagrams, kinetic type, particle/camera movement, captions/subtitles and branded ending. The promo does not load product images or recordings. Arbitrary bespoke photorealistic CGI/generative video remains outside this procedural renderer. |
| REQ-008 | Implementation choice: review before export | Editable scene titles/captions/narration/duration; user starts both renders. Narration scripts exported without generated speech. |
| REQ-009 | Approved 2026-10-26: app itself should attempt sign-in and required CAPTCHA for the supplied SmartSevak test | Live automated CAPTCHA attempts did not complete; user completed human sign-in. Capture saved it automatically and explored 15 authenticated screens. Dashboard, leads, reminders, bookings and analytics surfaces were observed; engagement workflows were not verified. Both films were generated. The div-based sidebar detection bug, iframe MFA checks, sessionStorage transfer and concurrent windows have regressions. Saved sessions remain reusable in memory for their original eight-hour lifetime; passwords are not persisted. |
| REQ-010 | Approved 2026-10-27: update the tool; no screens in motion promo; dynamic movement, graphics, captions, subtitles and cursor zooms | Implemented and verified: graphics-only promo; live-footage demo with eased camera/cursor motion; animated graphics/captions; timed active-word subtitles with SRT/WebVTT; saved style controls; per-scene focus/zoom and opaque masks. Build plus 53 distinct checks pass. Both final 30-second 1080p masters fully decode. Five scenes were visually reviewed; promo motion is measurable in every scene and uses no screen assets. Seven final bookings samples verify patient identifiers are covered and the complete dialog/captions/subtitles fit. Original v1 cuts remain preserved locally. |

## Constraints and open decisions

Local single-user execution; one heavy job at a time; 10–90-second films at720p/1080p; Codex CLI, Chromium and local FFmpeg required. Screenshots/page text are processed by OpenAI; media rendering is local. Default read-only request policy can prevent POST-based data loading. Complex login, canvas apps, inaccessible routes, and role-specific permissions may require manual intervention. Saved product sessions expire after eight hours and are lost when the server stops. Production use still needs target-product validation and creative review. Future direct SIWC OAuth, multi-role journeys, voiceover, richer asset import, higher-quality capture, and arbitrary CGI are undecided extensions.
