# Homepage — Cinema

Status: Stitch design for review. Brand direction approved; page not yet approved or implemented.

Project: https://stitch.withgoogle.com/projects/7744432091837998456

Current homepage screen: `f1317d2b15684934a84d7fea70623b03` — “NamasteVideo.ai — Cinema Homepage”. Approved brand board: `48c17be5805444e3817d2cd1c48f5205`. Earlier screen revisions are superseded.

## Purpose

Pre-login product homepage introducing the internal preview. The primary action is Create a video, leading to sign-in for approved users. Authenticated users can go to their private creation workspace. This does not add public registration or billing.

## Composition

1. Wordmark, How it works, Examples, FAQ, Sign in, Internal preview indicator.
2. Hero: “Your idea. Ready to play.” Large cinematic typography, orange emphasis, Create a video and Watch an example. Bespoke vertical binary-search preview beside a short idea slip and storyboard sequence. Clear explanation of motion graphics, narration and captions.
3. Four steps: Idea, Storyboard, Video, Publish. Explicit approval before generation and publication.
4. Example previews: binary search, RAM versus storage, water cycle. Durations are rounded from the existing prototypes. Thumbnails are illustrative until actual exports are wired in.
5. Synchronized visuals/narration/captions; combined script/storyboard; conversational revisions.
6. MP4 download and eligible Instagram professional account connection, posting and scheduling.
7. FAQ: supported content and duration, editing, download independence, Instagram eligibility, internal access.
8. Closing Create a video action and minimal footer.

Do not promise unavailable Indian voice presets, instant rendering, public access, or unsupported video formats. Do not add fabricated users, testimonials, metrics, or pricing.

## Hero motion specification

An 8-second silent explanatory sequence:

- 0–1.5s: idea slip appears with a subtle fade and short vertical translation.
- 1.5–3s: three storyboard frames reveal along a connector.
- 3–6s: midpoint tile highlights and discarded half dims; caption changes on the same timeline.
- 6–8s: resolved frame holds, with the playhead completing.

Play once when visible; Replay starts again. Pause is available throughout. No autoplay audio, flashing, pointer-dependent meaning, or layout shifts. Pause when offscreen. Reduced-motion users see the resolved still. Keep this separate from the actual example-video player, which starts on user interaction and has captions and standard playback controls.

Stitch may only illustrate the sequence. Live motion must be inspected and implemented/tested separately if its output is static. Do not treat a play icon or waveform as working media.

## Responsive and accessibility implementation requirements

Desktop: asymmetric two-column hero, text and CTA readable without scrolling. Mobile: text and CTA first, one vertical preview next; remove supporting floating artifacts if cramped. Stack workflow and feature sections, preserve semantic reading order, and avoid horizontal overflow. Collapse navigation accessibly. Fluid hero type from approximately 44px mobile to 80–96px desktop. Body minimum 16px. Controls minimum 44px. Visible focus, keyboard-operable FAQ and media, named icon controls, sufficient contrast, and reduced-motion support.

The Stitch desktop composition is a design artifact, not evidence of responsive behavior or functional controls.
