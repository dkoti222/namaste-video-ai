// Application collections, strict validators and the named index catalog from DB_DESIGN.md sections 5 and 7.
// Better Auth collections are owned by the auth adapter (F03) and are intentionally absent.
// Nested content shapes marked `opaque` (PlanV2, render specs, job snapshots/results, checkpoints) are enforced
// by the shared runtime contract at service boundaries when those features are built; MongoDB checks the object type.

type Schema = Record<string, unknown>;

export const ID_PATTERN = "^[a-z]{2,8}_[A-Za-z0-9_-]{16,64}$";

const id: Schema = { bsonType: "string", pattern: ID_PATTERN };
const userId: Schema = { bsonType: "string", minLength: 1, maxLength: 200 };
const hash: Schema = { bsonType: "string", pattern: "^[a-f0-9]{64}$" };
const date: Schema = { bsonType: "date" };
const bool: Schema = { bsonType: "bool" };
const binData: Schema = { bsonType: "binData" };
const opaque: Schema = { bsonType: "object" };
const str = (max: number, min = 0): Schema => ({ bsonType: "string", minLength: min, maxLength: max });
const int = (min?: number, max?: number): Schema => ({
  bsonType: "int",
  ...(min === undefined ? {} : { minimum: min }),
  ...(max === undefined ? {} : { maximum: max }),
});
const long = (min: number): Schema => ({ bsonType: "long", minimum: min });
const num = (min?: number, max?: number): Schema => ({
  bsonType: "number",
  ...(min === undefined ? {} : { minimum: min }),
  ...(max === undefined ? {} : { maximum: max }),
});
const oneOf = (...values: string[]): Schema => ({ bsonType: "string", enum: values });
const arr = (items: Schema, max: number, min = 0): Schema => ({ bsonType: "array", items, minItems: min, maxItems: max });
const nullable = (schema: Schema): Schema => ({ ...schema, bsonType: [schema.bsonType as string, "null"] });

function obj(fields: Record<string, Schema>, optional: Record<string, Schema> = {}): Schema {
  const required = Object.keys(fields);
  return {
    bsonType: "object",
    ...(required.length ? { required } : {}),
    additionalProperties: false,
    properties: { ...fields, ...optional },
  };
}

const lease = obj({ holder: id, until: date, fence: long(0) });
const safeError = obj(
  { code: str(80, 1), message: str(500, 1), retryable: bool, correlationId: id },
  { providerCode: str(80, 1) },
);
const fieldIssue = obj({ path: str(300), code: str(80, 1), message: str(500, 1) });
const encryptedSecret = obj({
  algorithm: oneOf("A256GCM"),
  keyVersion: int(1),
  nonce: binData,
  ciphertext: binData,
  tag: binData,
});
const voiceConfig = obj({
  preset: str(64, 1),
  provider: oneOf("elevenlabs"),
  model: str(100, 1),
  voiceId: str(100, 1),
  settings: obj({ stability: num(0, 1), similarityBoost: num(0, 1) }),
  normalizationVersion: int(1),
  testOnly: bool,
  accent: str(100, 1),
});
const qa = obj({
  passed: bool,
  checks: obj({
    dimensions: bool,
    duration: bool,
    frameRate: bool,
    videoCodec: bool,
    audio: bool,
    captionBounds: bool,
    layout: bool,
    integrity: bool,
  }),
  durationSeconds: num(0),
  checkedAt: date,
  validatorVersion: str(100, 1),
});

const JOB_TYPES = ["brainstorm", "storyboard", "revision", "generation", "caption_render", "voice_change", "post_caption", "cleanup"];
const JOB_STATES = ["queued", "running", "cancel_requested", "cancelled", "succeeded", "needs_input", "failed"];
const JOB_STAGES = ["queued", "planning", "speech", "compile", "render", "validate", "finalize", "cleanup"];
const PUBLISH_STATES = [
  "scheduled", "queued", "claimed", "preparing", "processing", "submitting",
  "published", "paused_auth", "failed_safe", "outcome_unknown", "needs_attention", "cancelled",
];

