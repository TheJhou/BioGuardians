// Custom application metrics beyond what auto-instrumentation provides.
// Uses OTel Metrics API — if SDK is not initialized, returns no-op instruments.

import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('bioguardians-backend', '1.0.0');

// --- Cache metrics ---
export const cacheHits = meter.createCounter('bioguardians_cache_hits_total', {
  description: 'Total number of cache hits',
  unit: '1',
});

export const cacheMisses = meter.createCounter('bioguardians_cache_misses_total', {
  description: 'Total number of cache misses',
  unit: '1',
});

// --- Error metrics ---
export const errorCounter = meter.createCounter('bioguardians_errors_total', {
  description: 'Total errors by type and status code',
  unit: '1',
});
