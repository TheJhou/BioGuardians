-- @no-transaction
-- ============================================================
-- BioGuardians - 09 Server Configuration (no transaction)
-- ALTER SYSTEM commands cannot run inside a transaction block.
-- This migration configures parallel query and memory settings.
-- Requires -- @no-transaction directive (see migrate.sh).
-- ============================================================

-- ---------- Parallel Query ----------
ALTER SYSTEM SET max_worker_processes = 8;
ALTER SYSTEM SET max_parallel_workers = 4;
ALTER SYSTEM SET max_parallel_workers_per_gather = 2;
ALTER SYSTEM SET parallel_setup_cost = 100;
ALTER SYSTEM SET parallel_tuple_cost = 0.03;
ALTER SYSTEM SET min_parallel_table_scan_size = '8MB';
ALTER SYSTEM SET min_parallel_index_scan_size = '512kB';

-- ---------- Memory (optimized for 2GB container) ----------
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET work_mem = '8MB';
ALTER SYSTEM SET maintenance_work_mem = '128MB';

-- Reload configuration so changes take effect immediately.
SELECT pg_reload_conf();
