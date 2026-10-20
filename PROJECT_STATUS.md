# Project Status — NamasteVideo.ai

Last updated: October 19, 2026 (Asia/Kolkata).

This is the source of truth for development progress. Specifications describe intent; a feature is complete here only when its implementation and verification are recorded. Design approval is not evidence of working functionality.

## Current checkpoint

**F19 — Reviewed Post now flow: Done.** The Publish step posts an approved video with a reviewed caption to the connected account and protects against duplicate or uncertain posts. First real end-to-end run on October 20, 2026: real ElevenLabs narration → local render → approval → Reel published to the user's Instagram account. Next feature: F20, scheduling and schedule management (not started).

F14 — Rendering integration (local renderer, option A): Done (evidence below).

F13 — Durable generation job orchestration: Done (evidence below).

F12 — Private R2 asset adapter and media access: Done (evidence below).

F11 — Conversational storyboard revisions and approval: Done (evidence below).

F10 — Combined storyboard/script review UI: Done (evidence below).

F09 — Storyboard generation backend: Done (evidence below).

F08 — Idea and brainstorming UI/integration: Done (evidence below).

F07 — Idea draft API, autosave and conflict handling: Done (evidence below).

F06 — My videos library UI: Done (evidence below).

F05 — Personal project create/list/rename/delete APIs: Done (evidence below).

F04 — Sign-in/recovery UI and private route protection: Done (evidence below).

F03 — Internal account admission and session backend: Done (evidence below).

F02 — MongoDB adapter, schema validation and initial indexes: Done (evidence below).

F01 — Application scaffold: Done (evidence below).

No application authentication, persisted projects, hosted rendering or Instagram integration exists yet. The local video pipeline predates the application and remains separately usable.

## How this document is maintained