type Base = "base" | "owned" | "projectOwned";

export type IndexSpec = {
  name: string;
  key: Record<string, 1 | -1>;
  unique?: true;
  partialFilterExpression?: Record<string, unknown>;
  expireAfterSeconds?: number;
};

export type CollectionSpec = {
  name: string;
  validator: Record<string, unknown>;
  indexes: IndexSpec[];
};

type Definition = {
  base: Base;
  fields: Record<string, Schema>;
  optional?: Record<string, Schema>;
  expr?: Record<string, unknown>[];
  indexes?: IndexSpec[];
};

function baseFields(base: Base): Record<string, Schema> {
  return {
    _id: id,
    schemaVersion: { enum: [1] },
    ...(base === "base" ? {} : { ownerId: userId }),
    ...(base === "projectOwned" ? { projectId: id } : {}),
    createdAt: date,
    updatedAt: date,
  };
}

const ix = (name: string, key: IndexSpec["key"], options: Omit<IndexSpec, "name" | "key"> = {}): IndexSpec => ({ name, key, ...options });
const unique = (name: string, key: IndexSpec["key"], partialFilterExpression?: IndexSpec["partialFilterExpression"]): IndexSpec =>
  ix(name, key, { unique: true, ...(partialFilterExpression ? { partialFilterExpression } : {}) });
const ttl = (name: string, field: string): IndexSpec => ix(name, { [field]: 1 }, { expireAfterSeconds: 0 });
// Section 7: project-owned collections without a project-prefixed index get a bounded cleanup index.
const cleanup = ix("cleanup_owner_project", { ownerId: 1, projectId: 1, _id: 1 });
const expiresAfterCreation = { $expr: { $gt: ["$expiresAt", "$createdAt"] } };

const DASHBOARD_FLAGS = ["drafts", "ready", "scheduled", "published", "needsAttention"];

