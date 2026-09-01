-- ============================================================
-- BioGuardians - 14 Deteccao por Satelite (CBERS-4A WPM)
--
-- Tabelas para o microservico de ML que busca imagens de
-- satelite CBERS-4A WPM (INPE), detecta animais via YOLOv8,
-- classifica especies e registra ocorrencias.
-- ============================================================

-- Estende a fonte de ocorrencia para incluir deteccao por satelite.
ALTER TYPE fonte_ocorrencia_tipo ADD VALUE IF NOT EXISTS 'deteccao_satelite';

-- ---------- Jobs de deteccao ----------
-- Cada job representa o processamento de uma cena de satelite.
CREATE TABLE IF NOT EXISTS deteccao_job (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bbox            VARCHAR(120) NOT NULL,          -- "minLng,minLat,maxLng,maxLat"
    data_captura    DATE NOT NULL,                  -- data da imagem de satelite
    satelite        VARCHAR(30) NOT NULL DEFAULT 'CBERS-4A',
    instrumento     VARCHAR(30) NOT NULL DEFAULT 'WPM',
    produto         VARCHAR(60) NOT NULL DEFAULT 'L4_DN',
    scene_id        VARCHAR(120),                   -- identificador da cena no INPE
    imagem_url      TEXT,                           -- caminho da imagem baixada
    status          VARCHAR(20) NOT NULL DEFAULT 'pendente',
    total_deteccoes INTEGER NOT NULL DEFAULT 0,
    erro            TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido_em    TIMESTAMPTZ,
    CONSTRAINT deteccao_job_status_chk
        CHECK (status IN ('pendente', 'processando', 'concluido', 'erro'))
);

-- ---------- Deteccoes individuais ----------
-- Cada deteccao e um animal encontrado dentro de um job.
CREATE TABLE IF NOT EXISTS deteccao (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id          INTEGER NOT NULL,
    especie_id      INTEGER,                        -- FK para especie (nullable ate classificar)
    nome_cientifico VARCHAR(200),                   -- especie classificada (nullable)
    confianca       NUMERIC(5,4),                   -- 0.0000 a 1.0000
    lat             DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon             DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
    bbox_pixel      VARCHAR(80),                    -- "x,y,w,h" em pixels da imagem
    recorte_url     TEXT,                           -- caminho do recorte do animal
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT deteccao_job_fk
        FOREIGN KEY (job_id) REFERENCES deteccao_job(id) ON DELETE CASCADE,
    CONSTRAINT deteccao_especie_fk
        FOREIGN KEY (especie_id) REFERENCES especie(id) ON DELETE SET NULL
);

-- ---------- Registro de modelos de ML ----------
-- Rastreia versoes dos modelos de deteccao e classificacao.
CREATE TABLE IF NOT EXISTS modelo_ml (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome            VARCHAR(100) NOT NULL,
    versao          VARCHAR(30) NOT NULL,
    tipo            VARCHAR(30) NOT NULL,           -- 'deteccao' ou 'classificacao'
    caminho         TEXT NOT NULL,                  -- caminho dos pesos do modelo
    acuracia        NUMERIC(5,4),
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nome, versao),
    CONSTRAINT modelo_ml_tipo_chk
        CHECK (tipo IN ('deteccao', 'classificacao'))
);

-- ---------- Indices ----------
CREATE INDEX IF NOT EXISTS idx_deteccao_job        ON deteccao(job_id);
CREATE INDEX IF NOT EXISTS idx_deteccao_job_status ON deteccao_job(status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_deteccao_especie    ON deteccao(especie_id) WHERE especie_id IS NOT NULL;

-- Indice espacial GIST para buscas por area nas deteccoes.
CREATE INDEX IF NOT EXISTS idx_deteccao_geom
    ON deteccao USING GIST (ST_SetSRID(ST_MakePoint(lon, lat), 4326));
