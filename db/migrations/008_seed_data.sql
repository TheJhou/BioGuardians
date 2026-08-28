-- ============================================================
-- BioGuardians - Seed (dados sintéticos realistas)
-- Espécies ameaçadas reais (fauna brasileira), UCs reais com
-- polígonos simplificados (retângulos ~0.1°) e ocorrências
-- dentro das UCs para demonstrar ST_Contains.
-- ============================================================

-- ---------- Categorias de ameaça ----------
INSERT INTO categoria_ameaca (codigo, nome, descricao, ordem_prioridade) VALUES
    ('CR', 'Criticamente em Perigo', 'Risco altíssimo de extinção na natureza.', 1),
    ('EN', 'Em Perigo',             'Risco muito alto de extinção na natureza.', 2),
    ('VU', 'Vulnerável',            'Risco alto de extinção na natureza.',       3),
    ('NT', 'Quase Ameaçada',        'Próxima de qualificar como ameaçada.',      4),
    ('LC', 'Menos Preocupante',     'Ampla distribuição, população estável.',   5),
    ('DD', 'Dados Insuficientes',   'Informação inadequada para avaliação.',    6);

-- ---------- Biomas ----------
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

-- ---------- Taxonomia (hierárquica) ----------
-- Reino
INSERT INTO taxon (nome, "rank", parent_id) VALUES ('animalia','reino', NULL);
-- Filos
INSERT INTO taxon (nome, "rank", parent_id)
    SELECT 'chordata','filo', id FROM taxon WHERE nome='animalia' AND "rank"='reino';
-- Classes
INSERT INTO taxon (nome, "rank", parent_id)
    SELECT v.cls,'classe', t.id
    FROM (VALUES ('mammalia'),('aves')) AS v(cls)
    JOIN taxon t ON t.nome='chordata' AND t."rank"='filo';
-- Ordens
INSERT INTO taxon (nome, "rank", parent_id)
    SELECT v.ordem,'ordem', t.id
    FROM (VALUES
        ('mammalia','carnivora'),
        ('mammalia','primates'),
        ('mammalia','pilosa'),
        ('mammalia','cetartiodactyla'),
        ('aves','psittaciformes')
    ) AS v(cls, ordem)
    JOIN taxon t ON t.nome = v.cls AND t."rank"='classe';
-- Famílias
INSERT INTO taxon (nome, "rank", parent_id)
    SELECT v.familia,'familia', t.id
    FROM (VALUES
        ('carnivora','felidae'),
        ('carnivora','canidae'),
        ('carnivora','mustelidae'),
        ('primates','atelidae'),
        ('pilosa','myrmecophagidae'),
        ('cetartiodactyla','tapiridae'),
        ('cetartiodactyla','tayassuidae'),
        ('psittaciformes','psittacidae')
    ) AS v(ordem, familia)
    JOIN taxon t ON t.nome = v.ordem AND t."rank"='ordem';
-- Gêneros
INSERT INTO taxon (nome, "rank", parent_id)
    SELECT v.genero,'genero', t.id
    FROM (VALUES
        ('felidae','panthera'),
        ('felidae','leopardus'),
        ('canidae','chrysocyon'),
        ('canidae','speothos'),
        ('mustelidae','pteronura'),
        ('atelidae','brachyteles'),
        ('atelidae','alouatta'),
        ('myrmecophagidae','myrmecophaga'),
        ('tapiridae','tapirus'),
        ('tayassuidae','tayassu'),
        ('psittacidae','amazona'),
        ('psittacidae','pyrrhura')
    ) AS v(familia, genero)
    JOIN taxon t ON t.nome = v.familia AND t."rank"='familia';

-- ---------- Espécies ----------
INSERT INTO especie (nome_cientifico, nome_popular, categoria_ameaca, genero_id, descricao)
SELECT v.nc, v.np, v.cat::categoria_ameaca_tipo, g.id, v.descricao
FROM (VALUES
    ('panthera onca',         'onça-pintada',     'VU',
     'panthera', 'Maior felino das Américas; ameaçado por perda de habitat e caça.'),
    ('leopardus tigrinus',    'gato-do-mato',     'VU',
     'leopardus', 'Pequeno felino de florestas; vulnerável à fragmentação.'),
    ('leopardus wiedii',      'gato-maracajá',    'VU',
     'leopardus', 'Felino arborícola dependente de floresta contínua.'),
    ('pteronura brasiliensis','ariranha',         'EN',
     'pteronura', 'Lontra gigante social; declínio por caça e degradação de rios.'),
    ('speothos venaticus',    'cachorro-vinagre', 'VU',
     'speothos', 'Canídeo raro de matas de galeria; pouco estudado.'),
    ('chrysocyon brachyurus', 'lobo-guará',       'NT',
     'chrysocyon', 'Maior canídeo sul-americano; típico do Cerrado.'),
    ('brachyteles arachnoides','muriqui-do-sul',  'EN',
     'brachyteles', 'Maior primata das Américas; endêmico da Mata Atlântica.'),
    ('alouatta guariba',      'bugio-ruivo',      'VU',
     'alouatta', 'Primata vocalizador; ameaçado por desmatamento.'),
    ('myrmecophaga tridactyla','tamanduá-bandeira','VU',
     'myrmecophaga', 'Comedor de formigas; vítima de queimadas e atropelamentos.'),
    ('tapirus terrestris',    'anta',             'VU',
     'tapirus', 'Maior mamífero terrestre do Brasil; pressão por caça e habitat.'),
    ('tayassu pecari',        'queixada',         'VU',
     'tayassu', 'Porco-do-mato em manadas; declínio por desmatamento e caça.'),
    ('amazona brasiliensis',  'papagaio-de-cara-roxa','VU',
     'amazona', 'Psitacídeo endêmico da Mata Atlântica; tráfico de animais.'),
    ('pyrrhura cruentata',    'tiriba-grande',    'VU',
     'pyrrhura', 'Periquito da Mata Atlântica; restrito a remanescentes.')
) AS v(nc, np, cat, genero, descricao)
JOIN taxon g ON g.nome = v.genero AND g."rank" = 'genero';

