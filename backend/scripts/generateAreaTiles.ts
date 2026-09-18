// Pré-gera os tiles MVT de áreas protegidas direto no Postgres
// (tabela area_tile, migration 004). Uso:
//
//   npm run generate-area-tiles            → z3–z6 (default)
//   npm run generate-area-tiles -- 3 8     → z3–z8
//
// Idempotente (upsert por z/x/y). Só gera tiles cuja bounding box
// cobre a extensão real dos dados — tiles vazios fora do bbox nem
// entram na fila.
import { pool, query } from '../src/db/pool.js';
import { generateAreaTile, storeAreaTile } from '../src/tileStore.js';

const MIN_ZOOM = parseInt(process.argv[2] ?? '3', 10);
const MAX_ZOOM = parseInt(process.argv[3] ?? '6', 10);
const CONCURRENCY = 4;

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

async function main(): Promise<void> {
  const { rows } = await query(
    `SELECT ST_XMin(e) AS min_lon, ST_YMin(e) AS min_lat,
            ST_XMax(e) AS max_lon, ST_YMax(e) AS max_lat
     FROM (SELECT ST_Extent(geom::geometry) AS e FROM area_protegida) s`
  );
  const bbox = rows[0];
  if (!bbox?.min_lon) {
    console.log('area_protegida vazia — nada a gerar.');
    return;
  }

  // Margem pequena pra garantir que polígonos na borda entrem.
  const pad = 0.01;
  const tiles: Array<[number, number, number]> = [];
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    const xMin = lonToTileX(bbox.min_lon - pad, z);
    const xMax = lonToTileX(bbox.max_lon + pad, z);
    const yMin = latToTileY(bbox.max_lat + pad, z);
    const yMax = latToTileY(bbox.min_lat - pad, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push([z, x, y]);
      }
    }
  }

  console.log(`Gerando ${tiles.length} tiles (z${MIN_ZOOM}–z${MAX_ZOOM})...`);
  const start = Date.now();
  let done = 0;
  let bytes = 0;
  let errors = 0;

  const queue = [...tiles];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      let t: [number, number, number] | undefined;
      while ((t = queue.pop()) !== undefined) {
        try {
          const buffer = await generateAreaTile(t[0], t[1], t[2]);
          await storeAreaTile(t[0], t[1], t[2], buffer);
          done++;
          bytes += buffer.length;
          if (done % 100 === 0) console.log(`  ${done}/${tiles.length}`);
        } catch (err) {
          errors++;
          console.error(`  tile ${t.join('/')}: ${err instanceof Error ? err.message : err}`);
        }
      }
    })
  );

  console.log(
    `Concluído: ${done} tiles (${(bytes / 1024).toFixed(0)}KB), ` +
    `${errors} erros, ${((Date.now() - start) / 1000).toFixed(1)}s`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
