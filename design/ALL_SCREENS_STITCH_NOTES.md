# Stitch screen generation notes

## Additional mobile utilities

I have designed and generated all **4 separate mobile screens** (390px width) in the approved **Cinema** direction, with `#090909` background, `#151515` panels, `#E58C33` accent with black text on primary CTAs, **Plus Jakarta Sans** headings, and **Inter** for all UI body and metadata.

---

### What was produced:

1. **Screen 23 — Mobile sign in and recovery**
   - **Authentication Form**: Email and password fields with visibility toggle, full-width `#E58C33` "Sign in" CTA (black text), and "Need help signing in?" link.
   - **Internal Access Boundary**: Strictly scoped to authorized internal creator access; completely omitted public registration, social login, and self-service resets.
   - **Auth Rejected Specimen**: Inline banner demonstrating the exact invalid credentials notification.
   - **Session-Expired State**: Preserves background video processing state (*"Your video generation continues. Sign in to return."*) with a direct "Sign in to resume" action.

2. **Screen 24 — Mobile personal settings**
   - **Account Information**: Read-only assigned email (`creator@namastedev.internal`) with administrative lock note and `Asia/Kolkata (IST · UTC+05:30)` timezone selector.
   - **Narration Engine**: Preview for Daniel English (test voice) with an interactive 12s audio scrubber pill and note that settings apply to future projects only.
   - **Connected Channel Summary**: Direct summary of `@namaste_demo` with connection management link.
   - **Sign Out Flow**: "Sign out of studio" button along with the unsaved changes confirmation sheet dialog (*"Stay signed in"* vs. destructive *"Discard & sign out"*).

3. **Screen 25 — Mobile Instagram connection**
   - **Connected State**: `@namaste_demo` account card with "Active & Verified" badge, token age, and disconnect workflow with active scheduled post warning.
   - **Connection Flow**: Direct Meta OAuth trigger (*"Connect with Instagram"*). Explains authorization occurs externally at Meta, never prompting for passwords.
   - **Edge States**: Includes token expiration re-auth, unsupported personal account guidance, and authorization cancellation recovery — confirming direct MP4 download is always safeguarded.
   - **Mobile Navigation**: Integrated mobile drawer displaying *My Videos*, *Instagram*, and *Settings*.

4. **Screen 26 — Mobile schedule and recovery sheets**
   - **State 1 (Schedule Review)**: Master video v2 status, caption preview, target handle, date/time inputs, timezone conversion confirmation, and primary "Confirm schedule" CTA.
   - **State 2 (Scheduled Success & Management)**: Confirmed dispatch card with "Edit schedule" and "Cancel scheduled post" actions plus modal confirmation preview.
   - **State 3 (Publication Outcome Unknown)**: Safety-locked "Verification pending" state preventing duplicate posts, with "Refresh verification status" and disabled retry.
   - **State 4 (Save Conflict & Recovery)**: Side-by-side diff comparing local unsaved phone text against remote timestamped version, with "Keep local version", "Reload remote", and "Compare diff" controls.

All touch targets strictly meet the **≥44px** standard with proper safe area margins.

Suggestion: Add interactive toggle states to the password and sheet previews

Suggestion: Prepare mobile navigation drawer overlay in an open state

Suggestion: Review high-contrast accessibility across all mobile dialogs

Tool-generated descriptions and suggestions; design artifacts only. See SCREEN_REVIEW_INDEX.md and DESIGN_QA_NOTES.md for authoritative scope and review status.

## access

I have created all 3 separate internal application UI screens adhering strictly to the approved **Cinema** design specification (`#090909` canvas, `#151515` panels, `#E58C33` focal orange, `#FAFAFA` white headings in **Plus Jakarta Sans**, and `#A3A3A3` text/labels in **Inter**):

---

### 1. `01 — Sign in`
- **Centered Clean Authentication Form**: Compact max-w-[440px] container featuring the NamasteVideo mark, `Internal V1` tag, and clear title.
- **Form Controls & Hierarchy**: Work email field, password field with functional `Show`/`Hide` visibility toggle, and high-contrast orange primary button (`Sign in →`) with black text on orange and 44px touch targets.
- **Generic Inline Invalid Credentials Specimen**: Subtle red warning banner (*"Invalid email or password. Please verify your credentials or contact your administrator if your access has changed."*).
- **Internal Access Guidance**: Distinct callout specifying that access is restricted to pre-approved educational authors and producers, with no social logins or public signup. Includes link to *"Need help signing in?"*.

### 2. `02 — Access and recovery`
- **Operator-Assisted Recovery Panel**: Highlights *"Contact your administrator to restore access"* with a clear direct action to *"Back to sign in"*. Specifies internal communication channels (e.g. `#namaste-video-support`) and explicitly avoids fake self-service email resets.
- **Companion State 1 — Access Unavailable (No Account Enumeration)**: Security specimen demonstrating generic confirmation without disclosing whether an account or active license exists.
- **Companion State 2 — Session Expired**: Informs the user that background video generation continues uninterrupted (*"Your video generation continues. Sign in to return."*) along with a dedicated notice that unsaved storyboard script drafts and prompt edits are safely cached for automatic same-user restoration.

### 3. `03 — Project unavailable`
- **Application Shell Chrome**: Integrated truthful four-stage project pipeline header (`01 Idea / 02 Storyboard / 03 Video / 04 Publish`), streamlined sidebar containing only **My videos**, **Instagram**, and **Settings**, and a personal project scope indicator.
- **Generic Project Unavailable Panel**: Shows *"This project is unavailable"* and a 44px primary action *"Back to my videos"*, omitting all internal titles, private project IDs, or sensitive filenames.
- **Companion Service Specimen**: Demonstrates a clean temporary gateway downtime state with a human-readable support reference (`ERR-RENDER-CLUSTER-902`) and accessible *"Retry connection"* action without raw stack traces.
- **Specification Metadata**: Explicitly surfaces standard fixture guidelines (*"Storyboard preview · estimated"*, *"Video preview (01:17)"*, and narrator fixture *"Daniel — English (test voice)"*).

