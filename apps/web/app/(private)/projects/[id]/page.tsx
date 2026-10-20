import type { Metadata } from "next";
import { IdeaEditor } from "@/components/idea-editor";
import { PrivateShell } from "@/components/private-shell";
import { ActionLink } from "@/components/ui";
import { readGeminiConfig } from "@/server/ai/gemini";
import { getAuthServices } from "@/server/auth/auth";
import { requirePrivateSession } from "@/server/auth/dal";
import { getDraft } from "@/server/drafts/service";
import { latestIdeas } from "@/server/jobs/brainstorm";
import { getProject } from "@/server/projects/service";
import { enabledVoiceSamples } from "@/server/media/assets";
import { availableVoices } from "@/server/voices";

export const metadata: Metadata = { title: "Idea" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePrivateSession(`/projects/${id}`);
  const { db } = await getAuthServices();
  const ownerId = session.user.id;
  const [project, draft] = await Promise.all([getProject(db, ownerId, id), getDraft(db, ownerId, id)]);

  if (!project || !draft) {
    // Screen 03: generic — never reveals whether the project exists or belongs to someone else.
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

  const ideas = await latestIdeas(db, ownerId, id);
  const job = project.activeJobId ? await db.collection("jobs").findOne({ _id: project.activeJobId as never, ownerId }, { projection: { type: 1 } }) : null;
  const activeJob = job ? { id: String(job._id), type: String(job.type) } : null;
  const samples = await enabledVoiceSamples(db);
  const voices = availableVoices().map((voice) => ({ ...voice, sampleUrl: samples.has(voice.preset) ? `/api/voices/${voice.preset}/sample` : null }));
  return (
    <PrivateShell user={session.user}>
      <IdeaEditor
        project={{ id: project.id, title: project.title }}
        draft={{ revision: draft.revision, topic: draft.topic, audience: draft.audience, notes: draft.notes, voicePreset: draft.voicePreset, editablePlan: draft.editablePlan }}
        voices={voices}
        initialIdeas={ideas?.suggestions ?? []}
        activeJob={activeJob}
        ideasEnabled={readGeminiConfig() !== null}
      />
    </PrivateShell>
  );
}
