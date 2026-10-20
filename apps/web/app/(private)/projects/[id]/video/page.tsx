import type { Metadata } from "next";
import { PrivateShell } from "@/components/private-shell";
import { ProjectSteps } from "@/components/project-steps";
import { ActionLink } from "@/components/ui";
import { VideoReview } from "@/components/video-review";
import { getAuthServices } from "@/server/auth/auth";
import { requirePrivateSession } from "@/server/auth/dal";
import { getJob, getProject } from "@/server/projects/service";
import { listVideos } from "@/server/videos/service";

export const metadata: Metadata = { title: "Video" };

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePrivateSession(`/projects/${id}/video`);
  const { db, config } = await getAuthServices();
  const ownerId = session.user.id;
  const project = await getProject(db, ownerId, id);
  const page = project ? await listVideos(db, config.secret, ownerId, id, { limit: 20 }) : null;

  if (!project || !page || page.items.length === 0) {
    return (
      <PrivateShell user={session.user}>
        <section className="state-panel unavailable">
          <h1>{project ? "No video yet" : "This project is unavailable"}</h1>
          <p className="muted">{project ? "Approve your storyboard to generate the video." : "It may have been deleted, or the link may be wrong."}</p>
          <ActionLink href={project ? `/projects/${id}/storyboard` : "/videos"}>{project ? "Go to the storyboard" : "Back to my videos"}</ActionLink>
        </section>
      </PrivateShell>
    );
  }

  // Generation job per video (progress, failure and retry for versions that aren't ready).
  const jobDocs = await db
    .collection("jobs")
    .find({ ownerId, projectId: id, type: { $in: ["generation", "caption_render"] }, "inputSnapshot.videoId": { $in: page.items.map((v) => v.id) } }, { projection: { _id: 1, "inputSnapshot.videoId": 1 } })
    .toArray();
  const jobs: Record<string, NonNullable<Awaited<ReturnType<typeof getJob>>>> = {};
  for (const doc of jobDocs) {
    const view = await getJob(db, ownerId, String(doc._id));
    if (view) jobs[String(doc.inputSnapshot.videoId)] = view;
  }

  // Storyboard info per version (for scene-scoped revisions from the video screen).
  const storyboardDocs = await db
    .collection("storyboards")
    .find({ ownerId, projectId: id, _id: { $in: [...new Set(page.items.map((v) => v.storyboardId))] as never[] } }, { projection: { contentHash: 1, "content.scenes.id": 1, "content.scenes.title": 1 } })
    .toArray();
  const storyboards = Object.fromEntries(storyboardDocs.map((d) => [String(d._id), { id: String(d._id), contentHash: String(d.contentHash), scenes: (d.content.scenes as { id: string; title: string }[]).map((s) => ({ id: s.id, title: s.title })) }]));

  return (
    <PrivateShell user={session.user}>
      <div className="idea-page">
        <h1 className="idea-title">{project.title}</h1>
        <ProjectSteps projectId={id} current="video" storyboardReady videoReady publishReady={page.items.some((v) => v.state === "approved")} />
        <VideoReview projectId={id} versions={page.items} jobs={jobs as never} storyboards={storyboards} />
      </div>
    </PrivateShell>
  );
}
