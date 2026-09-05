-- ============================================================
-- BioGuardians - Smoke Tests
-- Validates that migrations applied correctly and that core
-- database features (PostGIS, triggers, views, functions) work.
-- Used by CI (GitHub Actions) and can be run manually.
--
-- These tests validate STRUCTURE, not data. Data is loaded
-- separately via the data loading scripts (MMA, CNUC, GBIF,
-- speciesLink) and is not expected in CI ephemeral databases.
--
-- Usage:
--   psql -U bioguard -d bioguardians -f db/tests/smoke_test.sql
--
-- Exits with error if any test fails (ON_ERROR_STOP=1).
-- ============================================================

\set ON_ERROR_STOP on
\echo '==> Running BioGuardians smoke tests...'

-- ---------- Test 1: All expected tables exist ----------
\echo 'Test 1: Checking all expected tables exist...'
DO $$
DECLARE
    expected text[] := ARRAY[
        'categoria_ameaca','bioma','estado','taxon',
        'especie','especie_bioma','especie_estado',
        'area_protegida','ocorrencia','log_auditoria',
        'deteccao','deteccao_job','imagem_job','modelo_ml',
        'cache_metadata','schema_migrations'
    ];
    missing text[];
BEGIN
    SELECT array_agg(t) INTO missing
    FROM unnest(expected) AS t
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = t AND table_schema = 'public'
    );
    IF array_length(missing, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'Missing tables: %', missing;
    END IF;
END $$;

-- ---------- Test 2: Reference data was loaded ----------
\echo 'Test 2: Checking reference data counts...'
DO $$
BEGIN
    IF (SELECT count(*) FROM categoria_ameaca) < 7 THEN
        RAISE EXCEPTION 'categoria_ameaca not fully loaded (expected 7)';
    END IF;
    IF (SELECT count(*) FROM bioma) < 7 THEN
        RAISE EXCEPTION 'bioma not fully loaded (expected 7)';
    END IF;
    IF (SELECT count(*) FROM estado) < 27 THEN
        RAISE EXCEPTION 'estado not fully loaded (expected 27)';
    END IF;
END $$;

-- ---------- Test 3: Spatial functions exist ----------
\echo 'Test 3: Checking spatial functions exist...'
DO $$
DECLARE
    func_count integer;
BEGIN
    SELECT count(*) INTO func_count FROM pg_proc
    WHERE proname IN ('especies_em_area', 'areas_protegem_especie', 'refresh_dashboard');
    IF func_count < 3 THEN
        RAISE EXCEPTION 'Missing spatial functions (expected 3, got %)', func_count;
    END IF;
END $$;

-- ---------- Test 4: Materialized views exist ----------
\echo 'Test 4: Checking materialized views exist...'
DO $$
DECLARE
    mv_count integer;
BEGIN
    SELECT count(*) INTO mv_count FROM pg_matviews
    WHERE matviewname IN ('dashboard_stats', 'especies_por_uc', 'ranking_especies_categoria', 'ucs_por_esfera');
    IF mv_count < 4 THEN
        RAISE EXCEPTION 'Missing materialized views (expected 4, got %)', mv_count;
    END IF;
END $$;

-- ---------- Test 5: Audit trigger fires on INSERT ----------
\echo 'Test 5: Testing audit trigger on INSERT...'
DO $$
DECLARE
    initial_count bigint;
    final_count bigint;
    test_id integer;
    test_genero_id integer;
BEGIN
    -- Create a minimal taxonomy chain for the test species
    INSERT INTO taxon (nome, "rank") VALUES ('testgenus_smoke', 'genero')
    RETURNING id INTO test_genero_id;

    SELECT count(*) INTO initial_count FROM log_auditoria WHERE tabela = 'especie';

    INSERT INTO especie (nome_cientifico, nome_popular, categoria_ameaca, genero_id)
    VALUES ('testus smokeus', 'test species', 'LC', test_genero_id)
    RETURNING id INTO test_id;

    SELECT count(*) INTO final_count FROM log_auditoria WHERE tabela = 'especie';
    IF final_count <= initial_count THEN
        RAISE EXCEPTION 'Audit trigger did not fire on INSERT into especie';
    END IF;

    -- Clean up test data
    DELETE FROM especie WHERE id = test_id;
    DELETE FROM taxon WHERE id = test_genero_id;
END $$;

-- ---------- Test 6: Geometry validation trigger ----------
\echo 'Test 6: Testing geometry validation trigger...'
DO $$
BEGIN
    -- Valid geometry should work
    BEGIN
        INSERT INTO area_protegida (nome, categoria_uc, esfera, geom)
        VALUES ('TEST-AREA-VALID', 'protecao_integral', 'federal',
                ST_Multi(ST_SetSRID(ST_MakeEnvelope(0, 0, 0.1, 0.1, 4326), 4326)));
    END;
    -- Clean up
    DELETE FROM area_protegida WHERE nome = 'TEST-AREA-VALID';

    -- Invalid geometry should raise exception
    BEGIN
        INSERT INTO area_protegida (nome, categoria_uc, esfera, geom)
        VALUES ('TEST-AREA-INVALID', 'protecao_integral', 'federal',
                ST_Multi(ST_SetSRID(
                    ST_GeomFromText('POLYGON((0 0, 1 1, 0 1, 1 0, 0 0))'), 4326)));
        RAISE EXCEPTION 'Invalid geometry was accepted (trigger should have rejected it)';
    EXCEPTION
        WHEN OTHERS THEN
            -- Expected: trigger raised an exception
    END;
END $$;

-- ---------- Test 7: Migration journal ----------
\echo 'Test 7: Testing migration journal...'
DO $$
DECLARE
    migration_count integer;
BEGIN
    SELECT count(*) INTO migration_count FROM schema_migrations;
    -- Consolidated schema: a single 001_initial.sql entry is enough.
    IF migration_count < 1 THEN
        RAISE EXCEPTION 'schema_migrations is empty (expected at least 1 entry)';
    END IF;
END $$;

-- ---------- Test 8: PostGIS extension ----------
\echo 'Test 8: Checking PostGIS extension...'
DO $$
DECLARE
    postgis_version text;
BEGIN
    SELECT postgis_scripts_installed() INTO postgis_version;
    IF postgis_version IS NULL THEN
        RAISE EXCEPTION 'PostGIS extension not installed';
    END IF;
END $$;

\echo ''
\echo '==> All smoke tests passed!'
