# BioGuardians — Dicionário de Dados

Documentação de todas as tabelas, colunas, tipos, constraints e
relacionamentos do schema, no estado final após as migrations `001`–`004`.

---

## Extensões

| Extensão | Uso |
|----------|-----|
| `postgis` | Tipos `geometry`, funções espaciais, `ST_AsMVT` |
| `pgcrypto` | Funções criptográficas |
| `unaccent` | Busca de espécies insensível a acentos |

---

## Tipos customizados (Enums e Domínios)

### Enums

| Tipo | Valores | Descrição |
|------|---------|-----------|
| `categoria_ameaca_tipo` | CR, EN, VU, NT, LC, DD, NE | Categoria de ameaça IUCN/MMA (NE = não avaliada) |
| `esfera_tipo` | federal, estadual, municipal, particular | Esfera administrativa da UC |
| `categoria_uc_tipo` | protecao_integral, uso_sustentavel | Categoria SNUC da UC |
| `rank_taxonomia_tipo` | reino, filo, classe, ordem, familia, genero | Nível taxonômico |
| `status_registro_tipo` | ativo, inativo, revisao | Status do registro da espécie |
| `operacao_auditoria_tipo` | INSERT, UPDATE, DELETE | Operação registrada em log |
| `fonte_ocorrencia_tipo` | gbif, specieslink, carga_inicial, manual, icmbio, deteccao_satelite, camera_trap, deteccao_ia | Origem da ocorrência |
| `imagem_status` | pending, processing, detected, classified, completed, failed | Estado de uma imagem no pipeline de ML |
| `deteccao_status` | detected, classified, rejected, inconclusive | Estado de uma detecção |

### Domínios

| Domínio | Tipo base | Constraints | Descrição |
|---------|-----------|-------------|-----------|
| `nome_cientifico_dom` | VARCHAR(200) | NOT NULL, trim, lowercase, min 4 chars | Nome científico normalizado |
| `uf_dom` | CHAR(2) | NOT NULL, uppercase | Sigla de estado |

---

## Tabelas de referência

### `categoria_ameaca`

Categorias de ameaça (padrão IUCN/MMA), com rótulos em português simples.

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `codigo` | `categoria_ameaca_tipo` | NOT NULL | ✅ | — | — | Código da categoria |
| `nome` | `VARCHAR(60)` | NOT NULL | — | — | — | Nome por extenso (UNIQUE) |
| `descricao` | `TEXT` | NULL | — | — | — | Descrição da categoria |
| `ordem_prioridade` | `SMALLINT` | NOT NULL | — | — | — | 1 = mais crítico (UNIQUE) |

Seed: CR (Criticamente em Perigo), EN (Entrando em Extinção), VU (Alto Risco de
Entrar em Extinção), NT (Em Ameaça), LC (Sem Risco), DD (Sem Dados para
Avaliar), NE (Não Avaliada).

### `bioma`

Biomas brasileiros (6 terrestres + marinho).

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `SMALLINT` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `nome` | `VARCHAR(40)` | NOT NULL | — | — | — | Nome do bioma (UNIQUE) |
| `descricao` | `TEXT` | NULL | — | — | — | Descrição do bioma |

**Check**: `nome = trim(nome)`
Seed: 1 Amazônia, 2 Mata Atlântica, 3 Cerrado, 4 Caatinga, 5 Pampa, 6 Pantanal, 7 Marinho.

### `estado`

Unidades da Federação (27 UFs, seed completo).

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `uf` | `uf_dom` | NOT NULL | ✅ | — | — | Sigla (2 letras maiúsculas) |
| `nome` | `VARCHAR(60)` | NOT NULL | — | — | — | Nome do estado (UNIQUE) |
| `regiao` | `VARCHAR(20)` | NOT NULL | — | — | — | Região |

**Check**: `regiao IN ('Norte','Nordeste','Centro-Oeste','Sudeste','Sul')`

### `taxon`

Hierarquia taxonômica lineana com auto-referência (`fillfactor = 90`).

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `INTEGER` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `nome` | `VARCHAR(100)` | NOT NULL | — | — | — | Nome do táxon |
| `rank` | `rank_taxonomia_tipo` | NOT NULL | — | — | — | Nível hierárquico |
| `parent_id` | `INTEGER` | NULL | — | `taxon(id)` | — | Táxon pai (auto-referência) |

**Unique**: `(nome, rank)`
**FK**: `parent_id → taxon(id) ON DELETE RESTRICT`

---

## Tabelas principais

### `especie`

