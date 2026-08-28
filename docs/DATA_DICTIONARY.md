# BioGuardians — Dicionário de Dados

Documentação completa de todas as tabelas, colunas, tipos, constraints e
relacionamentos do schema.

---

## Tipos customizados (Enums e Domínios)

### Enums

| Tipo | Valores | Descrição |
|------|---------|-----------|
| `categoria_ameaca_tipo` | CR, EN, VU, NT, LC, DD | Categoria de ameaça IUCN/MMA |
| `esfera_tipo` | federal, estadual, municipal, particular | Esfera administrativa da UC |
| `categoria_uc_tipo` | protecao_integral, uso_sustentavel | Categoria SNUC da UC |
| `rank_taxonomia_tipo` | reino, filo, classe, ordem, familia, genero | Nível taxonômico |
| `status_registro_tipo` | ativo, inativo, revisao | Status do registro da espécie |
| `operacao_auditoria_tipo` | INSERT, UPDATE, DELETE | Operação registrada em log |
| `fonte_ocorrencia_tipo` | gbif, specieslink, carga_inicial, manual, icmbio | Origem da ocorrência |

### Domínios

| Domínio | Tipo base | Constraints | Descrição |
|---------|-----------|-------------|-----------|
| `nome_cientifico_dom` | VARCHAR(200) | NOT NULL, trim, lowercase, min 4 chars | Nome científico normalizado |
| `uf_dom` | CHAR(2) | NOT NULL, uppercase | Sigla de estado |

---

## Tabelas

### `categoria_ameaca`

Tabela de referência com as categorias de ameaça (padrão IUCN/MMA).

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `codigo` | `categoria_ameaca_tipo` | NOT NULL | ✅ | — | — | Código da categoria (CR/EN/VU/NT/LC/DD) |
| `nome` | `VARCHAR(60)` | NOT NULL | — | — | — | Nome por extenso (UNIQUE) |
| `descricao` | `TEXT` | NULL | — | — | — | Descrição da categoria |
| `ordem_prioridade` | `SMALLINT` | NOT NULL | — | — | — | 1 = mais crítico (UNIQUE) |

### `bioma`

Biomas brasileiros (7 terrestres + marinho).

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `SMALLINT` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `nome` | `VARCHAR(40)` | NOT NULL | — | — | — | Nome do bioma (UNIQUE) |
| `descricao` | `TEXT` | NULL | — | — | — | Descrição do bioma |

**Check**: `nome = trim(nome)`

### `estado`

Unidades da Federação (27 UFs).

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `uf` | `uf_dom` | NOT NULL | ✅ | — | — | Sigla (2 letras maiúsculas) |
| `nome` | `VARCHAR(60)` | NOT NULL | — | — | — | Nome do estado (UNIQUE) |
| `regiao` | `VARCHAR(20)` | NOT NULL | — | — | — | Região (Norte/Nordeste/Centro-Oeste/Sudeste/Sul) |

**Check**: `regiao IN ('Norte','Nordeste','Centro-Oeste','Sudeste','Sul')`

### `taxon`

Hierarquia taxonômica Linneana com auto-referência.

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `INTEGER` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `nome` | `VARCHAR(100)` | NOT NULL | — | — | — | Nome do táxon |
| `rank` | `rank_taxonomia_tipo` | NOT NULL | — | — | — | Nível hierárquico |
| `parent_id` | `INTEGER` | NULL | — | `taxon(id)` | — | Táxon pai (auto-referência) |

**Unique**: `(nome, rank)`  
**FK**: `parent_id → taxon(id) ON DELETE RESTRICT`

### `especie`

Tabela central — cadastro de espécies ameaçadas.

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `INTEGER` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `nome_cientifico` | `nome_cientifico_dom` | NOT NULL | — | — | — | Nome científico (UNIQUE, lowercase) |
| `nome_popular` | `VARCHAR(120)` | NULL | — | — | — | Nome popular |
| `categoria_ameaca` | `categoria_ameaca_tipo` | NOT NULL | — | `categoria_ameaca(codigo)` | — | Categoria de ameaça |
| `genero_id` | `INTEGER` | NOT NULL | — | `taxon(id)` | — | Gênero (taxonomia) |
| `descricao` | `TEXT` | NULL | — | — | — | Descrição da espécie |
| `status` | `status_registro_tipo` | NOT NULL | — | — | `'ativo'` | Status do registro |
| `criado_em` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Data de criação |
| `atualizado_em` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Última atualização (trigger) |

