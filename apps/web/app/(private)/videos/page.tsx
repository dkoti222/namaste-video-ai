import type { Metadata } from "next";
import { Library } from "@/components/library";
import { PrivateShell } from "@/components/private-shell";
import { getAuthServices } from "@/server/auth/auth";
import { requirePrivateSession } from "@/server/auth/dal";
import { projectsContext } from "@/server/projects/context";
import { listProjects } from "@/server/projects/service";

export const metadata: Metadata = { title: "My videos" };

const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export default async function VideosPage() {
  const session = await requirePrivateSession("/videos");
  const services = await getAuthServices();
  const ownerId = session.user.id;
  // First page is rendered on the server from the owner's own projects; later pages come from /api/projects.
  const [initial, preferences] = await Promise.all([
    listProjects(projectsContext(services), ownerId, { limit: 12, filter: "all" }),
    services.db.collection("preferences").findOne({ ownerId }, { projection: { timezone: 1 } }),
  ]);
  const timeZone = typeof preferences?.timezone === "string" ? preferences.timezone : DEFAULT_TIME_ZONE;

  return (
    <PrivateShell user={session.user}>
      <Library initial={initial} timeZone={timeZone} />
    </PrivateShell>
  );
}