Tabela central — cadastro de espécies.

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `INTEGER` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `nome_cientifico` | `nome_cientifico_dom` | NOT NULL | — | — | — | Nome científico (UNIQUE, lowercase) |
| `nome_popular` | `VARCHAR(120)` | NULL | — | — | — | Nome popular |
| `categoria_ameaca` | `categoria_ameaca_tipo` | NOT NULL | — | `categoria_ameaca(codigo)` | — | Categoria de ameaça |
| `categoria_fonte` | `VARCHAR(20)` | NOT NULL | — | — | `'manual'` | Procedência da categoria: `mma`, `iucn`, `ai`, `manual` |
| `genero_id` | `INTEGER` | NOT NULL | — | `taxon(id)` | — | Gênero (taxonomia) |
| `descricao` | `TEXT` | NULL | — | — | — | Resumo da espécie |
| `imagem_url` | `TEXT` | NULL | — | — | — | URL da imagem (enriquecimento) |
| `status` | `status_registro_tipo` | NOT NULL | — | — | `'ativo'` | Status do registro |
| `tsv_busca` | `tsvector` (GENERATED STORED) | — | — | — | — | `to_tsvector('portuguese', nome_cientifico + nome_popular + descricao)` |
| `criado_em` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Data de criação |
| `atualizado_em` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Última atualização (trigger) |

**FKs**: `categoria_ameaca → categoria_ameaca(codigo) ON DELETE RESTRICT ON UPDATE CASCADE`
`genero_id → taxon(id) ON DELETE RESTRICT`
**Check**: `status IN ('ativo','inativo','revisao')`

### `especie_bioma`

Associação N:N entre espécies e biomas.

| Coluna | Tipo | Nulidade | PK | FK |
|--------|------|----------|----|----|
| `especie_id` | `INTEGER` | NOT NULL | ✅ (comp) | `especie(id) ON DELETE CASCADE` |
| `bioma_id` | `SMALLINT` | NOT NULL | ✅ (comp) | `bioma(id) ON DELETE RESTRICT` |

### `especie_estado`

Associação N:N entre espécies e estados.

| Coluna | Tipo | Nulidade | PK | FK |
|--------|------|----------|----|----|
| `especie_id` | `INTEGER` | NOT NULL | ✅ (comp) | `especie(id) ON DELETE CASCADE` |
| `estado_uf` | `uf_dom` | NOT NULL | ✅ (comp) | `estado(uf) ON DELETE RESTRICT` |

### `area_protegida`

Unidades de Conservação com geometria georreferenciada.

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `INTEGER` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `nome` | `VARCHAR(180)` | NOT NULL | — | — | — | Nome da UC (UNIQUE) |
| `categoria_uc` | `categoria_uc_tipo` | NOT NULL | — | — | — | Proteção integral ou uso sustentável |
| `esfera` | `esfera_tipo` | NOT NULL | — | — | — | Federal/estadual/municipal/particular |
| `bioma_id` | `SMALLINT` | NULL | — | `bioma(id)` | — | Bioma predominante |
| `area_ha` | `NUMERIC(12,2)` | NULL | — | — | — | Área em hectares |
| `geom` | `geometry(MULTIPOLYGON,4326)` | NOT NULL | — | — | — | Polígono (validado por trigger: válido e não vazio) |
| `criado_em` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Data de criação |
| `atualizado_em` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Última atualização (trigger) |

**Check**: `area_ha > 0`
**FK**: `bioma_id → bioma(id) ON DELETE SET NULL`

### `ocorrencia`

Registros de ocorrência de espécies (pontos georreferenciados).

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `INTEGER` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `especie_id` | `INTEGER` | NOT NULL | — | `especie(id) ON DELETE CASCADE` | — | Espécie observada |
| `lat` | `DOUBLE PRECISION` | NOT NULL | — | — | — | Latitude (-90 a 90) |
| `lon` | `DOUBLE PRECISION` | NOT NULL | — | — | — | Longitude (-180 a 180) |
| `geom` | `geometry(POINT,4326)` | NOT NULL | — | — | — | Ponto (sincronizado com lat/lon por trigger, nos dois sentidos) |
| `data_evento` | `DATE` | NULL | — | — | — | Data da observação |
| `fonte` | `fonte_ocorrencia_tipo` | NOT NULL | — | — | `'carga_inicial'` | Origem do dado |
| `base_registro` | `VARCHAR(120)` | NULL | — | — | — | Identificador na fonte |
| `confianca_ia` | `NUMERIC(5,4)` | NULL | — | — | — | Confiança da classificação por IA (0–1) |
| `criado_em` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Data de inserção |

