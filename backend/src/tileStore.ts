import { query } from './db/pool.js';

// Geração e persistência de tiles MVT de áreas protegidas.
// Os tiles cobrem o dataset completo (sem filtros): requests com
// filtro seguem o caminho antigo (LRU em memória + query dinâmica).

const AREA_TILE_SQL = `
  SELECT COALESCE(encode(ST_AsMVT(mvt, 'uc', 4096, 'geom'), 'base64'), '') AS mvt
  FROM (
    SELECT
      ST_AsMVTGeom(
        ST_SimplifyPreserveTopology(ST_Transform(a.geom, 3857), 156543.03392 / POWER(2, $1)),
        bounds.b, 4096, 256, true
      ) AS geom,
      a.id,
      a.categoria_uc::text
    FROM area_protegida a
    CROSS JOIN (SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS b) bounds
    WHERE a.geom && ST_Transform(bounds.b, 4326)
  ) mvt`;

export async function generateAreaTile(z: number, x: number, y: number): Promise<Buffer> {
  const { rows } = await query(AREA_TILE_SQL, [z, x, y]);
  return rows[0].mvt ? Buffer.from(rows[0].mvt, 'base64') : Buffer.alloc(0);
}

export async function getStoredAreaTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const { rows } = await query(
    'SELECT tile FROM area_tile WHERE z = $1 AND x = $2 AND y = $3',
    [z, x, y]
  );
  return rows.length > 0 ? rows[0].tile : null;
}

export async function storeAreaTile(z: number, x: number, y: number, tile: Buffer): Promise<void> {
  await query(
    `INSERT INTO area_tile (z, x, y, tile) VALUES ($1, $2, $3, $4)
     ON CONFLICT (z, x, y) DO UPDATE SET tile = EXCLUDED.tile, gerado_em = now()`,
    [z, x, y, tile]
  );
}
