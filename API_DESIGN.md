# NamasteVideo.ai — API Design

Version 1.0 · September 26, 2026  
Status: Proposed implementation contract; routes are not implemented.  
Inputs: [PRD](PRD.md), [system design](SYSTEM_DESIGN.md), [database design](DB_DESIGN.md).  
Scope: Internal individual accounts, English 60–90-second explainers, private media, individual Instagram. UI design in Google Stitch precedes frontend implementation.

## 1. Reading this contract

The system design defines runtime boundaries. This document defines what a client submits, receives, retries and displays. The database document defines how those guarantees are persisted. Later user decisions take precedence over original PRD defaults: Daniel remains the explicitly accepted test voice; unavailable Indian presets are not silently substituted or falsely advertised.

All paths below are relative to the application's HTTPS origin unless marked gateway. `/api` is the V1 namespace. These are same-origin application APIs, not a public developer platform. Breaking changes require coordinated versioning, never silent reinterpretation of saved hashes or payloads. The document version is independent of storyboard `schemaVersion:2` and database record schema versions.

Refinements to the system-design outline:

- Add explicit session facade, history reads, candidate application/restoration, narrator change, and project-scoped publish-history reads.
- Draft revision, project metadata revision and publish-intent revision are independent counters.
- A publish intent references an immutable payload revision; rescheduling never erases previous approval evidence.
- Deletion returns a cleanup operation ID that remains owner-readable while content is inaccessible.
- Provider-owned authentication responses remain behind a small app facade; no bearer session token is returned to browser JavaScript.

No additional creator steps, billing features, public signup or shared workspaces are introduced.

## 2. Transport and common conventions

### 2.1 Headers and representations

| Concern | Contract |
|---|---|
| Requests | HTTPS, `Content-Type: application/json` for JSON bodies, `Accept: application/json` |
| Cookies | Same-origin secure HttpOnly session cookie set by Better Auth integration; browser uses credentials `same-origin` |
| CSRF | Exact configured Origin required for cookie-authenticated mutations, including sign-in; reject missing/untrusted Origin on browser routes |
| Command identity | `Idempotency-Key` required for endpoints marked **K**; random UUID, 16–128 printable ASCII characters, no user content |
| Correlation | Server-generated `X-Request-Id` on every response; response meta/error repeats it |
| Caching | Private API: `Cache-Control: private, no-store`; no shared Next.js fetch cache for user data |
| Input size | Maximum JSON body 256 KiB; reject oversize before parsing; route-specific text limits also apply |
| Time | UTC RFC3339 with milliseconds, e.g. `2026-09-26T10:00:00.000Z`; schedule local time is explicitly separate |
| IDs | Opaque strings; application IDs are prefix + random suffix, pattern `^[a-z]{2,8}_[A-Za-z0-9_-]{16,64}$`; user IDs are opaque auth IDs |
| Hash | SHA-256 encoded as 64 lowercase hexadecimal characters; never supplied as proof of ownership |
| Integers | JSON integers within safe integer range; frames/counters nonnegative; revision starts at 1 |
| Null | GET representations use explicit null for known absent singleton references. Mutation omission means unchanged; null is allowed only where explicitly clearable. |
| Unknown fields | Reject mutation fields not in schema; clients tolerate additive response fields |

Trim topic/title and validate meaningful non-whitespace content. Count input length in Unicode code points, not bytes or UTF-16 code units. Preserve submitted narration text and line breaks after validation; do not normalize it silently after approval. UI and backend must use the same normalization before hashing. Text is plain text, never interpreted HTML/Markdown instructions by the renderer.

### 2.2 Response envelopes

Success: `{ "data": T, "meta": { "requestId": "req_example000000001" } }`.

List: `{ "data": [T], "page": { "nextCursor": null, "hasMore": false }, "meta": { "requestId": "..." } }`.

Async response (**202**) uses `data: AcceptedOperation`:

```json
{
  "data": {
    "jobId": "job_example000000001",
    "resource": {"kind": "video", "id": "vid_example000000001"},
    "state": "queued",
    "statusUrl": "/api/jobs/job_example000000001"
  },
  "meta": {"requestId": "req_example000000001"}
}
```

`resource` may be null until a planning result exists. A 202 means durable acceptance, not provider success. `Location` points to the job or intent status URL. No browser connection must remain open. 204 has no JSON body. OAuth redirects and media bytes are explicit envelope exceptions.

### 2.3 Pagination

List routes accept `limit` integer 1–50 (default 20) and optional `cursor` up to 2,048 characters. No numeric offsets or total-count promise. The cursor is opaque, versioned, HMAC-signed, bound to owner, route, filters, order and last sort tuple; expires after 24 hours. Validate before querying. Cross-owner, tampered, filter-mismatched or expired cursors return `400 INVALID_CURSOR` without disclosing contents.

Projects sort `updatedAt DESC, id DESC`; histories sort `createdAt DESC, id DESC`; conversation messages sort `sequence ASC`. Use a strict tuple boundary and fetch `limit+1`. Lists are live, not snapshot-isolated across requests: editing a project's sort key can move it between pages. Clients deduplicate by ID and refresh from page one after mutations. Do not claim stable snapshot pagination for mutable `updatedAt`.

Project filter: `filter=all|drafts|ready|scheduled|published|needs_attention`. Filters may overlap: a project can have a draft and a scheduled older video. A project response contains independent flags, not a single status pretending these are exclusive. Reads exclude tombstones. History endpoints reject deleted/non-owned parent projects.

