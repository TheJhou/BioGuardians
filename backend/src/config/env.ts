import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  port: parseInt(process.env.PORT || '3001', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  cache: {
    ttlMs: parseInt(process.env.CACHE_TTL_MS || '30000', 10),
    max: parseInt(process.env.CACHE_MAX || '100', 10),
  },
  gbifApiBase: process.env.GBIF_API_BASE || 'https://api.gbif.org/v1',
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '20', 10),
} as const;