**Checks**: `lat BETWEEN -90 AND 90`, `lon BETWEEN -180 AND 180`,
`ST_X(geom) = lon AND ST_Y(geom) = lat`

### `ocorrencia_area`

Relação espacial pré-calculada ocorrência ↔ UC (N:N — UCs podem se sobrepor).
Mantida por triggers em `ocorrencia` e `area_protegida` (migration 003).

| Coluna | Tipo | Nulidade | PK | FK |
|--------|------|----------|----|----|
| `ocorrencia_id` | `INTEGER` | NOT NULL | ✅ (comp) | `ocorrencia(id) ON DELETE CASCADE` |
| `area_id` | `INTEGER` | NOT NULL | ✅ (comp) | `area_protegida(id) ON DELETE CASCADE` |

### `log_auditoria`

Log de alterações em `especie` e `area_protegida` (populado por trigger).
Desde a migration 005, a coluna `geom` não é copiada para `dados_anteriores`/`dados_novos`:
ela é substituída por `geom_md5` (hash do GeoJSON), que indica se a geometria mudou.

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `BIGINT` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `tabela` | `VARCHAR(60)` | NOT NULL | — | — | — | Nome da tabela alterada |
| `operacao` | `operacao_auditoria_tipo` | NOT NULL | — | — | — | INSERT/UPDATE/DELETE |
| `registro_id` | `BIGINT` | NOT NULL | — | — | — | ID do registro alterado |
| `usuario` | `VARCHAR(60)` | NOT NULL | — | — | `current_user` | Usuário do BD |
| `timestamp` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Momento da operação |
| `dados_anteriores` | `JSONB` | NULL | — | — | — | Estado anterior (UPDATE/DELETE) |
| `dados_novos` | `JSONB` | NULL | — | — | — | Estado novo (INSERT/UPDATE) |

---

## Tabelas de cache

### `area_tile`

Tiles vetoriais (MVT) das UCs pré-gerados (migration 004). Ver `docs/AREA_TILE_CACHE.md`.

| Coluna | Tipo | Nulidade | PK | Default | Descrição |
|--------|------|----------|----|---------|-----------|
| `z` | `SMALLINT` | NOT NULL | ✅ (comp) | — | Zoom |
| `x` | `INTEGER` | NOT NULL | ✅ (comp) | — | Coluna do tile |
| `y` | `INTEGER` | NOT NULL | ✅ (comp) | — | Linha do tile |
| `tile` | `BYTEA` | NOT NULL | — | — | Binário `.mvt` |
| `gerado_em` | `TIMESTAMPTZ` | NOT NULL | — | `now()` | Momento da geração |

### `cache_metadata`

Marca de última alteração por domínio, atualizada pelo trigger `trg_invalida_cache`.

| Coluna | Tipo | Nulidade | PK | Default | Descrição |
|--------|------|----------|----|---------|-----------|
| `chave` | `VARCHAR(100)` | NOT NULL | ✅ | — | `dashboard`, `especies`, `areas`, `ocorrencias`, `referencias` |
| `atualizado_em` | `TIMESTAMPTZ` | NOT NULL | — | `now()` | Última alteração |

### `schema_migrations`

Journal do `db/migrate.sh`.

| Coluna | Tipo | Nulidade | PK | Default | Descrição |
|--------|------|----------|----|---------|-----------|
| `id` | `SERIAL` | NOT NULL | ✅ | auto | ID |
| `filename` | `VARCHAR(255)` | NOT NULL | — | — | Arquivo aplicado (UNIQUE) |
| `checksum` | `VARCHAR(64)` | NOT NULL | — | — | SHA-256 do arquivo |
| `applied_at` | `TIMESTAMPTZ` | NOT NULL | — | `now()` | Momento da aplicação |

---

## Tabelas do ML service

### `deteccao_job`

Um job de processamento (lote de imagens). Colunas de satélite são legado.

