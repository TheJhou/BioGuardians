-- ============================================================
-- BioGuardians - 09 Performance & Otimizacoes
-- Parallel query, full-text search, indices compostos,
-- configuracao de memoria para container 2GB.
-- ============================================================

-- ---------- Parallel Query ----------
-- Habilita queries paralelas para ST_Contains, scans e aggregates.
ALTER SYSTEM SET max_worker_processes = 8;
ALTER SYSTEM SET max_parallel_workers = 4;
ALTER SYSTEM SET max_parallel_workers_per_gather = 2;
ALTER SYSTEM SET parallel_setup_cost = 100;
ALTER SYSTEM SET parallel_tuple_cost = 0.03;
ALTER SYSTEM SET min_parallel_table_scan_size = '8MB';
ALTER SYSTEM SET min_parallel_index_scan_size = '512kB';

-- ---------- Configuracao de Memoria ----------
-- Otimizado para container com 2GB RAM.
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET work_mem = '8MB';
ALTER SYSTEM SET maintenance_work_mem = '128MB';

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
-- Retorna especies ordenadas por relevancia.
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
