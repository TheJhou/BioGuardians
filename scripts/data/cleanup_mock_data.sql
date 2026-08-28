-- ============================================================
-- BioGuardians - Clean Mock Data (run directly on production DB)
--
-- Run this with psql directly on the production database to
-- remove all mock data inserted by the old 008_seed_data.sql.
--
-- Keeps reference tables: categoria_ameaca, bioma, estado.
-- Removes: mock species, taxonomy, protected areas, occurrences.
--
-- Usage:
--   psql -h <host> -p <port> -U <user> -d <dbname> -f scripts/data/cleanup_mock_data.sql
-- ============================================================

BEGIN;

-- Remove mock occurrences
TRUNCATE TABLE ocorrencia CASCADE;

-- Remove mock species associations
TRUNCATE TABLE especie_bioma CASCADE;
TRUNCATE TABLE especie_estado CASCADE;

-- Remove mock species
TRUNCATE TABLE especie CASCADE;

-- Remove mock protected areas (UCs with fake polygons)
TRUNCATE TABLE area_protegida CASCADE;

-- Remove mock taxonomy (reino -> genero chain)
TRUNCATE TABLE taxon CASCADE;

-- Reset identity sequences so new inserts start from 1
ALTER TABLE especie ALTER COLUMN id RESTART WITH 1;
ALTER TABLE area_protegida ALTER COLUMN id RESTART WITH 1;
ALTER TABLE ocorrencia ALTER COLUMN id RESTART WITH 1;
ALTER TABLE taxon ALTER COLUMN id RESTART WITH 1;

-- Refresh dashboard views (will show zero counts)
SELECT refresh_dashboard();

COMMIT;

-- Verify cleanup (should all return 0)
SELECT 'ocorrencia' AS table, count(*) AS rows FROM ocorrencia
UNION ALL
SELECT 'especie', count(*) FROM especie
UNION ALL
SELECT 'area_protegida', count(*) FROM area_protegida
UNION ALL
SELECT 'taxon', count(*) FROM taxon
UNION ALL
SELECT 'especie_bioma', count(*) FROM especie_bioma
UNION ALL
SELECT 'especie_estado', count(*) FROM especie_estado;

-- Reference tables (should NOT be zero)
SELECT 'categoria_ameaca' AS table, count(*) AS rows FROM categoria_ameaca
UNION ALL
SELECT 'bioma', count(*) FROM bioma
UNION ALL
SELECT 'estado', count(*) FROM estado;