const definitions: Record<string, Definition> = {
  internalAccess: {
    base: "base",
    fields: { normalizedEmail: str(254, 3), enabled: bool, provisioningState: oneOf("pending", "active", "disabled"), operatorRef: str(200, 1) },
    optional: { provisionedUserId: userId },
    indexes: [
      unique("access_email", { normalizedEmail: 1 }),
      unique("access_user", { provisionedUserId: 1 }, { provisionedUserId: { $type: "string" } }),
    ],
  },
  preferences: {
    base: "owned",
    fields: { revision: int(1), timezone: str(100, 1), defaultVoicePreset: str(64, 1) },
    indexes: [unique("preference_owner", { ownerId: 1 })],
  },
  projects: {
    base: "owned",
    fields: {
      title: str(100, 1),
      revision: int(1),
      draftRevision: int(1),
      conversationId: id,
      deletedAt: nullable(date),
      flags: obj(Object.fromEntries(DASHBOARD_FLAGS.map((flag) => [flag, bool]))),
      contentRevision: long(1),
    },
    optional: { currentStoryboardId: id, latestReadyVideoId: id, selectedVideoId: id, activeJobId: id },
    indexes: [
      ix("project_list", { ownerId: 1, deletedAt: 1, updatedAt: -1, _id: -1 }),
      ...DASHBOARD_FLAGS.map((flag) =>
        ix(`project_flag_${flag}`, { ownerId: 1, deletedAt: 1, [`flags.${flag}`]: 1, updatedAt: -1, _id: -1 }),
      ),
    ],
  },
  drafts: {
    base: "projectOwned",
    fields: {
      revision: int(1),
      topic: str(2000),
      audience: str(200),
      notes: str(20000),
      voicePreset: str(64),
      editablePlan: nullable(opaque),
      planStale: bool,
      contentHash: hash,
      canonicalizationVersion: { enum: [1] },
      validationIssues: arr(fieldIssue, 100),
    },
    optional: { sourceStoryboardId: id },
    indexes: [unique("draft_owner_project", { ownerId: 1, projectId: 1 })],
  },
  conversations: {
    base: "projectOwned",
    fields: { kind: oneOf("project"), nextSequence: long(1) },
    indexes: [unique("conversation_project", { ownerId: 1, projectId: 1, kind: 1 })],
  },
  messages: {
    base: "projectOwned",
    fields: { conversationId: id, sequence: long(1), role: oneOf("user", "assistant"), text: str(12000), messageKey: str(100, 1) },
    optional: { operationId: id, sourceStoryboardId: id, sourceVideoId: id },
    indexes: [
      unique("message_order", { ownerId: 1, projectId: 1, conversationId: 1, sequence: 1 }),
      unique("message_once", { operationId: 1, messageKey: 1 }, { operationId: { $type: "string" } }),
    ],
  },
  storyboards: {
    base: "projectOwned",
    fields: {
      sourceDraftRevision: int(1),
      content: opaque,
      contentHash: hash,
      storyHash: hash,
      canonicalizationVersion: { enum: [1] },
      state: oneOf("review_ready", "approved"),
      estimatedDurationSeconds: { bsonType: "number", exclusiveMinimum: true, minimum: 0 },
      changedSceneIds: arr(str(50, 1), 10),
      warnings: arr(fieldIssue, 100),
      plannerConfig: obj({ provider: str(50, 1), model: str(100, 1), promptVersion: str(50, 1) }),
    },
    optional: { parentId: id, changeSummary: str(2000), createdByJobId: id },
    indexes: [ix("storyboard_history", { ownerId: 1, projectId: 1, createdAt: -1, _id: -1 })],
  },
  approvals: {
    base: "projectOwned",
    fields: {
      kind: oneOf("story", "video"),
      subjectId: id,
      subjectHash: hash,
      approvedBy: userId,
      approvedAt: date,
      reason: oneOf("explicit", "visual_inheritance", "voice_change_confirmation"),
    },
    optional: { inheritedFromApprovalId: id },
    indexes: [unique("approval_subject", { ownerId: 1, kind: 1, subjectId: 1, subjectHash: 1 }), cleanup],
  },
  videos: {
    base: "projectOwned",
    fields: {
      storyboardId: id,
      storyApprovalId: id,
      renderSpec: opaque,
      renderSpecHash: hash,
      state: oneOf("building", "validating", "ready_for_review", "approved", "failed"),
      resolvedVoice: voiceConfig,
      rendererBuildId: str(200, 1),
    },
    optional: { parentVideoId: id, timelineAssetId: id, outputAssetId: id, outputHash: hash, qa, finalApprovalId: id },
    expr: [
      // Ready or approved videos carry verified output evidence; approval requires a final approval record.
      { $expr: { $or: [
        { $not: [{ $in: ["$state", ["ready_for_review", "approved"]] }] },
        { $and: [
          { $eq: [{ $type: "$outputHash" }, "string"] },
          { $eq: [{ $type: "$outputAssetId" }, "string"] },
          { $eq: ["$qa.passed", true] },
        ] },
      ] } },
      { $expr: { $or: [{ $ne: ["$state", "approved"] }, { $eq: [{ $type: "$finalApprovalId" }, "string"] }] } },
    ],
    indexes: [ix("video_history", { ownerId: 1, projectId: 1, createdAt: -1, _id: -1 })],
  },
  jobs: {
    base: "projectOwned",
    fields: {
      type: oneOf(...JOB_TYPES),
      state: oneOf(...JOB_STATES),
      revision: int(1),
      stage: oneOf(...JOB_STAGES),
      inputSnapshot: opaque,
      inputHash: hash,
      executionAttempt: int(1),
      progress: obj({}, { completedScenes: int(0), totalScenes: int(0), renderPercent: num(0, 100) }),
      deadlineAt: date,
    },
    optional: {
      activeSlot: { enum: [true] },
      cancellationRequestedAt: date,
      result: opaque,
      error: safeError,
      inputRequest: obj(
        { code: str(80, 1), message: str(500, 1), sceneIds: arr(str(50, 1), 10) },
        { candidateStoryboardId: id },
      ),
      finishedAt: date,
    },
    expr: [
      // Section 10: non-cleanup jobs hold the active slot exactly while queued, running or cancel_requested.
      { $expr: { $or: [
        { $eq: ["$type", "cleanup"] },
        { $eq: [{ $ifNull: ["$activeSlot", false] }, { $in: ["$state", ["queued", "running", "cancel_requested"]] }] },
      ] } },
    ],
    indexes: [
      unique("active_project_job", { ownerId: 1, projectId: 1 }, { activeSlot: true }),
      ix("job_recovery", { state: 1, deadlineAt: 1, _id: 1 }),
      ix("job_project", { ownerId: 1, projectId: 1, createdAt: -1 }),
    ],
  },
  jobStages: {
    base: "projectOwned",
    fields: {
      jobId: id,
      stageKey: str(100, 1),
      state: oneOf("pending", "leased", "request_started", "outcome_unknown", "succeeded", "failed", "cancelled"),
      fingerprint: hash,
      fence: long(0),
      artifactIds: arr(id, 30),
    },
    optional: { currentAttemptId: id, lease, error: safeError },
    indexes: [unique("stage_logical", { jobId: 1, stageKey: 1 }), ix("stage_recovery", { state: 1, "lease.until": 1 }), cleanup],
  },
  stageAttempts: {
    base: "projectOwned",
    fields: {
      jobId: id,
      stageId: id,
      attemptNumber: int(1),
      fence: long(1),
      fingerprint: hash,
      state: oneOf("started", "request_started", "succeeded", "failed", "outcome_unknown", "cancelled"),
      outputKeys: arr(str(1024, 1), 30),
      artifactIds: arr(id, 30),
      startedAt: date,
    },
    optional: { providerRequestId: str(200, 1), finishedAt: date, error: safeError },
    indexes: [unique("attempt_sequence", { stageId: 1, attemptNumber: 1 }), cleanup],
  },
  renderAttempts: {
    base: "projectOwned",
    fields: {
      jobId: id,
      videoId: id,
      stageId: id,
      fence: long(1),
      attemptNumber: int(1),
      state: oneOf("allocating", "running", "uploading", "validating", "succeeded", "failed", "stopping", "stopped", "outcome_unknown"),
      rendererBuildId: str(200, 1),
      deadlineAt: date,
      resultManifestKey: str(1024, 1),
      slotId: id,
    },
    optional: { sandboxId: str(200, 1), commandId: str(200, 1), lastObservedAt: date, error: safeError },
    indexes: [unique("render_sequence", { jobId: 1, attemptNumber: 1 }), ix("render_deadline", { state: 1, deadlineAt: 1 }), cleanup],
  },
  assets: {
    base: "projectOwned",
    fields: {
      kind: oneOf("audio", "alignment", "timeline", "captions", "thumbnail", "preview", "video", "qa"),
      originJobId: id,
      objectKey: str(1024, 1),
      state: oneOf("staging", "ready", "deleting", "deleted"),
      contentType: oneOf("audio/mpeg", "application/json", "image/png", "image/jpeg", "image/webp", "video/mp4", "text/vtt"),
      producerFingerprint: hash,
      metadata: obj({}, { durationSeconds: num(0), width: int(1), height: int(1), fps: num(0), codec: str(50, 1) }),
    },
    optional: { originVideoId: id, sha256: hash, bytes: long(0), readyAt: date },
    expr: [
      // A ready asset requires a hash, positive byte count and readiness time.
      { $expr: { $or: [
        { $ne: ["$state", "ready"] },
        { $and: [{ $eq: [{ $type: "$sha256" }, "string"] }, { $gt: ["$bytes", 0] }, { $eq: [{ $type: "$readyAt" }, "date"] }] },
      ] } },
    ],
    indexes: [
      unique("asset_key", { objectKey: 1 }),
      ix("asset_reuse", { ownerId: 1, projectId: 1, kind: 1, producerFingerprint: 1, state: 1 }),
      ix("asset_cleanup", { ownerId: 1, projectId: 1, state: 1 }),
    ],
  },
  voiceSamples: {
    base: "base",
    fields: {
      preset: str(64, 1),
      voiceConfigurationHash: hash,
      objectKey: str(1024, 1),
      sha256: hash,
      bytes: long(1),
      contentType: oneOf("audio/mpeg"),
      enabled: bool,
    },
    indexes: [unique("sample_preset", { preset: 1, voiceConfigurationHash: 1 })],
  },
  mediaGrants: {
    base: "owned",
    fields: {
      assetId: id,
      tokenHash: hash,
      purpose: oneOf("preview", "download", "ingest", "render_input", "render_output", "voice_sample"),
      expiresAt: date,
    },
    optional: { projectId: id, intentId: id, attemptId: id, revokedAt: date },
    expr: [
      expiresAfterCreation,
      // Voice samples are catalog assets outside projects; every other purpose is project-scoped.
      { $expr: { $eq: [{ $eq: ["$purpose", "voice_sample"] }, { $eq: [{ $type: "$projectId" }, "missing"] }] } },
    ],
    indexes: [
      unique("grant_token", { tokenHash: 1 }),
      ttl("grant_expiry", "expiresAt"),
      ix("grant_revoke", { ownerId: 1, projectId: 1, revokedAt: 1 }),
    ],
  },
  commands: {
    base: "owned",
    fields: {
      scope: str(300, 1),
      idempotencyKey: str(128, 16),
      requestHash: hash,
      state: oneOf("accepted"),
      responseStatus: int(100, 599),
      responseBody: opaque,
      resourceIds: arr(id, 10),
    },
    optional: { projectId: id },
    indexes: [unique("command_key", { ownerId: 1, scope: 1, idempotencyKey: 1 }), ix("command_cleanup", { ownerId: 1, projectId: 1 })],
  },
  outbox: {
    base: "base",
    fields: {
      eventId: id,
      aggregateId: id,
      eventType: str(80, 1),
      payloadIds: opaque,
      state: oneOf("pending", "leased", "sent", "dead"),
      attempts: int(0),
      availableAt: date,
    },
    optional: { ownerId: userId, projectId: id, lease, sentAt: date, lastError: safeError },
    indexes: [
      unique("outbox_event", { eventId: 1 }),
      ix("outbox_due", { state: 1, availableAt: 1, _id: 1 }),
      ix("outbox_lease", { state: 1, "lease.until": 1 }),
    ],
  },
  resourceSlots: {
    base: "base",
    fields: {
      resource: oneOf("render_global", "speech_global", "owner_stage"),
      slotNumber: int(0),
      state: oneOf("free", "reserved", "active", "reclaiming"),
    },
    optional: { ownerId: userId, attemptId: id, lease, deadlineAt: date, providerResourceId: str(200, 1) },
    indexes: [
      unique("slot_global", { resource: 1, slotNumber: 1 }, { resource: { $in: ["render_global", "speech_global"] } }),
      unique("slot_owner", { resource: 1, ownerId: 1, slotNumber: 1 }, { resource: "owner_stage" }),
      unique("render_owner", { ownerId: 1 }, { resource: "render_global", ownerId: { $type: "string" } }),
    ],
  },
  rateLimitBuckets: {
    base: "base",
    fields: { subjectHash: hash, action: str(80, 1), windowStart: date, count: int(0), expiresAt: date },
    expr: [expiresAfterCreation],
    indexes: [unique("rate_bucket", { subjectHash: 1, action: 1, windowStart: 1 }), ttl("rate_expiry", "expiresAt")],
  },
  serviceNonces: {
    base: "base",
    fields: { serviceId: str(80, 1), nonceHash: hash, expiresAt: date },
    expr: [expiresAfterCreation],
    indexes: [unique("nonce_once", { serviceId: 1, nonceHash: 1 }), ttl("nonce_expiry", "expiresAt")],
  },
  schemaMigrations: {
    base: "base",
    fields: { migrationName: str(200, 1), checksum: hash, state: oneOf("running", "completed", "failed") },
    optional: { checkpoint: opaque, lease, errorCode: str(80, 1) },
    indexes: [unique("migration_name", { migrationName: 1 })],
  },
  diagnosticEvents: {
    base: "base",
    fields: { correlationId: id, eventType: str(80, 1) },
    optional: { ownerId: userId, projectId: id, operationId: id, stage: str(100, 1), durationMs: long(0), safeErrorCode: str(80, 1) },
    indexes: [ix("event_lookup", { correlationId: 1, createdAt: 1 }), ix("event_cleanup", { ownerId: 1, projectId: 1 })],
  },
  instagramConnections: {
    base: "owned",
    fields: {
      revision: int(1),
      state: oneOf("connected", "expiring", "reconnect_required", "disconnected"),
      scopes: arr(str(100, 1), 20),
      tokenRevision: int(1),
      destinationEpoch: int(1),
      reconciliationOnly: bool,
    },
    optional: {
      instagramUserId: str(100, 1),
      username: str(100, 1),
      accountType: oneOf("BUSINESS", "CREATOR"),
      encryptedToken: encryptedSecret,
      expiresAt: date,
      refreshLease: lease,
    },
    indexes: [
      unique("connection_owner", { ownerId: 1 }),
      unique("connection_account", { instagramUserId: 1 }, { instagramUserId: { $type: "string" } }),
      ix("connection_refresh", { state: 1, expiresAt: 1 }),
    ],
  },
  oauthStates: {
    base: "owned",
    fields: { stateHash: hash, initiatingSessionHash: hash, state: oneOf("pending", "exchanging", "consumed", "failed"), expiresAt: date },
    optional: { returnProjectId: id, consumedAt: date },
    expr: [expiresAfterCreation],
    indexes: [unique("oauth_state", { stateHash: 1 }), ttl("oauth_expiry", "expiresAt")],
  },
  publishIntents: {
    base: "projectOwned",
    fields: {
      revision: int(1),
      payloadId: id,
      payloadRevision: int(1),
      videoId: id,
      instagramUserId: str(100, 1),
      contentKey: hash,
      state: oneOf(...PUBLISH_STATES),
      unresolved: bool,
      dueAt: date,
      retryDeadlineAt: date,
      submissionBarrier: bool,
    },
    optional: {
      claim: lease,
      nextCheckAt: date,
      publishedAt: date,
      providerMediaId: str(200, 1),
      permalink: str(2048, 1),
      error: safeError,
    },
    expr: [
      { $expr: { $gte: ["$retryDeadlineAt", "$dueAt"] } },
      // Only cancelled or published intents are resolved.
      { $expr: { $eq: ["$unresolved", { $not: [{ $in: ["$state", ["cancelled", "published"]] }] }] } },
      // Published intents carry confirmation evidence.
      { $expr: { $or: [
        { $ne: ["$state", "published"] },
        { $and: [{ $eq: [{ $type: "$publishedAt" }, "date"] }, { $eq: [{ $type: "$providerMediaId" }, "string"] }] },
      ] } },
    ],
    indexes: [
      ix("intent_due", { state: 1, dueAt: 1, _id: 1 }),
      ix("intent_history", { ownerId: 1, projectId: 1, createdAt: -1, _id: -1 }),
      unique("intent_unresolved", { ownerId: 1, videoId: 1, instagramUserId: 1, contentKey: 1 }, { unresolved: true }),
      ix("intent_reconcile", { state: 1, nextCheckAt: 1 }),
      ix("intent_account", { ownerId: 1, instagramUserId: 1, unresolved: 1 }),
    ],
  },
  publishPayloads: {
    base: "projectOwned",
    fields: {
      intentId: id,
      revision: int(1),
      videoId: id,
      videoApprovalId: id,
      assetId: id,
      outputHash: hash,
      connectionId: id,
      instagramUserId: str(100, 1),
      usernameAtApproval: str(100, 1),
      destinationEpoch: int(1),
      // Instagram's caption limit; the service enforces the configured limit at or below this bound.
      caption: str(2200),
      mode: oneOf("now", "schedule"),
      approvedBy: userId,
      approvedAt: date,
      payloadHash: hash,
      contentKey: hash,
    },
    optional: {
      schedule: obj({
        utc: date,
        localTime: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$" },
        timezone: str(100, 1),
        utcOffset: { bsonType: "string", pattern: "^[+-]\\d{2}:\\d{2}$" },
      }),
      supersedesPayloadId: id,
      repostOfIntentId: id,
    },
    expr: [{ $expr: { $eq: [{ $eq: ["$mode", "schedule"] }, { $eq: [{ $type: "$schedule" }, "object"] }] } }],
    indexes: [
      unique("payload_revision", { intentId: 1, revision: 1 }),
      ix("payload_repost_lookup", { ownerId: 1, contentKey: 1, createdAt: -1 }),
      cleanup,
    ],
  },
  publishAttempts: {
    base: "projectOwned",
    fields: {
      intentId: id,
      payloadId: id,
      attemptNumber: int(1),
      fence: long(0),
      phase: oneOf("container", "processing", "publish", "reconcile"),
      submissionState: oneOf("not_started", "request_started", "confirmed", "failed_safe", "outcome_unknown"),
    },
    optional: {
      containerId: str(200, 1),
      requestStartedAt: date,
      providerMediaId: str(200, 1),
      permalink: str(2048, 1),
      nextCheckAt: date,
      error: safeError,
    },
    indexes: [
      unique("publish_attempt_number", { intentId: 1, attemptNumber: 1 }),
      ix("publish_attempt_due", { submissionState: 1, nextCheckAt: 1 }),
      cleanup,
    ],
  },
};

