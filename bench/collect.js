#!/usr/bin/env node
/* =====================================================================
   collect.js — اجرای یک صفحه در هر مرورگر و جمع‌کردن نتیجه از طریق HTTP
   ---------------------------------------------------------------------
   چرا این‌طور؟
     • برای Chrome می‌شد از CDP استفاده کرد، ولی Firefox پروتکل یکسانی
       ندارد. تنها راهِ *مرورگرمستقل* برای بیرون‌کشیدنِ نتیجه، این است که
       خودِ صفحه نتیجه را POST کند.
     • مهم‌تر: صفحه از روی http://127.0.0.1 سرو می‌شود، پس در «بسترِ امن»
       (secure context) اجرا می‌شود. طبق W3C Pointer Events L3،
       getCoalescedEvents و pointerrawupdate فقط در بسترِ امن فعالند؛
       با file:// نتیجه‌ی گمراه‌کننده می‌گرفتیم.

   استفاده:
     node bench/collect.js <browser> <pagePath> [timeoutMs]
       browser  : chrome | firefox
       pagePath : مسیر نسبی از ریشه‌ی پروژه، مثل bench/probe.html
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const root = path.resolve(__dirname, '..');
const which = (process.argv[2] || 'chrome').toLowerCase();
const page = process.argv[3];
const timeoutMs = Number(process.argv[4] || 180000);

if (!page) {
  console.error('usage: collect.js <chrome|firefox> <pagePath> [timeoutMs]');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

let resolveResult;
const resultPromise = new Promise(r => { resolveResult = r; });
const logs = [];

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__result') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      try { resolveResult(JSON.parse(body)); }
      catch (e) { resolveResult({ error: 'bad json', raw: body.slice(0, 2000) }); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/__log') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      logs.push(body.slice(0, 4000));
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

/* ---------------------------------------------------------------------
   ریشه‌ی پروفایل‌های موقت
   ---------------------------------------------------------------------
   نمی‌توان از os.tmpdir() استفاده کرد: اگر مرورگر با snap بسته‌بندی شده
   باشد (وضعِ پیش‌فرضِ Firefox روی اوبونتو)، فضای نامِ /tmp خصوصی است و
   مرورگر پروفایلی که ما در /tmp ساخته‌ایم را *نمی‌بیند*؛ نتیجه‌اش یک
   TIMEOUT گمراه‌کننده است که به‌راحتی با «Firefox خراب است» اشتباه گرفته
   می‌شود. پروفایل باید زیرِ خودِ پروژه ساخته شود.
   --------------------------------------------------------------------- */
const PROFILE_ROOT = process.env.QALAM_PROFILE_ROOT ||
                     path.join(root, '.tmp-profiles');
function mkProfile(prefix) {
  fs.mkdirSync(PROFILE_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(PROFILE_ROOT, prefix));
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/${page.replace(/^\//, '')}`;

  let cmd, args, profileDir = null;
  if (which === 'firefox') {
    profileDir = mkProfile('ffprof-');
    // اجباری‌کردنِ رفتارِ قابلِ‌پیش‌بینی: بدونِ به‌روزرسانی/تلمتری/first-run
    fs.writeFileSync(path.join(profileDir, 'user.js'), [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("datareporting.policy.firstRunURL", "");',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
      'user_pref("dom.w3c_pointer_events.dispatch_by_pointer_messages", true);',
    ].join('\n'));
    cmd = process.env.FIREFOX || 'firefox';
    args = ['--headless', '--no-remote', '--profile', profileDir,
            '--window-size=1200,800', url];
  } else {
    cmd = process.env.CHROME || 'google-chrome';
    args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
            '--disable-extensions', '--enable-precise-memory-info',
            '--window-size=1200,800', '--force-device-scale-factor=1',
            '--user-data-dir=' + mkProfile('chprof-'),
            url];
  }

  const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', d => { err += d.toString(); });

  const timer = setTimeout(() => {
    process.stderr.write('TIMEOUT\n' + err.slice(-3000) + '\n');
    try { child.kill('SIGKILL'); } catch (_) {}
    server.close();
    process.exit(1);
  }, timeoutMs);

  resultPromise.then(result => {
    clearTimeout(timer);
    if (logs.length) process.stderr.write(logs.join('\n') + '\n');
    process.stdout.write(JSON.stringify(result) + '\n');
    try { child.kill('SIGKILL'); } catch (_) {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
});
