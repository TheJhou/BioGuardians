# BioGuardians — Plano do Projeto

> Banco de Dados para Gestão de Biodiversidade e Espécies Ameaçadas

Sistema de banco de dados espacial (PostgreSQL + PostGIS) para gestão de
espécies ameaçadas e áreas protegidas no Brasil, com uma aplicação web simples
(Node.js + React + MapTiler Cloud) como interface de demonstração do banco.

---

## 1. Contexto do Projeto

- **Disciplina**: Banco de Dados
- **Tema**: Gestão de biodiversidade e espécies ameaçadas (tema bio sustentável)
- **Foco**: Banco de dados (modelagem, persistência, consultas, integridade).
  A aplicação web é uma camada fina de demonstração.
- **Stack**: PostgreSQL + PostGIS, Node.js 22, React 19, Vite, MapLibre, MapTiler Cloud, OpenTelemetry, Grafana
- **Recorte geográfico**: Brasil
- **Abordagem de dados**: Híbrida (carga inicial estática + consulta em tempo
  real ao GBIF)
- **Profundidade do BD**: Completo (triggers, views materializadas, funções
  PL/pgSQL), possivelmente avançado (3FN + EXPLAIN).

## 2. Problema que a Aplicação Resolve

### Problema central

A informação sobre espécies ameaçadas e áreas protegidas no Brasil está dispersa
em várias fontes (MMA, ICMBio, GBIF, speciesLink), em formatos diferentes (CSV,
shapefile, APIs), e não está integrada num só lugar que permita cruzar dados
geográficos com dados de espécies.

### Dores concretas

- **Fragmentação de dados** — para saber "quais espécies ameaçadas ocorrem
  dentro da UC X?", hoje é preciso baixar a lista do MMA, baixar o shapefile do
  CNUC, buscar ocorrências no GBIF, e cruzar tudo manualmente num GIS
  (QGIS/ArcGIS). Trabalhoso e técnico.
- **Falta de visão integrada num mapa** — as listas oficiais são tabelas em
  PDF/CSV, sem representação geográfica. Um gestor não consegue "ver" onde as
  espécies ameaçadas estão em relação às áreas protegidas.
- **Dificuldade de consulta espacial** — responder perguntas simples como "esta
  UC protege quantas espécies criticamente ameaçadas?" exige conhecimento
  técnico em GIS.
- **Dados desatualizados ou dispersos** — cada fonte atualiza num ritmo
  diferente; não há um ponto único de consulta consolidado.
- **Acesso restrito a especialistas** — as ferramentas atuais (QGIS, scripts em
  R/Python) são voltadas para pesquisadores; gestores públicos, ONGs e o público
  geral não conseguem usar facilmente.

### O que a aplicação faz para resolver

- Integra num único banco (PostgreSQL/PostGIS) os dados de espécies ameaçadas +
  áreas protegidas + ocorrências
- Permite consultas espaciais nativas ("quais espécies dentro desta UC?",
  "esta ocorrência está dentro de uma área protegida?")
- Visualiza no mapa a relação entre espécies e áreas — algo que uma tabela não
  mostra
- Democratiza o acesso — uma interface web simples em vez de software GIS
  especializado

### Framing para apresentação

> "A aplicação resolve o problema da fragmentação e dificuldade de consulta dos
> dados de biodiversidade brasileiros. Hoje, cruzar espécies ameaçadas com áreas
> protegidas exige ferramentas técnicas de GIS e múltiplas fontes. Nosso sistema
> integra esses dados num banco espacial (PostGIS) e oferece uma interface de
> mapa simples, permitindo que gestores, pesquisadores e o público respondam a
> perguntas como *quais espécies ameaçadas esta Unidade de Conservação protege?*
> em segundos."

## 3. Onde Pode Ser Aplicada (contextos reais)

- **Órgãos públicos de meio ambiente** — ICMBio, IBAMA, secretarias estaduais:
  gestores que monitoram UCs e espécies, priorizam ações de conservação e
  respondem a licenciamentos ambientais.
