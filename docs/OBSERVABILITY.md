# BioGuardians — Observabilidade

Stack de observabilidade: OpenTelemetry, Grafana, Tempo, Prometheus e Loki.

---

## 1. Arquitetura

```
┌───────────────────────────────────────────────────────────────────────────┐
│                               BioGuardians                                │
│                                                                           │
│  Backend (Node.js)                                                        │
│     ├── OTLP/gRPC :4317 (traces + métricas) ──┐                           │
│     └── OTLP/HTTP :4318 (logs) ───────────────┤                           │
│                                               ▼                           │
│                                    OpenTelemetry Collector                │
│                                      ├──> Tempo (OTLP/gRPC, traces)       │
│                                      ├──> exporter Prometheus :8889       │
│                                      │        ▲ scrape (15s)              │
│                                      │     Prometheus (:9090)             │
│                                      └──> Loki (OTLP/HTTP, logs)          │
│                                                                           │
│  Grafana (:3000) lê de Prometheus + Tempo + Loki                          │
└───────────────────────────────────────────────────────────────────────────┘
```

### Componentes

| Componente | Função | Porta | Imagem |
|------------|--------|-------|--------|
| **OpenTelemetry Collector** | Recebe traces/métricas/logs do backend e encaminha | `4317` gRPC, `4318` HTTP, `8889` exporter Prometheus, `13133` health check (interno) | `otel/opentelemetry-collector-contrib:0.110.0` |
| **Prometheus** | Faz scrape do Collector e armazena métricas (retenção 7 dias) | `9090` | `prom/prometheus:v2.55.0` |
| **Tempo** | Armazena traces | `3200` (a porta OTLP 4317 é só interna) | `grafana/tempo:2.6.0` |
| **Loki** | Armazena logs (OTLP nativo) | `3100` | `grafana/loki:3.3.0` |
| **Grafana** | Visualização de métricas, traces e logs | `3000` | `grafana/grafana:11.4.0` |

---

## 2. Instrumentação do Backend

Arquivos em `backend/src/telemetry/`:

- `instrumentation.ts` — inicializa o SDK OpenTelemetry Node.js (importado antes de tudo em `index.ts`)
- `logger.ts` — logger próprio que emite via OTel Logs API (JSON em produção, legível em dev)
- `metrics.ts` — métricas customizadas (cache hit/miss, erros)

Também: `backend/src/middleware/requestLogger.ts` (um log por request) e
`backend/src/db/pool.ts` (log das queries com `traceId`).

A instrumentação é **condicional**: só ativa se `OTEL_EXPORTER_OTLP_ENDPOINT`
estiver definida. Sem a variável, o SDK não é iniciado e não há overhead.

### Variáveis de ambiente

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317       # traces + métricas (gRPC)
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://otel-collector:4318  # logs (HTTP); se ausente, deriva de :4317 → :4318
OTEL_SERVICE_NAME=bioguardians-backend
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

O overlay `docker-compose.observability.yml` e o `stack.yml` já injetam essas
variáveis no backend.

### Auto-instrumentações

`@opentelemetry/auto-instrumentations-node`:

- **http / Express**: requests recebidos e chamadas externas (GBIF, ML service)
- **pg**: cada query no PostgreSQL vira um span

### Métricas disponíveis

| Métrica | Tipo | Descrição |
|---------|------|-----------|
| `http_server_request_duration_seconds` | histogram | Latência por rota |
| `db_client_operation_duration_seconds` | histogram | Duração das queries PostgreSQL |
| `db_client_connections_usage` | gauge | Conexões ativas/ociosas do pool |
| `bioguardians_cache_hits_total` | counter | Cache hits (label `route`) |
| `bioguardians_cache_misses_total` | counter | Cache misses (label `route`) |
| `bioguardians_errors_total` | counter | Erros por tipo/status HTTP |

### Filtros

- Requests para `/api/health` não geram spans (evita ruído do healthcheck)

---

## 3. Como subir

### Dev (app + observabilidade)

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