| Coluna | Tipo | Nulidade | Default | Descrição |
|--------|------|----------|---------|-----------|
| `id` | `INTEGER` (IDENTITY) PK | NOT NULL | auto | ID do job |
| `bbox` | `VARCHAR(120)` | NULL | — | BBox da cena (legado satélite) |
| `data_captura` | `DATE` | NOT NULL | — | Data de referência |
| `satelite` / `instrumento` / `produto` / `scene_id` | `VARCHAR` | NULL | — | Metadados de satélite (legado) |
| `imagem_url` | `TEXT` | NULL | — | URL da cena (legado) |
| `status` | `VARCHAR(20)` | NOT NULL | `'pendente'` | `pendente`, `processando`, `concluido`, `erro` (CHECK) |
| `source` | `VARCHAR(30)` | NOT NULL | `'satellite'` | Origem (`camera_trap`, `local_dir`, …) |
| `data_dir` | `TEXT` | NULL | — | Diretório de dados do job |
| `project_id` | `VARCHAR(50)` | NULL | — | Filtro de projeto Wildlife Insights |
| `p_limit` | `INTEGER` | NULL | — | Limite de imagens do job |
| `total_imagens` / `imagens_processadas` / `total_deteccoes` | `INTEGER` | NOT NULL | `0` | Contadores de progresso |
| `erro` | `TEXT` | NULL | — | Mensagem de erro |
| `criado_em` | `TIMESTAMPTZ` | NOT NULL | `now()` | Criação |
| `concluido_em` | `TIMESTAMPTZ` | NULL | — | Conclusão |

### `imagem_job`

Checkpoint por imagem (idempotência do pipeline).

| Coluna | Tipo | Nulidade | Default | Descrição |
|--------|------|----------|---------|-----------|
| `id` | `BIGINT` (IDENTITY) PK | NOT NULL | auto | ID |
| `job_id` | `INTEGER` | NOT NULL | — | FK `deteccao_job(id) ON DELETE CASCADE` |
| `source` | `VARCHAR(30)` | NOT NULL | — | Origem da imagem |
| `source_image_id` | `VARCHAR(200)` | NULL | — | ID da imagem na fonte |
| `image_hash` | `VARCHAR(64)` | NULL | — | SHA-256 do arquivo (dedup) |
| `path` | `TEXT` | NULL | — | Caminho no cache local |
| `lat` / `lon` | `DOUBLE PRECISION` | NULL | — | Localização da câmera |
| `timestamp` | `TIMESTAMPTZ` | NULL | — | Momento da captura |
| `camera_id` / `project_id` / `deployment_id` | `VARCHAR(100)` | NULL | — | Metadados da câmera (dedup por deployment+timestamp) |
| `status` | `imagem_status` | NOT NULL | `'pending'` | Estado no pipeline |
| `detection_count` | `INTEGER` | NOT NULL | `0` | Detecções geradas |
| `error` | `TEXT` | NULL | — | Erro de processamento |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | `updated_at` mantido por trigger |

**Unique**: `(source, source_image_id)`

### `deteccao`

Resultado da classificação de uma imagem.

| Coluna | Tipo | Nulidade | Default | Descrição |
|--------|------|----------|---------|-----------|
| `id` | `INTEGER` (IDENTITY) PK | NOT NULL | auto | ID |
| `job_id` | `INTEGER` | NOT NULL | — | FK `deteccao_job(id) ON DELETE CASCADE` |
| `image_job_id` | `BIGINT` | NULL | — | FK `imagem_job(id) ON DELETE SET NULL` |
| `especie_id` | `INTEGER` | NULL | — | FK `especie(id) ON DELETE SET NULL` |
| `nome_cientifico` | `VARCHAR(200)` | NULL | — | Nome retornado pela IA |
| `confianca` | `NUMERIC(5,4)` | NULL | — | Confiança da detecção |
| `lat` / `lon` | `DOUBLE PRECISION` | NOT NULL | — | Localização (CHECK de faixa) |
| `geom` | `geometry(POINT,4326)` | NULL | — | Ponto sincronizado com lat/lon (migration 002) |
| `bbox_pixel` | `VARCHAR(80)` | NULL | — | BBox na imagem (legado YOLO) |
| `recorte_url` | `TEXT` | NULL | — | Recorte (legado YOLO) |
| `metodo_classificacao` | `VARCHAR(20)` | NOT NULL | `'heuristic'` | `ai` ou `heuristic` (CHECK) |
| `modelo_ia` | `VARCHAR(100)` | NULL | — | Modelo usado (ex.: `anthropic/claude-sonnet-4`) |
| `confianca_ia` | `NUMERIC(5,4)` | NULL | — | Confiança da IA |
| `status` | `deteccao_status` | NOT NULL | `'detected'` | Estado da detecção |
| `criado_em` | `TIMESTAMPTZ` | NOT NULL | `now()` | Criação |

### `modelo_ml`

Registro de modelos treinados.

