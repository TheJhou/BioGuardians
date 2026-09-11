-- ============================================================
-- BioGuardians — 003: junção ocorrencia_area (denormalização espacial)
--
-- Substitui ST_Contains em tempo de leitura por JOIN de inteiros.
-- A relação ocorrência↔área é pré-calculada uma vez por escrita
-- (trigger), não a cada consulta/refresh de view.
-- ============================================================

-- ---------- Tabela de junção (N:N — UCs podem se sobrepor) ----------
CREATE TABLE IF NOT EXISTS ocorrencia_area (
    ocorrencia_id INTEGER NOT NULL,
    area_id       INTEGER NOT NULL,
    CONSTRAINT ocorrencia_area_pk PRIMARY KEY (ocorrencia_id, area_id),
    CONSTRAINT oa_ocorrencia_fk FOREIGN KEY (ocorrencia_id)
        REFERENCES ocorrencia(id) ON DELETE CASCADE,
    CONSTRAINT oa_area_fk FOREIGN KEY (area_id)
        REFERENCES area_protegida(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ocorrencia_area_area ON ocorrencia_area(area_id);

-- ---------- Backfill (uma vez) ----------
INSERT INTO ocorrencia_area (ocorrencia_id, area_id)
SELECT o.id, a.id
FROM ocorrencia o
JOIN area_protegida a ON ST_Contains(a.geom, o.geom)
ON CONFLICT DO NOTHING;

-- ---------- Triggers de manutenção ----------
-- Ocorrência nova ou movida: recalcula em quais áreas o ponto cai.
CREATE OR REPLACE FUNCTION trg_ocorrencia_recalcula_areas()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM ocorrencia_area WHERE ocorrencia_id = NEW.id;
    INSERT INTO ocorrencia_area (ocorrencia_id, area_id)
    SELECT NEW.id, a.id
    FROM area_protegida a
    WHERE ST_Contains(a.geom, NEW.geom);
    RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_ocorrencia_areas ON ocorrencia;
CREATE TRIGGER trg_ocorrencia_areas
    AFTER INSERT OR UPDATE OF geom ON ocorrencia
    FOR EACH ROW EXECUTE FUNCTION trg_ocorrencia_recalcula_areas();

-- Área nova ou geometria alterada: recalcula quais ocorrências ela contém.
CREATE OR REPLACE FUNCTION trg_area_recalcula_ocorrencias()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM ocorrencia_area WHERE area_id = NEW.id;
    INSERT INTO ocorrencia_area (ocorrencia_id, area_id)
    SELECT o.id, NEW.id
    FROM ocorrencia o
    WHERE ST_Contains(NEW.geom, o.geom);
    RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_area_ocorrencias ON area_protegida;
CREATE TRIGGER trg_area_ocorrencias
    AFTER INSERT OR UPDATE OF geom ON area_protegida
    FOR EACH ROW EXECUTE FUNCTION trg_area_recalcula_ocorrencias();

-- ---------- Funções reescritas: JOIN de inteiros, sem ST_Contains ----------
CREATE OR REPLACE FUNCTION especies_em_area(p_area_id INTEGER)
    RETURNS TABLE (
        especie_id      INTEGER,
        nome_cientifico nome_cientifico_dom,
        nome_popular    VARCHAR,
        categoria       categoria_ameaca_tipo
    )
    LANGUAGE sql STABLE AS $$
        SELECT DISTINCT e.id, e.nome_cientifico, e.nome_popular, e.categoria_ameaca
        FROM ocorrencia_area oa
        JOIN ocorrencia o ON o.id = oa.ocorrencia_id
        JOIN especie    e ON e.id = o.especie_id
        WHERE oa.area_id = p_area_id
          AND e.categoria_ameaca IN ('CR','EN','VU');
    $$;

CREATE OR REPLACE FUNCTION areas_protegem_especie(p_especie_id INTEGER)
    RETURNS TABLE (
        area_id      INTEGER,
        nome         VARCHAR,
        categoria_uc categoria_uc_tipo,
        esfera       esfera_tipo
    )
    LANGUAGE sql STABLE AS $$
        SELECT DISTINCT a.id, a.nome, a.categoria_uc, a.esfera
        FROM ocorrencia_area oa
        JOIN ocorrencia     o ON o.id = oa.ocorrencia_id
        JOIN area_protegida a ON a.id = oa.area_id
        WHERE o.especie_id = p_especie_id;
    $$;

CREATE OR REPLACE FUNCTION contar_ocorrencias_em_area(p_area_id INTEGER)
    RETURNS BIGINT
    LANGUAGE sql STABLE AS $$
        SELECT count(*)::BIGINT
        FROM ocorrencia_area
        WHERE area_id = p_area_id;
    $$;

-- ---------- View materializada via junção ----------
DROP MATERIALIZED VIEW IF EXISTS especies_por_uc;
CREATE MATERIALIZED VIEW especies_por_uc AS
SELECT DISTINCT
    a.id          AS area_id,
    a.nome        AS area_nome,
    e.id          AS especie_id,
    e.nome_cientifico,
    e.categoria_ameaca
FROM ocorrencia_area oa
JOIN area_protegida a ON a.id = oa.area_id
JOIN ocorrencia     o ON o.id = oa.ocorrencia_id
JOIN especie        e ON e.id = o.especie_id
WHERE e.categoria_ameaca IN ('CR','EN','VU');

CREATE UNIQUE INDEX IF NOT EXISTS idx_especies_por_uc_pk ON especies_por_uc(area_id, especie_id);
