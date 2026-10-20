import { z } from "zod";
import { newId } from "../db/migrations";
import { accessCollection, normalizeEmail } from "./access";
import type { AuthServices } from "./auth";

// Operator account administration (SYSTEM_DESIGN.md section 4, DB_DESIGN.md section 5.1).
// Provisioning spans Better Auth and application metadata, so it is idempotent by normalized email rather than
// claiming one transaction: mark pending, create or find the auth user, then link and activate.

export class ProvisioningError extends Error {
  override name = "ProvisioningError";
}

const emailSchema = z.email().max(254);

function validEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!emailSchema.safeParse(normalized).success) throw new ProvisioningError("Enter a valid email address of at most 254 characters.");
  return normalized;
}

function validPassword(password: string): string {
  if (password.length < 12 || password.length > 128) throw new ProvisioningError("Passwords must be 12 to 128 characters.");
  return password;
}

export type ProvisionResult = { userId: string; createdUser: boolean };

export async function provisionUser(
  { db, auth }: AuthServices,
  input: { email: string; password: string; name?: string; operatorRef: string },
): Promise<ProvisionResult> {
  const email = validEmail(input.email);
  const password = validPassword(input.password);
  const access = accessCollection(db);
  const now = new Date();

  const existing = await access.findOne({ normalizedEmail: email });
  if (existing?.provisioningState === "disabled") {
    throw new ProvisioningError("This account is disabled. Use `enable` to restore it or `reset-password` after enabling.");
  }
  if (!existing) {
    await access.updateOne(
      { normalizedEmail: email },
      {
        $setOnInsert: {
          _id: newId("acc"),
          schemaVersion: 1,
          normalizedEmail: email,
          enabled: true,
          provisioningState: "pending",
          operatorRef: input.operatorRef,
          createdAt: now,
        },
        $set: { updatedAt: now },
      } as never,
      { upsert: true },
    );
  }

  const context = await auth.$context;
  const found = await context.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  let userId = found?.user.id;
  let createdUser = false;
  if (!userId) {
    const hash = await context.password.hash(password);
    const user = await context.internalAdapter.createUser({
      email,
      name: input.name?.trim() || email.split("@")[0],
      // Control of the address is verified out of band by the operator for this internal release.
      emailVerified: true,
    }, { method: "admin" });
    await context.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
    userId = user.id;
    createdUser = true;
  } else if (!found?.accounts.some((account) => account.providerId === "credential")) {
    await context.internalAdapter.linkAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: await context.password.hash(password),
    });
  }
  // An existing credential is never overwritten here; password changes go through resetPassword.

  if (existing?.provisionedUserId && existing.provisionedUserId !== userId) {
    throw new ProvisioningError("The access record is linked to a different account. Resolve it manually.");
  }
  await access.updateOne(
    { normalizedEmail: email, provisioningState: { $in: ["pending", "active"] } },
    { $set: { provisionedUserId: userId, provisioningState: "active", enabled: true, updatedAt: new Date() } },
  );
  return { userId, createdUser };
}

async function linkedAccess(services: AuthServices, email: string) {
  const record = await accessCollection(services.db).findOne({ normalizedEmail: validEmail(email) });
  if (!record) throw new ProvisioningError("No access record exists for that email.");
  return record;
}

/** Disables admission and revokes every session immediately. */
export async function disableAccess(services: AuthServices, email: string): Promise<void> {
  const record = await linkedAccess(services, email);
  await accessCollection(services.db).updateOne(
    { _id: record._id },
    { $set: { enabled: false, provisioningState: "disabled", updatedAt: new Date() } },
  );
  if (record.provisionedUserId) await (await services.auth.$context).internalAdapter.deleteUserSessions(record.provisionedUserId);
}

export async function enableAccess(services: AuthServices, email: string): Promise<void> {
  const record = await linkedAccess(services, email);
  if (!record.provisionedUserId) throw new ProvisioningError("This record has no linked account yet. Run `provision` instead.");
  await accessCollection(services.db).updateOne(
    { _id: record._id },
    { $set: { enabled: true, provisioningState: "active", updatedAt: new Date() } },
  );
}

/** Operator-assisted recovery: replaces the password and revokes every existing session. */
export async function resetPassword(services: AuthServices, email: string, password: string): Promise<void> {
  const record = await linkedAccess(services, email);
  if (!record.provisionedUserId) throw new ProvisioningError("This record has no linked account yet. Run `provision` instead.");
  const context = await services.auth.$context;
  await context.internalAdapter.updatePassword(record.provisionedUserId, await context.password.hash(validPassword(password)));
  await context.internalAdapter.deleteUserSessions(record.provisionedUserId);
}

export async function listAccess(services: AuthServices) {
  const records = await accessCollection(services.db).find({}, { sort: { normalizedEmail: 1 } }).toArray();
  return records.map((r) => ({ email: r.normalizedEmail, state: r.provisioningState, enabled: r.enabled, linked: Boolean(r.provisionedUserId) }));
}
