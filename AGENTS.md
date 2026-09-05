# BioGuardians — Project Info

## Stack
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Backend**: Node.js 22 + Express + TypeScript (porta 3001)
- **Frontend**: React 19 + Vite + TypeScript + MapLibre GL + MapTiler Cloud
- **ML Service**: Python 3.11 + FastAPI + Qwen2-VL-2B + PyTorch (porta 8001, local com GPU)
- **Infra**: Docker Compose, Nginx, Oracle Cloud VM (produção) + máquina local com RTX 4060 (ML)
- **CI/CD**: GitHub Actions (build, migrations, deploy — sem ML service)
- **Observabilidade**: OpenTelemetry, Grafana, Tempo, Prometheus, Loki

## Migrations
- Sistema customizado em `db/migrate.sh` (sem ferramentas de terceiros)
- **Arquivo único consolidado**: `db/migrations/001_initial.sql` — schema completo, 100% idempotente (`IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, `DROP+CREATE` para triggers/matviews)
- Roda com `-- @no-transaction` (ALTER TYPE ADD VALUE não pode dividir transação com o valor novo)
- Migrations antigas preservadas em `db/migrations_archive/` (histórico)
- Journal table: `schema_migrations` (filename + checksum SHA-256)
- Idempotente: rodar de novo pula o já aplicado / só cria o que falta
- Comandos: `sh db/migrate.sh`, `--status`, `--dry-run`

## Comandos úteis
- Subir banco (Docker): `docker compose up -d db`
- Aplicar migrations (Docker): `docker compose run --rm migrate`
- Aplicar migrations (nativo): `sh db/migrate.sh`
- Status das migrations: `sh db/migrate.sh --status`
- Smoke tests: `psql -f db/tests/smoke_test.sql` (credenciais via .env)
- Resetar banco: `docker compose down -v && docker compose up -d db && docker compose run --rm migrate`
- Conectar: `psql -d $DB_NAME -U $DB_USER`
- Refresh views: `SELECT refresh_dashboard();`
- Subir produção: `cd ~/bioguardians && sudo docker compose -f stack.yml pull && sudo docker compose -f stack.yml up -d`

## Estrutura do banco (migrations)
1. `001_extensions.sql` — PostGIS, pgcrypto
2. `002_enums_domains.sql` — enums (categoria_ameaca, esfera, etc.) e domínios
3. `003_tables.sql` — tabelas em 3FN com constraints e FKs
4. `004_indexes.sql` — GIST (espaciais) + B-tree (filtros)
5. `005_functions.sql` — funções PL/pgSQL e SQL (consultas espaciais, refresh)
6. `006_triggers.sql` — auditoria, validação de geometria, timestamps
7. `007_materialized_views.sql` — dashboard_stats, especies_por_uc, rankings
8. `008_seed_data.sql` — dados de referência (categorias, biomas, estados)
9. `009_server_config.sql` — configurações do PostgreSQL (parallel workers, work_mem)
10. `010_performance.sql` — full-text search, índices GIN e compósitos
11. `011_cache_support.sql` — tabela cache_metadata + triggers de invalidação
12. `012_spatial_optimization.sql` — otimizações espaciais (simplificação de geometrias)
13. `013_imagem_url.sql` — coluna imagem_url na tabela especie
14. `014_deteccao_satelite.sql` — tabelas deteccao_job, deteccao, modelo_ml (ML service)
15. `015_rastreio_ia.sql` — rastreio de classificação por IA na tabela deteccao
16. `016_processamento_bulk.sql` — tabela imagem_job (checkpoint por imagem, idempotência)
17. `017_job_filtros.sql` — filtros de job (project_id, limit) para camera trap

## Decisões de modelagem
- SRID 4326 (WGS84) para todas as geometrias
- `nome_cientifico` em domínio próprio (lowercase, trim)
- UF em domínio `CHAR(2)` maiúsculo
- Taxonomia hierárquica com auto-referência (reino → gênero)
- Auditoria via trigger genérico (to_jsonb do registro inteiro)
- Views materializadas com refresh simples (não CONCURRENTLY dentro de função)

## Frontend
- Rotas: `/` (Home), `/dashboard`, `/mapa`, `/especies`, `/especies/:id`
- Páginas principais: Home, Dashboard, Mapa, Espécies
- Design system: paleta verde institucional, componentes `Layout`, `Header`, `StatCard`
- Responsivo: menu hamburger mobile, grids adaptáveis

## Backend
- Rotas principais: `/api/health`, `/api/especies`, `/api/areas`, `/api/ocorrencias`, `/api/dashboard`, `/api/referencias`
- Rota proxy ML (somente leitura): `GET /api/deteccoes/jobs`, `GET /api/deteccoes/jobs/:id` (proxy para o ML service na porta 8001 — só funciona quando o ML service está rodando localmente)
- Cache LRU em memória com invalidação por rota
- OpenTelemetry condicional (só ativa com `OTEL_EXPORTER_OTLP_ENDPOINT`)

## ML Service (classificação de camera trap com IA externa)
- Microserviço Python em `ml-service/` (FastAPI + PyTorch para treino local)
- **Roda localmente** na máquina com GPU (RTX 4060 8GB VRAM) — NÃO é deployado na VM de produção
- Porta 8001, container Docker `bioguardians-ml` (apenas em `docker-compose.yml` dev)

### Jornada técnica (o que foi testado e por que mudou)
1. **Satélite (CBERS-4A)** — descartado: resolução ~2m/pixel insuficiente para detectar fauna
2. **YOLO (detecção + crop)** — descartado: muitos falsos positivos e crops ruins prejudicavam a classificação
3. **VLM local fine-tuned (Qwen2-VL-2B + QLoRA)** — descartado como classificador de produção:
   - v2: LoRA r=16, 3.313 imagens, 26 espécies → ~70% em 20 imgs
   - v3: LoRA r=48 (com confiança no target) → ~65%
   - v4: LoRA r=16, 9.348 imagens, 68 espécies → ~62% em 50 imgs
   - Problema: acurácia baixa demais e confiança não calibrada (erros com conf=0.99)
4. **IA externa via API (ATUAL)** — OpenRouter + Claude Sonnet 4, pago por token:
   - Acurácia muito superior; no primeiro batch real, 99,9% das imagens respondidas foram classificadas
   - Custo por imagem — exige cota de créditos na conta OpenRouter

### Pipeline atual
```
Wildlife Insights CSV → download autenticado (GraphQL) → cache local
    → OpenRouter/Claude Sonnet 4 classifica a imagem completa (VLM_CONCURRENCY em paralelo)
    → dedup: mesmo image_id, mesmo hash SHA-256 ou mesmo deployment+timestamp → pula
    → se confiança >= 0.3: salva espécie + ocorrência no banco
    → se confiança < 0.3 ou sem espécie: salva como rejeitada
    → ocorrência duplicada (mesma espécie + data + local) → não duplica
```

### Resultado do primeiro processamento real (job 29)
- ~19k imagens em cache; 9.450 elegíveis (resto: blank/humano/sem label)
- **1.559 classificadas com sucesso** → 886 ocorrências, 49 espécies distintas (40 novas)
- 7.155 falharam com `402` (cota OpenRouter esgotada) — ficaram como `rejected` no banco
- Para reprocessar: `DELETE FROM deteccao WHERE job_id=29 AND status='rejected'; UPDATE imagem_job SET status='pending' WHERE job_id=29 AND status='completed';` e rodar o ingest de novo

### Modelo VLM local (mantido apenas para experimentos)
- Artefatos de treino (v3/v4) em `/models/qwen2vl-finetuned-v*` — fora do caminho de produção
- `LOCAL_VLM_ENABLED=false` desativa o carregamento do modelo local (padrão atual: só OpenRouter)
- `WI_CACHE_ONLY=true` impede download de novas imagens (processa só o cache)

### Histórico de treinamentos (Qwen2-VL-2B + QLoRA)

Todos os treinos usaram `Qwen/Qwen2-VL-2B-Instruct` como base, QLoRA 4-bit
na RTX 4060 (8GB VRAM), dataset Wildlife Insights.

#### v2 — melhor resultado em amostra pequena
- LoRA r=16, alpha=32
- Dataset: 3.313 imagens, 26 espécies
- Resultado: **~70% em 20 imagens de teste**
- Lição: dataset menor = classes mais fáceis; acurácia alta mas limitada

#### v3 — confiança no target do modelo
- LoRA r=48, alpha=?
- Dataset: 3.313 imagens, 26 espécies
- 3.535 steps, 5 epochs, eval loss ~5.31
- 55,4M parâmetros treináveis (2,45% do total)
- Resultado: **~65% em 20 imagens** — piorou vs v2
- Lição: aumentar LoRA rank não melhorou; confiança embutida no treino
  ficou não-calibrada (erros com conf=0.80-0.99)

#### v4 — mais dados, mais espécies
- LoRA r=16, alpha=32
- Dataset: 9.348 imagens em cache, 68 espécies
- Split: 7.964 treino / 1.384 validação
- Batch=2, grad_accum=4, 5 epochs, 4.980 steps
- 18,5M parâmetros treináveis (0,83% do total)
- Resultado: **60% em 20 imagens, 62% em 50 imagens**
- Lição: 68 espécies é muito mais difícil que 26; o modelo local
  simplesmente não tem capacidade suficiente pra esse problema

#### Por que desistimos do modelo local
- Melhor cenário possível: ~70% em amostra pequena, ~62% em dataset real
- Confiança retornada pelo modelo não era calibrada (baseada em contagem
  de exemplos por espécie, não por imagem individual)
- Erros frequentes com confiança alta — inutilizável em produção
- OpenRouter/Claude Sonnet 4 deu ~99,9% de aproveitamento no primeiro batch
- Artefatos mantidos em `/models/qwen2vl-finetuned-v*` para referência

### Fonte de dados — Wildlife Insights
- Dataset CSV com metadados + URLs autenticadas para download de imagens
- Autenticação: POST `/v1/auth/sign-in` → token → POST `/graphql-data-file` → URL GCS assinada
- Filtros: blank, human, no_species são pulados; só imagens com espécie rotulada são processadas
- Cache: imagens baixadas ficam em volume Docker para não rebaixar
- Estatísticas do dataset: 34.190 imagens total, ~19k baixadas, 9.680 treináveis, 68 espécies

### Arquivos principais
- `app/pipeline.py` — orquestra classificação concorrente + dedup + persistência
- `app/local_classifier.py` — classificador (local opcional + OpenRouter)
- `app/sources/camera_trap.py` — source Wildlife Insights (CSV + download autenticado + cache-only)
- `app/sources/local_dir.py` — source para pasta local (testes/debug)
- `app/train/prepare_dataset.py` — baixa imagens e prepara dataset JSONL para fine-tune
- `app/train/finetune.py` — fine-tune Qwen2-VL-2B com QLoRA
- `app/config.py` — configurações (OpenRouter, thresholds, LOCAL_VLM_ENABLED)
- `app/db.py` — acesso ao PostgreSQL (asyncpg), dedup por hash/evento
- `app/main.py` — FastAPI app + worker loop
- `app/cli.py` — CLI com comandos `ingest`, `classify`, `status`, `prepare-dataset`, `finetune`

### Comandos CLI
```bash
# Processar imagens (classifica com OpenRouter e salva no banco)
docker exec bioguardians-ml python -m app.cli ingest --source camera_trap --data-dir /data/wi --limit 50

# Preparar dataset para fine-tune (baixa ~9.680 imagens)
docker exec bioguardians-ml python -m app.cli prepare-dataset --data-dir /data/wi --output-dir /data/dataset

# Fine-tunar Qwen2-VL-2B (requer GPU, ~2-4h na RTX 4060) — apenas experimentos
docker exec bioguardians-ml python -m app.cli finetune --dataset-dir /data/dataset --output-dir /models/qwen2vl-finetuned

# Reclassificar detecções pendentes de jobs antigos
docker exec bioguardians-ml python -m app.cli classify --all

# Status de um job
docker exec bioguardians-ml python -m app.cli status --job-id 29
```

### Endpoints
- `POST /ingest` — cria job de processamento (worker processa em background)
- `POST /classify` — reclassifica detecções pendentes de jobs antigos (YOLO legacy)
- `GET /jobs` — lista jobs recentes
- `GET /jobs/{id}` — detalhes do job + detecções
- `GET /jobs/{id}/progress` — progresso detalhado (imagens, classificadas, rejeitadas)
- `GET /health` — status do serviço + modelo carregado

### Banco de dados
- Tabelas: `deteccao_job`, `imagem_job`, `deteccao`, `especie`, `ocorrencia`
- `deteccao.metodo_classificacao` = 'ai' (CHECK constraint só permite 'ai' ou 'heuristic')
- `deteccao.modelo_ia` = 'anthropic/claude-sonnet-4' (ou 'qwen2vl-local' em experimentos)
- `deteccao.status` = 'classified' ou 'rejected'
- `ocorrencia.confianca_ia` — confiança da IA em coluna numérica (migration 019), exibida como % no frontend
- `ocorrencia.fonte` inclui 'camera_trap' e 'deteccao_ia' (migrations 016, 018)
- `especie.categoria_fonte` — procedência da categoria de ameaça: 'mma', 'iucn', 'ai', 'manual' (migration 020)
- **A IA NÃO atribui categoria de ameaça** — novas espécies nascem como 'DD'/'ai'; `scripts/data/validate_categories.mjs` corrige depois via MMA/IUCN
- Categorias válidas: CR, EN, VU, NT, LC, DD, **NE** (Sem Risco — não-fauna: humanos, domésticos; migrations 021/022)
- `imagem_job` tem checkpoint único por `(source, source_image_id)` — idempotente
- Dedup adicional: `image_hash` (SHA-256) e `deployment_id`+`timestamp` pulam registros idênticos
- Migrações 016 (bulk), 017 (job filtros), 018 (fonte deteccao_ia), 019 (confianca_ia), 020 (categoria_fonte), 021/022 (categoria NE)

### Validação de categorias de ameaça
- Script: `scripts/data/validate_categories.mjs` — roda com `--dry-run` pra ver o que mudaria
- Hierarquia: **MMA** (lista oficial, `input/mma_especies.csv`) > **IUCN** (via GBIF API) > **AI** (mantém mas marca 'ai' = não confiável)
- Também marca espécies não-fauna (humanos, animais domésticos) como `status='inativo'`

### Env vars
- `DATABASE_URL` — string de conexão PostgreSQL
- `OPENROUTER_API_KEY` — chave OpenRouter (classificador principal)
- `OPENROUTER_MODEL` — modelo (default: `anthropic/claude-sonnet-4`)
- `LOCAL_VLM_ENABLED` — `false` = só OpenRouter (padrão atual)
- `YOLO_DEVICE` — device VLM local: `cuda` ou `cpu` (reaproveita o nome da var)
- `WI_EMAIL` / `WI_PASSWORD` — credenciais Wildlife Insights
- `WI_CACHE_ONLY` — `true` = não baixa imagens novas, processa só o cache
- `SPECIES_CONFIDENCE_THRESHOLD` — threshold de aceitação (default: 0.3)
- `IMAGE_STORAGE_DIR` — diretório de cache de imagens (default: `/app/images`)
- `VLM_CONCURRENCY` — chamadas OpenRouter simultâneas (default: 8)

## Carga de dados
- Scripts em `scripts/data/` carregam dados reais de MMA, GBIF, speciesLink e CNUC
- `load_mma_especies.mjs` — importa lista de espécies ameaçadas do MMA
- `load_gbif_ocorrencias.mjs` — importa ocorrências da API GBIF
- `load_specieslink_ocorrencias.mjs` — importa ocorrências do speciesLink
- `load_cnuc_ucs.mjs` — importa Unidades de Conservação do ICMBio/CNUC
- `enrich_species_descriptions.mjs` — busca resumos na Wikipedia/Wikidata/iNaturalist
- `enrich_species_images.mjs` — busca imagens no iNaturalist/Wikimedia/GBIF/EOL

## Observabilidade (OpenTelemetry + Grafana stack)

### Arquitetura
```
Backend (Node.js) ──OTLP/gRPC──> OTel Collector ──> Prometheus (metrics)
                                  ├──> Tempo (traces)
                                  └──> Loki (logs via OTLP/HTTP)
Grafana (:3000) lê de Prometheus + Tempo + Loki
```

### Arquivos
- `backend/src/telemetry/instrumentation.ts` — SDK Node + auto-instrumentações (Express, pg, http)
- `backend/src/telemetry/logger.ts` — logger OTel nativo (JSON em prod, pretty em dev)
- `backend/src/telemetry/metrics.ts` — métricas customizadas (cache hit/miss, errors)
- `backend/src/middleware/requestLogger.ts` — log de cada request HTTP
- `otel-collector-config.yaml` — config do Collector (receivers, processors, exporters)
- `observability/prometheus.yml` — scrape config
- `observability/tempo.yml` — Tempo (local storage)
- `observability/loki.yml` — Loki (filesystem, OTLP nativo)
- `observability/grafana/provisioning/` — datasources + dashboard provider
- `observability/grafana/dashboards/bioguardians-overview.json` — dashboard Fase 1
- `docker-compose.observability.yml` — overlay (5 serviços)

### Como subir
```bash
# Só a aplicação (sem observabilidade)
docker compose -f docker-compose.prod.yml up -d

# Aplicação + observabilidade
docker compose -f docker-compose.prod.yml -f docker-compose.observability.yml up -d
```

### Acesso
- Grafana: http://localhost:3000 (admin/admin)
- Prometheus: http://localhost:9090
- Tempo: http://localhost:3200
- Loki: http://localhost:3100/ready

### Instrumentação
- **Auto-instrumentação**: `@opentelemetry/auto-instrumentations-node` instrumenta Express, pg, http automaticamente
- **Condicional**: só ativa se `OTEL_EXPORTER_OTLP_ENDPOINT` estiver definida (no-op em dev sem overlay)
- **gRPC**: traces + metrics via gRPC (:4317); logs via HTTP (:4318)
- **Filtros**: `/api/health` não gera spans (ruído)
- **Pool DB**: max=20, connectionTimeout=10s, idleTimeout=30s

### Métricas disponíveis
- `http_server_request_duration_seconds` (histogram) — latency por rota
- `db_client_operation_duration_seconds` (histogram) — query duration
- `db_client_connections_usage` (gauge) — pool active/idle
- `bioguardians_cache_hits_total` / `bioguardians_cache_misses_total` (counter) — cache hit rate
- `bioguardians_errors_total` (counter) — erros por tipo/status

## Produção com domínio próprio

### Arquitetura alvo
```
Internet → Cloudflare (DNS + HTTPS) → Nginx na VM → Docker
  financemobile.com.br              → 127.0.0.1:8080  (frontend)
  api.financemobile.com.br          → 127.0.0.1:3001  (backend)
  grafana.financemobile.com.br      → 127.0.0.1:3000  (Grafana)
  pgadmin.financemobile.com.br      → 127.0.0.1:5050  (pgAdmin — direto na VM)
  portainer.financemobile.com.br    → 127.0.0.1:9443  (Portainer — direto na VM)
```

### Variáveis de ambiente
- `VITE_API_URL=https://api.financemobile.com.br/api` (frontend — deve terminar em `/api`)
- `FRONTEND_URL=https://financemobile.com.br` (backend — CORS origin exata)
- `CORS_ORIGIN=https://financemobile.com.br` (backend)
- `VITE_MAPTILER_API_KEY` (frontend — obrigatório para o mapa)

### Portas
- Abertas para Internet: 80, 443, 22
- Acesso administrativo/local: 8080 (frontend via Nginx), 9443 (Portainer)
- Fechadas externamente: 3000, 3001, 5050, 5432, 9090, 3100, 3200, 4317

### Deploy
- O workflow `deploy.yml` builda imagens GHCR de **backend e frontend** (não builda ML service), aplica migrations, renderiza `stack.yml` e sobe na VM.
- A VM usa `stack.yml` (não `docker-compose.prod.yml`) com `docker compose -f stack.yml up -d`.
- **ML service NÃO é deployado na VM** — roda localmente na máquina com GPU (RTX 4060).
- PostgreSQL pode rodar nativamente na VM; o backend conecta via `host.docker.internal` ou IP local.
- Nginx termina TLS e faz proxy reverso para `127.0.0.1:8080` e `127.0.0.1:3001`.
- Certificados ficam em `/etc/cloudflare/` (ou similar) com permissão 600 na chave privada.

- Fechadas para externo: 3000, 3001, 5050, 5432
- Frontend expõe `127.0.0.1:8080` (só Nginx da VM acessa)
- Backend expõe `127.0.0.1:3001` (só Nginx da VM acessa)

### Nginx
- Config no repo: `infra/nginx/bioguardians.conf`
- Configurar na VM em: `/etc/nginx/sites-available/bioguardians`
- Certificado Cloudflare Origin CA: `/etc/cloudflare/origin-ca.crt`
- Chave privada: `/etc/cloudflare/origin-ca.key`
- NÃO commitar certificado/chave no Git.
- pgAdmin e Portainer rodam direto na VM (fora do stack.yml Docker Compose)
```

### Cloudflare
- `A @`   → IP público VM (Proxied)
- `A api` → IP público VM (Proxied)
- SSL/TLS → Full (strict)

### Comandos na VM
```bash
# Instalar Nginx
sudo apt update && sudo apt install -y nginx

# Copiar config
sudo cp infra/nginx/financemobile.conf /etc/nginx/sites-available/financemobile
sudo ln -sf /etc/nginx/sites-available/financemobile /etc/nginx/sites-enabled/

# Criar diretório e colocar certificado Origin CA
sudo mkdir -p /etc/cloudflare
sudo chown root:root /etc/cloudflare/origin-ca.crt /etc/cloudflare/origin-ca.key
sudo chmod 600 /etc/cloudflare/origin-ca.key

# Testar e reiniciar
sudo nginx -t
sudo systemctl reload nginx

# Reiniciar aplicação
sudo docker compose -f stack.yml pull
sudo docker compose -f stack.yml up -d
```