Suggestion: Would you like to design the Storyboard editor state (Stage 02) next?

Suggestion: Should we create the Instagram connect and schedule dialog?

Suggestion: Do you want to preview a mobile responsive layout for the Sign in screen?

## library

I have created the 3 internal desktop application screens for **NamasteVideo.ai** in the approved **Cinema** direction (`#090909` canvas, `#151515` panels, `#E58C33` focal orange, `#FAFAFA` headline white, `#A3A3A3` muted text, `#303030` dividers):

### 1. `04 — My videos`
- **Application Chrome & Navigation**: Consistent dark studio shell featuring the NamasteVideo.ai logo, `Internal V1` indicator, voice engine status (`Daniel — English (test voice)`), and scope indicator (`9:16 1080p · 60–90s`). The sidebar provides focused access to *My videos*, *Instagram*, and *Settings*.
- **Search & Filter System**: Top search input paired with comprehensive status filters: `All (6)`, `Drafts (2)`, `Ready (1)`, `Scheduled (1)`, `Published (1)`, and `Needs attention (1)`.
- **Project Grid (6 Realistic Fixtures)**:
  - *How Binary Search Halves Search Time* (Published, 9:16 · 01:17) with diagram schematic thumbnail and action menu.
  - *RAM vs SSD: Memory Hierarchy Explained* (Scheduled, 9:16 · 01:18, scheduled for `14 Nov 2025, 18:30 IST (Asia/Kolkata)` to `@namaste_demo`).
  - *Thermodynamics: The Water Cycle Phase Shift* (Ready, 9:16 · 01:22).
  - *Git Branching: Detached HEAD Demystified* (Needs attention: warning alerting that the script exceeds the 90s limit).
  - *Photosynthesis: Light Reactions in Chloroplasts* (Draft, 3 of 4 scenes approved).
  - *TCP Handshake vs UDP: Why Packets Drop* (Draft, outline stage).
- **Primary CTA**: Prominent `+ Create a video` button in solid `#E58C33` with black text, 44px height, and 8px border radius.

### 2. `05 — Library states`
- **Full-Size Primary Empty State**: *"Your first video starts with an idea"* centered with sample educational prompt suggestions (*Explain binary search visually in 4 steps*, *How DNS resolution works*, *Photosynthesis light reactions simplified*).
- **Companion State Panels**:
  - **Filter Empty**: Friendly zero-match notification with `Clear filters` button.
  - **Loading Skeleton**: High-contrast pulsing card wireframes for thumbnail, title, and action states.
  - **Service Error**: Informative failure notification explaining draft safety on the server with `Retry connection`.
  - **In-Context Rename Modal**: Specimen dialog allowing inline project title adjustment.
  - **Delete Confirmation & Publishing Lock**: Destructive action dialog warning that deletion cancels pending schedules/jobs without affecting Instagram posts, plus an active lock state blocking deletion while rendering/publishing is in progress.

### 3. `06 — Personal settings`
- **Account Information**: Read-only creator email (`creator@namastedev.internal`) with administrative scope lock, paired with an explicit `Asia/Kolkata (IST · UTC+05:30)` timezone selector.
- **Default Narration Engine**: Shows test voice (`Daniel — English (test voice)`) with a 12s audio sample player bar, accompanied by clear disclosure that changes apply only to future projects and voice cloning is disabled.
- **Publishing Channels**: Single connected Instagram account (`@namaste_demo`) with active verification status, auto-publish rights summary, and `Manage connection`.
- **Session & Unsaved Protection**: Studio sign-out action with an inline warning specimen guarding against discarding unsaved settings. All actions maintain strict 44px targets and black text on orange buttons.

Suggestion: Design the 4-step creation flow starting with Step 01: Idea input

Suggestion: Create the Step 02: Storyboard review and scene editor screen

Suggestion: Design the Step 03 & 04: Video preview and Instagram publishing screen

## planning

I have designed and published the 3 requested desktop screens for **NamasteVideo.ai Internal V1** in strict accordance with the **Approved Cinema** visual identity:

---

