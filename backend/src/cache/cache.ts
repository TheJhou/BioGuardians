import { LRUCache } from 'lru-cache';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { cacheHits, cacheMisses } from '../telemetry/metrics.js';

// L1 in-memory LRU cache for read-heavy JSON endpoints.
const cache = new LRUCache<string, Record<string, unknown>>({
  max: env.cache.max,
  ttl: env.cache.ttlMs,
});

// Separate cache for vector tiles (binary buffers). Limited by bytes as well
// as count: low-zoom tiles can be tens of KB and the production container
// has 512 MB, so a count-only limit could grow unbounded with many filters.
const tileCache = new LRUCache<string, Buffer>({
  max: 2000,
  maxSize: 64 * 1024 * 1024, // 64 MB
  sizeCalculation: (buf) => Math.max(1, buf.length), // tiles vazios têm 0 byte
  ttl: 60 * 60 * 1000, // 1 hora
});

// Tile cache helpers used by vector tile endpoints.
export function getTileCache(key: string): Buffer | undefined {
  return tileCache.get(key);
}

export function setTileCache(key: string, buffer: Buffer): void {
  tileCache.set(key, buffer);
}

// Express middleware that caches GET responses by URL.
// keyFn: builds cache key from request (default: req.originalUrl)
// ttlFn: optional per-route TTL override (ms)
export function cacheMiddleware(
  keyFn: (req: Request) => string = (req) => `route:${req.originalUrl}`,
  ttlFn?: (req: Request) => number
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET') return next();

    const key = keyFn(req);
    const ttl = ttlFn ? ttlFn(req) : env.cache.ttlMs;

    const cached = cache.get(key);
    if (cached) {
      cacheHits.add(1, { route: req.path });
      res.json(cached);
      return;
    }

    cacheMisses.add(1, { route: req.path });

    // Intercept res.json to cache the response before sending.
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      if (res.statusCode === 200) {
        const record = body as Record<string, unknown>;
        cache.set(key, record, { ttl });
      }
      return originalJson(body);
    };

    next();
  };
}
