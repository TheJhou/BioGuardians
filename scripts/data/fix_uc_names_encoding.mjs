// ============================================================
// BioGuardians - Corrige nomes de UC com dupla codificação
//
// A carga original do CNUC leu o .dbf (UTF-8) como windows-1252, gravando
// nomes como "RESERVA BIOLÃ“GICA" em vez de "RESERVA BIOLÓGICA". Este script
// reverte a dupla codificação e valida cada nome corrigido contra o
// shapefile original lido como UTF-8.
//
// Uso:
//   node fix_uc_names_encoding.mjs            # simulação (ROLLBACK no fim)
//   node fix_uc_names_encoding.mjs --commit   # aplica
//
// Tudo numa transação. O trigger de auditoria genérico grava a linha inteira
// (com a geometria) e geraria ~244 MB de log para esta correção; por isso ele
// é desligado SÓ dentro da transação e cada UC recebe um registro de
// auditoria enxuto (nome antigo -> novo). Backup dos nomes antigos em
// backups/ antes de qualquer escrita.
// ============================================================

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';
import shapefile from 'shapefile';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const COMMIT = process.argv.includes('--commit');
const SHP = resolve(__dirname, 'input/cnuc_ucs/ucs.shp');

// Caracteres que o windows-1252 mapeia fora de 0x00–0xFF -> byte original
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const SUSPEITO = /Ã[\u0080-¿ŒœŠšŸŽžƒˆ˜–-™]|Â[\u0080-¿]/;

function reverteDuplaCodificacao(s) {
  const bytes = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) bytes.push(cp);
    else if (CP1252[cp] !== undefined) bytes.push(CP1252[cp]);
    else return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

async function nomesDoShapefile() {
  const nomes = new Set();
  const source = await shapefile.open(SHP, undefined, { encoding: 'utf-8' });
  while (true) {
    const { done, value } = await source.read();
    if (done) break;
    const nome = (value.properties.nome_uc || '').trim();
    if (nome) nomes.add(nome);
  }
  return nomes;
}

async function main() {
  console.log(`Modo: ${COMMIT ? 'COMMIT (aplica)' : 'simulação (ROLLBACK)'}`);
  const referencia = await nomesDoShapefile();
  console.log(`Nomes no shapefile (UTF-8): ${referencia.size}`);

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'bioguardians-fix-uc-names' });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");

    const { rows } = await client.query('SELECT id, nome FROM area_protegida ORDER BY id FOR UPDATE');
    const existentes = new Map(rows.map((r) => [r.nome, r.id]));

    const fixes = [];
    const problemas = [];
    for (const r of rows) {
      if (!SUSPEITO.test(r.nome)) continue;
      const novo = reverteDuplaCodificacao(r.nome);
      if (novo === null) problemas.push({ id: r.id, motivo: 'não reversível', nome: r.nome });
      else if (SUSPEITO.test(novo)) problemas.push({ id: r.id, motivo: 'ainda suspeito', nome: novo });
      else if (existentes.has(novo) && existentes.get(novo) !== r.id) problemas.push({ id: r.id, motivo: 'colide com nome existente', nome: novo });
      else if (!referencia.has(novo)) problemas.push({ id: r.id, motivo: 'não existe no shapefile', nome: novo });
      else fixes.push({ id: r.id, antigo: r.nome, novo });
    }
    console.log(`UCs: ${rows.length} | a corrigir: ${fixes.length} | problemas: ${problemas.length}`);
    if (problemas.length) {
      console.table(problemas.slice(0, 20));
      throw new Error('Há nomes que não passaram na validação — nada foi alterado.');
    }

    // Backup antes de escrever
    const dir = resolve(__dirname, 'backups');
    mkdirSync(dir, { recursive: true });
    const backup = resolve(dir, `uc_nomes_antes_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(backup, JSON.stringify(fixes, null, 2));
    console.log(`Backup: ${backup}`);

    const ids = fixes.map((f) => f.id);
    const antigos = fixes.map((f) => f.antigo);
    const novos = fixes.map((f) => f.novo);

    await client.query('ALTER TABLE area_protegida DISABLE TRIGGER trg_area_protegida_audit');
    const upd = await client.query(
      `UPDATE area_protegida a SET nome = v.novo
       FROM unnest($1::int[], $2::text[], $3::text[]) AS v(id, antigo, novo)
       WHERE a.id = v.id AND a.nome = v.antigo`,
      [ids, antigos, novos]
    );
    if (upd.rowCount !== fixes.length) throw new Error(`UPDATE afetou ${upd.rowCount} linhas, esperado ${fixes.length}`);

    const aud = await client.query(
      `INSERT INTO log_auditoria (tabela, operacao, registro_id, dados_anteriores, dados_novos)
       SELECT 'area_protegida', 'UPDATE', v.id,
              jsonb_build_object('nome', v.antigo),
              jsonb_build_object('nome', v.novo, 'motivo', 'correção de encoding: nome UTF-8 lido como windows-1252 na carga do CNUC')
       FROM unnest($1::int[], $2::text[], $3::text[]) AS v(id, antigo, novo)`,
      [ids, antigos, novos]
    );
    await client.query('ALTER TABLE area_protegida ENABLE TRIGGER trg_area_protegida_audit');

    // Conferências dentro da transação
    const { rows: [chk] } = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE nome ~ $1)::int AS suspeitos,
              (SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_area_protegida_audit') AS trigger_audit
       FROM area_protegida`,
      [SUSPEITO.source]
    );
    console.log({ atualizadas: upd.rowCount, auditoria_inserida: aud.rowCount, ...chk });
    if (chk.suspeitos !== 0 || chk.total !== rows.length || chk.trigger_audit !== 'O') {
      throw new Error('Conferência final falhou — ROLLBACK.');
    }

    if (COMMIT) {
      await client.query('COMMIT');
      console.log('COMMIT feito. Atualizando views materializadas...');
      await client.query('SELECT refresh_dashboard()');
      console.log('refresh_dashboard() ok.');
    } else {
      await client.query('ROLLBACK');
      console.log('Simulação concluída: ROLLBACK (nada foi alterado).');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERRO:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
