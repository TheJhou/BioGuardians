import { Router } from 'express';
import { query } from '../db/pool.js';
import { cacheMiddleware, cacheInvalidateAll } from '../cache/cache.js';

const router = Router();

// GET /api/dashboard — returns data from 4 materialized views in parallel.
// Cached for 60s. Uses Promise.all to fetch all views concurrently.
router.get('/', cacheMiddleware(undefined, () => 60_000), async (_req, res, next) => {
  try {
    const [stats, ranking, ucsEsfera, especiesUc] = await Promise.all([
      query('SELECT * FROM dashboard_stats'),
      query('SELECT * FROM ranking_especies_categoria'),
      query('SELECT * FROM ucs_por_esfera'),
      query('SELECT * FROM especies_por_uc ORDER BY area_nome, nome_cientifico'),
    ]);

    res.json({
      stats: stats.rows[0],
      ranking: ranking.rows,
      ucs_por_esfera: ucsEsfera.rows,
      especies_por_uc: especiesUc.rows,
    });
  } catch (err) { next(err); }
});

// POST /api/dashboard/refresh — refreshes all materialized views, invalidates cache
router.post('/refresh', async (_req, res, next) => {
  try {
    await query('SELECT refresh_dashboard()');
    cacheInvalidateAll(['route:/api/dashboard']);
    res.json({ message: 'Dashboard refreshed' });
  } catch (err) { next(err); }
});

export default router;
