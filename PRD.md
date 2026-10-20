# NamasteVideo.ai — Final V1 Product Requirements Document

Version: 2.0  
Date: September 24, 2026  
Status: Final planning baseline for internal V1; implementation has not started  
Product name: NamasteVideo.ai  
Release audience: Founder and approved team members, each acting as an independent creator

## 1. Product summary

NamasteVideo.ai is a web application that turns an idea or teaching notes into a 60–90-second educational video with AI narration, explanatory motion graphics, and synchronized captions. A creator reviews a combined script and storyboard, approves generation, previews the result, and downloads, publishes, or schedules the video for Instagram.

The product hides production complexity behind four steps:

**Idea → Review storyboard → Generate and review video → Publish**

The creator approves the story before rendering and approves the finished video before publishing. Writing, scene planning, voice generation, timing, animation, captioning, and export are coordinated automatically.

The initial experience prioritizes clear explanations and easy corrections. A technically valid video that contains misleading visuals, unreadable text, or poorly synchronized narration does not meet the product promise.

The brand is intentionally broad enough to support other video formats in future versions. Educational explainers are the V1 scope, not a permanent restriction on the brand. Finalizing the product name does not imply that the domain has been checked, registered, or acquired.

## 2. Decisions and implementation defaults

### 2.1 Agreed product decisions

| Area | V1 decision |
|---|---|
| Product name | NamasteVideo.ai |
| Release | Internal testing only, for the founder and approved team members |
| Workspace | Private dashboard, ideas, conversations, projects, and assets for every individual |
| Instagram ownership | Each user connects their own account; no shared destination |
| Language and audience | English narration and captions, initially targeting Indian audiences |
| Voice choice | Indian English — Male or Indian English — Female, with previews |
| Visual direction | Minimal editorial motion graphics: icons, diagrams, illustrations, text, and purposeful animation |
| Content | Educational explainer videos |
| Duration | AI targets 60–90 seconds; no mandatory duration selector |
| Workflow | Four steps, with script and storyboard reviewed together |
| Planning | Enter an idea, paste notes, or brainstorm with AI |
| Video | Explanatory motion graphics synchronized with AI narration |
| Captions | Included automatically and editable |
| Changes | Conversational revisions at storyboard and video stages |
| Delivery | Preview, vertical 1080p MP4 export, Instagram publishing and scheduling |
| Persistence | Accounts, project library, autosave, generation status, recovery |
| Branding | No brand kit, logo upload, or user-configurable branding controls |
| Billing | No subscription checkout, credit balance, billing dashboard, or user-facing API costs |
| AI and video tools | Gemini, ElevenLabs, Remotion, and Meta API |
| Application stack | Next.js / TypeScript with Node.js backend endpoints, MongoDB Atlas, Cloudflare R2, Vercel |
| Supporting services | Better Auth for authentication; Inngest for durable workflows; Vercel Sandbox as the initial hosted rendering candidate |
| Backups | No dedicated backup, restore, or disaster-recovery system in V1; retry/regenerate supported |

### 2.2 Implementation defaults

The following defaults complete the agreed scope without adding creator-facing complexity. Exact voice IDs and infrastructure limits are selected during implementation tests.

- English is the only V1 output language. Indian English is an accent choice, not a separate language or a Hindi/Hinglish mode.
- Offer two curated voice presets on the Idea screen, with a short sample and the last-used choice preselected. Do not require a separate onboarding step.
- Use one minimal visual style. Do not expose a style gallery, brand kit, or theme editor.
- Provide one private personal workspace and one Instagram connection per user, with one owner per project. A project can contain multiple immutable video revisions.
- Use Better Auth with email/password sign-in and an approved-email allowlist for the internal release. Provision access internally; do not build an organization/invitation management product. No shared login.
- Support vertical 9:16 output only, at 1080 × 1920 and initially 30 fps.
- Use Gemini 3.8 Flash (`gemini-3.8-flash`) as the initial planning model and Eleven Multilingual v2 (`eleven_multilingual_v2`) as the initial narration model, following the tooling discussion. Verify current account access and run quality checks before pinning deployment configuration.
- Keep Eleven v3 as a voice-evaluation candidate rather than an automatic fallback or additional dashboard option.
- Do not include background music in V1.
- Begin with eight reusable motion patterns: title/hook, labeled diagram, process flow, comparison, timeline, chart, step sequence, and takeaway.
- Keep ordinary project data and generated assets in MongoDB/R2. No backup project or retention-policy engine is required for internal V1.
- Keep simple operational limits, logs, and bounded retries. Do not build billing, credit accounting, a cost dashboard, or a metering subsystem.

### 2.3 Changes from PRD 1.0

- Finalized NamasteVideo.ai as the product name.
- Narrowed release scope to internal testing, while preserving individual creator accounts and strict data isolation.
- Confirmed English, an initial Indian audience, and male/female Indian English voice presets.
- Specified the minimal visual direction and application infrastructure.
- Clarified per-user Instagram authorization through a Connect Instagram button.
- Removed dedicated backup requirements, public-launch gates, and billing-related launch concerns.

## 3. Audience, problem, and value

### Primary audience

The founder and approved team members are the actual V1 users. Each uses the app as an independent creator with private content and their own Instagram destination. They will test English educational explainers intended initially for Indian viewers.

The future audience can include creators, educators, brands, and other video producers. Shared team workspaces and public registration are not part of this internal release.

### Primary job to be done

“When I have something useful to teach, help me turn it into a clear, attractive short video that I can review and publish with minimal manual production work.”

### Problems addressed

- Turning a topic into a concise, engaging explanation takes time.
- Matching visuals to narration requires animation and editing skills.
- Producing captions and managing timing adds repetitive work.
- Correcting a small mistake often requires rebuilding or re-editing a video.
- Moving approved files into a separate publishing process creates friction.

### Product differentiation hypothesis

Creators will value relevant explanatory visuals, straightforward corrections, and a dependable idea-to-publishing workflow. This hypothesis must be validated through actual published videos and repeat use; it is not an established market claim.

## 4. Goals, non-goals, and success measures

### Goals

1. Help a first-time creator produce a usable explainer without understanding video production.
2. Produce motion that communicates the explanation rather than merely decorating narration.
3. Keep narration, animation cues, and captions on one consistent timeline.
4. Let creators correct content through plain-language requests.
5. Preserve drafts and previous successful outputs through interruptions and failed operations.
6. Publish only the exact version and destination the user approved.

### Explicit non-goals

