# Screen review findings

The first generation is a review draft. Screen IDs and final corrections are tracked in SCREEN_REVIEW_INDEX.md and the generated manifest.

## Cleanup targets identified during generation

- Sign-in: remove generated production-status, default-voice and architecture labels from auth chrome. Authentication should stay focused on signing in and recovery.
- Library: remove generated Studio/Queue navigation and documentation/feedback links outside V1. Use My videos, Instagram and Settings only.
- Project search is not in API P01; remove the generated search control for V1. Keep agreed status filters and Load more.
- Library thumbnail badges should distinguish actual Ready/Published video from estimated storyboard previews. Do not label every finished output as a schematic.
- Remove design annotation language (Cinema direction, fictional fixture disclaimers, architecture labels) from user-facing chrome; keep those facts in handoff documentation.

These are design-polish observations, not implemented product bugs. All screens remain subject to founder review and later interaction/accessibility testing.

## Verification approach

Final pass: all 26 current screen resources were retrieved individually. The Stitch list-screens endpoint still returns only the four older project entries; this listing inconsistency is unresolved. Use the current manifest and direct preview links in SCREEN_REVIEW_INDEX.md if the project canvas does not surface a new screen. The in-app browser was not signed in to Stitch, so authenticated canvas visibility was not verified there.

Confirmed generated screen resources for the major workflow families and visually sampled sign-in, library, storyboard, video review, publishing, and the corrected mobile idea form. The corrected generation-recovery HTML uses the exact neutral Cinema background/panel tokens and no longer shows credit/quota labels. Final screen coverage and current IDs are recorded in the review index.

Stitch may retain minor presentation copy that deserves editorial refinement, such as “System operational” on an auth specimen, generic legal/support footer links, or technical recovery headings. These are mockup details, not live service status, implemented routes, or approved product requirements. Replace them with real app-supported copy during review/implementation. Do not infer working provider integrations or full accessibility verification from generated screens.
