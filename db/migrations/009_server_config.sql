-- @no-transaction
-- ============================================================
-- BioGuardians - 09 Database Performance Configuration
--
-- Uses ALTER DATABASE (not ALTER SYSTEM) so it works in any
-- environment (CI ephemeral, production) without superuser
-- privileges. The database owner can set these.
--
-- Postmaster-level settings (max_worker_processes, shared_buffers,
-- max_parallel_workers) must be set in postgresql.conf manually
-- on the production server. See README for details.
-- ============================================================

-- ---------- Parallel Query (user-context, take effect immediately) ----------
ALTER DATABASE current_database() SET max_parallel_workers_per_gather = 2;
ALTER DATABASE current_database() SET parallel_setup_cost = 100;
ALTER DATABASE current_database() SET parallel_tuple_cost = 0.03;
ALTER DATABASE current_database() SET min_parallel_table_scan_size = '8MB';
ALTER DATABASE current_database() SET min_parallel_index_scan_size = '512kB';

-- ---------- Memory (user-context, take effect on next connection) ----------
ALTER DATABASE current_database() SET effective_cache_size = '1GB';
ALTER DATABASE current_database() SET work_mem = '8MB';
ALTER DATABASE current_database() SET maintenance_work_mem = '128MB';

-- Reload configuration so connection-level defaults are refreshed.
SELECT pg_reload_conf();
