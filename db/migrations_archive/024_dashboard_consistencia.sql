-- ---------- Dashboard: consistencia com status/categoria ----------
-- - total_* de especies passa a contar so status='ativo'
-- - total_ocorrencias conta so ocorrencias de especies ativas
-- - adiciona totais por categoria restantes (NT, LC, DD, NE)

DROP MATERIALIZED VIEW IF EXISTS dashboard_stats;

CREATE MATERIALIZED VIEW dashboard_stats AS
SELECT
    1 AS id,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo')                          AS total_especies,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'CR') AS total_cr,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'EN') AS total_en,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'VU') AS total_vu,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'NT') AS total_nt,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'LC') AS total_lc,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'DD') AS total_dd,
    (SELECT COUNT(*) FROM area_protegida)                                          AS total_areas,
    (SELECT COALESCE(SUM(area_ha), 0) FROM area_protegida)                         AS area_total_ha,
    (SELECT COUNT(*) FROM ocorrencia o
      JOIN especie e ON e.id = o.especie_id
     WHERE e.status = 'ativo')                                                     AS total_ocorrencias;

SELECT refresh_dashboard();
