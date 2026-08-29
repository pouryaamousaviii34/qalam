#!/usr/bin/env node
/* =====================================================================
   tools/validate-calligraphy-data.js
   ---------------------------------------------------------------------
   اعتبارسنجیِ ساختاریِ دادگانِ PHASE E. هیچ چیزی از موتور را اجرا نمی‌کند.
     • schema (فیلدهای الزامی)
     • هر قاعده باید sourcePages داشته باشد، مگر sourceType === UNKNOWN
     • confidence در [0,1] و هم‌خوان با sourceType
     • شناسه‌ی تکراری
     • ارجاعِ شکسته (قاعده‌ای که در تست/تعارض نام برده شده ولی وجود ندارد)
     • فیلدهای گم‌شده‌ی حروف
   اجرا:  node tools/validate-calligraphy-data.js
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rd = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const problems = [];
const warn = [];
const fail = (code, msg) => problems.push({ level: 'FAIL', code, msg });
const wrn = (code, msg) => warn.push({ level: 'WARN', code, msg });

/* ---------- 1) فایل‌های الزامی ---------- */
const REQUIRED = [
  'docs/source-inventory.json', 'docs/SOURCE_INDEX.md', 'docs/EXTRACTION_NOTES.md',
  'docs/CALLIGRAPHY_SPEC.md', 'data/calligraphy-rules.json', 'data/letters.json',
  'data/digital-mapping.json', 'data/conflicts.json', 'data/references/index.json',
];
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(root, f))) fail('MISSING_FILE', f);
}
if (problems.length) { report(); process.exit(1); }

/* ---------- 2) قواعد ---------- */
const rulesDoc = rd('data/calligraphy-rules.json');
const rules = rulesDoc.rules || [];
const ids = new Set();
const SOURCE_TYPES = ['SOURCE_EXPLICIT', 'SOURCE_VISUAL', 'INFERRED', 'UNKNOWN'];
const STATUSES = ['VERIFIED', 'PROVISIONAL', 'INFERRED', 'UNKNOWN'];

for (const r of rules) {
  const w = m => fail('RULE', `${r.id || '<no id>'}: ${m}`);
  if (!r.id) w('بدون شناسه');
  if (ids.has(r.id)) w('شناسه‌ی تکراری');
  ids.add(r.id);
  if (!r.category) w('بدون category');
  if (!r.statement) w('بدون statement');
  if (!SOURCE_TYPES.includes(r.sourceType)) w(`sourceType نامعتبر: ${r.sourceType}`);
  if (!STATUSES.includes(r.status)) w(`status نامعتبر: ${r.status}`);
  if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
    w(`confidence نامعتبر: ${r.confidence}`);
  }
  // قانونِ اصلی: هیچ قاعده‌ای بدون منبع وارد دادگان نشود
  if (r.sourceType !== 'UNKNOWN') {
    if (!Array.isArray(r.sourcePages) || r.sourcePages.length === 0) {
      w('sourcePages خالی است در حالی که sourceType !== UNKNOWN');
    }
    if (!r.evidence) w('بدون evidence');
  } else {
    if (r.confidence !== 0) w('قاعده‌ی UNKNOWN باید confidence = 0 داشته باشد');
    if (Array.isArray(r.sourcePages) && r.sourcePages.length) {
      wrn('RULE', `${r.id}: UNKNOWN ولی sourcePages دارد`);
    }
  }
  if (r.sourceType === 'SOURCE_EXPLICIT' && r.confidence < 0.5) {
    wrn('RULE', `${r.id}: SOURCE_EXPLICIT با confidence پایین (${r.confidence})`);
  }
  if (r.sourceType === 'INFERRED' && r.status === 'VERIFIED') {
    w('INFERRED نمی‌تواند VERIFIED باشد');
  }
  if (!r.engineMapping || !r.engineMapping.layer) w('بدون engineMapping.layer');
  // قواعدِ زیر ۰٫۵ نباید VERIFIED باشند
  if (r.confidence < 0.5 && r.status === 'VERIFIED') {
    w(`confidence ${r.confidence} < 0.5 ولی status = VERIFIED`);
  }
}

/* ---------- 3) صفحاتِ ارجاع‌شده باید در inventory باشند ---------- */
const inv = rd('docs/source-inventory.json');
const invPages = new Set((inv.pages || []).map(p => p.page));
if (invPages.size !== inv.source.pages) {
  fail('INVENTORY', `تعدادِ صفحاتِ inventory (${invPages.size}) با متادیتای PDF (${inv.source.pages}) نمی‌خواند`);
}
for (const r of rules) {
  for (const p of (r.sourcePages || [])) {
    if (!invPages.has(p)) fail('BROKEN_REF', `${r.id}: صفحهٔ ${p} در inventory نیست`);
  }
}

