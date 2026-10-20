# UI review checklist and state mapping

Status: design review criteria. Use with SCREEN_REVIEW_INDEX.md.

| Screen family | Contract | Review checkpoints |
| --- | --- | --- |
| Access | Auth facade, owner isolation | No signup; generic credential errors; operator-assisted recovery; expired session resumes an existing job rather than starting another |
| Library | P01–P04, cursor pagination | Personal projects only; filters can overlap (new draft plus older scheduled video); Load more not invented page counts; no billing |
| Idea | Draft and planning contracts | Preserve typed input; Daniel test voice honest; optional brainstorming in same step; no forced duration selector; 60–90 sec English scope |
| Storyboard | PlanV2, revision and approval | Spoken narration + on-screen text + estimated schematic; edit/revise before approval; stale AI output cannot overwrite newer input |
| Generation | JobView, one active pipeline | Stage progress; measured percentages only; cancel request vs completion distinguished; last successful output survives |
| Review | VideoView, caption rendering | Actual encoded preview; video version explicit; spoken changes require approval; captions cannot disagree silently; incomplete export unavailable |
| Publishing | PublishIntentView | Exact reviewed asset/account/caption; download independent; single explicit publish action; no automatic publication |
| Scheduling | Frozen payload + local time/offset | Timezone visible, future lead time validated, DST ambiguity resolved; edits do not change pinned scheduled version |
| Instagram | ConnectionView + callback | Official authorization; no passwords/keys; own account only; changed account never redirects schedules silently |
| Settings | Preferences | Timezone and default voice apply appropriately; no team settings, brand kit or credit counter |
| Shared feedback | API_DESIGN error catalog | Inline corrective action; no provider secrets; no raw stack traces; preserve entered text |
| Mobile | Same routes/contracts | One column, readable player, drawers/sheets, sticky actions clear of content, 44px touch targets |

## Remaining interaction states represented by shared patterns

- Topic empty/over 2,000 characters: inline validation before planning. Audience at most 200 characters; notes at most 20,000. Preserve content.
- Rename title 1–100 characters; post caption limit supplied by capability validation (initial ceiling 2,200). Character counts are advisory; the server is authoritative.
- Rate limits: waiting/retry-after message, never an upgrade prompt.
- Failed request with unknown acceptance: check current job before repeating action.
- Repost after confirmed publication: explicit warning and distinct approval; ordinary Retry cannot create a new post.
- Expiring media preview URL: refresh authorized media access; if asset is actually missing, offer regeneration and require review.
- Loading and empty histories: use existing skeleton/empty patterns rather than blank pages.
- Changing voice after rendering: explain new narration/timing and version, retain old output and schedule.
- Storyboard generation asks one focused clarification when necessary.
- Completed approval becomes stale after an edit: disable dependent action and ask for approval of current content.
- Mobile dialogs are bottom sheets or full-width panels with focus management, keyboard access, accessible names, escape/close behavior and return focus.
- Destructive actions use explicit named action labels and default to Cancel; acknowledge external posts remain outside project deletion.

## Implementation handoff

No API or schema changes are implied by a visual convenience. In particular, project search is not defined in P01; omit it from the coded V1 unless the contract is intentionally extended. Dates, usernames, output durations and progress are illustrative fixtures. Design status labels must be backed by server state when implemented.

Do not infer click behavior, accessibility conformance or backend readiness from Stitch screenshots. Before coding, review and resolve copy/layout feedback, then implement against existing API/DB documents.
