// ============================================================
// BioGuardians - Load MMA threatened species from CSV
//
// Reads a CSV file with the official MMA list of threatened
// species and inserts them into the database.
//
// Usage:
//   node load_mma_especies.mjs
//   node load_mma_especies.mjs --file=input/custom.csv
//
// CSV format (UTF-8, semicolon-separated):
//   nome_cientifico;nome_popular;categoria;reino;filo;classe;ordem;familia;genero;biomas;estados
//
// Idempotent: uses ON CONFLICT to skip existing species.
// ============================================================

import { readFileSync } from 'fs';
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

// Parse CSV (semicolon-separated, with header)
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(';').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map(v => v.trim());
    if (values.length < headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx]; });
    rows.push(row);
  }
  return rows;
}

// Map MMA category names to our enum codes
function mapCategoria(cat) {
  const mapping = {
    'Criticamente em Perigo': 'CR',
    'Em Perigo': 'EN',
    'Vulnerável': 'VU',
    'Quase Ameaçada': 'NT',
    'Menos Preocupante': 'LC',
    'Dados Insuficientes': 'DD',
    'CR': 'CR', 'EN': 'EN', 'VU': 'VU', 'NT': 'NT', 'LC': 'LC', 'DD': 'DD',
  };
  return mapping[cat] || 'DD';
}

// Find or create a taxon by name and rank
async function findOrCreateTaxon(client, nome, rank, parentId = null) {
  nome = nome.trim();
  if (!nome) return null;

  // Try to find existing
  const { rows } = await client.query(
    'SELECT id FROM taxon WHERE nome = $1 AND "rank" = $2',
    [nome, rank]
  );
  if (rows.length > 0) return rows[0].id;

  // Create new
  const { rows: inserted } = await client.query(
    'INSERT INTO taxon (nome, "rank", parent_id) VALUES ($1, $2, $3) RETURNING id',
    [nome, rank, parentId]
  );
  return inserted[0].id;
}

// Parse biomas list (comma-separated names)
function parseBiomas(biomasStr) {
  if (!biomasStr) return [];
  return biomasStr.split(',').map(b => b.trim()).filter(Boolean);
}

// Parse states list (comma-separated UFs)
function parseEstados(estadosStr) {
  if (!estadosStr) return [];
  return estadosStr.split(',').map(e => e.trim().toUpperCase()).filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find(a => a.startsWith('--file='));
  const csvPath = fileArg
    ? fileArg.split('=')[1]
    : resolve(__dirname, 'input/mma_especies.csv');

  console.log('==> BioGuardians — MMA Species Loader');
  console.log(`   Reading: ${csvPath}`);

  let content;
  try {
    content = readFileSync(csvPath, 'utf-8');
  } catch (err) {
    console.error(`ERROR: Could not read CSV file: ${csvPath}`);
    console.error('   Place the MMA species list at scripts/data/input/mma_especies.csv');
    console.error('   See scripts/data/README.md for CSV format.');
    process.exit(1);
  }

  const rows = parseCSV(content);
  console.log(`   Parsed ${rows.length} species from CSV`);

  const client = await pool.connect();
  let inserted = 0, skipped = 0, errors = 0;

  try {
    await client.query('BEGIN');

    // Cache bioma IDs by name
    const { rows: biomas } = await client.query('SELECT id, nome FROM bioma');
    const biomaMap = new Map(biomas.map(b => [b.nome.toLowerCase(), b.id]));

    for (const row of rows) {
      try {
        const nomeCientifico = (row.nome_cientifico || '').toLowerCase().trim();
        if (!nomeCientifico || nomeCientifico.length < 4) {
          console.warn(`   SKIP: invalid name "${row.nome_cientifico}"`);
          errors++;
          continue;
        }

        const categoria = mapCategoria(row.categoria);
        const nomePopular = row.nome_popular || null;

        // Build taxonomy chain: reino -> filo -> classe -> ordem -> familia -> genero
        const reinoId = await findOrCreateTaxon(client, row.reino, 'reino');
        const filoId = await findOrCreateTaxon(client, row.filo, 'filo', reinoId);
        const classeId = await findOrCreateTaxon(client, row.classe, 'classe', filoId);
        const ordemId = await findOrCreateTaxon(client, row.ordem, 'ordem', classeId);
        const familiaId = await findOrCreateTaxon(client, row.familia, 'familia', ordemId);
        const generoId = await findOrCreateTaxon(client, row.genero, 'genero', familiaId);

        if (!generoId) {
          // Extract genus from scientific name (first word)
          const generoFromName = nomeCientifico.split(' ')[0];
          if (generoFromName) {
            const fallbackGeneroId = await findOrCreateTaxon(client, generoFromName, 'genero', familiaId);
            if (fallbackGeneroId) {
              // Insert species with fallback genus
              const { rowCount } = await client.query(
                `INSERT INTO especie (nome_cientifico, nome_popular, categoria_ameaca, genero_id, status)
                 VALUES ($1, $2, $3, $4, 'ativo')
                 ON CONFLICT (nome_cientifico) DO NOTHING`,
                [nomeCientifico, nomePopular, categoria, fallbackGeneroId]
              );
              if (rowCount > 0) {
                inserted++;
                await linkBiomasAndEstados(client, nomeCientifico, row, biomaMap);
              } else {
                skipped++;
              }
              continue;
            }
          }
          console.warn(`   SKIP: no genus for "${nomeCientifico}"`);
          errors++;
          continue;
        }

        // Insert species (idempotent via ON CONFLICT)
        const { rowCount } = await client.query(
          `INSERT INTO especie (nome_cientifico, nome_popular, categoria_ameaca, genero_id, status)
           VALUES ($1, $2, $3, $4, 'ativo')
           ON CONFLICT (nome_cientifico) DO NOTHING`,
          [nomeCientifico, nomePopular, categoria, generoId]
        );

        if (rowCount > 0) {
          inserted++;
          await linkBiomasAndEstados(client, nomeCientifico, row, biomaMap);
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(`   ERROR: ${row.nome_cientifico} — ${err.message}`);
        errors++;
      }
    }

    await client.query('COMMIT');
    console.log('');
    console.log('==> Summary:');
    console.log(`   Inserted: ${inserted}`);
    console.log(`   Skipped:  ${skipped} (already existed)`);
    console.log(`   Errors:   ${errors}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FATAL:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

async function linkBiomasAndEstados(client, nomeCientifico, row, biomaMap) {
  // Get species ID
  const { rows } = await client.query(
    'SELECT id FROM especie WHERE nome_cientifico = $1', [nomeCientifico]
  );
  if (rows.length === 0) return;
  const especieId = rows[0].id;

  // Link biomas
  const biomas = parseBiomas(row.biomas);
  for (const biomaNome of biomas) {
    const biomaId = biomaMap.get(biomaNome.toLowerCase());
    if (biomaId) {
      await client.query(
        'INSERT INTO especie_bioma (especie_id, bioma_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [especieId, biomaId]
      );
    }
  }

  // Link estados
  const estados = parseEstados(row.estados);
  for (const uf of estados) {
    if (uf.length === 2) {
      await client.query(
        'INSERT INTO especie_estado (especie_id, estado_uf) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [especieId, uf]
      );
    }
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
