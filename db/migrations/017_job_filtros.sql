-- ============================================================
-- BioGuardians - 17 Colunas de filtro no deteccao_job
--
-- Permite que um job de ingestao especifique filtro de projeto
-- e limite de imagens (util para testes com dataset parcial).
-- ============================================================

ALTER TABLE deteccao_job
    ADD COLUMN IF NOT EXISTS project_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS p_limit INTEGER;
