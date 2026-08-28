// ============================================================
// BioGuardians - Load CNUC protected areas from shapefile
//
// Loads protected areas (UCs) from CNUC/MMA shapefile using
// shp2pgsql (from PostGIS) and psql.
//
// Usage:
//   node load_cnuc_ucs.mjs
//   node load_cnuc_ucs.mjs --dir=input/cnuc_ucs
//   node load_cnuc_ucs.mjs --file=input/cnuc_ucs/uc.shp
//
// Prerequisites:
//   - shp2pgsql (bundled with PostGIS)
//   - psql (PostgreSQL client)
//   - Shapefile downloaded from CNUC (http://cnuc.mma.gov.br/)
//
// The script:
//   1. Runs shp2pgsql to convert shapefile to SQL
//   2. Transforms SRID to 4326 if needed
//   3. Inserts into area_protegida with idempotent ON CONFLICT
//
// Idempotent: uses ON CONFLICT (nome) DO NOTHING.
// ============================================================

import { existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
});

function findShpFile(dir) {
  const files = readdirSync(dir);
  const shp = files.find(f => f.toLowerCase().endsWith('.shp'));
  return shp ? resolve(dir, shp) : null;
}

function mapCategoriaUC(categoria) {
  // CNUC categories map to our enum
  const cat = (categoria || '').toLowerCase();
  if (cat.includes('proteção integral') || cat.includes('protecao integral')) {
    return 'protecao_integral';
  }
  if (cat.includes('uso sustentável') || cat.includes('uso sustentavel')) {
    return 'uso_sustentavel';
  }
  return 'protecao_integral'; // default
}

function mapEsfera(esfera) {
  const e = (esfera || '').toLowerCase();
  if (e.includes('federal')) return 'federal';
  if (e.includes('estadual')) return 'estadual';
  if (e.includes('municipal')) return 'municipal';
  if (e.includes('particular') || e.includes('privada')) return 'particular';
  return 'federal'; // default
}

