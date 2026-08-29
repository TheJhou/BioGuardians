-- ============================================================
-- BioGuardians - 12 Spatial Query Optimization
--
-- Tunes the planner to prefer index scans for spatial tables on
-- SSD storage and refreshes statistics after seed data.
-- ============================================================

-- Refresh statistics so the planner has accurate row estimates.
ANALYZE area_protegida;
ANALYZE ocorrencia;

-- Lower random_page_cost encourages GIST index usage instead of
-- sequential scans on SSD-backed storage.
DO $$
DECLARE
  db_name text := current_database();
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('random_page_cost', '1.1'),
      ('seq_page_cost', '1.0')
    ) AS t(name, value)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_settings WHERE name = rec.name)
       AND (SELECT setting FROM pg_settings WHERE name = rec.name) <> rec.value
    THEN
      EXECUTE format('ALTER DATABASE %I SET %I = %L', db_name, rec.name, rec.value);
    END IF;
  END LOOP;
END $$;
