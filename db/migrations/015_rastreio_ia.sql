-- ============================================================
-- BioGuardians - 15 Rastreio de classificacao por IA
--
-- Adiciona campos na tabela deteccao para rastrear qual metodo
-- classificou a especie (IA via OpenRouter ou heuristico), qual
-- modelo de IA foi usado e a confianca retornada pela IA.
-- Permite filtrar e auditar deteccoes feitas por IA vs heuristico.
-- ============================================================

ALTER TABLE deteccao
    ADD COLUMN IF NOT EXISTS metodo_classificacao VARCHAR(20) NOT NULL DEFAULT 'heuristic'
        CHECK (metodo_classificacao IN ('ai', 'heuristic')),
    ADD COLUMN IF NOT EXISTS modelo_ia VARCHAR(100),
    ADD COLUMN IF NOT EXISTS confianca_ia NUMERIC(5,4);

-- Indice para filtrar deteccoes por metodo de classificacao
CREATE INDEX IF NOT EXISTS idx_deteccao_metodo
    ON deteccao(metodo_classificacao);