/* ---------- 4) حروف ---------- */
const lettersDoc = rd('data/letters.json');
const LETTER_FIELDS = ['id', 'unicode', 'sourcePages', 'strokeCount', 'strokeOrder',
  'strokeDirections', 'components', 'connections', 'dots', 'baselineBehavior',
  'sourceType', 'confidence'];
const lids = new Set();
for (const l of (lettersDoc.letters || [])) {
  for (const f of LETTER_FIELDS) {
    if (!(f in l)) fail('LETTER', `${l.id || '<no id>'}: فیلدِ گم‌شده ${f}`);
  }
  if (lids.has(l.id)) fail('LETTER', `شناسه‌ی تکراریِ حرف: ${l.id}`);
  lids.add(l.id);
  if (!Array.isArray(l.sourcePages) || !l.sourcePages.length) {
    fail('LETTER', `${l.id}: بدون sourcePages`);
  }
  // ممنوعیتِ مختصاتِ پیکسلی در دادگانِ دانش
  const s = JSON.stringify(l);
  if (/"(x|y|px|coords?|controlPoints)"\s*:/.test(s)) {
    fail('LETTER', `${l.id}: دادگانِ دانش نباید مختصاتِ پیکسلی داشته باشد`);
  }
}

/* ---------- 5) تعارض‌ها ---------- */
for (const c of rd('data/conflicts.json').conflicts || []) {
  if (!c.conflictId) fail('CONFLICT', 'بدون conflictId');
  if (!c.description) fail('CONFLICT', `${c.conflictId}: بدون description`);
  if (!c.resolution) fail('CONFLICT', `${c.conflictId}: بدون resolution`);
  for (const rid of (c.rules || [])) {
    if (rid && !ids.has(rid)) fail('BROKEN_REF', `${c.conflictId}: قاعدهٔ ناموجود ${rid}`);
  }
}

/* ---------- 6) نگاشتِ دیجیتال ---------- */
for (const m of rd('data/digital-mapping.json').mappings || []) {
  if (!m.physicalConcept) fail('MAPPING', 'بدون physicalConcept');
  if (typeof m.confidence !== 'number') fail('MAPPING', `${m.physicalConcept}: confidence نامعتبر`);
  if (m.sourceType !== 'UNKNOWN' && (!m.sourcePages || !m.sourcePages.length)) {
    fail('MAPPING', `${m.physicalConcept}: بدون sourcePages`);
  }
  if (m.implemented !== false) {
    fail('MAPPING', `${m.physicalConcept}: در PHASE E هیچ نگاشتی نباید implemented باشد`);
  }
}

/* ---------- 7) ارجاعِ تست‌ها به قواعد ---------- */
const testDir = path.join(root, 'tests/calligraphy');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name))
                  : (e.name.endsWith('.json') ? [path.join(d, e.name)] : []));
for (const f of walk(testDir)) {
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rel = path.relative(root, f);
  if (!t.testId) fail('TEST', `${rel}: بدون testId`);
  if (!t.status) fail('TEST', `${rel}: بدون status`);
  if (t.ruleId && !ids.has(t.ruleId)) {
    fail('BROKEN_REF', `${rel}: قاعدهٔ ناموجود ${t.ruleId}`);
  }
}

/* ---------- 8) کراپ‌های مرجع ---------- */
for (const r of rd('data/references/index.json').references || []) {
  if (!fs.existsSync(path.join(root, 'data/references', r.file))) {
    fail('REFERENCE', `فایلِ گم‌شده: ${r.file}`);
  }
  if (!invPages.has(r.sourcePage)) {
    fail('BROKEN_REF', `${r.file}: صفحهٔ ${r.sourcePage} در inventory نیست`);
  }
  for (const rid of (r.rules || [])) {
    if (!ids.has(rid)) fail('BROKEN_REF', `${r.file}: قاعدهٔ ناموجود ${rid}`);
  }
}

function report() {
  console.log('=== validate-calligraphy-data ===');
  try {
    const counts = rules.reduce((a, r) => (a[r.sourceType] = (a[r.sourceType] || 0) + 1, a), {});
    console.log('rules:', rules.length, JSON.stringify(counts));
    console.log('letters:', (lettersDoc && lettersDoc.letters || []).length);
    console.log('inventory pages:', invPages.size);
  } catch (_) {
    console.log('(اعتبارسنجی پیش از بارگذاریِ دادگان متوقف شد)');
  }
  for (const w of warn) console.log('  WARN', w.code, '-', w.msg);
  for (const p of problems) console.log('  FAIL', p.code, '-', p.msg);
  console.log(problems.length ? `\nFAILED (${problems.length} problems, ${warn.length} warnings)`
                              : `\nOK (0 problems, ${warn.length} warnings)`);
}
report();
process.exit(problems.length ? 1 : 0);
