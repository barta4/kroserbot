#!/usr/bin/env node
/**
 * Evaluación de precisión de búsqueda contra el catálogo real.
 *
 * Uso:
 *   node scripts/eval-search.js
 *   node scripts/eval-search.js --channel=whatsapp
 *   node scripts/eval-search.js --strict
 *
 * Mide hit@1, hit@5, consultas sin resultados y ausencias esperadas.
 * Por defecto usa sólo la capa textual (skipVector) para que el resultado sea
 * reproducible sin depender del proveedor de embeddings.
 */

const fs = require('fs');
const path = require('path');

process.env.POSTGRES_HOST = process.env.POSTGRES_HOST || 'localhost';
process.env.POSTGRES_PORT = process.env.POSTGRES_PORT || '5432';
process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'kroser';
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'kroser';
process.env.POSTGRES_DB = process.env.POSTGRES_DB || 'kroserbot';

const { hybridSearch } = require(path.join(__dirname, '..', 'backend', 'services', 'search', 'searchService'));

const args = process.argv.slice(2);
const channelArg = (args.find((a) => a.startsWith('--channel=')) || '').split('=')[1] || 'web';
const limitArg = parseInt((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1], 10);
const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 5;
const useVector = args.includes('--vector');
const strict = args.includes('--strict');
const allowRelaxed = channelArg !== 'whatsapp';

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'search-golden.json'), 'utf8'));

function matchesAny(name, patterns) {
  return (patterns || []).some((pattern) => new RegExp(pattern, 'i').test(name || ''));
}

(async () => {
  let hit1 = 0;
  let hit5 = 0;
  let zeros = 0;
  let absentOk = 0;
  let absentTotal = 0;
  const rows = [];

  for (const item of golden.queries) {
    let results = [];
    try {
      results = await hybridSearch(item.query, {
        limit,
        skipVector: !useVector,
        allowRelaxed,
      });
    } catch (err) {
      rows.push({ ...item, error: err.message });
      continue;
    }

    if (item.expectAbsent) {
      absentTotal++;
      const ok = results.length === 0;
      if (ok) absentOk++;
      rows.push({ ...item, count: results.length, ok, top: results[0] && results[0].nombre });
      continue;
    }

    if (results.length === 0) zeros++;
    const top1Ok = results[0] && matchesAny(results[0].nombre, item.expect);
    const top5Ok = results.some((r) => matchesAny(r.nombre, item.expect));
    if (top1Ok) hit1++;
    if (top5Ok) hit5++;

    rows.push({
      ...item,
      count: results.length,
      top1Ok: Boolean(top1Ok),
      top5Ok: Boolean(top5Ok),
      top: results[0] && results[0].nombre,
      approximate: results[0] && results[0]._approximate,
    });
  }

  const scored = golden.queries.filter((q) => !q.expectAbsent).length;
  const pct = (n) => (scored > 0 ? Math.round((n / scored) * 100) : 0);

  console.log(`\nCanal: ${channelArg} | límite: ${limit} | vector: ${useVector ? 'sí' : 'no'} | relajado: ${allowRelaxed ? 'sí' : 'no'}\n`);
  console.log('Consulta'.padEnd(34) + 'top1  top5  #  resultado');
  console.log('-'.repeat(110));
  for (const row of rows) {
    if (row.expectAbsent) {
      console.log(`${row.query.padEnd(34)}${'—'.padEnd(6)}${'—'.padEnd(6)}${String(row.count).padEnd(3)}${row.ok ? 'AUSENCIA OK' : row.top || ''}`);
      continue;
    }
    console.log(
      `${row.query.padEnd(34)}${(row.top1Ok ? '✓' : '·').padEnd(6)}${(row.top5Ok ? '✓' : '·').padEnd(6)}${String(row.count).padEnd(3)}${(row.top || '').slice(0, 58)}${row.approximate ? ' *' : ''}`
    );
  }

  console.log('-'.repeat(110));
  console.log(`Hit@1: ${hit1}/${scored} (${pct(hit1)}%)`);
  console.log(`Hit@5: ${hit5}/${scored} (${pct(hit5)}%)`);
  console.log(`Consultas sin resultados: ${zeros}/${scored}`);
  if (absentTotal > 0) console.log(`Ausencias correctas: ${absentOk}/${absentTotal}`);
  console.log('* = resultado aproximado (atributo faltante; el canal debe pedir aclaración)');

  if (strict && (pct(hit5) < 80 || (absentTotal > 0 && absentOk < absentTotal))) {
    process.exitCode = 1;
  }

  process.exit(process.exitCode || 0);
})();
