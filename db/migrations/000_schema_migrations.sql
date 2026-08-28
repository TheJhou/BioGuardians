-- ============================================================
-- BioGuardians - 000 Migration Journal Table
--
-- This is the very first migration. It creates the schema_migrations
-- table that tracks all subsequent migrations with SHA-256 checksums.
--
-- The migrate.sh runner also has an ensure_journal() function that
-- creates this table if missing, but having it as a migration makes
-- the system self-documenting and allows manual psql execution.
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    id           SERIAL       PRIMARY KEY,
    filename     VARCHAR(255) NOT NULL UNIQUE,
    checksum     VARCHAR(64)  NOT NULL,
    applied_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