- General-purpose cinematic text-to-video generation or complex character animation.
- AI avatars, face animation, or voice cloning.
- Full timeline editing or frame-by-frame editing tools.
- Branding controls or custom theme editors.
- User billing, subscriptions, credit purchases, and user-facing provider costs.
- Shared team workspaces, cross-user project sharing, client approvals, collaboration, or roles beyond an owner.
- Public signup, a public commercial launch, and enterprise administration.
- Dedicated backups, restore tooling, disaster recovery, and a sophisticated retention system.
- Bulk generation, recurring topic generation, or unattended creation-to-publishing.
- Platforms other than Instagram, or Instagram Stories and carousels.
- Video uploads, PDF ingestion, arbitrary website scraping, or automatic research from the open web.
- Guaranteed factual correctness, reach, engagement, or educational outcomes.
- Multilingual dubbing and multiple aspect ratios.

### Internal testing measures

Measure these before establishing business performance promises:

| Metric | Definition | Initial evaluation target |
|---|---|---|
| Activation | New users who export or publish a first video | Observe during internal testing |
| Usable output | Completed videos creators judge ready after at most two revision rounds | At least 80% in the internal evaluation set |
| Hands-on time | Active creator time from idea entry to final approval, excluding generation waits | Median at or below 10 minutes |
| Generation success | Valid approved storyboards that produce a validated playable output | At least 95% on the supported evaluation set |
| Narration duration | Final video duration including transitions and ending | Every approved export within 60–90 seconds |
| Publishing correctness | Posts match approved account, video, and caption | 100%; duplicate unintended posts are release blockers |
| Repeat use | Creators returning to make another video within 7 days | Observe during internal testing |
| Prototype resource usage | Review provider dashboards and render duration on sample videos | Inform development choices; no in-app metering feature |

Generation latency is not promised before a benchmark. A provisional target is a first preview within five minutes for a typical video under light load; report measured median and p95 and revise this target before internal release.

## 5. Information architecture and screens

### Dashboard

- Show only the signed-in user’s projects, drafts, conversations, and publishing status.
- A prominent **Create video** action.
- Project cards showing title, preview thumbnail when available, last update, and current state.
- Simple filters: All, Drafts, Ready, Scheduled, Published, Needs attention.
- Empty state with one example topic and the create action.
- Project actions: open, rename, download an available export, and delete with confirmation.
- A lightweight personal Instagram connection area and account settings.
- No team workspace switcher, colleague project list, or shared media library.

No analytics suite, billing navigation, brand settings, or advanced production settings in V1.

### Project workspace

- A four-step progress indicator.
- The active step’s main content and one prominent next action.
- An expandable conversational revision panel where relevant.
- Autosave status and clear operation status.
- Access to the last successful version when a revision is underway or fails.

### Publishing area

- Final video preview, destination account, post caption, and thumbnail preview.
- Download, Post now, and Schedule actions.
- Scheduled date/time shown in the selected timezone.
- Publishing status, failure recovery, and a link to the post when confirmed.

## 6. End-to-end user flows

### Flow A: First video from a topic

1. User signs in and selects Create video.
2. User enters a topic; optionally adds audience context or notes, and keeps or changes the Indian English male/female voice preset.
3. User selects **Create storyboard**.
4. AI produces a title, learning objective, narration, scene previews, and motion descriptions.
5. User reviews the combined script/storyboard, optionally revising through chat.
6. User selects **Approve & generate video**.
7. The system saves an immutable approved storyboard version and starts generation.
8. The user sees progress and can leave and return without stopping the job.
9. The completed video opens in the preview step with captions visible.
10. User requests changes or selects **Continue to publish**.
11. User downloads, posts now, or schedules the approved video.

### Flow B: Brainstorm before creating

1. User enters a broad interest, such as “I teach beginner astronomy.”
2. User asks AI for ideas.
3. AI returns a short list, normally three to five topics, each with an angle and takeaway.
4. User selects a topic or refines the suggestions in conversation.
5. The chosen idea populates the same planning input.
6. User creates a storyboard and continues through Flow A.

Brainstorming is optional. Users with a clear topic can skip it entirely.

### Flow C: Revise a storyboard

1. User requests “Explain this for a 12-year-old” or selects a scene and requests a local change.
2. System interprets the request against the latest saved version.
3. AI proposes an updated storyboard and identifies changed scenes.
4. User can keep the revision or restore the preceding version.
5. User approves the current version before video generation.

If a request is materially ambiguous, ask one focused question. Otherwise use a reasonable interpretation and show what changed.

### Flow D: Revise a rendered video

1. User requests a change from the video preview, optionally selecting a scene.
2. System classifies the change as visual, caption-display, narration, pacing, or structural.
3. If the request changes the story or spoken content, present the revised storyboard in step two for approval.
4. Pure visual or caption-display changes can regenerate from the current approved narration without another story approval.
5. Reuse unaffected assets where valid. Preserve the previous successful video during generation.
6. Show the new preview and require final video approval before publishing it.

### Flow E: Connect and publish to Instagram

1. User chooses Post now or Schedule.
2. If disconnected, open Meta authorization and return to the same project afterward.
3. Check account eligibility and required publishing access.
4. Show the connected account’s identity, exact video version, and editable suggested caption.
5. User explicitly selects Post now or confirms Schedule.
6. System records the approved publishing payload and starts or queues delivery.
7. UI shows progress and then a confirmed result or actionable failure.

Downloading never requires an Instagram connection. Publishing must not become a prerequisite for creating or exporting videos.

### Flow F: Resume interrupted work

1. User closes the tab during planning, rendering, or publishing.
2. Backend work continues where already submitted.
3. On return, the project loads persisted content, operation state, and the latest valid version.
4. UI reconciles with the server instead of starting another operation.
5. Failed operations offer Retry when safe or an explanation of what must change.

### Flow G: Independent internal accounts

1. An approved team member signs in using their own account.
2. The app creates or loads their personal workspace; no colleague content is visible.
3. Their first project starts with the default voice preset, then remembers their own preference for future projects.
4. They connect their own Instagram professional account when ready to publish.
5. Signing out and switching users loads the new user’s separate workspace and connection. Cached private data is cleared or scoped by user.

### Flow H: Choose or change narrator

1. On the Idea screen, the user previews Indian English — Male and Indian English — Female.
2. They select a preset and continue without another step.
3. The selected preset is saved to the project; changing the personal default does not change existing projects.
4. If the user changes voice after generation, explain that narration and synchronized timing will regenerate.
5. Preserve the previous successful video, produce a new version, and require final video review.
6. An existing schedule continues to reference the old approved version unless explicitly replaced.

## 7. Functional requirements

### FR-01 Accounts and project ownership

- Require authentication for stored projects and generation. Use individual Better Auth sessions and restrict account access to approved internal email addresses.
- Every user has exactly one private workspace. There is no shared dashboard, shared login, or ordinary user role with access to colleague projects.
- Derive ownership from the authenticated session on the server; never trust a client-supplied owner ID.
- Apply isolation to idea conversations, revisions, preferences, media URLs, job polling, and publishing callbacks as well as project records.
- Provide sign-in, sign-out, and actionable session/account recovery. Internal account recovery can be operator-assisted; public self-service onboarding is out of scope.
- Scope every project, asset, job, and Instagram connection to its owner.
- Sign-out must not cancel server jobs.
- Expired sessions must lead to sign-in and restoration of the project after authentication.
- Use access-controlled media URLs; knowing an asset identifier must not grant access.

