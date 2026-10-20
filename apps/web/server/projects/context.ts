import type { AuthServices } from "../auth/auth";
import type { ProjectsContext } from "./service";

export const projectsContext = (services: AuthServices): ProjectsContext => ({
  db: services.db,
  client: services.client,
  cursorSecret: services.config.secret,
});
