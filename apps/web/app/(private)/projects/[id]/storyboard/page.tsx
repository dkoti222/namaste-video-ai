import type { Metadata } from "next";
import { PrivateShell } from "@/components/private-shell";
import { StoryboardEditor } from "@/components/storyboard-editor";
import { ActionLink } from "@/components/ui";
import { getAuthServices } from "@/server/auth/auth";
import { requirePrivateSession } from "@/server/auth/dal";
import { getDraft } from "@/server/drafts/service";
import { getProject } from "@/server/projects/service";
import { getStoryboard, listStoryboards } from "@/server/storyboards/service";

export const metadata: Metadata = { title: "Storyboard" };

export default async function StoryboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePrivateSession(`/projects/${id}/storyboard`);
  const { db, config } = await getAuthServices();
  const ownerId = session.user.id;
  const [project, draft] = await Promise.all([getProject(db, ownerId, id), getDraft(db, ownerId, id)]);

  if (!project || !draft) {
    return (
      <PrivateShell user={session.user}>
        <section className="state-panel unavailable">
          <h1>This project is unavailable</h1>
          <p className="muted">It may have been deleted, or the link may be wrong.</p>
          <ActionLink href="/videos">Back to my videos</ActionLink>
        </section>
      </PrivateShell>
    );
  }
  if (!draft.editablePlan) {
    return (
      <PrivateShell user={session.user}>
        <section className="state-panel unavailable">
          <h1>No storyboard yet</h1>
          <p className="muted">Describe your idea first, then create a storyboard from it.</p>
          <ActionLink href={`/projects/${id}`}>Go to the idea step</ActionLink>
        </section>
      </PrivateShell>
    );
  }

  const [source, history] = await Promise.all([
    draft.sourceStoryboardId ? getStoryboard(db, ownerId, draft.sourceStoryboardId) : null,
    listStoryboards(db, config.secret, ownerId, id, { limit: 20 }),
  ]);
  const approvedSummary = history?.items.find((v) => v.approvalId) ?? null;
  const approvedFull = approvedSummary ? await getStoryboard(db, ownerId, approvedSummary.id) : null;
  const approval = approvedFull?.approvalId ? await db.collection("approvals").findOne({ _id: approvedFull.approvalId as never, ownerId }, { projection: { approvedAt: 1 } }) : null;
  const hasVideo = (await db.collection("videos").countDocuments({ ownerId, projectId: id }, { limit: 1 })) > 0;
  const job = project.activeJobId ? await db.collection("jobs").findOne({ _id: project.activeJobId as never, ownerId }, { projection: { type: 1 } }) : null;
  return (
    <PrivateShell user={session.user}>
      <StoryboardEditor
        project={{ id: project.id, title: project.title }}
        draft={{ revision: draft.revision, topic: draft.topic, audience: draft.audience, notes: draft.notes, voicePreset: draft.voicePreset, editablePlan: draft.editablePlan }}
        activeJob={job ? { id: String(job._id), type: String(job.type) } : null}
        source={source ? { id: source.id, contentHash: source.contentHash } : null}
        approved={approvedFull && approval ? { at: approval.approvedAt.toISOString(), content: approvedFull.content } : null}
        versions={history?.items ?? []}
        hasVideo={hasVideo}
      />
    </PrivateShell>
  );
}
