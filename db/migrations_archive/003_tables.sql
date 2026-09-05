-- ============================================================
-- BioGuardians - 03 Tabelas
-- Modelagem em 3FN: tabelas de referência, transacionais e
-- associativas (N:N). Geometrias com PostGIS (SRID 4326).
-- ============================================================

-- ---------- Tabelas de referência ----------

-- Categoria de ameaça (tabela de referência com descrição).
CREATE TABLE categoria_ameaca (
    codigo          categoria_ameaca_tipo PRIMARY KEY,
    nome            VARCHAR(60)  NOT NULL UNIQUE,
    descricao       TEXT,
    ordem_prioridade SMALLINT NOT NULL UNIQUE  -- 1 = mais crítico
);

-- Biomas brasileiros (fixo, 7 terrestres + marinho).
CREATE TABLE bioma (
    id          SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome        VARCHAR(40) NOT NULL UNIQUE,
    descricao   TEXT,
    CONSTRAINT bioma_nome_chk CHECK (nome = trim(nome))
);

-- Estados (27 UFs).
CREATE TABLE estado (
    uf          uf_dom PRIMARY KEY,
    nome        VARCHAR(60) NOT NULL UNIQUE,
    regiao      VARCHAR(20) NOT NULL,
    CONSTRAINT estado_regiao_chk CHECK (
        regiao IN ('Norte','Nordeste','Centro-Oeste','Sudeste','Sul')
    )
);

-- Taxonomia hierárquica (reino -> genero) com auto-referência.
CREATE TABLE taxon (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome        VARCHAR(100) NOT NULL,
    "rank"      rank_taxonomia_tipo NOT NULL,
    parent_id   INTEGER,
    UNIQUE (nome, "rank"),
    CONSTRAINT taxon_parent_fk
        FOREIGN KEY (parent_id) REFERENCES taxon(id)
        ON DELETE RESTRICT
) WITH (fillfactor = 90);

CREATE INDEX idx_taxon_parent ON taxon(parent_id);
CREATE INDEX idx_taxon_rank   ON taxon("rank");

-- ---------- Tabela central: espécie ----------

CREATE TABLE especie (
    id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome_cientifico     nome_cientifico_dom NOT NULL UNIQUE,
    nome_popular        VARCHAR(120),
    categoria_ameaca    categoria_ameaca_tipo NOT NULL,
    genero_id           INTEGER NOT NULL,
    descricao           TEXT,
    status              status_registro_tipo NOT NULL DEFAULT 'ativo',
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT especie_categoria_fk
        FOREIGN KEY (categoria_ameaca) REFERENCES categoria_ameaca(codigo)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT especie_genero_fk
        FOREIGN KEY (genero_id) REFERENCES taxon(id)
        ON DELETE RESTRICT,
    CONSTRAINT especie_status_chk
        CHECK (status IN ('ativo','inativo','revisao'))
);

-- ---------- Associações N:N da espécie ----------

CREATE TABLE especie_bioma (
    especie_id  INTEGER NOT NULL,
    bioma_id    SMALLINT NOT NULL,
    PRIMARY KEY (especie_id, bioma_id),
    CONSTRAINT espbio_especie_fk
        FOREIGN KEY (especie_id) REFERENCES especie(id) ON DELETE CASCADE,
    CONSTRAINT espbio_bioma_fk
        FOREIGN KEY (bioma_id) REFERENCES bioma(id) ON DELETE RESTRICT
);

CREATE TABLE especie_estado (
    especie_id  INTEGER NOT NULL,
    estado_uf   uf_dom NOT NULL,
    PRIMARY KEY (especie_id, estado_uf),
    CONSTRAINT espest_especie_fk
        FOREIGN KEY (especie_id) REFERENCES especie(id) ON DELETE CASCADE,
    CONSTRAINT espest_estado_fk
        FOREIGN KEY (estado_uf) REFERENCES estado(uf) ON DELETE RESTRICT
);

-- ---------- Área protegida (UC) com geometria ----------

CREATE TABLE area_protegida (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome            VARCHAR(180) NOT NULL UNIQUE,
    categoria_uc    categoria_uc_tipo NOT NULL,
    esfera          esfera_tipo NOT NULL,
    bioma_id        SMALLINT,
    area_ha         NUMERIC(12,2) CHECK (area_ha > 0),
    geom            geometry(MULTIPOLYGON, 4326) NOT NULL,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT areaprot_bioma_fk
        FOREIGN KEY (bioma_id) REFERENCES bioma(id) ON DELETE SET NULL
);

-- ---------- Ocorrência (ponto georreferenciado) ----------

CREATE TABLE ocorrencia (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    especie_id      INTEGER NOT NULL,
    lat             DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon             DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
    geom            geometry(POINT, 4326) NOT NULL,
    data_evento     DATE,
    fonte           fonte_ocorrencia_tipo NOT NULL DEFAULT 'carga_inicial',
    base_registro   VARCHAR(120),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ocorr_especie_fk
        FOREIGN KEY (especie_id) REFERENCES especie(id) ON DELETE CASCADE,
    CONSTRAINT ocorr_geom_latlon_chk
        CHECK (ST_X(geom) = lon AND ST_Y(geom) = lat)
);

-- ---------- Auditoria ----------

CREATE TABLE log_auditoria (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tabela          VARCHAR(60) NOT NULL,
    operacao        operacao_auditoria_tipo NOT NULL,
    registro_id     INTEGER NOT NULL,
    usuario         VARCHAR(60) NOT NULL DEFAULT current_user,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
    dados_anteriores JSONB,
    dados_novos     JSONB
);

CREATE INDEX idx_log_tabela_ts ON log_auditoria(tabela, timestamp DESC);