Acceptance: a user cannot read, modify, export, or publish another user’s project through the UI, API, or media URLs.

### FR-02 Idea input and brainstorming

- Accept a topic and optional pasted reference notes in one planning area.
- Provide optional audience guidance without a mandatory form.
- Show examples when the input is empty.
- Reject blank submissions and provide a visible input-length limit. Proposed limits: 2,000 characters for topic/context and 20,000 for notes.
- When the topic is too broad, propose a focused angle that fits the duration.
- Use source notes as content, never as instructions that override system behavior.
- Do not invent citations or claim to have researched sources that were not retrieved.
- For time-sensitive requests outside available reference material, ask for notes or flag the limitation in the storyboard.

Acceptance: “Explain photosynthesis to beginners” generates a coherent focused plan; “science” prompts or proposes a narrower topic rather than generating an arbitrary sprawling lesson.

### FR-03 Combined script and storyboard

- Generate one versioned structured object containing the title, audience, learning objective, scene order, narration, visual plan, and animation cues.
- Present the narration inside each scene card; do not create a separate script approval screen.
- Each scene shows its estimated duration and a static representative preview or a clearly labeled schematic.
- Previews must correspond to supported visual components. Do not present an unrelated polished image as a promise of the final animation.
- AI should normally produce approximately six to ten scenes, adjusted to the concept rather than enforced as a rigid rule.
- Show the full narration in a collapsible read-through view if useful.
- Allow inline narration edits and conversational changes. Autosave both.
- Show estimated total duration and any unresolved content or visual limitations.
- Disable generation while required fields are invalid or saves are pending.

Acceptance: the approved storyboard uniquely identifies the narration and visual plan used for generation; subsequent edits cannot silently mutate that approved input.

### FR-04 Duration and pacing

- Default to a 60–90-second total video, with AI choosing the appropriate length.
- Do not expose a 30/60/90 selector in V1.
- Treat initial duration as an estimate, then validate against actual synthesized speech and transition timing.
- Target comfortable explanatory speech; never force the range by excessively speeding up narration or inserting long filler.
- “Make it shorter” targets the lower end of the supported range; “add more detail” targets the upper end.
- A request for 30 seconds or three minutes gets a clear explanation of the V1 range and an offer to adapt the content.
- If meeting the range requires a substantive narration change after approval, return the changed script for approval instead of silently rewriting it.

Acceptance: completed exports are 60–90 seconds inclusive, accounting for all scene transitions and the final hold.

### FR-05 Motion-graphics production

- Build videos from reusable, parameterized components rendered by Remotion.
- Support animated diagrams, labels, arrows, icons, comparisons, step sequences, simple charts, and text emphasis.
- Have the model describe scene intent and component parameters in a validated schema. Avoid executing arbitrary AI-generated application code in production.
- Map visual events to specific narration phrases or word spans, not just generic scene starts.
- Distinguish literal relationships from decorative motion; arrows, scale, chart values, and labels must agree with the script.
- Use only factual chart data provided by the user or explicitly identified as illustrative. Do not invent numerical evidence.
- Reserve space for captions and keep important content away from likely platform overlays. Validate the safe-area configuration on real devices.
- When a concept cannot be represented adequately, simplify the approved visual plan or ask the user to narrow it. Do not silently replace it with irrelevant stock imagery.

Acceptance: a process scene builds its stages as they are explained; changing one scene’s visual parameters does not unintentionally alter another scene’s narration.

#### Visual system specification

- Use a light neutral background, dark text, and a restrained accent palette shared across components.
- Keep icons and vector illustrations consistent in stroke weight, corner treatment, and level of detail.
- Present one primary concept per scene. Use progressive disclosure instead of displaying every diagram element at once.
- Animate to communicate causality, direction, sequence, comparison, or emphasis. Avoid random bouncing, particles, decorative clutter, unnecessary zooms, and distracting transitions.
- Use short headings and labels alongside diagrams; captions remain a distinct transcription layer rather than duplicating every label.
- Reserve a caption zone and a separate visual area. Check the layout at phone viewing size, not only on the render canvas.
- Use a clear hierarchy: primary diagram/object, explanatory labels, then secondary context. Do not rely only on color to distinguish meanings.
- Use Indian examples and familiar units where they help the chosen topic, without forcing cultural references into unrelated explanations.
- No photorealistic footage or separate image-generation provider is required for the initial component library. Add such capability only if a future scope decision justifies it.

Example: for “How does the internet work?”, show a phone, router, and server; progressively connect them; move packets along the paths in time with narration; reveal concise labels only as each part is introduced.

### FR-06 Narration

- Use ElevenLabs through a server-side provider adapter, initially with `eleven_multilingual_v2`.
- Offer two curated Indian English voice presets labeled Male and Female, each with a short preview. Select exact provider voice IDs through listening tests in the configured account.
- English narration and captions are fixed in V1; do not expose a language selector.
- Persist the selected preset and resolved voice/model IDs on the project generation version. Remember the user’s last selection only as the default for new projects.
- Changing voice invalidates audio, alignment, captions’ timing, and final rendering, while preserving the approved narration text and compatible visual assets.
- If a voice disappears or loses API access, ask the user to select an available preset rather than silently substituting an accent or voice.
- Generate a consistent voice across scenes, with natural pauses and intelligible pronunciation.
- Choose the supported voice/model combination during a quality evaluation; do not hardcode an untested model solely because it is newest.
- Preserve original script text separately from any provider-specific pronunciation normalization.
- Use timing output from the same audio generation to drive alignment.
- Support pronunciation requests such as “Pronounce SQL as sequel.”
- Detect empty, truncated, corrupt, or unexpectedly long audio before rendering.
- If speech changes, invalidate affected timing, captions, and video output.
- Identify narration as AI-generated in the product; comply with the selected provider’s disclosure and output-use requirements.

Acceptance: exported speech corresponds to approved narration, with no omitted ending, repeated passage, or unexplained voice changes.

### FR-07 Timing and captions

- Include visible captions in every exported video by default.
- Derive caption timing from the generated audio’s alignment rather than estimated reading speed.
- Group character timestamps into words and readable phrases, retaining punctuation and normalized spoken forms.
- Use a maximum of two caption lines at a time, with wrapping that respects the output’s safe area.
- Use a consistent high-contrast caption treatment. The default style is part of the product, not a user branding feature.
- Avoid covering important labels or diagram details; adapt layout when captions would overlap them.
- Expose simple text correction, without a subtitle timeline editor.
- Distinguish caption-only spelling/display corrections from changes to what is spoken. A change in meaning must offer narration regeneration; it must not silently create conflicting subtitles.
- Persist caption text separately from narration so approved display corrections survive unrelated visual revisions.
- If timestamps are missing or invalid, retry or use a tested alignment fallback; do not export an apparently synchronized video with fabricated timings.

