import { LRUCache } from 'lru-cache';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { cacheHits, cacheMisses } from '../telemetry/metrics.js';

// L1 in-memory LRU cache for read-heavy endpoints.
const cache = new LRUCache<string, Record<string, unknown>>({
  max: env.cache.max,
  ttl: env.cache.ttlMs,
});

// Invalidate cache entries matching a prefix (e.g. "dashboard:*").
export function cacheInvalidate(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

// Invalidate multiple prefixes at once (used after mutations).
export function cacheInvalidateAll(prefixes: string[]): void {
  for (const prefix of prefixes) cacheInvalidate(prefix);
}

// Express middleware that caches GET responses by URL.
// keyFn: builds cache key from request (default: req.originalUrl)
// ttlFn: optional per-route TTL override (ms)
// Also sends Cache-Control header so browsers/CDN can cache too.
export function cacheMiddleware(
  keyFn: (req: Request) => string = (req) => `route:${req.originalUrl}`,
  ttlFn?: (req: Request) => number
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET') return next();

    const key = keyFn(req);
    const ttl = ttlFn ? ttlFn(req) : env.cache.ttlMs;
    res.set('Cache-Control', `public, max-age=${Math.floor(ttl / 1000)}`);

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
