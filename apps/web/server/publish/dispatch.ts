import { after } from "next/server";
import type { Db } from "mongodb";
import { sendEvents } from "../inngest/functions";
import { dispatchOutbox } from "../jobs/outbox";

/** Latency optimization after a committed command; the minute dispatcher/scanner deliver it otherwise. */
export function dispatchSoon(db: Db) {
  try {
    after(() => dispatchOutbox(db, sendEvents).catch(() => undefined));
  } catch {
    // Outside a request scope (tests): rely on the scheduled dispatcher.
  }
}