Proposed quality gate: sampled phrase starts and important animation cues are within approximately 200 ms of the intended spoken boundary, with human review of a representative evaluation set. Semantic cues can intentionally lead speech when the scene plan specifies that choice.

Acceptance: acronyms, numbers, punctuation, pauses, and corrected spellings display intelligibly and track the audio throughout the final scene.

### FR-08 Conversational revisions

- Support global requests and scene-specific requests from both storyboard and preview screens.
- Explain the changes in a short summary; preserve unaffected content where possible.
- Resolve requests against a specific project version to avoid stale edits.
- When two instructions conflict, clarify the conflict or apply the explicit latest instruction and make the outcome visible.
- Do not change the topic, language, or unrelated scene facts without a reason tied to the request.
- Offer restoration of the previous successful version.
- Editing during generation creates a draft for a later version; the running job continues from its immutable input unless the user cancels it.

Acceptance: “Make scene three’s labels larger” changes the intended scene, keeps narration stable, and produces a new preview without overwriting the previously approved export.

### FR-09 Generation jobs and progress

- Start jobs server-side and return a durable job identifier.
- Show understandable stages: Preparing scenes, Creating narration, Timing visuals and captions, Rendering video, Checking output.
- Do not show fictional percentages. Use stage progress unless measurable progress is available.
- Deduplicate repeated Generate clicks for the same submitted operation.
- Allow only one active generation or revision pipeline per project in V1; additional requests may be saved as a draft.
- Save stage artifacts so a retry can reuse completed work when safe.
- Implement bounded retries with backoff for transient failures; do not repeatedly retry invalid inputs, authorization failures, or policy rejections.
- Allow cancellation. Explain that already-started provider work may finish even after cancellation.
- Never replace a valid existing output until the new output passes validation.

Acceptance: closing the browser, refreshing, or double-clicking Generate does not create duplicate jobs or lose the last valid video.

### FR-10 Preview and export

- Provide play/pause, seek, audio volume, and a clear full-video preview.
- Use the same scene definition and timing for previews and final renders.
- Offer an MP4 with H.264 video and AAC audio as the initial delivery profile, subject to current Instagram validation before implementation.
- Export at 1080 × 1920, with captions included and no creator-configurable logo or branding overlay.
- Display actual duration after rendering.
- Validate playback, audio presence, dimensions, duration, file integrity, and caption bounds before marking Ready.
- A failed or incomplete render must not be offered as a completed export.

Acceptance: the downloaded MP4 matches the reviewed version and plays with synchronized audio and captions on target desktop and mobile browsers/devices.

### FR-11 Instagram connection

- Provide a **Connect Instagram** button using Meta’s official Instagram Login authorization flow, subject to access validation during setup; never request a user’s Instagram password directly.
- Each connection belongs to the signed-in user. Other users cannot inspect, select, or publish through it. V1 has no shared Instagram destination.
- Configure a developer app, app credentials, allowed callback URLs, and required test-account access once at infrastructure level. The creator never pastes an API key or access token into the dashboard.
- Bind the authorization callback to the initiating user and validate anti-forgery state. Reject callbacks with missing/expired state or mismatched sessions.
- Restrict each Instagram account to one user connection in internal V1; if it is already connected elsewhere, show an actionable conflict without revealing the other user.
- App-wide developer credentials authorize the integration; per-user authorization determines the publishing destination. Store them separately.
- Show the connected destination identity before any publish action.
- Support eligible professional accounts; give an actionable explanation and retain download access for unsupported personal accounts.
- Handle authorization cancellation, denied permissions, expired authorization, revoked access, and disconnected accounts.
- Encrypt stored credentials and avoid exposing tokens to client code or application logs.
- Reconnecting a different account must not silently redirect existing scheduled posts.
- Disconnecting must warn about pending schedules and pause those deliveries. Already-submitted publish attempts require reconciliation.

Acceptance: cancelling authorization returns the user to the preserved video; connecting another account never changes an existing schedule’s target without explicit reapproval.

### FR-12 Post now

- Generate an optional suggested post caption from the approved content. The user can edit it or leave it empty if the platform permits.
- Validate current platform constraints before submission.
- Treat clicking Post now on the reviewed payload as explicit authorization to publish that payload once.
- Record exact asset version, account, caption, and request identifier before contacting Meta.
- Verify media processing is complete before attempting publication.
- Mark Published only when success is confirmed; store the provider media identifier and post URL when available.
- If a timeout occurs after submission, reconcile the provider result before allowing a retry that might duplicate the post.
- Do not infer success from an upload completing or a request merely being accepted.

Acceptance: repeated clicks and retried network requests cannot intentionally create a second post for one publish intent; uncertain external outcomes are surfaced and reconciled.

### FR-13 Scheduling

- Schedule only a validated, approved final video.
- Collect date, time, and an explicit timezone, initially using the saved user preference, then the browser timezone, with Asia/Kolkata as the fallback. Never assume the audience’s location determines the user’s timezone.
- Display the resulting local date/time and timezone on confirmation and the project card.
- Save UTC execution time plus the originating timezone identifier.
- Reject past times and apply a proposed minimum lead time of five minutes.
- Handle ambiguous or nonexistent daylight-saving times by requesting a valid explicit choice.
- Freeze the approved asset, caption, and account into a schedule payload.
- Editing the project does not change an existing schedule. Offer an explicit Replace scheduled version action after the new video is ready.
- Allow caption changes, rescheduling, and cancellation until publishing has been claimed; use an atomic check to resolve races.
- Recheck account authorization and asset availability before delivery.
- Start publishing at the chosen time; explain that platform processing can delay when the post becomes visible.
- Proposed retry policy: attempt recoverable scheduled failures within a 15-minute window, then mark Needs attention. After an outage beyond that window, require user action rather than posting unexpectedly late.
- For an uncertain already-submitted request, reconcile it even after the retry window; do not label it safe to repost without confirmation.

Acceptance: schedules survive app restarts, retain the approved version, respect timezone conversion, and never silently move to another account.

### FR-14 Autosave and project management

- Autosave text after a short debounce, initially one second of inactivity.
- Display Saving, Saved, and Save failed states accurately.
- Flush pending edits before generating, approving, navigating between steps, or scheduling.
- If offline, retain unsaved text locally where feasible and warn that it has not reached the server.
- Reconcile reconnects and multiple tabs using version checks; do not silently overwrite newer work.
- Let users rename projects and delete them with confirmation.
- Deleting a project cancels pending local jobs and schedules where possible. Explain that it does not delete a post already published to Instagram.
- When publishing is already underway, resolve its status before claiming all external actions were cancelled.

