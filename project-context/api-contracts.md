# Local API contracts

Last reviewed: 2026-10-27. Source: `server/index.ts`, `store.ts`, `shared/types.ts`, `src/main.tsx`. All endpoints below are implemented. Consumer: local React studio. Auth: the local OS user, exact loopback Host/Origin checks; mutations require application/json. No remote multi-user access is supported. Malformed requests return400, rejected origins403, unsupported media415, busy jobs409, absent projects404.

| Method/path | Requirement | Request / response | Effect |
| --- | --- | --- | --- |
| GET `/api/health` | REQ-002 | Health with AI status, browser and FFmpeg availability | Read-only local dependency checks. |
| POST `/api/auth/login` | REQ-002 | `{}` → started/message | Opens supported Codex account login; no tokens returned. |
| GET `/api/projects` | REQ-001/003 | Project array | Lists local projects. |
| POST `/api/projects` | REQ-003 | Brief → Project | Strict validation; creates local project. sample mode cannot be forged. |
| POST `/api/sample` | REQ-001/006/007 | `{}` → Project | Creates fictional local fixture brief. No AI request. |
| GET `/api/projects/:id` | REQ-003 | Project | Metadata, progress, findings, scenes and outputs. |
| PUT `/api/projects/:id` | REQ-003/008/010 | `{brief?: Partial<Brief>, scenes?: Scene[], renderSettings?: {motion:'cinematic'\|'subtle',subtitles:boolean,cursorHighlights:boolean}}` → Project | Brief changes invalidate evidence/output/login. Story/style edits invalidate films and preserve footage. Focus/mask/clip-only edits preserve the graphics promo. Optional Scene.focus `{x:0..1,y:0..1,zoom:1..2.4}`; Scene.redactions has up to8 normalized `{x,y,width,height}` rectangles, all inside source frame. Reject over90s timelines, foreign screenshot refs and invalid mask bounds. |
| POST `/api/projects/:id/login` | REQ-004/009 | `{loginUrl?: string, credentials?: {username,password}}` → message | Discards the previous saved login and opens a visible unrecorded sign-in browser; optionally fills credentials locally, without submitting or attempting CAPTCHA. Requires allowed origin. |
| GET `/api/projects/:id/login/status` | REQ-004/009 | `{state: 'pending'\|'ready'\|'none', message}` | Reports automatic sign-in handoff without returning credentials or tokens. |
| POST `/api/projects/:id/login/complete` | REQ-004/009 | `{}` → message | Optional idempotent confirmation of verified sign-in; rejects incomplete forms without closing the browser. Autosaved auth remains reusable in memory across explorations and retries until eight hours after the original save; confirmation and restoration do not extend expiry. |
| POST `/api/projects/:id/explore` | REQ-004/005/009 | `{credentials?: {username,password,loginUrl?,attemptCaptcha?}}` →202 Project | Starts one cancellable job. Reuses a saved manual login without consuming it or extending its expiry. Explicit credentials discard the saved login; credentials and CAPTCHA consent are run-local and excluded from persisted Project type. |
| POST `/api/projects/:id/render` | REQ-006/007/010 | `{kinds: ('demo'\|'promo')[]}` →202 Project | Renders live demo with camera/cursor motion or screenshot-free graphics promo. Both can burn timed subtitles. Publishes MP4s, posters, SRT and WebVTT. |
| POST `/api/projects/:id/cancel` | REQ-004/006/007 | `{}` → message | Requests job abort. |
| GET `/api/projects/:id/events` | REQ-004/008 | SSE JSON Project events | Initial snapshot and updates;15s keepalive. |
| GET `/artifacts/:id/:filename` | REQ-006/007/008/010 | Current referenced PNG/JPG/MP4/WebM/JSON/SRT/VTT/TXT | Only current project assets, including encoded-film posters and timed subtitles; no project metadata or directory listing. |
| GET `/sample-product` | Verification | Interactive fictional Orbit HTML | Sample browser exploration and capture. |

Exact structures are in `shared/types.ts`. Older projects without renderSettings use cinematic movement, burned subtitles and cursor effects. New capture writes Project.cursorTrack (time, normalized coordinates, event kind), never input text; the API does not accept arbitrary telemetry edits. Errors are JSON `{error: string}`. Job stages: draft, researching, exploring, review, rendering, complete, failed, cancelled. Side effects are local files/browser activity and subscription-backed inference when sample=false. Server shutdown clears saved logins. Future OAuth and voice adapters have no API contract yet.