- **Licenciamento ambiental** — Empresas de consultoria ambiental e órgãos
  licenciadores avaliando impacto de obras sobre espécies ameaçadas e áreas
  protegidas.
- **ONGs e institutos de conservação** — SOS Mata Atlântica, WWF Brasil, IPÊ:
  entidades que direcionam recursos e campanhas com base num panorama
  geográfico.
- **Pesquisa acadêmica** — Estudos de distribuição de espécies, gap analysis,
  planejamento sistemático da conservação.
- **Educação e conscientização pública** — Escolas, museus, centros de ciência:
  uma interface de mapa é mais didática que uma lista em PDF.
- **Jornalismo de dados** — Reporters investigando conflitos entre espécies
  ameaçadas e atividades humanas.
- **Planejamento territorial** — Prefeituras e estados na elaboração de planos
  diretores e zoneamento ecológico-econômico.

## 4. Escopo

### Dentro do escopo

- Cadastro de espécies com taxonomia, categoria de ameaça (MMA/IUCN), bioma(s)
  e estado(s) de ocorrência
- Cadastro de áreas protegidas (UCs) com geometria georreferenciada (PostGIS)
- Registro de ocorrências de espécies (ponto lat/long), vindas do GBIF em tempo
  real ou importadas
- Consultas espaciais: quais espécies ameaçadas ocorrem dentro de uma UC? qual
  UC protege a espécie X?
- Consultas analíticas (views materializadas): ranking de espécies por
  categoria, por bioma, por estado; UCs por categoria/esfera
- Integridade referencial e constraints (categoria válida, bioma válido,
  geometria válida)
- Triggers para auditoria (log de alterações) e validações automáticas
- Índices espaciais (GIST) e convencionais para performance
- Interface web de demonstração: 4 páginas principais
  - **Home**: apresentação do projeto, destaques e fontes
  - **Dashboard**: estatísticas das views materializadas com gráficos
  - **Mapa**: MapLibre + MapTiler Cloud com polígonos das UCs, filtros e legenda
  - **Espécies**: lista com scroll infinito (15 em 15) e detalhe com resumo da espécie
- Responsivo: menu hamburger mobile, layouts adaptáveis
- Enriquecimento de resumos: Wikipedia, Wikidata, iNaturalist e OpenRouter (IA)
- Enriquecimento de imagens: iNaturalist, Wikimedia Commons, GBIF, EOL
- Observabilidade: traces, métricas e logs com OpenTelemetry + Grafana

### Fora do escopo

- Autenticação de usuários / login
- Importação automática de shapefiles/CSVs via interface (via script SQL)
- Relatórios em PDF
- Notificações
- App mobile

## 5. Fluxo da Aplicação

```
┌─────────────────────────────────────────────────────────────┐
│                    FONTES DE DADOS                          │
│  MMA (CSV)  ICMBio (DwC-A)  CNUC (Shapefile)  GBIF (API)   │
└───────────┬─────────────────────────────────────────────────┘

        │ scripts de importação (SQL, shp2pgsql, Node)
        ▼
┌─────────────────────────────────────────────────────────────┐
│         PostgreSQL + PostGIS  (núcleo do projeto)           │
│                                                             │
│  Tabelas: especie, area_protegida, ocorrencia, bioma,       │
│           estado, categoria_ameaca, taxon, log_auditoria    │
│  Views materializadas: dashboard_stats, especies_por_uc     │
│  Triggers: auditar_alteracao, validar_geometria             │
│  Índices: GIST (geometria), B-tree (nome, categoria)        │
└───────────┬─────────────────────────────────────────────────┘

        │ SQL / queries parametrizadas
        ▼
┌─────────────────────────────────────────────────────────────┐
│              API Node.js (camada fina)                      │
│  Endpoints REST que executam SQL no banco                   │
│  - GET /api/especies (com filtros)                              │
│  - GET /areas (com geometria GeoJSON)                       │
│  - GET /ocorrencias?especie_id=                             │
│  - GET /especies/:id/areas-protegidas  (query espacial)     │
│  - POST/PUT/DELETE /especies, /areas                        │
└───────────┬─────────────────────────────────────────────────┘

        │ JSON / GeoJSON
        ▼
┌─────────────────────────────────────────────────────────────┐
│         React + MapTiler Cloud (interface de demo)          │
│  - Mapa com polígonos das UCs                               │
│  - Marcadores de ocorrências                                │
│  - Filtros (categoria, bioma, estado)                       │
│  - Dashboard com gráficos (stats das views)                 │
└─────────────────────────────────────────────────────────────┘
```