Acceptance: saved project state is recoverable after reload; conflicts and failed saves are visible rather than reported as successful.

## 8. AI and rendering architecture

### 8.1 Logical pipeline

```text
Creator input and reference notes
    → Gemini: focused idea, narration, supported scene plan
    → Schema and content validation
    → Combined storyboard review and approval
    → ElevenLabs: narration audio and alignment
    → Timeline builder: measured duration, caption phrases, visual cues
    → Remotion: scene composition, preview, MP4 render
    → Output validation
    → Final creator approval
    → Download or Meta publishing job
```

The website should not hold a long HTTP request open for the entire pipeline. It submits background work and reads durable job state.

### 8.2 Provider responsibilities

| Component | Responsibility | What it does not solve automatically |
|---|---|---|
| Gemini | Idea assistance, narration, structured storyboard, interpretation of revisions | Guaranteed factual accuracy or a complete animation system |
| ElevenLabs | Speech synthesis and supported alignment output | Semantic mapping between a spoken explanation and a visual event |
| Timeline builder | Turn narration spans into scene/caption/animation timing | Authoring educational content |
| Remotion | Render our components and timeline to preview/video | Decide independently how to explain arbitrary concepts |
| Meta | Authorize and publish eligible media | Own our scheduling, retries, version approval, or project management |

### 8.3 Structured scene contract

Each scene must have a stable identifier and include:

- Learning purpose and scene type from a supported list.
- Narration text and separately stored pronunciation preferences.
- Visual objects with stable identifiers, labels, and layout parameters.
- Animation events referring to an object and a narration span.
- Estimated duration before speech synthesis; measured timing afterward.
- Caption phrases and timestamp references after alignment.
- Source-note references or explicit illustrative-data labels where relevant.

Validate schemas, supported components, timing monotonicity, object references, and text limits before rendering. Model output is untrusted input and must not directly become executable code.

### 8.4 Duration reconciliation

The planner estimates duration from word count and intended pauses. Once audio exists, the timeline builder measures it. Minor adjustments to pauses and visual holds may be automated within an approved tolerance. Changes to wording, substantive ordering, or meaning require renewed storyboard approval. A video outside the duration range cannot pass output validation.

### 8.5 Revision invalidation rules

| Change | Reuse | Rebuild |
|---|---|---|
| Visual layout or colors within the default style | Narration and alignment | Affected visuals and final render |
| Caption spelling/display only | Audio, scene plan, alignment where valid | Caption layout and final render |
| Narrator preset | Approved narration text and compatible visuals | All audio, alignment, caption timing, timeline, and render |
| Spoken words or pronunciation | Unchanged scene assets where valid | Affected audio, alignment, captions, timing, render |
| Scene order | Valid individual assets | Global timeline, transitions, render |
| Major explanation rewrite | Only demonstrably compatible assets | Storyboard approval and affected pipeline stages |
| Instagram caption or schedule | Final video | Publishing payload only |

### 8.6 Fallback policy

- Use bounded retries first for transient provider faults.
- Do not silently switch voices or providers in a way that changes the approved experience.
- Keep optional provider adapters possible, but do not implement a broad multi-provider routing system in V1.
- Do not silently substitute a low-quality animation or unrelated image when a requested visual is unsupported.
- Store provider/model identifiers and generation settings with each artifact for diagnosis and reproducibility.
- Exact pixel reproducibility from generative services is not promised; preserve the generated artifact rather than depending on regenerating it identically.

### 8.7 Application and infrastructure design

| Layer | Selected baseline | Responsibility |
|---|---|---|
| Frontend | Next.js App Router, React, TypeScript | Private dashboard, idea chat, storyboard cards, voice previews, video preview, publishing UI |
| Backend | Next.js server endpoints using the Node.js runtime | Authentication, ownership checks, project operations, provider adapters, workflow dispatch, OAuth callbacks |
| Authentication | Better Auth with MongoDB integration | Individual sessions, email/password access, approved internal accounts |
| Database | MongoDB Atlas | Users, private conversations, project versions, scene plans, jobs, schedules, publishing results |
| Media storage | Cloudflare R2 | Audio, alignment/caption artifacts where appropriate, previews, and final MP4 files |
| Web hosting | Vercel | Serve the application and short-lived backend endpoints |
| Durable workflow | Inngest | Coordinate generation steps, bounded retries, rendering handoff, and scheduled delivery |
| Renderer | Remotion in Vercel Sandbox, subject to prototype benchmark | Run media composition and export outside ordinary web requests |
| Planning | Gemini API | Ideas, structured storyboard generation, revision interpretation |
| Speech | ElevenLabs API | Indian English narration and timing |
| Publishing | Meta Instagram API | Per-user authorization, media preparation, publication, and result lookup |

Use one Next.js codebase initially; a separate Express service is not required. Long video renders must not run inside ordinary page/API request handlers. Inngest orchestrates the work but does not itself replace the rendering compute environment.

For hosted generation, the workflow starts a render in the configured sandbox, persists its identity, checks completion in bounded steps, then transfers the validated artifact to R2 before ephemeral render storage is discarded. The R2 adapter must be explicit even if an upstream example uses a different storage service. If the benchmark fails because of deployment limits or excessive latency, record a rendering-infrastructure adjustment before implementation proceeds; do not silently assume web hosting solves rendering.

Local development may run Remotion locally while using the same versioned scene schema and R2/database adapters. The hosted internal version must continue jobs without requiring a team member’s browser or laptop to remain open.

### 8.8 Ownership and service boundaries

- Every data query is scoped to the authenticated owner. Background jobs derive the owner from the stored job/project, not unverified event payload fields.
- R2 buckets remain private. Authorized clients receive limited-duration URLs for previews/downloads; platform ingestion receives a URL valid for its required processing window.
- R2 object paths include owner, project, and version identifiers, but path structure is not a substitute for authorization.
- Binary audio/video belongs in R2 rather than MongoDB documents. MongoDB stores references and searchable structured state.
- Use ownership indexes for project lists, and unique operation keys for generation/publishing deduplication. Use atomic state transitions or appropriate transactions for job claims and schedule cancellation races.
- Store each individual’s brainstorming history, voice preference, timezone, and Instagram connection independently.
- Keep provider keys, database credentials, R2 credentials, Meta app secrets, token-encryption keys, authentication secrets, and workflow secrets in server-side environment configuration. Never place them in public client environment variables.
- Shared infrastructure and application-level provider keys do not imply shared creator content or shared Instagram authorization. Bring-your-own-key settings are outside V1.

### 8.9 API capability outline

Exact route naming can be chosen during implementation; the following capabilities are required:

