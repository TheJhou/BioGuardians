import pg from 'pg';
import { trace } from '@opentelemetry/api';
import { env } from '../config/env.js';
import { logger } from '../telemetry/logger.js';

const { Pool } = pg;

const MAX_SQL_LOG_LEN = 500;

function getTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId;
}

function summarizeSql(text: string): string {
  return text.length > MAX_SQL_LOG_LEN ? text.slice(0, MAX_SQL_LOG_LEN) + '...' : text;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: env.dbPoolMax,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const traceId = getTraceId();
  const paramsCount = params?.length ?? 0;

  try {
    const result = await pool.query<T>(text, params as never);
    const duration_ms = Date.now() - start;

    logger.info('pg_query', {
      duration_ms,
      rows: result.rowCount,
      params_count: paramsCount,
      sql: summarizeSql(text),
      ...(traceId ? { trace_id: traceId } : {}),
    });

    return result;
  } catch (err) {
    const duration_ms = Date.now() - start;

    logger.error('pg_query_failed', {
      duration_ms,
      params_count: paramsCount,
      sql: summarizeSql(text),
      error: err instanceof Error ? err.message : String(err),
      ...(traceId ? { trace_id: traceId } : {}),
    });

    throw err;
  }
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
