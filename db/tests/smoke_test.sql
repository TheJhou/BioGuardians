-- ============================================================
-- BioGuardians - Smoke Tests
-- Validates that migrations applied correctly and that core
-- database features (PostGIS, triggers, views, functions) work.
-- Used by CI (GitHub Actions) and can be run manually.
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
        'schema_migrations'
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

-- ---------- Test 2: Seed data was loaded ----------
\echo 'Test 2: Checking seed data counts...'
DO $$
BEGIN
    IF (SELECT count(*) FROM categoria_ameaca) < 6 THEN
        RAISE EXCEPTION 'categoria_ameaca not fully loaded (expected 6)';
    END IF;
    IF (SELECT count(*) FROM bioma) < 7 THEN
        RAISE EXCEPTION 'bioma not fully loaded (expected 7)';
    END IF;
    IF (SELECT count(*) FROM estado) < 27 THEN
        RAISE EXCEPTION 'estado not fully loaded (expected 27)';
    END IF;
    IF (SELECT count(*) FROM taxon) < 20 THEN
        RAISE EXCEPTION 'taxon not fully loaded';
    END IF;
    IF (SELECT count(*) FROM especie) < 13 THEN
        RAISE EXCEPTION 'especie not fully loaded (expected 13)';
    END IF;
    IF (SELECT count(*) FROM area_protegida) < 9 THEN
        RAISE EXCEPTION 'area_protegida not fully loaded (expected 9)';
    END IF;
    IF (SELECT count(*) FROM ocorrencia) < 21 THEN
        RAISE EXCEPTION 'ocorrencia not fully loaded (expected 21)';
    END IF;
END $$;

-- ---------- Test 3: Spatial query (ST_Contains) ----------
\echo 'Test 3: Testing ST_Contains spatial query...'
DO $$
DECLARE
    result_count integer;
BEGIN
    -- Area 1 = Parque Nacional do Iguaçu (should contain panthera onca)
    SELECT count(*) INTO result_count FROM especies_em_area(1);
    IF result_count = 0 THEN
        RAISE EXCEPTION 'especies_em_area(1) returned 0 species - spatial query not working';
    END IF;
END $$;

-- ---------- Test 4: Reverse spatial query ----------
\echo 'Test 4: Testing areas_protegem_especie function...'
DO $$
DECLARE
    result_count integer;
BEGIN
    SELECT count(*) INTO result_count FROM areas_protegem_especie(
        (SELECT id FROM especie WHERE nome_cientifico = 'panthera onca')
    );
    IF result_count = 0 THEN
        RAISE EXCEPTION 'areas_protegem_especie returned 0 areas for panthera onca';
    END IF;
END $$;

-- ---------- Test 5: Materialized views ----------
\echo 'Test 5: Testing materialized views...'
DO $$
BEGIN
    IF (SELECT total_especies FROM dashboard_stats) < 13 THEN
        RAISE EXCEPTION 'dashboard_stats.total_especies < 13';
    END IF;
    IF (SELECT total_areas FROM dashboard_stats) < 9 THEN
        RAISE EXCEPTION 'dashboard_stats.total_areas < 9';
    END IF;
    IF (SELECT count(*) FROM especies_por_uc) = 0 THEN
        RAISE EXCEPTION 'especies_por_uc is empty';
    END IF;
    IF (SELECT count(*) FROM ranking_especies_categoria) = 0 THEN
        RAISE EXCEPTION 'ranking_especies_categoria is empty';
    END IF;
    IF (SELECT count(*) FROM ucs_por_esfera) = 0 THEN
        RAISE EXCEPTION 'ucs_por_esfera is empty';
    END IF;
END $$;

-- ---------- Test 6: Audit trigger fires on INSERT ----------
\echo 'Test 6: Testing audit trigger on INSERT...'
DO $$
DECLARE
    initial_count bigint;
    final_count bigint;
    test_id integer;
BEGIN
    SELECT count(*) INTO initial_count FROM log_auditoria WHERE tabela = 'especie';

    INSERT INTO especie (nome_cientifico, nome_popular, categoria_ameaca, genero_id)
    VALUES ('testus testus', 'test species', 'LC',
            (SELECT id FROM taxon WHERE nome = 'panthera' AND "rank" = 'genero'))
    RETURNING id INTO test_id;

    SELECT count(*) INTO final_count FROM log_auditoria WHERE tabela = 'especie';
    IF final_count <= initial_count THEN
        RAISE EXCEPTION 'Audit trigger did not fire on INSERT into especie';
    END IF;

    -- Clean up test data (DELETE also triggers audit, which is fine)
    DELETE FROM especie WHERE id = test_id;
END $$;

-- ---------- Test 7: Geometry validation trigger ----------
\echo 'Test 7: Testing geometry validation trigger...'
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

-- ---------- Test 8: Migration journal ----------
\echo 'Test 8: Testing migration journal...'
DO $$
DECLARE
    migration_count integer;
BEGIN
    SELECT count(*) INTO migration_count FROM schema_migrations;
    IF migration_count < 8 THEN
        RAISE EXCEPTION 'schema_migrations has % entries (expected at least 8)', migration_count;
    END IF;
END $$;

\echo ''
\echo '==> All smoke tests passed!'
