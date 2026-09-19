import { Router } from 'express';
import { query } from '../db/pool.js';
import { cacheMiddleware, cacheInvalidateAll } from '../cache/cache.js';

const router = Router();

// GET /api/dashboard — returns data from 4 materialized views in parallel.
// Cached for 60s. Uses Promise.all to fetch all views concurrently.
router.get('/', cacheMiddleware(undefined, () => 60_000), async (_req, res, next) => {
  try {
    const [stats, ranking, ucsEsfera, especiesUc, especiesBioma, occAno, ucsCategoria, topEspecies] = await Promise.all([
      query('SELECT total_especies::int, total_cr::int, total_en::int, total_vu::int, total_nt::int, total_lc::int, total_dd::int, total_areas::int, area_total_ha::float, total_ocorrencias::int FROM dashboard_stats'),
      query('SELECT * FROM ranking_especies_categoria'),
      query('SELECT * FROM ucs_por_esfera'),
      query('SELECT * FROM especies_por_uc ORDER BY area_nome, nome_cientifico'),
      // Espécies por bioma (via vínculo especie↔bioma).
      query(
        `SELECT b.nome, COUNT(DISTINCT e.id)::int AS total
         FROM bioma b
         JOIN especie_bioma eb ON eb.bioma_id = b.id
         JOIN especie e ON e.id = eb.especie_id AND e.status = 'ativo'
         GROUP BY b.nome
         ORDER BY total DESC`
      ),
      // Ocorrências por ano — data_evento com fallback para criado_em,
      // assim registros sem data do evento também entram no gráfico.
      query(
        `SELECT EXTRACT(YEAR FROM COALESCE(o.data_evento, o.criado_em))::int AS ano, COUNT(*)::int AS total
         FROM ocorrencia o
         GROUP BY ano
         ORDER BY ano`
      ),
      query(
        `SELECT categoria_uc, COUNT(*)::int AS total
         FROM area_protegida
         GROUP BY categoria_uc`
      ),
      // Top 6 espécies por número de ocorrências.
      query(
        `SELECT o.especie_id, e.nome_cientifico, e.nome_popular, COUNT(*)::int AS total
         FROM ocorrencia o
         JOIN especie e ON e.id = o.especie_id AND e.status = 'ativo'
         GROUP BY o.especie_id, e.nome_cientifico, e.nome_popular
         ORDER BY total DESC, e.nome_cientifico
         LIMIT 6`
      ),
    ]);

    res.json({
      stats: stats.rows[0],
      ranking: ranking.rows,
      ucs_por_esfera: ucsEsfera.rows,
      especies_por_uc: especiesUc.rows,
      especies_por_bioma: especiesBioma.rows,
      ocorrencias_por_ano: occAno.rows,
      ucs_por_categoria: ucsCategoria.rows,
      especies_mais_ocorrencias: topEspecies.rows,
    });
  } catch (err) { next(err); }
});

// POST /api/dashboard/refresh — refreshes all materialized views, invalidates cache
// CONCURRENTLY não pode rodar dentro de função (transaction) — cada query() é
// uma transação implícita separada, então os 4 refreshs não bloqueiam leituras.
router.post('/refresh', async (_req, res, next) => {
  try {
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_stats');
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY especies_por_uc');
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_especies_categoria');
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY ucs_por_esfera');
    cacheInvalidateAll(['route:/api/dashboard']);
    res.json({ message: 'Dashboard refreshed' });
  } catch (err) { next(err); }
});

export default router;