| Capability | Required behavior |
|---|---|
| Project list/create/read/update/delete | Session-derived ownership; paginated private lists; version-aware writes |
| Brainstorm and storyboard | Persist user conversation; validate input/output; return durable operation status for long work |
| Voice samples and selection | Expose only configured presets; save personal defaults and project-specific choices independently |
| Approval and generation | Pin input version; deduplicate submissions; return job ID |
| Revision and cancellation | Scope to exact source version; classify invalidation; preserve last successful output |
| Job status | Owner-only progress, recoverable errors, and final asset references |
| Media preview/export | Validate ownership before issuing temporary access |
| Instagram connect/callback/disconnect | Session-bound authorization flow and individual encrypted connection |
| Publish/schedule/reschedule/cancel | Pin approved payload; enforce owner/account match; atomic transitions |
| Workflow callbacks | Verify service authentication; reconcile stored job identity and state; tolerate duplicate delivery |

### 8.10 Internal access and external publishing

Internal access means only the founder and approved team members use the application. It does not bypass Meta account eligibility or provider access requirements. Configure the integration and eligible tester/app-role accounts supported by the selected Meta setup; verify any required review before enabling additional accounts. Do not promise that internal status automatically removes review requirements.

Each user initiates their own Connect Instagram flow. Registration of the Meta developer app and deployment of callback URLs are operator setup tasks, not creator onboarding steps. An app key alone is insufficient to select and authorize every individual’s Instagram destination.

## 9. State, versioning, and data model

### 9.1 Separate state dimensions

Avoid a single project status that mixes editing, rendering, and publishing. A project can have a new draft while an older approved version is scheduled.

| Entity | States |
|---|---|
| Storyboard version | Draft, Planning, Review ready, Approved, Superseded, Failed |
| Generation job | Queued, Running, Cancel requested, Cancelled, Succeeded, Failed |
| Video version | Building, Validating, Ready for review, Approved, Failed |
| Publish intent | Draft, Scheduled, Preparing media, Publishing, Published, Failed, Needs attention, Cancelled, Outcome unknown |
| Instagram connection | Connected, Reauthorization required, Disconnected |

Track generation stage separately from job state. Dashboard labels summarize these dimensions without losing the underlying detail.

### 9.2 Core records

| Record | Important fields |
|---|---|
| User | ID, authentication reference, internal-access eligibility, preferred timezone, preferred voice preset, timestamps |
| Project | Owner/personal workspace ID, title, selected voice preset, active draft, latest successful video, archived/deleted markers |
| StoryboardVersion | Version ID, parent version, input, narration, scene plan, approval timestamp, schema version |
| RevisionRequest | Request text, target version, scene scope, interpretation, resulting version |
| GenerationJob | Input version, stage, state, attempt count, progress, error category, operation key |
| Asset | Owner, immutable location, content hash, media type, dimensions/duration, provenance, retention state |
| VideoVersion | Owner, storyboard reference, resolved voice/model IDs, audio/alignment/caption references, render settings, validation results, approval |
| InstagramConnection | Owner, platform account identity, encrypted authorization, permissions and connection state |
| PublishIntent | Immutable video reference, destination, approved caption, scheduled UTC time, timezone, state, provider IDs |
| OperationEvent | Entity reference, timestamp, action, actor, correlation ID, non-sensitive diagnostic context |

Use stable scene IDs rather than only scene positions so revisions remain correctly attached when scenes are reordered.

### 9.3 Consistency rules

- Approved and published versions are immutable.
- Every job references an exact input version.
- Only one worker can own a publish attempt at a time, with recovery for expired leases.
- Retry keys distinguish a retry from a deliberate new publication.
- Asset cleanup cannot remove files referenced by an active job or schedule.
- Expiring media links used by Meta must remain accessible long enough for ingestion, with refresh/recreation handled before submission when needed.
- Approval of an older version does not imply approval of a later revision.
- External publishing cannot be treated as a database transaction; explicitly model unknown outcomes.

## 10. Edge cases and expected behavior

| Situation | Required behavior |
|---|---|
| Empty or oversized idea | Validate before starting AI work; preserve entered content |
| Broad or multi-topic request | Suggest a focused takeaway appropriate for one video |
| Inaccurate or contradictory reference notes | Surface the conflict for review; do not claim verification |
| Notes contain instructions to expose secrets or bypass rules | Treat them as untrusted content and ignore those instructions |
| Unsupported language | Explain English-only output and offer adaptation before generation |
| Indian accent mistaken for Hindi support | Clarify English narration with an Indian accent; Hindi/Hinglish output is outside V1 |
| Selected voice unavailable | Preserve draft and request another curated voice; no silent substitution |
| Voice changes after scheduling | Generate a new version; keep original scheduled payload until explicitly replaced |
| User attempts another user’s project URL | Deny access without leaking its title, assets, or status |
| Browser changes between user accounts | Clear or isolate cached conversations, project lists, and connection state |
| Same Instagram account connected by another user | Reject the conflicting connection without revealing the other user |
| Invalid or mismatched OAuth state | Reject callback and offer a fresh connection attempt |
| Missing R2 audio/video artifact | Offer regeneration from stored storyboard; require review of regenerated video before publishing |
| Technical acronym or unfamiliar name | Accept pronunciation guidance and regenerate affected audio |
| Script too long or short after synthesis | Adjust permissible pacing or return revised narration for approval |
| Model returns invalid scene data | Validate, attempt bounded repair, then show recoverable failure |
| Unsupported visual concept | Propose a supported schematic or narrower explanation |
| Very long label or caption | Reflow or simplify with review where meaning changes; never crop silently |
| Mathematical notation reads poorly aloud | Store spoken form separately from visual notation |
| Missing or non-monotonic timestamps | Retry/alignment recovery; block invalid export |
| Narration and captions disagree after correction | Explain difference and offer narration regeneration |
| Captions overlap a diagram | Re-layout with reserved caption space and validate again |
| Provider rate limit or temporary outage | Queue/back off within limits; show waiting state |
| Provider rejection | Explain supported next action; do not retry blindly or bypass the rejection |
| Render worker crashes | Recover durable stage state and retry without losing approved input |
| User cancels during provider work | Stop subsequent work; discard late result from active UI unless retained as cancelled-job artifact |
| User edits while rendering | Save a separate draft; do not mutate running input |
| User double-clicks or refreshes | Reuse operation identity and reconcile server state |
| Two tabs edit the same draft | Detect conflict and offer reload or preservation of local changes |
| Session expires mid-job | Job continues; user signs back in to view result |
| Browser loses connectivity | Preserve unsaved input where feasible; accurately show unsaved state |
| New revision fails | Keep previous valid output accessible |
| Instagram personal account or permission denial | Explain eligibility; retain export and project access |
| OAuth flow is cancelled | Return to the unchanged publish screen |
| Authorization expires before scheduled time | Pause delivery and request reconnection |
| Reconnection selects a different account | Require a new destination approval for pending posts |
| Scheduled time lies in a DST gap or overlap | Ask user to select an unambiguous valid time |
| User changes device timezone | Preserve original schedule; display its explicit timezone |
| Scheduler restarts or runs late | Recover jobs and apply the bounded late-publishing policy |
| User edits video after scheduling | Keep scheduled version pinned until explicit replacement |
| Cancel and scheduler fire simultaneously | Atomic claim determines outcome; explain if publishing already started |
| Upload works but publishing fails | Keep provider identifiers; retry the safe stage only |
| Publishing times out after submission | Mark Outcome unknown and reconcile before reposting |
| Platform confirms a post after local timeout | Mark Published and prevent duplicate retry |
| User deletes project with pending schedule | Cancel pending intent before cleanup; explain any already-started delivery |
| User deletes a post in Instagram | Do not automatically recreate it; retain the historical publish record |
| Provider quota or operational limit reached | Preserve work and offer retry when service is available; no billing upsell |

