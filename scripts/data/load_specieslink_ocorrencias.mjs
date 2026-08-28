// ============================================================
// BioGuardians - Load speciesLink occurrences via API
//
// Fetches georeferenced occurrences from speciesLink for
// species already in the database. Inserts into ocorrencia.
//
// Usage:
//   node load_specieslink_ocorrencias.mjs                    # all active species
//   node load_specieslink_ocorrencias.mjs --especie="panthera onca"  # specific
//
// speciesLink API: https://api.splink.org.br/records
// Documentation: https://www.splink.org.br/api
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

const SPLINK_BASE = 'https://api.splink.org.br/records';

async function fetchSplinkOccurrences(scientificName, limit = 50) {
  // speciesLink API: search by scientific name with geographic filter
  const url = `${SPLINK_BASE}/search?scientificname=${encodeURIComponent(scientificName)}&format=json&limit=${limit}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`speciesLink API returned ${response.status}`);
  }

  const data = await response.json();
  // speciesLink returns array of records
  return Array.isArray(data) ? data : (data.result || []);
}

function parseSplinkRecord(record) {
  // speciesLink record fields vary; extract coordinates
  const lat = parseFloat(record.decimalLatitude || record.latitude || '');
  const lon = parseFloat(record.decimalLongitude || record.longitude || '');

  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const eventDate = record.eventDate || record.collectorDate || null;
  const institutionCode = record.institutionCode || record.institution || null;

  return { lat, lon, eventDate, institutionCode };
}

async function main() {
  const args = process.argv.slice(2);
  const especieArg = args.find(a => a.startsWith('--especie='));

  console.log('==> BioGuardians — speciesLink Occurrences Loader');
  console.log(`   API: ${SPLINK_BASE}`);

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
        const occurrences = await fetchSplinkOccurrences(esp.nome_cientifico);

        if (occurrences.length === 0) {
          console.log(`      No occurrences found`);
          continue;
        }

        let inserted = 0, skipped = 0;

        for (const record of occurrences) {
          const parsed = parseSplinkRecord(record);
          if (!parsed) continue;

          // Check if already exists (idempotent)
          const { rows: existing } = await client.query(
            `SELECT 1 FROM ocorrencia
             WHERE especie_id = $1 AND lat = $2 AND lon = $3 AND fonte = 'specieslink'
             LIMIT 1`,
            [esp.id, parsed.lat, parsed.lon]
          );

          if (existing.length > 0) {
            skipped++;
            continue;
          }

          // Insert occurrence
          const dataEvento = parsed.eventDate ? parsed.eventDate.split('T')[0] : null;

          await client.query(
            `INSERT INTO ocorrencia (especie_id, lat, lon, geom, data_evento, fonte, base_registro)
             VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, 'specieslink', $5)`,
            [esp.id, parsed.lat, parsed.lon, dataEvento, parsed.institutionCode]
          );

          inserted++;
        }

        totalInserted += inserted;
        totalSkipped += skipped;
        console.log(`      Inserted: ${inserted}, Skipped: ${skipped}`);

        // Rate limit: be nice to speciesLink API
        await new Promise(r => setTimeout(r, 1000));
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
