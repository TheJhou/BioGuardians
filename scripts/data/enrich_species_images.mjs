// ============================================================
// BioGuardians - Enrich species images
//
// Fetches species images from iNaturalist and Wikimedia Commons
// and stores the URL in `especie.imagem_url`.
//
// Usage:
//   node enrich_species_images.mjs
//   node enrich_species_images.mjs --limit=50 --dry-run
//
// Strategies:
//   1. iNaturalist default photo for the taxon
//   2. Wikimedia Commons image via Wikidata P18
//   3. Wikipedia page thumbnail
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

function cleanName(name) {
  return name
    .replace(/'s\s+\w+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWithTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchINaturalistImage(scientificName) {
  if (!scientificName) return null;
  const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&rank=species&per_page=5`;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    const target = cleanName(scientificName).toLowerCase().trim();
    for (const taxon of results) {
      const name = (taxon.name || '').toLowerCase().trim();
      if (name === target && taxon.default_photo?.medium_url) {
        return taxon.default_photo.medium_url;
      }
    }
    for (const taxon of results) {
      if (taxon.default_photo?.medium_url) return taxon.default_photo.medium_url;
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function searchWikidataEntity(scientificName) {
  if (!scientificName) return null;
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(scientificName)}&language=pt&format=json&limit=1`;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.search?.[0]?.id || null;
  } catch (err) {
    return null;
  }
}

async function fetchWikidataImage(qid) {
  if (!qid) return null;
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const claims = data.entities?.[qid]?.claims || {};
    const p18 = claims.P18?.[0]?.mainsnak?.datavalue?.value;
    const p200 = claims.P200?.[0]?.mainsnak?.datavalue?.value;
    const p1813 = claims.P1813?.[0]?.mainsnak?.datavalue?.value;
    if (p18) {
      const file = encodeURIComponent(p18.replace(/ /g, '_'));
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=640`;
    }
    if (p200) return p200;
    if (p1813) return p1813;
    return null;
  } catch (err) {
    return null;
  }
}

async function fetchWikipediaImage(title, lang = 'pt') {
  if (!title) return null;
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=640&origin=*`;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data.query?.pages || {};
    for (const key of Object.keys(pages)) {
      const thumb = pages[key].thumbnail?.source;
      if (thumb) return thumb;
    }
    return null;
  } catch (err) {
    return null;
  }
}

function normalizeTitle(name) {
  if (!name) return null;
  return name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getImage({ nome_cientifico, nome_popular }) {
  const cleanScientific = cleanName(nome_cientifico);

  // 1. iNaturalist default photo
  let img = await fetchINaturalistImage(cleanScientific);
  if (img) return { img, source: 'inaturalist' };

  // 2. Wikidata P18
  const qid = await searchWikidataEntity(cleanScientific);
  if (qid) {
    img = await fetchWikidataImage(qid);
    if (img) return { img, source: 'wikidata' };
  }

  // 3. Wikipedia thumbnail by scientific name
  const sciTitle = normalizeTitle(cleanScientific);
  img = await fetchWikipediaImage(sciTitle, 'pt');
  if (img) return { img, source: 'wikipedia-pt-scientific' };
  img = await fetchWikipediaImage(sciTitle, 'en');
  if (img) return { img, source: 'wikipedia-en-scientific' };

  // 4. Wikipedia thumbnail by popular name
  if (nome_popular) {
    const popTitle = normalizeTitle(cleanName(nome_popular));
    img = await fetchWikipediaImage(popTitle, 'pt');
    if (img) return { img, source: 'wikipedia-pt-popular' };
  }

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const dryRun = args.includes('--dry-run');
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  console.log('==> BioGuardians — Species Image Enrichment');

  const client = await pool.connect();
  let updated = 0;
  let notFound = 0;
  let errors = 0;

  try {
    let query = 'SELECT id, nome_cientifico, nome_popular FROM especie WHERE imagem_url IS NULL ORDER BY id';
    const params = [];
    if (limit) {
      query += ' LIMIT $1';
      params.push(limit);
    }
    const { rows } = await client.query(query, params);
    console.log(`   Found ${rows.length} species without image`);

    for (const row of rows) {
      console.log(`   Fetching: ${row.nome_cientifico}`);

      try {
        const result = await getImage({ nome_cientifico: row.nome_cientifico, nome_popular: row.nome_popular });

        if (result) {
          if (!dryRun) {
            await client.query(
              'UPDATE especie SET imagem_url = $1 WHERE id = $2',
              [result.img, row.id]
            );
          }
          console.log(`   OK (${result.source}): ${result.img.slice(0, 80)}...`);
          updated++;
        } else {
          console.log(`   NOT FOUND: ${row.nome_cientifico}`);
          notFound++;
        }
      } catch (err) {
        console.warn(`   ERROR: ${row.nome_cientifico} — ${err.message}`);
        errors++;
      }

      await sleep(300);
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
