# BioGuardians

Sistema de banco de dados espacial (PostgreSQL + PostGIS) para gestão de
**especies ameacadas** e **areas protegidas** no Brasil, com aplicacao web
(Node.js + React + Google Maps) como camada fina de demonstracao.

> Projeto da disciplina de **Banco de Dados** — foco em modelagem, persistencia,
> consultas espaciais, integridade e recursos avancados de BD.

## Estrutura

```
BioGuardians/
├── docker-compose.yml            # 4 servicos: db, migrate, backend, frontend
├── .env.example                  # variaveis de ambiente (copiar para .env)
├── .github/workflows/ci.yml      # CI: validate + build + deploy
├── db/
│   ├── migrate.sh                # migration runner (journal + SHA-256 hash)
│   ├── migrations/               # SQL migrations (applied in order)
│   │   ├── 001_extensions.sql
│   │   ├── 002_enums_domains.sql
│   │   ├── 003_tables.sql
│   │   ├── 004_indexes.sql
│   │   ├── 005_functions.sql
│   │   ├── 006_triggers.sql
│   │   ├── 007_materialized_views.sql
│   │   ├── 008_seed_data.sql
│   │   ├── 009_performance.sql   # parallel query, FTS, indices compostos, memoria
│   │   └── 010_cache_support.sql # tabela cache_metadata + trigger invalidacao
│   └── tests/
│       └── smoke_test.sql        # CI validation
├── backend/                      # API Node.js + Express + TypeScript
│   ├── src/
│   │   ├── index.ts              # app principal
│   │   ├── config/env.ts         # config tipado
│   │   ├── db/pool.ts            # pool PostgreSQL
│   │   ├── cache/cache.ts        # cache LRU em memoria
│   │   ├── middleware/           # errorHandler, validateId
│   │   └── routes/               # referencias, especies, areas, ocorrencias, dashboard
│   ├── Dockerfile
│   └── package.json
├── frontend/                     # React + Vite + TypeScript + Google Maps
│   ├── src/
│   │   ├── main.tsx              # entry point
│   │   ├── App.tsx               # layout com tabs
│   │   ├── api/client.ts         # API client com cache
│   │   ├── types/index.ts        # interfaces TypeScript
│   │   ├── components/           # MapView, SpeciesList, SpeciesForm, AreaForm, Dashboard
│   │   └── styles/main.css       # estilos
│   ├── Dockerfile
│   └── package.json
└── docs/
    ├── PROJECT_PLAN.md
    ├── DATA_DICTIONARY.md
    └── ERD.md
```

## Como subir tudo (Docker Compose)

```bash
cp .env.example .env
# edite .env com suas credenciais e Google Maps API key

docker compose up -d db           # sobe PostgreSQL + PostGIS
docker compose run --rm migrate   # aplica as migrations
docker compose up -d backend      # sobe a API (porta 3001)
docker compose up -d frontend     # sobe o frontend (porta 5173)
```

Acesse:
- Frontend: http://localhost:5173
- API: http://localhost:3001/api/health
- Banco: localhost:5432

## Como subir o banco

### Opcao A — Docker Compose

```bash
cp .env.example .env
docker compose up -d db
docker compose run --rm migrate
```

### Opcao B — Instalacao nativa (Linux / Oracle Cloud VM)

```bash
sudo apt install -y postgresql-16 postgresql-16-postgis-3 postgresql-contrib
sudo -u postgres createuser bioguard --superuser
sudo -u postgres psql -c "ALTER USER bioguard WITH PASSWORD 'bioguard';"
sudo -u postgres createdb bioguardians -O bioguard
sh db/migrate.sh
```

## Sistema de Migrations

O projeto usa um sistema de migrations customizado (`db/migrate.sh`) que:

- Aplica arquivos SQL de `db/migrations/` em ordem alfabetica
- Rastreia migrations aplicadas na tabela `schema_migrations`
- Calcula hash **SHA-256** de cada arquivo para detectar adulteracao
- Cada migration roda numa **transacao** — se falhar, e revertida
- E **idempotente** — rodar de novo pula o que ja foi aplicado

```bash
sh db/migrate.sh             # aplica migrations pendentes
sh db/migrate.sh --status    # mostra status
sh db/migrate.sh --dry-run   # simula
```

## Otimizacoes de BD

### Parallel Query
- `max_parallel_workers_per_gather = 2` — queries espaciais (ST_Contains) usam workers
- `max_parallel_workers = 4` — total de workers paralelos
- Beneficia: scans em ocorrencia, joins espaciais com area_protegida

### Busca Composta (Full-Text Search)
- Coluna gerada `tsv_busca` combina nome_cientifico + nome_popular + descricao
- Indice GIN para busca rapida
- Funcao `buscar_especies('onca')` retorna especies com relevancia (ts_rank)
- Configuracao `portuguese` para stemming e acentos

