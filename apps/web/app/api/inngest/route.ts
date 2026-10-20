import { serve } from "inngest/next";
import { functions, inngest } from "@/server/inngest/functions";

// Inngest invokes workflow steps here. In production the SDK verifies Inngest's request signature (signing key).
export const maxDuration = 300;
export const { GET, POST, PUT } = serve({ client: inngest, functions });
