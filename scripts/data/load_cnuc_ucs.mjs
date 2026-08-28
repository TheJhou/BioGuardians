// ============================================================
// BioGuardians - Load CNUC protected areas from shapefile
//
// Uses the 'shapefile' Node.js library to read .shp files
// directly — no shp2pgsql needed.
//
// Usage:
//   node load_cnuc_ucs.mjs
//   node load_cnuc_ucs.mjs --dir=input/cnuc_ucs
//   node load_cnuc_ucs.mjs --file=input/cnuc_ucs/ucs.shp
//
// Input: Shapefile from CNUC/MMA (http://cnuc.mma.gov.br/)
//        Extract .shp, .shx, .dbf, .prj to input/cnuc_ucs/
//
// Idempotent: uses ON CONFLICT (nome) DO NOTHING.
// ============================================================

import { existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import shapefile from 'shapefile';

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

// Map CNUC "grupo" to our categoria_uc_tipo enum
function mapCategoriaUC(grupo) {
  const g = (grupo || '').toLowerCase();
  if (g.includes('proteção integral') || g.includes('protecao integral')) {
    return 'protecao_integral';
  }
  if (g.includes('uso sustentável') || g.includes('uso sustentavel')) {
    return 'uso_sustentavel';
  }
  return 'protecao_integral';
}

// Map CNUC "esfera" to our esfera_tipo enum
function mapEsfera(esfera) {
  const e = (esfera || '').toLowerCase();
  if (e.includes('federal')) return 'federal';
  if (e.includes('estadual')) return 'estadual';
  if (e.includes('municipal')) return 'municipal';
  if (e.includes('particular') || e.includes('privada')) return 'particular';
  return 'federal';
}

// Detect bioma from the fields (amazonia, caatinga, cerrado, matlantica, pampa, pantanal, marinho)
function detectBioma(props, biomaMap) {
  const biomaFields = [
    { field: 'amazonia', nome: 'Amazônia' },
    { field: 'caatinga', nome: 'Caatinga' },
    { field: 'cerrado', nome: 'Cerrado' },
    { field: 'matlantica', nome: 'Mata Atlântica' },
    { field: 'pampa', nome: 'Pampa' },
    { field: 'pantanal', nome: 'Pantanal' },
    { field: 'marinho', nome: 'Marinho' },
  ];

  for (const b of biomaFields) {
    const val = props[b.field];
    if (val && parseFloat(val) > 0) {
      return biomaMap.get(b.nome.toLowerCase());
    }
  }
  return null;
}

// Convert GeoJSON geometry to WKT for PostGIS
function geometryToWKT(geometry) {
  if (!geometry) return null;

  const { type, coordinates } = geometry;

  if (type === 'Polygon') {
    const rings = coordinates.map(ring =>
      `(${ring.map(p => `${p[0]} ${p[1]}`).join(', ')})`
    ).join(', ');
    return `POLYGON(${rings})`;
  }

  if (type === 'MultiPolygon') {
    const polygons = coordinates.map(poly => {
      const rings = poly.map(ring =>
        `(${ring.map(p => `${p[0]} ${p[1]}`).join(', ')})`
      ).join(', ');
      return `(${rings})`;
    }).join(', ');
    return `MULTIPOLYGON(${polygons})`;
  }

  return null;
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
      console.error('   Download CNUC shapefile from https://dados.mma.gov.br/dataset/unidadesdeconservacao');
      console.error('   Extract to: scripts/data/input/cnuc_ucs/');
      process.exit(1);
    }
    shpFile = findShpFile(inputDir);
  }

  if (!shpFile || !existsSync(shpFile)) {
    console.error(`ERROR: No .shp file found in ${inputDir}`);
    console.error('   Download CNUC shapefile from https://dados.mma.gov.br/dataset/unidadesdeconservacao');
    process.exit(1);
  }

  console.log('==> BioGuardians — CNUC Protected Areas Loader');
  console.log(`   Shapefile: ${shpFile}`);

  const client = await pool.connect();

  try {
    // Cache bioma IDs
    const { rows: biomas } = await client.query('SELECT id, lower(nome) as nome FROM bioma');
    const biomaMap = new Map(biomas.map(b => [b.nome, b.id]));

    // Open shapefile
    const source = await shapefile.open(shpFile);

    let total = 0;
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    let noGeom = 0;

    console.log('   Reading records...');

    while (true) {
      const { done, value } = await source.read();
      if (done) break;

      total++;
      const props = value.properties;

      // Skip non-UC records (e.g. zona de amortecimento)
      if (props.limite && props.limite.toLowerCase() !== 'uc') {
        continue;
      }

      // Skip inactive UCs
      if (props.situacao && props.situacao.toLowerCase() !== 'ativo') {
        continue;
      }

      const nome = (props.nome_uc || '').trim();
      if (!nome) {
        errors++;
        continue;
      }

      // Convert geometry to WKT
      const wkt = geometryToWKT(value.geometry);
      if (!wkt) {
        noGeom++;
        continue;
      }

      const categoria = mapCategoriaUC(props.grupo);
      const esfera = mapEsfera(props.esfera);
      const areaHa = props.ha_total ? parseFloat(props.ha_total) : null;
      const biomaId = detectBioma(props, biomaMap);

      try {
        // Insert with ST_GeomFromText to convert WKT to geometry
        const { rowCount } = await client.query(
          `INSERT INTO area_protegida (nome, categoria_uc, esfera, bioma_id, area_ha, geom)
           VALUES ($1, $2, $3, $4, $5, ST_Multi(ST_GeomFromText($6, 4326))::geometry(MULTIPOLYGON, 4326))
           ON CONFLICT (nome) DO NOTHING`,
          [nome, categoria, esfera, biomaId, areaHa, wkt]
        );

        if (rowCount > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (err) {
        if (errors < 5) {
          console.warn(`   ERROR: ${nome} — ${err.message}`);
        }
        errors++;
      }

      if (total % 100 === 0) {
        console.log(`   Processed ${total} records... (inserted: ${inserted}, skipped: ${skipped}, errors: ${errors})`);
      }
    }

    // Refresh dashboard
    console.log('');
    console.log('   Refreshing dashboard views...');
    await client.query('SELECT refresh_dashboard()');

    console.log('');
    console.log('==> Summary:');
    console.log(`   Total records: ${total}`);
    console.log(`   Inserted:      ${inserted}`);
    console.log(`   Skipped:       ${skipped} (already existed)`);
    console.log(`   No geometry:   ${noGeom}`);
    console.log(`   Errors:        ${errors}`);
  } catch (err) {
    console.error('FATAL:', err.message);
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
