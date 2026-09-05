// ============================================================
// BioGuardians - Validate & standardize extinction categories
//
// For every species in `especie`, resolve categoria_ameaca from
// authoritative sources and record where it came from:
//
//   1. MMA official list (scripts/data/input/mma_especies.csv)
//      → highest authority for Brazilian fauna  (fonte = 'mma')
//   2. IUCN Red List via GBIF API              (fonte = 'iucn')
//   3. Keep whatever is there (usually the AI's guess)
//      → marked as unreliable                    (fonte = 'ai')
//
// Also flags non-wildlife species (humans, domestic animals)
// detected by the camera traps as status='inativo'.
//
// Usage:
//   node validate_categories.mjs            # apply fixes
//   node validate_categories.mjs --dry-run  # report only
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

const DRY_RUN = process.argv.includes('--dry-run');
const VALID = new Set(['CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NE']);

// Species that are not wildlife — detected by camera traps but should
// not pollute the species catalog
const NON_WILDLIFE = new Set([
  'homo sapiens',
  'bos taurus',
  'canis familiaris',
  'canis lupus familiaris',
  'felis catus',
  'equus caballus',
  'equus asinus',
  'sus scrofa',        // javali — exótico invasor, não fauna nativa
  'capra hircus',
  'ovis aries',
  'gallus gallus',
  'bubalus bubalis',
]);

// ---------- MMA CSV (semicolon-separated) ----------
function loadMmaCsv(path) {
  const content = readFileSync(path, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(';').map(h => h.trim());
  const map = new Map(); // nome_cientifico -> categoria
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map(v => v.trim());
    if (values.length < headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx]; });
    const nome = (row.nome_cientifico || '').toLowerCase().trim();
    const cat = (row.categoria || '').trim().toUpperCase();
    if (nome && VALID.has(cat)) map.set(nome, cat);
  }
  return map;
}

// ---------- IUCN via GBIF ----------
async function iucnCategory(scientificName) {
  try {
    const match = await fetch(
      `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
    ).then(r => r.json());

    if (!match.usageKey) return null;

    const iucn = await fetch(
      `https://api.gbif.org/v1/species/${match.usageKey}/iucnRedListCategory`
    ).then(r => (r.ok ? r.json() : null));

    if (iucn?.code && VALID.has(iucn.code)) return iucn.code;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const mmaPath = resolve(__dirname, 'input/mma_especies.csv');
  const mma = loadMmaCsv(mmaPath);
  console.log(`==> MMA list loaded: ${mma.size} official species`);
  console.log(DRY_RUN ? '==> DRY RUN — no changes will be written\n' : '');

  const client = await pool.connect();
  const stats = { mma: 0, iucn: 0, ai_kept: 0, changed: 0, inativo: 0, unchanged: 0 };
  const divergences = [];

  try {
    const { rows: especies } = await client.query(
      `SELECT id, nome_cientifico, categoria_ameaca, categoria_fonte, status
         FROM especie ORDER BY id`
    );
    console.log(`==> ${especies.length} species to validate\n`);

    for (const sp of especies) {
      const nome = sp.nome_cientifico.toLowerCase().trim();

      // 0. Non-wildlife — flag as inativo + NE (Sem Risco)
      if (NON_WILDLIFE.has(nome)) {
        if (sp.status !== 'inativo' || sp.categoria_ameaca !== 'NE') {
          console.log(`  [inativo] ${nome} — not wildlife → NE (Sem Risco)`);
          if (!DRY_RUN) {
            await client.query(
              `UPDATE especie
                  SET status='inativo',
                      categoria_ameaca='NE'::categoria_ameaca_tipo,
                      categoria_fonte='manual',
                      atualizado_em=now()
                WHERE id=$1`,
              [sp.id]
            );
          }
          stats.inativo++;
        }
        continue;
      }

      let resolved = null;
      let fonte = null;

      // 1. MMA official list
      if (mma.has(nome)) {
        resolved = mma.get(nome);
        fonte = 'mma';
      } else {
        // 2. IUCN via GBIF
        const code = await iucnCategory(sp.nome_cientifico);
        if (code) {
          resolved = code;
          fonte = 'iucn';
        }
      }

      if (resolved) {
        if (resolved !== sp.categoria_ameaca || fonte !== sp.categoria_fonte) {
          const diverged = resolved !== sp.categoria_ameaca;
          console.log(
            `  [${diverged ? 'FIX' : 'fonte'}] ${nome}: ${sp.categoria_ameaca} → ${resolved} (${fonte})`
          );
          if (diverged) {
            divergences.push({ nome, antes: sp.categoria_ameaca, depois: resolved, fonte });
          }
          if (!DRY_RUN) {
            await client.query(
              `UPDATE especie
                  SET categoria_ameaca = $2::categoria_ameaca_tipo,
                      categoria_fonte = $3,
                      atualizado_em = now()
                WHERE id = $1`,
              [sp.id, resolved, fonte]
            );
          }
          stats.changed++;
        } else {
          stats.unchanged++;
        }
        stats[fonte]++;
      } else {
        // 3. No official source — keep current value, flag as 'ai'
        if (sp.categoria_fonte !== 'ai') {
          console.log(`  [ai] ${nome}: sem fonte oficial — mantendo ${sp.categoria_ameaca} (não confiável)`);
          if (!DRY_RUN) {
            await client.query(
              "UPDATE especie SET categoria_fonte='ai', atualizado_em=now() WHERE id=$1",
              [sp.id]
            );
          }
        }
        stats.ai_kept++;
      }
    }

    console.log('\n==> Summary:');
    console.log(`   Oficial MMA:   ${stats.mma}`);
    console.log(`   IUCN/GBIF:     ${stats.iucn}`);
    console.log(`   Sem fonte (ai):${stats.ai_kept}`);
    console.log(`   Corrigidas:    ${stats.changed}`);
    console.log(`   Já corretas:   ${stats.unchanged}`);
    console.log(`   Não-fauna:     ${stats.inativo} (marcadas inativo)`);

    if (divergences.length > 0) {
      console.log('\n==> Divergências (IA/banco estava errado):');
      for (const d of divergences) {
        console.log(`   ${d.nome}: ${d.antes} → ${d.depois} [${d.fonte}]`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
