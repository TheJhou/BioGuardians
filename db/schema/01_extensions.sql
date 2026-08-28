-- ============================================================
-- BioGuardians - 01 Extensões
-- Habilita PostGIS e pgcrypto (UUIDs / funções cripto).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Sanity check: confirma que PostGIS está ativo.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'postgis'
    ) THEN
        RAISE EXCEPTION 'PostGIS não está instalado neste container.';
    END IF;
END $$;
