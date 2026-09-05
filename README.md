# BioGuardians

Sistema de banco de dados espacial (PostgreSQL + PostGIS) para gestão de
**especies ameacadas** e **areas protegidas** no Brasil, com aplicacao web
(Node.js + React + MapTiler Cloud) como camada fina de demonstracao.

> Projeto da disciplina de **Banco de Dados** — foco em modelagem, persistencia,
> consultas espaciais, integridade e recursos avancados de BD.

## Estrutura

```
BioGuardians/
├── docker-compose.yml            # dev: db, migrate, backend, frontend, ml-service (GPU)
├── docker-compose.observability.yml  # overlay: grafana, prometheus, tempo, loki
├── docker-compose.prod.yml       # produção: backend, frontend (sem ML service)
├── stack.yml                     # produção: backend, frontend, observabilidade
├── .env.example                  # variáveis de ambiente (copiar para .env)
├── .github/workflows/deploy.yml  # CI/CD: build, migrate, deploy na VM
├── .github/workflows/ci.yml      # CI: validações e builds
├── db/
│   ├── migrate.sh                # migration runner
│   ├── migrations/               # SQL numerados
│   └── tests/
│       └── smoke_test.sql
├── backend/                      # Node 22 + Express + TypeScript
├── frontend/                     # React 19 + Vite + MapLibre
├── ml-service/                   # Python + FastAPI + Qwen2-VL (classificação de camera trap)
├── scripts/data/                 # importadores de dados (MMA, GBIF, speciesLink, CNUC)
├── observability/                # configuração do Grafana, Prometheus, Tempo, Loki
├── otel-collector-config.yaml    # configuração do OTel Collector
└── docs/
    ├── PROJECT_PLAN.md
    ├── DATA_DICTIONARY.md
    ├── ERD.md
    └── OBSERVABILITY.md
```

## Como subir tudo (Docker Compose)

```bash
cp .env.example .env
# edite .env com suas credenciais, MapTiler API key e OTEL se quiser

docker compose up -d db            # sobe PostgreSQL + PostGIS (dev)
docker compose run --rm migrate    # aplica as migrations
docker compose up -d backend       # sobe a API (porta 3001)
docker compose up -d frontend      # sobe o frontend (porta 5173)
```

Acesse:
- Frontend: http://localhost:5173
- API: http://localhost:3001/api/health
- Banco: localhost:5432
- Grafana (com observabilidade): http://localhost:3000

Para subir a stack de observabilidade completa (OpenTelemetry, Grafana, Tempo, Prometheus, Loki), veja `docs/OBSERVABILITY.md`.

## Como subir o banco

### Opção A — Docker Compose (dev)

```bash
cp .env.example .env
docker compose up -d db
docker compose run --rm migrate
```

### Opção B — Instalação nativa (Oracle Cloud VM / Linux)

Em Oracle Linux, use `dnf` (não `apt`):

```bash
sudo dnf install -y postgresql-server postgresql-contrib postgis
sudo postgresql-setup initdb
sudo systemctl enable --now postgresql
sudo -u postgres createuser bioguard --superuser
sudo -u postgres psql -c "ALTER USER bioguard WITH PASSWORD 'sua_senha';"
sudo -u postgres createdb bioguardians -O bioguard
sh db/migrate.sh
```

Configure `pg_hba.conf` e `postgresql.conf` para conexões locais e da rede Docker. Veja a seção de deploy para detalhes.
## Carga de dados reais

Os scripts em `scripts/data/` importam dados oficiais no banco:

```bash
cd scripts/data
npm install

# Lista de espécies ameaçadas (MMA)
npm run load:mma

# Ocorrências via GBIF e speciesLink
npm run load:gbif
npm run load:splink

# Unidades de Conservação (ICMBio/CNUC)
npm run load:cnuc

# Buscar resumos de espécies na Wikipedia/Wikidata/iNaturalist
npm run enrich:descriptions

# Buscar imagens das espécies (iNaturalist, Wikimedia, GBIF, EOL)
npm run enrich:images
```

> **Atenção**: os scripts requerem Node.js 22+ e acesso ao banco via `.env`.

