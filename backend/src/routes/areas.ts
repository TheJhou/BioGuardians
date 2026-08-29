import { Router } from 'express';
import { query } from '../db/pool.js';
import { validateId } from '../middleware/validateId.js';
import { cacheMiddleware, cacheInvalidateAll } from '../cache/cache.js';
import { parseParam, getParam } from '../utils/params.js';

const router = Router();

// GET /api/areas — returns GeoJSON FeatureCollection, cached 30s
// Supports bbox (minLng,minLat,maxLng,maxLat) and zoom for geometry simplification.
router.get('/', cacheMiddleware(undefined, () => 30_000), async (req, res, next) => {
  try {
    const { bioma, esfera, categoria, bbox, zoom } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (bioma) { conditions.push(`a.bioma_id = $${idx++}`); params.push(parseParam(bioma)); }
    if (esfera) { conditions.push(`a.esfera = $${idx++}`); params.push(esfera); }
    if (categoria) { conditions.push(`a.categoria_uc = $${idx++}`); params.push(categoria); }

    // Bounding box filter: only return areas intersecting the visible map region
    if (bbox) {
      const parts = String(bbox).split(',').map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        conditions.push(`a.geom && ST_MakeEnvelope($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, 4326)`);
        params.push(parts[0], parts[1], parts[2], parts[3]);
        idx += 4;
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = `LIMIT 500`;

    // 1) Fetch area metadata (no geometry).
    const { rows: metaRows } = await query(
      `SELECT a.id, a.nome, a.categoria_uc, a.esfera, a.bioma_id, a.area_ha
       FROM area_protegida a
       ${where}
       ORDER BY a.id
       ${limitClause}`,
      params
    );

    if (metaRows.length === 0) {
      res.json({ type: 'FeatureCollection', features: [] });
      return;
    }

    // 2) Select tolerance and fetch geometries in parallel chunks.
    const zoomLevel = zoom ? parseInt(String(zoom), 10) : 10;
    const tolerance = zoomLevel > 12 ? 0.001 : zoomLevel > 8 ? 0.01 : 0.1;
    const chunkSize = 50;
    const chunks: number[][] = [];
    for (let i = 0; i < metaRows.length; i += chunkSize) {
      chunks.push(metaRows.slice(i, i + chunkSize).map(r => r.id as number));
    }

    const geometryChunks = await Promise.all(chunks.map(async (ids) => {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const { rows } = await query(
        `SELECT a.id,
                ST_AsGeoJSON(ST_SimplifyPreserveTopology(a.geom, $${ids.length + 1}), 5)::json AS geometry
         FROM area_protegida a
         WHERE a.id IN (${placeholders})
         ORDER BY a.id`,
        [...ids, tolerance]
      );
      return rows;
    }));

    const geomById = new Map<number, any>();
    for (const chunk of geometryChunks) {
      for (const row of chunk) {
        geomById.set(row.id as number, row.geometry);
      }
    }

    const features = metaRows.map(r => ({
      type: 'Feature' as const,
      id: r.id,
      geometry: geomById.get(r.id as number) || null,
      properties: {
        id: r.id,
        nome: r.nome,
        categoria_uc: r.categoria_uc,
        esfera: r.esfera,
        bioma_id: r.bioma_id,
        area_ha: r.area_ha,
      },
    }));

    res.json({ type: 'FeatureCollection', features });
  } catch (err) { next(err); }
});

// GET /api/areas/:id — single area as GeoJSON Feature
router.get('/:id', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { rows } = await query(
      `SELECT json_build_object(
         'type', 'Feature',
         'id', a.id,
         'geometry', ST_AsGeoJSON(a.geom)::json,
         'properties', json_build_object(
           'id', a.id,
           'nome', a.nome,
           'categoria_uc', a.categoria_uc,
           'esfera', a.esfera,
           'bioma_id', a.bioma_id,
           'area_ha', a.area_ha,
           'criado_em', a.criado_em,
           'atualizado_em', a.atualizado_em
         )
       ) AS geojson
       FROM area_protegida a WHERE a.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Area not found' });
      return;
    }

    res.json(rows[0].geojson);
  } catch (err) { next(err); }
});

// GET /api/areas/:id/especies — spatial query: species inside this area
router.get('/:id/especies', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { rows } = await query('SELECT * FROM especies_em_area($1)', [id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/areas — accepts GeoJSON, converts to geometry
router.post('/', async (req, res, next) => {
  try {
    const { nome, categoria_uc, esfera, bioma_id, area_ha, geojson } = req.body;

    if (!nome || !categoria_uc || !esfera || !geojson) {
      res.status(400).json({ error: 'nome, categoria_uc, esfera and geojson are required' });
      return;
    }

    const result = await query(
      `INSERT INTO area_protegida (nome, categoria_uc, esfera, bioma_id, area_ha, geom)
       VALUES ($1, $2, $3, $4, $5,
               ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)))
       RETURNING id`,
      [nome, categoria_uc, esfera, bioma_id || null, area_ha || null, JSON.stringify(geojson)]
    );

    cacheInvalidateAll(['route:/api/areas', 'route:/api/dashboard']);
    res.status(201).json({ id: result.rows[0].id, message: 'Area created' });
  } catch (err) { next(err); }
});

// PUT /api/areas/:id
router.put('/:id', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { nome, categoria_uc, esfera, bioma_id, area_ha, geojson } = req.body;

    let geomExpr = '';
    const params: unknown[] = [];
    let idx = 1;

    if (nome) { params.push(nome); geomExpr += `nome = $${idx++}, `; }
    if (categoria_uc) { params.push(categoria_uc); geomExpr += `categoria_uc = $${idx++}, `; }
    if (esfera) { params.push(esfera); geomExpr += `esfera = $${idx++}, `; }
    if (bioma_id !== undefined) { params.push(bioma_id); geomExpr += `bioma_id = $${idx++}, `; }
    if (area_ha !== undefined) { params.push(area_ha); geomExpr += `area_ha = $${idx++}, `; }
    if (geojson) {
      params.push(JSON.stringify(geojson));
      geomExpr += `geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${idx++}), 4326)), `;
    }

    if (params.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Remove trailing comma and space.
    geomExpr = geomExpr.replace(/, $/, '');
    params.push(id);

    const { rowCount } = await query(
      `UPDATE area_protegida SET ${geomExpr} WHERE id = $${idx}`,
      params
    );

    if (rowCount === 0) {
      res.status(404).json({ error: 'Area not found' });
      return;
    }

    cacheInvalidateAll(['route:/api/areas', 'route:/api/dashboard']);
    res.json({ message: 'Area updated' });
  } catch (err) { next(err); }
});

// DELETE /api/areas/:id
router.delete('/:id', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { rowCount } = await query('DELETE FROM area_protegida WHERE id = $1', [id]);

    if (rowCount === 0) {
      res.status(404).json({ error: 'Area not found' });
      return;
    }

    cacheInvalidateAll(['route:/api/areas', 'route:/api/dashboard']);
    res.json({ message: 'Area deleted' });
  } catch (err) { next(err); }
});

export default router;