### Indices Compostos
- `idx_ocorrencia_especie_data(especie_id, data_evento DESC)`
- `idx_especie_cat_status(categoria_ameaca, status)`

### Configuracao de Memoria (container 2GB)
- `shared_buffers = 256MB`
- `effective_cache_size = 1GB`
- `work_mem = 8MB`
- `shm_size = 512mb` no Docker

### Cache (LRU In-Memory)
- Backend usa `lru-cache` para endpoints read-heavy
- Dashboard: 60s, Referencias: 60s, Areas: 30s, GBIF: 5min
- Invalidation automatica em POST/PUT/DELETE
- Trigger no BD atualiza `cache_metadata` para invalidacao cross-process

## CI/CD

O GitHub Actions roda a cada push/PR:

1. **validate** — container PostGIS efemero + migrations + smoke tests + idempotencia
2. **backend-build** — typecheck + build do backend TypeScript
3. **frontend-build** — typecheck + build do frontend TypeScript
4. **deploy** (so push na main) — aplica migrations no banco de producao (Oracle VM)

## API Endpoints

| Metodo | Endpoint | Descricao |
|--------|----------|-----------|
| GET | `/api/health` | Health check |
| GET | `/api/biomas` | Lista biomas |
| GET | `/api/estados` | Lista estados |
| GET | `/api/categorias` | Lista categorias de ameaca |
| GET | `/api/taxonomia?rank=genero` | Lista taxonomia |
| GET | `/api/especies?categoria=CR&busca=onca` | Lista especies (filtros + FTS) |
| GET | `/api/especies/:id` | Detalhe da especie |
| POST | `/api/especies` | Cria especie |
| PUT | `/api/especies/:id` | Atualiza especie |
| DELETE | `/api/especies/:id` | Remove especie |
| GET | `/api/especies/:id/areas-protegidas` | UCs que protegem a especie |
| GET | `/api/areas` | Areas como GeoJSON FeatureCollection |
| GET | `/api/areas/:id` | Area como GeoJSON Feature |
| GET | `/api/areas/:id/especies` | Especies dentro da area (ST_Contains) |
| POST | `/api/areas` | Cria area (recebe GeoJSON) |
| PUT | `/api/areas/:id` | Atualiza area |
| DELETE | `/api/areas/:id` | Remove area |
| GET | `/api/ocorrencias?especie_id=42` | Ocorrencias como GeoJSON |
| POST | `/api/ocorrencias` | Cria ocorrencia |
| DELETE | `/api/ocorrencias/:id` | Remove ocorrencia |
| GET | `/api/ocorrencias/gbif?especie=panthera+onca` | Proxy GBIF (tempo real) |
| GET | `/api/dashboard` | Stats das views materializadas |
| POST | `/api/dashboard/refresh` | Atualiza views + invalida cache |

## Consultas de exemplo

```sql
-- Especies ameacadas dentro de uma UC (query espacial)
SELECT * FROM especies_em_area(1);

-- UCs que protegem a especie X
SELECT * FROM areas_protegem_especie(
    (SELECT id FROM especie WHERE nome_cientifico = 'panthera onca')
);

-- Busca composta (full-text search)
SELECT * FROM buscar_especies('onca');

-- Dashboard (views materializadas)
SELECT * FROM dashboard_stats;
SELECT * FROM ranking_especies_categoria;
SELECT * FROM ucs_por_esfera;

-- Atualizar views apos carga/alteracao
SELECT refresh_dashboard();

-- Auditoria
SELECT tabela, operacao, timestamp, dados_novos
FROM log_auditoria ORDER BY timestamp DESC LIMIT 20;
```

## Recursos de BD implementados

- **PostGIS**: colunas `geometry`, `ST_Contains`, `ST_AsGeoJSON`, indices **GIST**.
- **Constraints**: `CHECK`, `UNIQUE`, FKs com `ON DELETE RESTRICT/CASCADE/SET NULL`.
- **Enums/Dominios**: `categoria_ameaca_tipo`, `esfera_tipo`, `nome_cientifico_dom`, etc.
- **Triggers**: auditoria, validacao de geometria, sincronizacao geom, updated_at, cache invalidation.
- **Funcoes PL/pgSQL**: `especies_em_area`, `areas_protegem_especie`, `buscar_especies`, `refresh_dashboard`.
- **Views materializadas**: `dashboard_stats`, `especies_por_uc`, `ranking_especies_categoria`, `ucs_por_esfera`.
- **Parallel Query**: configurado para ST_Contains e scans.
- **Full-Text Search**: tsvector + GIN index em portugues.
- **Indices compostos**: especie+data, categoria+status.
- **Cache**: LRU in-memory no backend + cache_metadata no BD.
- **Migrations**: sistema customizado com journal, SHA-256, transacoes atomicas.