Após a carga, atualize as views materializadas do dashboard:

```bash
psql -d $DB_NAME -U $DB_USER -c "SELECT refresh_dashboard();"
```

## ML Service — Classificação de Camera Trap com IA

O `ml-service/` é um microserviço Python (FastAPI) que classifica fotos de
camera trap usando **OpenRouter + Claude Sonnet 4** (API externa, paga por token).

> **Roda localmente** na máquina com GPU — **não é deployado na VM de produção**.
> O backend na VM não tem dependência do ML service em produção.

### Jornada técnica

1. **Satélite (CBERS-4A)** — descartado: resolução ~2m/pixel insuficiente para fauna
2. **YOLO (detecção + crop)** — descartado: falsos positivos e crops ruins
3. **VLM local (Qwen2-VL-2B + QLoRA)** — descartado pra produção: melhor versão
   atingiu ~62-70% de acurácia, insuficiente
4. **IA externa via API (atual)** — OpenRouter, ~100% de aproveitamento nas
   imagens que a IA realmente processou; custo por imagem (créditos)

### Pipeline

```
Wildlife Insights CSV → download autenticado (GraphQL) → cache local
    → OpenRouter/Claude classifica a imagem completa (8 em paralelo)
    → dedup: mesmo image_id, hash SHA-256 ou deployment+timestamp → pula
    → se confiança >= 0.3: salva espécie + ocorrência no banco
    → se confiança < 0.3 ou sem espécie: salva como rejeitada
```

### Como usar (local com GPU)

```bash
# 1. Subir o banco
docker compose up -d db
docker compose run --rm migrate

# 2. Buildar a imagem do ML service
docker build -t bioguardians-ml ./ml-service

# 3. Processar imagens do Wildlife Insights (classifica via OpenRouter)
docker run --rm --gpus all \
  -e DATABASE_URL=postgresql://user:pass@host.docker.internal:5432/bioguardians \
  -e WI_EMAIL=your_email -e WI_PASSWORD=your_password \
  -e OPENROUTER_API_KEY=your_key \
  -e LOCAL_VLM_ENABLED=false \
  -v /path/to/wildlife-insights-data:/data/wi:ro \
  -v bioguardians_ml_images:/app/images \
  bioguardians-ml python -m app.cli ingest --source camera_trap --data-dir /data/wi --limit 50

# 4. Preparar dataset para fine-tune (baixa ~9.680 imagens) — experimentos
docker run --rm --gpus all \
  -e WI_EMAIL=your_email -e WI_PASSWORD=your_password \
  -v /path/to/wildlife-insights-data:/data/wi:ro \
  -v /path/to/output:/data/dataset \
  bioguardians-ml python -m app.cli prepare-dataset --data-dir /data/wi --output-dir /data/dataset

# 5. Fine-tunar Qwen2-VL-2B com QLoRA (~2-4h na RTX 4060) — experimentos
docker run --rm --gpus all \
  -v /path/to/dataset:/data/dataset \
  -v /path/to/models:/models \
  bioguardians-ml python -m app.cli finetune --dataset-dir /data/dataset --output-dir /models/qwen2vl-finetuned
```

### Env vars do ML service

| Variável | Descrição | Default |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão PostgreSQL | (obrigatório) |
| `OPENROUTER_API_KEY` | Chave OpenRouter (classificador principal) | vazio |
| `OPENROUTER_MODEL` | Modelo | `anthropic/claude-sonnet-4` |
| `LOCAL_VLM_ENABLED` | `false` = só OpenRouter | `true` |
| `WI_CACHE_ONLY` | `true` = não baixa, só processa cache | `false` |
| `YOLO_DEVICE` | Device VLM local (`cuda` ou `cpu`) | `cuda` |
| `WI_EMAIL` / `WI_PASSWORD` | Credenciais Wildlife Insights | vazio |
| `SPECIES_CONFIDENCE_THRESHOLD` | Threshold de aceitação | `0.3` |
| `VLM_CONCURRENCY` | Chamadas OpenRouter em paralelo | `8` |
| `IMAGE_STORAGE_DIR` | Cache de imagens | `/app/images` |

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

