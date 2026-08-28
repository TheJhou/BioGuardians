// OpenTelemetry SDK initialization.
// Must be imported BEFORE other modules so auto-instrumentation can patch them.
// Conditional: only starts if OTEL_EXPORTER_OTLP_ENDPOINT is set — no-op otherwise.
//
// Architecture:
//   Backend ──OTLP/gRPC──> Collector ──> Prometheus (metrics)
//                                   └──> Tempo (traces)
//   Backend ──OTLP/HTTP──> Collector ──> Loki (logs)

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes, defaultResource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

const grpcEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const httpLogsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;

if (grpcEndpoint) {
  const serviceName = process.env.OTEL_SERVICE_NAME || 'bioguardians-backend';

  // Derive HTTP logs endpoint from gRPC endpoint if not explicitly set.
  // gRPC is on :4317, HTTP is on :4318.
  const logsUrl = httpLogsEndpoint
    ? `${httpLogsEndpoint}/v1/logs`
    : `${grpcEndpoint.replace(':4317', ':4318')}/v1/logs`;

  const sdk = new NodeSDK({
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
      })
    ),
    traceExporter: new OTLPTraceExporter({ url: grpcEndpoint }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: grpcEndpoint }),
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: logsUrl }),
      }),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is noisy and not useful for this project.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // Skip health-check requests — they pollute traces without value.
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) =>
            Boolean(req.url?.startsWith('/api/health')),
        },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown — flush pending telemetry before exit.
  process.on('SIGTERM', () => {
    sdk.shutdown().finally(() => process.exit(0));
  });
}
