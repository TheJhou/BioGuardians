-- ============================================================
-- BioGuardians - 05 Funções PL/pgSQL
-- Encapsulam consultas espaciais e operações de domínio.
-- ============================================================

-- Espécies ameaçadas cujas ocorrências estão dentro de uma UC.
-- Retorna conjunto de espécies distintas.
CREATE OR REPLACE FUNCTION especies_em_area(p_area_id INTEGER)
    RETURNS TABLE (
        especie_id        INTEGER,
        nome_cientifico   nome_cientifico_dom,
        nome_popular      VARCHAR,
        categoria         categoria_ameaca_tipo
    )
    LANGUAGE sql STABLE
    AS $$
        SELECT DISTINCT e.id, e.nome_cientifico, e.nome_popular, e.categoria_ameaca
        FROM ocorrencia o
        JOIN especie    e ON e.id = o.especie_id
        JOIN area_protegida a ON a.id = p_area_id
        WHERE ST_Contains(a.geom, o.geom)
          AND e.categoria_ameaca IN ('CR','EN','VU');
    $$;

-- Áreas protegidas que contêm ao menos uma ocorrência da espécie.
CREATE OR REPLACE FUNCTION areas_protegem_especie(p_especie_id INTEGER)
    RETURNS TABLE (
        area_id      INTEGER,
        nome         VARCHAR,
        categoria_uc categoria_uc_tipo,
        esfera       esfera_tipo
    )
    LANGUAGE sql STABLE
    AS $$
        SELECT DISTINCT a.id, a.nome, a.categoria_uc, a.esfera
        FROM area_protegida a
        JOIN ocorrencia o ON ST_Contains(a.geom, o.geom)
        WHERE o.especie_id = p_especie_id;
    $$;

-- Conta ocorrências dentro de uma área (qualquer espécie).
CREATE OR REPLACE FUNCTION contar_ocorrencias_em_area(p_area_id INTEGER)
    RETURNS BIGINT
    LANGUAGE sql STABLE
    AS $$
        SELECT count(*)::BIGINT
        FROM ocorrencia o
        JOIN area_protegida a ON a.id = p_area_id
        WHERE ST_Contains(a.geom, o.geom);
    $$;

-- Atualiza views materializadas. Usa REFRESH simples (bloqueante) porque
-- REFRESH ... CONCURRENTLY não pode rodar dentro de função/transação.
-- Para refresh concorrente em produção, execute os 4 REFRESH
-- CONCURRENTLY manualmente (cada um fora de transação); os índices
-- únicos já existem para permitir isso.
CREATE OR REPLACE FUNCTION refresh_dashboard()
    RETURNS VOID
    LANGUAGE plpgsql
    AS $$
    BEGIN
        REFRESH MATERIALIZED VIEW dashboard_stats;
        REFRESH MATERIALIZED VIEW especies_por_uc;
        REFRESH MATERIALIZED VIEW ranking_especies_categoria;
        REFRESH MATERIALIZED VIEW ucs_por_esfera;
    END;
    $$;