**FKs**: `categoria_ameaca → categoria_ameaca(codigo) ON DELETE RESTRICT ON UPDATE CASCADE`  
`genero_id → taxon(id) ON DELETE RESTRICT`

### `especie_bioma`

Associação N:N entre espécies e biomas.

| Coluna | Tipo | Nulidade | PK | FK | Descrição |
|--------|------|----------|----|----|-----------|
| `especie_id` | `INTEGER` | NOT NULL | ✅ (comp) | `especie(id) ON DELETE CASCADE` | — |
| `bioma_id` | `SMALLINT` | NOT NULL | ✅ (comp) | `bioma(id) ON DELETE RESTRICT` | — |

### `especie_estado`

Associação N:N entre espécies e estados.

| Coluna | Tipo | Nulidade | PK | FK | Descrição |
|--------|------|----------|----|----|-----------|
| `especie_id` | `INTEGER` | NOT NULL | ✅ (comp) | `especie(id) ON DELETE CASCADE` | — |
| `estado_uf` | `uf_dom` | NOT NULL | ✅ (comp) | `estado(uf) ON DELETE RESTRICT` | — |

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
| `geom` | `geometry(MULTIPOLYGON,4326)` | NOT NULL | — | — | — | Polígono georreferenciado |
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
| `geom` | `geometry(POINT,4326)` | NOT NULL | — | — | — | Ponto georreferenciado (sincronizado via trigger) |
| `data_evento` | `DATE` | NULL | — | — | — | Data da observação |
| `fonte` | `fonte_ocorrencia_tipo` | NOT NULL | — | — | `'carga_inicial'` | Origem do dado |
| `base_registro` | `VARCHAR(120)` | NULL | — | — | — | Identificador na fonte |
| `criado_em` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Data de inserção |

**Checks**: `lat BETWEEN -90 AND 90`, `lon BETWEEN -180 AND 180`,  
`ST_X(geom) = lon AND ST_Y(geom) = lat`

### `log_auditoria`

Log de alterações em espécies e áreas protegidas (populado por trigger).

| Coluna | Tipo | Nulidade | PK | FK | Default | Descrição |
|--------|------|----------|----|----|---------|-----------|
| `id` | `BIGINT` (IDENTITY) | NOT NULL | ✅ | — | auto | ID sequencial |
| `tabela` | `VARCHAR(60)` | NOT NULL | — | — | — | Nome da tabela alterada |
| `operacao` | `operacao_auditoria_tipo` | NOT NULL | — | — | — | INSERT/UPDATE/DELETE |
| `registro_id` | `INTEGER` | NOT NULL | — | — | — | ID do registro alterado |
| `usuario` | `VARCHAR(60)` | NOT NULL | — | — | `current_user` | Usuário do BD |
| `timestamp` | `TIMESTAMPTZ` | NOT NULL | — | — | `now()` | Momento da operação |
| `dados_anteriores` | `JSONB` | NULL | — | — | — | Estado anterior (UPDATE/DELETE) |
| `dados_novos` | `JSONB` | NULL | — | — | — | Estado novo (INSERT/UPDATE) |

---

## Views Materializadas

### `dashboard_stats`

Estatísticas globais (uma única linha).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | `INTEGER` | Sempre 1 (chave para refresh) |
| `total_especies` | `BIGINT` | Espécies ativas |
| `total_cr` | `BIGINT` | Espécies CR |
| `total_en` | `BIGINT` | Espécies EN |
| `total_vu` | `BIGINT` | Espécies VU |
| `total_areas` | `BIGINT` | Total de UCs |
| `area_total_ha` | `NUMERIC` | Soma de áreas (ha) |
| `total_ocorrencias` | `BIGINT` | Total de ocorrências |

### `especies_por_uc`

Espécies ameaçadas (CR/EN/VU) por UC (resultado de `ST_Contains`).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `area_id` | `INTEGER` | ID da UC |
| `area_nome` | `VARCHAR` | Nome da UC |
| `especie_id` | `INTEGER` | ID da espécie |
| `nome_cientifico` | `nome_cientifico_dom` | Nome científico |
| `categoria_ameaca` | `categoria_ameaca_tipo` | Categoria |

### `ranking_especies_categoria`

Contagem de espécies ativas por categoria de ameaça.

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
