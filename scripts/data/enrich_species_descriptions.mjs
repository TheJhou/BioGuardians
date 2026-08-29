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
// Tries multiple strategies in order:
//   1. Wikipedia page summary by scientific name (PT/EN)
//   2. Wikipedia page summary by popular name (PT/EN)
//   3. Wikipedia search (opensearch) for scientific name
//   4. Wikidata entity description
//   5. Wikipedia search (opensearch) for popular name
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

function normalizeTitle(name) {
  if (!name) return null;
  return name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanName(name) {
  // Remove possessives and weird suffixes from some names
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

async function fetchWikipediaSummary(title, lang = 'pt') {
  if (!title) return null;
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.type === 'disambiguation') return null;
    return data.extract || null;
  } catch (err) {
    return null;
  }
}

async function searchWikipedia(query, lang = 'pt') {
  if (!query) return null;
  const url = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json`;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const titles = data[1];
    const extracts = data[2];
    if (!titles || titles.length === 0) return null;
    // Prefer a result whose title is close to the query and has a non-empty extract
    for (let i = 0; i < titles.length; i++) {
      if (extracts[i] && extracts[i].trim()) return extracts[i];
    }
    // Fallback to summary of first result
    return await fetchWikipediaSummary(titles[0], lang);
  } catch (err) {
    return null;
  }
}

async function fetchINaturalistWikipediaUrl(scientificName) {
  if (!scientificName) return null;
  const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&rank=species&per_page=5`;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    for (const taxon of results) {
      const name = (taxon.name || '').toLowerCase().trim();
      if (name === scientificName.toLowerCase().trim() && taxon.wikipedia_url) {
        return taxon.wikipedia_url;
      }
    }
    // Fallback to first with wikipedia_url
    for (const taxon of results) {
      if (taxon.wikipedia_url) return taxon.wikipedia_url;
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function fetchWikipediaFromUrl(wikiUrl, lang = 'pt') {
  if (!wikiUrl) return null;
  // Extract title from URL like https://pt.wikipedia.org/wiki/Panthera_onca
  const match = wikiUrl.match(/wiki\/(.+)$/);
  if (!match) return null;
  const title = decodeURIComponent(match[1]);
  return await fetchWikipediaSummary(title, lang);
}

async function fetchEolDescription(scientificName) {
  if (!scientificName) return null;
  // EOL pages API is unstable; try a generic search
  const searchUrl = `https://eol.org/api/search/1.0.json?q=${encodeURIComponent(scientificName)}&page=1&exact=true`;
  try {
    const res = await fetchWithTimeout(searchUrl, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return null;

    const pageUrl = `https://eol.org/api/pages/1.0/${result.id}.json?details=true&taxonomy=false`;
    const pageRes = await fetchWithTimeout(pageUrl, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!pageRes.ok) return null;
    const pageData = await pageRes.json();
    const agents = pageData.taxonConcept?.dataObjects || [];
    for (const obj of agents) {
      if (obj.description && obj.description.trim()) {
        return obj.description.trim();
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function fetchWikidataDescription(scientificName) {
  if (!scientificName) return null;
  try {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(scientificName)}&language=pt&format=json&limit=1`;
    const res = await fetchWithTimeout(searchUrl, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const entity = data.search?.[0];
    if (!entity) return null;

    const detailUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=descriptions&languages=pt|en&format=json`;
    const detailRes = await fetchWithTimeout(detailUrl, { headers: { 'User-Agent': 'BioGuardians/1.0' } });
    if (!detailRes.ok) return null;
    const detailData = await detailRes.json();
    const entityData = detailData.entities?.[entity.id];
    const pt = entityData?.descriptions?.pt?.value;
    const en = entityData?.descriptions?.en?.value;
    return pt || en || null;
  } catch (err) {
    return null;
  }
}

function isRelevant(extract, nome_cientifico, nome_popular) {
  if (!extract) return false;
  const lower = extract.toLowerCase();

  // Popular name match: any non-trivial part found in extract is enough
  if (nome_popular) {
    const popularParts = cleanName(nome_popular).toLowerCase().split(/[-\s]+/).filter(Boolean);
    for (const part of popularParts) {
      if (part.length >= 4 && lower.includes(part)) return true;
    }
  }

  // Scientific name match: both main parts should appear
  const scientificParts = cleanName(nome_cientifico).toLowerCase().split(' ').filter(Boolean);
  if (scientificParts.length >= 2) {
    const [genus, ...rest] = scientificParts;
    const species = rest.join(' ');
    const hasGenus = lower.includes(genus);
    const hasSpecies = species.length >= 3 && (lower.includes(species) || lower.includes(species.replace(/i$/, '')));
    return hasGenus && hasSpecies;
  }

  return false;
}

async function getDescription({ nome_cientifico, nome_popular }) {
  const cleanScientific = cleanName(nome_cientifico);
  const cleanPopular = nome_popular ? cleanName(nome_popular) : null;

  // 1. iNaturalist wikipedia URL redirect
  const wikiUrl = await fetchINaturalistWikipediaUrl(cleanScientific);
  if (wikiUrl) {
    const lang = wikiUrl.includes('pt.wikipedia') ? 'pt' : 'en';
    const title = wikiUrl.match(/wiki\/(.+)$/)?.[1];
    if (title) {
      const decodedTitle = decodeURIComponent(title);
      let desc = await fetchWikipediaSummary(decodedTitle, lang);
      if (isRelevant(desc, nome_cientifico, nome_popular)) return { desc, source: `wikipedia-${lang}-inaturalist` };
    }
    const langFromUrl = wikiUrl.includes('pt.wikipedia') ? 'pt' : 'en';
    let desc = await fetchWikipediaFromUrl(wikiUrl, langFromUrl);
    if (isRelevant(desc, nome_cientifico, nome_popular)) return { desc, source: `wikipedia-${langFromUrl}-inaturalist` };
  }

  // 2. EOL (Encyclopedia of Life) as a scientific source
  let desc = await fetchEolDescription(cleanScientific);
  if (desc) return { desc, source: 'eol' };

  // 3. Popular name exact summary
  if (cleanPopular) {
    const popTitle = normalizeTitle(cleanPopular);
    desc = await fetchWikipediaSummary(popTitle, 'pt');
    if (isRelevant(desc, nome_cientifico, nome_popular)) return { desc, source: 'wikipedia-pt-popular' };

    desc = await fetchWikipediaSummary(popTitle, 'en');
    if (isRelevant(desc, nome_cientifico, nome_popular)) return { desc, source: 'wikipedia-en-popular' };
  }

  // 4. Scientific name exact summary
  const sciTitle = normalizeTitle(cleanScientific);
  desc = await fetchWikipediaSummary(sciTitle, 'pt');
  if (isRelevant(desc, nome_cientifico, nome_popular)) return { desc, source: 'wikipedia-pt-scientific' };

  desc = await fetchWikipediaSummary(sciTitle, 'en');
  if (isRelevant(desc, nome_cientifico, nome_popular)) return { desc, source: 'wikipedia-en-scientific' };

  // 5. Wikipedia search by scientific name
  desc = await searchWikipedia(cleanScientific, 'pt');
  if (isRelevant(desc, nome_cientifico, nome_popular)) return { desc, source: 'wikipedia-pt-search-scientific' };

  desc = await searchWikipedia(cleanScientific, 'en');
  if (isRelevant(desc, nome_cientifico, nome_popular)) return { desc, source: 'wikipedia-en-search-scientific' };

  // 6. Wikidata entity description
  desc = await fetchWikidataDescription(cleanScientific);
  if (desc) return { desc, source: 'wikidata' };

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const dryRun = args.includes('--dry-run');
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  console.log('==> BioGuardians — Species Description Enrichment (v2)');

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
      console.log(`   Fetching: ${row.nome_cientifico}`);

      try {
        const result = await getDescription({ nome_cientifico: row.nome_cientifico, nome_popular: row.nome_popular });

        if (result) {
          if (!dryRun) {
            await client.query(
              'UPDATE especie SET descricao = $1 WHERE id = $2',
              [result.desc, row.id]
            );
          }
          console.log(`   OK (${result.source}): ${result.desc.slice(0, 80)}...`);
          updated++;
        } else {
          console.log(`   NOT FOUND: ${row.nome_cientifico}`);
          notFound++;
        }
      } catch (err) {
        console.warn(`   ERROR: ${row.nome_cientifico} — ${err.message}`);
        errors++;
      }

      // Be polite to APIs
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
