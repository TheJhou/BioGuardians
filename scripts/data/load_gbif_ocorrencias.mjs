// ============================================================
// BioGuardians - Load GBIF occurrences via API
//
// Fetches georeferenced occurrences from GBIF for species
// already in the database. Inserts into ocorrencia table.
//
// Usage:
//   node load_gbif_ocorrencias.mjs                    # all active species
//   node load_gbif_ocorrencias.mjs --especie="panthera onca"  # specific
//   node load_gbif_ocorrencias.mjs --limit=100        # max per species
//
// Idempotent: checks if (especie_id, lat, lon, fonte) already exists.
// ============================================================

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

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

const GBIF_BASE = process.env.GBIF_API_BASE || 'https://api.gbif.org/v1';

async function fetchGbifOccurrences(scientificName, limit = 50) {
  const url = `${GBIF_BASE}/occurrence/search?country=BR&scientificName=${encodeURIComponent(scientificName)}&limit=${limit}&hasCoordinate=true`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GBIF API returned ${response.status}`);
  }

  const data = await response.json();
  return data.results || [];
}

async function main() {
  const args = process.argv.slice(2);
  const especieArg = args.find(a => a.startsWith('--especie='));
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

  console.log('==> BioGuardians — GBIF Occurrences Loader');
  console.log(`   API: ${GBIF_BASE}`);
  console.log(`   Limit per species: ${limit}`);

  const client = await pool.connect();

  try {
    // Get species to process
    let speciesQuery = "SELECT id, nome_cientifico FROM especie WHERE status = 'ativo' ORDER BY nome_cientifico";
    let speciesParams = [];

    if (especieArg) {
      const nome = especieArg.split('=')[1].toLowerCase().trim();
      speciesQuery = 'SELECT id, nome_cientifico FROM especie WHERE nome_cientifico = $1';
      speciesParams = [nome];
    }

    const { rows: species } = await client.query(speciesQuery, speciesParams);
    console.log(`   Found ${species.length} species to process`);

    let totalInserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const esp of species) {
      console.log(`   Fetching: ${esp.nome_cientifico}...`);

      try {
        const occurrences = await fetchGbifOccurrences(esp.nome_cientifico, limit);

        if (occurrences.length === 0) {
          console.log(`      No occurrences found`);
          continue;
        }

        let inserted = 0, skipped = 0;

        for (const occ of occurrences) {
          const lat = occ.decimalLatitude;
          const lon = occ.decimalLongitude;

          if (lat === undefined || lon === undefined) continue;
          if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

          // Check if already exists (idempotent)
          const { rows: existing } = await client.query(
            `SELECT 1 FROM ocorrencia
             WHERE especie_id = $1 AND lat = $2 AND lon = $3 AND fonte = 'gbif'
             LIMIT 1`,
            [esp.id, lat, lon]
          );

          if (existing.length > 0) {
            skipped++;
            continue;
          }

          // Insert occurrence
          const dataEvento = occ.eventDate ? occ.eventDate.split('T')[0] : null;
          const baseRegistro = occ.institutionCode || occ.collectionCode || null;

          await client.query(
            `INSERT INTO ocorrencia (especie_id, lat, lon, geom, data_evento, fonte, base_registro)
             VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, 'gbif', $5)`,
            [esp.id, lat, lon, dataEvento, baseRegistro]
          );

          inserted++;
        }

        totalInserted += inserted;
        totalSkipped += skipped;
        console.log(`      Inserted: ${inserted}, Skipped: ${skipped}`);

        // Rate limit: be nice to GBIF API
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.warn(`      ERROR: ${err.message}`);
        totalErrors++;
      }
    }

    // Refresh dashboard after loading
    console.log('');
    console.log('   Refreshing dashboard views...');
    await client.query('SELECT refresh_dashboard()');

    console.log('');
    console.log('==> Summary:');
    console.log(`   Inserted: ${totalInserted}`);
    console.log(`   Skipped:  ${totalSkipped} (already existed)`);
    console.log(`   Errors:   ${totalErrors}`);
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