## 11. Reliability, security, accessibility, and operations

### Reliability

- Durable queue and persistent job state; browser lifetime must not control work lifetime.
- Stage-level timeouts, bounded retry counts, and recovery for abandoned workers.
- Idempotent internal operations and reconciliation around external side effects.
- Asset validation before Ready and before publication.
- Preserve the last successful version across failures.
- Internal error details must be logged with a correlation ID; users receive a plain-language explanation and useful next action.

### Security and privacy

- Keep AI and Meta credentials on the server and encrypt stored authorization credentials.
- Enforce ownership checks for every operation, including downloads and background jobs.
- Avoid logging raw credentials, sensitive notes, or full prompt content by default.
- Sanitize text and structured scene data, validate asset references, and isolate render workers.
- Restrict render-worker network/file access and use application-controlled components and assets.
- Do not build a dedicated backup/restore system or retention-policy engine for internal V1.
- Keep normal database records and R2 assets until explicitly deleted. Deletion must remove access immediately and clean up owned active-store assets once in-flight work is resolved.
- Regeneration from a saved storyboard is the primary recovery path for missing/corrupt media. Complete loss of the underlying project database is not covered by a V1 recovery guarantee.
- Regeneration creates a new version and may change the output; it never silently replaces an approved scheduled asset. Pause the affected schedule until the new version is reviewed.
- Validate provider data-use terms and commercial output rights before publishing outputs or introducing confidential team content. Free test output must not be assumed suitable for commercial publication.

### Accessibility and usability

- Keyboard-accessible controls, visible focus states, labeled inputs, and understandable error messages.
- Screen-reader-readable storyboard narration and job updates that do not overwhelm announcements.
- High-contrast captions and legible text on a real phone screen.
- No rapid flashing; use restrained transitions and motion that supports comprehension.
- Responsive dashboard and preview screens. Desktop authoring is the initial optimization target, but core review and download should remain usable on mobile.

### Lightweight internal operations

- Log pipeline stages, durations, errors, and correlation IDs without copying sensitive content.
- Use bounded retries and configurable concurrency so a bug does not create an uncontrolled loop.
- Inspect spending in provider dashboards during internal testing. No internal cost dashboard, per-user credit ledger, or billing subsystem is required.
- Make failed jobs visible in the owning user’s dashboard, with Retry or Regenerate as appropriate.
- Monitor scheduled deliveries and unknown publish outcomes sufficiently to avoid silent failures or duplicate posts.
- Operator diagnostics do not create a shared creator workspace or make colleagues’ projects browsable.

## 12. Lightweight diagnostic events

Record consent-appropriate events with project/version IDs and timestamps, excluding raw user content by default:

- Project created; brainstorming started; topic selected.
- Storyboard requested, completed, failed, revised, and approved.
- Generation requested, stage completed, failed, cancelled, and validated.
- Video previewed, revision requested, approved, and downloaded.
- Instagram connection started, completed, failed, and disconnected.
- Publish requested, scheduled, rescheduled, cancelled, confirmed, failed, and outcome unknown.

These events can be captured through application logs and existing job records for internal quality evaluation. No separate analytics platform, analytics dashboard, or billing instrumentation is required for V1.

## 13. Quality evaluation and acceptance plan

### Representative content set

Before release, evaluate at least 20 topics covering:

- Processes: water cycle, photosynthesis, how a bicycle brake works.
- Comparisons: renewable versus nonrenewable energy, RAM versus storage.
- Sequences and timelines: stages of a butterfly, a short historical sequence.
- Abstract ideas: an algorithm, probability, a feedback loop.
- Charts and numerical concepts: a clearly specified sample dataset and a simple percentage explanation.
- Difficult text: acronyms, names, large numbers, units, and mathematical notation.

Include deliberately broad, contradictory, unsupported, and overly long requests to validate graceful handling.

### Release acceptance checklist

- [ ] A new user completes the four-step flow without encountering a separate script editor requirement.
- [ ] Storyboard cards contain narration, visual intent, representative preview, and duration estimate.
- [ ] Approval pins the exact input version used by generation.
- [ ] Final videos fall within the 60–90-second range and use the agreed export profile.
- [ ] Narration is complete and intelligible, with no accidental repetition or truncation.
- [ ] Motion graphics explain concepts and correspond to the narration.
- [ ] Captions are legible, synchronized, and do not obscure important content.
- [ ] Caption corrections and pronunciation revisions follow the correct invalidation path.
- [ ] Scene-specific revision preserves unaffected content and the previous successful output.
- [ ] Closing and reopening the app preserves saved work and reconciles job state.
- [ ] Duplicate requests, worker retries, and multiple tabs do not corrupt versions.
- [ ] Instagram authorization, publishing, and scheduling work with approved test accounts and required access.
- [ ] Publishing targets only the approved account and exact video/caption version.
- [ ] Unknown external outcomes cannot trigger blind duplicate publishing.
- [ ] Schedule timezone, DST, cancellation races, and authorization expiry are tested.
- [ ] Ownership and asset access controls prevent cross-user access.
- [ ] No billing or branding controls appear in the creator workflow.
- [ ] Only approved internal users can sign in; each gets a private workspace and individual Instagram connection.
- [ ] Indian English male/female samples and selections work; preferences do not leak across users.
- [ ] English captions and narration handle Indian names, examples, units, and terminology naturally.
- [ ] The minimal visual system passes readability and diagram-overlap checks.
- [ ] MongoDB persists project/version state, R2 stores private media, and hosted jobs survive browser closure.
- [ ] Missing-media regeneration produces a new reviewable version and cannot silently change a schedule.
- [ ] Provider licenses and Meta access are suitable for internal use and intended publishing.
- [ ] No public registration, shared workspace, backup system, or billing feature is required for release.

### Test layers