-- ---------- Espécie <-> Bioma ----------
INSERT INTO especie_bioma (especie_id, bioma_id)
SELECT e.id, b.id
FROM especie e
JOIN (VALUES
    ('panthera onca',          ARRAY[1,2,3,6]::SMALLINT[]),
    ('leopardus tigrinus',     ARRAY[1,2,3]::SMALLINT[]),
    ('leopardus wiedii',       ARRAY[1,2,3,6]::SMALLINT[]),
    ('pteronura brasiliensis', ARRAY[1,2,3,6]::SMALLINT[]),
    ('speothos venaticus',     ARRAY[1,2,3]::SMALLINT[]),
    ('chrysocyon brachyurus',  ARRAY[3,4,5]::SMALLINT[]),
    ('brachyteles arachnoides',ARRAY[2]::SMALLINT[]),
    ('alouatta guariba',       ARRAY[2,3]::SMALLINT[]),
    ('myrmecophaga tridactyla',ARRAY[1,2,3,4]::SMALLINT[]),
    ('tapirus terrestris',     ARRAY[1,2,3,4,6]::SMALLINT[]),
    ('tayassu pecari',         ARRAY[1,2,3,6]::SMALLINT[]),
    ('amazona brasiliensis',   ARRAY[2]::SMALLINT[]),
    ('pyrrhura cruentata',     ARRAY[2]::SMALLINT[])
) AS v(nc, biomas)
ON e.nome_cientifico = v.nc
JOIN bioma b ON b.id = ANY(v.biomas);

-- ---------- Espécie <-> Estado (amostra) ----------
INSERT INTO especie_estado (especie_id, estado_uf)
SELECT e.id, s.uf
FROM especie e
JOIN (VALUES
    ('panthera onca',          ARRAY['AM','PA','MT','MS','GO','RJ','SP']::CHAR(2)[]),
    ('leopardus tigrinus',     ARRAY['AM','BA','ES','RJ','SP','PR']::CHAR(2)[]),
    ('leopardus wiedii',       ARRAY['AM','BA','ES','RJ','SP']::CHAR(2)[]),
    ('pteronura brasiliensis', ARRAY['AM','PA','MT','MS']::CHAR(2)[]),
    ('speothos venaticus',     ARRAY['AM','PA','MT','GO','MG']::CHAR(2)[]),
    ('chrysocyon brachyurus',  ARRAY['GO','MT','MS','MG','SP','PR']::CHAR(2)[]),
    ('brachyteles arachnoides',ARRAY['SP','RJ','ES','MG']::CHAR(2)[]),
    ('alouatta guariba',       ARRAY['BA','ES','MG','RJ','SP','PR','SC']::CHAR(2)[]),
    ('myrmecophaga tridactyla',ARRAY['GO','MT','MS','MG','BA','SP']::CHAR(2)[]),
    ('tapirus terrestris',     ARRAY['AM','PA','MT','MS','GO']::CHAR(2)[]),
    ('tayassu pecari',         ARRAY['AM','PA','MT','MS','GO']::CHAR(2)[]),
    ('amazona brasiliensis',   ARRAY['PR','SP']::CHAR(2)[]),
    ('pyrrhura cruentata',     ARRAY['BA','ES','RJ','MG']::CHAR(2)[])
) AS v(nc, ufs)
ON e.nome_cientifico = v.nc
JOIN estado s ON s.uf = ANY(v.ufs);

