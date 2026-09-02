# BioGuardians — Project Info

## Stack
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Backend**: Node.js 22 + Express + TypeScript (porta 3001)
- **Frontend**: React 19 + Vite + TypeScript + MapLibre GL + MapTiler Cloud
- **ML Service**: Python 3.11 + FastAPI + YOLOv8 + PyTorch (porta 8001)
- **Infra**: Docker Compose, Nginx, Oracle Cloud VM
- **CI/CD**: GitHub Actions (build, migrations, deploy)
- **Observabilidade**: OpenTelemetry, Grafana, Tempo, Prometheus, Loki

## Migrations
- Sistema customizado em `db/migrate.sh` (sem ferramentas de terceiros)
- Arquivos SQL em `db/migrations/` (numerados, aplicados em ordem)
- Journal table: `schema_migrations` (filename + checksum SHA-256)
- Cada migration roda em transação atômica
- Idempotente: rodar de novo pula o já aplicado
- Hash detecta adulteração de migrations já aplicadas
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
- Rota proxy ML (somente leitura): `GET /api/deteccoes/jobs`, `GET /api/deteccoes/jobs/:id` (proxy para o microserviço Python na porta 8001)
- Cache LRU em memória com invalidação por rota
- OpenTelemetry condicional (só ativa com `OTEL_EXPORTER_OTLP_ENDPOINT`)

## ML Service (detecção por satélite)
- Microserviço Python isolado em `ml-service/` (FastAPI + YOLOv8 + PyTorch)
- Porta 8001, container Docker separado (`bioguardians-ml`)
- Busca imagens CBERS-4A WPM (2m resolução) no INPE via biblioteca `cbers4asat`
- Pipeline: buscar imagem → detectar animais (YOLOv8) → classificar espécie → salvar como `ocorrencia` com `fonte='deteccao_satelite'`
- Ocorrências detectadas aparecem automaticamente no mapa existente (sem UI separada)
- Tabelas: `deteccao_job`, `deteccao`, `modelo_ml` (migration 014)
- Rastreio de IA: `deteccao.metodo_classificacao` ('ai' ou 'heuristic'), `modelo_ia`, `confianca_ia` (migration 015)
- Env vars: `INPE_EMAIL` (cadastro em dgi.inpe.br), `ML_SERVICE_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- Endpoints: `POST /batch` (interno), `GET /jobs`, `GET /jobs/:id`, `GET /health`
- **Sem trigger público**: detecção é disparada offline via CLI ou endpoint interno, nunca pela API pública
- `POST /batch` não é proxyado pelo backend nem exposto no Nginx — só acessível dentro da rede Docker

### Classificação por IA (OpenRouter + Claude Sonnet 4)
- Após YOLOv8 detectar um animal, o recorte da imagem é enviado ao OpenRouter (Claude Sonnet 4)
- A IA retorna: nome científico, nome popular, descrição e categoria de ameaça (CR/EN/VU/NT/LC/DD)
- Se a espécie não existe no banco, é criada automaticamente (`find_or_create_species`)
- Descrição e categoria de ameaça sobrescrevem os dados existentes na tabela `especie`
- Se `OPENROUTER_API_KEY` não estiver configurada, cai pro classificador heurístico (fallback)
- Custo por imagem: ~$0.01-0.03 (Claude Sonnet 4, 600 max tokens)

### Batch de detecção (offline)
- Processa todas as áreas protegidas lendo `area_protegida.geom` do banco
- Cada área vira um job em `deteccao_job` com bbox calculado do polígono
- Disparo via CLI dentro do container:
  ```bash
  docker exec bioguardians-ml python -m app.cli batch --date 2026-09-01
  docker exec bioguardians-ml python -m app.cli batch --date 2026-09-01 --area-ids 1,2,3
  ```
- Ou via endpoint interno (dentro da rede Docker):
  ```bash
  curl -X POST http://ml-service:8001/batch -H "Content-Type: application/json" -d '{"date":"2026-09-01"}'
  ```
- Cron na VM (exemplo — domingo 03:00):
  ```bash
  0 3 * * 0 docker exec bioguardians-ml python -m app.cli batch --date $(date -d '7 days ago' +\%Y-\%m-\%d) >> /var/log/bioguardians-batch.log 2>&1
  ```

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
  your-domain.com     → 127.0.0.1:8080 (frontend)
  api.your-domain.com → 127.0.0.1:3001 (backend)
```

### Variáveis de ambiente
- `VITE_API_URL=https://api.your-domain.com/api` (frontend — deve terminar em `/api`)
- `FRONTEND_URL=https://your-domain.com` (backend — CORS origin exata)
- `CORS_ORIGIN=https://your-domain.com` (backend)
- `VITE_MAPTILER_API_KEY` (frontend — obrigatório para o mapa)

### Portas
- Abertas para Internet: 80, 443, 22
- Acesso administrativo/local: 8080 (frontend via Nginx), 9443 (Portainer)
- Fechadas externamente: 3000, 3001, 5432, 9090, 3100, 3200, 4317

### Deploy
- O workflow `deploy.yml` builda imagens GHCR, aplica migrations, renderiza `stack.yml` e sobe na VM.
- A VM usa `stack.yml` (não `docker-compose.prod.yml`) com `docker compose -f stack.yml up -d`.
- PostgreSQL pode rodar nativamente na VM; o backend conecta via `host.docker.internal` ou IP local.
- Nginx termina TLS e faz proxy reverso para `127.0.0.1:8080` e `127.0.0.1:3001`.
- Certificados ficam em `/etc/cloudflare/` (ou similar) com permissão 600 na chave privada.

- Fechadas para externo: 3000, 3001, 5432
- Frontend expõe `127.0.0.1:8080` (só Nginx da VM acessa)
- Backend expõe `127.0.0.1:3001` (só Nginx da VM acessa)

### Nginx
- Configurar na VM em: `/etc/nginx/sites-available/your-domain`
- Certificado Cloudflare Origin CA: `/etc/cloudflare/origin-ca.crt`
- Chave privada: `/etc/cloudflare/origin-ca.key`
- NÃO commitar certificado/chave no Git.

Exemplo de config (substitua `your-domain.com`):
```nginx
upstream frontend { server 127.0.0.1:8080; }
upstream backend  { server 127.0.0.1:3001; }

server {
  listen 80;
  server_name your-domain.com api.your-domain.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name your-domain.com;
  ssl_certificate     /etc/cloudflare/origin-ca.crt;
  ssl_certificate_key /etc/cloudflare/origin-ca.key;
  location / {
    proxy_pass http://frontend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 443 ssl http2;
  server_name api.your-domain.com;
  ssl_certificate     /etc/cloudflare/origin-ca.crt;
  ssl_certificate_key /etc/cloudflare/origin-ca.key;
  client_max_body_size 10M;
  location / {
    proxy_pass http://backend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
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