### 2.4 Idempotency and concurrency

For **K** routes, the key scope is owner + HTTP method + normalized path. Server canonicalizes the validated request (including preconditions), hashes it and atomically stores the accepted response with created records/outbox. Same key/same request returns the same status and resource IDs with `Idempotency-Replayed: true`; current resource state is obtained by GET. Same key/different request returns `409 IDEMPOTENCY_KEY_REUSED`. A concurrent in-progress receipt returns `409 COMMAND_IN_PROGRESS` with `Retry-After: 1`.

Authorization and parent visibility are checked before replay; a receipt cannot reveal deleted/foreign data. Deleted content commands yield 404, except the owner's deletion receipt/status. Validation/authorization failures before acceptance do not consume the key. After an ambiguous HTTP timeout, retry the identical request and key. After editing the body, use a new key. Accepted command receipts have no short TTL; cleanup follows project deletion after side effects resolve. This does not guarantee exactly-once provider execution.

CAS routes require `expectedRevision`; missing preconditions return `422 VALIDATION_FAILED`. A stale revision returns `409 REVISION_CONFLICT` with the current revision and reload URL. A repeated autosave after a lost response may conflict; the client refetches and compares contents. It must not blindly resend against the newer revision.

Only one content pipeline per project. Brainstorm, plan, revise, generate, caption render and post-caption suggestion share the slot; overlapping commands return `409 PROJECT_BUSY` with owner-visible activeJobId. Publishing has its own independent state. Editing a draft does not cancel a running pipeline.

## 3. Authentication and authorization