-- ---------- Áreas protegidas (polígonos simplificados) ----------
-- Cada UC é um retângulo ~0.1° em torno de coordenadas reais.
INSERT INTO area_protegida (nome, categoria_uc, esfera, bioma_id, area_ha, geom)
SELECT v.nome, v.cat::categoria_uc_tipo, v.esfera::esfera_tipo, v.bioma, v.area_ha,
       ST_Multi(ST_SetSRID(
           ST_MakeEnvelope(v.lon - 0.05, v.lat - 0.05, v.lon + 0.05, v.lat + 0.05),
           4326))
FROM (VALUES
    ('Parque Nacional do Iguaçu',         'protecao_integral','federal',  2, 169895.0, -25.66, -54.44),
    ('Parque Nacional da Serra dos Órgãos','protecao_integral','federal',  2,  20000.0, -22.45, -43.07),
    ('Parque Nacional da Tijuca',         'protecao_integral','federal',  2,   3953.0, -22.96, -43.29),
    ('Parque Nacional da Chapada dos Veadeiros','protecao_integral','federal',3, 65500.0, -14.27, -47.65),
    ('Parque Nacional das Emas',          'protecao_integral','federal',  3, 131868.0, -18.10, -52.93),
    ('Estação Ecológica de Anavilhanas',  'protecao_integral','federal',  1, 350018.0,  -2.75, -60.75),
    ('Reserva Biológica de Sooretama',    'protecao_integral','federal',  2,  28000.0, -19.20, -40.06),
    ('Parque Estadual da Serra do Mar',   'protecao_integral','estadual', 2, 332000.0, -23.55, -45.15),
    ('Parque Estadual das Várzeas do Rio Ivinhema','uso_sustentavel','estadual',6, 73000.0, -22.85, -53.20)
) AS v(nome, cat, esfera, bioma, area_ha, lat, lon);

-- ---------- Ocorrências (pontos dentro das UCs) ----------
-- Para cada par (espécie, UC) colocamos 1-2 ocorrências dentro do polígono.
INSERT INTO ocorrencia (especie_id, lat, lon, geom, data_evento, fonte, base_registro)
SELECT e.id,
       v.lat, v.lon,
       ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326),
       v.data, v.fonte::fonte_ocorrencia_tipo, v.base
FROM especie e
JOIN (VALUES
    ('panthera onca',          -25.62, -54.42, DATE '2023-02-10','carga_inicial','CNUC/ICMBio'),
    ('panthera onca',          -25.68, -54.47, DATE '2023-04-22','gbif',         'GBIF'),
    ('panthera onca',          -14.30, -47.62, DATE '2022-11-05','carga_inicial','CNUC/ICMBio'),
    ('panthera onca',           -2.78, -60.72, DATE '2023-01-15','gbif',         'GBIF'),
    ('leopardus tigrinus',     -22.48, -43.05, DATE '2022-09-12','carga_inicial','CNUC/ICMBio'),
    ('leopardus tigrinus',     -23.58, -45.12, DATE '2023-03-30','specieslink',  'speciesLink'),
    ('leopardus wiedii',       -22.48, -43.08, DATE '2022-08-18','carga_inicial','CNUC/ICMBio'),
    ('pteronura brasiliensis',  -2.76, -60.76, DATE '2023-05-02','gbif',         'GBIF'),
    ('pteronura brasiliensis', -22.88, -53.18, DATE '2022-12-20','carga_inicial','CNUC/ICMBio'),
    ('speothos venaticus',     -14.25, -47.68, DATE '2022-07-15','carga_inicial','CNUC/ICMBio'),
    ('chrysocyon brachyurus',  -18.12, -52.90, DATE '2023-06-08','gbif',         'GBIF'),
    ('chrysocyon brachyurus',  -14.28, -47.63, DATE '2022-10-11','carga_inicial','CNUC/ICMBio'),
    ('brachyteles arachnoides',-23.57, -45.13, DATE '2023-01-25','specieslink',  'speciesLink'),
    ('alouatta guariba',       -19.22, -40.04, DATE '2022-06-30','carga_inicial','CNUC/ICMBio'),
    ('alouatta guariba',       -22.98, -43.27, DATE '2023-04-05','gbif',         'GBIF'),
    ('myrmecophaga tridactyla',-18.08, -52.95, DATE '2023-02-18','carga_inicial','CNUC/ICMBio'),
    ('tapirus terrestris',      -2.79, -60.74, DATE '2022-11-28','gbif',         'GBIF'),
    ('tapirus terrestris',     -22.86, -53.22, DATE '2023-03-12','carga_inicial','CNUC/ICMBio'),
    ('tayassu pecari',         -18.12, -52.91, DATE '2022-09-09','gbif',         'GBIF'),
    ('amazona brasiliensis',   -25.65, -54.45, DATE '2023-05-20','specieslink',  'speciesLink'),
    ('pyrrhura cruentata',     -19.18, -40.08, DATE '2022-08-02','carga_inicial','CNUC/ICMBio')
) AS v(nc, lat, lon, data, fonte, base)
ON e.nome_cientifico = v.nc;

-- ---------- Refresh final das views ----------
SELECT refresh_dashboard();
