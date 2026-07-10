-- Hand-authored to match src/db/schema.ts exactly. Regenerate/verify with
-- `npm run migrate:generate` (drizzle-kit) if the schema changes.

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS stripe_customer_id text;
CREATE UNIQUE INDEX IF NOT EXISTS wallets_stripe_customer_id_idx
  ON wallets (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS saved_payment_methods (
  id uuid primary key default gen_random_uuid(),
  wallet_token uuid not null references wallets(wallet_token) on delete cascade,
  gateway text not null default 'stripe',
  stripe_customer_id text not null,
  stripe_payment_method_id text not null,
  brand text,
  last4 text,
  exp_month integer,
  exp_year integer,
  is_default boolean not null default true,
  status text not null default 'active', -- active|detached
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS saved_payment_methods_wallet_idx ON saved_payment_methods (wallet_token);
CREATE UNIQUE INDEX IF NOT EXISTS saved_payment_methods_pm_idx ON saved_payment_methods (stripe_payment_method_id);
CREATE UNIQUE INDEX IF NOT EXISTS saved_payment_methods_wallet_default_idx
  ON saved_payment_methods (wallet_token) WHERE is_default AND status = 'active';