O GitHub Actions (`.github/workflows/deploy.yml`) roda a cada `push` na `main`:

1. **prepare** — detecta quais serviços mudaram e valida migrations
2. **build** — builda imagens Docker e publica no GHCR
3. **migrate** — aplica migrations no PostgreSQL de produção
4. **generate-stack** — renderiza `stack.yml` com secrets
5. **deploy** — envia `stack.yml` e arquivos de observabilidade para a VM e sobe os containers

### Pipeline visual

```
main
  │
  v
GitHub Actions
  │
  +-- prepare (migrations, diff de caminhos)
  +-- build (frontend + backend)
  +-- migrate (psql na VM de produção)
  +-- generate-stack (renderiza stack.yml)
  +-- deploy (SSH/SCP + docker compose na VM)
  v
VM Oracle Linux
  +-- Nginx (80/443) → frontend (:8080) / backend (:3001)
  +-- Containers: backend, frontend, grafana, prometheus, tempo, loki, otel-collector
```

### Secrets necessários no GitHub

| Secret | Uso |
|--------|-----|
| `DB_USER` | Usuário do PostgreSQL de produção |
| `DB_PASSWORD` | Senha do PostgreSQL de produção |
| `DB_NAME` | Nome do banco de produção |
| `DB_HOST` | Host do banco (IP interno ou localhost da VM) |
| `DB_PORT` | Porta do PostgreSQL (default 5432) |
| `FRONTEND_URL` | Origem permitida no CORS (ex: `https://seu-dominio.com`) |
| `VITE_API_URL` | URL da API no build do frontend (ex: `https://api.seu-dominio.com/api`) |
| `VITE_MAPTILER_API_KEY` | Chave da API do MapTiler Cloud |
| `GRAFANA_ADMIN_PASSWORD` | Senha do admin do Grafana |
| `ORACLE_SSH_HOST` | IP público da VM |
| `ORACLE_SSH_USER` | Usuário SSH (ex: `opc`) |
| `ORACLE_SSH_KEY` | Chave privada SSH (PEM) |
| `ORACLE_SSH_PORT` | Porta SSH (opcional, default 22) |

> `GITHUB_TOKEN` é automático e precisa de permissão `packages: write` para publicar no GHCR.

### Configuração na VM

Requisitos na VM (Oracle Linux):

```bash
sudo dnf install -y docker-ce nginx git
sudo systemctl enable --now docker
```

O PostgreSQL pode rodar **nativamente** na VM para melhor desempenho. Nesse caso, ajuste `pg_hba.conf` e `postgresql.conf` para aceitar conexões de `127.0.0.1` e da rede Docker (`172.17.0.0/16` ou a rede usada pelo Docker).

Crie o diretório de deploy:

```bash
mkdir -p ~/bioguardians/observability/grafana/provisioning/datasources
mkdir -p ~/bioguardians/observability/grafana/provisioning/dashboards
mkdir -p ~/bioguardians/observability/grafana/dashboards
```

O workflow enviará automaticamente `stack.yml`, `observability/` e `otel-collector-config.yaml` para `~/bioguardians/`.

Subir manualmente:

```bash
cd ~/bioguardians
sudo docker compose -f stack.yml pull
sudo docker compose -f stack.yml up -d
```

### Domínio e Nginx

A arquitetura de produção esperada usa **Nginx na VM** como proxy reverso, com certificados TLS:

```
Internet
  ↓
Cloudflare
  ↓
Nginx (VM)  :80  :443
  ├── /     → 127.0.0.1:8080 (frontend)
  └── /api  → 127.0.0.1:3001 (backend)
```

Configure o Nginx em `/etc/nginx/conf.d/` e obtenha os certificados (ex: Cloudflare Origin CA, Let's Encrypt). Não commite certificados nem chaves no repositório.

### Deploy manual (emergência)

Se precisar subir sem o GitHub Actions:

```bash
cd ~/bioguardians
sudo docker compose -f stack.yml pull
sudo docker compose -f stack.yml up -d
```

Verifique:

```bash
sudo docker compose -f stack.yml ps
sudo docker compose -f stack.yml logs backend --tail 50
```
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
