import {
  pgTable,
  uuid,
  text,
  bigint,
  bigserial,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";

// Postgres citext (case-insensitive text) — requires `CREATE EXTENSION IF NOT EXISTS citext;`
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull(),
    username: citext("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    role: text("role").notNull().default("user"), // user | creator | admin
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    usernameIdx: uniqueIndex("users_username_idx").on(t.username),
  })
);

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  familyId: uuid("family_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedByTokenHash: text("replaced_by_token_hash"),
  ip: text("ip"),
  ua: text("ua"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailVerifications = pgTable("email_verifications", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creatorProfiles = pgTable("creator_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  lifetimeCoins: bigint("lifetime_coins", { mode: "number" }).notNull().default(0),
  lifetimeEarningsCents: bigint("lifetime_earnings_cents", { mode: "number" }).notNull().default(0),
  payoutBalanceCents: bigint("payout_balance_cents", { mode: "number" }).notNull().default(0),
  pendingBalanceCents: bigint("pending_balance_cents", { mode: "number" }).notNull().default(0),
  currentLevel: integer("current_level").notNull().default(1),
  kycStatus: text("kyc_status").notNull().default("none"), // none|pending|approved|rejected
  payoutCountry: text("payout_country"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kycSubmissions = pgTable("kyc_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  dob: text("dob").notNull(),
  idType: text("id_type").notNull(),
  idNumber: text("id_number").notNull(),
  country: text("country").notNull(),
  docUrl: text("doc_url"),
  sanctionsCheckedAt: timestamp("sanctions_checked_at", { withTimezone: true }),
  status: text("status").notNull().default("pending"), // pending|approved|rejected
  reviewerId: uuid("reviewer_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wallets = pgTable("wallets", {
  walletToken: uuid("wallet_token").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  coinBalance: bigint("coin_balance", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletLedger = pgTable(
  "wallet_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    walletToken: uuid("wallet_token").notNull().references(() => wallets.walletToken, { onDelete: "cascade" }),
    deltaCoins: bigint("delta_coins", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    walletIdx: index("wallet_ledger_wallet_idx").on(t.walletToken),
  })
);

export const creatorLedger = pgTable(
  "creator_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deltaCents: bigint("delta_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    availableAt: timestamp("available_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("creator_ledger_user_idx").on(t.userId),
    availableIdx: index("creator_ledger_available_idx").on(t.availableAt),
  })
);

export const giftCatalog = pgTable("gift_catalog", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  imageUrl: text("image_url"),
  coins: integer("coins").notNull(),
  usdCents: integer("usd_cents").notNull(),
  premium: boolean("premium").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const streams = pgTable("streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  isLive: boolean("is_live").notNull().default(true),
  viewerCount: integer("viewer_count").notNull().default(0),
});

export const giftEvents = pgTable(
  "gift_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    streamId: uuid("stream_id").references(() => streams.id, { onDelete: "set null" }),
    creatorId: uuid("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    senderWalletToken: uuid("sender_wallet_token").notNull(),
    senderName: text("sender_name").notNull(),
    giftId: text("gift_id").notNull().references(() => giftCatalog.id),
    coins: integer("coins").notNull(),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull(),
    feePct: numeric("fee_pct", { precision: 5, scale: 2 }).notNull(),
    platformFeeCents: bigint("platform_fee_cents", { mode: "number" }).notNull(),
    creatorShareCents: bigint("creator_share_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    streamIdx: index("gift_events_stream_idx").on(t.streamId),
    creatorIdx: index("gift_events_creator_idx").on(t.creatorId),
  })
);

export const topups = pgTable("topups", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletToken: uuid("wallet_token").notNull().references(() => wallets.walletToken, { onDelete: "cascade" }),
  method: text("method").notNull(), // stripe|mpesa|evcplus|edahab
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("USD"),
  coins: integer("coins").notNull(),
  status: text("status").notNull().default("pending"), // pending|succeeded|failed
  gatewayRef: text("gateway_ref"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cashouts = pgTable(
  "cashouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    destinationType: text("destination_type").notNull(), // mpesa|evcplus|edahab|stripe|bank
    destinationAccount: text("destination_account").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    localAmountCents: bigint("local_amount_cents", { mode: "number" }),
    status: text("status").notNull().default("pending"), // pending|processing|paid|failed
    gatewayRef: text("gateway_ref"),
    idempotencyKey: text("idempotency_key"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
  },
  (t) => ({
    creatorIdx: index("cashouts_creator_idx").on(t.creatorId),
  })
);

export const fxRates = pgTable(
  "fx_rates",
  {
    pair: text("pair").notNull(),
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.pair, t.capturedAt] }),
  })
);

export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.followerId, t.creatorId] }),
  })
);

export const challenges = pgTable("challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  streamId: uuid("stream_id").references(() => streams.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title"),
  status: text("status").notNull().default("active"), // active|ended
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  creatorAId: uuid("creator_a_id").notNull().references(() => users.id),
  creatorBId: uuid("creator_b_id").references(() => users.id),
  creatorAScore: integer("creator_a_score").notNull().default(0),
  creatorBScore: integer("creator_b_score").notNull().default(0),
  allowedGiftFilter: text("allowed_gift_filter"),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const blocks = pgTable(
  "blocks",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.blockedId] }),
  })
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // stripe|mpesa|evcplus|edahab
    externalId: text("external_id").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    externalIdx: uniqueIndex("webhook_events_external_idx").on(t.externalId),
  })
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    userId: text("user_id").notNull(), // may be a user uuid or "anon"
    endpoint: text("endpoint").notNull(),
    responseHash: text("response_hash"),
    responseBody: jsonb("response_body"),
    statusCode: integer("status_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.userId, t.endpoint] }),
  })
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ip: text("ip"),
    ua: text("ua"),
    meta: jsonb("meta").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index("audit_events_actor_idx").on(t.actorId),
  })
);
