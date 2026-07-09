-- Run once, before drizzle-kit generated migrations, to enable the citext extension
-- used by users.email and users.username for case-insensitive uniqueness.
CREATE EXTENSION IF NOT EXISTS citext;
