-- ============================================================
-- BioGuardians — 002: schema hardening e performance
--
-- Mudanças da revisão de schema. Tudo idempotente, roda dentro
-- de transação (sem ALTER TYPE/REFRESH CONCURRENTLY).
-- ============================================================

-- ---------- Auditoria: registro_id BIGINT ----------
-- Tabelas como imagem_job usam PK BIGINT — INTEGER estouraria
-- se trg_auditar fosse ligado nelas.
ALTER TABLE log_auditoria ALTER COLUMN registro_id TYPE BIGINT;

-- ---------- Deteccao: coluna espacial ----------
-- Buscas geográficas ("detecções dentro de uma UC") exigiam
-- ST_MakePoint por linha + sequential scan. Agora há geom + GIST.
ALTER TABLE deteccao ADD COLUMN IF NOT EXISTS geom geometry(POINT, 4326);
UPDATE deteccao SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326) WHERE geom IS NULL;
CREATE INDEX IF NOT EXISTS idx_deteccao_geom ON deteccao USING GIST (geom);

-- ---------- Sync bidirecional lat/lon <-> geom ----------
-- Se o UPDATE mexeu só em geom, deriva lat/lon; senão reconstrói geom.
-- Usada por ocorrencia e deteccao.
CREATE OR REPLACE FUNCTION trg_sincroniza_geom_latlon()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.geom IS DISTINCT FROM OLD.geom
       AND NEW.lat IS NOT DISTINCT FROM OLD.lat
       AND NEW.lon IS NOT DISTINCT FROM OLD.lon
    THEN
        NEW.lon := ST_X(NEW.geom);
        NEW.lat := ST_Y(NEW.geom);
    ELSE
        NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
    END IF;
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_ocorrencia_geom ON ocorrencia;
CREATE TRIGGER trg_ocorrencia_geom
    BEFORE INSERT OR UPDATE OF lat, lon, geom ON ocorrencia
    FOR EACH ROW EXECUTE FUNCTION trg_sincroniza_geom_latlon();

DROP TRIGGER IF EXISTS trg_deteccao_geom ON deteccao;
CREATE TRIGGER trg_deteccao_geom
    BEFORE INSERT OR UPDATE OF lat, lon, geom ON deteccao
    FOR EACH ROW EXECUTE FUNCTION trg_sincroniza_geom_latlon();

-- Função antiga não é mais referenciada pelos triggers acima.
DROP FUNCTION IF EXISTS trg_ocorrencia_sincroniza_geom() CASCADE;

-- ---------- Auditoria: v_id BIGINT ----------
CREATE OR REPLACE FUNCTION trg_auditar()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_op  operacao_auditoria_tipo;
    v_id  BIGINT;
    v_old JSONB;
    v_new JSONB;
BEGIN
    v_op := TG_OP::operacao_auditoria_tipo;
    IF v_op = 'DELETE' THEN
        v_id := OLD.id;  v_old := to_jsonb(OLD); v_new := NULL;
    ELSIF v_op = 'UPDATE' THEN
        v_id := NEW.id;  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    ELSE
        v_id := NEW.id;  v_old := NULL;          v_new := to_jsonb(NEW);
    END IF;
    INSERT INTO log_auditoria (tabela, operacao, registro_id, dados_anteriores, dados_novos)
    VALUES (TG_TABLE_NAME, v_op, v_id, v_old, v_new);
    RETURN COALESCE(NEW, OLD);
END; $$;

-- ---------- dashboard_stats: scan único com FILTER ----------
-- Antes: 10 subconsultas = 7 scans em especie por refresh.
DROP MATERIALIZED VIEW IF EXISTS dashboard_stats;
CREATE MATERIALIZED VIEW dashboard_stats AS
SELECT
    1 AS id,
    s.total_especies,
    s.total_cr,
    s.total_en,
    s.total_vu,
    s.total_nt,
    s.total_lc,
    s.total_dd,
    a.total_areas,
    a.area_total_ha,
    oc.total_ocorrencias
FROM (
    SELECT COUNT(*)                                        AS total_especies,
           COUNT(*) FILTER (WHERE categoria_ameaca = 'CR') AS total_cr,
           COUNT(*) FILTER (WHERE categoria_ameaca = 'EN') AS total_en,
           COUNT(*) FILTER (WHERE categoria_ameaca = 'VU') AS total_vu,
           COUNT(*) FILTER (WHERE categoria_ameaca = 'NT') AS total_nt,
           COUNT(*) FILTER (WHERE categoria_ameaca = 'LC') AS total_lc,
           COUNT(*) FILTER (WHERE categoria_ameaca = 'DD') AS total_dd
    FROM especie
    WHERE status = 'ativo'
) s
CROSS JOIN (
    SELECT COUNT(*) AS total_areas, COALESCE(SUM(area_ha), 0) AS area_total_ha
    FROM area_protegida
) a
CROSS JOIN (
    SELECT COUNT(*) AS total_ocorrencias
    FROM ocorrencia o
    JOIN especie e ON e.id = o.especie_id
    WHERE e.status = 'ativo'
) oc;

-- Índice único é exigido pelo REFRESH CONCURRENTLY (dropado junto com a view).
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_stats_unico ON dashboard_stats(id);