function build(name: string, definition: Definition): CollectionSpec {
  const schema = obj({ ...baseFields(definition.base), ...definition.fields }, definition.optional);
  const expr = definition.expr ?? [];
  return {
    name,
    validator: expr.length ? { $and: [{ $jsonSchema: schema }, ...expr] } : { $jsonSchema: schema },
    indexes: definition.indexes ?? [],
  };
}

export const COLLECTIONS: readonly CollectionSpec[] = Object.entries(definitions).map(([name, definition]) => build(name, definition));

export type IndexedCollection = { name: string; indexes: IndexSpec[] };

// Better Auth collections (mongodb adapter, singular model names). Their document formats belong to the adapter, so
// no validators are applied; these are the indexes its schema declares (unique email/token, userId/identifier lookups).
export const AUTH_COLLECTIONS: readonly IndexedCollection[] = [
  { name: "user", indexes: [unique("auth_user_email", { email: 1 })] },
  { name: "session", indexes: [unique("auth_session_token", { token: 1 }), ix("auth_session_user", { userId: 1 })] },
  { name: "account", indexes: [ix("auth_account_user", { userId: 1 })] },
  { name: "verification", indexes: [ix("auth_verification_identifier", { identifier: 1 })] },
];

export function collectionSpec(name: string): CollectionSpec {
  const spec = COLLECTIONS.find((collection) => collection.name === name);
  if (!spec) throw new Error(`Unknown application collection: ${name}`);
  return spec;
}
