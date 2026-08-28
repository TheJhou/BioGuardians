import { Router } from 'express';
import { query } from '../db/pool.js';
import { validateId } from '../middleware/validateId.js';
import { cacheMiddleware, cacheInvalidateAll } from '../cache/cache.js';
import { env } from '../config/env.js';
import { parseParam, getParam } from '../utils/params.js';

const router = Router();

// GET /api/ocorrencias?especie_id=42 — returns GeoJSON FeatureCollection
router.get('/', async (req, res, next) => {
  try {
    const { especie_id, fonte, limit } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (especie_id) {
      conditions.push(`o.especie_id = $${idx++}`);
      params.push(parseParam(especie_id));
    }
    if (fonte) {
      conditions.push(`o.fonte = $${idx++}`);
      params.push(fonte);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = limit ? `LIMIT $${idx++}` : 'LIMIT 500';
    if (limit) params.push(parseParam(limit));

    const { rows } = await query(
      `SELECT json_build_object(
         'type', 'FeatureCollection',
         'features', COALESCE(json_agg(
           json_build_object(
             'type', 'Feature',
             'id', o.id,
             'geometry', ST_AsGeoJSON(o.geom)::json,
             'properties', json_build_object(
               'especie_id', o.especie_id,
               'lat', o.lat,
               'lon', o.lon,
               'data_evento', o.data_evento,
               'fonte', o.fonte,
               'base_registro', o.base_registro,
               'nome_cientifico', e.nome_cientifico,
               'categoria_ameaca', e.categoria_ameaca
             )
           )
         ), '[]'::json)
       ) AS geojson
       FROM ocorrencia o
       JOIN especie e ON e.id = o.especie_id
       ${where}
       ORDER BY o.data_evento DESC NULLS LAST
       ${limitClause}`,
      params
    );

    res.json(rows[0].geojson);
  } catch (err) { next(err); }
});

// POST /api/ocorrencias — lat/lon provided, trigger syncs geom
router.post('/', async (req, res, next) => {
  try {
    const { especie_id, lat, lon, data_evento, fonte, base_registro } = req.body;

    if (!especie_id || lat === undefined || lon === undefined) {
      res.status(400).json({ error: 'especie_id, lat and lon are required' });
      return;
    }

    const result = await query(
      `INSERT INTO ocorrencia (especie_id, lat, lon, geom, data_evento, fonte, base_registro)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, $5, $6)
       RETURNING id`,
      [especie_id, lat, lon, data_evento || null, fonte || 'manual', base_registro || null]
    );

    cacheInvalidateAll(['route:/api/ocorrencias', 'route:/api/dashboard']);
    res.status(201).json({ id: result.rows[0].id, message: 'Occurrence created' });
  } catch (err) { next(err); }
});

// DELETE /api/ocorrencias/:id
router.delete('/:id', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { rowCount } = await query('DELETE FROM ocorrencia WHERE id = $1', [id]);

    if (rowCount === 0) {
      res.status(404).json({ error: 'Occurrence not found' });
      return;
    }

    cacheInvalidateAll(['route:/api/ocorrencias', 'route:/api/dashboard']);
    res.json({ message: 'Occurrence deleted' });
  } catch (err) { next(err); }
});

// GET /api/ocorrencias/gbif?especie=panthera+onca — proxy to GBIF API, cached 5min
router.get('/gbif', cacheMiddleware(
  (req) => `gbif:${req.query.especie}`,
  () => 300_000
), async (req, res, next) => {
  try {
    const { especie } = req.query;
    if (!especie) {
      res.status(400).json({ error: 'especie query param is required' });
      return;
    }

    const url = `${env.gbifApiBase}/occurrence/search?country=BR&scientificName=${encodeURIComponent(especie as string)}&limit=50&hasCoordinate=true`;

    const response = await fetch(url);
    if (!response.ok) {
      res.status(response.status).json({ error: 'GBIF API error' });
      return;
    }

    const data = await response.json() as { results?: Record<string, unknown>[]; count?: number };
    const features = (data.results || []).map((r) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [r.decimalLongitude, r.decimalLatitude],
      },
      properties: {
        especie: r.scientificName,
        data: r.eventDate,
        fonte: 'gbif',
        base_registro: r.institutionCode,
        gbif_id: r.key,
      },
    }));

    res.json({
      type: 'FeatureCollection',
      features,
      count: features.length,
      gbif_total: data.count,
    });
  } catch (err) { next(err); }
});

export default router;
