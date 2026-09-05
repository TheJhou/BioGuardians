import { Router } from 'express';
import { query } from '../db/pool.js';
import { validateId } from '../middleware/validateId.js';
import { cacheMiddleware, cacheInvalidateAll } from '../cache/cache.js';
import { env } from '../config/env.js';
import { parseParam, getParam } from '../utils/params.js';

const router = Router();

// GET /api/ocorrencias?especie_id=42 — returns GeoJSON FeatureCollection
// Supports bbox (minLng,minLat,maxLng,maxLat) to filter by visible map region.
router.get('/', cacheMiddleware(undefined, () => 7 * 24 * 60 * 60 * 1000), async (req, res, next) => {
  try {
    const { especie_id, categoria, bioma, fonte, limit, bbox, incluir_inativos } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    // Default: hide occurrences of inactive species (non-wildlife, e.g. humans/domestic).
    // Pass incluir_inativos=true to see them.
    if (incluir_inativos !== 'true') {
      conditions.push(`e.status = 'ativo'`);
    }

    if (especie_id) {
      // Aceita lista separada por vírgula (multi-seleção de espécies).
      const ids = String(especie_id).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length > 0) {
        conditions.push(`o.especie_id = ANY($${idx++}::int[])`);
        params.push(ids);
      }
    }
    if (categoria) {
      conditions.push(`e.categoria_ameaca = $${idx++}`);
      params.push(categoria);
    }
    if (bioma) {
      conditions.push(`EXISTS (SELECT 1 FROM especie_bioma eb WHERE eb.especie_id = o.especie_id AND eb.bioma_id = $${idx++})`);
      params.push(parseParam(bioma));
    }
    if (fonte) {
      conditions.push(`o.fonte = $${idx++}`);
      params.push(fonte);
    }
    if (bbox) {
      const parts = String(bbox).split(',').map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        // && (bbox overlap) usa o índice GIST e é mais barato que ST_Intersects
        // — equivalente para pontos contra um envelope retangular.
        conditions.push(`o.geom && ST_MakeEnvelope($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, 4326)`);
        params.push(parts[0], parts[1], parts[2], parts[3]);
        idx += 4;
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = limit ? `LIMIT $${idx++}` : 'LIMIT 10000';
    if (limit) params.push(parseParam(limit));

    const { rows } = await query(
      `SELECT json_build_object(
         'type', 'FeatureCollection',
         'features', COALESCE((
           SELECT json_agg(feature)
           FROM (
             SELECT json_build_object(
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
                'confianca_ia', o.confianca_ia,
                 'nome_cientifico', e.nome_cientifico,
                 'nome_popular', e.nome_popular,
                 'imagem_url', e.imagem_url,
                 'categoria_ameaca', e.categoria_ameaca
               )
             ) AS feature
             FROM ocorrencia o
             JOIN especie e ON e.id = o.especie_id
             ${where}
             ${limitClause}
           ) sub
         ), '[]'::json)
       ) AS geojson`,
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