### 1. `07 — Idea and brainstorming` (`07 — Idea and brainstorming`)
- **Four-Stage Project Header**: Features the persistent pipeline progression (`01 Idea` active in signature orange #E58C33, followed by `02 Storyboard`, `03 Video`, and `04 Publish`), project back link, truthful timestamped auto-save (`14:32 IST`), and narrator indicator `Daniel — English (test voice)`.
- **Primary Topic Input**: Features the clean topic textarea prefilled with *"Explain binary search simply with an array of numbers..."*, live character counter (134 / 800), and a natural educational duration hint (`60–90 seconds educational vertical · approx. 130–180 spoken words`) rather than a rigid selector.
- **Pedagogical Parameters & Voice Specimen**: Includes expandable panels for *Audience & Pedagogical Tone* (Beginner / First-principles explanation) and *Focus Notes & Visual Milestones* (array definition), paired with the playable 5s voice sample card for Daniel (noting single English voice in V1).
- **Topic Ideation Assistant**: Integrated right-hand panel suggesting 3 curated topics (*How binary search halves search time*, *RAM vs SSD*, and *HTTP/2 multiplexing*) with immediate `Use idea` actions and natural language prompt bar.
- **Framed Companion UI State Specimens**: Distinct inline states for Input Validation (<20 chars blocking), English-only adaptation notice, and graceful voice synthesizer fallback.

---

### 2. `08 — Storyboard review` (`08 — Storyboard review`)
- **Timeline & Overview**: Header summary bar displaying `6 scenes total · Estimated duration: 01:18` (within 60–90s target) with pacing status and clear `Schematic preview · estimated timing` labeling.
- **Slim Scene Navigator**: Left rail displaying all 6 sequential scenes with timestamps and status indicators (Scene 01 revised badge, Scene 03 active).
- **Expanded Schematic Cards**: Center workspace featuring:
  - **Scene 01 (Revised Hook)**: Displays comparison tag (*Simpler telephone book hook vs formal math*), `Keep revision` and `Restore previous` controls, schematic 9:16 thumbnail preview, editable spoken narration, and Daniel voice cadence guidance (130 wpm).
  - **Scene 03 (Array Halving)**: High-contrast schematic vector diagram of the array `[12, 23, 35, 42, 56, 71, 89]` with midpoint `42` highlighted in orange, editable narration, on-screen subtitles, and pacing retention score.
- **Conversational Revisions Panel**: Right-hand panel allowing natural language adjustments (*"Make the opening simpler and use the phone book analogy..."*), scope toggle (`Entire video` vs `Selected: Scene 01`), pronunciation cues (`log two of n`), and revision history stack.
- **Primary CTA**: Prominent `Approve & generate video →` in the top header.

---

### 3. `09 — Planning and save recovery` (`09 — Planning and save recovery`)
- **Section A · Workspace In-Flight Planning & Pedagogical Directives**:
  1. *Creating Storyboard Stage*: Truthful stepped progress indicator (*Concept broken into milestones → Synthesizing spoken narration timing...*) without artificial percentages.
  2. *AI Pedagogical Clarification*: Interactive query asking whether to introduce Big-O notation or explain halving in plain language first.
  3. *Pacing & Duration Gate*: Clear warning when a scene script pushes total duration past 90s (01:38), offering an automated AI condensed alternative with single-click acceptance.
  4. *Engine Constraint Resolution*: Simplifies unsupported 3D physics requests into clean 2D vector comparison matrices.
- **Section B · Resilience, Network Save Failures & Multi-Tab Conflicts**:
  5. *Planner Timeout*: Graceful retry card with zero data-loss reassurance.
  6. *Save Connection Lost*: Alerts of interrupted connection, blocking the `Approve & generate video` button to prevent desynchronized cloud rendering, with direct `Retry cloud save now` and local backup download.
  7. *Two-Tab Concurrency Conflict*: Side-by-side diff comparing local unsaved text vs remote tab text with `Keep local version` and `Reload remote version` options.
  8. *Version Drift Guard*: Handles AI candidates generated against older drafts, providing `Review and merge changes` rather than destructive overwrites.

---

### Design System Compliance:
- **Exact Canvas & Surfaces**: Deep black canvas `#090909`, panel container surfaces `#151515`, borders `#303030`.
- **Palette**: Accent `#E58C33` with high-contrast `#090909` black text on primary CTAs, `#FAFAFA` display copy, and `#A3A3A3` secondary text.
- **Typography**: Strictly **Plus Jakarta Sans** for headlines and **Inter** across all UI labels, timestamps, body copy, and badges (completely free of monospace fonts).
- **Touch & Controls**: 8px rounded corners for controls, 16px for card panels, with all primary targets meeting or exceeding 44px.

Suggestion: Review Step 03: '10 — Video generation and render progress' in Cinema direction

Suggestion: Create Step 04: '11 — Publish and Instagram scheduling' screen

Suggestion: Inspect interactive pronunciation guide controls in Scene 08

## video

I have created all 3 requested desktop screens in the **Approved Cinema** visual direction for **NamasteVideo.ai Internal V1**:

---

### 1. `10 — Generating video` (Screen: `10 — Generating video`)
- **4-Stage Stepper Header**: Idea (✓) → Storyboard (✓) → **03 Video (Active: Generating v2)** → Publish (Queued). Includes truthful auto-save timestamp (`14:32 IST`), `Daniel — English (test voice)`, and `9:16 1080p · 60–90s` tags.
- **Truthful Stage Pipeline**: 
  - Stage 1: *Preparing scenes* (Completed)
  - Stage 2: *Creating narration* (Completed)
  - Stage 3: *Timing visuals and captions* (**In progress** — real-time subtitle alignment and audio cadence sync, without fake % bars)
  - Stage 4: *Rendering video* (In queue)
  - Stage 5: *Checking output* (Queued)
- **Background Execution Resilience**: Reassures the creator that they can safely leave the tab while rendering runs in the background.
- **Cancel Safety & Anti-Duplication**: Secondary *Cancel generation* button with protection against partial file corruption, alongside duplicate generation prevention.
- **Retained v1 Access**: Displays a quick launcher banner to view the previously finalized v1 render (`01:17`) while v2 builds with *"Edits saved for a future version"*.
- **Approved Storyboard Summary Drawer**: Real-time breakdown of all 6 storyboard scenes and target pacing (`01:18`).

---

### 2. `11 — Video review and captions` (Screen: `11 — Video review and captions`)
- **Full 9:16 Vertical Video Player**:
  - Displays approved educational motion graphics with cream/teal diagram styling (`[12, 23, 35, 42, 56, 71, 89]`, midpoint `[3] = 42` highlighted).
  - Version switcher toggling `v2 (Latest) · Active` vs `v1 (Rendered 28m ago)`.
  - Accessible player controls with ≥44px touch targets: play/pause, scrub slider (`00:41 / 01:17`), volume control, playback rate (`1.0x`), and fullscreen.
- **Timed Captions Inspector**:
  - Clean list of timed subtitle segments with in-place text editing.
  - Prominent **Pronunciation & Wording Notice**: explicitly clarifies that textual wording edits require narration re-synthesis via Storyboard review so audio matches speech perfectly.
- **Conversational Visual Revision Panel**:
  - Target scene picker (`Scene 03 — Array Halving`).
  - Natural language instruction input (*"Make the array highlight pulse slower when 42 is found"*).
  - Explicit reminder that visual adjustments produce a fresh preview without desynchronizing audio and require review before publishing.
- **Primary Actions**: Secondary *Download MP4* and primary *Approve & continue to publish →* (#E58C33 with bold black text).

---

### 3. `12 — Generation recovery` (Screen: `12 — Generation recovery`)
- **Primary Failure & Safe Recovery**:
  - Clear diagnosis: *Video generation interrupted on v2* at Stage 4.
  - Creator Safety Guarantees: Zero partial video releases and locked voice engine (no automatic substitutions).
  - Prominent *Safe Retry v2 generation* and *Edit storyboard directives*.
- **Retained v1 Active Fallback**:
  - Mini player with valid v1 output (`01:17 · 1080p`), allowing the creator to fallback to v1 immediately or download the master MP4.
- **Framed Companion Recovery Specimens (6 Scenarios)**:
  1. **Queued service busy**: 4/4 pipelines active, queue wait estimate, leave tab safely.
  2. **Provider unavailable / Zero credits**: Scheduled maintenance notice with zero credits consumed (strictly no upsells).
  3. **Cancelled generation**: Directives safely restored to draft without orphan files.
  4. **Source requires reapproval**: Tab/session diff collision requiring storyboard re-approval before render.
  5. **Missing media asset**: Vector diagram re-synthesis action.
  6. **Retry exhausted & cancellation pending**: Admin contact action with explicit error reference.

---

### Design System Adherence:
- **Palette**: Pitch-black canvas (`#090909`), panel containers (`#151515`), accent orange (`#E58C33`), primary text (`#FAFAFA`), muted grays (`#A3A3A3`), and crisp dividers (`#303030`).
- **Typography**: **Plus Jakarta Sans** for prominent headlines; **Inter** for all UI elements, labels, and timestamps (zero monospace fonts).
- **Controls & Accessibility**: 8px controls, 16px panels, black text on orange primary buttons, and minimum 44px clickable targets.

Suggestion: Generate Stage 04 — Publish & Instagram scheduling screen

Suggestion: Inspect the interactive state when editing a caption line

Suggestion: View the full Storyboard review flow (Stage 02)

## publish

I have designed and published all 4 requested screens for **NamasteVideo.ai** in the approved **Cinema** brand direction:

1. **`13 — Publish and export`**:
   - **Visual & Video Verification**: Features the approved Step 4 header, frozen v2 video preview thumbnail (`01:17`, `MID [3] = 42`), and an independent, unblocked **Download MP4** action.
   - **Post Preparation**: Connects to `@namaste_demo` (verified Instagram Professional Account), complete with an interactive caption editor with hashtag counter and a `✨ Suggest caption` quick action.
   - **Pre-Flight Approval Summary**: Summarizes video version, syndication target, and character counts with explicit `Post now` and `Schedule for later` actions.
   - **Framed Disconnected Specimen**: Highlights the fallback state where Instagram is disconnected while keeping MP4 download immediately accessible with zero imitation password fields.

2. **`14 — Schedule review`**:
   - **Side-by-Side Review**: Pairs the frozen v2 video asset and destination preview with date/time selectors and `Asia/Kolkata (IST · UTC+05:30)`.
   - **Timing Transparency**: Explicitly calculates converted local times and shows a minimum 5-minute lead time notice before release windows.
   - **Validation Companion Panels**: Includes deterministic specimens for **Past Time**, **DST Nonexistent Gap Hour**, and **Ambiguous Fallback Time / UTC Offset** selection (`America/New_York` example).
   - **Scheduled Confirmation Specimen**: Displays locked status, `Edit schedule`, and `Cancel schedule` with ingestion queue disclaimers.

3. **`15 — Publishing status and management`**:
   - **Active Pipeline Stepper**: Live 3-stage visual progress (*Uploading video asset → Processing media container → Publishing to @namaste_demo*) with server lock notice.
   - **Reconciliation & Safety States**:
     - *Published Confirmed State* with direct `View on Instagram` action.
     - *Outcome Unknown Reconciliation State* explicitly disabling duplicate retry to protect feed integrity.
     - *Safe Retry* for failures before transmission.
     - *Expired Session Policy* requiring fresh authorization.
     - *Replace Scheduled Version Review* comparing scheduled v1 against fresh v2.
     - *Cancel Schedule Confirmation* dialog with in-flight lock protection.

4. **`16 — Instagram connection`**:
   - **Single-Creator Account Control**: Displays connected account `@namaste_demo`, scope permissions, token freshness, and a disconnect safety alert regarding paused scheduled posts.
   - **Secure OAuth Handshake**: Clean `Connect with Instagram` button clarifying redirection to official Meta login without internal credential storage.
   - **8 Deterministic Companion Return States**: Authorization cancelled, denied permissions, unsupported personal account (keeping MP4 download unblocked), expired tokens, session mismatch, privacy-preserving account conflicts, changed destination review guard, and in-flight publish safety locks.

Suggestion: Inspect details of the DST timezone specimen on Screen 14

Suggestion: Explore the mobile responsive views for these publishing workflows

Suggestion: Simulate switching between v1 and v2 in the Replace Scheduled Version modal

## mobile

I have designed and generated all **6 separate mobile screens (~390px portrait)** for the **NamasteVideo.ai** internal V1 suite, strictly adhering to the approved **Cinema** direction.

---

### Brand & Design System Implementation:
- **Cinema Palette**: Canvas foundation (`#090909`), deep panels (`#151515`), focal accent orange (`#E58C33`), primary text (`#FAFAFA`), muted secondary (`#A3A3A3`), and crisp dividers (`#303030`).
- **Typography & CTA Style**: Plus Jakarta Sans for titles and section headings; Inter for all UI labels, inputs, timestamps, and controls. Primary actions feature bold black text on `#E58C33` with minimum 44px touch target heights. No monospace or unapproved fonts.
- **Mobile Ergonomics**: Custom portrait layouts (~390px width) crafted specifically for mobile touch, with sticky action bars above safe bottom insets, readable cards, and zero horizontal overflow.

---

### Generated Mobile Screens Overview:

1. **`17 — Mobile homepage` (`17 — Mobile homepage`)**:
   - High-contrast editorial hero (*"Your idea. Ready to play."*) with primary *"Create a video"* action and *"Watch an example"*.
   - Compact vertical video preview card with binary search midpoint highlight and audio caption.
   - Stacked 4-step creation roadmap (*Idea → Storyboard → Video → Publish*), specimen gallery cards (*Binary Search, RAM vs SSD, Water Cycle*), value props, delivery options, FAQ accordions, and mobile navigation drawer trigger.

2. **`18 — Mobile my videos` (`18 — Mobile my videos`)**:
   - Header with voice narrator indicator (*"Daniel (voice)"*) and quick `+ Create a video` action.
   - Search bar with horizontally scrollable status filters (*All, Drafts, Ready, Scheduled, Published, Needs attention*).
   - Single-column project feed with status tags, duration badges, and schematic diagram previews labeled `Storyboard preview · estimated`.
   - Included companion empty-state specimen panel (*"Your first video starts with an idea"*).

3. **`19 — Mobile idea` (`19 — Mobile idea`)**:
   - Four-stage header stepper (*Idea* active) with truthful auto-save timestamp (*14:32 IST*).
   - Structured project title, core angle textarea (with 134/800 char count), and 60–90s educational vertical format guidance.
   - Curriculum parameter cards (Audience tone, Visual milestones array), Daniel English test voice preview button (44px), and expandable Topic Ideation Assistant.
   - Sticky bottom actions: `Save draft` and `Create board →`.

4. **`20 — Mobile storyboard` (`20 — Mobile storyboard`)**:
   - Scene counter header (*Scene 03 of 06 — Array Halving*) with dropdown selector, scene carousel pills, and total duration indicator (*01:18 · Pacing: Balanced*).
   - Schematic preview diagram card labeled `Storyboard preview · estimated` with binary search array indices, orange highlighted midpoint `[3] = 42`, and on-screen caption preview.
   - Spoken voiceover breakdown with Daniel English narration, AI scene revision trigger, and previous/next scene pagination.
   - Sticky `Approve & generate video →` bottom action.

5. **`21 — Mobile video review` (`21 — Mobile video review`)**:
   - Version toggle (*v2 Active vs v1*), 9:16 vertical video player (*00:41 / 01:17*) with scrub bar, 44px playback controls, and checksum verification badge.
   - Tabbed subtitle inspector (*Captions, Visual Notes, Revision Request*) highlighting the active playback line.
   - Framed companion panel showing in-flight background synthesis (*Generating video v2 · Stage 3 of 4: Timing visuals and captions*) with cancellation safety lock.
   - Sticky `Download MP4` and `Approve & continue →` actions.

6. **`22 — Mobile publish` (`22 — Mobile publish`)**:
   - Locked video preview card (1080p · 28.4 MB) paired with connected `@namaste_demo` Instagram account info.
   - Caption editor with character counter and hashtag detector.
   - Segmented toggle between *Post now* and *Schedule for later*, complete with date picker, 24-hr time input, and IST timezone confirmation.
   - Explicit confirmation CTA (`Confirm schedule`) and standalone MP4 download.
   - Framed companion states: disconnected account fallback and mobile navigation drawer specimen (*My Videos, Instagram Connect, Settings, Daniel English*).

Suggestion: Add interactive slide-over animation to the mobile navigation drawer

Suggestion: Create a mobile error/recovery state for video generation timeouts

Suggestion: Export mobile UI design specs and token sheets for developer handoff


## Correction batch 1

I have refined all 6 selected screens according to the V1 review specifications, publishing each as a dedicated screen with `— Review` appended to its original title:

### Summary of Applied Refinements:
1. **Global Tokens & Theme**:
   - Anchored on true neutral deep black (`#090909`), deep panels (`#151515`), crisp border separators (`#303030`), signature orange accent (`#E58C33`), pure white typography (`#FAFAFA`), and muted neutral text (`#A3A3A3`).
   - Standardized typography with **Plus Jakarta Sans** for headlines and **Inter** for all UI copy, inputs, timestamps, and labels.
   - Completely stripped all design annotation footers, internal cluster names, and speculative engine metadata.

2. **01 — Sign in — Review** (Desktop, `01 — Sign in — Review`):
   - Clean default authentication form with Work Email and Password inputs.
   - Secondary error specimen (`Invalid email or password`).
   - Removed voice and video format footer metadata.

3. **02 — Access and recovery — Review** (Desktop, `02 — Access and recovery — Review`):
   - Assisted recovery card simplified to: *"Contact your administrator to restore access"* (removed fabricated Slack channels, turnaround time estimates, and licensing claims).
   - Clean security specimen for enumeration prevention.
   - Session expiration card: *"Your video generation continues. Sign in with the same account to recover any locally preserved edits."*

4. **03 — Project unavailable — Review** (Desktop, `03 — Project unavailable — Review`):
   - Generic unavailable state: strictly removed project title and stepper indicators (no workflow steps when a project cannot be loaded).
   - Clean companion error specimen: *"Video generation service temporarily unreachable. Your saved work is retained. Retry when available or contact your administrator."* with generic error reference.
   - Navigation scoped strictly to *My videos*, *Instagram*, and *Settings*.

5. **06 — Personal settings — Review** (Desktop, `06 — Personal settings — Review`):
   - Scoped sidebar navigation to only *My videos*, *Instagram*, and *Settings*.
   - Instagram publishing channel marked as **Connected** (removed blue checkmark / verified badge and token age).
   - Audio sample player for Daniel English test voice with forward-looking note.
   - Added unsaved changes confirmation dialog specimen with *Stay signed in* and *Discard & sign out*.

6. **23 — Mobile sign in and recovery — Review** (Mobile, `23 — Mobile sign in and recovery — Review`):
   - Streamlined mobile sign-in form with clean error specimen.
   - Session preservation specimen with same-user resume action.
   - Removed internal cluster IDs and format metadata footers.

7. **24 — Mobile personal settings — Review** (Mobile, `24 — Mobile personal settings — Review`):
   - Clean mobile settings layout with locked work email and IST timezone selector.
   - Daniel voice sample player and connected Instagram profile without verified badge or token freshness indicators.
   - Unsaved changes confirmation dialog specimen with clear touch targets.

Suggestion: Proceed with Batch 2: Library & Project Creation (Screens 04, 05, 07, 18, 19)

Suggestion: Proceed with Batch 3: Storyboard & Generation / Recovery (Screens 08, 09, 10, 12, 20, 22)

Suggestion: Proceed with Batch 4: Video Review & Publishing / Instagram (Screens 11, 13, 14, 15, 16, 17, 21, 22, 25, 26)

## Correction batch 2

I have completed the refinements for the 5 selected screens in this batch (Desktop `04`, `05`, `07` and Mobile `18`, `19`), each published as a dedicated review screen with `— Review` appended to its title:

### Summary of Refinements Applied:
1. **Global Tokens & Typography**:
   - Strictly anchored on true neutral pitch black (`#090909`), deep panels (`#151515`), crisp borders (`#303030`), signature orange (`#E58C33`), white (`#FAFAFA`), and muted gray (`#A3A3A3`).
   - Standardized typography with **Plus Jakarta Sans** for headlines/titles and **Inter** across all UI elements, labels, counters, and body text.
   - Removed speculative cluster/node badges and internal engine annotations.

2. **04 — My videos — Review** (Desktop, `04 — My videos — Review`):
   - Removed project search input bar (not part of V1 API).
   - Removed fabricated count badges from filter pills (`All`, `Drafts`, `Ready`, `Scheduled`, `Published`, `Needs attention`).
   - Standardized thumbnail preview labels: **Video preview** (with duration) on Ready/Published/Scheduled cards, and **Storyboard preview · estimated** on Drafts.
   - Removed per-scene approvals (storyboard approved as a whole).
   - Updated scheduled post date to future fixture: `28 Sep 2026 18:00 Asia/Kolkata (UTC+05:30)`.
   - Preserved `Git Branching` duration warning and `Load more videos`.

3. **05 — Library states — Review** (Desktop, `05 — Library states — Review`):
   - Refined primary empty state with direct explainer copy and 3 verified topic quick-starts.
   - Cleaned up companion states: filtered empty (without search bar), neutral loading skeleton, and server error retry state.
   - Updated project deletion dialog rule: explicitly reflects that deletion immediately cancels active video rendering, while submitted publishing states require verification.

4. **07 — Idea and brainstorming — Review** (Desktop, `07 — Idea and brainstorming — Review`):
   - Simplified formulation: Topic (2,000 char max, blocks whitespace/empty without arbitrary 20-char threshold), optional Audience (200 char max), and optional Notes (20,000 char max).
   - Completely purged curriculum parameters, visual milestone arrays, tone presets, wordcount promises, and duration selectors.
   - Narration voice engine displays Daniel English test voice with preview player and note that unavailable voice prompts user selection.
   - Clean companion UI specimens for input validation, English-only adaptation notice, and voice fallback prompt.

5. **18 — Mobile my videos — Review** (Mobile, `18 — Mobile my videos — Review`):
   - Removed search input and fabricated count numbers from filter pills.
   - Video cards distinguish `Video preview` vs `Storyboard preview · estimated`.
   - Updated auto-publishing date fixture to `28 Sep 2026, 18:00 IST (UTC+05:30)`.
   - Clean empty state specimen and mobile navigation.

6. **19 — Mobile idea — Review** (Mobile, `19 — Mobile idea — Review`):
   - Mobile-optimized single-column form with clean 2,000 char Topic, optional 200 char Audience, and optional 20,000 char Notes.
   - Daniel voice test preview and instant 3-card ideation assistant.
   - Bottom action bar with `Save draft` and `Create storyboard →`.

Suggestion: Refine Batch 3: Screens 08, 09, 10, 12, 20 (Storyboard & Generation)

Suggestion: Refine Batch 4: Screens 11, 13, 14, 15, 16, 21, 22, 25, 26 (Review & Publishing)

Suggestion: Review and compare Desktop vs Mobile library layouts

## Correction batch 3

I have completed the refinements for the 5 selected storyboard, generation, and recovery review screens (Desktop `08`, `09`, `10`, `12` and Mobile `20`), publishing each as a dedicated screen with `— Review` appended to its title:

### Summary of Refinements Applied:

1. **Global Tokens & Theme**:
   - Strictly unified on the **Cinema** neutral palette: deep pitch black (`#090909`), dark structural panels (`#151515`), crisp dividers (`#303030`), signature orange (`#E58C33`), white text (`#FAFAFA`), and muted gray (`#A3A3A3`).
   - Clean typographic hierarchy with **Plus Jakarta Sans** for headlines and **Inter** across all UI controls, timestamps, labels, and script prose.
   - Removed all speculative debug footers, cluster node codes, fake telemetry badges, and billing/credit claims.

2. **08 — Storyboard review — Review** (Desktop, `08 — Storyboard review — Review`):
   - **Whole-storyboard approval**: Replaced fragmented per-scene approval pills with global *Approve & generate complete video* actions.
   - **Clean metrics**: Stripped out invented retention scores (98/100), words-per-minute counters (130 wpm), and overtechnical jargon.
   - Clean 6-scene storyboard breakdown with scene schematic, Daniel voice narration, on-screen subtitles, and conversational revisions panel (*Entire video* vs. *Selected scene*).

3. **09 — Planning and save recovery — Review** (Desktop, `09 — Planning and save recovery — Review`):
   - **Truthful save recovery**: Replaced false "zero data loss" guarantees with realistic creator-friendly guidance: *"Changes have not reached the server. Keep this tab open and retry."*
   - Removed speculative local-backup-download feature; provided direct *Retry save* action.
   - **Robust conflict resolution**: Preserved local unsaved modifications with three explicit choices (*Compare differences*, *Reload saved version*, and *Reapply my changes after review*), completely preventing silent overwrites.

4. **10 — Generating video — Review** (Desktop, `10 — Generating video — Review`):
   - **5 Canonical Generation Stages**: Correctly mapped the pipeline to:
     1. *Stage 1: Preparing scenes* (Completed)
     2. *Stage 2: Creating narration* (Completed)
     3. *Stage 3: Timing visuals and captions* (In Progress)
     4. *Stage 4: Rendering video* (Queued)
     5. *Stage 5: Checking output* (Queued)
   - Clarified that **Publish** is an intentional future review step, not an automatic queue.
   - Honest background execution status with safe cancellation that preserves already-rendered media assets.

5. **12 — Generation recovery — Review** (Desktop, `12 — Generation recovery — Review`):
   - Primary recovery hero clearly pinpoints interruption at Stage 4 with key creator guarantees (*Zero partial video release* and *Voice consistency*).
   - Reusable fallback: Retains finalized version 1 with one-click *Use v1 as active video* and MP4 download.
   - Documented 6 distinct realistic incident companion states (*Service busy*, *Service temporarily unavailable*, *Cancelled generation*, *Source script modified*, *Missing diagram asset*, and *Retry limit reached*).

6. **20 — Mobile storyboard — Review** (Mobile, `20 — Mobile storyboard — Review`):
   - Streamlined mobile storyboard view with 9:16 vertical array diagram schematic preview.
   - Single-unit whole storyboard approval (*Approve & generate video →*) with touch-friendly ≥44px action buttons.
   - Scene navigation and AI revision prompt tailored for mobile screens.

Suggestion: Proceed with Batch 4: Video Review and Publishing screens (Screens 11, 13, 14, 15, 16, 21, 22, 25, 26)

Suggestion: Inspect the generated recovery companion states in Screen 12

Suggestion: View the mobile storyboard layout in Screen 20

## Correction batch 4

I have completed the refinements for the 5 selected review and publishing screens (Desktop `11`, `13`, `14` and Mobile `21`, `22`), publishing each as a dedicated screen with `— Review` appended to its title:

### Summary of Refinements Applied:

1. **Global Tokens & Theme**:
   - Strictly aligned to the **Cinema** neutral palette: deep pitch black (`#090909`), deep structural panels (`#151515`), crisp borders (`#303030`), signature orange (`#E58C33`), pure white text (`#FAFAFA`), and muted neutral gray (`#A3A3A3`).
   - Unified typography with **Plus Jakarta Sans** for headlines and **Inter** across all UI text, timestamps, inputs, tabs, and captions.
   - Removed speculative cluster/node badges, checksum strings, and technical API jargon.

2. **11 — Video review and captions — Review** (Desktop, `11 — Video review and captions — Review`):
   - **Video Preview**: Clean 01:17 preview with version switcher (`v2 (Latest) · Active` vs `v1 (Rendered 28m ago)`), plus independent MP4 download and `Approve & continue to publish →`.
   - **Streamlined Tabs**: Scoped strictly to **Captions** and **Revise** (removed extraneous visual sub-tabs).
   - **Clear Guardrails**: Explicit note explaining that caption text tweaks update display subtitles with refreshed video preview, whereas spoken narration revisions require returning to Storyboard approval.
   - **Scene Conversational Revision**: Contextual selector with natural-language prompt input (*"Make the array highlight pulse slower when 42 is found"*).

3. **13 — Publish and export — Review** (Desktop, `13 — Publish and export — Review`):
   - **Plain-Language Account**: Instagram account `@namaste_demo` marked as **Connected** (removed blue checkmark / verified badge and token freshness indicators).
   - **Caption Editor**: Clean textarea with plain-icon `Suggest caption` button (removed artificial sparkle AI icon and hashtag count requirements).
   - **Pre-Flight Summary**: Explicit approval summary for video, destination, and captions.
   - **Action Choices**: Dual dispatch options (`Post now` and `Schedule for later`), with independent 1080p MP4 master download.
   - **Disconnected Specimen**: Clear companion edge state with Instagram reconnection and explicit notice that passwords are entered only on Instagram.

4. **14 — Schedule review — Review** (Desktop, `14 — Schedule review — Review`):
   - **Consistent Future Fixture**: Standardized release date to `28 Sep 2026`, `18:00 (24-hour)`, in `Asia/Kolkata (IST · UTC+05:30)`.
   - **Plain Confirmation**: Converted time readout (`18:00 IST / 12:30 UTC`) and plain destination confirmation (`Publishing destination confirmed. Ready to post to Instagram Reels.`).
   - **Edge Case Specimens**: 4 canonical review specimens (*Past time validation*, *Daylight saving time transition*, *Ambiguous fallback hour*, and *Scheduled confirmation state* with edit/cancel).

5. **21 — Mobile video review — Review** (Mobile, `21 — Mobile video review — Review`):
   - Mobile vertical player preview with accessible ≥44px playback controls and version switcher.
   - Scoped strictly to two review tabs: **Captions (6)** and **Revise**.
   - Active line highlighted at 00:26–00:41 with clear caption edit guidance.
   - Companion in-flight generation card showing *Stage 3 of 5 (Timing visuals and captions)* with background execution notice.

6. **22 — Mobile publish — Review** (Mobile, `22 — Mobile publish — Review`):
   - Streamlined mobile publishing card with connected account `@namaste_demo` (no blue checkmark).
   - Clean caption area with plain-text `Suggest caption` and future schedule fixture (`28 Sep 2026, 18:00 IST`).
   - Companion disconnected specimen and bottom navigation bar matching the approved Cinema workspace.

Suggestion: Review mobile schedule sheets (screen 26) and Instagram connection (screen 25)

Suggestion: Export complete set of review screens to production design bundle

Suggestion: Inspect companion error edge cases across desktop and mobile

## Correction batch 5

I have completed the refinements for the 4 selected screens in this batch (Desktop `15` and `16`, Mobile `25` and `26`), publishing each as a dedicated review screen with `— Review` appended to its title:

### Summary of Refinements Applied:

1. **Global Palette & Typography Alignment**:
   - Strictly anchored to the **Cinema** neutral dark system: deep pitch black (`#090909`), deep panels and sheets (`#151515`), crisp border lines (`#303030`), signature warm orange accent (`#E58C33`), clean white text (`#FAFAFA`), and muted neutral gray (`#A3A3A3`).
   - Clean typographic pairing: **Plus Jakarta Sans** for headlines and titles; **Inter** for all body copy, inputs, action buttons, timestamps, and status labels.
   - Removed all speculative internal cluster names, engine build codes, token age timestamps, and fake verified badges.

2. **15 — Publishing status and management — Review** (Desktop, `15 — Publishing status and management — Review`):
   - **Top Navigation**: Scoped strictly to *Back to my videos*, the project title *Explain binary search to a beginner*, and the 4 pipeline steps (*01 Idea*, *02 Storyboard*, *03 Video*, *04 Publish*).
   - **Active Execution Panel**:
     - Plain-language stage mapping: *Stage 1: Uploading video* (Completed), *Stage 2: Processing video* (In progress), *Stage 3: Confirming publishing* (Queued).
     - Simple, human status readout: *"Current Status: Publishing to Instagram in progress. Please do not submit duplicate posts."* (No OAuth/Graph API jargon).
   - **6 Documented Diagnostic Specimens**:
     - *Specimen A (Published Confirmed State)*: Clean confirmation on `@namaste_demo` with *View on Instagram* action.
     - *Specimen B (Publication Outcome Unknown)*: Clear explanation of network timeout; safety-locks *Post again* while checking timeline to prevent double-posting.
     - *Specimen C (Upload Interrupted - Zero Payload)*: Safe retry without duplication risk.
     - *Specimen D (Expired Session Policy)*: Clearly distinguishes expired retry window (30m limit requiring reapproval) from expired login.
     - *Specimen E (Replace Scheduled Version)*: Direct action to replace scheduled v1 with fresh render v2 while preserving caption settings.
     - *Specimen F (Cancel Scheduled Post)*: Scheduled fixture set to future `28 Sep 2026, 18:00 IST` with confirm/keep dialog.

3. **16 — Instagram connection — Review** (Desktop, `16 — Instagram connection — Review`):
   - **Scoped Navigation**: Clean sidebar navigation strictly containing *My videos*, *Instagram*, and *Settings*.
   - **Creator Safe Harbor**: Clear banner emphasizing that direct 1080p MP4 master export remains 100% available regardless of social connection status.
   - **State A (Connected)**: Account `@namaste_demo` marked as plain **Connected** (removed blue checkmark / verified badge and token freshness timers). Included scheduled workflow pause warning on disconnect.
   - **State B (Connect Specs)**: Passwords clearly noted as entered directly on Instagram. Added 60-day token expiration specimen.
   - **6 Companion Edge States**: *Authorization cancelled*, *Permissions required*, *Personal account not supported*, *Account already connected to another workspace*, *Changed destination guard* (blocks silent post redirection), and *Publishing in progress lock*.

4. **25 — Mobile Instagram connection — Review** (Mobile, `25 — Mobile Instagram connection — Review`):
   - Mobile-optimized layout with clean top app bar and Creator Safe Harbor notice.
   - Connected `@namaste_demo` profile displaying **Connected** without false verified badges or token age.
   - Clear warning for active scheduled post on `28 Sep 2026`.
   - Companion states for personal account conversion guidance and cancelled authorization, with touch targets sized at ≥44px.

5. **26 — Mobile schedule and recovery sheets — Review** (Mobile, `26 — Mobile schedule and recovery sheets — Review`):
   - **State 1 (Schedule Review Sheet)**: Vertical 9:16 master video preview, target account `@namaste_demo` (Connected), future date fixture `28 Sep 2026 18:00 (24h)`, `Asia/Kolkata (IST · UTC+05:30)`, and clear confirmation readout.
   - **State 2 (Scheduled Success & Management)**: Confirmed schedule badge with *Edit schedule* and *Cancel scheduled post* modal.
   - **State 3 (Publication Outcome Unknown)**: Timed-out dispatch status lock to avoid duplicate reel posting.
   - **State 4 (Save Conflict & Local Recovery)**: Honest conflict resolution displaying local phone text vs. remote saved text with non-destructive choices (*Keep local version*, *Reload remote*, *Compare differences*).

Suggestion: Review Desktop Screen 15 and 16 on the Canvas

Suggestion: Inspect Mobile Screen 25 and 26 sheets

Suggestion: Review the complete set of 25 Cinema V1 screens
