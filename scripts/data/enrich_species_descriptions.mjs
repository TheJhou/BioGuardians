// ============================================================
// BioGuardians - Enrich species descriptions from Wikipedia
//
// Fetches species abstracts from Wikipedia API and stores them
// in the `especie.descricao` column.
//
// Usage:
//   node enrich_species_descriptions.mjs
//   node enrich_species_descriptions.mjs --limit=50 --dry-run
//
// Uses the scientific name (e.g. "panthera onca") to query:
//   https://pt.wikipedia.org/api/rest_v1/page/summary/Panthera_onca
//   falls back to English Wikipedia if Portuguese is not found.
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWikipediaSummary(title, lang = 'pt') {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.type === 'disambiguation') return null;
    return data.extract || null;
  } catch (err) {
    console.warn(`   ERROR fetching ${lang} Wikipedia for ${title}: ${err.message}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const dryRun = args.includes('--dry-run');
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  console.log('==> BioGuardians — Species Description Enrichment');

  const client = await pool.connect();
  let updated = 0;
  let notFound = 0;
  let errors = 0;

  try {
    let query = 'SELECT id, nome_cientifico, nome_popular FROM especie WHERE descricao IS NULL OR descricao = \'\' ORDER BY id';
    const params = [];
    if (limit) {
      query += ' LIMIT $1';
      params.push(limit);
    }
    const { rows } = await client.query(query, params);
    console.log(`   Found ${rows.length} species without description`);

    for (const row of rows) {
      const scientificName = row.nome_cientifico;
      const title = scientificName.replace(/\s+/g, '_').replace(/\b\w/g, c => c.toUpperCase());

      console.log(`   Fetching: ${scientificName}`);

      let extract = await fetchWikipediaSummary(title, 'pt');
      if (!extract) {
        extract = await fetchWikipediaSummary(title, 'en');
      }

      if (!extract) {
        // Try common name as last resort
        const popular = row.nome_popular;
        if (popular) {
          const popularTitle = popular.replace(/\s+/g, '_').replace(/\b\w/g, c => c.toUpperCase());
          extract = await fetchWikipediaSummary(popularTitle, 'pt');
          if (!extract) extract = await fetchWikipediaSummary(popularTitle, 'en');
        }
      }

      if (extract) {
        if (!dryRun) {
          await client.query(
            'UPDATE especie SET descricao = $1 WHERE id = $2',
            [extract, row.id]
          );
        }
        console.log(`   OK: ${extract.slice(0, 80)}...`);
        updated++;
      } else {
        console.log(`   NOT FOUND: ${scientificName}`);
        notFound++;
      }

      // Be polite to Wikipedia API
      await sleep(250);
    }

    console.log('');
    console.log('==> Summary:');
    console.log(`   Updated:  ${updated}`);
    console.log(`   Not found: ${notFound}`);
    console.log(`   Errors:   ${errors}`);
    if (dryRun) console.log('   (dry-run: no changes saved)');
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
