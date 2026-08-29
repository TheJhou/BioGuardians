# BioGuardians — Observabilidade

Documentação completa da stack de observabilidade: OpenTelemetry, Grafana, Tempo, Prometheus e Loki.

---

## 1. Arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BioGuardians                                │
│                                                                      │
│   Backend (Node.js) ──OTLP/gRPC──> OpenTelemetry Collector          │
│        │                              │                             │
│        │                              ├──> Prometheus (:9090)       │
│        │                              ├──> Tempo     (:3200)        │
│        │                              └──> Loki      (:3100)        │
│        │                                                              │
│        └──── logs/stdout ──────────> Loki (via OTLP/HTTP)           │
│                                                                      │
│   Grafana (:3000) lê de Prometheus + Tempo + Loki                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Componentes

| Componente | Função | Porta | Imagem |
|------------|--------|-------|--------|
| **OpenTelemetry Collector** | Recebe traces/metrics/logs do backend e encaminha | `4317` gRPC, `4318` HTTP, `8889` Prometheus exporter | `otel/opentelemetry-collector-contrib` |
| **Prometheus** | Coleta e armazena métricas | `9090` | `prom/prometheus` |
| **Tempo** | Armazena traces distribuídos | `3200` | `grafana/tempo` |
| **Loki** | Armazena logs estruturados | `3100` | `grafana/loki` |
| **Grafana** | Visualização de métricas, traces e logs | `3000` | `grafana/grafana` |

---

## 2. Instrumentação do Backend

Arquivos em `backend/src/telemetry/`:

- `instrumentation.ts` — inicializa o SDK OpenTelemetry Node.js
- `logger.ts` — logger compatível com OTLP
- `metrics.ts` — métricas customizadas (cache hit/miss, erros)

A instrumentação é **condicional**: só ativa se `OTEL_EXPORTER_OTLP_ENDPOINT` estiver definida no `.env`. Sem a variável, o SDK fica em modo no-op, não gerando overhead em dev.

### Variáveis de ambiente

```env
# OpenTelemetry (ativação opcional)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=bioguardians-backend
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

### Auto-instrumentações

- **Express**: HTTP requests
- **pg**: queries no PostgreSQL
- **http**: chamadas externas (GBIF, speciesLink)
- **winston/OTLP**: logs estruturados

### Métricas disponíveis

| Métrica | Tipo | Descrição |
|---------|------|-----------|
| `http_server_request_duration_seconds` | histogram | Latência por rota |
| `db_client_operation_duration_seconds` | histogram | Duração das queries PostgreSQL |
| `db_client_connections_usage` | gauge | Conexões ativas/ociosas do pool |
| `bioguardians_cache_hits_total` | counter | Total de cache hits |
| `bioguardians_cache_misses_total` | counter | Total de cache misses |
| `bioguardians_errors_total` | counter | Erros por tipo/status HTTP |

### Filtros

- `/api/health` não gera spans (evita ruído)
- Traces de assets estáticos são descartados

---

## 3. Como subir

### Apenas aplicação

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Aplicação + observabilidade

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.observability.yml up -d
```

### Local (dev)

```bash
cp .env.example .env
# edite .env com OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317 se quiser ativar
docker compose up -d db migrate backend frontend
docker compose -f docker-compose.observability.yml up -d
```

---

## 4. Acesso

| Serviço | URL | Credenciais |
|---------|-----|-------------|
| Grafana | http://localhost:3000 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| Tempo | http://localhost:3200 | — |
| Loki | http://localhost:3100/ready | — |

> Em produção (Oracle VM), as portas podem estar expostas via Nginx ou VPN.

---

## 5. Dashboards do Grafana

Dashboard provisionado em `observability/grafana/dashboards/bioguardians-overview.json`.

Painéis principais:

1. **Requests HTTP** — taxa de requisições por minuto
2. **Latência P95** — percentil 95 por rota
3. **Erros 4xx/5xx** — taxa de erros ao longo do tempo
4. **Cache Hit Rate** — `hits / (hits + misses)`
5. **Duração das queries SQL** — histograma por operação
6. **Traces por rota** — Explore com link para Tempo
7. **Logs recentes** — filtro por service e nível

### Datasources provisionados

- `Prometheus` → http://prometheus:9090
- `Tempo` → http://tempo:3200
- `Loki` → http://loki:3100

---

## 6. Configuração dos serviços

### OpenTelemetry Collector

Arquivo: `otel-collector-config.yaml`

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:

exporters:
  prometheusremotewrite:
    endpoint: http://prometheus:9090/api/v1/write
  otlp/jaeger:
    endpoint: tempo:4317
  loki:
    endpoint: http://loki:3100/loki/api/v1/push

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheusremotewrite]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [loki]
```

### Prometheus

Arquivo: `observability/prometheus.yml`

- Scrape do Collector em `:8889`
- Scrape do backend em `:3001/metrics` (se exposto)

### Tempo

Arquivo: `observability/tempo.yml`

- Storage local em `/tmp/tempo`
- Recebe OTLP gRPC do Collector

### Loki

Arquivo: `observability/loki.yml`

- Storage local em `/tmp/loki`
- Recebe logs via OTLP/HTTP

### Grafana

Arquivo: `observability/grafana/provisioning/datasources/datasources.yml`

- Datasources declarativos (GitOps)
- Dashboard provider em `observability/grafana/provisioning/dashboards/dashboards.yml`

---

## 7. Correlação de traces, logs e métricas

No Grafana Explore:

1. Selecione **Tempo** e busque por `service.name="bioguardians-backend"`
2. Clique em um trace
3. Verifique os spans de `pg.query` para duração da SQL
4. Nos mesmos spans, clique em **"Logs for this span"** para ver os logs do Loki
5. No dashboard, correlate latência com taxa de erros

---

## 8. Troubleshooting

### Grafana não conecta

```bash
docker compose -f docker-compose.observability.yml logs grafana
```

### Sem traces no Tempo

Verifique se `OTEL_EXPORTER_OTLP_ENDPOINT` aponta para `http://otel-collector:4317` (dentro da rede Docker) e não para `localhost`.

### Sem logs no Loki

Verifique se `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` está definido para `:4318` (HTTP) e se o backend envia logs via OTLP.

### Métricas faltando

Verifique o endpoint do Collector:

```bash
curl http://localhost:8889/metrics
```

Se retornar vazio, o Collector pode não estar exportando.

---

## 9. Decisões de design

- **OpenTelemetry em vez de vendor lock-in**: permite trocar backends futuramente
- **Coletor centralizado**: o backend não conhece o destino final
- **Ativação condicional**: sem observabilidade em dev, sem overhead
- **Traces-SQL**: cada query PostgreSQL é um span, facilitando encontrar gargalos
- **Logs estruturados**: JSON para fácil parsing no Loki
