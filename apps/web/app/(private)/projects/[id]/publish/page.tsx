import type { Metadata } from "next";
import { PrivateShell } from "@/components/private-shell";
import { ProjectSteps } from "@/components/project-steps";
import { PublishPanel } from "@/components/publish-panel";
import { ActionLink } from "@/components/ui";
import { getAuthServices } from "@/server/auth/auth";
import { requirePrivateSession } from "@/server/auth/dal";
import { getConnection } from "@/server/instagram/service";
import { getProject } from "@/server/projects/service";
import { listIntents, publishingConfigured } from "@/server/publish/service";
import { listVideos } from "@/server/videos/service";

export const metadata: Metadata = { title: "Publish" };

export default async function PublishPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ video?: string | string[] }> }) {
  const { id } = await params;
  const session = await requirePrivateSession(`/projects/${id}/publish`);
  const { db, config } = await getAuthServices();
  const ownerId = session.user.id;
  const project = await getProject(db, ownerId, id);
  const page = project ? await listVideos(db, config.secret, ownerId, id, { limit: 20 }) : null;
  if (!project || !page) {
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
  const [connection, intents, query] = await Promise.all([getConnection(db, ownerId), listIntents(db, config.secret, ownerId, id, { limit: 20 }), searchParams]);
  const versions = page.items.map((video, index) => ({ ...video, number: page.items.length - index }));
  const requested = typeof query.video === "string" ? query.video : null;
  const initialVideoId = requested ?? (project.selectedVideoId as string | null | undefined) ?? null;
  const account =
    connection?.account && (connection.state === "connected" || connection.state === "expiring")
      ? { connectionId: connection.id, instagramUserId: connection.account.id, destinationEpoch: connection.destinationEpoch, username: connection.account.username, type: connection.account.type }
      : null;
  // Starting caption: the approved storyboard's title (editable).
  const selected = versions.find((v) => v.id === initialVideoId && v.state === "approved") ?? versions.find((v) => v.state === "approved");
  const storyboard = selected ? await db.collection("storyboards").findOne({ _id: selected.storyboardId as never, ownerId }, { projection: { "content.title": 1 } }) : null;

  return (
    <PrivateShell user={session.user}>
      <div className="idea-page">
        <h1 className="idea-title">{project.title}</h1>
        <ProjectSteps projectId={id} current="publish" storyboardReady videoReady={page.items.length > 0} publishReady />
        <PublishPanel
          projectId={id}
          versions={versions}
          initialVideoId={initialVideoId}
          account={account}
          available={publishingConfigured()}
          defaultCaption={typeof storyboard?.content?.title === "string" ? storyboard.content.title : ""}
          initialIntents={intents.items}
        />
      </div>
    </PrivateShell>
  );
}