- Unit tests for scene validation, timing conversion, duration accounting, caption grouping, and version invalidation.
- Integration tests for provider adapters using recorded fixtures/mocks, plus a bounded set of live provider checks.
- Workflow tests for project creation, approval, generation, revision, export, and scheduling.
- Failure-injection tests for retries, worker restarts, timeout-after-publish, and save conflicts.
- Visual and listening review on representative outputs; schema tests alone cannot assess explanation quality.
- Platform checks against current Meta documentation and an authorized live test account before enabling internal publishing.

## 14. Delivery plan and gates

### Phase 0: Prove the core video pipeline

Produce three 60–90-second explainers using Gemini, ElevenLabs, and Remotion. Evaluate one process, one comparison, and one abstract concept. Test narration timing, caption readability, and one scene-specific revision for each.

Exit gate: demonstrably useful videos using both Indian English voice presets, measured latency/resource usage, and a feasible minimal animation vocabulary. If this gate fails, improve the pipeline before building extensive dashboard functionality.

### Phase 1: Complete idea-to-export experience

Build the Next.js app on Vercel with Better Auth, private per-user MongoDB project state, R2 media, and Inngest generation workflows. Include voice selection, brainstorming, combined storyboard review, approval/versioning, captions, conversational revisions, preview, and download. Benchmark Remotion on Vercel Sandbox; use local rendering during development.

Exit gate: reliable end-to-end internal testing with output validation, strict user isolation, and retry/regeneration recovery.

### Phase 2: Complete Instagram delivery

Add connection, account validation, caption preparation, immediate publishing, scheduling, reconciliation, and account-expiry handling. Begin Meta setup and access investigation during Phase 0 because external approval may affect timing.

Exit gate: publishing and scheduling acceptance checks pass with required platform access. Idea-to-export can be tested privately while integration is pending, but the full agreed V1 is not complete without Instagram delivery.

### Phase 3: Complete the internal V1

Run the representative evaluation set, accessibility checks, authorization/isolation tests, retry/race tests, and founder/team testing with separate accounts. Public launch work remains outside this release.

Exit gate: release acceptance checklist satisfied, known limitations documented, and operational ownership assigned.

No delivery-date commitment is made before the prototype and Meta integration dependencies are assessed.

## 15. Risks and mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| Animation library cannot express enough topics | Repetitive or misleading videos | Start with supported patterns, evaluate varied topics, expose limitations early |
| Fluent but inaccurate narration | Loss of educational trust | Favor supplied notes, avoid invented citations/data, keep story approval and factual review in evaluations |
| Good timestamps but poor semantic cues | Motion feels disconnected from explanation | Explicit phrase-to-event mapping and human timing review |
| Voice edits cause cascading timing changes | Revisions break downstream scenes | Versioned dependencies and measured timeline rebuilds |
| Rendering is slow or unstable | Poor creator experience | Benchmark early, durable jobs, incremental asset reuse, stage-level recovery |
| Free-tier restrictions or commercial licensing | Unexpected costs or unusable outputs | Verify plan eligibility before production; record internal costs and artifact provenance |
| Meta access/review or account constraints | Publishing cannot launch on time | Investigate early; maintain download path during private testing |
| Duplicate external publication | User trust and reputation damage | Immutable publish intent, atomic worker claim, outcome reconciliation |
| Cross-user data or account leakage | Private content exposure or publishing to the wrong destination | Session-derived ownership on every operation and multi-user isolation tests |
| Indian English voice quality varies | Unnatural pronunciation or inconsistent delivery | Audition both presets on Indian names and technical terms; support pronunciation revisions |
| Missing/corrupt media without backups | Output must be generated again | Retain ordinary storyboard data; regenerate a new version and require review |

## 16. Final decisions and implementation setup

### Final product decisions

Name, internal-only release, private individual workspaces, individual Instagram connections, English, Indian English male/female presets, minimal explanatory motion graphics, Next.js/Node.js, MongoDB, R2, and Vercel are settled. No further product questionnaire is required to begin implementation.

Billing, a dedicated backup system, shared team workspaces, and public onboarding remain out of scope. Future video formats can expand beyond explainers without changing the NamasteVideo.ai brand.

### Implementation setup checklist

These are implementation tasks, not unresolved product features or reasons to repeat product approval:

| Task | Baseline | Needed by |
|---|---|---|
| Domain | Name finalized; registration/availability not verified or purchased | Custom-domain deployment; use a Vercel URL for testing first |
| Voice IDs | Audition and configure one male and one female Indian English voice | Phase 0 exit |
| AI model access | Verify the configured Gemini/ElevenLabs IDs; keep them replaceable server-side | First live generation |
| Credentials | Configure provider secrets in local/server environment settings, not creator forms | Relevant integration tests |
| Internal users | Maintain approved-email allowlist and individual sessions | Internal access |
| Hosted rendering | Benchmark Vercel Sandbox with Remotion and upload output to R2 | Hosted generation |
| Authentication | Configure Better Auth sessions and operator-assisted account recovery | Phase 1 |
| Meta developer setup | Configure app credentials, callback URLs, permissions, and eligible internal test accounts | Phase 2 tests |
| License eligibility | Check current Remotion and voice output terms for actual team use | Relevant deployment/publishing |
| Operational settings | Configure retry limits and concurrency appropriate to measured workloads | Internal testing |
| Quality targets | Confirm timing/readability and latency targets on real outputs | Phase 1 exit |

## 17. Provider references and verification notes

These sources informed the tooling discussion. Provider limits, pricing, access requirements, and terms can change. Implementation must check current documentation; this PRD does not lock transient quotas or pricing into product promises.

- [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models)
- [ElevenLabs models](https://elevenlabs.io/docs/overview/models)
- [ElevenLabs voice library](https://elevenlabs.io/docs/eleven-creative/voices/voice-library)
- [Better Auth installation](https://better-auth.com/docs/installation)
- [Inngest with Next.js](https://www.inngest.com/docs/getting-started/nextjs-quick-start)
- [Remotion on Vercel](https://www.remotion.dev/docs/vercel)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini API pricing and free-tier data-use information](https://ai.google.dev/gemini-api/docs/pricing)
- [ElevenLabs speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- [ElevenLabs content publication and commercial-use guidance](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)
- [Remotion documentation](https://www.remotion.dev/docs)
- [Remotion licensing](https://www.remotion.pro/license)
- [Meta Instagram API documentation collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Meta Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login)

## 18. V1 definition of done

An approved internal user can sign into their private NamasteVideo.ai dashboard, choose an Indian English male/female narrator, enter or brainstorm an educational idea, approve a combined script and storyboard, generate a 60–90-second motion-graphics video with synchronized AI narration and captions, revise it conversationally, preview and download it, and publish or schedule its approved version to an eligible Instagram account.

Ordinary pipeline failures preserve saved work and previous valid outputs. Missing media can be regenerated from stored project data without a dedicated backup system. Every user’s ideas, projects, preferences, and Instagram authorization remain separate. Publishing respects the approved version and the owner’s destination. The interface remains a four-step process, with no branding setup or billing workflow.
