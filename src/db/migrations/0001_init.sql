-- Hand-authored to match src/db/schema.ts exactly. Regenerate/verify with
-- `npm run migrate:generate` (drizzle-kit) if the schema changes.

CREATE TABLE IF NOT EXISTS users (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  username citext not null,
  password_hash text not null,
  display_name text,
  avatar_url text,
  email_verified_at timestamptz,
  totp_secret text,
  totp_enabled boolean not null default false,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  family_id uuid not null,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_token_hash text,
  ip text,
  ua text,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  lifetime_coins bigint not null default 0,
  lifetime_earnings_cents bigint not null default 0,
  payout_balance_cents bigint not null default 0,
  pending_balance_cents bigint not null default 0,
  current_level integer not null default 1,
  kyc_status text not null default 'none',
  payout_country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  full_name text not null,
  dob text not null,
  id_type text not null,
  id_number text not null,
  country text not null,
  doc_url text,
  sanctions_checked_at timestamptz,
  status text not null default 'pending',
  reviewer_id uuid references users(id),
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS wallets (
  wallet_token uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  coin_balance bigint not null default 0,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id bigserial primary key,
  wallet_token uuid not null references wallets(wallet_token) on delete cascade,
  delta_coins bigint not null,
  reason text not null,
  ref_type text,
  ref_id uuid,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS wallet_ledger_wallet_idx ON wallet_ledger (wallet_token);

CREATE TABLE IF NOT EXISTS creator_ledger (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  delta_cents bigint not null,
  currency text not null default 'USD',
  reason text not null,
  ref_type text,
  ref_id uuid,
  available_at timestamptz,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS creator_ledger_user_idx ON creator_ledger (user_id);
CREATE INDEX IF NOT EXISTS creator_ledger_available_idx ON creator_ledger (available_at);

CREATE TABLE IF NOT EXISTS gift_catalog (
  id text primary key,
  name text not null,
  emoji text,
  image_url text,
  coins integer not null,
  usd_cents integer not null,
  premium boolean not null default false,
  active boolean not null default true
);

CREATE TABLE IF NOT EXISTS streams (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references users(id) on delete cascade,
  title text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  is_live boolean not null default true,
  viewer_count integer not null default 0
);
CREATE INDEX IF NOT EXISTS streams_creator_idx ON streams (creator_id);
CREATE INDEX IF NOT EXISTS streams_is_live_idx ON streams (is_live);

CREATE TABLE IF NOT EXISTS gift_events (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references streams(id) on delete set null,
  creator_id uuid not null references users(id) on delete cascade,
  sender_wallet_token uuid not null,
  sender_name text not null,
  gift_id text not null references gift_catalog(id),
  coins integer not null,
  gross_cents bigint not null,
  fee_pct numeric(5,2) not null,
  platform_fee_cents bigint not null,
  creator_share_cents bigint not null,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS gift_events_stream_idx ON gift_events (stream_id);
CREATE INDEX IF NOT EXISTS gift_events_creator_idx ON gift_events (creator_id);

CREATE TABLE IF NOT EXISTS topups (
  id uuid primary key default gen_random_uuid(),
  wallet_token uuid not null references wallets(wallet_token) on delete cascade,
  method text not null,
  amount_cents bigint not null,
  currency text not null default 'USD',
  coins integer not null,
  status text not null default 'pending',
  gateway_ref text,
  idempotency_key text,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS topups_gateway_ref_idx ON topups (gateway_ref);

CREATE TABLE IF NOT EXISTS cashouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references users(id) on delete cascade,
  destination_type text not null,
  destination_account text not null,
  amount_cents bigint not null,
  currency text not null default 'USD',
  fx_rate numeric(18,8),
  local_amount_cents bigint,
  status text not null default 'pending',
  gateway_ref text,
  idempotency_key text,
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  failure_reason text
);
CREATE INDEX IF NOT EXISTS cashouts_creator_idx ON cashouts (creator_id);
CREATE INDEX IF NOT EXISTS cashouts_gateway_ref_idx ON cashouts (gateway_ref);

CREATE TABLE IF NOT EXISTS fx_rates (
  pair text not null,
  rate numeric(18,8) not null,
  captured_at timestamptz not null default now(),
  primary key (pair, captured_at)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id uuid not null references users(id) on delete cascade,
  creator_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, creator_id)
);

CREATE TABLE IF NOT EXISTS challenges (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references streams(id) on delete cascade,
  type text not null,
  title text,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  creator_a_id uuid not null references users(id),
  creator_b_id uuid references users(id),
  creator_a_score integer not null default 0,
  creator_b_score integer not null default 0,
  allowed_gift_filter text
);
CREATE INDEX IF NOT EXISTS challenges_stream_idx ON challenges (stream_id);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id);

CREATE TABLE IF NOT EXISTS reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS blocks (
  user_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  signature_valid boolean not null,
  payload jsonb not null,
  processed_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_external_idx ON webhook_events (external_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text not null,
  user_id text not null,
  endpoint text not null,
  response_hash text,
  response_body jsonb,
  status_code integer,
  created_at timestamptz not null default now(),
  primary key (key, user_id, endpoint)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  ip text,
  ua text,
  meta jsonb default '{}',
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events (actor_id);

-- gen_random_uuid() requires pgcrypto (bundled with pg 13+ as pgcrypto extension)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
