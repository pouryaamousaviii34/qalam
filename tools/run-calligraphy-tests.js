#!/usr/bin/env node
/* =====================================================================
   tools/run-calligraphy-tests.js
   ---------------------------------------------------------------------
   اجراکنندهٔ آزمون‌های دانشِ خوشنویسی. هیچ کدِ موتور را تغییر نمی‌دهد.
   آزمون‌هایی که requiresEngine=true هستند، *فقط* پارامترهای پیکربندیِ
   موتور را می‌خوانند (بدون DOM، بدون رندر).

   اجرا:  node tools/run-calligraphy-tests.js
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const rd = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name))
                  : (e.name.endsWith('.json') ? [path.join(d, e.name)] : []));

const rules = rd('data/calligraphy-rules.json').rules;
const byId = new Map(rules.map(r => [r.id, r]));
const inv = rd('docs/source-inventory.json');

const res = { passed: 0, failed: 0, skipped: 0, unknown: 0, details: [] };
const rec = (id, verdict, msg) => {
  res.details.push({ id, verdict, msg });
  if (verdict === 'PASS') res.passed++;
  else if (verdict === 'FAIL') res.failed++;
  else if (verdict === 'SKIP') res.skipped++;
  else res.unknown++;
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);

for (const f of walk(path.join(root, 'tests/calligraphy')).sort()) {
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  const id = t.testId;

  if (t.status === 'SKIPPED' || t.expected === 'NOT_SPECIFIED_BY_SOURCE') {
    rec(id, 'SKIP', t.note || 'منبع قاعده‌ای ارائه نمی‌دهد');
    continue;
  }
  if (t.status === 'PENDING') { rec(id, 'UNKNOWN', 'تعریف‌نشده'); continue; }

  try {
    switch (id) {
      /* ---- نقطه: ضلع = پهنای نوک ---- */
      case 'RULE-NIB-001': {
        const w = t.input.nibWidth;
        const dotSide = w;                      // RULE-NIB-001
        rec(id, near(dotSide, t.expected.dotSide, t.tolerance.dotSide) ? 'PASS' : 'FAIL',
            `dotSide=${dotSide} expected=${t.expected.dotSide}`);
        break;
      }
      /* ---- دانگ = پهنا/۶ ---- */
      case 'RULE-DANG-001': {
        const d = t.input.nibWidth / 6;
        rec(id, near(d, t.expected.dangLength, t.tolerance.dangLength) ? 'PASS' : 'FAIL',
            `dang=${d} expected=${t.expected.dangLength}`);
        break;
      }
      /* ---- شش‌دانگی در برابر پنج‌دانگی ---- */
      case 'RULE-STYLE-001': {
        const w = t.input.nibWidth;
        const cls = w * 6 / 6, kal = w * 5 / 6;
        const ok = near(cls, t.expected.classical.dotPullLength, 0.01) &&
                   near(kal, t.expected.kalhor.dotPullLength, 0.01);
        rec(id, ok ? 'PASS' : 'FAIL', `classical=${cls} kalhor=${kal.toFixed(2)}`);
        break;
      }
      /* ---- ردهٔ قلم بر حسب mm ---- */
      case 'RULE-PEN-002': {
        const r = byId.get('RULE-PEN-002');
        const rng = r.parameters.mmRanges[t.input.penClass];
        const ok = rng && near(rng[0], t.expected.minMm, 0.01) && near(rng[1], t.expected.maxMm, 0.01);
        rec(id, ok ? 'PASS' : 'FAIL', `${t.input.penClass} = ${JSON.stringify(rng)}`);
        break;
      }
      case 'RULE-PEN-003': {
        const r = byId.get('RULE-PEN-003');
        const rng = r.parameters.mashqiDang['3'];
        const ok = rng && near(rng[0], t.expected.minMm, 0.01) && near(rng[1], t.expected.maxMm, 0.01);
        rec(id, ok ? 'PASS' : 'FAIL', `«سه دانگ مشقی» = ${JSON.stringify(rng)}`);
        break;
      }
      /* ---- متغیرهای بنیادیِ سبک در موتور حضور دارند؟ ---- */
      case 'RULE-STYLE-002': {
        const eng = fs.readFileSync(path.join(root, 'qalam-engine.js'), 'utf8');
        const needed = { nibGeometry: /nibWidth|nibThickness/, nibOrientation: /nibAngle|resolveNibAngle/,
                         strokeDirection: /dirRad|strokeDirection|relAngle/, baseline: /./ };
        const missing = Object.entries(needed)
          .filter(([, re]) => !re.test(eng)).map(([k]) => k);
        // baseline در موتورِ قلم نیست و نباید هم باشد (لایهٔ layout است)
        const realMissing = missing.filter(m => m !== 'baseline');
        rec(id, realMissing.length ? 'FAIL' : 'PASS',
            realMissing.length ? `گم‌شده: ${realMissing}` :
            'nibGeometry/nibOrientation/strokeDirection موجودند؛ baseline عمداً در لایهٔ layout است (پیاده‌نشده)');
        break;
      }
      /* ---- کرسی: واحدِ آفست «نقطه» است ---- */
      case 'RULE-KERSEE-001': {
        const r = byId.get('RULE-KERSEE-001');
        const ok = r.parameters.unit === 'dot' && r.status === 'PROVISIONAL';
        rec(id, ok ? 'PASS' : 'FAIL',
            `unit=${r.parameters.unit} status=${r.status} (PROVISIONAL چون خوانشِ شرح‌ها جزئی بود)`);
        break;
      }
      /* ---- موتور نباید در PHASE E تغییر کرده باشد ---- */
      case 'REG-ENGINE-UNTOUCHED': {
        const bad = [];
        for (const [file, want] of Object.entries(t.files)) {
          const got = crypto.createHash('md5')
            .update(fs.readFileSync(path.join(root, file))).digest('hex');
          if (got !== want) bad.push(`${file}: ${got} != ${want}`);
        }
        rec(id, bad.length ? 'FAIL' : 'PASS', bad.length ? bad.join(' | ') : 'سه فایلِ موتور دست‌نخورده');
        break;
      }
      /* ---- پوششِ منبع ---- */
      case 'SRC-COVERAGE': {
        const total = inv.source.pages, insp = inv.counts.inspected;
        const noSrc = rules.filter(r => r.sourceType !== 'UNKNOWN' &&
          (!r.sourcePages || !r.sourcePages.length));
        const ok = total === t.expected.totalPages && insp === t.expected.inspectedPages && !noSrc.length;
        rec(id, ok ? 'PASS' : 'FAIL',
            `pages=${insp}/${total} rulesWithoutSource=${noSrc.length}`);
        break;
      }
      default:
        if (String(id).startsWith('LETTER-') || String(id).startsWith('ORDER-')) {
          rec(id, 'UNKNOWN', t.note || 'ترتیب/هندسه در منبع مشخص نیست');
        } else {
          rec(id, 'UNKNOWN', 'اجراکننده‌ای برای این آزمون تعریف نشده');
        }
    }
  } catch (e) {
    rec(id, 'FAIL', 'exception: ' + e.message);
  }
}

/* ---------- پوششِ منبع ---------- */
const cited = new Set(rules.flatMap(r => r.sourcePages || []));
const relevant = inv.pages.filter(p => p.hasRules || p.hasLetterForms);
const coverage = {
  pdfPages: inv.source.pages,
  inspected: inv.counts.inspected,
  pagesCitedByRules: cited.size,
  pagesWithRulesOrLetters: relevant.length,
  ruleCounts: rules.reduce((a, r) => (a[r.sourceType] = (a[r.sourceType] || 0) + 1, a), {}),
};

console.log('=== run-calligraphy-tests ===');
for (const d of res.details) {
  console.log(`  ${d.verdict.padEnd(7)} ${String(d.id).padEnd(26)} ${d.msg || ''}`);
}
console.log('\nTotal   :', res.details.length);
console.log('Passed  :', res.passed);
console.log('Failed  :', res.failed);
console.log('Skipped :', res.skipped, '(NOT_SPECIFIED_BY_SOURCE)');
console.log('Unknown :', res.unknown);
console.log('Source coverage:', JSON.stringify(coverage));
process.exit(res.failed ? 1 : 0);
