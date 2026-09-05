-- ============================================================
-- BioGuardians - 16 Processamento em massa (camera trap + bulk)
--
-- Prepara a arquitetura para processar centenas de milhares de
-- imagens de camera trap (e outras fontes) com checkpoint,
-- idempotencia e separacao entre deteccao (YOLO) e classificacao
-- (VLM). Nao acoplado a um formato de dataset especifico — os
-- metadados (camera_id, project_id, deployment_id, etc.) sao
-- opcionais e preenchidos conforme a fonte fornecer.
-- ============================================================

-- ---------- Status de processamento por imagem ----------
-- Controla o checkpoint de cada imagem dentro de um job.
-- Permite retomar o processamento sem reprocessar imagens
-- ja concluidas (idempotencia via UNIQUE source+source_image_id).
DO $$ BEGIN
    CREATE TYPE imagem_status AS ENUM (
        'pending',     -- registrada, aguardando deteccao
        'processing',  -- deteccao em andamento
        'detected',    -- YOLO rodou, deteccoes salvas, aguardando classificacao
        'classified',  -- classificacao VLM concluida
        'completed',   -- pipeline finalizada para esta imagem
        'failed'       -- erro (ver coluna error)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- Status de classificacao por deteccao ----------
-- Cada deteccao passa por deteccao (YOLO) -> classificacao (VLM).
-- O resultado da classificacao pode ser confirmado, inconclusivo
-- ou rejeitado (false positive do YOLO).
DO $$ BEGIN
    CREATE TYPE deteccao_status AS ENUM (
        'detected',      -- YOLO detectou, sem classificacao ainda
        'classified',    -- VLM classificou com especie
        'rejected',      -- VLM rejeitou (nao eh animal / false positive)
        'inconclusive'   -- VLM nao conseguiu classificar
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- Controle por imagem (checkpoint) ----------
CREATE TABLE IF NOT EXISTS imagem_job (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id          INTEGER NOT NULL,
    source          VARCHAR(30) NOT NULL,           -- 'satellite' | 'camera_trap' | 'local_dir'
    source_image_id VARCHAR(200),                   -- ID original na fonte (scene id, filename, etc.)
    image_hash      VARCHAR(64),                    -- SHA-256 para dedup
    path            TEXT,                           -- path local da imagem (ou URL antes do download)
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    timestamp       TIMESTAMPTZ,                    -- data/hora da captura
    camera_id       VARCHAR(100),
    project_id      VARCHAR(100),
    deployment_id   VARCHAR(100),
    status          imagem_status NOT NULL DEFAULT 'pending',
    detection_count INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT imagem_job_job_fk
        FOREIGN KEY (job_id) REFERENCES deteccao_job(id) ON DELETE CASCADE,
    CONSTRAINT imagem_job_unique
        UNIQUE (source, source_image_id)
);

CREATE INDEX IF NOT EXISTS idx_imagem_job_status
    ON imagem_job(status);
CREATE INDEX IF NOT EXISTS idx_imagem_job_hash
    ON imagem_job(image_hash) WHERE image_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imagem_job_job
    ON imagem_job(job_id);

-- ---------- Status na deteccao existente ----------
-- Liga cada deteccao ao seu checkpoint de imagem e ao status
-- do fluxo deteccao -> classificacao.
ALTER TABLE deteccao
    ADD COLUMN IF NOT EXISTS status deteccao_status NOT NULL DEFAULT 'detected',
    ADD COLUMN IF NOT EXISTS image_job_id BIGINT REFERENCES imagem_job(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deteccao_status
    ON deteccao(status);
CREATE INDEX IF NOT EXISTS idx_deteccao_image_job
    ON deteccao(image_job_id) WHERE image_job_id IS NOT NULL;

-- ---------- Nova fonte de ocorrencia: camera_trap ----------
ALTER TYPE fonte_ocorrencia_tipo ADD VALUE IF NOT EXISTS 'camera_trap';

-- ---------- Adaptacao de deteccao_job ----------
-- Os campos satelite-especificos tornam-se opcionais para que
-- a mesma tabela sirva para jobs de camera trap e outras fontes.
-- Novos campos genericos rastreiam o progresso do bulk.
ALTER TABLE deteccao_job
    ALTER COLUMN bbox DROP NOT NULL,
    ALTER COLUMN satelite DROP NOT NULL,
    ALTER COLUMN instrumento DROP NOT NULL,
    ALTER COLUMN produto DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'satellite',
    ADD COLUMN IF NOT EXISTS data_dir TEXT,
    ADD COLUMN IF NOT EXISTS total_imagens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS imagens_processadas INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_deteccao_job_source
    ON deteccao_job(source, status, criado_em DESC);

-- ---------- Trigger: updated_at na imagem_job ----------
CREATE OR REPLACE FUNCTION set_imagem_job_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_imagem_job_updated_at ON imagem_job;
CREATE TRIGGER trg_imagem_job_updated_at
    BEFORE UPDATE ON imagem_job
    FOR EACH ROW
    EXECUTE FUNCTION set_imagem_job_updated_at();
