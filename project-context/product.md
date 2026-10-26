# Capture Studio product context

Last reviewed: 2026-10-26. Sources: user brief in this chat; `shared/types.ts`; `src/main.tsx`; backend and renderer implementation. No ERP linkage requested; identifiers remain empty. Calendar target was not specified. No effort estimate or publication date is promised.

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
| REQ-006 | Approved: polished live demo video | Real recorded interactions, selected clips, captions, scene timing, soundtrack and 30fps H.264 export implemented. Sample recordings and encodes verified. Quality remains template-based and reviewable. |
| REQ-007 | Approved: motion/3D promotional video | Deterministic perspective product cards, kinetic text, geometry and soundtrack; actual MP4 export verified. Arbitrary bespoke CGI/VFX and generative video are not implemented in this first release. |
| REQ-008 | Implementation choice: review before export | Editable scene titles/captions/narration/duration; user starts both renders. Narration scripts exported without generated speech. |
| REQ-009 | Approved 2026-10-26: app itself should attempt sign-in and required CAPTCHA for the supplied SmartSevak test | Optional per-run CAPTCHA authorization; isolated, unrecorded sign-in; masked/cropped screenshot decisions; bounded visible challenge clicks; verified authenticated navigation. Live SmartSevak attempts reached the CAPTCHA but did not complete it (latest: four steps); authenticated exploration/videos remain blocked on human sign-in. Manual fallback can fill supplied credentials locally. Seven local sign-in fixtures and the full17-test suite passed. |

## Constraints and open decisions

Local single-user execution; one heavy job at a time; 10–90-second films at720p/1080p; Codex CLI, Chromium and local FFmpeg required. Screenshots/page text are processed by OpenAI; media rendering is local. Default read-only request policy can prevent POST-based data loading. Complex login, canvas apps, sessionStorage-only authentication, inaccessible routes, and role-specific permissions may require manual intervention. Production use still needs target-product validation and creative review. Future direct SIWC OAuth, multi-role journeys, voiceover, richer asset import, higher-quality capture, and arbitrary CGI are undecided extensions.
