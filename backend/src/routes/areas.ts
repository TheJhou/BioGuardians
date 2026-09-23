import { Router } from 'express';
import { query } from '../db/pool.js';
import { validateId } from '../middleware/validateId.js';
import { cacheMiddleware, getTileCache, setTileCache } from '../cache/cache.js';
import { parseParam, getParam } from '../utils/params.js';
import { getStoredAreaTile, storeAreaTile } from '../tileStore.js';

const router = Router();

function isValidTile(z: number, x: number, y: number): boolean {
  if (Number.isNaN(z) || Number.isNaN(x) || Number.isNaN(y)) return false;
  if (z < 0 || z > 20) return false;
  const max = 1 << z;
  return x >= 0 && x < max && y >= 0 && y < max;
}

function sendTile(res: any, buffer: Buffer): void {
  res.set('Content-Type', 'application/vnd.mapbox-vector-tile');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(buffer);
}

// GET /api/areas � returns GeoJSON FeatureCollection, cached 30s
// Supports bbox (minLng,minLat,maxLng,maxLat) and zoom for geometry simplification.
router.get('/', cacheMiddleware(undefined, () => 30_000), async (req, res, next) => {
  try {
    const { bioma, esfera, categoria, busca, bbox, zoom } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (bioma) { conditions.push(`a.bioma_id = $${idx++}`); params.push(parseParam(bioma)); }
    if (esfera) { conditions.push(`a.esfera = $${idx++}`); params.push(esfera); }
    if (categoria) { conditions.push(`a.categoria_uc = $${idx++}`); params.push(categoria); }
    if (busca && typeof busca === 'string') {
      conditions.push(`(a.nome ILIKE $${idx++} OR a.esfera ILIKE $${idx++} OR b.nome ILIKE $${idx++})`);
      const like = `%${busca}%`;
      params.push(like, like, like);
      idx += 3;
    }

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

    // Toler�ncia de simplifica��o por zoom (graus).
    const zoomLevel = zoom ? parseInt(String(zoom), 10) : 10;
    const tolerance = zoomLevel > 12 ? 0.001 : zoomLevel > 8 ? 0.01 : 0.1;

    // Uma �nica query: metadados + geometria simplificada. Evita abrir
    // N conex�es do pool com chunks paralelos.
    const { rows: features } = await query(
      `SELECT a.id AS feature_id,
              ST_AsGeoJSON(ST_SimplifyPreserveTopology(a.geom, $${idx}), 5)::json AS geometry,
              json_build_object(
                'id', a.id,
                'nome', a.nome,
                'categoria_uc', a.categoria_uc,
                'esfera', a.esfera,
                'bioma_id', a.bioma_id,
                'area_ha', a.area_ha
              ) AS properties
       FROM area_protegida a
       LEFT JOIN bioma b ON b.id = a.bioma_id
       ${where}
       ORDER BY a.id
       ${limitClause}`,
      [...params, tolerance]
    );

    res.json({
      type: 'FeatureCollection',
      features: features.map((r: any) => ({
        type: 'Feature',
        id: r.feature_id,
        geometry: r.geometry,
        properties: r.properties,
      })),
    });
  } catch (err) { next(err); }
});

// GET /api/areas/tiles/:z/:x/:y.mvt — vector tiles for UCs (MVT).
router.get('/tiles/:z/:x/:y.mvt', async (req, res, next) => {
  try {
    const z = parseInt(req.params.z, 10);
    const x = parseInt(req.params.x, 10);
    const y = parseInt(req.params.y, 10);
    if (!isValidTile(z, x, y)) {
      res.status(400).json({ error: 'Invalid tile coordinates' });
      return;
    }

    const { esfera, categoria, bioma } = req.query;
    const hasFilters = Boolean(esfera || categoria || bioma);

    // Cache persistente: tiles pré-gerados cobrem o dataset completo.
    // Requests com filtro não usam a tabela (cada filtro geraria uma
    // variante do tile) — seguem o LRU em memória como antes.
    if (!hasFilters) {
      try {
        const stored = await getStoredAreaTile(z, x, y);
        if (stored) {
          sendTile(res, stored);
          return;
        }
      } catch {
        // Tabela ainda não migrada — cai no caminho normal.
      }
    }

    const key = `route:${req.originalUrl}`;
    const cached = getTileCache(key);
    if (cached) {
      sendTile(res, cached);
      return;
    }

    const conditions: string[] = ['a.geom && ST_Transform(bounds.b, 4326)'];
    const params: unknown[] = [z, x, y];
    let idx = 4;

    if (esfera) { conditions.push(`a.esfera = $${idx++}`); params.push(esfera); }
    if (categoria) { conditions.push(`a.categoria_uc = $${idx++}`); params.push(categoria); }
    if (bioma) { conditions.push(`a.bioma_id = $${idx++}`); params.push(parseParam(bioma)); }

    const where = conditions.join(' AND ');

    const { rows } = await query(
      `SELECT COALESCE(encode(ST_AsMVT(mvt, 'uc', 4096, 'geom'), 'base64'), '') AS mvt
       FROM (
         SELECT
           ST_AsMVTGeom(ST_SimplifyPreserveTopology(ST_Transform(a.geom, 3857), 156543.03392 / POWER(2, $1)), bounds.b, 4096, 256, true) AS geom,
           a.id,
           a.categoria_uc::text
         FROM area_protegida a
         CROSS JOIN (SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS b) bounds
         WHERE ${where}
       ) mvt`,
      params
    );

    const buffer = rows[0].mvt ? Buffer.from(rows[0].mvt, 'base64') : Buffer.alloc(0);
    if (!hasFilters) {
      try {
        await storeAreaTile(z, x, y, buffer);
      } catch {
        // Persistência best-effort — a resposta já está garantida.
      }
    }
    setTileCache(key, buffer);
    sendTile(res, buffer);
  } catch (err) { next(err); }
});

// GET /api/areas/:id � single area as GeoJSON Feature
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

// GET /api/areas/:id/info — metadados leves para o clique do mapa (sem geometria;
// o tile carrega só id + categoria_uc pra manter o payload pequeno)
router.get('/:id/info', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { rows } = await query(
      `SELECT a.id, a.nome, a.categoria_uc::text, a.esfera::text,
              a.bioma_id, b.nome AS bioma, a.area_ha::float
       FROM area_protegida a
       LEFT JOIN bioma b ON b.id = a.bioma_id
       WHERE a.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Area not found' });
      return;
    }

    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/areas/:id/especies � spatial query: species inside this area
router.get('/:id/especies', validateId, async (req, res, next) => {
  try {
    const id = parseParam(req.params.id)!;
    const { rows } = await query('SELECT * FROM especies_em_area($1)', [id]);
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
