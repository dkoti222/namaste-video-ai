import type { Db } from "mongodb";

// Internal admission (SYSTEM_DESIGN.md section 4): an account may sign in only when an enabled, active
// internalAccess record is linked to that exact auth user. An allowlist entry alone never creates a user.

/** Same rule as Better Auth's sign-in lookup after trimming: case-insensitive, dots and plus tags preserved. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type AccessRecord = {
  _id: string;
  normalizedEmail: string;
  enabled: boolean;
  provisioningState: "pending" | "active" | "disabled";
  provisionedUserId?: string;
  operatorRef: string;
  createdAt: Date;
  updatedAt: Date;
};

export const accessCollection = (db: Db) => db.collection<AccessRecord>("internalAccess");

export async function isAdmitted(db: Db, userId: string): Promise<boolean> {
  const record = await accessCollection(db).findOne(
    { provisionedUserId: userId, enabled: true, provisioningState: "active" },
    { projection: { _id: 1 } },
  );
  return record !== null;
}
