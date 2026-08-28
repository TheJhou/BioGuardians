# BioGuardians — Project Info

## Stack
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Backend**: Node.js + Express (próxima etapa)
- **Frontend**: React + Vite + MapTiler Cloud (próxima etapa)
- **Infra**: Docker Compose ou instalação nativa (Oracle Cloud VM)
- **CI/CD**: GitHub Actions (migrations + smoke tests)

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
- Conectar: `psql -d $POSTGRES_DB -U $POSTGRES_USER`
- Refresh views: `SELECT refresh_dashboard();`

## Estrutura do banco (migrations)
1. `001_extensions.sql` — PostGIS, pgcrypto
2. `002_enums_domains.sql` — enums (categoria_ameaca, esfera, etc.) e domínios
3. `003_tables.sql` — tabelas em 3FN com constraints e FKs
4. `004_indexes.sql` — GIST (espaciais) + B-tree (filtros)
5. `005_functions.sql` — funções PL/pgSQL e SQL (consultas espaciais, refresh)
6. `006_triggers.sql` — auditoria, validação de geometria, timestamps
7. `007_materialized_views.sql` — dashboard_stats, especies_por_uc, rankings
8. `008_seed_data.sql` — dados sintéticos (13 espécies, 9 UCs, 21 ocorrências)

## Decisões de modelagem
- SRID 4326 (WGS84) para todas as geometrias
- `nome_cientifico` em domínio próprio (lowercase, trim)
- UF em domínio `CHAR(2)` maiúsculo
- Taxonomia hierárquica com auto-referência (reino → gênero)
- Auditoria via trigger genérico (to_jsonb do registro inteiro)
- Views materializadas com refresh simples (não CONCURRENTLY dentro de função)

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
