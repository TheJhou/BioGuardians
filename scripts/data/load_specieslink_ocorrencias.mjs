// ============================================================
// BioGuardians - Load speciesLink occurrences via API
//
// Uses the new speciesLink API (specieslink.net/ws/1.0/) which
// requires an API key. Get one at:
//   https://specieslink.net/ws/1.0/
//
// Set the API key in .env:
//   SPLINK_API_KEY=your_api_key_here
//
// If no API key is set, the script skips with a warning.
// GBIF already aggregates much of speciesLink's data, so this
// script is optional.
//
// Usage:
//   node load_specieslink_ocorrencias.mjs
//   node load_specieslink_ocorrencias.mjs --especie="panthera onca"
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

const SPLINK_BASE = 'https://specieslink.net/ws/1.0/search';
const SPLINK_API_KEY = process.env.SPLINK_API_KEY || '';

async function fetchSplinkOccurrences(scientificName, limit = 50) {
  const params = new URLSearchParams({
    scientificname: scientificName,
    format: 'json',
    limit: String(limit),
    apikey: SPLINK_API_KEY,
  });

  const url = `${SPLINK_BASE}?${params}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`speciesLink API ${response.status}: ${text}`);
  }

  const data = await response.json();
  // speciesLink returns GeoJSON FeatureCollection
  if (data.features) {
    return data.features.map(f => ({
      decimalLatitude: f.geometry?.coordinates?.[1],
      decimalLongitude: f.geometry?.coordinates?.[0],
      eventDate: f.properties?.eventDate || f.properties?.dateIdentified,
      institutionCode: f.properties?.institutionCode,
    }));
  }
  return Array.isArray(data) ? data : (data.result || []);
}

async function main() {
  const args = process.argv.slice(2);
  const especieArg = args.find(a => a.startsWith('--especie='));

  console.log('==> BioGuardians — speciesLink Occurrences Loader');
  console.log(`   API: ${SPLINK_BASE}`);

  if (!SPLINK_API_KEY) {
    console.log('');
    console.log('   WARNING: No SPLINK_API_KEY found in .env');
    console.log('   The speciesLink API requires an API key.');
    console.log('   Get one at: https://specieslink.net/ws/1.0/');
    console.log('   Then add to .env: SPLINK_API_KEY=your_key');
    console.log('');
    console.log('   NOTE: GBIF already aggregates much of speciesLink data,');
    console.log('   so this script is optional.');
    console.log('');
    console.log('   Skipping speciesLink load.');
    process.exit(0);
  }

  console.log(`   API key: ${SPLINK_API_KEY.substring(0, 4)}...`);

  const client = await pool.connect();

  try {
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
          const lat = typeof record.decimalLatitude === 'number'
            ? record.decimalLatitude
            : parseFloat(record.decimalLatitude || '');
          const lon = typeof record.decimalLongitude === 'number'
            ? record.decimalLongitude
            : parseFloat(record.decimalLongitude || '');

          if (isNaN(lat) || isNaN(lon)) continue;
          if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

          // Check if already exists (idempotent)
          const { rows: existing } = await client.query(
            `SELECT 1 FROM ocorrencia
             WHERE especie_id = $1 AND lat = $2 AND lon = $3 AND fonte = 'specieslink'
             LIMIT 1`,
            [esp.id, lat, lon]
          );

          if (existing.length > 0) {
            skipped++;
            continue;
          }

          // Normalize date
          let dataEvento = null;
          const rawDate = record.eventDate || '';
          if (rawDate) {
            const raw = rawDate.split('T')[0].split('/')[0].trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
              dataEvento = raw;
            } else if (/^\d{4}-\d{2}$/.test(raw)) {
              dataEvento = raw + '-01';
            } else if (/^\d{4}$/.test(raw)) {
              dataEvento = raw + '-01-01';
            }
          }

          await client.query(
            `INSERT INTO ocorrencia (especie_id, lat, lon, geom, data_evento, fonte, base_registro)
             VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, 'specieslink', $5)`,
            [esp.id, lat, lon, dataEvento, record.institutionCode || null]
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