Use Better Auth as the server auth engine. Expose the facade below and delegate password/session handling to its supported API; forward Set-Cookie correctly. Do not invent a parallel password database. The Better Auth native handler must not expose bypasses for signup/admission or return a reusable token through an unprotected alternate route. Verify exact facade integration against the pinned package. [Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [sessions](https://better-auth.com/docs/concepts/session-management)

All domain routes require a valid session and enabled internal-access record. `ownerId`, `workspaceId`, provider keys and arbitrary voice IDs are never accepted in user commands. Authenticate first; then scope all identifiers, nested source references and assets to the session owner and project. Foreign IDs return 404. Authenticated disabled accounts receive 403 `ACCESS_DISABLED`; sign-in uses generic errors without revealing allowlist membership.

Initial session configuration: seven-day maximum cookie/session lifetime with server-controlled renewal; disable browser-readable session token caching. Revalidate enabled access on every private request and worker admission. Signing out ends this session and clears client state but does not cancel accepted jobs. Password recovery is operator-assisted; no public reset/signup product. Operator disable/recovery revokes sessions and pauses pending publication.

### Session endpoints

| Endpoint | Request | Response / errors |
|---|---|---|
| POST `/api/session/sign-in` | `{email:string<=254,password:string<=128}` | 200 `SessionView` + Set-Cookie; 401 `INVALID_CREDENTIALS`; 429 with Retry-After. Empty password invalid. Provisioned passwords require at least 12 characters; login does not enforce a new minimum against existing accounts. |
| GET `/api/session` | No body | 200 `SessionView`; 401 if expired/missing |
| POST `/api/session/sign-out` | `{}`; Origin required | 204, expire cookie; idempotent even if already expired |

`SessionView = {user:{id,email,name}, expiresAt, workspaceId, capabilities:{generation:boolean,instagramPublishing:boolean}}`. `workspaceId` equals the user ID, with no workspace switcher. No token/hash/password fields. Invalid email/password and non-provisioned account get the same generic login message. Login throttling: initial 5 failed attempts per 15 minutes per normalized-email hash and 30 per IP hash; configurable. Never log passwords or store raw IPs in rate-limit keys.

Service routes authenticate separately (section 14). A service signature is not a creator's publication approval.

## 4. Shared response and content schemas

Fields below are the complete public minimum contract. Server-only DB fields are intentionally absent. All nested mutation objects reject unknown fields.

### 4.1 Core views

```typescript
type ProjectView = {
  id: string; title: string; revision: number; draftRevision: number; conversationId:string;
  currentStoryboardId: string | null; latestReadyVideoId: string | null;
  selectedVideoId: string | null; activeJobId: string | null;
  flags: {drafts:boolean; ready:boolean; scheduled:boolean; published:boolean; needsAttention:boolean};
  createdAt: string; updatedAt: string;
};
type DraftView = {
  projectId: string; conversationId:string; revision: number; topic: string; audience: string;
  notes: string; voicePreset: string; editablePlan: PlanV2 | null;
  sourceStoryboardId: string | null; contentHash: string;
  validation: {valid:boolean; issues:FieldIssue[]}; updatedAt:string;
};
type StoryboardView = {
  id:string; projectId:string; parentId:string|null; sourceDraftRevision:number;
  state:'review_ready'|'approved'; content:PlanV2; contentHash:string; storyHash:string;
  estimatedDurationSeconds:number; warnings:FieldIssue[];
  changeSummary:string|null; changedSceneIds:string[];
  approvalId:string|null; createdAt:string;
};
type FieldIssue = {path:string; code:string; message:string};
type ApprovalView = {
  id:string; kind:'story'|'video'; subjectId:string; subjectHash:string; approvedAt:string;
};
```

Project metadata revision increments on user metadata commands, not every progress poll. Draft revision increments only on draft mutation. Flags and latest-result pointers may update independently; clients cannot PATCH them. `contentHash` hashes the saved plan/content, not a permission grant. GET draft may contain incomplete narration during editing, with validation issues; approval requires a fully valid plan.

### 4.2 PlanV2 and scene schema

```typescript
type PlanV2 = {
  schemaVersion:2; title:string; audience:string; learningObjective:string;
  language:'en'; voicePreset:string;
  sources:Array<{id:string; kind:'provided_notes'|'illustrative'; text:string}>;
  scenes:SceneV2[];
};
type SceneV2 = {
  id:string; title:string; kicker:string; narration:string;
  pronunciation:Array<{phrase:string; occurrence:number; spokenAs:string}>;
  visual:{component:string; version:number; data:object};
  events:Array<{
    id:string; targetId:string; action:string;
    cue:{phrase:string; occurrence:number; offsetMs:number};
    durationMs:number;
  }>;
  sourceIds:string[];
};
```

Bounds: title 1–100, audience 0–200, learningObjective 1–500 characters; 3–10 scenes (usually 6–10, a safety bound rather than a mandatory creator choice). Scene ID/event ID `^[a-z][a-z0-9-]{0,49}$`; unique within plan/scene respectively. Scene title ≤65, kicker ≤35, narration 20–1,400 characters for approval. Sources ≤20 and combined source text ≤20,000. Per scene ≤20 events, ≤20 pronunciation substitutions; cue/phrase 1–150 characters, occurrence 1–20, spokenAs 1–150, offsetMs -500..500, durationMs 0..3,000. Validate source and target references. Every cue must resolve to the specified occurrence. All computed events must be inside measured scene bounds; offsets never silently clamp inaccurate cues.

`visual.data` is a discriminated, versioned registry schema, not arbitrary JSON accepted by the renderer. GET `/api/capabilities` returns available component IDs/versions and limits. Exact component data schemas and semantic checks are in DB design section 4; both documents require a shared runtime contract package. Missing/disabled component → 422. Factual chart data requires a provided source; illustrative charts are explicitly marked. No user URLs, scripts or CSS are allowed in data.

### 4.3 Job and video views

```typescript
type JobView = {
  id:string; projectId:string; type:'brainstorm'|'storyboard'|'revision'|'generation'|'caption_render'|'voice_change'|'post_caption'|'cleanup';
  state:'queued'|'running'|'cancel_requested'|'cancelled'|'succeeded'|'needs_input'|'failed';
  stage:'queued'|'planning'|'speech'|'compile'|'render'|'validate'|'finalize'|'cleanup';
  revision:number; attempt:number;
  progress:{completedScenes:number|null; totalScenes:number|null; renderPercent:number|null};
  result:JobResult|null; error:OperationError|null; inputRequest:InputRequest|null;
  actions:{cancel:boolean;retry:boolean;regenerate:boolean};
  createdAt:string; updatedAt:string; finishedAt:string|null;
};
type JobResult =
  | {kind:'ideas'; suggestions:Array<{id:string;topic:string;angle:string;takeaway:string}>}
  | {kind:'storyboard';storyboardId:string;requiresApply:boolean}
  | {kind:'video';videoId:string}
  | {kind:'post_caption';text:string;sourceVideoId:string}
  | {kind:'cleanup';externalOutcomePending:boolean};
type InputRequest = {code:string;message:string;sceneIds:string[];candidateStoryboardId:string|null};
type OperationError = {code:string;message:string;retryable:boolean;correlationId:string};
type VideoView = {
  id:string; projectId:string; storyboardId:string; parentVideoId:string|null;
  state:'building'|'validating'|'ready_for_review'|'approved'|'failed';
  renderSpecHash:string; outputHash:string|null; outputAssetId:string|null;
  durationSeconds:number|null; width:1080; height:1920; fps:30;
  voice:{preset:string;label:string;accent:string;testOnly:boolean};
  qa:{passed:boolean;checks:Record<string,boolean>}|null;
  approvalId:string|null; createdAt:string;
};
```

No fictional overall percentage. Percent is 0–100 or null and applies only to measured rendering. `retryable` is not authorization; mutation rechecks state. `needs_input` is terminal for this execution and releases the project slot; correction launches a new job or eligible explicit retry. Cleanup status omits deleted content.

## 5. Projects, drafts and preferences

All responses below are wrapped as section 2 unless 204. **K** means Idempotency-Key required. All GET requests have no body.

| ID / endpoint | Request contract | Success | Specific errors |
|---|---|---|---|
| P01 GET `/api/projects` | limit, cursor, filter | 200 list of ProjectView | INVALID_CURSOR |
| P02 POST `/api/projects` **K** | `{title?:string(1..100)}`; default “Untitled video” | 201 ProjectView; Location project URL; creates blank draft/preferences default snapshot | VALIDATION_FAILED |
| P03 GET `/api/projects/:id` | path ID | 200 ProjectView | NOT_FOUND |
| P04 PATCH `/api/projects/:id` | `{expectedRevision, title?:string(1..100), selectedVideoId?:id}`; at least one change | 200 ProjectView | REVISION_CONFLICT, VIDEO_NOT_READY |
| P05 DELETE `/api/projects/:id` **K** | `{expectedRevision,confirm:true}` | 202 AcceptedOperation with cleanup job | REVISION_CONFLICT |
| P06 GET `/api/projects/:id/draft` | path ID | 200 DraftView | NOT_FOUND |
| P07 PATCH `/api/projects/:id/draft` | `{expectedRevision, changes:{topic?,audience?,notes?,voicePreset?,editablePlan?}}` | 200 DraftView | REVISION_CONFLICT, VOICE_UNAVAILABLE |
| P08 GET `/api/preferences` | none | 200 `{revision,timezone,defaultVoicePreset}` | — |
| P09 PATCH `/api/preferences` | `{expectedRevision,timezone?:IANA,defaultVoicePreset?:string}` | 200 preference view | REVISION_CONFLICT, INVALID_TIMEZONE, VOICE_UNAVAILABLE |
| P10 GET `/api/voices` | none | 200 `{voices:[{preset,label,accent,testOnly,sampleAssetId}],defaultPreset}` | — |
| P11 GET `/api/capabilities` | none | 200 `{planSchemaVersion:2,components:[{id,version}],limits:{minSeconds:60,maxSeconds:90,fps:30,width:1080,height:1920,postCaptionMaxCharacters:number\|null},instagramEnabled:boolean}` | — |

Topic ≤2,000 and notes ≤20,000; empty strings allowed during autosave. Audience ≤200. `editablePlan:null` explicitly clears the working storyboard. Structural validation applies even to drafts; incomplete strings are preserved with issues rather than silently rejected. Malformed arrays, IDs or unsafe data are rejected. Updating topic/notes/voice does not rewrite old approved plans: mark the working plan stale until replanned or explicitly updated/validated. Applying a whole plan checks `voicePreset` agrees with the draft field. A default preference change affects future projects only.

P04 selecting a video requires same owner/project and ready/approved state; it does not approve or schedule it. P05 removes content access at acceptance, cancels unclaimed delivery and queues physical cleanup. Already-submitted publication is reconciled, not claimed cancelled. Repeated deletion with its original key returns its cleanup ID; other content reads return 404.

Example save:

```json
{"expectedRevision":3,"changes":{"topic":"Explain binary search to beginners","audience":"New programmers","voicePreset":"daniel-test"}}
```

Response `data` is DraftView with `revision:4`, saved fields, current validation and a newly computed contentHash. Save conflict example:

```json
{"error":{"code":"REVISION_CONFLICT","message":"This draft changed in another tab.","requestId":"req_example000000002","retryable":false,"details":{"currentRevision":5,"reloadUrl":"/api/projects/prj_example000000001/draft"}}}
```

## 6. Planning, conversation and history

| ID / endpoint | Request contract | Success | Specific errors |
|---|---|---|---|
| S01 GET `/api/projects/:id/messages` | limit,cursor, conversationId required | 200 list `{id,conversationId,sequence,role:'user'\|'assistant',text,sourceStoryboardId,sourceVideoId,jobId,createdAt}` | INVALID_CURSOR, NOT_FOUND |
| S02 POST `/api/projects/:id/brainstorm` **K** | `{expectedDraftRevision,prompt:string(1..2000)}` | 202 job; result 3–5 suggestions or needs_input | PROJECT_BUSY, REVISION_CONFLICT |
| S03 POST `/api/projects/:id/storyboards` **K** | `{expectedDraftRevision}`; saved meaningful topic required | 202 job; result StoryboardView ID | PROJECT_BUSY, INVALID_DRAFT |
| S04 GET `/api/projects/:id/storyboards` | limit,cursor | 200 list StoryboardView summary excluding full content; includes hashes, state, source revision, title, estimate | — |
| S05 GET `/api/storyboards/:id` | path ID | 200 StoryboardView | NOT_FOUND |
| S06 POST `/api/projects/:id/draft/apply` **K** | `{expectedDraftRevision,storyboardId,expectedContentHash}` | 200 DraftView | REVISION_CONFLICT, HASH_MISMATCH |
| S07 POST `/api/projects/:id/draft/restore` **K** | Same as S06; creates working copy from earlier snapshot | 200 DraftView | REVISION_CONFLICT, HASH_MISMATCH |
| S08 POST `/api/projects/:id/revisions` **K** | `{source:{kind:'storyboard'\|'video',id,hash},expectedDraftRevision,instruction:string(1..4000),sceneId?:string}` | 202 JobView reference | SOURCE_CHANGED, PROJECT_BUSY, INVALID_SCENE |

One project conversation is created with the project; its ID is returned in ProjectView and DraftView as `conversationId`. Persist the user message and job acceptance atomically; write one deduplicated assistant result tied to job ID. No model-generated message can issue a publish command.

S03/S08 save immutable candidates. They never silently overwrite edits made while AI ran. UI applies a result with S06 against the revision it currently displays. If that revision no longer matches, show compare/reload. Applying changes the working draft and current selected storyboard pointer; it does not generate audio. Restoring does not undo schedules or delete later versions.

For S08, source.hash is storyboard.contentHash for a storyboard source or video.renderSpecHash for a video source. S08 interpretation is asynchronous. A trusted semantic diff determines result kind: narrative/factual changes yield a storyboard candidate and require story approval; a strictly visual change can inherit prior story approval and yield a new video. Unknown classification returns needs_input. A video-side request never alters the old video's spec. Unsupported duration requests explain the V1 range without accepting an out-of-scope render.

A sample completed storyboard job:

```json
{"data":{"id":"job_example000000001","projectId":"prj_example000000001","type":"storyboard","state":"succeeded","stage":"planning","revision":3,"attempt":1,"progress":{"completedScenes":null,"totalScenes":null,"renderPercent":null},"result":{"kind":"storyboard","storyboardId":"stb_example000000001","requiresApply":true},"error":null,"inputRequest":null,"actions":{"cancel":false,"retry":false,"regenerate":false},"createdAt":"2026-09-26T10:00:00.000Z","updatedAt":"2026-09-26T10:00:12.000Z","finishedAt":"2026-09-26T10:00:12.000Z"},"meta":{"requestId":"req_example000000001"}}
```

## 7. Approval, generation and jobs

| ID / endpoint | Request contract | Success | Specific errors |
|---|---|---|---|
| G01 POST `/api/projects/:id/generations` **K** | `{expectedDraftRevision,expectedContentHash,approve:true}` | 202 AcceptedOperation video/job; atomically snapshots plan + story approval | PROJECT_BUSY, REVISION_CONFLICT, HASH_MISMATCH, INVALID_DRAFT, VOICE_UNAVAILABLE |
| G02 GET `/api/jobs/:id` | owner-only ID | 200 JobView | NOT_FOUND |
| G03 POST `/api/jobs/:id/cancel` **K** | `{expectedRevision}` | 200 JobView; queued may cancel immediately, running → cancel_requested | REVISION_CONFLICT, JOB_TERMINAL |
| G04 POST `/api/jobs/:id/retry` **K** | `{expectedRevision,acknowledgePossibleProviderRepeat?:boolean}` | 202 AcceptedOperation referencing same job, new execution attempt | JOB_NOT_RETRYABLE, PROJECT_BUSY, REVISION_CONFLICT, REPEAT_ACK_REQUIRED |
| G05 POST `/api/videos/:id/regenerate` **K** | `{expectedRenderSpecHash}` | 202 new video/job with same immutable approved inputs | SOURCE_CHANGED, PROJECT_BUSY, VOICE_UNAVAILABLE |
| G06 POST `/api/videos/:id/voice` **K** | `{expectedRenderSpecHash,voicePreset,confirm:true}` | 202 new video/job; explicit configuration approval | SOURCE_CHANGED, PROJECT_BUSY, VOICE_UNAVAILABLE |

G01 resolves provider model and voice server-side and records them. It cannot approve an invalid schematic, missing cue, unresolved content warning requiring user input, stale plan or unsupported component. Successful schema validation is not a fact-checking guarantee. Hash the exact saved content; don't silently fix text during acceptance.

Retry reuses immutable input and verified caches. It cannot mean “rerun with today's model default.” A definite failed render is retryable; an ambiguous speech call requires acknowledgment that provider usage may repeat. Unknown Instagram outcomes are never retried via this endpoint. `needs_input` requiring new narration is fixed through a new draft/generation. G05 is for new output from existing approved inputs, including missing media; it creates a new final-review requirement and never updates a schedule. Changing unavailable provider configuration requires a new explicit reviewable version.

Cancelling a succeeded job returns 409; repeating the original accepted cancel key returns its recorded response. A render that finishes after cancellation cannot become the active ready output. Cleanup jobs cannot be cancelled by users. Jobs return actions to guide UI, but the server always rechecks. After project deletion, G02 exposes only the owning cleanup job’s minimal status; other project jobs return 404. A voice change creates a new storyboard/configuration snapshot and explicit story-configuration approval from confirm:true, rather than modifying the old story hash.

## 8. Videos, captions, approval and media

| ID / endpoint | Request contract | Success | Specific errors |
|---|---|---|---|
| V01 GET `/api/projects/:id/videos` | limit,cursor | 200 list VideoView | — |
| V02 GET `/api/videos/:id` | none | 200 VideoView | NOT_FOUND |
| V03 GET `/api/videos/:id/captions` | none | 200 `{videoId,renderSpecHash,scenes:[{sceneId,speechFingerprint,captions:[{id,sourceStart,sourceEnd,text,startFrame,endFrame}]}]}` | VIDEO_NOT_READY |
| V04 PATCH `/api/videos/:id/captions` **K** | `{expectedRenderSpecHash,overrides:[{sceneId,speechFingerprint,sourceStart,sourceEnd,displayText}]}` | 202 new video/job | SOURCE_CHANGED, CAPTION_MEANING_CHANGE, INVALID_SPAN, PROJECT_BUSY |
| V05 POST `/api/videos/:id/approve` **K** | `{expectedOutputHash,expectedRenderSpecHash,approve:true}` | 200 ApprovalView; video approved | VIDEO_NOT_READY, HASH_MISMATCH |
| V06 POST `/api/assets/:id/access` | `{purpose:'preview'\|'download'}` | 200 `{url,expiresAt,contentType,bytes}` | ASSET_NOT_READY, NOT_FOUND |

Caption spans are half-open Unicode code-point offsets `[sourceStart,sourceEnd)` in the scene's original narration; not JavaScript UTF-16 indices. Times are local scene frames at 30 fps. Display changes retain mapping to original speech. Maximum 100 overrides/video, 200 characters/override; no overlapping spans, unknown scenes, or mismatched speech fingerprints. Server can regroup/reflow captions without changing speech timing. Semantic changes return an instruction to revise narration. Size and line limits are also checked by actual font measurement before Ready.

V05 explicitly approves the bytes shown in the player. ApprovalView.subjectHash is SHA-256 of canonical `{outputHash,renderSpecHash}` for kind video; for kind story it is the storyboard storyHash. Download of a validated ready-for-review video is allowed without final publication approval; Post now/Schedule requires approval. Later versions require their own final approval even when story approval is inherited.

V06 creates a short-lived (initially 10-minute) revocable bearer URL at the media gateway. Do not store it as a permanent DB URL. The user must own the asset through an undeleted project; public sample assets are restricted to the configured sample catalog. Expired grant refresh does not restart generation. Raw R2 keys, credentials and alignment download URLs are not returned by ordinary video reads.

Gateway `GET|HEAD /media/:grantToken` supports one byte range with 200/206, appropriate Content-Length, Content-Type, Accept-Ranges and Content-Range; malformed/multiple/unsatisfiable ranges return 416. Expired/revoked/unknown grants return generic 404. Authorization is rechecked for each request. Download uses safe Content-Disposition filename; previews use inline. `Referrer-Policy: no-referrer`, `Cache-Control: private,no-store`. Revocation cannot recall bytes already delivered or stop every in-flight stream.

## 9. Instagram connection

| ID / endpoint | Request | Success | Specific errors |
|---|---|---|---|
| I01 POST `/api/instagram/connect` | `{returnProjectId?:id}`; Origin required | 200 `{authorizationUrl,expiresAt}` | INTEGRATION_UNAVAILABLE |
| I02 GET `/api/instagram/callback` | Provider query `code,state` OR `error,state`; no JSON body | 303 to server-generated relative return route with opaque outcome; Set-Cookie only if auth requires | Reject missing/expired/replayed/mismatched state; no token/query error echo |
| I03 GET `/api/instagram/connection` | none | 200 ConnectionView or data:null | — |
| I04 DELETE `/api/instagram/connection` **K** | `{expectedRevision,confirmPausePending:true}` | 200 `{connection:ConnectionView,pausedIntentCount,reconciliationPending:boolean}` | REVISION_CONFLICT |

`ConnectionView = {id,revision,state:'connected'|'expiring'|'reconnect_required'|'disconnected',account:{id,username,type:'BUSINESS'|'CREATOR'}|null,destinationEpoch,expiresAt:string|null,publishingAvailable:boolean,pendingIntentCount:number}`. No token, scopes secret material or app credentials in response.

OAuth state is random, session-bound, single use, ten-minute validity. Cancellation returns to the preserved publish page. Missing session means restart Connect after login; do not attach an account from an unbound callback. A connection owned elsewhere yields a generic conflict; do not identify its owner. Different-account reconnect pauses old intents and changes destination epoch; same-account refresh cannot silently change approved destination. If an old account has an unresolved submitted publication, reject switching with CONNECTION_RECONCILIATION_PENDING until its outcome is resolved; preserve the old reconciliation credentials. Disconnect prevents new publication but reconciliation of already-submitted work continues.

Internal testing still requires eligible professional accounts and configured Meta access. Do not expose raw provider auth URLs supplied by clients or arbitrary callback redirects. Exact upstream version/permissions and token refresh rules are adapter configuration verified during implementation, not client inputs.

## 10. Post captions, publishing and scheduling

### 10.1 Shared types

```typescript
type Destination = {connectionId:string; instagramUserId:string; destinationEpoch:number};
type ScheduleInput = {localTime:string; timezone:string; utcOffset:string};
// localTime: YYYY-MM-DDTHH:mm; timezone: IANA; utcOffset: +05:30, -04:00, etc.
type PublishPayloadInput = {
  videoId:string; videoApprovalId:string; expectedOutputHash:string;
  destination:Destination; caption:string;
};
type PublishIntentView = {
  id:string; projectId:string; revision:number; state:PublishState;
  payloadId:string; payloadHash:string; videoId:string; assetHash:string;
  destination:Destination & {usernameAtApproval:string}; caption:string;
  schedule:{scheduledAtUtc:string;localTime:string;timezone:string;utcOffset:string}|null;
  publishedAt:string|null; providerMediaId:string|null; permalink:string|null;
  error:OperationError|null;
  actions:{edit:boolean;cancel:boolean;retry:boolean;reconnect:boolean};
  createdAt:string; updatedAt:string;
};
type PublishState = 'scheduled'|'queued'|'claimed'|'preparing'|'processing'|'submitting'|
 'published'|'paused_auth'|'failed_safe'|'outcome_unknown'|'needs_attention'|'cancelled';
```

All times are server-validated. Schedule conversion rejects a nonexistent local time. For repeated local times the supplied offset must select a valid occurrence; if missing/invalid, return `422 AMBIGUOUS_LOCAL_TIME` with valid offsets. `utcOffset` is required even outside DST to make confirmation unambiguous. Minimum lead time is five minutes at server acceptance. API never guesses browser timezone; the UI uses preference → browser → Asia/Kolkata. A minute-based scheduler starts delivery near the requested time; Meta processing can delay visibility.

### 10.2 Endpoints

| ID / endpoint | Request contract | Success | Specific errors |
|---|---|---|---|
| U01 POST `/api/projects/:id/post-caption` **K** | `{videoId,expectedOutputHash,instruction?:string<=1000}` | 202 job; suggestion never edits an existing intent | VIDEO_NOT_READY, PROJECT_BUSY |
| U02 POST `/api/publish-intents` **K** | `{projectId,payload:PublishPayloadInput,mode:'now'\|'schedule',schedule?:ScheduleInput,confirm:true,repostOfIntentId?:id}` | 201 PublishIntentView + Location; queued or scheduled | VIDEO_NOT_APPROVED, DESTINATION_CHANGED, RECONNECT_REQUIRED, ALREADY_PUBLISHED, INVALID_SCHEDULE |
| U03 GET `/api/projects/:id/publish-intents` | limit,cursor | 200 list PublishIntentView | — |
| U04 GET `/api/publish-intents/:id` | none | 200 PublishIntentView | NOT_FOUND |
| U05 PATCH `/api/publish-intents/:id` **K** | `{expectedRevision,payload:PublishPayloadInput,mode:'now'\|'schedule',schedule?:ScheduleInput,confirm:true}`; full replacement, not partial payload | 200 PublishIntentView; new payload ID/revision | INTENT_ALREADY_CLAIMED, REVISION_CONFLICT, VIDEO_NOT_APPROVED, DESTINATION_CHANGED |
| U06 POST `/api/publish-intents/:id/cancel` **K** | `{expectedRevision}` | 200 PublishIntentView | INTENT_ALREADY_CLAIMED, REVISION_CONFLICT, OUTCOME_UNKNOWN |
| U07 POST `/api/publish-intents/:id/retry` **K** | `{expectedRevision,confirm:true}` | 200 PublishIntentView; queued/scheduled only if safe and within window | OUTCOME_UNKNOWN, RETRY_WINDOW_EXPIRED, RECONNECT_REQUIRED, INTENT_NOT_RETRYABLE |

Caption is plain text, may be empty only if current configured Meta validation allows it, and is bounded by the server's versioned provider constraint (initial application ceiling 2,200 code points, never more than live provider allows). Clients read capabilities and handle 422; no silent truncation. `schedule` required only for mode schedule and forbidden for now. `projectId` must match the pinned video and approval. The server obtains assetId from the approved video, never from user-selected media URLs.

Example schedule request (illustrative hashes, not a live approval):

```json
{
  "projectId":"prj_example000000001",
  "payload":{
    "videoId":"vid_example000000001",
    "videoApprovalId":"apr_example000000001",
    "expectedOutputHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "destination":{"connectionId":"igc_example000000001","instagramUserId":"17841400000000000","destinationEpoch":1},
    "caption":"Binary search, explained one step at a time."
  },
  "mode":"schedule",
  "schedule":{"localTime":"2026-09-28T18:00","timezone":"Asia/Kolkata","utcOffset":"+05:30"},
  "confirm":true
}
```

Response is PublishIntentView with `state:"scheduled"`, revision 1 and `scheduledAtUtc:"2026-09-28T12:30:00.000Z"`. Return exact displayed payload/account identity so the UI can show the user's approved selection.

### 10.3 Publication safety semantics

A duplicate unresolved video/account/content payload returns the existing intent (200, `deduplicated:true` in meta), even under a different key. Conflicting schedule for that same payload returns `409 PUBLISH_INTENT_EXISTS` with the existing owner-visible ID; use U05 explicitly. After successful publication, the same payload requires `repostOfIntentId` pointing to that published intent and a new user confirmation. Generic retries never create reposts.

Cancel/update races use state+revision CAS. Once a worker claims the intent, editing/cancellation returns conflict; UI must not promise cancellation. The claim also rechecks destination epoch, connection, tombstone, approval and asset hash. Reconnection to another account requires an explicitly confirmed replacement. Auto-refresh of credentials is not a new destination approval.

At most 15 minutes of lateness/retry from intended start; “now” uses acceptance time. Once expired before submission, require U05 with a new time/explicit now approval. Reconciliation continues beyond the window if a publish request was already attempted. Unknown outcome → no U07, no reschedule/replacement of that unresolved intent, and no automatic second publish call. Return `OUTCOME_UNKNOWN` with a plain explanation and status polling path.

## 11. Error catalog and client behavior

```json
{
  "error":{
    "code":"VALIDATION_FAILED",
    "message":"Please correct the highlighted fields.",
    "requestId":"req_example000000001",
    "retryable":false,
    "fieldErrors":[{"path":"changes.topic","code":"TOO_LONG","message":"Use at most 2,000 characters."}]
  }
}
```

`details` is an allowlisted object, never a raw provider error. Authentication, ownership and error redaction apply before providing IDs. Global errors apply to every endpoint even if not repeated in tables.

| HTTP | Codes | UI behavior |
|---|---|---|
| 400 | MALFORMED_JSON, INVALID_CURSOR, INVALID_QUERY | Fix request/restart listing; no blind retry |
| 401 | UNAUTHENTICATED, SESSION_EXPIRED, INVALID_CREDENTIALS | Sign in; preserve user-local unsaved state only for same user |
| 403 | ACCESS_DISABLED, ORIGIN_NOT_ALLOWED | Explain access/reload; never infer existence of foreign data |
| 404 | NOT_FOUND | Generic missing/inaccessible/deleted resource |
| 409 | REVISION_CONFLICT, SOURCE_CHANGED, HASH_MISMATCH | Refetch and review before resubmitting |
| 409 | IDEMPOTENCY_KEY_REUSED, COMMAND_IN_PROGRESS | Reuse original body/key or wait; never invent a second operation to bypass |
| 409 | PROJECT_BUSY, INTENT_ALREADY_CLAIMED | Observe active operation |
| 409 | OUTCOME_UNKNOWN, ALREADY_PUBLISHED, PUBLISH_INTENT_EXISTS | Observe/reconcile, or explicitly approve a distinct repost |
| 413 | PAYLOAD_TOO_LARGE | Shorten input |
| 415 | UNSUPPORTED_MEDIA_TYPE | Use JSON; uploads are out of scope |
| 422 | VALIDATION_FAILED, INVALID_DRAFT, INVALID_SCENE, INVALID_SPAN, INVALID_TIMEZONE, INVALID_SCHEDULE, AMBIGUOUS_LOCAL_TIME, NONEXISTENT_LOCAL_TIME | Correct specific fields |
| 422 | VOICE_UNAVAILABLE, VIDEO_NOT_READY, VIDEO_NOT_APPROVED, ASSET_NOT_READY, CAPTION_MEANING_CHANGE | Complete prerequisite or revise |
| 409 | DESTINATION_CHANGED, RECONNECT_REQUIRED, CONNECTION_RECONCILIATION_PENDING, REPEAT_ACK_REQUIRED, RETRY_WINDOW_EXPIRED, JOB_NOT_RETRYABLE, JOB_TERMINAL, INTENT_NOT_RETRYABLE | Explicit review/reconnection/safe action, not blind retries |
| 429 | RATE_LIMITED | Honor Retry-After seconds |
| 503 | INTEGRATION_UNAVAILABLE, SERVICE_UNAVAILABLE | Retry same accepted-operation key after recovery |
| 500 | INTERNAL_ERROR | Show request ID, refetch before repeating mutation |

Provider failures after acceptance appear in JobView/PublishIntentView with HTTP 200 on GET, not as a misleading transport failure. Job error codes include PROVIDER_AUTH, PROVIDER_QUOTA, PROVIDER_TEMPORARY, PROVIDER_REJECTED, PROVIDER_OUTCOME_UNKNOWN, INVALID_ALIGNMENT, DURATION_OUT_OF_RANGE, UNSUPPORTED_VISUAL, LAYOUT_OVERFLOW, RENDER_FAILED, ASSET_MISSING and OUTPUT_INVALID. Codes describe actionable categories without exposing notes or credentials.

Initial planning command limit: ten/user/minute plus project/worker concurrency controls. Job polling limit: 60/user/minute; client coalesces tabs and backs off on 429. Media grant creation: 30/user/minute. Thresholds are deployment config, not a credit system. Successful/error rate-limit responses may expose `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` in seconds; Retry-After is authoritative for retry timing.

## 14. Internal interfaces

These are not endpoints available to ordinary sessions.

| Interface | Authentication and request | Result |
|---|---|---|
| `/api/inngest` | Official signed Inngest handler with pinned SDK; event body `{eventId,jobId}` or `{eventId,intentId}` only | SDK-defined transport; domain idempotency still required |
| POST `/api/internal/media-authorize` | Service HMAC over method/path/body digest/timestamp/nonce; ≤30s clock skew; reject reused nonce. Body `{token,method:'GET'\|'HEAD',range?:string}` | 200 `{objectKey,contentType,bytes,disposition}` or generic 404; never arbitrary object-key lookup |
| Render input/output | Attempt-bound one-object grants, deadline and fencing token; trusted build only | Attempt-specific result manifest with hashes, bytes, QA, build ID; supervisor validates before Ready |
| Operator diagnostics | Authenticated CLI under operator credentials, not user API | Provision/reset users, record verified external outcome, inspect redacted job state; audited |

Store service replay nonces with a short TTL, but check expiry synchronously. Deny public CORS on internal routes. Restrict gateway credentials to this route. No generic endpoint accepts `ownerId` + arbitrary service command. The gateway grant's owner is loaded from persistence. Raw media tokens must not appear in application/access logs.

## 15. End-to-end client examples and acceptance

**Create:** sign in → P02 → P07 → S03 → poll G02 → S05 → S06 → G01 → poll G02 → V02 → V06. All approval commands wait for successful autosave. Display human stage names, not infrastructure names.

**Revise:** S08 against visible source hash → poll → if storyboard candidate, S06 + G01; if visual-only video, V02 after completion. Previous output remains downloadable. Apply never auto-publishes.

**Publish:** V05 exact output → I03 (Connect if needed) → optional U01 → U02 explicit confirmation → U04. Disconnecting does not disable download. Final approval can be integrated into “Continue to publish” without another screen.

**Reconnect after session expiry:** GET session → login → reload project/job/intent IDs → reconcile. Never resubmit Generate/Post merely because the browser lost its response.

Before implementation completion, contract tests must cover every endpoint's success envelope, malformed/extra-field input, auth/foreign-ID denial, pagination, CAS conflict, idempotency replay, and deleted-parent behavior. Add race tests for generation/cancel, publish claim/cancel and account replacement. Test HTTP Range playback and grant expiry on desktop/mobile. Generate a machine-readable OpenAPI specification from the implemented shared Zod schemas and verify it against these named contracts before exposing the dashboard API; this Markdown document does not claim that specification or routes already exist.

## 16. PRD traceability and Stitch handoff

| Requirement | API sections |
|---|---|
| FR-01 accounts | 3, 5, 14 |
| FR-02 ideas | 5–6 |
| FR-03 storyboard | 4.2, 6–7 |
| FR-04 duration | 4.2, 7, 13 |
| FR-05 motion | 4.2, capabilities |
| FR-06 narration | 5 voices, G06 |
| FR-07 captions | 8 |
| FR-08 revisions | 6–8 |
| FR-09 jobs | 2.4, 7, 13 |
| FR-10 export | 8 |
| FR-11 connection | 9 |
| FR-12 publishing | 10 |
| FR-13 schedules | 10 |
| FR-14 autosave/deletion | 2.4, 5 |

Stitch designs should include empty project library, saving/unsaved/conflict states, planning, storyboard candidate comparison, unavailable voice, real generation stages, previous output during revision, ready preview, connection cancellation, schedule confirmation with timezone, paused authorization, and unknown publication outcome. UI may reorganize presentation but must not hide approvals, pretend uncertain publication failed safely, or invent unavailable actions. API changes discovered during design are reviewed in both this document and the database contract before coding.