| Coluna | Tipo | Nulidade | Default | Descrição |
|--------|------|----------|---------|-----------|
| `id` | `INTEGER` (IDENTITY) PK | NOT NULL | auto | ID |
| `nome` | `VARCHAR(100)` | NOT NULL | — | Nome do modelo |
| `versao` | `VARCHAR(30)` | NOT NULL | — | Versão (UNIQUE com `nome`) |
| `tipo` | `VARCHAR(30)` | NOT NULL | — | `deteccao` ou `classificacao` (CHECK) |
| `caminho` | `TEXT` | NOT NULL | — | Caminho dos pesos |
| `acuracia` | `NUMERIC(5,4)` | NULL | — | Acurácia medida |
| `ativo` | `BOOLEAN` | NOT NULL | `true` | Modelo em uso |
| `criado_em` | `TIMESTAMPTZ` | NOT NULL | `now()` | Criação |

---

## Views Materializadas

Todas têm índice único (permite `REFRESH MATERIALIZED VIEW CONCURRENTLY`).

### `dashboard_stats`

Estatísticas globais (uma única linha, calculadas com `COUNT(*) FILTER`).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | `INTEGER` | Sempre 1 (chave do índice único) |
| `total_especies` | `BIGINT` | Espécies ativas |
| `total_cr` / `total_en` / `total_vu` / `total_nt` / `total_lc` / `total_dd` | `BIGINT` | Espécies ativas por categoria |
| `total_areas` | `BIGINT` | Total de UCs |
| `area_total_ha` | `NUMERIC` | Soma de áreas (ha) |
| `total_ocorrencias` | `BIGINT` | Ocorrências de espécies ativas |

### `especies_por_uc`

Espécies ameaçadas (CR/EN/VU) por UC, via `ocorrencia_area`.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `area_id` | `INTEGER` | ID da UC |
| `area_nome` | `VARCHAR` | Nome da UC |
| `especie_id` | `INTEGER` | ID da espécie |
| `nome_cientifico` | `nome_cientifico_dom` | Nome científico |
| `categoria_ameaca` | `categoria_ameaca_tipo` | Categoria |

### `ranking_especies_categoria`

Contagem de espécies ativas por categoria de ameaça (ordenada CR → NE).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `categoria_ameaca` | `categoria_ameaca_tipo` | Categoria |
| `total` | `BIGINT` | Número de espécies |

### `ucs_por_esfera`

Distribuição de UCs por esfera administrativa.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `esfera` | `esfera_tipo` | Esfera |
| `total` | `BIGINT` | Número de UCs |
| `area_ha` | `NUMERIC` | Soma de áreas (ha) |

---

## Funções

| Função | Retorno | Descrição |
|--------|---------|-----------|
| `especies_em_area(area_id)` | tabela | Espécies CR/EN/VU com ocorrência na UC |
| `areas_protegem_especie(especie_id)` | tabela | UCs onde a espécie tem ocorrência |
| `contar_ocorrencias_em_area(area_id)` | `BIGINT` | Número de ocorrências na UC |
| `buscar_especies(texto)` | tabela | Full-text search em espécies ativas, com `ts_rank` |
| `refresh_dashboard()` | `VOID` | Refresh das 4 views materializadas |

## Triggers

| Trigger | Tabela | Momento | Função |
|---------|--------|---------|--------|
| `trg_ocorrencia_geom` | ocorrencia | BEFORE INSERT/UPDATE OF lat, lon, geom | `trg_sincroniza_geom_latlon` |
| `trg_deteccao_geom` | deteccao | BEFORE INSERT/UPDATE OF lat, lon, geom | `trg_sincroniza_geom_latlon` |
| `trg_ocorrencia_areas` | ocorrencia | AFTER INSERT/UPDATE OF geom | `trg_ocorrencia_recalcula_areas` |
| `trg_area_ocorrencias` | area_protegida | AFTER INSERT/UPDATE OF geom | `trg_area_recalcula_ocorrencias` |
| `trg_area_protegida_geom` | area_protegida | BEFORE INSERT/UPDATE OF geom | `trg_area_valida_geom` |
| `trg_especie_ts`, `trg_area_protegida_ts` | especie, area_protegida | BEFORE UPDATE | `trg_atualiza_timestamp` |
| `trg_especie_audit`, `trg_area_protegida_audit` | especie, area_protegida | AFTER INSERT/UPDATE/DELETE | `trg_auditar` |
| `trg_cache_especie`, `trg_cache_area_protegida`, `trg_cache_ocorrencia` | especie, area_protegida, ocorrencia | AFTER INSERT/UPDATE/DELETE | `trg_invalida_cache` |
| `trg_imagem_job_updated_at` | imagem_job | BEFORE UPDATE | `set_imagem_job_updated_at` |
