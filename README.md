# NamasteVideo.ai

A local TypeScript prototype for short educational motion-graphics videos. The first user-reviewed output is `runs/water-cycle-viraj-live/output.mp4`: 81.7 seconds, 1080 × 1920, Daniel narration, captions and animated water diagrams. The storyboard for that first video was authored. Gemini planning and conversational revision are now working through Gemini 3.5 Flash's Interactions API.

The repository also includes an isolated Next.js application scaffold in `apps/web`. Authentication and dashboard features are not implemented yet. [Project Status](PROJECT_STATUS.md) is the development source of truth; [prototype status](PROTOTYPE_STATUS.md) retains historical pipeline evidence.

## Run the application scaffold

Use Node **24.21.0** (`nvm use` reads `.nvmrc`), then:

```sh
npm ci
npm run dev
```

Open http://localhost:3000 for the scaffold preview and `/foundation` for Cinema UI specimens. These routes do not save data or call providers. `npm run build` builds the web app; `npm start` serves the production build locally. `npm run check` checks both workspaces and runs the existing prototype tests.

The web app's public directory is separate from root `public/runs`. Do not copy or link prototype media into it. Root `.env.local` belongs to the CLI; web secrets go in ignored `apps/web/.env.local` (see `apps/web/.env.example`). The pages need no environment variables. The database layer (F02) needs `MONGODB_URI` and `MONGODB_DB_NAME` pointing at an isolated, transaction-capable development database; then run `npm run db:migrate` (operator setup, idempotent) and `npm run db:status` (read-only check). Sign-in (F03) also needs `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. There is no public signup: an operator provisions each approved account with `npm run access -- provision <email>` (password typed at a hidden prompt), and can `disable`, `enable`, `reset-password` or `list`.

## Application design documents

- [Product requirements](PRD.md)
- [System design](SYSTEM_DESIGN.md)
- [API design: requests, responses, authentication, errors and pagination](API_DESIGN.md)
- [Database design: schemas, relationships, indexes, state and transactions](DB_DESIGN.md)

The application contracts are design documents, not deployed endpoints or migrations. Cinema screen designs are approved for implementation; features are being built incrementally according to Project Status.

## Latest outputs

`runs/binary-search-reviewed/output.mp4` is a 77-second binary-search explainer with real Daniel narration, captions, and deterministic midpoint/elimination animation. Gemini 3.8 Flash produced the draft; operator review refined decision cues and the final explanation. Three narrated topics now exist: water cycle, RAM versus storage, and binary search. The latter two await user playback review.

TypeScript and all 23 tests pass. A title-only revision reused all seven speech clips; an injected renderer failure resumed without provider calls. See `PROTOTYPE_STATUS.md` for evidence and remaining limits.

## Setup

```sh
npm install
npm run check
npm run pipeline -- preflight
```

Use Node 22 or newer. Copy `.env.example` to `.env.local` only if you have not already configured it. Keep all keys local; `.env.local`, generated runs, and media are excluded from Git. Preflight reports presence only, not live validity.

- `GEMINI_API_KEY`, `GEMINI_MODEL` (verified default: `gemini-3.5-flash`).
- `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL` (default: `eleven_multilingual_v2`).
- Optional preferred Indian male and female voice IDs. Free-plan API access to library voices was rejected by ElevenLabs in testing.
- Optional `BROWSER_EXECUTABLE`; otherwise Remotion uses its downloaded Chrome Headless Shell.

The default narrator is `daniel-test`: Daniel, a **British English male**, explicitly accepted for prototype testing. This preset does not overwrite the preferred Indian voice settings. Other presets remain `indian-english-male` and `indian-english-female`.

## Idea → storyboard → video

```sh
npm run pipeline -- plan --run my-video --topic-file examples/ram-storage.md
# Inspect runs/my-video/plan-review.html and its factual claims.
npm run pipeline -- approve --run my-video --plan-hash <printed-hash>
npm run pipeline -- generate --run my-video
```

Planning and narration consume provider credits. Review factual content before approving: schema validation cannot establish truth. An initial AI draft incorrectly overstated data permanence; the reviewed revision corrected it before narration.

The plan command defaults to Daniel. Add `--voice indian-english-male` only when that configured voice is accessible to your account. Water-cycle topics have specialized diagram types; other topics currently support comparison and flow components. Binary-search topics additionally support sorted numeric lists with computed midpoint and elimination states. Broad arbitrary-topic illustration remains limited to the available component catalog.

Outputs include `plan.json`, `plan-review.html`, `manifest.json`, per-scene speech/alignment, `timeline.json`, `preview-frames/`, `output.mp4`, and `qa.json`. Export checks cover codec, dimensions, frame rate, duration and audio presence; they do not replace listening and visual review.

```sh
npm run pipeline -- resume --run my-video
npm run pipeline -- resume --run my-video --audio-only
npm run pipeline -- resume --run my-video --stills-only
```

Resume verifies cache fingerprints and audio hashes before reuse. A new export replaces the previous MP4 only after passing checks. Do not delete a run lock unless its process has stopped.

## Conversational revisions

```sh
npm run pipeline -- revise --from my-video --run my-revision --instruction-file examples/ram-storage-revision.md
# Review and approve the new hash, then generate.
```

Every revision has a new run ID, approval hash, and parent reference. Only compatible narration caches are reused. A narrator change also requires a new run:

```sh
npm run pipeline -- change-voice --from my-video --run new-narrator --voice daniel-test
```

## Authored and silent tests

```sh
npm run pipeline -- import-plan --run authored-video --plan-file fixtures/water-cycle.json
npm run pipeline -- fixture --run silent-fixture
```

Both require approval before generating. Import mode uses real AI narration with authored content. Fixture mode is visibly labeled, silent, and synthetically timed. `npm run studio` opens the silent fixture composition, not the latest live video.

## Known limitations

Development progress is tracked in [PROJECT_STATUS.md](PROJECT_STATUS.md). UI design review is maintained in [design/SCREEN_REVIEW_INDEX.md](design/SCREEN_REVIEW_INDEX.md), with the approved Cinema brand in [design/NAMASTE_DIRECTION.md](design/NAMASTE_DIRECTION.md). Stitch screens remain design artifacts; the Next.js foundation is under `apps/web`, while authenticated dashboard features are still planned.

- Local developer workflow; no accounts, per-user ownership service, database, cloud storage, queue or Instagram connection yet. Never deploy the local public media folder as a multi-user service.
- Strict alignment rejects normalized narration differences instead of inventing timestamps.
- AI content still needs review; no open-web fact checker is included.
- No automatic speech retries, friendly cancellation UI, text-overflow measurement, or completed human review of all three topics yet.
- Real Indian voice quality remains deferred. Daniel is for testing.

## Operator edits and recovery checks

```sh
npm run pipeline -- edit-plan --from my-video --run edited-video --plan-file reviewed-plan.json
# Review and approve the new hash before generating.
```

This validates an edited plan and carries compatible audio into a new run without altering the source export.

The integration checks in `scripts/verify-recovery.ts` and `scripts/verify-failure-exit.ts` use the existing RAM output and fixed, single-use destination run IDs. They refuse to overwrite existing runs. They guard against provider requests, inject a missing-browser failure, and check cache reuse, lock release, process exit, and recovery. Reports are saved under `runs/ram-storage-recovery/` and `runs/renderer-exit-check/`.
