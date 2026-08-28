-- @no-transaction
-- ============================================================
-- BioGuardians - 09 Database Performance Configuration
--
-- Idempotent: only sets parameters that differ from desired value.
-- Uses DO block with dynamic SQL to resolve database name at runtime.
--
-- Postmaster-level settings (max_worker_processes, shared_buffers,
-- max_parallel_workers) must be set in postgresql.conf manually.
-- ============================================================

DO $$
DECLARE
  db_name text := current_database();
  rec record;
BEGIN
  -- Define desired settings as a temp table-like structure.
  FOR rec IN
    SELECT * FROM (VALUES
      ('max_parallel_workers_per_gather', '2'),
      ('parallel_setup_cost', '100'),
      ('parallel_tuple_cost', '0.03'),
      ('min_parallel_table_scan_size', '8MB'),
      ('min_parallel_index_scan_size', '512kB'),
      ('effective_cache_size', '1GB'),
      ('work_mem', '8MB'),
      ('maintenance_work_mem', '128MB')
    ) AS t(name, value)
  LOOP
    -- Only apply if the parameter exists and current value differs.
    IF EXISTS (SELECT 1 FROM pg_settings WHERE name = rec.name)
       AND (SELECT setting FROM pg_settings WHERE name = rec.name) <> rec.value
    THEN
      EXECUTE format('ALTER DATABASE %I SET %I = %L', db_name, rec.name, rec.value);
    END IF;
  END LOOP;
END $$;

-- Note: ALTER DATABASE settings take effect on the next connection.
-- No pg_reload_conf() needed (it requires superuser privileges).
