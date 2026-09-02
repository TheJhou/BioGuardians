import { Router } from 'express';
import { cacheMiddleware } from '../cache/cache.js';
import { env } from '../config/env.js';

const router = Router();

/**
 * Proxy routes to the Python ML microservice.
 * The ML service handles satellite image fetching, animal detection,
 * species classification, and database persistence independently.
 *
 * All routes are thin proxies — no business logic in Node.js.
 */

// GET /api/deteccoes/jobs — list recent detection jobs (cached 10s)
router.get('/jobs', cacheMiddleware(undefined, () => 10_000), async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const url = `${env.mlServiceUrl}/jobs?limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'ML service error' }));
      res.status(response.status).json(error);
      return;
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/deteccoes/jobs/:id — get job details + detections (cached 10s)
router.get('/jobs/:id', cacheMiddleware(
  (req) => `deteccoes:job:${req.params.id}`,
  () => 10_000
), async (req, res, next) => {
  try {
    const url = `${env.mlServiceUrl}/jobs/${req.params.id}`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      const error = await response.json().catch(() => ({ error: 'ML service error' }));
      res.status(response.status).json(error);
      return;
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
