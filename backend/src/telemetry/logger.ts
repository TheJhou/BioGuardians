// Structured logger backed by OpenTelemetry Logs API.
// In production: emits JSON to stdout (captured by Docker/Collector pipeline).
// In development: pretty-prints with ANSI colors to the console.
// If OTel SDK is not initialized, logs still go to console — just without OTLP export.

import { logs, SeverityNumber, type LogAttributes } from '@opentelemetry/api-logs';

const otelLogger = logs.getLogger('bioguardians-backend');

type LogMeta = Record<string, unknown>;
type Level = 'info' | 'warn' | 'error';

const SEVERITY: Record<Level, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

const ANSI: Record<Level, string> = {
  info: '\x1b[96m',
  warn: '\x1b[93m',
  error: '\x1b[91m',
};
const ANSI_RESET = '\x1b[0m';

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function formatPretty(level: Level, message: string, meta: LogMeta | undefined): string {
  const time = new Date().toTimeString().slice(0, 8);
  const label = level.toUpperCase().padEnd(5);
  const prefix = `${ANSI[level]}${label}${ANSI_RESET}`;

  const { stack, ...rest } = meta ?? {};
  const restText = Object.entries(rest)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');

  const lines = [`${prefix} ${time} ${message}${restText ? `  ${restText}` : ''}`];
  if (typeof stack === 'string') {
    lines.push(...stack.split('\n').map((line) => `  ${line.trim()}`));
  }
  return lines.join('\n');
}

function write(level: Level, message: string, meta?: LogMeta): void {
  const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  // Emit via OTel Logs API (sent to Collector → Loki if SDK is active).
  otelLogger.emit({
    severityNumber: SEVERITY[level],
    severityText: level,
    body: message,
    attributes: meta as LogAttributes | undefined,
  });

  // Also write to console for local dev and Docker stdout capture.
  if (process.env.NODE_ENV === 'production') {
    output(JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta }));
    return;
  }

  const isTty = level === 'error' ? process.stderr.isTTY : process.stdout.isTTY;
  if (isTty) {
    output(formatPretty(level, message, meta));
  } else {
    output(JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta }));
  }
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    write('info', message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    write('warn', message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    write('error', message, meta);
  },
};
