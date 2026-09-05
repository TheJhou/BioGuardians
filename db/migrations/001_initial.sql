-- @no-transaction
-- ============================================================
-- BioGuardians - Schema inicial consolidado
--
-- Estado final do banco (equivale as antigas migrations 000-024).
-- Totalmente idempotente: pode rodar num banco novo (cria tudo)
-- ou num banco existente (só cria o que estiver faltando).
--
-- NOTA: roda sem transação (-- @no-transaction) porque
-- ALTER TYPE ... ADD VALUE não pode ser usado na mesma
-- transação que cria/consome o enum.
-- ============================================================

-- ---------- Extensões ----------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------- Journal de migrations ----------
CREATE TABLE IF NOT EXISTS schema_migrations (
    id           SERIAL       PRIMARY KEY,
    filename     VARCHAR(255) NOT NULL UNIQUE,
    checksum     VARCHAR(64)  NOT NULL,
    applied_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------- Enums ----------
DO $$ BEGIN
    CREATE TYPE categoria_ameaca_tipo AS ENUM ('CR','EN','VU','NT','LC','DD','NE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE categoria_ameaca_tipo ADD VALUE IF NOT EXISTS 'NE';

DO $$ BEGIN
    CREATE TYPE esfera_tipo AS ENUM ('federal','estadual','municipal','particular');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE categoria_uc_tipo AS ENUM ('protecao_integral','uso_sustentavel');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE rank_taxonomia_tipo AS ENUM ('reino','filo','classe','ordem','familia','genero');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE status_registro_tipo AS ENUM ('ativo','inativo','revisao');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE operacao_auditoria_tipo AS ENUM ('INSERT','UPDATE','DELETE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE fonte_ocorrencia_tipo AS ENUM ('gbif','specieslink','carga_inicial','manual','icmbio');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE fonte_ocorrencia_tipo ADD VALUE IF NOT EXISTS 'deteccao_satelite';
ALTER TYPE fonte_ocorrencia_tipo ADD VALUE IF NOT EXISTS 'camera_trap';
ALTER TYPE fonte_ocorrencia_tipo ADD VALUE IF NOT EXISTS 'deteccao_ia';

DO $$ BEGIN
    CREATE TYPE imagem_status AS ENUM ('pending','processing','detected','classified','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE deteccao_status AS ENUM ('detected','classified','rejected','inconclusive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- Domínios ----------
DO $$ BEGIN
    CREATE DOMAIN nome_cientifico_dom AS VARCHAR(200)
        NOT NULL
        CONSTRAINT nome_cientifico_formato_chk
            CHECK (value = trim(value) AND value = lower(value) AND length(value) >= 4);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE DOMAIN uf_dom AS CHAR(2)
        NOT NULL
        CONSTRAINT uf_formato_chk CHECK (value = upper(value));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- Tabelas de referência ----------
CREATE TABLE IF NOT EXISTS categoria_ameaca (
    codigo           categoria_ameaca_tipo PRIMARY KEY,
    nome             VARCHAR(60)  NOT NULL UNIQUE,
    descricao        TEXT,
    ordem_prioridade SMALLINT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS bioma (
    id        SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome      VARCHAR(40) NOT NULL UNIQUE,
    descricao TEXT,
    CONSTRAINT bioma_nome_chk CHECK (nome = trim(nome))
);

CREATE TABLE IF NOT EXISTS estado (
    uf     uf_dom PRIMARY KEY,
    nome   VARCHAR(60) NOT NULL UNIQUE,
    regiao VARCHAR(20) NOT NULL,
    CONSTRAINT estado_regiao_chk CHECK (
        regiao IN ('Norte','Nordeste','Centro-Oeste','Sudeste','Sul')
    )
);

-- ---------- Taxonomia ----------
CREATE TABLE IF NOT EXISTS taxon (
    id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome      VARCHAR(100) NOT NULL,
    "rank"    rank_taxonomia_tipo NOT NULL,
    parent_id INTEGER,
    UNIQUE (nome, "rank"),
    CONSTRAINT taxon_parent_fk
        FOREIGN KEY (parent_id) REFERENCES taxon(id) ON DELETE RESTRICT
) WITH (fillfactor = 90);

CREATE INDEX IF NOT EXISTS idx_taxon_parent ON taxon(parent_id);
CREATE INDEX IF NOT EXISTS idx_taxon_rank   ON taxon("rank");

-- ---------- Espécie ----------
CREATE TABLE IF NOT EXISTS especie (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome_cientifico nome_cientifico_dom NOT NULL UNIQUE,
    nome_popular    VARCHAR(120),
    categoria_ameaca categoria_ameaca_tipo NOT NULL,
    categoria_fonte VARCHAR(20) NOT NULL DEFAULT 'manual',
    genero_id       INTEGER NOT NULL,
    descricao       TEXT,
    imagem_url      TEXT,
    status          status_registro_tipo NOT NULL DEFAULT 'ativo',
    tsv_busca       tsvector GENERATED ALWAYS AS (
        to_tsvector('portuguese',
            nome_cientifico || ' ' ||
            COALESCE(nome_popular, '') || ' ' ||
            COALESCE(descricao, '')
        )
    ) STORED,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT especie_categoria_fk
        FOREIGN KEY (categoria_ameaca) REFERENCES categoria_ameaca(codigo)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT especie_genero_fk
        FOREIGN KEY (genero_id) REFERENCES taxon(id) ON DELETE RESTRICT,
    CONSTRAINT especie_status_chk CHECK (status IN ('ativo','inativo','revisao'))
);

-- Colunas adicionadas depois (para bancos que já tinham a tabela)
ALTER TABLE especie ADD COLUMN IF NOT EXISTS categoria_fonte VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE especie ADD COLUMN IF NOT EXISTS imagem_url TEXT;
ALTER TABLE especie ADD COLUMN IF NOT EXISTS tsv_busca tsvector
    GENERATED ALWAYS AS (
        to_tsvector('portuguese',
            nome_cientifico || ' ' ||
            COALESCE(nome_popular, '') || ' ' ||
            COALESCE(descricao, '')
        )
    ) STORED;

CREATE TABLE IF NOT EXISTS especie_bioma (
    especie_id INTEGER  NOT NULL,
    bioma_id   SMALLINT NOT NULL,
    PRIMARY KEY (especie_id, bioma_id),
    CONSTRAINT espbio_especie_fk
        FOREIGN KEY (especie_id) REFERENCES especie(id) ON DELETE CASCADE,
    CONSTRAINT espbio_bioma_fk
        FOREIGN KEY (bioma_id) REFERENCES bioma(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS especie_estado (
    especie_id INTEGER NOT NULL,
    estado_uf  uf_dom  NOT NULL,
    PRIMARY KEY (especie_id, estado_uf),
    CONSTRAINT espest_especie_fk
        FOREIGN KEY (especie_id) REFERENCES especie(id) ON DELETE CASCADE,
    CONSTRAINT espest_estado_fk
        FOREIGN KEY (estado_uf) REFERENCES estado(uf) ON DELETE RESTRICT
);

-- ---------- Área protegida ----------
CREATE TABLE IF NOT EXISTS area_protegida (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome          VARCHAR(180) NOT NULL UNIQUE,
    categoria_uc  categoria_uc_tipo NOT NULL,
    esfera        esfera_tipo NOT NULL,
    bioma_id      SMALLINT,
    area_ha       NUMERIC(12,2) CHECK (area_ha > 0),
    geom          geometry(MULTIPOLYGON, 4326) NOT NULL,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT areaprot_bioma_fk
        FOREIGN KEY (bioma_id) REFERENCES bioma(id) ON DELETE SET NULL
);

-- ---------- Ocorrência ----------
CREATE TABLE IF NOT EXISTS ocorrencia (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    especie_id    INTEGER NOT NULL,
    lat           DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon           DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
    geom          geometry(POINT, 4326) NOT NULL,
    data_evento   DATE,
    fonte         fonte_ocorrencia_tipo NOT NULL DEFAULT 'carga_inicial',
    base_registro VARCHAR(120),
    confianca_ia  NUMERIC(5,4),
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ocorr_especie_fk
        FOREIGN KEY (especie_id) REFERENCES especie(id) ON DELETE CASCADE,
    CONSTRAINT ocorr_geom_latlon_chk
        CHECK (ST_X(geom) = lon AND ST_Y(geom) = lat)
);

ALTER TABLE ocorrencia ADD COLUMN IF NOT EXISTS confianca_ia NUMERIC(5,4);

-- ---------- Auditoria ----------
CREATE TABLE IF NOT EXISTS log_auditoria (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tabela           VARCHAR(60) NOT NULL,
    operacao         operacao_auditoria_tipo NOT NULL,
    registro_id      INTEGER NOT NULL,
    usuario          VARCHAR(60) NOT NULL DEFAULT current_user,
    timestamp        TIMESTAMPTZ NOT NULL DEFAULT now(),
    dados_anteriores JSONB,
    dados_novos      JSONB
);

-- ---------- ML: jobs, detecções, checkpoint de imagens ----------
CREATE TABLE IF NOT EXISTS deteccao_job (
    id                   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bbox                 VARCHAR(120),
    data_captura         DATE NOT NULL,
    satelite             VARCHAR(30),
    instrumento          VARCHAR(30),
    produto              VARCHAR(60),
    scene_id             VARCHAR(120),
    imagem_url           TEXT,
    status               VARCHAR(20) NOT NULL DEFAULT 'pendente',
    source               VARCHAR(30) NOT NULL DEFAULT 'satellite',
    data_dir             TEXT,
    project_id           VARCHAR(50),
    p_limit              INTEGER,
    total_imagens        INTEGER NOT NULL DEFAULT 0,
    imagens_processadas  INTEGER NOT NULL DEFAULT 0,
    total_deteccoes      INTEGER NOT NULL DEFAULT 0,
    erro                 TEXT,
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido_em         TIMESTAMPTZ,
    CONSTRAINT deteccao_job_status_chk
        CHECK (status IN ('pendente','processando','concluido','erro'))
);

-- Colunas adicionadas depois
ALTER TABLE deteccao_job ALTER COLUMN bbox        DROP NOT NULL;
ALTER TABLE deteccao_job ALTER COLUMN satelite    DROP NOT NULL;
ALTER TABLE deteccao_job ALTER COLUMN instrumento DROP NOT NULL;
ALTER TABLE deteccao_job ALTER COLUMN produto     DROP NOT NULL;
ALTER TABLE deteccao_job ADD COLUMN IF NOT EXISTS source              VARCHAR(30) NOT NULL DEFAULT 'satellite';
ALTER TABLE deteccao_job ADD COLUMN IF NOT EXISTS data_dir            TEXT;
ALTER TABLE deteccao_job ADD COLUMN IF NOT EXISTS project_id          VARCHAR(50);
ALTER TABLE deteccao_job ADD COLUMN IF NOT EXISTS p_limit             INTEGER;
ALTER TABLE deteccao_job ADD COLUMN IF NOT EXISTS total_imagens       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deteccao_job ADD COLUMN IF NOT EXISTS imagens_processadas INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS imagem_job (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id          INTEGER NOT NULL,
    source          VARCHAR(30) NOT NULL,
    source_image_id VARCHAR(200),
    image_hash      VARCHAR(64),
    path            TEXT,
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    timestamp       TIMESTAMPTZ,
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
    CONSTRAINT imagem_job_unique UNIQUE (source, source_image_id)
);

CREATE TABLE IF NOT EXISTS deteccao (
    id                    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id                INTEGER NOT NULL,
    image_job_id          BIGINT,
    especie_id            INTEGER,
    nome_cientifico       VARCHAR(200),
    confianca             NUMERIC(5,4),
    lat                   DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon                   DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
    bbox_pixel            VARCHAR(80),
    recorte_url           TEXT,
    metodo_classificacao  VARCHAR(20) NOT NULL DEFAULT 'heuristic'
        CHECK (metodo_classificacao IN ('ai','heuristic')),
    modelo_ia             VARCHAR(100),
    confianca_ia          NUMERIC(5,4),
    status                deteccao_status NOT NULL DEFAULT 'detected',
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT deteccao_job_fk
        FOREIGN KEY (job_id) REFERENCES deteccao_job(id) ON DELETE CASCADE,
    CONSTRAINT deteccao_especie_fk
        FOREIGN KEY (especie_id) REFERENCES especie(id) ON DELETE SET NULL,
    CONSTRAINT deteccao_image_job_fk
        FOREIGN KEY (image_job_id) REFERENCES imagem_job(id) ON DELETE SET NULL
);

ALTER TABLE deteccao ADD COLUMN IF NOT EXISTS image_job_id BIGINT REFERENCES imagem_job(id) ON DELETE SET NULL;
ALTER TABLE deteccao ADD COLUMN IF NOT EXISTS metodo_classificacao VARCHAR(20) NOT NULL DEFAULT 'heuristic';
ALTER TABLE deteccao ADD COLUMN IF NOT EXISTS modelo_ia VARCHAR(100);
ALTER TABLE deteccao ADD COLUMN IF NOT EXISTS confianca_ia NUMERIC(5,4);
ALTER TABLE deteccao ADD COLUMN IF NOT EXISTS status deteccao_status NOT NULL DEFAULT 'detected';

CREATE TABLE IF NOT EXISTS modelo_ml (
    id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome      VARCHAR(100) NOT NULL,
    versao    VARCHAR(30)  NOT NULL,
    tipo      VARCHAR(30)  NOT NULL,
    caminho   TEXT         NOT NULL,
    acuracia  NUMERIC(5,4),
    ativo     BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nome, versao),
    CONSTRAINT modelo_ml_tipo_chk CHECK (tipo IN ('deteccao','classificacao'))
);

-- ---------- Cache metadata ----------
CREATE TABLE IF NOT EXISTS cache_metadata (
    chave         VARCHAR(100) PRIMARY KEY,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cache_metadata (chave) VALUES
    ('dashboard'), ('especies'), ('areas'), ('ocorrencias'), ('referencias')
ON CONFLICT DO NOTHING;

-- ---------- Índices ----------
CREATE INDEX IF NOT EXISTS idx_log_tabela_ts ON log_auditoria(tabela, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_area_protegida_geom      ON area_protegida USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_ocorrencia_geom          ON ocorrencia USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_ocorrencia_geom_validos  ON ocorrencia USING GIST (geom) WHERE geom IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_especie_categoria        ON especie(categoria_ameaca);
CREATE INDEX IF NOT EXISTS idx_especie_status           ON especie(status);
CREATE INDEX IF NOT EXISTS idx_especie_nome_popular     ON especie(nome_popular);
CREATE INDEX IF NOT EXISTS idx_especie_busca_fts        ON especie USING GIN (tsv_busca);
CREATE INDEX IF NOT EXISTS idx_especie_cat_status       ON especie(categoria_ameaca, status);
CREATE INDEX IF NOT EXISTS idx_especie_imagem_url       ON especie(id) WHERE imagem_url IS NULL;
CREATE INDEX IF NOT EXISTS idx_area_protegida_esfera    ON area_protegida(esfera);
CREATE INDEX IF NOT EXISTS idx_area_protegida_categoria ON area_protegida(categoria_uc);
CREATE INDEX IF NOT EXISTS idx_area_protegida_bioma     ON area_protegida(bioma_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencia_especie       ON ocorrencia(especie_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencia_fonte         ON ocorrencia(fonte);
CREATE INDEX IF NOT EXISTS idx_ocorrencia_data          ON ocorrencia(data_evento);
CREATE INDEX IF NOT EXISTS idx_ocorrencia_especie_data  ON ocorrencia(especie_id, data_evento DESC);
CREATE INDEX IF NOT EXISTS idx_deteccao_job             ON deteccao(job_id);
CREATE INDEX IF NOT EXISTS idx_deteccao_job_status      ON deteccao_job(status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_deteccao_job_source      ON deteccao_job(source, status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_deteccao_especie         ON deteccao(especie_id) WHERE especie_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deteccao_metodo          ON deteccao(metodo_classificacao);
CREATE INDEX IF NOT EXISTS idx_deteccao_status          ON deteccao(status);
CREATE INDEX IF NOT EXISTS idx_deteccao_image_job       ON deteccao(image_job_id) WHERE image_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imagem_job_status        ON imagem_job(status);
CREATE INDEX IF NOT EXISTS idx_imagem_job_hash          ON imagem_job(image_hash) WHERE image_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imagem_job_job           ON imagem_job(job_id);

-- ---------- Funções de domínio ----------
CREATE OR REPLACE FUNCTION especies_em_area(p_area_id INTEGER)
    RETURNS TABLE (
        especie_id      INTEGER,
        nome_cientifico nome_cientifico_dom,
        nome_popular    VARCHAR,
        categoria       categoria_ameaca_tipo
    )
    LANGUAGE sql STABLE AS $$
        SELECT DISTINCT e.id, e.nome_cientifico, e.nome_popular, e.categoria_ameaca
        FROM ocorrencia o
        JOIN especie e        ON e.id = o.especie_id
        JOIN area_protegida a ON a.id = p_area_id
        WHERE ST_Contains(a.geom, o.geom)
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
        FROM area_protegida a
        JOIN ocorrencia o ON ST_Contains(a.geom, o.geom)
        WHERE o.especie_id = p_especie_id;
    $$;

CREATE OR REPLACE FUNCTION contar_ocorrencias_em_area(p_area_id INTEGER)
    RETURNS BIGINT
    LANGUAGE sql STABLE AS $$
        SELECT count(*)::BIGINT
        FROM ocorrencia o
        JOIN area_protegida a ON a.id = p_area_id
        WHERE ST_Contains(a.geom, o.geom);
    $$;

CREATE OR REPLACE FUNCTION buscar_especies(p_busca TEXT)
    RETURNS TABLE (
        especie_id      INTEGER,
        nome_cientifico nome_cientifico_dom,
        nome_popular    VARCHAR,
        categoria       categoria_ameaca_tipo,
        relevancia      REAL
    )
    LANGUAGE sql STABLE AS $$
        SELECT e.id, e.nome_cientifico, e.nome_popular, e.categoria_ameaca,
               ts_rank(e.tsv_busca, plainto_tsquery('portuguese', p_busca)) AS relevancia
        FROM especie e
        WHERE e.tsv_busca @@ plainto_tsquery('portuguese', p_busca)
          AND e.status = 'ativo'
        ORDER BY relevancia DESC;
    $$;

CREATE OR REPLACE FUNCTION refresh_dashboard()
    RETURNS VOID LANGUAGE plpgsql AS $$
    BEGIN
        REFRESH MATERIALIZED VIEW dashboard_stats;
        REFRESH MATERIALIZED VIEW especies_por_uc;
        REFRESH MATERIALIZED VIEW ranking_especies_categoria;
        REFRESH MATERIALIZED VIEW ucs_por_esfera;
    END;
    $$;

-- ---------- Funções de trigger ----------
CREATE OR REPLACE FUNCTION trg_ocorrencia_sincroniza_geom()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
    RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION trg_area_valida_geom()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT ST_IsValid(NEW.geom) THEN
        RAISE EXCEPTION 'Geometria invalida para a area protegida %', NEW.nome;
    END IF;
    IF ST_IsEmpty(NEW.geom) THEN
        RAISE EXCEPTION 'Geometria vazia nao e permitida para %', NEW.nome;
    END IF;
    RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION trg_atualiza_timestamp()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION trg_auditar()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_op  operacao_auditoria_tipo;
    v_id  INTEGER;
    v_old JSONB;
    v_new JSONB;
BEGIN
    v_op := TG_OP::operacao_auditoria_tipo;
    IF v_op = 'DELETE' THEN
        v_id := OLD.id;  v_old := to_jsonb(OLD); v_new := NULL;
    ELSIF v_op = 'UPDATE' THEN
        v_id := NEW.id;  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    ELSE
        v_id := NEW.id;  v_old := NULL;          v_new := to_jsonb(NEW);
    END IF;
    INSERT INTO log_auditoria (tabela, operacao, registro_id, dados_anteriores, dados_novos)
    VALUES (TG_TABLE_NAME, v_op, v_id, v_old, v_new);
    RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION trg_invalida_cache()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'especie' THEN
        UPDATE cache_metadata SET atualizado_em = now() WHERE chave IN ('especies','dashboard');
    ELSIF TG_TABLE_NAME = 'area_protegida' THEN
        UPDATE cache_metadata SET atualizado_em = now() WHERE chave IN ('areas','dashboard');
    ELSIF TG_TABLE_NAME = 'ocorrencia' THEN
        UPDATE cache_metadata SET atualizado_em = now() WHERE chave IN ('ocorrencias','dashboard');
    END IF;
    RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION set_imagem_job_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END; $$;

-- ---------- Triggers (DROP + CREATE = idempotente) ----------
DROP TRIGGER IF EXISTS trg_ocorrencia_geom ON ocorrencia;
CREATE TRIGGER trg_ocorrencia_geom
    BEFORE INSERT OR UPDATE OF lat, lon ON ocorrencia
    FOR EACH ROW EXECUTE FUNCTION trg_ocorrencia_sincroniza_geom();

DROP TRIGGER IF EXISTS trg_area_protegida_geom ON area_protegida;
CREATE TRIGGER trg_area_protegida_geom
    BEFORE INSERT OR UPDATE OF geom ON area_protegida
    FOR EACH ROW EXECUTE FUNCTION trg_area_valida_geom();

DROP TRIGGER IF EXISTS trg_especie_ts ON especie;
CREATE TRIGGER trg_especie_ts
    BEFORE UPDATE ON especie
    FOR EACH ROW EXECUTE FUNCTION trg_atualiza_timestamp();

DROP TRIGGER IF EXISTS trg_area_protegida_ts ON area_protegida;
CREATE TRIGGER trg_area_protegida_ts
    BEFORE UPDATE ON area_protegida
    FOR EACH ROW EXECUTE FUNCTION trg_atualiza_timestamp();

DROP TRIGGER IF EXISTS trg_especie_audit ON especie;
CREATE TRIGGER trg_especie_audit
    AFTER INSERT OR UPDATE OR DELETE ON especie
    FOR EACH ROW EXECUTE FUNCTION trg_auditar();

DROP TRIGGER IF EXISTS trg_area_protegida_audit ON area_protegida;
CREATE TRIGGER trg_area_protegida_audit
    AFTER INSERT OR UPDATE OR DELETE ON area_protegida
    FOR EACH ROW EXECUTE FUNCTION trg_auditar();

DROP TRIGGER IF EXISTS trg_cache_especie ON especie;
CREATE TRIGGER trg_cache_especie
    AFTER INSERT OR UPDATE OR DELETE ON especie
    FOR EACH ROW EXECUTE FUNCTION trg_invalida_cache();

DROP TRIGGER IF EXISTS trg_cache_area_protegida ON area_protegida;
CREATE TRIGGER trg_cache_area_protegida
    AFTER INSERT OR UPDATE OR DELETE ON area_protegida
    FOR EACH ROW EXECUTE FUNCTION trg_invalida_cache();

DROP TRIGGER IF EXISTS trg_cache_ocorrencia ON ocorrencia;
CREATE TRIGGER trg_cache_ocorrencia
    AFTER INSERT OR UPDATE OR DELETE ON ocorrencia
    FOR EACH ROW EXECUTE FUNCTION trg_invalida_cache();

DROP TRIGGER IF EXISTS trg_imagem_job_updated_at ON imagem_job;
CREATE TRIGGER trg_imagem_job_updated_at
    BEFORE UPDATE ON imagem_job
    FOR EACH ROW EXECUTE FUNCTION set_imagem_job_updated_at();

-- ---------- Views materializadas (sempre recriadas com a definição final) ----------
DROP MATERIALIZED VIEW IF EXISTS dashboard_stats;
CREATE MATERIALIZED VIEW dashboard_stats AS
SELECT
    1 AS id,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo')                              AS total_especies,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'CR')  AS total_cr,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'EN')  AS total_en,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'VU')  AS total_vu,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'NT')  AS total_nt,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'LC')  AS total_lc,
    (SELECT COUNT(*) FROM especie WHERE status = 'ativo' AND categoria_ameaca = 'DD')  AS total_dd,
    (SELECT COUNT(*) FROM area_protegida)                                              AS total_areas,
    (SELECT COALESCE(SUM(area_ha), 0) FROM area_protegida)                             AS area_total_ha,
    (SELECT COUNT(*) FROM ocorrencia o
      JOIN especie e ON e.id = o.especie_id
     WHERE e.status = 'ativo')                                                         AS total_ocorrencias;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_stats_unico ON dashboard_stats(id);

DROP MATERIALIZED VIEW IF EXISTS especies_por_uc;
CREATE MATERIALIZED VIEW especies_por_uc AS
SELECT DISTINCT
    a.id          AS area_id,
    a.nome        AS area_nome,
    e.id          AS especie_id,
    e.nome_cientifico,
    e.categoria_ameaca
FROM area_protegida a
JOIN ocorrencia o ON ST_Contains(a.geom, o.geom)
JOIN especie    e ON e.id = o.especie_id
WHERE e.categoria_ameaca IN ('CR','EN','VU');

CREATE UNIQUE INDEX IF NOT EXISTS idx_especies_por_uc_pk ON especies_por_uc(area_id, especie_id);

DROP MATERIALIZED VIEW IF EXISTS ranking_especies_categoria;
CREATE MATERIALIZED VIEW ranking_especies_categoria AS
SELECT categoria_ameaca, count(*) AS total
FROM especie
WHERE status = 'ativo'
GROUP BY categoria_ameaca
ORDER BY (
    CASE categoria_ameaca
        WHEN 'CR' THEN 1 WHEN 'EN' THEN 2 WHEN 'VU' THEN 3
        WHEN 'NT' THEN 4 WHEN 'LC' THEN 5 WHEN 'DD' THEN 6 WHEN 'NE' THEN 7
    END
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_categoria ON ranking_especies_categoria(categoria_ameaca);

DROP MATERIALIZED VIEW IF EXISTS ucs_por_esfera;
CREATE MATERIALIZED VIEW ucs_por_esfera AS
SELECT esfera, count(*) AS total, sum(area_ha) AS area_ha
FROM area_protegida
GROUP BY esfera
ORDER BY total DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ucs_por_esfera ON ucs_por_esfera(esfera);

-- ---------- Dados de referência (rótulos em português claro) ----------
INSERT INTO categoria_ameaca (codigo, nome, descricao, ordem_prioridade) VALUES
    ('CR', 'Criticamente em Perigo',           'Risco altíssimo de extinção na natureza.',          1),
    ('EN', 'Entrando em Extinção',             'População entrando em processo de extinção.',        2),
    ('VU', 'Alto Risco de Entrar em Extinção', 'Alto risco de entrar em extinção na natureza.',      3),
    ('NT', 'Em Ameaça',                        'Espécie sob ameaça, próxima de risco elevado.',      4),
    ('LC', 'Sem Risco',                        'Ampla distribuição, população estável.',             5),
    ('DD', 'Sem Dados para Avaliar',           'Informação insuficiente para avaliar o risco.',      6),
    ('NE', 'Não Avaliada',                     'Espécie não avaliada para risco de extinção.',       7)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO bioma (id, nome, descricao) OVERRIDING SYSTEM VALUE VALUES
    (1, 'Amazônia',      'Maior floresta tropical do mundo.'),
    (2, 'Mata Atlântica','Floresta tropical costeira, altamente fragmentada.'),
    (3, 'Cerrado',       'Savana tropical, hotspot de biodiversidade.'),
    (4, 'Caatinga',      'Vegetação semiárida exclusiva do Brasil.'),
    (5, 'Pampa',         'Campos subtropicais do sul.'),
    (6, 'Pantanal',      'Maior planície alagável do mundo.'),
    (7, 'Marinho',       'Ambientes marinhos brasileiros.')
ON CONFLICT DO NOTHING;

INSERT INTO estado (uf, nome, regiao) VALUES
    ('AC','Acre','Norte'),('AP','Amapá','Norte'),('AM','Amazonas','Norte'),
    ('PA','Pará','Norte'),('RO','Rondônia','Norte'),('RR','Roraima','Norte'),
    ('TO','Tocantins','Norte'),
    ('AL','Alagoas','Nordeste'),('BA','Bahia','Nordeste'),('CE','Ceará','Nordeste'),
    ('MA','Maranhão','Nordeste'),('PB','Paraíba','Nordeste'),('PE','Pernambuco','Nordeste'),
    ('PI','Piauí','Nordeste'),('RN','Rio Grande do Norte','Nordeste'),('SE','Sergipe','Nordeste'),
    ('DF','Distrito Federal','Centro-Oeste'),('GO','Goiás','Centro-Oeste'),
    ('MT','Mato Grosso','Centro-Oeste'),('MS','Mato Grosso do Sul','Centro-Oeste'),
    ('ES','Espírito Santo','Sudeste'),('MG','Minas Gerais','Sudeste'),
    ('RJ','Rio de Janeiro','Sudeste'),('SP','São Paulo','Sudeste'),
    ('PR','Paraná','Sul'),('RS','Rio Grande do Sul','Sul'),('SC','Santa Catarina','Sul')
ON CONFLICT DO NOTHING;

-- ---------- Configurações de performance (só aplica se diferente) ----------
DO $$
DECLARE
  db_name text := current_database();
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('max_parallel_workers_per_gather', '2'),
      ('parallel_setup_cost',             '100'),
      ('parallel_tuple_cost',             '0.03'),
      ('min_parallel_table_scan_size',    '8MB'),
      ('min_parallel_index_scan_size',    '512kB'),
      ('effective_cache_size',            '1GB'),
      ('work_mem',                        '8MB'),
      ('maintenance_work_mem',            '128MB'),
      ('random_page_cost',                '1.1'),
      ('seq_page_cost',                   '1.0')
    ) AS t(name, value)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_settings WHERE name = rec.name)
       AND (SELECT setting FROM pg_settings WHERE name = rec.name) <> rec.value
    THEN
      EXECUTE format('ALTER DATABASE %I SET %I = %L', db_name, rec.name, rec.value);
    END IF;
  END LOOP;
END $$;

-- ---------- Final ----------
SELECT refresh_dashboard();
ANALYZE especie;
ANALYZE ocorrencia;
ANALYZE area_protegida;
ANALYZE taxon;
ANALYZE deteccao;
ANALYZE deteccao_job;
ANALYZE imagem_job;
