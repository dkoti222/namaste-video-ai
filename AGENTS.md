# Development workflow

- Read PROJECT_STATUS.md before starting implementation. It is the source of truth for implemented features and verification; PRD/API/DB/system design describe intended behavior.
- Work in small feature slices. Update PROJECT_STATUS.md in the same change whenever code or configuration changes: scope, status, files, verification results and remaining limitations. Never mark planned UI or mocked behavior as implemented.
- Preserve the working prototype CLI and rendering tests. The Next.js application lives in apps/web; never expose root public/runs or runs through the web application.
- Keep credentials out of source, logs, client bundles and status documents. Root .env.local belongs to the prototype; web environment configuration is separate.
- Use the approved Cinema tokens for app chrome. Preserve the separately approved video visual style.
- Complete the current feature and report evidence before beginning the next major feature. Do not deploy or publish external content as part of local scaffold work.
- At every completed development step or milestone, update PROJECT_STATUS.md, run relevant checks, commit the coherent changes and push to the GitHub repository `git@github.com:akshaymarch7/namaste-video-ai.git`. The user has authorized this ongoing Git workflow. Verify the remote branch matches the local commit before reporting a successful push. Report any blocked/unpushed work and remind the user that synchronization remains outstanding. Never force-push, publish secrets/generated private media, or include unrelated changes. This authorization covers repository updates, not deployment or social publishing.
