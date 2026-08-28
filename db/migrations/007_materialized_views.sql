-- ============================================================
-- BioGuardians - 07 Views Materializadas
-- Pré-agregam estatísticas para o dashboard. Refresh sob
-- demanda via SELECT refresh_dashboard();
-- ============================================================

-- Estatísticas globais (uma única linha, com chave estável p/ refresh).
CREATE MATERIALIZED VIEW dashboard_stats AS
SELECT
    1 AS id,
    (SELECT count(*) FROM especie WHERE status = 'ativo')                AS total_especies,
    (SELECT count(*) FROM especie WHERE categoria_ameaca = 'CR')         AS total_cr,
    (SELECT count(*) FROM especie WHERE categoria_ameaca = 'EN')         AS total_en,
    (SELECT count(*) FROM especie WHERE categoria_ameaca = 'VU')         AS total_vu,
    (SELECT count(*) FROM area_protegida)                                AS total_areas,
    (SELECT sum(area_ha) FROM area_protegida)                            AS area_total_ha,
    (SELECT count(*) FROM ocorrencia)                                    AS total_ocorrencias
WITH DATA;

CREATE UNIQUE INDEX idx_dashboard_stats_unico
    ON dashboard_stats(id);  -- garante refresh concurrently

-- Espécies ameaçadas por UC (resultado da consulta espacial, distinto).
CREATE MATERIALIZED VIEW especies_por_uc AS
SELECT DISTINCT
    a.id          AS area_id,
    a.nome        AS area_nome,
    e.id          AS especie_id,
    e.nome_cientifico,
    e.categoria_ameaca
FROM area_protegida a
JOIN ocorrencia   o ON ST_Contains(a.geom, o.geom)
JOIN especie      e ON e.id = o.especie_id
WHERE e.categoria_ameaca IN ('CR','EN','VU')
WITH DATA;

CREATE UNIQUE INDEX idx_especies_por_uc_pk
    ON especies_por_uc(area_id, especie_id);

-- Ranking de espécies por categoria de ameaça.
CREATE MATERIALIZED VIEW ranking_especies_categoria AS
SELECT categoria_ameaca, count(*) AS total
FROM especie
WHERE status = 'ativo'
GROUP BY categoria_ameaca
ORDER BY (
    CASE categoria_ameaca
        WHEN 'CR' THEN 1 WHEN 'EN' THEN 2 WHEN 'VU' THEN 3
        WHEN 'NT' THEN 4 WHEN 'LC' THEN 5 WHEN 'DD' THEN 6
    END
)
WITH DATA;

CREATE UNIQUE INDEX idx_ranking_categoria
    ON ranking_especies_categoria(categoria_ameaca);

-- Distribuição de UCs por esfera administrativa.
CREATE MATERIALIZED VIEW ucs_por_esfera AS
SELECT esfera, count(*) AS total, sum(area_ha) AS area_ha
FROM area_protegida
GROUP BY esfera
ORDER BY total DESC
WITH DATA;

CREATE UNIQUE INDEX idx_ucs_por_esfera
    ON ucs_por_esfera(esfera);

-- Popula views na criação.
SELECT refresh_dashboard();
