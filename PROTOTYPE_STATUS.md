# NamasteVideo.ai — prototype status

Updated: September 26, 2026

## Current milestone

The user approved the visual theme of the first narrated water-cycle video and chose to retain Daniel as a temporary test voice. Work now covers three narrated topics, Gemini storyboard generation, revisions, and real renderer-failure recovery. This is a local pipeline, not yet a SaaS dashboard.

## Proven outputs

- `runs/water-cycle-viraj-live/output.mp4`: completed authored water-cycle storyboard with real ElevenLabs Daniel narration. H.264, 1080 × 1920, 30 fps; 81.73-second video, AAC audio. Seven scenes and 31 caption segments. Export and timestamp checks passed. User approved visual theme, motion, typography, and captions; voice accepted for testing only. Historical run name does not describe the actual narrator.
- `runs/water-cycle-fixture/output.mp4`: 70-second authored silent fixture with synthetic timing. Not evidence of AI narration.

## Second-topic result

- `runs/ram-storage-daniel-reviewed/output.mp4`: completed Gemini-authored/revised RAM-versus-storage explainer with Daniel narration. 77.67-second video, 77.696-second MP4, 2,330 frames, 1080 × 1920, H.264/AAC at 30 fps. Seven scenes and 27 caption segments; 4,904,493 bytes.
- Export checks and timeline/caption bounds passed. Representative frames inspected for the intro, analogy, volatility, opening app, upgrades, and summary. No visible clipping in checked frames. Full perceptual/editorial review is pending user feedback.
- TypeScript and all 23 automated tests passed. New tests cover explicit test voice selection, Gemini response parsing, restricted visual catalog, and incomplete/oversized comparison data.
- Initial AI draft was not approved: factual guarantees about storage and incorrect water visuals were identified and corrected through an AI revision. One final storage label was edited by the operator; correction is recorded in the manifest.

## Working integrations

- Gemini 3.5 Flash via `/v1beta/interactions`, with JSON Schema, `store: false`, local validation, and explicit content review. Successfully generated `ram-storage-daniel` and conversationally revised it into `ram-storage-daniel-reviewed`. The reviewed plan also has one recorded operator label correction.
- Gemini availability has varied. Binary search succeeded with an explicit Gemini 3.8 Flash override after 3.5 errors; the configured/code default remains 3.5. Provider schemas now omit irrelevant component fields. No guarantee is made that every endpoint/model request will succeed.
- ElevenLabs `eleven_multilingual_v2`, speech-with-timestamps. Daniel (`onwK4e9ZLuTAKqWW03F9`) is represented by an explicit `daniel-test` preset, default for new runs. Indian voice IDs and keys remain intact.
- Indian library voices were rejected on the free plan. Voice audition and narrator switching to the intended Indian voices are deferred by the user's decision to keep Daniel for testing. Account API key lacks voice-list permissions; public premade catalog was sufficient to identify Daniel.

## Implemented safeguards and visuals

- Runtime contracts, unique scene IDs, exact phrase cues, hash-bound plan approval, exclusive run lock, atomic artifacts, audio hashes and narration/model/voice cache fingerprints.
- Returned alignment must match approved narration exactly; differences fail before rendering. Frame compiler builds contiguous 60–90-second timelines and captions.
- Dedicated paired comparison panels and directional flow steps, with bounded copy, plus existing water-cycle diagrams. General-topic planner schema excludes water-only diagrams.
- Comparison scenes require two populated panels. Flow scenes require at least two steps.
- Storyboard HTML includes paired panel headings and points for review. Manifest records actual narrator and planner model.
- `--audio-only` supports isolated speech testing. Errors expose only allowlisted provider codes, not secret-bearing response bodies. No automatic speech retry.

## Third-topic and recovery results

- `runs/binary-search-reviewed/output.mp4`: 76.992-second MP4, 2,309 video frames, seven scenes, real Daniel narration. Gemini 3.8 draft plus recorded operator revision. Export checks passed (1080 × 1920, H.264/AAC, 30 fps).
- Binary-search components compute the search trace from validated sorted numbers. Separate midpoint and decision cues use actual speech alignment. Sampled final-video frames correctly retain 10/12/14 after checking 8, retain 10 after checking 12, and mark 10 found. Timeline/caption bounds passed; the user subsequently approved the latest video, including narration, synchronization, animation and storyboard.
- `runs/ram-storage-recovery/recovery-report.json`: title-only revision reused seven speech clips, generated zero, recovered from an injected missing-browser failure, and preserved the original MP4 hash. Provider requests were blocked by the test harness.
- The first injected failure exposed lingering bundler handles after CLI errors. The CLI now exits explicitly after recording failure and releasing the lock. The initial old process required termination; `runs/renderer-exit-check/failure-exit-report.json` separately proves the fixed version exits with code 1 without intervention and releases its lock.
- TypeScript and 23 automated tests pass, including binary-search boundaries, absent targets, invalid inputs, and separate speech-aligned decision cues.

## Remaining before full application work

- The user accepted the latest binary-search output and approved moving to application design. Separate structured evaluation of the broader 20-topic set remains a release task.
- Application design is documented in `SYSTEM_DESIGN.md`; hosted rendering and Meta setup remain implementation gates before release.
- Add robust normalization mapping for speech responses that do not echo narration exactly; current strict behavior remains intentional.
- Add automated text-overflow measurements, scene preview embedding in storyboard review, and improved cancellation/retry UX.

No dashboard, authentication, MongoDB, R2, hosted jobs, Instagram publishing, billing, or backups are implemented yet. The PRD remains the product target. Indian voice-quality evaluation is explicitly deferred, not passed.
