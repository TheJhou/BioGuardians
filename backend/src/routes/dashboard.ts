import { Router } from 'express';
import { query } from '../db/pool.js';
import { cacheMiddleware, cacheInvalidateAll } from '../cache/cache.js';

const router = Router();

// GET /api/dashboard — returns data from 4 materialized views in parallel.
// Cached for 60s. Uses Promise.all to fetch all views concurrently.
router.get('/', cacheMiddleware(undefined, () => 60_000), async (_req, res, next) => {
  try {
    const [stats, ranking, ucsEsfera, especiesUc, occBioma, occAno, ucsCategoria] = await Promise.all([
      query('SELECT * FROM dashboard_stats'),
      query('SELECT * FROM ranking_especies_categoria'),
      query('SELECT * FROM ucs_por_esfera'),
      query('SELECT * FROM especies_por_uc ORDER BY area_nome, nome_cientifico'),
      // Ocorrências por bioma via vínculo espécie↔bioma (uma ocorrência conta
      // em cada bioma associado à espécie).
      query(
        `SELECT b.nome, COUNT(*)::int AS total
         FROM ocorrencia o
         JOIN especie e ON e.id = o.especie_id AND e.status = 'ativo'
         JOIN especie_bioma eb ON eb.especie_id = o.especie_id
         JOIN bioma b ON b.id = eb.bioma_id
         GROUP BY b.nome
         ORDER BY total DESC`
      ),
      // Ocorrências por ano do evento (a partir de 2000 — antes disso é ruido).
      query(
        `SELECT EXTRACT(YEAR FROM o.data_evento)::int AS ano, COUNT(*)::int AS total
         FROM ocorrencia o
         JOIN especie e ON e.id = o.especie_id AND e.status = 'ativo'
         WHERE o.data_evento IS NOT NULL
           AND EXTRACT(YEAR FROM o.data_evento) >= 2000
         GROUP BY ano
         ORDER BY ano`
      ),
      query(
        `SELECT categoria_uc, COUNT(*)::int AS total
         FROM area_protegida
         GROUP BY categoria_uc`
      ),
    ]);

    res.json({
      stats: stats.rows[0],
      ranking: ranking.rows,
      ucs_por_esfera: ucsEsfera.rows,
      especies_por_uc: especiesUc.rows,
      ocorrencias_por_bioma: occBioma.rows,
      ocorrencias_por_ano: occAno.rows,
      ucs_por_categoria: ucsCategoria.rows,
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