async function main() {
  const args = process.argv.slice(2);
  const dirArg = args.find(a => a.startsWith('--dir='));
  const fileArg = args.find(a => a.startsWith('--file='));

  const inputDir = dirArg
    ? dirArg.split('=')[1]
    : resolve(__dirname, 'input/cnuc_ucs');

  let shpFile = fileArg ? fileArg.split('=')[1] : null;

  if (!shpFile) {
    if (!existsSync(inputDir)) {
      console.error(`ERROR: Input directory not found: ${inputDir}`);
      console.error('   Download CNUC shapefile from http://cnuc.mma.gov.br/');
      console.error('   Extract to: scripts/data/input/cnuc_ucs/');
      process.exit(1);
    }
    shpFile = findShpFile(inputDir);
  }

  if (!shpFile || !existsSync(shpFile)) {
    console.error(`ERROR: No .shp file found in ${inputDir}`);
    console.error('   Download CNUC shapefile from http://cnuc.mma.gov.br/');
    process.exit(1);
  }

  console.log('==> BioGuardians — CNUC Protected Areas Loader');
  console.log(`   Shapefile: ${shpFile}`);

  // Check shp2pgsql is available
  try {
    execSync('which shp2pgsql', { stdio: 'pipe' });
  } catch {
    console.error('ERROR: shp2pgsql not found. Install PostGIS:');
    console.error('   Ubuntu: sudo apt install postgis');
    console.error('   macOS:  brew install postgis');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    // Step 1: Load shapefile into a temporary table using shp2pgsql
    // shp2pgsql converts shapefile to SQL, transforms to SRID 4326
    console.log('   Converting shapefile to SQL with shp2pgsql...');

    const tempTable = 'tmp_cnuc_import';
    const shp2sql = execSync(
      `shp2pgsql -s 4326 -d -I "${shpFile}" ${tempTable}`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );

    // Execute the generated SQL to create temp table
    await client.query(`DROP TABLE IF EXISTS ${tempTable} CASCADE;`);
    // Split and execute statements (shp2pgsql outputs multiple statements)
    const statements = shp2sql.split(/;\s*\n/).filter(s => s.trim());
    for (const stmt of statements) {
      await client.query(stmt);
    }

    console.log('   Temporary table created. Mapping columns...');

    // Step 2: Inspect columns in temp table
    const { rows: columns } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 ORDER BY ordinal_position
    `, [tempTable]);

    const colNames = columns.map(c => c.column_name.toLowerCase());
    console.log(`   Columns: ${colNames.join(', ')}`);

    // Try to identify column names (CNUC shapefiles vary)
    const nomeCol = colNames.find(c => c.includes('nome') || c.includes('name')) || colNames[0];
    const categoriaCol = colNames.find(c => c.includes('categoria') || c.includes('category') || c.includes('tipo'));
    const esferaCol = colNames.find(c => c.includes('esfera') || c.includes('admin') || c.includes('esfera'));
    const areaCol = colNames.find(c => c.includes('area') || c.includes('ha'));
    const biomaCol = colNames.find(c => c.includes('bioma') || c.includes('biome'));
    const geomCol = colNames.find(c => c === 'geom' || c === 'the_geom' || c === 'geometry');

    console.log(`   Mapped: nome=${nomeCol}, categoria=${categoriaCol}, esfera=${esferaCol}, area=${areaCol}, geom=${geomCol}`);

    // Step 3: Insert into area_protegida from temp table
    // Convert geometry to MULTIPOLYGON if needed
    const { rowCount } = await client.query(`
      INSERT INTO area_protegida (nome, categoria_uc, esfera, area_ha, geom)
      SELECT
        ${nomeCol}::varchar,
        CASE
          WHEN ${categoriaCol}::text ILIKE '%proteção integral%' OR ${categoriaCol}::text ILIKE '%protecao integral%'
            THEN 'protecao_integral'::categoria_uc_tipo
          WHEN ${categoriaCol}::text ILIKE '%uso sustentável%' OR ${categoriaCol}::text ILIKE '%uso sustentavel%'
            THEN 'uso_sustentavel'::categoria_uc_tipo
          ELSE 'protecao_integral'::categoria_uc_tipo
        END,
        CASE
          WHEN ${esferaCol}::text ILIKE '%federal%' THEN 'federal'::esfera_tipo
          WHEN ${esferaCol}::text ILIKE '%estadual%' THEN 'estadual'::esfera_tipo
          WHEN ${esferaCol}::text ILIKE '%municipal%' THEN 'municipal'::esfera_tipo
          WHEN ${esferaCol}::text ILIKE '%particular%' OR ${esferaCol}::text ILIKE '%privada%'
            THEN 'particular'::esfera_tipo
          ELSE 'federal'::esfera_tipo
        END,
        CASE
          WHEN ${areaCol} IS NOT NULL AND ${areaCol}::numeric > 0
            THEN ${areaCol}::numeric(12,2)
          ELSE NULL
        END,
        ST_Multi(${geomCol})::geometry(MULTIPOLYGON, 4326)
      FROM ${tempTable}
      WHERE ${nomeCol} IS NOT NULL
      ON CONFLICT (nome) DO NOTHING
    `);

    console.log(`   Inserted: ${rowCount} protected areas`);

    // Step 4: Try to link biomas if bioma column exists
    if (biomaCol) {
      console.log('   Linking biomas...');
      const { rows: biomas } = await client.query('SELECT id, lower(nome) as nome FROM bioma');
      const biomaMap = new Map(biomas.map(b => [b.nome, b.id]));

      const { rows: ucs } = await client.query(`
        SELECT a.id, lower(t.${biomaCol}) as bioma_nome
        FROM area_protegida a
        JOIN ${tempTable} t ON a.nome = t.${nomeCol}::varchar
        WHERE t.${biomaCol} IS NOT NULL
      `);

      let linked = 0;
      for (const uc of ucs) {
        const biomaId = biomaMap.get(uc.bioma_nome?.trim());
        if (biomaId) {
          await client.query(
            'UPDATE area_protegida SET bioma_id = $1 WHERE id = $2',
            [biomaId, uc.id]
          );
          linked++;
        }
      }
      console.log(`   Linked biomas: ${linked}`);
    }

    // Step 5: Cleanup temp table
    await client.query(`DROP TABLE IF EXISTS ${tempTable} CASCADE;`);
    console.log('   Cleaned up temporary table');

    // Refresh dashboard
    console.log('   Refreshing dashboard views...');
    await client.query('SELECT refresh_dashboard()');

    console.log('');
    console.log('==> Done! Protected areas loaded successfully.');
  } catch (err) {
    console.error('FATAL:', err.message);
    // Cleanup on error
    try {
      await client.query('DROP TABLE IF EXISTS tmp_cnuc_import CASCADE;');
    } catch {}
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
