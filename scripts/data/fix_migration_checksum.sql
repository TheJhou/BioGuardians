-- ============================================================
-- BioGuardians - Fix migration 008 checksum (run on production)
--
-- The 008_seed_data.sql file was modified to remove mock data.
-- This changes its SHA-256 hash. The migration runner (migrate.sh)
-- will detect a checksum mismatch and block future migrations.
--
-- Run this AFTER running cleanup_mock_data.sql to update the
-- stored checksum in schema_migrations so it matches the new
-- file content.
--
-- Usage:
--   psql -h <host> -p <port> -U <user> -d <dbname> -f scripts/data/fix_migration_checksum.sql
--
-- IMPORTANT: Run cleanup_mock_data.sql FIRST, then this script.
-- ============================================================

-- Replace the checksum for 008_seed_data.sql with the new hash.
-- The new hash is computed from the updated file content.
-- To get the correct hash, run on your machine:
--   sha256sum db/migrations/008_seed_data.sql
--
-- Then replace the value below with the output (first column).

UPDATE schema_migrations
SET checksum = 'REPLACE_WITH_NEW_SHA256'
WHERE filename = '008_seed_data.sql';

-- Verify
SELECT filename, checksum FROM schema_migrations WHERE filename = '008_seed_data.sql';
