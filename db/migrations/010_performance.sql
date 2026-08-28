-- ============================================================
-- BioGuardians - 10 Performance: FTS, Composite Indexes
-- Full-text search, composite indexes, and statistics.
-- Runs inside a transaction (no ALTER SYSTEM here).
-- ============================================================

-- ---------- Full-Text Search (busca composta) ----------
-- Coluna gerada que combina nome_cientifico + nome_popular + descricao.
-- Usa configuracao 'portuguese' para stemming e acentos.
ALTER TABLE especie ADD COLUMN tsv_busca tsvector
    GENERATED ALWAYS AS (
        to_tsvector('portuguese',
            nome_cientifico || ' ' ||
            COALESCE(nome_popular, '') || ' ' ||
            COALESCE(descricao, '')
        )
    ) STORED;

-- Indice GIN para busca textual rapida.
CREATE INDEX idx_especie_busca_fts ON especie USING GIN (tsv_busca);

-- Funcao de busca composta com relevancia (ts_rank).
CREATE OR REPLACE FUNCTION buscar_especies(p_busca TEXT)
    RETURNS TABLE (
        especie_id        INTEGER,
        nome_cientifico   nome_cientifico_dom,
        nome_popular      VARCHAR,
        categoria         categoria_ameaca_tipo,
        relevancia        REAL
    )
    LANGUAGE sql STABLE
    AS $$
        SELECT e.id, e.nome_cientifico, e.nome_popular, e.categoria_ameaca,
               ts_rank(e.tsv_busca, plainto_tsquery('portuguese', p_busca)) AS relevancia
        FROM especie e
        WHERE e.tsv_busca @@ plainto_tsquery('portuguese', p_busca)
          AND e.status = 'ativo'
        ORDER BY relevancia DESC;
    $$;

-- ---------- Indices Compostos ----------
-- Acelera "ocorrencias da especie X ordenadas por data".
CREATE INDEX idx_ocorrencia_especie_data
    ON ocorrencia (especie_id, data_evento DESC);

-- Acelera "especies CR ativas" (filtro combinado frequente).
CREATE INDEX idx_especie_cat_status
    ON especie (categoria_ameaca, status);

-- ---------- Estatisticas ----------
-- Atualiza planner stats apos mudancas de schema e dados.
ANALYZE;
