# Local API contracts

Last reviewed: 2026-10-26. Source: `server/index.ts`, `store.ts`, `shared/types.ts`, `src/main.tsx`. All endpoints below are implemented. Consumer: local React studio. Auth: the local OS user, exact loopback Host/Origin checks; mutations require application/json. No remote multi-user access is supported. Malformed requests return400, rejected origins403, unsupported media415, busy jobs409, absent projects404.

| Method/path | Requirement | Request / response | Effect |
| --- | --- | --- | --- |
| GET `/api/health` | REQ-002 | Health with AI status, browser and FFmpeg availability | Read-only local dependency checks. |
| POST `/api/auth/login` | REQ-002 | `{}` → started/message | Opens supported Codex account login; no tokens returned. |
| GET `/api/projects` | REQ-001/003 | Project array | Lists local projects. |
| POST `/api/projects` | REQ-003 | Brief → Project | Strict validation; creates local project. sample mode cannot be forged. |
| POST `/api/sample` | REQ-001/006/007 | `{}` → Project | Creates fictional local fixture brief. No AI request. |
| GET `/api/projects/:id` | REQ-003 | Project | Metadata, progress, findings, scenes and outputs. |
| PUT `/api/projects/:id` | REQ-003/008 | `{brief?: Partial<Brief>, scenes?: Scene[]}` → Project | Brief changes invalidate evidence/output and stored login; scene edits invalidate output. Reject over90s timelines and foreign screenshot refs. |
| POST `/api/projects/:id/login` | REQ-004/009 | `{loginUrl?: string, credentials?: {username,password}}` → message | Opens visible unrecorded sign-in browser; optionally fills credentials locally, without submitting or attempting CAPTCHA. Requires allowed origin. |
| GET `/api/projects/:id/login/status` | REQ-004/009 | `{state: 'pending'\|'ready'\|'none', message}` | Reports automatic sign-in handoff without returning credentials or tokens. |
| POST `/api/projects/:id/login/complete` | REQ-004/009 | `{}` → message | Optional idempotent confirmation of verified sign-in; rejects incomplete forms without closing the browser. Auth is autosaved in memory for next run, expiring after eight hours. |
| POST `/api/projects/:id/explore` | REQ-004/005/009 | `{credentials?: {username,password,loginUrl?,attemptCaptcha?}}` →202 Project | Starts one cancellable job. Credentials and CAPTCHA consent are run-local and excluded from persisted Project type. |
| POST `/api/projects/:id/render` | REQ-006/007 | `{kinds: ('demo'\|'promo')[]}` →202 Project | Renders reviewed storyboard and publishes outputs. |
| POST `/api/projects/:id/cancel` | REQ-004/006/007 | `{}` → message | Requests job abort. |
| GET `/api/projects/:id/events` | REQ-004/008 | SSE JSON Project events | Initial snapshot and updates;15s keepalive. |
| GET `/artifacts/:id/:filename` | REQ-006/007/008 | Current referenced PNG/MP4/WebM/JSON/SRT/TXT | Only current project assets, no project metadata or directory listing. |
| GET `/sample-product` | Verification | Interactive fictional Orbit HTML | Sample browser exploration and capture. |

Exact data structures are defined in `shared/types.ts`. Errors are JSON `{error: string}`. Job stages: draft, researching, exploring, review, rendering, complete, failed, cancelled. Side effects are local files/browser activity and subscription-backed inference when sample=false. Future direct OAuth and voice/media adapters have no API contract yet.