1. Before coding, select one feature below and mark it In progress; identify its acceptance criteria.
2. Implement that feature without silently starting unrelated features.
3. Run relevant checks and record commands, results, date, and practical limits. Link files/artifacts rather than treating this document alone as proof.
4. Mark Done only when its acceptance criteria pass. Use Partial or Blocked when appropriate and explain what remains. Append the feature entry before reporting completion.
5. Update this document in the same change as every code/configuration addition or modification, including fixes to completed features. Keep the feature table and checkpoint consistent.
6. Commit and push each completed development step/milestone to [akshaymarch7/namaste-video-ai](https://github.com/akshaymarch7/namaste-video-ai). Verify the remote commit, and report any blocked/unpushed work. This is a standing user instruction, also recorded in AGENTS.md. Exclude credentials, generated video/audio, dependencies and build output.

Repository contributors follow this workflow through AGENTS.md. No external automation is implied; the document must be updated during development.

## Feature backlog — build in order

| ID | Small feature | Status | Completion evidence required |
| --- | --- | --- | --- |
| F00 | Local idea-to-video proof of concept | Done (local prototype) | Existing three narrated exports and recovery reports; see PROTOTYPE_STATUS.md |
| F01 | Next.js workspace, Cinema tokens, primitives and app boundary | Done | Production build; both TypeScript checks; 23 existing tests; desktop/mobile route smoke checks; root media inaccessible — evidence below |
| F02 | MongoDB adapter, schema validation and initial indexes | Done | Isolated development DB connection; idempotent setup; index/schema checks; fail clearly without configuration |
| F03 | Internal account admission and session backend | Done | Better Auth, provision approved users, no public signup, login/logout and disabled-user tests |
| F04 | Sign-in/recovery UI and private route protection | Done | Approved sign-in flow; generic errors; expired session; private pages inaccessible anonymously |
| F05 | Personal project create/list/rename/delete APIs | Done | Ownership isolation, validation, pagination and deletion behavior tested |
| F06 | My videos library UI | Done | Real project data, filters, load more, empty/loading/error states and rename/delete dialogs |
| F07 | Idea draft API, autosave and conflict handling | Done | Persist topic/notes/voice; revisions; failed saves preserve input; cross-user checks |
| F08 | Idea and brainstorming UI/integration | Done | Save real idea; Gemini topic suggestions; use suggestion; available voice preview |
| F09 | Storyboard generation backend | Done | Validated scene contract, saved version, bounded repair and recoverable failure |
| F10 | Combined storyboard/script review UI | Done | Schematic scene cards, editable narration/on-screen text and estimates |
| F11 | Conversational storyboard revisions and approval | Done | Changed scenes, restore, stale-result handling, immutable approved version |
| F12 | Private R2 asset adapter and media access | Done | Private upload/read, owner-authorized access, expiry and missing-asset behavior |
| F13 | Durable generation job orchestration | Done | Inngest integration, one active job, deduplication, progress and cancellation |
| F14 | Rendering integration (local renderer; hosted adapter later) | Done — local | Approved storyboard to validated MP4; resource/runtime benchmark; previous version retained |
| F15 | Video review, approval and download UI | Done | Actual media playback, version selection, exact-version approval and export |
| F16 | Caption and video revision flow | Done | Caption edits rerender; spoken changes return to storyboard; preserved previous output |
| F17 | Personal preferences UI/API | Done | Timezone and future-project voice persisted without changing existing projects |
| F18 | Personal Instagram authorization | Done | Official connect/callback, eligibility, reconnect/disconnect and owner isolation |
| F19 | Reviewed Post now flow | Done | Exact asset/account/caption; confirmed publication; duplicate/unknown-outcome protection |
| F20 | Scheduling and schedule management | Planned | Timezone/DST/lead-time validation; durable dispatch; cancel/replace/reconnect races |
| F21 | Full Cinema homepage and cross-device polish | Planned | Complete approved homepage, deliberate hero motion, mobile/a11y review and real example playback |
| F22 | Internal end-to-end acceptance and deployment | Planned | Two-user isolation, outage/recovery checks, generation benchmarks, Meta test posts; deployment separately reviewed |

Infrastructure blockers are recorded against the affected feature. Do not move billing, public signup, teams or brand kits into V1 implicitly.

## F01 — implementation record

Scope: a runnable web application foundation, not the complete homepage or dashboard.

- `apps/web`: isolated npm workspace using Next.js App Router 16.3.8, React/React DOM 19.3.0, strict TypeScript, root layout and metadata.
- `apps/web/app/globals.css`: approved neutral Cinema tokens, responsive layout, visible focus, reduced-motion handling, shared control and panel styles.
- `apps/web/components/ui.tsx`: Brand, Shell, ActionLink and Button primitives.
- `/`: scaffold preview with the approved brand direction and a static story illustration; links to `/foundation`.
- `/foundation`: development specimens for colors, typography, controls and feedback; input is explicitly not saved. No false login or generation controls.
- Generic not-found and route error boundaries. Routes are public, contain no account data, and carry noindex metadata; noindex is not authentication.
- Local Fontsource packages serve fonts without build-time Google Fonts requests.
- `.nvmrc` selects Node 24.21.0. Host initially reports Node 25.2.1; all verification commands ran under Node 24.21.0.
- Root scripts delegate web dev/build/start to the workspace. Prototype dependencies and source are retained. Web React is separately versioned from prototype React 19.2.0.
- Root `public/runs` and `runs` are outside the Next.js app root. Never symlink them into the web app or use the root as a public server directory.
- Root `.env.local` remains prototype-only. No credentials were read or copied. Future web secrets belong in ignored `apps/web/.env.local`.

Architecture adjustment: SYSTEM_DESIGN.md's logical web `app/` and `components/` directories are located under `apps/web/` to isolate web static assets and runtime dependencies from the working Remotion prototype. The service/API design is unchanged.

### Verification

Verified October 1, 2026, locally:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Runtime | `npm exec --yes --package=node@24.21.0 -- node --version` | v24.21.0 |
| Types and regression tests | `npm exec --yes --package=node@24.21.0 -- npm run check` | Prototype TypeScript, web TypeScript and all 23 existing tests passed |
| Production build | `npm exec --yes --package=node@24.21.0 -- npm run build` | Passed; `/`, `/foundation` and not-found routes generated |
| Production HTTP checks | [Recorded responses](design/verification/f01-http-checks.json) against `npm start` | `/` and `/foundation` return 200; unknown route, `/.env.local` and prototype MP4 path return 404; noindex present |
| Desktop UI | [Screenshot](design/verification/f01-desktop.png) | Cinema palette and two-column hero inspected; foundation link navigates correctly |
| Mobile UI, 390 × 844 viewport | [Home](design/verification/f01-mobile.png), [foundation](design/verification/f01-foundation-mobile.png) | Stacked layouts inspected; document width 375px within 390px viewport; no horizontal overflow; home link works |
| Browser console | Production preview after navigation and responsive checks | No captured warning/error entries |

The host Node 25 installation emitted the expected Node 24 engine warning; the commands above explicitly used the selected Node 24 runtime. No new paid API calls, video renders, external publication or deployment were performed. Existing pipeline tests validate local behavior, not live provider availability.

### Remaining limitations

- No database, auth, sessions, save operations, AI calls or media integrations in the web app.
- Homepage illustration is static; full homepage and motion are F21.
- The UI foundation page is a development specimen; it will be gated/removed before internal deployment.
- Error UI is present; failure injection verification is deferred until real server operations exist.

## F19 — implementation record

Scope: reviewed **Post now** to the connected Instagram account (screens 12 / 26 Post-now parts): exact asset/account/caption, confirmed publication, duplicate and unknown-outcome protection. Scheduling and payload replacement (U05) are F20; AI caption suggestions (U01) are not built.

- U02 `POST /api/publish-intents` (Idempotency-Key; `server/publish/service.ts`): `{projectId, payload:{videoId, videoApprovalId, expectedOutputHash, destination:{connectionId, instagramUserId, destinationEpoch}, caption}, mode:"now", confirm:true, repostOfIntentId?}`. Checks the live owned project, the video's own final approval and output hash (`422 VIDEO_NOT_APPROVED`, `409 HASH_MISMATCH`), the ready output asset, a healthy connection (`409 RECONNECT_REQUIRED`) with the same connection/account/epoch (`409 DESTINATION_CHANGED`), plain-text caption ≤ 2,200 code points, and that publishing is available (`503 PUBLISHING_UNAVAILABLE`). `mode:"schedule"` → `422 INVALID_SCHEDULE` until F20. Freezes a payload (asset, hashes, account and `usernameAtApproval`, caption, approver/time, `payloadHash`, `contentKey`) and a queued intent (`dueAt` now, 15-minute `retryDeadlineAt`) with a `publish.requested` outbox event in one transaction. The same unresolved video/account/caption returns the existing intent (200, `X-Deduplicated`), including under a concurrent unique-index race; after publication the same payload is `409 ALREADY_PUBLISHED` unless `repostOfIntentId` names that post.
- U03 `GET /api/projects/:id/publish-intents` (signed cursor), U04 `GET /api/publish-intents/:id`: PublishIntentView with actions (cancel/retry/reconnect); no tokens or grant URLs.
- U06 `POST …/cancel` and U07 `POST …/retry` (Idempotency-Key, revision CAS, only while unclaimed and before the submission barrier): cancel resolves queued/failed/paused/needs-attention posts; `OUTCOME_UNKNOWN` and `INTENT_ALREADY_CLAIMED` otherwise. Retry re-queues safe failures within the 15-minute window (`RETRY_WINDOW_EXPIRED` after), requires the same healthy account for paused posts (`RECONNECT_REQUIRED`).
- Delivery (`server/publish/delivery.ts`, SYSTEM_DESIGN 12.3): each step claims the intent under a lease and persists its result. Pre-barrier rechecks (deleted project → cancelled; approval/asset → failed_safe; account/epoch/token → paused_auth; window → needs_attention; no public media origin → failed_safe). Creates an attempt, a dedicated 6-hour `ingest` media grant scoped to intent/attempt, and the Reel container (`POST /{ig-user-id}/media`, `media_type=REELS`, caption, `share_to_feed`); polls `status_code`; publishes only when FINISHED and still inside the window, after persisting `submissionBarrier` + attempt `request_started`. Success stores media ID, publish time and permalink (`GET /{media-id}?fields=permalink`), resolves the intent and revokes grants. A definite rejection that the container confirms → safe retry; any uncertain response → `outcome_unknown`, reconciled from the saved container (FINISHED/ERROR/EXPIRED → failed_safe with retry; PUBLISHED without a media ID → needs_attention, blocks reposting; still unknown after 24 h → needs_attention). Reconciliation never calls publish.
- Workers: Inngest `publish-intent` (event, per-intent concurrency 1, polls every 10 s for up to 10 minutes) and the minute `scan-publish-intents` cron (due, processing, unknown and stale claims).
- Instagram publishing adapter (`InstagramPublisher` in `server/instagram/provider.ts`, Graph `v23.0`, Bearer token).
- Public media link for Instagram (`apps/web/scripts/media-tunnel.mjs`, `npm run media-tunnel`): a local proxy that forwards only `GET/HEAD /api/media/<43-char token>` (no query strings, allowlisted headers, no cookies either way) behind a Cloudflare quick tunnel (`cloudflared`); the link is written to `apps/web/.runtime/media-origin` (0600, gitignored) and removed on exit. `MEDIA_PUBLIC_ORIGIN` can set a fixed origin instead. Without either, posting is shown as unavailable.
- UI: Publish step `/projects/:id/publish` (stepper link once a version is approved; "Approve & continue to publish" and "Continue to publish →" go there): approved-version select with player, connected account, caption (prefilled with the storyboard title) with counter, **Review post…** confirmation (video version, account, caption) → **Post now**; live status card polling every 3 s (15 s while checking an unknown outcome) with plain-language states, View on Instagram, Retry, Cancel/Dismiss, Settings for paused posts; earlier posts list; explicit **Post it again** after an `ALREADY_PUBLISHED` refusal.

### Verification

Verified October 20, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 147 web tests (+6 publishing) passed |
| Publishing contract (fake publisher) | `tests/publish.test.ts` | Validation before freezing (schedule, wrong approval, hash, epoch, caption length/control chars, confirm, foreign project, no media origin, reconnect needed; nothing stored); payload freeze, outbox, key replay and cross-key dedup; container from the public origin + ingest grant serving the approved MP4; IN_PROGRESS → FINISHED → published once with media ID/permalink; grant revoked; never reprocessed; ALREADY_PUBLISHED and explicit repost; list; foreign 404; no token/grant leak. Uncertain publish → outcome_unknown, cancel/retry refused, no duplicate post; reconcile keeps checking, FINISHED → safe retry without calling publish; explicit retry uses a new container (2 publish calls total). PUBLISHED-after-uncertain → needs_attention, no repost. Media rejected → cancel; disconnected → paused_auth, retry needs the same account; expired window → retry refused. Three concurrent workers → one container; minute scanner publishes |
| Build | `npm run build` | Passed; publish routes and page present |
| Real browser with a **real render** (silent narration, real R2, production build, temporary database, fake publisher driven from the server) | scripted CDP run | Video page "Continue to publish →" and stepper Publish link; Publish shows "Version 1 · 1:19 · approved", "@namaste_test · Creator account", caption prefilled, player plays 79 s; confirmation lists version/account/caption; Post now → "Sending the video to Instagram…", Review disabled while active. First delivery without a public origin → "Not posted — Instagram can’t reach the video right now…"; **Retry posting** → delivery: ingest grant served `video/mp4` 4,567,237 bytes → page updates by polling to "Posted to Instagram ✓" with View on Instagram; repost of the same caption → refusal + "Post it again" → new post; no overflow at 390 px; no console errors |
| Media-only tunnel proxy (stand-in `cloudflared`, real app) | curl | Origin file written (mode 600) and removed on stop; valid token GET 200 `video/mp4` 4,567,237 bytes and Range 206; unknown token 404; sign-in page, API, POST and query strings 404; no Set-Cookie returned |
| **First real end-to-end run** (user's account, `https://localhost:3000`, Inngest dev server, `npm run media-tunnel` with `cloudflared` 2026.10.1) | User approved the storyboard, video and post in the UI | Real ElevenLabs narration for 6 scenes (≈1,090 characters, Daniel test voice) → local render (81.5 s, 4,665,171 bytes, all QA checks) → approved → Post now → Reel published (media ID and `instagram.com/reel/…` permalink stored), exactly one publish attempt (`confirmed`). Live Graph `v23.0` container/status/publish/permalink calls and Instagram fetching the MP4 through the media-only tunnel worked |
| **Bug found and fixed during the real run** | Inngest job runner | Durable steps memoize results as JSON, so `qa.checkedAt` reached finalize as a string; the videos validator rejected the update and the job stayed "running" after 3 retries. Fixed: finalize normalizes QA dates; the render stage's re-entry path re-checks QA from the stored MP4; `run-job` now has an `onFailure` handler (`abandonGeneration`) that turns an exhausted video job into a retryable `WORKER_FAILED` failure. The stuck job was marked failed and the user's Retry finished it reusing all narration and the stored render (no new ElevenLabs usage, no re-render). New tests: memoized-JSON step retry and abandon → retry reusing the render (16 generation tests). Also: tests now ignore a locally running tunnel (`MEDIA_ORIGIN_FILE=""` in the harness); `npm run check` passes with 23 prototype + 149 web tests |
| Visual review | [Publish](design/verification/f19-publish.png), [confirm](design/verification/f19-confirm.png), [sending](design/verification/f19-sending.png), [not posted](design/verification/f19-not-posted.png), [published](design/verification/f19-published.png), [repost](design/verification/f19-repost.png), [mobile 390px](design/verification/f19-mobile.png) | Inspected |
| R2 cleanup | cleanup worker on the test project | 14 of 14 test objects removed |

No ElevenLabs or Gemini usage. **Nothing was posted to Instagram** (all deliveries used the fake publisher). No deployment or Git commit (user direction).

### Remaining limitations

- Real posting needs `npm run dev`, `npm run dev:inngest` and `npm run media-tunnel` running locally; the tunnel is stopped between test sessions. Instagram's daily publishing limit has not been reached or measured.
- Scheduling, changing a queued post (U05) and AI caption suggestions (U01) are not built (F20 covers scheduling).
- "Published but link unavailable" without a media ID is shown as needs-attention; there is no operator tool yet to record verified evidence.
- Quick-tunnel links change on every run and depend on Cloudflare's free service; hosting (F22) replaces them.

## F18 — implementation record

Scope: personal Instagram authorization with Instagram API with Instagram Login (official connect/callback, eligibility, reconnect/disconnect, owner isolation, token refresh). Publishing itself is F19/F20; `publishingAvailable` is true only when connected and a public media link is configured (F19).

- Configuration (`server/instagram/config.ts`, server-only, `apps/web/.env.local`): `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` (must be HTTPS and exactly match the Meta dashboard), `INSTAGRAM_TOKEN_KEY` (32 random bytes, hex), optional `INSTAGRAM_GRAPH_VERSION` (default `v23.0`, to be confirmed with the live app). Missing or invalid values disable the integration (`503 INTEGRATION_UNAVAILABLE`). Requested scopes: only `instagram_business_basic` and `instagram_business_content_publish`.
- Adapter (`server/instagram/provider.ts`): authorization URL on `www.instagram.com/oauth/authorize` (Facebook login hidden); code → short-lived token (`api.instagram.com/oauth/access_token`, documented `data[]` or flat response); long-lived exchange and refresh on `graph.instagram.com`; `/me?fields=user_id,username,account_type`. 15-second timeouts; errors never contain tokens or provider bodies. Business/Creator accepted (`MEDIA_CREATOR` → CREATOR); others are unsupported.
- Token encryption (`server/instagram/crypto.ts`): AES-256-GCM, random 96-bit nonce, key version, associated data binding owner and connection ID. Tokens are never returned by any API.
- I01 `POST /api/instagram/connect` (Origin required; excluded from command receipts): 32-byte random state stored only as a SHA-256 hash in `oauthStates` with owner, a hash of the server session ID, optional owned `returnProjectId`, 10-minute expiry (TTL index).
- I02 `GET /api/instagram/callback`: always `303` to a server-generated relative route (`/settings?instagram=<outcome>` or `/projects/:id/video?instagram=<outcome>`); outcomes connected, cancelled, failed, expired, session_lost, unsupported_account, missing_permissions, account_in_use, reconciliation_pending. T11: atomic `pending → exchanging` claim bound to owner, session hash and expiry (replays, other users, other sign-ins and expired states fail). Exchanges happen outside transactions. T12 transaction: account reserved by another owner → generic `account_in_use` (also on a concurrent unique-index race); same-account reconnect updates credentials (`tokenRevision`+1, same destination); different account → blocked while old submitted posts are unresolved, otherwise pauses unsubmitted posts and increments `destinationEpoch`; state consumed.
- I03 `GET /api/instagram/connection`: ConnectionView (state derived from expiry: `expiring` within 7 days, `reconnect_required` after expiry or a rejected refresh).
- I04 `DELETE /api/instagram/connection` (Idempotency-Key, `{expectedRevision, confirmPausePending:true}`): pauses unsubmitted posts, erases the token and account fields unless submitted posts still need reconciliation (then `reconciliationOnly`), always advances `destinationEpoch` so earlier approvals need re-approval; revision CAS; receipt replay.
- Token refresh: `refreshConnection` under a refresh lease and token-revision CAS; provider rejection → `reconnect_required`, outages leave the connection unchanged. Daily Inngest cron `refresh-instagram-tokens` refreshes tokens expiring within 20 days.
- Session facade now returns a session hash (SHA-256 of the server session ID) for binding one-use flows.
- Settings → Instagram panel (`components/instagram-connection.tsx`): Connect (redirects to Instagram; no password asked), outcome notices (removed from the address bar after display), connected account with type, status chip and current access date, Reconnect when expiring/expired, Disconnect confirmation.
- Local HTTPS for development (`apps/web/scripts/dev.mjs`, `npm run dev`): Next.js on `http://127.0.0.1:3001` behind an HTTPS front door on `https://localhost:3000` with a self-signed certificate created on first run in `apps/web/certificates/` (gitignored). Inngest dev server now targets port 3001. `BETTER_AUTH_URL=https://localhost:3000`; `npm run dev:http` keeps the plain HTTP server.
- F17 fix found during this run: a browser-suggested timezone no longer counts as an unsaved change, so first visits don't trigger leave-page/sign-out warnings (it can still be saved).

### Verification

Verified October 20, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 141 web tests (+9 Instagram) passed |
| Instagram contract (fake provider) | `tests/instagram.test.ts` | Config validation (HTTPS, key length); GCM unique nonce and owner/connection binding; account-type normalization; I01 URL, scopes, hash-only state, Origin check, foreign return project 404; successful connect with encrypted token (no plaintext in DB or API); wrong user, wrong sign-in, replay, cancellation, expiry, missing state and missing session attach nothing; personal account, partial permissions and account owned by another user refused; same-account reconnect vs different-account epoch; return to project; 503 without configuration; disconnect revision conflict, confirmation, erase, replay and reconnect; refresh success, outage and rejection |
| Build | `npm run build` | Passed; `/api/instagram/{connect,callback,connection}` present |
| Live Meta check (no login, nothing posted) | Loaded the real authorization URL | Instagram accepted the app ID and HTTPS redirect URI and showed its login page (no invalid redirect / app errors) |
| HTTPS dev front door | `npm run dev`, curl | `https://localhost:3000` pages and API through the proxy; signed-out redirect stays on `https://localhost:3000`; app on 3001 |
| Real browser (production build, temporary database; Instagram login itself not automated) | scripted CDP run | Connect button → `www.instagram.com/oauth/authorize` with the configured app ID, HTTPS redirect, both scopes and a 43-character state; cancelled/unsupported notices; seeded connection shows "@namaste_test · Connected · Creator account · current access until 14 Dec 2026", notice removed from the URL; Disconnect dialog → "Instagram disconnected…" and Connect again; no overflow at 390 px; no console errors. F17 settings flow re-run after the timezone fix: all steps pass |
| **Live connection** (user, real Instagram Creator account, `https://localhost:3000`) | Connect → Instagram login → Allow | Green "Instagram connected." notice; stored connection: state connected, account type CREATOR, both scopes, token encrypted (A256GCM, key v1), expiry about 60 days ahead (19 Dec 2026), token revision 1, destination epoch 1; the one OAuth state consumed. Graph `v23.0` `/me` and the real `account_type` value work |
| Visual review | [Connect](design/verification/f18-connect.png), [connected](design/verification/f18-connected.png), [disconnect](design/verification/f18-disconnect-dialog.png), [mobile 390px](design/verification/f18-mobile.png) | Inspected |
| Secret scan | grep for credential values outside `.env.local` | None found |

No ElevenLabs, Gemini or R2 usage. Nothing posted to Instagram. No deployment or Git commit (user direction).

### Remaining limitations

- Token refresh has only run against the fake provider; the first real refresh happens about 20 days before the 19 Dec 2026 expiry (needs the Inngest dev server running).
- The browser shows a one-time warning for the self-signed local certificate.
- One token-encryption key version; key rotation is not implemented yet.
- Post now (F19) and scheduling (F20) are not available; the connection alone does not enable them. Real posting will also need Instagram to fetch the MP4 from a public HTTPS URL (a tunnel or hosting), which is not set up.

## F17 — implementation record

Scope: personal settings (screens 06 / 24): timezone and the default narrator for future projects. The Instagram connection section is a plain note until F18.

- P08 `GET /api/preferences` and P09 `PATCH /api/preferences` (`server/preferences.ts`, `app/api/preferences/route.ts`). The view is `{revision, timezone, defaultVoicePreset}`; `revision: 0` and `timezone: null` mean nothing is saved yet (defaults: Daniel test voice, browser timezone in the UI). PATCH `{expectedRevision, timezone?, defaultVoicePreset?}` (strict, at least one field): `expectedRevision: 0` creates the document (a racing first save → `409 REVISION_CONFLICT`), otherwise CAS on revision (`409 REVISION_CONFLICT` with `currentRevision`). Unknown timezone → `422 INVALID_TIMEZONE`; unconfigured voice → `422 VOICE_UNAVAILABLE` (both with field errors). Same-origin check, owner-only (the existing unique `ownerId` index).
- Timezones (`lib/timezones.ts`, shared by server and browser): validated with `Intl`, stored as current IANA names (ICU legacy aliases such as `Asia/Calcutta` map to `Asia/Kolkata`; `Etc/UTC` → `UTC`); DST-aware `GMT±hh:mm` labels; browser timezone with the Asia/Kolkata fallback.
- New projects (T01) snapshot the saved default voice; if that preset is no longer configured they fall back to the default preset. Changing the default never rewrites existing drafts or videos. The library already formats dates in the saved timezone.
- Settings page `/settings` (`components/settings-form.tsx`), with a **Settings** link in the main navigation: read-only email, timezone select (≈419 zones with current offsets, suggested from the browser until saved), default narrator radio list with previews where samples exist, explicit **Save settings** / **Undo changes**, saved/unsaved status, conflict message with **Load the latest settings**, a leave-page warning and a "Discard unsaved settings?" dialog before signing out with unsaved changes. The zone list is built after hydration because browser and server timezone data can differ.

### Verification

Verified October 20, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 132 web tests (+5 preferences) passed. The F04 voice-snapshot test now configures its preset, because unconfigured presets fall back |
| Preferences API contract | `tests/preferences.test.ts` | Alias/case canonicalization, invalid names, DST offsets (New York −05:00 / −04:00); unsaved defaults; first save creates revision 1; new projects use the new default; existing drafts unchanged; invalid timezone, unavailable voice, stale revision, first-save race, empty/extra/missing fields, cross-origin and signed-out requests rejected; per-user isolation; removed voice falls back for new projects |
| Build | `npm run build` | Passed; `/settings` and `/api/preferences` present |
| Real browser (production build, temporary database, browser timezone set to Asia/Calcutta) | scripted CDP run | Settings nav is current; email read-only; suggested "Asia/Kolkata (GMT+05:30)" with "not saved yet" hint (419 zones); save → "✓ Settings saved", persists across reload (API revision 1); a change from another tab makes this tab's save show the conflict message and "Load the latest settings" loads Europe/London; unsaved change + Sign out → dialog, "Stay signed in" closes it, Undo restores; no overflow at 390 px; no console errors (a hydration mismatch from differing timezone data was found and fixed during this run) |
| Visual review | [Desktop](design/verification/f17-settings-desktop.png), [mobile 390px](design/verification/f17-settings-mobile.png), [conflict](design/verification/f17-conflict.png), [sign-out guard](design/verification/f17-signout-guard.png) | Inspected |

No ElevenLabs, Gemini or R2 usage. No deployment or Git commit (user direction).

### Remaining limitations

- Only configured voices are offered; the Indian English presets appear once their ElevenLabs voice IDs are set.
- Timezone is used for library dates now; scheduling (F19) will use it with explicit DST handling.
- The Instagram section is a note until the connection flow (F18).

## F16 — implementation record

Scope: caption corrections and video-level revisions from the Video step (screen 11 tabs). Visual-only overrides (layout/component swaps without re-approval) are not included.

- Compiler (`server/generation/compile.ts`): each caption line now carries `sourceStart`/`sourceEnd`, a half-open Unicode code-point span in the scene's approved narration. Display-only overrides replace a whole line's text without retiming; an override that no longer matches a line fails compilation (`LAYOUT_OVERFLOW`) instead of being silently dropped. `buildRenderSpec` records `captionOverrides`, so corrections change the render-spec hash.
- V03 `GET /api/videos/:id/captions` (`server/videos/captions.ts`): per scene `sceneId`, `speechFingerprint` and caption lines (text, code-point span, start/end frames) recompiled from the stored timeline inputs; requires a ready video in a live owned project (`422 VIDEO_NOT_READY`, 404 otherwise).
- V04 `PATCH /api/videos/:id/captions` (Idempotency-Key, `{expectedRenderSpecHash, overrides[{sceneId, speechFingerprint, sourceStart, sourceEnd, displayText}]}`): checks the render-spec hash and speech fingerprint (`409 SOURCE_CHANGED`), that the span matches an existing line and the text fits 54 characters (`422 INVALID_SPAN`), and the meaning guard `captionEditAllowed` (numbers unchanged, word count within ±1, word edit distance ≤ max(2, 20%); otherwise `422 CAPTION_MEANING_CHANGE`, with the flagged lines in details). On success it creates a new video with `parentVideoId`, the same storyboard, story approval and voice, merged overrides, and queues a `caption_render` job plus a `job.caption_render.requested` outbox event (one active content job per project; `409 PROJECT_BUSY`). The new version needs its own final approval; the earlier video is untouched.
- Runner and Inngest handle `caption_render` like generation; speech is reused through the fingerprint cache (no ElevenLabs calls). Retry (G04) also accepts `caption_render` jobs. The route dispatches the outbox after the response, as G01 does.
- Video page tabs (`components/video-tabs.tsx`): **Captions** lists every line with its time; edits are saved as one correction, refused lines are highlighted with a link to the storyboard, and Undo resets. **Revise** sends an S08 revision request using this video's storyboard as the source (only when the draft is still based on it); the candidate opens in the storyboard via "Review in storyboard →", so spoken changes always go back through storyboard approval.
- `lib/api-client.ts` passes field errors to the UI in `details.fieldErrors`.

### Verification

Verified October 20, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 127 web tests (+4 captions, +1 compile) passed |
| Caption API contract | `tests/captions.test.ts` (fake speech/renderer/prober, in-memory store) | Meaning guard cases; V03 spans map exactly to narration words, foreign user 404; correction → new video with parent, same story approval/storyboard, new render-spec hash, `caption_render` job; render makes **0 speech calls**; new captions show the fix while other lines and the previous version are unchanged; new version unapproved; second correction keeps the first; meaning change, overflow, wrong span, stale fingerprint/hash, busy project, foreign user and unready video rejected |
| Compiler | `tests/compile.test.ts` | Spans match narration; override replaces one line with identical timing and total frames; stale override rejected |
| Build | `npm run build` | Passed (existing file-tracing note from the local renderer only) |
| Real browser with a **real render** (silent narration, real R2, production build, temporary database) | scripted CDP run + job runner script | Captions tab lists 29 lines; rewording line 1 → "Some changes alter what the narration says…" with the line highlighted and a storyboard link; adding "!" → accepted; caption job rendered locally with 0 speech calls; page then shows "v2 · latest" and v1, v2 plays (79.3 s, 1080×1920, no media error) with "…a simple!" while v1 keeps the original; Revise tab explains the storyboard round trip; no overflow at 390 px; no console errors |
| Visual review | [Captions](design/verification/f16-captions.png), [refused](design/verification/f16-refused.png), [new version](design/verification/f16-new-version.png), [revise](design/verification/f16-revise.png), [mobile 390px](design/verification/f16-mobile.png) | Inspected |
| R2 cleanup | cleanup worker on the test project | 16 of 16 test objects removed |

No ElevenLabs or Gemini usage. No deployment or Git commit (user direction).

### Remaining limitations

- The browser Revise tab was checked for display only; the revision request itself is covered by the F12 tests (Gemini not called).
- S08 still returns 422 for `source.kind: 'video'`; the Revise tab sends the video's storyboard as the source, which gives the same result.
- No visual-only overrides (layout or component changes without re-approval).
- The meaning guard is heuristic; borderline wording changes may need the storyboard route.
- Real ElevenLabs narration is still not exercised end to end (awaits the user's go-ahead).

## F15 — implementation record

Scope: reviewing, downloading and approving videos (screens 11 / 21). Caption editing and video revisions are F16; publishing is F19.

- V01 `GET /api/projects/:id/videos` (newest first, signed cursor) and V02 `GET /api/videos/:id` (`server/videos/service.ts`): VideoView per API section 4.3 (state, hashes, output asset ID, duration, 1080×1920/30, voice label/accent/test flag, QA summary, approval ID). No storage keys, provider IDs or grant URLs; live owned project required (404 otherwise).
- V05 `POST /api/videos/:id/approve` (Idempotency-Key, `{expectedOutputHash, expectedRenderSpecHash, approve:true}`; T09): requires `ready_for_review`, exact output and render-spec hashes (`409 HASH_MISMATCH`), and the stored output asset with that SHA-256 (`422 VIDEO_NOT_READY` otherwise). Inserts a video approval with `subjectHash = SHA-256(canonical {outputHash, renderSpecHash})`, sets the video `approved` with `finalApprovalId`, and makes it the project's `selectedVideoId`. Approving the same video again returns its approval; every later version needs its own approval.
- Video page (`components/video-review.tsx`): version tabs (v1…vN, latest, Ready for review / Approved / Generating / Not completed), defaulting to the newest ready version, with a notice when a newer version is still generating; versions that aren't ready show their live progress/failure panel (F13/F14) with Retry. Ready versions: vertical player via a fresh preview grant (re-requested if a 10-minute grant expires during playback), facts (created, narrator, format, automatic checks) with a reminder that checks can't judge accuracy or sound, **Download MP4** (download grant → attachment), **Approve & continue to publish** with a version-specific confirmation; approved versions show "✓ Approved for publishing" and that publishing is a later step.

### Verification

Verified October 20, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 122 web tests (+4 video review) passed |
| Video API contract | `tests/videos.test.ts` (fake renderer/prober, in-memory store) | Newest-first list, VideoView shape, no storage keys/provider IDs; hash-mismatch rejection; approval subject hash formula, approved state, selected video, key replay and same-video re-approval return one approval; newer version unapproved while the earlier approved one is unchanged; download grant serves an attachment without approval; foreign, unready and deleted-project videos rejected |
| Real browser with **real renders** (two versions rendered locally with silent narration, real R2, production build, temporary database) | scripted CDP run | Tabs "v2 · latest" and "v1", v2 selected; both versions play (79.3 s, 1080×1920, playback advances, no media error); download → 200 `attachment; filename="namastevideo-video-….mp4"`, `video/mp4`, 4,567,237 bytes; approve v1 → dialog "Approve version 1?" → "✓ Approved for publishing", v2 stays "Ready for review"; no overflow at 390 px; no console errors. Fixed afterwards: duplicated "(test voice)" label and button spacing |
| Visual review | [Review desktop](design/verification/f15-review-desktop.png), [approved](design/verification/f15-approved.png), [mobile 390px](design/verification/f15-review-mobile.png) | Inspected |
| R2 cleanup | cleanup worker on the test project | 16 of 16 test objects removed |

No ElevenLabs or Gemini usage. No deployment or Git commit (user direction).

### Remaining limitations

- Captions tab (view/edit) and the visual revision panel are F16.
- Version tabs show the newest 20 videos (no "load more" yet).
- Custom player controls (playback rate etc.) use the browser's native controls.
- Real ElevenLabs narration is still not exercised end to end (awaits the user's go-ahead).

## F14 — implementation record

Scope: compile → render → validate → finalize for approved storyboards.

**Decision (user, 2026-10-20): option A — render on the developer's Mac now.** The renderer sits behind a `Renderer` interface so a hosted adapter (Vercel Sandbox, container or Remotion Lambda) can replace it before deployment without changing the pipeline. Vercel/hosted rendering, its benchmark and cost are deferred to the deployment phase (F22).

- Compiler (`server/generation/compile.ts`): PlanV2 + recorded alignments → the prototype `Timeline` shape consumed by the unchanged approved composition (`src/video`). Contiguous scenes, frames = ceil((audio + 0.3 s) × 30), cue and decision frames from alignment, captions grouped as in the prototype (≤54 chars, ≤3.4 s, sentence breaks). Pronunciation substitutions are supported with an explicit span mapping: timing uses the spoken provider text while captions keep the approved written words (the prototype failed closed here). Recorded text must equal the frozen provider text; total 60–90 s or `DURATION_OUT_OF_RANGE` (not retryable — revise and re-approve).
- Local renderer (`server/generation/render-local.ts`, `apps/web/scripts/render-worker.ts`): separate Node process from the repository root bundles `src/video/index.tsx` and renders H.264 + AAC (CRF 23, concurrency 2) in a private temporary work directory (never root `public/` or `runs/`; removed afterwards); progress reported to the job; 15-minute limit; runtime and (via `/usr/bin/time -l`) peak memory measured. Prober uses Remotion's bundled ffprobe.
- Runner: after narration, `compile` stage (timeline asset in R2), `render` stage (20-minute lease; downloads audio from R2, renders, probes, QA, stores the MP4 asset; `render.completed` diagnostic event with duration), `finalize` (T08 transaction: video `ready_for_review` with output asset, SHA-256, QA and timeline asset; project `latestReadyVideoId` and `flags.ready`; job `succeeded` with `{kind:'video', videoId}`; slot released). A render that completes after cancellation or project deletion is never made ready. Earlier ready videos are untouched; identical narration is reused across videos.
- QA (`qualityChecks`): 1080×1920, 30/1 fps, H.264, audio present, 60–90 s and within 1 s of the compiled timeline, caption bounds; `layout` relies on component limits validated before approval; `integrity` on storeAsset's size/MD5 verification. Any failed check → `OUTPUT_INVALID` naming the checks; no ready video.
- Inngest job runner now supplies the local renderer and prober (`RENDERER=none` disables rendering). Video page shows render percentage, real stage states, and a preview player for ready videos (via a short-lived media grant); full review/approval/download is F15.

### Verification

Verified October 20, 2026, locally under Node 24.21.0 (Apple Silicon Mac):

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 118 web tests (+3 compiler, +5 render pipeline) passed |
| Compiler | `tests/compile.test.ts` | Contiguous prototype-shaped timeline in range with audio/labels/comparison mapping; captions keep the written narration when pronunciation substitutions change the spoken text; mismatched/missing recordings and out-of-range durations rejected |
| Pipeline | `tests/generation.test.ts` (fake renderer/prober) | Full run → `ready_for_review`, output asset hash = video hash, latest-ready pointer, job result, benchmark event; second generation reuses narration (0 provider calls) and keeps the first ready video; wrong dimensions/no audio → OUTPUT_INVALID, no video asset; cancel during render → cancelled, never ready; too-short narration → DURATION_OUT_OF_RANGE before rendering; QA unit checks |
| **Real local render** | scripted run: temporary database, real R2, real DNS storyboard, **silent MP3 narration** with realistic timing (no ElevenLabs), real Remotion render + ffprobe | Job `succeeded`, video `ready_for_review`, **all 8 QA checks true**, **79.25 s** 1080×1920 H.264/30 fps + AAC, 4.6 MB; **render 90 s, whole pipeline 120 s**; frames inspected ([0:06](design/verification/f14-render-frame-06s.png), [0:40](design/verification/f14-render-frame-40s.png)) match the approved style (titles, flow diagram on cue, captions, scene counter); R2 objects removed by the cleanup worker afterwards |
| Production build | `npm run build` | Passed |

No ElevenLabs or Gemini usage. Temporary database discarded; R2 test objects deleted. No deployment or Git commit (user direction).

### Remaining limitations

- **Real ElevenLabs narration through the full pipeline has not been run yet** (needs the user's go-ahead; about 1,000 characters per video). The silent test validates timing, rendering and checks, not voice quality or audio sync by ear.
- Rendering runs on this Mac (option A); hosted rendering and its benchmark are deferred to deployment (F22). Peak memory is measured by the renderer but not yet persisted in diagnostics.
- QA cannot judge visual quality, narration accuracy or audio/visual sync; human review (F15) remains required.
- The test video's footer says "AI-generated narration" although the test narration was silent (test-only artifact, never stored).

## F13 — implementation record

Scope: generation orchestration and durable job execution. Compile, render and output validation are F14; the render stage currently fails with a clear retryable message after narration.

- G01 `POST /api/projects/:id/generations` (Idempotency-Key, `{expectedDraftRevision, expectedContentHash, approve:true}` → 202 AcceptedOperation `{jobId, resource:{kind:'video'}}`): one transaction — live parent, free content slot (expired jobs recovered), the shared F11 approval rules (`approveInSession`, now reused by the approval endpoint too), server-resolved voice (`VoiceConfig`), immutable render spec + hash, video (`building`), generation job holding the slot with a frozen snapshot (approval, render spec hash, voice, per-scene provider text with pronunciation substitutions applied and owner/project-namespaced speech fingerprints), outbox event and receipt. Resolves the F11 architecture adjustment: the UI's primary action is now "Approve & generate video".
- Stage runner (`server/generation/runner.ts`): `claim` (queued → running CAS; duplicate deliveries are no-ops), one `speech:<sceneId>` stage per scene, `render`, with progress (`completedScenes/totalScenes`, stage). T06 stage claim: transaction, lease + monotonically increasing fence, attempt record; succeeded stages are reused; expired leases re-leased only if no request started; `request_started` past its lease → `outcome_unknown` (never auto-repeated); a live lease blocks other executions. T07 completion is fenced (a stale execution cannot change the stage). Speech: verified cache reuse by fingerprint (audio + alignment assets), otherwise `request_started` → ElevenLabs with-timestamps (`server/speech/elevenlabs.ts`, alignment validated against the exact text) → both artifacts stored via F12 → stage succeeded. Provider timeouts → `outcome_unknown`; definitive errors → failed with SafeError. Cancellation is checked at every stage boundary. Failure/cancel finalization releases the slot only if it still belongs to the job and marks the video failed.
- G03 `POST /api/jobs/:id/cancel` (queued → cancelled immediately; running → cancel_requested; terminal/cleanup → 409 JOB_TERMINAL). G04 `POST /api/jobs/:id/retry` (failed, retryable generation only; current revision; `REPEAT_ACK_REQUIRED` unless `acknowledgePossibleProviderRepeat` when any stage is outcome_unknown; new execution attempt, slot re-claimed, unfinished stages reset, completed stages reused, video back to building, new outbox event). JobView `actions` now reflect cancel/retry eligibility.
- Durable execution (`server/inngest/functions.ts`, `app/api/inngest`): Inngest SDK 4.21.1 (pinned); `run-job` triggered by `namastevideo/job.requested` (per-job concurrency 1, retries 3) executes generation (each stage as `step.run`, keyed by execution attempt), cleanup, brainstorm, storyboard and revision jobs; `dispatch-outbox` cron every minute. Outbox dispatcher (`server/jobs/outbox.ts`): leased claim, stable event ID (Inngest dedupe), mark sent, exponential backoff, dead after 10 attempts. G01/G04 also dispatch immediately via `after()`. The F08 interim `after()` runners for AI jobs remain as a latency path; the atomic job claim prevents double execution.
- Project cleanup (`server/jobs/cleanup.ts`, resolves the F05 limitation): revokes grants, deletes R2 objects (missing = deleted), removes project content and non-cleanup jobs/receipts, keeps the tombstone, deletion receipt and cleanup job with `{kind:'cleanup', externalOutcomePending:false}`.
- UI: storyboard "Approve & generate video" (confirmation mentions ElevenLabs usage) → `/projects/:id/video` (`components/video-progress.tsx`, screens 10/12): honest stage list (Preparing scenes, Creating narration n of N, Timing visuals and captions, Rendering video, Checking output) with no fake percentage, "you can leave and come back", waiting-for-runner hint, Cancel with confirmation that started work may finish, Retry with explicit "may already have been charged" acknowledgement, correlation reference. Stepper links to Video when a video exists.
- Local development: `INNGEST_DEV=1` in `apps/web/.env.local`; run `npm run dev:inngest` (Inngest Dev Server 1.45.1 from the pinned `inngest-cli` dev dependency, no account) alongside `npm run dev`. Production requires an Inngest account's event/signing keys (deployment, F22).

### Verification

Verified October 20, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 110 web tests (+9 generation) passed |
| Orchestration contract | `tests/generation.test.ts` (replica set, fake speech provider, in-memory store) | G01 creates approval, video, frozen job (pronunciation-substituted text, fingerprints), slot, outbox, receipt; replay; PROJECT_BUSY; hash mismatch / foreign project create nothing. Two concurrent deliveries → one execution, one provider call per scene, audio + alignment assets per scene, progress, honest RENDER_FAILED, video failed, slot released, retry action. Retry: revision check, attempt 2, zero new provider calls (cache), non-failed job not retryable. Cancel: queued immediately (worker no-op), running stops after the current scene, terminal 409. Unknown outcome: stage outcome_unknown, retry 409 REPEAT_ACK_REQUIRED, acknowledged retry re-records. Crash after request start → outcome_unknown; live lease blocks a second execution. Outbox: failure backs off, success sends stable event ID once. Cleanup: R2 objects and project content removed, cleanup status readable, idempotent |
| **Real Inngest Dev Server** (production build, temporary database, real Gemini; ElevenLabs key intentionally unset so no characters were used) | scripted HTTP run | Both functions registered (dev mode); storyboard job succeeded; G01 202 → **Inngest picked up the job in 1.5 s** → failed honestly at narration ("isn’t configured") with retry action; G04 202 → attempt 2 ran through Inngest; a second generation cancelled while queued → cancelled; project deletion → cleanup job executed by Inngest → succeeded |
| Production build | `npm run build` | Passed; `/api/inngest`, `/api/projects/[id]/generations`, `/api/jobs/[id]/cancel`, `/api/jobs/[id]/retry`, `/projects/[id]/video` dynamic |

Quota: about 2 Gemini free-tier requests; **no ElevenLabs usage** (real narration has not been exercised end to end yet — it is unit-tested with a fake provider and the endpoint matches the prototype's proven call). No deployment or Git commit (user direction).

### Remaining limitations

- No compile/render/validate yet (F14): every generation currently ends at the render stage with a retryable message; narration recorded before that is kept and reused on retry.
- Real ElevenLabs narration through the pipeline awaits an approved run (about 1,000 characters per video).
- Generation needs the Inngest Dev Server running locally; without it, jobs stay queued (the video page says so after 90 s).
- Brainstorm/storyboard/revision jobs are not cancellable or retryable through G03/G04 yet (users can request again).

## F12 — implementation record

Scope: private object storage, assets, media grants and the gateway. Producing real media (speech/video) is F13–F14.

- Infrastructure: Cloudflare R2 bucket `namastevideo-dev` (private; public access not enabled) with an API token scoped to Object Read & Write on that bucket only, provided by the user and stored in `apps/web/.env.local` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). The user can delete the token and bucket at any time to cut off access.
- `server/media/object-store.ts`: `ObjectStore` interface; `R2ObjectStore` over `@aws-sdk/client-s3` 3.1146.0 (pinned; S3 API, region `auto`); `MemoryObjectStore` with R2 semantics (ETag = MD5) for tests; storage-not-configured → `503 INTEGRATION_UNAVAILABLE`.
- `server/media/assets.ts`: `storeAsset` (server-generated key `projects/<projectId>/<kind>/<assetId>.<ext>`, staging record → upload outside transactions → HEAD size + MD5/ETag verification → transaction fencing the live parent → `ready` with SHA-256, Int64 bytes, readyAt; failures or a project deleted during upload delete the object and never leave a ready record). V06 `createAccessGrant` (owner, live project, ready asset, object present — a missing object returns `422 ASSET_NOT_READY` with `{reason:'missing'}`; 32-byte random token, only its hash stored, 10-minute expiry, purpose preview/download). `resolveGrant` (gateway authorization per request: token hash, explicit expiry independent of TTL cleanup, revocation, readiness, same-owner live project, or an enabled catalog voice sample). `revokeProjectGrants`. Strict single-range parser.
- Routes: `POST /api/assets/:id/access` (session + Origin; not idempotent by design) and `GET|HEAD /api/media/:token` (gateway: 200/206/416 with `Content-Range`, `Accept-Ranges`, `Content-Length`, `Cache-Control: private, no-store`, `nosniff`, `Referrer-Policy: no-referrer`, attachment filename for downloads; every failure is a bare 404; streams from storage, never redirects to it).
- Voice catalog moved to R2 (resolves the F08 disk-storage limitation): samples live at `catalog/voice-samples/<preset>/<sha256>.mp3` with a `voiceSamples` record (configuration hash, one enabled sample per preset). `npm run voice-sample -- <preset> [--force | --import-local]`; the existing Daniel sample was imported without new ElevenLabs usage (same SHA-256). `GET /api/voices/:preset/sample` now issues a short-lived `voice_sample` grant (no project) and redirects to the gateway.
- Architecture note: the design places the gateway in a Cloudflare Worker with an R2 binding; for this local/Next.js stage it is a Next.js Node route using the S3 API, with identical authorization rules. Moving it to a Worker remains a deployment decision (F22).

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 101 web tests (+6 media, voices rewritten for the catalog) passed |
| Media contract | `tests/media.test.ts` (in-memory store) | Verified ready asset at a server key; integrity failure and project deleted mid-upload leave no ready asset and remove the object; owner-only grants with ~10-minute expiry, only token hashes stored, unknown/foreign 404, bad purpose 422, no session 401; gateway full body + headers, 206 ranges incl. suffix, 416, HEAD, download filename; expired (before TTL cleanup), revoked, malformed and deleted-project grants 404; missing object → gateway 404 and access 422 `reason:missing`; range parser cases |
| Voice catalog | `tests/voices.test.ts` | Generation validates MP3, stores in catalog, one enabled sample per preset; sample route 401 without session, 302 to a gateway URL that serves the audio; grant has no project and stores only a hash; unavailable preset 404 |
| **Real R2** | scripted run (temporary database + real bucket, synthetic bytes) | Store 1.5 MB in 1.6 s, `ready`; gateway full body identical, `206 bytes 1000-1999/1500000` identical, 416; direct anonymous bucket read refused (400); expired grant 404; deleted object → gateway 404 and access `reason:missing`; deleted project → 404; test objects removed |
| R2 connectivity | smoke script | Bucket reachable; put / ranged get / delete; anonymous access refused |
| Voice preview from R2 in a browser | production build, temporary database, headless Chrome | Player plays the catalog sample via grant redirect (5.9 s, no media or console errors) |
| Catalog import (operator) | `npm run voice-sample -- daniel-test --import-local` | 94,501 bytes, SHA-256 `d49eeb24…604f` (identical to the F08 file); `voiceSamples` record written to the Atlas development database |

No ElevenLabs or Gemini usage. R2 usage: a few small test objects (deleted) and the 94.5 KB catalog sample. No deployment or Git commit (user direction).

### Remaining limitations

- No producer of real assets yet (speech/video arrive with F13/F14); project deletion cleanup of R2 objects runs with the cleanup worker (F13).
- The gateway runs inside the Next.js app rather than a Cloudflare Worker; meta ingestion grants (24 h) arrive with publishing (F19).
- The R2 token was shared in chat; rotating it in Cloudflare is recommended for anything beyond local development.

## F11 — implementation record

Scope: revisions (S08), restore (S07) and story approval. Video-side revisions are F16; generation is F13+.

**Architecture adjustment (approval separated from generation start):** API_DESIGN.md G01 approves and starts generation atomically, but videos/render jobs do not exist until F13–F14. F11 adds `POST /api/projects/:id/approvals` (Idempotency-Key, `{expectedDraftRevision, expectedContentHash, approve:true}` → 201 `{approval, storyboard}`) implementing the approval half of T05 with G01's rules. When generation lands, G01 must perform or require this same approval in its transaction; this endpoint is not a substitute for G01's video/job creation.

- S08 `POST /api/projects/:id/revisions` (Idempotency-Key): `{source:{kind:'storyboard',id,hash}, expectedDraftRevision, instruction ≤4,000, sceneId?}`. Acceptance (shared job core, now with async snapshot checks) requires the working draft to come from that exact source storyboard (`409 SOURCE_CHANGED` otherwise), an existing scene for scoped requests (`422 INVALID_SCENE`); `kind:'video'` → 422 until F16. The job snapshots the saved working storyboard including manual edits.
- Reviser (`reviseStoryboard`, prompt `revision-v1`): the working PlanV2 is converted to the model format (`toModelPlan`, exact round trip with `compilePlan`), revised with the instruction and scope, compiled and validated with one bounded repair. **Scene-scoped requests copy every other scene from the working storyboard** regardless of model output; whole-video requests keep sources/audience. The model writes a short change summary.
- Completion saves a `review_ready` candidate with `parentId` (source), `changeSummary` and server-computed `changedSceneIds` (added/changed/removed by canonical comparison) plus an assistant message; the working draft is untouched (`requiresApply`).
- S07 `POST /api/projects/:id/draft/restore`: same checked transaction as apply (hash, revision CAS, owner/project, narrator) under its own idempotency scope; later versions stay in history.
- Approval (T05 approval half): exact saved draft (revision + draft content hash), plan present, not stale, narrator available and matching, full PlanV2 validation, estimated length within target. If the working storyboard equals its source candidate, that candidate becomes `approved`; otherwise an immutable snapshot is inserted (parent = source, "Edited during review.", changed scenes, planner `editor/manual`) and approved. A story approval record (subject = storyboard, subjectHash = storyHash) is inserted under the unique `approval_subject` index; approving identical content again returns the same approval; key replays return the recorded result. Draft `sourceStoryboardId` and `project.currentStoryboardId` point at the approved storyboard. Approval status in views is derived from approval records (no storyboard schema change, so migration checksums are unchanged).
- UI (`components/storyboard-actions.tsx`): "Revise with AI" panel (scope: entire video / scene; flushes saves; resumes an active revision job), proposed-changes review with per-scene Before/After narration and removed scenes, Keep revision / Discard, and a stale warning ("based on an earlier version… would replace edits") requiring "Keep revision anyway". Approve storyboard → confirmation dialog stating that the app checks structure and timing, not facts, and that approved versions can't change → "✓ Approved · time"; status pill Approved / "Changed since approval" with "Approve changes". Versions panel (Current / Approved chips, summaries, Restore). Three-column desktop layout (scenes navigator · cards · revise/versions), stacked on narrower screens.

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 95 web tests (+8 revisions/approval/restore) passed |
| Revisions, approval, restore | `tests/revisions.test.ts` (route handlers, replica set, fake reviser/fake Gemini) | Exact model-format round trip; scene-scoped revision keeps other scenes even when the model rewrites them; SOURCE_CHANGED, INVALID_SCENE, video-kind 422, REVISION_CONFLICT; candidate parent/summary/changed scenes and assistant message, draft untouched; approval of applied candidate, replay and same-content re-approval return one approval; edited plan snapshotted immutably with parent and changed scenes, unedited candidate not approved, later edits leave the approved content and hash unchanged; HASH_MISMATCH, stale revision, approve:false, missing cue, too short, stale idea, no plan, other user rejected; restore brings back the earlier version and keeps history |
| Real browser + **real Gemini** (production build, temporary in-memory database) | scripted CDP run | Storyboard created ("Ready for approval"); scene-1 revision "simpler for a 12-year-old" → summary about a phone-contacts analogy, only Scene 1 changed; Keep revision applied it (2 versions); Approve → dialog → "✓ Approved", pill "Approved", Approved chip in versions; editing a title → "Changed since approval" + "Approve changes"; Restore version 1 brings back the original narration; no overflow at 390 px; **no console errors** |
| Visual review | [Proposed changes](design/verification/f11-proposed.png), [approved + versions](design/verification/f11-approved.png), [mobile 390px](design/verification/f11-mobile.png) | Inspected |
| Production build | `npm run build` | Passed; `/api/projects/[id]/revisions`, `/approvals`, `/draft/restore` dynamic |

Quota: about 3 Gemini free-tier requests. Temporary databases discarded; no Atlas data written. No deployment or Git commit (user direction).

### Remaining limitations

- Approval does not start video generation yet (see the architecture adjustment); G01 arrives with F13.
- Revisions cannot ask clarifying questions (`needs_input`) yet; conflicting instructions follow the latest explicit instruction per the prompt.
- The conversation thread (messages API S01) is stored but not shown as a chat history; the UI shows the latest proposal and the versions list.
- Before/After shows narration text; title/label changes are applied but not individually highlighted.

## F10 — implementation record

Scope: creating and reviewing/editing the working storyboard (screens 08 / 20). Conversational revisions, restore, approval and video generation are F11/F13 and are visibly disabled.

- S06 `POST /api/projects/:id/draft/apply` (Idempotency-Key): copies a saved candidate into `draft.editablePlan` in one transaction — exact `expectedContentHash` (`409 HASH_MISMATCH`), draft revision CAS + parent fence (`409 REVISION_CONFLICT`), same owner/project (404), narrator must match the draft (`422` VOICE_MISMATCH) — sets `sourceStoryboardId`, `planStale:false`, recomputed hash/issues, `project.currentStoryboardId`; replays return the current draft.
- DraftPlanV2: `lib/plan.ts` now builds strict and draft schemas from one definition. Draft saves (`PATCH …/draft` with `editablePlan`) must be structurally safe — same shapes, IDs, enums, numeric ranges, array bounds, no unknown fields, enabled components only, ≤128 KiB, text ≤ hard caps — otherwise `422 INVALID_DRAFT`; incomplete text (empty labels, missing cue words, short narration) is saved with validation issues under `editablePlan.*`. Rules split into `ideaIssues` (blocks storyboard creation: topic, narrator) and `draftIssues` (idea + full plan validation + narrator match). Idea changes mark an applied plan stale.
- Autosave controller now includes `editablePlan`, compared by content.
- Idea page: "Create storyboard →" (disabled without a topic) flushes saves, starts S03, shows progress ("You can leave and come back"), resumes an active storyboard job on reload, then applies the candidate and opens the review screen. If the idea changed meanwhile, the user chooses "Use this storyboard" or "Keep editing". With an existing storyboard: "Create a new storyboard" and "Review storyboard →". Shared stepper links Idea ↔ Storyboard, flushing saves first.
- `/projects/:id/storyboard` (`components/storyboard-editor.tsx`): summary (scene count, estimated m:ss vs 1:00–1:30, "estimate until narration is recorded"), status pill (issues count / "Length outside the 60–90 second target" / "Ready for approval"), duration warning, scene navigator with issue dots, scene cards with schematic preview (`components/scene-preview.tsx`: flow boxes and arrows, comparison panels, binary-search cells with the real range and midpoint for the step, labels for water scenes — labelled "Schematic preview"), editable kicker, on-screen title and spoken narration with counters, per-scene words and ~seconds, visual-cue chips that turn into "Missing cue" guidance, editable on-screen steps/labels/comparison text (search numbers are computed and read-only), per-scene issue lists. "Approve & generate video" disabled with explanation; "Create a new storyboard" regenerates. Generic unavailable / "No storyboard yet" states.
- Planner: Gemini's structured-output schema now requires 6–8 scenes (real runs had returned 3-scene, ~38 s plans that the prose instruction did not prevent).

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 87 web tests (+4 review contract, +1 autosave) passed |
| Apply and plan editing | `tests/review.test.ts` (route handlers, replica set) | Apply copies the plan, sets source/currentStoryboardId, revision 3, valid; key replay; HASH_MISMATCH; stale revision; other user's and other project's storyboard 404; unknown field 422; narrator mismatch 422. Edits autosave; removed cue words and empty labels saved with issues; disabled component, unknown field, too few scenes, empty flow steps, over-cap narration and >128 KiB plans rejected; idea change marks plan stale; storyboard creation not blocked by plan issues |
| Real browser + **real Gemini** (production build, temporary in-memory database) | scripted CDP run | Create disabled without topic; progress shown; review screen opened in 6–10 s; "02 Storyboard" current; final run: 7 scenes, estimated 1:14, "Ready for approval", schematic flow/comparison previews, navigator; narration edit → "Saved", survives reload; removing cue words → "Missing cue", issue dot, "1 issue to fix before approval", still saved; library card shows "Storyboard preview · estimated"; no overflow at 390 px; **no console errors**. An earlier run produced a 3-scene/38 s plan, which led to the 6–8 scene schema limit and the honest length status |
| Real Gemini planner (after the scene limit) | dry runs | DNS: 6 scenes, ~71 s. Binary search: 6 scenes, ~61 s, first attempt |
| Visual review | [Storyboard desktop](design/verification/f10-storyboard-desktop.png), [issue state](design/verification/f10-storyboard-issue.png), [mobile 390px](design/verification/f10-storyboard-mobile.png) | Inspected |
| Production build | `npm run build` | Passed; `/projects/[id]/storyboard`, `/api/projects/[id]/draft/apply` dynamic |

Quota: about 6 Gemini free-tier requests. Temporary databases discarded; no Atlas data written. No deployment or Git commit (user direction).

### Remaining limitations

- No conversational revisions, changed-scene highlighting, restore or approval yet (F11); no video generation (F13+).
- Editing is limited to text fields; adding/removing/reordering scenes and changing visual types require a new storyboard (or F11 revisions). Pronunciation entries are not editable in the UI yet.
- Timing is a word-count estimate (2.5 words/s); real timing comes from narration audio.
- Conflict handling on the storyboard page offers reload only (the idea page has compare/keep/use-other).

## F09 — implementation record

Scope: storyboard generation and read APIs (S03–S05). Reviewing, editing and applying a candidate are F10/F11; the idea page's "Create storyboard" button is still disabled until the review UI exists.

- Shared runtime contract `lib/plan.ts`: PlanV2 Zod schema with API section 4.2 bounds (code-point limits, 3–10 scenes, IDs, cues, offsets, durations, sources ≤20 and ≤20,000 chars) and the component registry from DB section 4.1 — enabled only for components the renderer implements: `flow`, `comparison`, `binary-search`, `water-overview`, `evaporation`, `condensation`, `rain`, `collection` (diagram/timeline/chart disabled). Semantic validation: unique scene/event/source IDs, every cue and pronunciation phrase resolves to its occurrence, registry-defined targets and actions, valid flow edges, sorted distinct search values, lower-midpoint trace (identical to the prototype — parity-tested), setup step 0, final result step, non-decreasing steps, compare scenes need a midpoint reveal and the trace-correct decision after it, one consistent search example, topic-allowed components. Duration estimate (2.5 words/s) warns outside ~55–95 s.
- Planner `server/ai/planner.ts` (prompt `storyboard-v1`): Gemini returns a compact, prototype-proven scene format constrained to the topic's components; the server compiles it deterministically into PlanV2 — generated step/edge IDs, cue events, notes as a `provided_notes` source, and **search step numbers and decisions derived from scene order and the real trace** (real Gemini output was off by one). One bounded repair request carries the exact issues, plus the computed search trace when search scenes fail (models mis-simulated binary search). A valid but badly sized first plan also uses the single repair; a second result is kept with its warning. A second invalid result fails as retryable `PROVIDER_REJECTED`.
- Shared job lifecycle `server/jobs/core.ts` (T03/T04): brainstorm now runs on it unchanged; storyboard jobs reuse acceptance (slot, draft CAS, snapshot, user message, outbox, receipt), atomic execution claim, completion and expired-job recovery.
- Storyboards `server/storyboards/service.ts`: S03 requires a saved meaningful topic and an available narrator (`422 INVALID_DRAFT` with field errors, no slot taken); completion inserts the immutable candidate (`review_ready`, `sourceDraftRevision`, `contentHash` over the full plan, `storyHash` over spoken/on-screen/semantic content excluding cue offsets and durations, estimate, warnings, planner model/prompt version, creating job) plus an assistant message linked to it — the working draft is never overwritten. S04 lists summaries (newest first, signed cursor, no full content), S05 returns the full StoryboardView; both require a live owned project (404 otherwise).
- Routes: `POST/GET /api/projects/:id/storyboards`, `GET /api/storyboards/:id`; POST returns 202 with job status URL and runs via the interim `after()` runner; 503 without Gemini configuration.

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 82 web tests (+7 plan contract, +8 planner, +5 storyboard) passed |
| Contract | `tests/plan.test.ts` | A real Gemini plan (fixture) passes; structural bounds/unknown fields; duplicate IDs, missing cues/occurrences, pronunciation, unknown target/action/source; flow edges, comparison limits, disabled `chart`, topic-disallowed components; binary-search steps/decisions/order/consistency/sorting; trace parity with the prototype over 300 cases; duration warning |
| Planner | `tests/planner.test.ts` (fake Gemini) | Topic components; compilation (edges, events, sources); trace-derived decisions; off-by-one regression from real output; trace hint content; single repair with exact issues and restricted component enum; sizing repair and kept warning; malformed JSON repair; two invalid results → retryable failure |
| Storyboard jobs/APIs | `tests/storyboards.test.ts` (replica set) | 503 without Gemini; INVALID_DRAFT without topic and no slot taken; success stores candidate with exact hashes/model/job and linked assistant message, draft untouched, slot released; story hash ignores timing but not narration; planner failure recoverable then next request succeeds; list newest-first summaries without content, full get, cross-user 404, unknown 404, deleted project 404 |
| Real Gemini (planner only) | `generateStoryboard` dry runs | DNS: valid, ~67–75 s, flow + comparison. Binary search: first runs exposed off-by-one steps and a wrong midpoint narration (correctly rejected); after the fixes two runs succeeded first try and a final run succeeded with repair at ~68 s with two real checks |
| HTTP end to end (production build, temporary database, real Gemini) | scripted fetch run | Sign-in → project → topic saved → `POST /storyboards` 202 queued → brainstorm during the run 409 PROJECT_BUSY → job `succeeded` in 12 s with `{kind:'storyboard', storyboardId, requiresApply:true}` → `GET /api/storyboards/:id` review_ready plan → listed → draft `editablePlan` still null → slot released. An earlier run before the fixes failed safely as retryable `PROVIDER_REJECTED` |
| Atlas schema | `npm run db:status` | Matches the catalog |

Quota: about 15 Gemini free-tier requests during development and verification; no ElevenLabs use. Temporary databases discarded; no Atlas data written. No deployment or Git commit (user direction).

### Remaining limitations

- The validator checks structure and trace-consistent search events, not factual accuracy or that narration numbers match the data; human review before approval (F10/F11) remains required.
- `gemini-3.5-flash-lite` usually needs the one repair; first-attempt success varies. A stronger model may be configured with `GEMINI_MODEL`.
- No UI yet: storyboards are visible only through the API until F10.
- Interim `after()` runner (see F08); planning deadline 10 minutes.

## F08 — implementation record

Scope: the idea step (screens 07 / 19) and topic suggestions (API S02, P10).

- `/projects/:id` (`app/(private)/projects/[id]/page.tsx`): private page; loads the owner's project and draft or shows the generic "This project is unavailable" screen (screen 03 — never reveals existence/ownership). Library cards and the menu now open projects; "+ Create a video" opens the new project.
- `components/idea-editor.tsx`: stepper (01 Idea current), Topic (2,000 code-point counter, "Add a topic" guidance), optional Audience (200) and Notes (20,000) behind a disclosure, narrator choice from available voices (Daniel test voice), 60–90 s guidance. Wired to `DraftAutosave` (now with `subscribe`): status pill Saved · time / Unsaved changes / Saving… / Save failed + Retry / "Not saved — changed in another tab"; failure banner keeps text; conflict banner with Compare versions (field-by-field other tab vs yours), Keep my version (reapply on the newer revision) and Use the other version (reload); leave-page warning while unsaved. "Create storyboard" is visibly disabled with an explanation (F09).
- Brainstorm panel: prompt → flush autosave → `POST /api/projects/:id/brainstorm` with Idempotency-Key and `expectedDraftRevision` → poll `GET /api/jobs/:id` every 2 s (10 s when hidden) → 3–5 suggestion cards; "Use idea" sets the topic (and fills empty notes with angle/takeaway), which autosaves. PROJECT_BUSY resumes polling the active job; the latest successful ideas reload with the page.
- S02 brainstorm job (`server/jobs/brainstorm.ts`): T03 acceptance transaction — live parent, single content slot (`project.activeJobId` + `jobs.activeSlot` unique partial index), draft revision CAS, frozen input snapshot, user message with allocated conversation sequence, outbox event, receipt. Execution claims `queued → running` atomically; completion (T04) stores `{kind:'ideas', suggestions}`, writes one deduplicated assistant message, releases the slot only if it still belongs to the job; failures store a SafeError with correlation ID; a project deleted mid-run yields `cancelled` with no visible result; expired non-terminal jobs are failed and release the slot on the next request.
- Interim runner: the route schedules execution with Next.js `after()` once the 202 is sent. Because of the atomic claim, the durable worker in F13 can replace it without double execution.
- Gemini adapter (`server/ai/gemini.ts`): Interactions API, structured JSON output validated by Zod (3–5 × topic/angle/takeaway), one bounded repair retry, safe error categories (PROVIDER_AUTH/QUOTA/TEMPORARY/REJECTED/OUTCOME_UNKNOWN) without provider bodies or keys; user text is passed as untrusted data. Web config: `GEMINI_API_KEY` (copied with the user's approval into `apps/web/.env.local`) and `GEMINI_MODEL=gemini-3.5-flash-lite` (the model that worked reliably on the free tier). Without a key the route returns `503 INTEGRATION_UNAVAILABLE` and the panel says suggestions are unavailable.
- `GET /api/voices` (P10): available presets with labels/accents and `sampleUrl` when a sample exists (`sampleAssetId` stays null until the R2 catalog, F12).
- Narrator preview: `npm run voice-sample -- daniel-test` (operator, one-time; 71 ElevenLabs characters) synthesizes a short sample with the server-only voice ID into git-ignored `apps/web/voice-samples/` (outside `public/`, MP3 signature validated). `GET /api/voices/:preset/sample` requires a session, serves only available catalog presets (no client-chosen paths) as `audio/mpeg` with private caching. The idea page shows a native audio player per voice. `ELEVENLABS_API_KEY`/`ELEVENLABS_MODEL` were copied with the user's approval into `apps/web/.env.local`; provider voice IDs never reach the client.

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 62 web tests (+7 brainstorm, +5 Gemini adapter, +3 voices) passed |
| Brainstorm job | `tests/brainstorm.test.ts` (replica set, fake generator) | 503 without Gemini config; prompt bounds; acceptance commits job/slot/message/outbox/receipt; key replay; PROJECT_BUSY with active job ID; stale draft revision; foreign project 404; two concurrent runs execute once; result + single assistant message + slot release; owner-only job read; finished job never re-runs; quota failure stored safely; deletion mid-run → cancelled, hidden; expired job recovered |
| Gemini adapter | `tests/gemini.test.ts` (fake fetch) | Request shape (endpoint, key header, model, store:false, schema, untrusted-data instruction); validated suggestions; single repair retry; 429/503/401/400/network mapped to safe codes without leaking the key; only completed model output used |
| Real browser + **real Gemini** (production build, temporary in-memory database, throwaway account) | scripted CDP run | Sample topic opens `/projects/prj_…`; "01 Idea" current; Unsaved → Saved after the 1 s debounce; topic and audience survive reload; Daniel selected; Suggest topics shows busy state then **3 real Gemini suggestions**; Use idea replaces the topic and autosaves; another tab's save then a local edit → conflict banner, comparison shows the other tab's audience, Keep my version saves the local edit on the server; unknown project → "This project is unavailable"; no overflow at 390 px; **no console errors** |
| Visual review | [Idea desktop](design/verification/f08-idea-desktop.png), [conflict](design/verification/f08-conflict.png), [mobile 390px](design/verification/f08-idea-mobile.png) | Inspected |
| Production build | `npm run build` | Passed; `/projects/[id]`, `/api/projects/[id]/brainstorm`, `/api/voices`, `/api/voices/[preset]/sample` dynamic |
| Voice catalog and sample route | `tests/voices.test.ts` | Only configured voices listed, provider IDs absent from client data; generator calls ElevenLabs once with the configured voice and rejects non-MP3 responses and unavailable presets; route 401 without session, 200 `audio/mpeg` with session, 404 for unavailable preset and traversal attempts; P10 advertises the sample URL |
| Real sample + browser playback | `npm run voice-sample -- daniel-test`; headless Chrome on the production build | 94,501-byte MP3 (ID3, 128 kbps, 44.1 kHz, mono); player on the idea page labelled "Preview Daniel — English (test voice)" loads and plays (duration 5.9 s, playback advanced, no media error, no console errors); [screenshot](design/verification/f08-voice.png). Anonymous and forged-cookie requests to the sample route return 401 on the live server |

Paid/quota usage: one real Gemini free-tier request (suggestions) and 71 ElevenLabs characters (one-time voice sample). The temporary database and account were discarded; Atlas was not used. No deployment or Git commit (user direction).

### Remaining limitations

- (Resolved in F12: samples now live in the private R2 voice catalog.) Indian presets have no sample until their voice IDs are configured.
- Brainstorm execution uses the interim in-process `after()` runner; outbox dispatch and durable retries arrive with F13. A job interrupted by a server stop is recovered after its 10-minute deadline.
- Messages history endpoint (S01) and a visible conversation thread are not built yet (needed for conversational revisions, F11).
- Optional session-storage recovery of unsaved text is still not implemented.

## F07 — implementation record

Scope: the draft API and the client autosave logic. The idea page that uses them is F08.

- `GET/PATCH /api/projects/:id/draft` (`server/drafts/service.ts`, P06/P07): owner-scoped; foreign/deleted/malformed → 404; PATCH requires the app Origin, `expectedRevision` and at least one of `topic` (≤2,000), `audience` (≤200), `notes` (≤20,000) — counted in Unicode code points, empty allowed, stored exactly as typed — `voicePreset`, or `editablePlan:null`. Unknown fields rejected.
- T02 transaction: reads the draft and live parent, fences the project on its mirrored `draftRevision` (bumping `updatedAt`, `contentRevision`), then CAS-updates the draft revision. Stale → `409 REVISION_CONFLICT` with `{currentRevision, reloadUrl}`; concurrent saves admit exactly one. Each save recomputes the canonical `contentHash` and validation issues (`topic` REQUIRED, `voicePreset` VOICE_UNAVAILABLE); drafts may be saved with issues. Changing topic/notes/voice marks an existing working plan stale.
- Voices (`server/voices.ts`): Daniel (test voice) always available; Indian English presets only when their ElevenLabs voice IDs are configured for the web app. Choosing an unavailable preset → `422 VOICE_UNAVAILABLE`.
- `server/drafts/rules.ts`: shared draft hash and issue rules; new projects now start with the honest `topic REQUIRED` issue.
- `lib/autosave.ts` (`DraftAutosave`): 1-second debounce, one save in flight, edits typed during a save are sent next against the new revision, statuses saved/unsaved/saving/failed/conflict, `flush()` resolves true only when everything reached the server (for use before generation/approval/navigation/scheduling), failures keep local text and retry on flush, conflicts stop autosave and offer `reapply` (save local edits on top of the newer revision) or `reload` (adopt server version).
- `tests/harness.ts`: shared replica-set/auth/route-request harness for integration tests.

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 47 web tests (12 database, 12 auth, 3 return-path, 9 project, 6 draft, 5 autosave) passed |
| Draft contract | `tests/drafts.test.ts` (real route handlers, two users, replica set) | Blank draft revision 1 with topic issue and correct hash; save → revision 2, exact text, new hash, project mirror and recency; reload returns saved text; restoring content restores the hash; stale revision 409 without change; concurrent saves one 200/one 409; code-point limits at and over bounds; empty/unknown/missing-precondition/plan-object/owner-field requests 422; unavailable voice 422; other user 404; malformed 404; missing Origin 403; deleted project 404 |
| Autosave controller | `tests/autosave.test.ts` (mocked timers, fake server) | One save after 1 s of inactivity; in-flight edits saved next against revision 2; failure keeps text and retries; conflict blocks sending while typing continues, reapply saves on the newer revision, reload adopts the server draft; no-op flush sends nothing |
| Production build | `npm run build` | Passed; `/api/projects/[id]/draft` dynamic |
| Live dev server | curl | `GET /api/projects/prj_x/draft` → 401 without a session |

No Atlas data was written by these checks. No paid API calls, deployment or Git commit (user direction).

### Remaining limitations

- `editablePlan` accepts only `null` until the PlanV2 draft contract is implemented with storyboards (F09/F10).
- Optional session-storage recovery of unsaved text (SYSTEM_DESIGN.md section 3.3) is not implemented yet; the autosave controller keeps text in memory while the page is open.
- The controller is not yet wired into a page (F08).

## F06 — implementation record

Scope: the My videos page (screens 04, 05, 18 as revised in review). Opening a project (idea step) is F08; downloads arrive with videos (F15).

- `/videos` (`app/(private)/videos/page.tsx`): after `requirePrivateSession`, the first page (12) of the owner's projects is rendered on the server via the same `listProjects` service; the owner's timezone preference is used for dates (default Asia/Kolkata).
- `components/library.tsx`: "+ Create a video" (POST with a per-attempt Idempotency-Key reused after an ambiguous failure), filter pills All/Drafts/Ready/Scheduled/Published/Needs attention without counts (per review), project cards with schematic thumbnail and an honest preview label (Video preview only when a ready video exists; Storyboard preview · estimated with a storyboard; otherwise Idea in progress), independent status chips from flags, "Updated …" in the owner's timezone, action menu (Rename, Delete — the only actions that exist today), "Load more videos" with ID de-duplication and restart on an expired cursor.
- States: full empty state "Your first video starts with an idea" with three sample topics that create a titled project; filter-empty with Clear filters; loading skeleton; load failure with Retry ("Your saved work is safe on the server"); inline create/load-more errors; success notice.
- Dialogs (native `<dialog>`, focus-trapped): Rename (code-point counter, 1–100 validation, PATCH with `expectedRevision`); Delete (warning that generation and pending schedules are cancelled and published Instagram posts are not removed; DELETE with key + revision). A 409 shows "changed in another tab" and refreshes the list; a 404 removes the stale card.
- `lib/api-client.ts`: envelope handling; 401 → sign-in with the current path and `reason=expired`; 403 ACCESS_DISABLED → access help.
- Cinema-token styles for chips, cards, menus, skeleton (reduced-motion respected globally), dialogs and a horizontally scrolling filter row on mobile.

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 36 web tests passed |
| Production build | `npm run build` | Passed |
| Real browser flow (headless Chrome via DevTools protocol, production build, temporary in-memory database, throwaway account) | scripted run | Sign-in lands on `/videos`; empty state shown; sample topic creates "How DNS resolution works" with notice; 13 more creates → 14 cards; reload shows 12 + Load more; Load more → 14 and button disappears; Ready filter pressed → "No videos match this filter"; Clear filters → 12; Drafts → 12; rename through menu/dialog updates the card and closes the dialog; rename after another tab changed the project shows the conflict message and refreshes the list; delete through the dialog removes the card and it stays gone after reload; no horizontal overflow at 390px; **no console errors** |
| Visual review | [Empty](design/verification/f06-empty.png), [grid](design/verification/f06-grid.png), [filter empty](design/verification/f06-filter-empty.png), [rename](design/verification/f06-rename.png), [delete](design/verification/f06-delete.png), [mobile 390px](design/verification/f06-mobile.png) | Inspected |

The temporary database and account were discarded; Atlas was not used. No paid API calls, deployment or Git commit (user direction).

### Remaining limitations

- Cards cannot be opened yet (no project page until F07/F08); Download appears only when videos exist (F15).
- The delete "publishing lock" (blocking deletion while a submitted publication is unresolved) is not shown because publishing does not exist yet (F19).
- Loading skeleton and load-failure state were implemented but not captured in the browser run (they need a slow/failed network); they are simple conditional renders.
- Video duration badges appear once videos exist.

## F05 — implementation record

Scope: server APIs only (API_DESIGN.md P01–P05 plus a minimal G02 job status read). The library UI is F06.

- Routes: `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `GET /api/jobs/:id`. All require a valid session with enabled access (`server/api-session.ts`); mutations also require the exact app Origin. The owner always comes from the session; owner IDs in bodies are rejected as unknown fields.
- Create (P02, T01): `{title?}` (trimmed, 1–100 Unicode code points, default "Untitled video"); one transaction inserts the command receipt, project (`flags.drafts:true`, revision 1, `contentRevision` Int64), blank draft (voice preset snapshotted from the owner's preferences, else `daniel-test`; canonical content hash) and conversation. 201 + `Location`.
- Idempotency (`server/commands.ts`): `Idempotency-Key` required (16–128 printable ASCII) on create/delete; scope = owner + method + path; request hash over the canonical validated body. Same key/same request replays the original resource with `Idempotency-Replayed: true`; same key/different request → `409 IDEMPOTENCY_KEY_REUSED`; validation failures do not consume the key; concurrent duplicates resolve to one record via the unique receipt index.
- List (P01): `limit` 1–50 (default 20), `filter` all/drafts/ready/scheduled/published/needs_attention, `updatedAt DESC, _id DESC` with strict tuple boundary and `limit+1`. Cursors (`server/cursor.ts`) are versioned, HMAC-signed, bound to an owner tag, route and filter, expire after 24 h; tampered/foreign/mismatched → `400 INVALID_CURSOR`. Unknown or invalid query parameters → `400 INVALID_QUERY`. Tombstones excluded.
- Get/rename (P03/P04): foreign, malformed, unknown and deleted IDs are all `404 NOT_FOUND`. PATCH requires `expectedRevision` and at least one change; CAS on revision; stale → `409 REVISION_CONFLICT` with `{currentRevision, reloadUrl}`. `selectedVideoId` must be a ready/approved video of the same owner/project (none exist yet → `422 VIDEO_NOT_READY`).
- Delete (P05, T17): `{expectedRevision, confirm:true}` + key. One transaction tombstones the project (`deletedAt`, revision and contentRevision incremented), cancels queued non-cleanup jobs and marks running ones `cancel_requested`, cancels unclaimed publish intents that have not crossed the submission barrier, inserts a queued `cleanup` job and a pending outbox event, and records the receipt. Returns `202 AcceptedOperation` + `Location` to the job. Replaying the original key still returns the same job; any other access returns 404.
- Job status (G02, minimal): owner-scoped JobView; after deletion only the cleanup job remains visible and its result omits content. No cancel/retry actions yet.
- Shared: `lib/canonical.ts` (canonical JSON + SHA-256, now also used by migrations — checksums unchanged, verified against Atlas), `jsonList`/`readQuery`/`notFound` and error `details` in `server/http.ts`.

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 36 web tests (12 database, 12 auth, 3 return-path, 9 project contract) passed |
| Contract tests | `apps/web/tests/projects.test.ts`: real route handlers, two signed-in users, MongoDB 8.2.6 replica set | 401 without session on every route; 403 without/with wrong Origin; create defaults + draft/conversation committed together; preference voice snapshot; code-point title bounds and unknown-field rejection; idempotent replay, key reuse 409, missing key 422, unconsumed key after validation failure, 5 concurrent same-key creates → 1 project; cross-user/malformed/unknown IDs 404 and absent from lists; complete cursor walk in sort order, filters, tampered/foreign/filter-mismatched cursor 400, invalid query 400; rename CAS incl. two-tab race (one 200, one 409) and VIDEO_NOT_READY; delete conflict/validation, 202 operation, tombstone hides project, cleanup job visible only to owner, other jobs hidden, queued job and scheduled intent cancelled, outbox event pending, replay returns same job, new key 404 |
| Atlas schema | `npm run db:status` | Schema matches the catalog (migration checksums unchanged after moving canonical JSON) |
| Production build | `npm run build` | Passed; `/api/projects`, `/api/projects/[id]`, `/api/jobs/[id]` dynamic |
| Live dev server | curl | All three routes return 401 without a session; POST without Origin → 403 |

No projects were created in the Atlas database by these checks. No paid API calls, deployment or Git commit (user direction).

### Remaining limitations

- No worker executes cleanup jobs yet: deleted projects are tombstoned (inaccessible) but their draft/conversation records and the outbox event wait for the job system (F13). Cleanup job deadline is 7 days.
- Request-level rate limits for project routes are not yet enforced (login throttling only).
- OpenAPI generation from the Zod schemas (API_DESIGN.md section 15) is not yet produced.
- After a dev-server-time route addition, the running `next dev` needed a restart to register `/api/projects`.

## F04 — implementation record

Scope: sign-in, operator-assisted recovery guidance and protection for private pages. The video library itself is F06.

- `/sign-in` (`app/sign-in/page.tsx`, `components/auth-forms.tsx`): screen 01/23 spec — compact centered form, Work email + Password with Show/Hide toggle, orange `Sign in →`, "Need help signing in?", internal-access note, no signup or social login. Generic inline error for invalid credentials (same message for every failure kind); rate-limit message using `Retry-After`; out-of-date page (Origin) and service-unavailable messages with request reference. Password cleared and focused after a failure; `role="alert"` error; `autocomplete` username/current-password; 44px+ targets. Signed-in visitors are redirected to their return path. `?reason=expired` shows the session-ended state: "Your video generation continues. Sign in with the same account to return where you left off."
- `/sign-in/help` (screen 02 spec): "Contact your administrator to restore access", no reset form or fake channels, explicit non-enumeration note, Back to sign in. `?reason=unavailable` shows "Access unavailable" for authenticated-but-disabled accounts.
- Private route protection (`server/auth/dal.ts`): data-access-layer `requirePrivateSession(path)` (React `cache`, `server-only`) re-validates the Better Auth session **and** internal admission on every private page render, following the Next.js 16 guidance not to rely on layouts. Missing session → `/sign-in?next=…`; ended/forged session → `…&reason=expired`; disabled access → `/sign-in/help?reason=unavailable`.
- Return paths (`lib/return-path.ts`): only same-origin relative paths ≤512 chars; rejects scheme/protocol-relative/backslash/control-character paths and `/api`, `/sign-in` targets; defaults to `/videos`.
- `/videos` (`app/(private)/videos/page.tsx`, `components/private-shell.tsx`): first private page with app chrome (My videos nav, account email, Sign out). Content states truthfully that the library is not built yet and nothing is stored. Sign out calls the facade and returns to `/sign-in`.
- Public header gains a "Sign in" link. Styles use only the approved Cinema tokens (`globals.css`).
- The Stitch preview links in `design/SCREEN_REVIEW_INDEX.md` now return HTTP 403, so the screens were implemented from the written specifications in `design/ALL_SCREENS_STITCH_NOTES.md`/`DESIGN_QA_NOTES.md`, not by pixel comparison.

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 27 web tests (12 database, 12 auth, 3 return-path) passed |
| Production build | `npm run build` | Passed; `/sign-in`, `/sign-in/help`, `/videos` dynamic |
| HTTP protection (production build, temporary in-memory database, throwaway account) | curl | Anonymous `/videos` → 307 `/sign-in?next=%2Fvideos`; forged cookie → `…&reason=expired`; sign-in 200; signed-in `/videos` 200 with user; signed-in `/sign-in` → 307 `/videos`; sign-out 204; `/videos` afterwards → 307 sign-in; hostile `next=https://evil.example` resolves to `/videos` |
| Real browser flow (headless Chrome via DevTools protocol, typed input) | scripted run | Redirected to sign-in; wrong password shows generic alert and clears password; Show toggles to text; correct password lands on `/videos` with heading and account email; session cookie not readable by JavaScript (HttpOnly); Sign out returns to `/sign-in`; `/videos` then redirects to sign-in |
| Desktop/mobile review | [Sign-in desktop](design/verification/f04-signin-desktop.png), [error state](design/verification/f04-browser-error.png), [expired, 390px](design/verification/f04-signin-mobile.png), [help, 390px](design/verification/f04-help-mobile.png), [videos desktop](design/verification/f04-browser-videos.png), [videos 390px](design/verification/f04-browser-videos-mobile.png) | Inspected; no horizontal overflow at 390px |

The temporary database and test account existed only in memory and were discarded; the Atlas database was not used for these checks. No paid API calls, deployment or Git commit (user direction).

### Remaining limitations

- No pixel-level comparison with the Stitch screens (preview links expired); founder visual review of the implemented pages is still advisable.
- Same-user restoration of unsaved local edits after expiry applies once editable drafts exist (F07); the return path is preserved now.
- Mobile private header wraps the account row above navigation; a fuller app shell (Instagram, Settings) arrives with F17/F18.
- Automated accessibility audit (axe/screen reader) not yet run; semantics were reviewed manually.

## F03 — implementation record

Scope: server-side accounts and sessions only. The sign-in page, recovery UI and private-route protection are F04.

- Better Auth 1.7.7 (pinned) with its MongoDB adapter, given the shared `MongoClient` so adapter transactions are available (`apps/web/server/auth/auth.ts`). Email/password only; `disableSignUp`, `autoSignIn:false`, 12–128 character passwords for provisioning, seven-day session with daily server renewal, cookie cache disabled, telemetry disabled. Better Auth's native HTTP handler is **not mounted**; `/api/auth/*` returns 404, so no signup or alternate token route is reachable.
- Admission (`server/auth/access.ts`): a session requires an `internalAccess` record that is enabled, `active` and linked to that exact user. Enforced in a Better Auth `session.create.before` hook (no session is ever created otherwise) and rechecked on every `GET /api/session`. Email normalization = trim + lowercase, matching Better Auth's lookup; dots and plus tags are preserved.
- Session facade (`server/auth/session.ts`, `app/api/session/**`): `POST /api/session/sign-in`, `GET /api/session`, `POST /api/session/sign-out` per API_DESIGN.md section 3. Exact Origin required for sign-in/sign-out; JSON only, 256 KiB cap, strict body (`email ≤254`, `password 1..128`, unknown fields rejected). Wrong password, unknown email, invalid email, pending allowlist-only entries and users without admission all return the same `401 INVALID_CREDENTIALS`. Disabled-but-authenticated sessions get `403 ACCESS_DISABLED`; missing vs ended sessions return `UNAUTHENTICATED` vs `SESSION_EXPIRED`. `SessionView` omits tokens; `workspaceId = user.id`; `capabilities` are false because generation/publishing do not exist yet. Responses carry `X-Request-Id` and `Cache-Control: private, no-store`; Set-Cookie is forwarded from Better Auth (HttpOnly, SameSite=Lax; `Secure` when the origin is HTTPS).
- Login throttling (`server/auth/rate-limit.ts`): failed attempts counted in `rateLimitBuckets` per HMAC(email) and HMAC(IP), 5 and 30 per 15-minute window, `429 RATE_LIMITED` with `Retry-After`. Raw emails/IPs are never stored. IP is read from `X-Forwarded-For`, which is trustworthy only behind the hosting proxy.
- Operator CLI (`scripts/access.ts`, `npm run access -- …`): `provision <email> [--name]` (idempotent: pending → create/find user through Better Auth's internal adapter → link → active; never overwrites an existing password), `disable` (revokes all sessions), `enable`, `reset-password` (replaces password, revokes sessions), `list`. Passwords come from a hidden prompt or stdin and are never logged.
- Migration `0002-auth-indexes`: the indexes Better Auth's schema declares for the adapter collections (`user.email` unique, `session.token` unique, `session.userId`, `account.userId`, `verification.identifier`). No validators on adapter-owned collections. `verifySchema` checks them.
- Shared HTTP helpers (`server/http.ts`): envelopes, error mapping (unexpected errors → `500 INTERNAL_ERROR` with request ID, redacted server log), Origin check and bounded JSON parsing.
- `apps/web/.env.local` now holds a locally generated `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL=http://127.0.0.1:3000` (not printed or recorded). Dependencies: `better-auth` 1.7.7, explicit `zod` 4.6.7 in the web workspace.

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and tests | `npm run check` | Both typechecks; 23 prototype tests; 24 web tests (12 database + 12 auth) passed |
| Auth integration | `apps/web/tests/auth.test.ts`, real Better Auth + MongoDB 8.2.6 replica set, facade handlers | Signup disabled (server API rejects, no `/api/auth` route); provisioning idempotent, password hashed and never overwritten, 12-character minimum; SessionView shape, HttpOnly cookie, no token, seven-day expiry; identical generic 401 for five failure kinds incl. user without admission and allowlist-only entry; Origin/JSON/415/422/413 validation; per-email and per-IP throttling with Retry-After and no raw identifiers stored; sign-out ends only that session, expires cookie, idempotent; disable revokes sessions and blocks sign-in, enable restores; disabled access with live session → 403; password reset revokes sessions |
| Atlas migration | `npm run db:migrate` | `0001` already applied; `0002-auth-indexes` applied; schema matches catalog |
| Production build | `npm run build` | Passed; `/api/session`, `/api/session/sign-in`, `/api/session/sign-out` dynamic; pages unchanged |
| First approved account | Operator ran `npm run access -- provision you@example.com` (hidden prompt); `npm run access -- list` | `you@example.com active enabled=true linked=true`. A first attempt with an under-12-character password was rejected before any write; the hidden prompt was separately verified in a pseudo-terminal (15 typed characters received; mismatch detected) |
| Live dev server + Atlas | curl against `npm run dev` | `GET /api/session` → 401 UNAUTHENTICATED with request ID and no-store; unknown-email sign-in → 401 INVALID_CREDENTIALS; missing Origin → 403; sign-out without cookie → 204 with expired cookies; `/api/auth/sign-up/email` → 404 |

The automated checks created no accounts in Atlas; the only account is the operator-provisioned one above. No paid API calls, deployment or Git commit (user direction).

### Remaining limitations

- Operator recovery replaces the password directly at the CLI; a one-use reset link flow belongs with the F04 recovery UI.
- Disabling access revokes sessions but cannot yet cancel queued generation or pause publishing (those systems are F13/F19).
- Cookies are not `Secure` on the local HTTP origin; they become `Secure` automatically with an HTTPS `BETTER_AUTH_URL`.
- The client IP for throttling trusts `X-Forwarded-For`; deployment must ensure the proxy overwrites it.

## F02 — implementation record

Scope: database foundation only. No API routes, auth collections, repositories or domain transactions; those belong to F03 onward.

- `apps/web/server/db/config.ts`: reads `MONGODB_URI`, `MONGODB_DB_NAME`, optional `MONGODB_MIGRATION_URI` and `MONGODB_MAX_POOL_SIZE`. Fails with an actionable `DatabaseConfigError` when unconfigured, rejects non-Mongo schemes, reserved database names (admin/local/config) and invalid pool sizes. Errors never include the URI; `redactConnectionStrings` scrubs driver messages.
- `apps/web/server/db/client.ts`: one bounded `MongoClient` pool per server instance (cached on `globalThis` for dev reloads), majority write concern, retryable writes, 10 s server selection. `describeDeployment` reports version, topology and transaction support.
- `apps/web/server/db/schema.ts`: all 28 application collections from DB_DESIGN.md section 5 with `$jsonSchema` validators (`additionalProperties:false`, Base/Owned/ProjectOwned fields, BSON Int32/Int64/Date types, enums, bounds, ID and hash patterns) plus within-document `$expr` invariants: job active-slot rule, ready/approved video evidence, ready asset hash/bytes, media grant project scope, publish intent deadline/unresolved/published evidence, payload schedule presence, expiry after creation. All 66 named indexes: the 56 section 7 catalog rows (five `project_flag_*` indexes) plus six `cleanup_owner_project` indexes, with partial unique and TTL options as specified.
- `apps/web/server/db/migrations.ts`: operator migration `0001-initial-collections` with immutable name + SHA-256 checksum, `schemaMigrations` ledger, fenced lease, failed/abandoned takeover, idempotent create-or-collMod, strict/error validation. Never drops indexes; a conflicting existing index or duplicate data fails as `SCHEMA_CONFLICT` and is recorded. `verifySchema` is a read-only comparison of validators, indexes and ledger.
- `apps/web/scripts/db.ts`: `npm run db:migrate` and `npm run db:status` (root or `apps/web`). Refuses deployments without transactions. Notes when the application credential is used for migration.
- Dependencies (pinned): `mongodb` 7.7.0; dev `mongodb-memory-server` 11.3.0 and `tsx` 4.20.6. Root `npm run check` now also runs `test:web`.
- `apps/web/.env.example` documents the variables. `apps/web/AGENTS.md`/`CLAUDE.md` were generated by `next dev` 16.3.8 (agent rules block); left unmodified.

Deliberate boundaries: nested contract shapes (PlanV2, render spec, job input snapshot/result, command response, outbox payload IDs, migration checkpoint) are validated as BSON objects only; their full shapes are enforced by the shared runtime contract when F07/F09/F13 build those writers. Cross-collection references, state transitions and immutability are service rules, not database constraints.

### Verification

Verified October 19, 2026, locally under Node 24.21.0:

| Check | Command or evidence | Result |
| --- | --- | --- |
| Types and regression tests | `npm run check` | Prototype and web TypeScript passed; 23 prototype tests and 12 database tests passed |
| Real replica set | `apps/web/tests/db.test.ts` via mongodb-memory-server, MongoDB 8.2.6 single-node replica set | Transactions available; real validators, indexes and transactions exercised (no mocks) |
| Full schema creation | Migration test + `verifySchema` | 28 collections strict/error; 66 named indexes match; no unlisted indexes; TTL options present |
| Catalog completeness | Scripted comparison of DB_DESIGN.md section 7 rows against `schema.ts` | All 56 rows present; only additions are the six documented cleanup indexes |
| Idempotency | Rerun migration | `already_applied`; indexes unchanged; one ledger record |
| Concurrency | Three simultaneous runs | Exactly one applied; others `MigrationInProgressError`; schema verified |
| Checksum immutability | Altered checksum | `MigrationChecksumError` |
| Conflict handling | Pre-existing `project_list` with different keys | Migration fails `SCHEMA_CONFLICT`, recorded failed; after operator fix, rerun completes |
| Validators | Projects, jobs, publish intents | Valid insert accepted; missing/unknown/mistyped fields, bad ID, Int32 for Long, wrong schemaVersion, invariant violations rejected |
| Partial unique indexes | Jobs, Instagram connections, publish intents | One active job per project; many disconnected connections, one per account; one unresolved intent per content key |
| Transactions | Commit + validation-failed abort | Commit atomic; aborted transaction leaves no partial records |
| Missing configuration | `npm run db:status` with no `apps/web/.env.local` | `DatabaseConfigError: Database is not configured: set MONGODB_URI in apps/web/.env.local.`; exit 1 |
| Production build | `npm run build` | Passed; routes unchanged (`/`, `/foundation`, not-found) |
| Atlas development database | `npm run db:migrate` (twice) and `npm run db:status` with `apps/web/.env.local` (M0 free cluster, AWS) | MongoDB 8.0.34, replica set, transactions available; first run `applied`, second `already applied`; status: schema matches the catalog (28 collections, 66 indexes, ledger completed) |

No paid API calls, renders, publication or deployment were performed. Git is not in use for this local copy at the user's direction, so no commit or push was made.

### Remaining limitations

- The Atlas database user was auto-created with Atlas Admin rights and is currently used for both the app and migrations. Create a least-privilege application user and a separate operator credential before any shared or deployed environment.
- Atlas network access currently allows only the developer's current IP; it must be updated if that IP changes.
- Least-privilege separation (application user without index/validator privileges; separate operator user) must be configured in Atlas; the code supports `MONGODB_MIGRATION_URI` but cannot enforce roles.
- Migration lease has no heartbeat; a run exceeding 10 minutes could be taken over. Steps are idempotent, and the initial migration is short.
- No `server-only` import guard yet; DB modules are not imported by any route or client component.

## Earlier evidence

The local pipeline history is retained in PROTOTYPE_STATUS.md. It records three generated videos, Gemini/ElevenLabs integrations, timing checks, and renderer recovery tests. Those historical results are not evidence that a hosted pipeline or dashboard works. Existing design artifacts remain in design/SCREEN_REVIEW_INDEX.md; the founder approved proceeding with implementation on October 1, 2026, with background colors normalized to the Cinema tokens.

## Change log

| Date | Feature | Change | Verification |
| --- | --- | --- | --- |
| 2026-10-01 | Repository setup | Prepared initial public repository snapshot of the prototype, scaffold, specifications and design evidence; added standing milestone commit/push workflow | Remote confirmed empty; publishable text scanned for common credential patterns with no matches; environment and generated-media exclusions verified; F01 checks above remain applicable (no runtime code changed). Push result is verified against the remote and reported at handoff. |
| 2026-10-20 | Fix (voice errors) | ElevenLabs refusals classified by `detail.status` (quota, busy, invalid key/permissions, unusual activity, unknown) with safe messages; unknown 401/403 and quota/busy are retryable; recorded scenes kept. Found when a user generation got a transient 401 after 2 of 7 scenes (a 2-character diagnostic request then succeeded); that job was made retryable | `tests/elevenlabs.test.ts` (2), `npm run check` (23 + 151 tests) |
| 2026-10-20 | F19 (live) | First real end-to-end run: ElevenLabs narration → render → approval → Reel published to the user's Instagram; fixed JSON-serialized QA date in finalize, QA re-check on render re-entry, `onFailure` → retryable failure | User-run in the UI; `npm run check`; one confirmed publish attempt |
| 2026-10-20 | F19 | U02–U04/U06/U07 Post now with frozen payloads, delivery worker with submission barrier and reconciliation, Inngest runner + minute scanner, media-only tunnel script, Publish step UI | `npm run check` (23 + 147 tests), build, real-browser run on a real render with a fake publisher, tunnel proxy check; nothing posted; no Git commit (user direction) |
| 2026-10-20 | F18 | Instagram Login connect/callback/connection/disconnect, AES-256-GCM tokens, refresh cron, settings panel, local HTTPS dev front door; F17 timezone-suggestion fix | `npm run check` (23 + 141 tests), build, live authorize-URL acceptance, real-browser run, live account connected by the user; no Git commit (user direction) |
| 2026-10-20 | F17 | P08/P09 preferences with IANA timezone and voice validation, settings page, future-project voice snapshot with fallback | `npm run check` (23 + 132 tests), build, real-browser run; no Git commit (user direction) |
| 2026-10-20 | F16 | Caption source spans and overrides, V03/V04 caption correction with meaning guard, caption_render jobs reusing speech, Captions and Revise tabs | `npm run check` (23 + 127 tests), build, real-browser run with real renders; no Git commit (user direction) |
| 2026-10-20 | F15 | V01/V02 video views, V05 exact-version approval, review page with versions, playback, download and approval | `npm run check` (23 + 122 tests), build, real-browser run on two real renders; no Git commit (user direction) |
| 2026-10-20 | F14 | Timeline compiler with pronunciation-aware captions, local Remotion renderer + prober, compile/render/finalize stages with QA, video preview | `npm run check` (23 + 118 tests), build, real 79 s local render with all checks passing (silent narration, no ElevenLabs); no Git commit (user direction) |
| 2026-10-20 | F13 | G01 approve & generate, fenced stage runner with speech caching and unknown-outcome protection, G03/G04, Inngest functions + outbox dispatcher, project cleanup worker, video progress UI | `npm run check` (23 + 110 tests), build, real Inngest Dev Server end-to-end (no ElevenLabs usage); no Git commit (user direction) |
| 2026-10-19 | F12 | R2 object store, verified asset storage, V06 access grants, media gateway with ranges, voice catalog moved to R2 | `npm run check` (23 + 101 tests), build, real-R2 end-to-end and browser preview playback from R2; no Git commit (user direction) |
| 2026-10-19 | F11 | Conversational revisions (S08) with scene-scoped preservation and server diff, restore (S07), story approval (T05 approval half, documented adjustment), revise/review/approve/history UI | `npm run check` (23 + 95 tests), build, real-browser flow with real Gemini and no console errors; no Git commit (user direction) |
| 2026-10-19 | F10 | Apply (S06), DraftPlanV2 editing with issues, create-storyboard flow, storyboard review screen with schematic previews, 6–8 scene planner limit | `npm run check` (23 + 87 tests), build, real-browser flow with real Gemini and no console errors; no Git commit (user direction) |
| 2026-10-19 | F09 | PlanV2 contract + registry, Gemini planner with deterministic compilation and bounded repair, shared job core, storyboard job and read APIs | `npm run check` (23 + 82 tests), build, real-Gemini planner runs and HTTP end-to-end success; no Git commit (user direction) |
| 2026-10-19 | F08 | Idea page with autosave/conflict UI, brainstorm job (S02) with interim runner, Gemini adapter, voices API, narrator preview (sample generation + authenticated route), project-unavailable screen, library links | `npm run check` (23 + 62 tests), build, real-browser flows with one real Gemini request and real sample playback, no console errors; no Git commit (user direction) |
| 2026-10-19 | F07 | Draft GET/PATCH API with CAS and parent fence, voice catalog, shared draft rules, autosave controller, shared test harness | `npm run check` (23 + 47 tests), build, live 401 check; no Git commit (user direction) |
| 2026-10-19 | F06 | My videos library UI: server-rendered first page, create/sample topics, filters, load more, states, rename/delete dialogs, API client with session handling | `npm run check` (23 + 36 tests), build, real-browser flow with no console errors, desktop/mobile screenshots; no Git commit (user direction) |
| 2026-10-19 | F05 | Project create/list/get/rename/delete APIs, idempotency receipts, signed cursors, tombstone deletion with cleanup job/outbox, minimal job status | `npm run check` (23 + 36 tests), build, Atlas status and live 401/403 checks passed; no Git commit (user direction) |
| 2026-10-19 | F04 | Sign-in and access-help pages, data-access-layer route protection, validated return paths, protected /videos with sign-out | `npm run check` (23 + 27 tests), build, production HTTP checks and real-browser flow with desktop/mobile screenshots; no Git commit (user direction) |
| 2026-10-19 | F03 | Better Auth sessions, internal admission, session facade routes, login throttling, operator CLI, auth-index migration | `npm run check` (23 + 24 tests), build, Atlas `0002` migration and live curl checks passed; first approved account provisioned and verified; no Git commit (user direction) |
| 2026-10-19 | F02 | MongoDB config/client, 28-collection strict schema, 66-index catalog, operator migration and status commands, integration tests; applied to Atlas dev database | `npm run check` (23 + 12 tests), MongoDB 8.2.6 replica set, build passed; Atlas 8.0.34 migrate/rerun/status passed; no Git commit (user direction) |
| 2026-10-01 | F01 | Completed isolated Next.js scaffold, Cinema primitives, runtime configuration and status workflow | Node 24 production build, both typechecks, 23 tests, HTTP boundary checks and desktop/mobile review passed; evidence above |