### Imagens de produção fora da VM

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.observability.yml up -d
```

### Produção (VM)

O `stack.yml` já contém backend, frontend e os 5 serviços de observabilidade.
O workflow de deploy envia `observability/` e `otel-collector-config.yaml` para
`~/bioguardians/` e sobe tudo com `docker compose -f stack.yml up -d`.

---

## 4. Acesso

| Serviço | URL | Credenciais |
|---------|-----|-------------|
| Grafana | http://localhost:3000 | `admin` / `admin` no overlay; na VM a senha vem do secret `GRAFANA_ADMIN_PASSWORD` |
| Prometheus | http://localhost:9090 | — |
| Tempo | http://localhost:3200 | — |
| Loki | http://localhost:3100/ready | — |

Em produção o Grafana é exposto em `grafana.financemobile.com.br` pelo Nginx da
VM. As demais portas publicadas pelo `stack.yml` (3100, 3200, 4317, 4318, 8889,
9090) devem ficar fechadas no firewall.

---

## 5. Dashboard do Grafana

Provisionado em `observability/grafana/dashboards/bioguardians-overview.json`
("BioGuardians — Overview", dashboard inicial do Grafana).

Painéis:

1. HTTP Request Rate
2. HTTP p95 Latency
3. Cache Hit Rate
4. Error Rate
5. HTTP Request Duration by Route
6. PostgreSQL Query Duration p95
7. HTTP Status Codes
8. Cache Hits vs Misses by Route
9. DB Connection Pool
10. HTTP Request Logs (com duração) — Loki
11. Request Traces (rotas, duração, queries) — Tempo

### Datasources provisionados

`observability/grafana/provisioning/datasources/datasources.yml`:

- `Prometheus` → http://prometheus:9090
- `Tempo` → http://tempo:3200
- `Loki` → http://loki:3100 (com derived field `TraceID` → Tempo)

---

## 6. Configuração dos serviços

### OpenTelemetry Collector

Arquivo: `otel-collector-config.yaml`

```yaml
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }

processors:
  batch: { timeout: 5s, send_batch_size: 1000, send_batch_max_size: 2000 }

exporters:
  prometheus:                       # métricas expostas para scrape
    endpoint: 0.0.0.0:8889
    resource_to_telemetry_conversion: { enabled: true }
  otlp/tempo:                       # traces
    endpoint: tempo:4317
    tls: { insecure: true }
  otlphttp/loki:                    # logs (OTLP nativo do Loki 3)
    endpoint: http://loki:3100/otlp
    tls: { insecure: true }

service:
  extensions: [health_check]        # :13133
  pipelines:
    traces:  { receivers: [otlp], processors: [batch], exporters: [otlp/tempo] }
    metrics: { receivers: [otlp], processors: [batch], exporters: [prometheus] }
    logs:    { receivers: [otlp], processors: [batch], exporters: [otlphttp/loki] }
```

### Prometheus

Arquivo: `observability/prometheus.yml`

- Único job: scrape de `otel-collector:8889` a cada 15s
- O backend não expõe `/metrics` — as métricas chegam via Collector

### Tempo

Arquivo: `observability/tempo.yml`

- Binário único, storage local em `/var/tempo` (volume `bioguardians_tempo`)
- Recebe OTLP gRPC do Collector

### Loki

Arquivo: `observability/loki.yml`

- Binário único, filesystem em `/loki` (volume `bioguardians_loki`)
- Recebe logs via OTLP/HTTP em `/otlp`

### Grafana

- Datasources declarativos em `observability/grafana/provisioning/datasources/`
- Dashboard provider em `observability/grafana/provisioning/dashboards/dashboards.yml`

---

## 7. Correlação de traces, logs e métricas

No Grafana Explore:

1. Selecione **Tempo** e busque por `service.name="bioguardians-backend"`
2. Clique em um trace
3. Veja os spans do `pg` para a duração de cada SQL
4. Nos logs do Loki, o campo `TraceID` abre o trace correspondente no Tempo
5. No dashboard, correlacione latência com taxa de erros

---

## 8. Troubleshooting

### Grafana não conecta

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml logs grafana
```

### Sem traces no Tempo

Verifique se `OTEL_EXPORTER_OTLP_ENDPOINT` aponta para `http://otel-collector:4317`
(dentro da rede Docker) e não para `localhost`.

### Sem logs no Loki

Verifique `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` (`http://otel-collector:4318`) e os
logs do Collector.

### Métricas faltando

Verifique o exporter do Collector:

```bash
curl http://localhost:8889/metrics
```

Se retornar vazio, o backend não está enviando métricas (confira a variável
`OTEL_EXPORTER_OTLP_ENDPOINT` no container do backend).

---

## 9. Decisões de design

- **OpenTelemetry em vez de vendor lock-in**: permite trocar os backends depois
- **Collector centralizado**: o backend não conhece o destino final
- **Ativação condicional**: sem observabilidade em dev, sem overhead
- **Traces de SQL**: cada query PostgreSQL é um span, facilitando achar gargalos
- **Logs estruturados**: JSON para fácil parsing no Loki
