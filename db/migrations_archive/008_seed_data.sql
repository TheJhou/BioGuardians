-- ============================================================
-- BioGuardians - 08 Reference Data (Seed)
--
-- Inserts ONLY official reference data:
-- - categoria_ameaca (IUCN/MMA categories)
-- - bioma (7 Brazilian biomes)
-- - estado (27 Brazilian UFs)
--
-- Mock species, taxonomy, protected areas, and occurrences
-- were removed. Use the data loading scripts in scripts/data/
-- to populate with real data from MMA, CNUC, GBIF, speciesLink.
-- ============================================================

-- ---------- Categorias de ameaça (IUCN/MMA) ----------
INSERT INTO categoria_ameaca (codigo, nome, descricao, ordem_prioridade) VALUES
    ('CR', 'Criticamente em Perigo', 'Risco altíssimo de extinção na natureza.', 1),
    ('EN', 'Em Perigo',             'Risco muito alto de extinção na natureza.', 2),
    ('VU', 'Vulnerável',            'Risco alto de extinção na natureza.',       3),
    ('NT', 'Quase Ameaçada',        'Próxima de qualificar como ameaçada.',      4),
    ('LC', 'Menos Preocupante',     'Ampla distribuição, população estável.',   5),
    ('DD', 'Dados Insuficientes',   'Informação inadequada para avaliação.',    6);

-- ---------- Biomas brasileiros ----------
INSERT INTO bioma (id, nome, descricao) OVERRIDING SYSTEM VALUE VALUES
    (1, 'Amazônia',     'Maior floresta tropical do mundo.' ),
    (2, 'Mata Atlântica','Floresta tropical costeira, altamente fragmentada.'),
    (3, 'Cerrado',      'Savana tropical, hotspot de biodiversidade.'),
    (4, 'Caatinga',     'Vegetação semiárida exclusiva do Brasil.'),
    (5, 'Pampa',        'Campos subtropicais do sul.'),
    (6, 'Pantanal',     'Maior planície alagável do mundo.'),
    (7, 'Marinho',      'Ambientes marinhos brasileiros.');

-- ---------- Estados (27 UFs) ----------
INSERT INTO estado (uf, nome, regiao) VALUES
    ('AC','Acre','Norte'),('AP','Amapá','Norte'),('AM','Amazonas','Norte'),
    ('PA','Pará','Norte'),('RO','Rondônia','Norte'),('RR','Roraima','Norte'),
    ('TO','Tocantins','Norte'),
    ('AL','Alagoas','Nordeste'),('BA','Bahia','Nordeste'),('CE','Ceará','Nordeste'),
    ('MA','Maranhão','Nordeste'),('PB','Paraíba','Nordeste'),
    ('PE','Pernambuco','Nordeste'),('PI','Piauí','Nordeste'),
    ('RN','Rio Grande do Norte','Nordeste'),('SE','Sergipe','Nordeste'),
    ('DF','Distrito Federal','Centro-Oeste'),('GO','Goiás','Centro-Oeste'),
    ('MT','Mato Grosso','Centro-Oeste'),('MS','Mato Grosso do Sul','Centro-Oeste'),
    ('ES','Espírito Santo','Sudeste'),('MG','Minas Gerais','Sudeste'),
    ('RJ','Rio de Janeiro','Sudeste'),('SP','São Paulo','Sudeste'),
    ('PR','Paraná','Sul'),('RS','Rio Grande do Sul','Sul'),('SC','Santa Catarina','Sul');

-- ---------- Refresh dashboard views ----------
SELECT refresh_dashboard();
