-- Hand-authored to match src/db/schema.ts exactly. Regenerate/verify with
-- `npm run migrate:generate` (drizzle-kit) if the schema changes.

ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS overlay_token text;
CREATE UNIQUE INDEX IF NOT EXISTS creator_profiles_overlay_token_idx
  ON creator_profiles (overlay_token) WHERE overlay_token IS NOT NULL;