### Fluxo de uso típico

1. Usuário abre o mapa → React chama `GET /areas` → API roda
   `SELECT id, nome, categoria, ST_AsGeoJSON(geom) FROM area_protegida` →
   retorna GeoJSON → MapTiler Cloud desenha os polígonos
2. Usuário filtra "espécies criticamente ameaçadas (CR)" →
   `GET /especies?categoria=CR` → API roda query com JOIN → retorna lista
3. Usuário clica numa espécie → `GET /ocorrencias?especie_id=42` → API busca
   ocorrências no banco e consulta GBIF em tempo real → marca no mapa
4. Usuário clica numa UC → `GET /areas/5/especies` → API roda query espacial
   `ST_Contains(geom, ponto)` → lista espécies ameaçadas dentro da UC
5. Usuário cadastra nova espécie → `POST /especies` → trigger de auditoria
   registra a alteração na tabela `log_auditoria`

## 6. Modelo de Dados (preliminar)

### Tabelas principais

- `categoria_ameaca` (CR, EN, VU, NT, LC, DD) — domínio fixo
- `bioma` (Amazônia, Mata Atlântica, Cerrado, Caatinga, Pampa, Pantanal, Marinho)
- `estado` (27 UF)
- `taxon` — hierarquia taxonômica (reino → filo → classe → ordem → família → gênero)
- `especie` (id, nome_cientifico, nome_popular, categoria_ameaca_id, descricao, status)
- `especie_bioma` (N:N espécie ↔ bioma)
- `especie_estado` (N:N espécie ↔ estado)
- `area_protegida` (id, nome, categoria_uc, esfera, bioma_id, area_ha, geom POLYGON/MULTIPOLYGON)
- `ocorrencia` (id, especie_id, lat, lon, geom POINT, data, fonte, base_registro)
- `log_auditoria` (id, tabela, operacao, registro_id, usuario, timestamp, dados_anteriores)

### Recursos de BD a destacar na avaliação

- **PostGIS**: colunas `geometry`, `ST_Contains`, `ST_Within`, `ST_AsGeoJSON`,
  índice GIST
- **Views materializadas** para o dashboard (refresh sob demanda)
- **Triggers** de auditoria (AFTER INSERT/UPDATE/DELETE)
- **Constraints**: CHECK em categoria, UNIQUE em nome_cientifico, FKs com
  ON DELETE RESTRICT/CASCADE
- **Enums ou domínios** para categoria_ameaca e esfera
- **Índices** em colunas de busca frequente (nome_cientifico, categoria, geom)

## 7. Fontes de Dados

| Fonte | Formato | Conteúdo | Uso |
|-------|---------|----------|-----|
| MMA — dados.mma.gov.br | CSV | Lista oficial de espécies ameaçadas | Carga inicial |
| ICMBio — ipt.icmbio.gov.br | DwC-A | Avaliações de risco da fauna | Carga complementar |
| CNUC/MMA | Shapefile | Polígonos das UCs | Carga via shp2pgsql |
| GBIF — api.gbif.org | API REST | Ocorrências georreferenciadas | Consulta em tempo real |
| speciesLink | API REST | Ocorrências de coleções brasileiras | Fonte complementar |
| IUCN Red List | API REST | Categoria global IUCN | Enriquecimento |
