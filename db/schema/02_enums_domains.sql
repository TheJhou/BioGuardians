-- ============================================================
-- BioGuardians - 02 Enums e Domínios
-- Tipos enumerados usados em constraints de integridade.
-- ============================================================

-- Categoria de ameaça (padrão IUCN/MMA).
-- CR = Critically Endangered, EN = Endangered, VU = Vulnerable,
-- NT = Near Threatened, LC = Least Concern, DD = Data Deficient.
CREATE TYPE categoria_ameaca_tipo AS ENUM ('CR', 'EN', 'VU', 'NT', 'LC', 'DD');

-- Esfera administrativa da Unidade de Conservação.
CREATE TYPE esfera_tipo AS ENUM ('federal', 'estadual', 'municipal', 'particular');

-- Categoria da UC (SNUC): proteção integral ou uso sustentável.
CREATE TYPE categoria_uc_tipo AS ENUM (
    'protecao_integral',
    'uso_sustentavel'
);

-- Risco taxonômico (hierarquia Linneana).
CREATE TYPE rank_taxonomia_tipo AS ENUM (
    'reino', 'filo', 'classe', 'ordem', 'familia', 'genero'
);

-- Status do registro da espécie no sistema.
CREATE TYPE status_registro_tipo AS ENUM ('ativo', 'inativo', 'revisao');

-- Operação registrada na auditoria.
CREATE TYPE operacao_auditoria_tipo AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- Fonte da ocorrência.
CREATE TYPE fonte_ocorrencia_tipo AS ENUM (
    'gbif', 'specieslink', 'carga_inicial', 'manual', 'icmbio'
);

-- Domínio: nome científico sempre em minúsculas e sem espaços nas pontas.
CREATE DOMAIN nome_cientifico_dom AS VARCHAR(200)
    NOT NULL
    CONSTRAINT nome_cientifico_formato_chk
        CHECK (value = trim(value) AND value = lower(value) AND length(value) >= 4);

-- Domínio: UF sempre em 2 letras maiúsculas.
CREATE DOMAIN uf_dom AS CHAR(2)
    NOT NULL
    CONSTRAINT uf_formato_chk CHECK (value = upper(value));
