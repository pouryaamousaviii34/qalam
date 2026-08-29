#!/usr/bin/env node
/* =====================================================================
   run-headless.js — اجرای یک صفحه در Chrome headless و گرفتنِ نتیجه‌ی
   یک Promise سراسری، بدون هیچ وابستگیِ npm (CDP خام روی WebSocket).
   ---------------------------------------------------------------------
   node bench/run-headless.js <fileUrl> <globalPromiseExpr> [timeoutMs]
   ===================================================================== */
'use strict';
const { spawn } = require('child_process');
const http = require('http');

const CHROME = process.env.CHROME || 'google-chrome';
const url = process.argv[2];
const expr = process.argv[3] || 'window.__result';
const timeoutMs = Number(process.argv[4] || 300000);

if (!url) {
  console.error('usage: run-headless.js <url> [expr] [timeoutMs]');
  process.exit(2);
}

const port = 9200 + (process.pid % 500);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--disable-extensions',
  '--enable-precise-memory-info',
  '--js-flags=--expose-gc',
  '--window-size=1200,800',
  '--force-device-scale-factor=1',
  /* ---- کنارگذاشتنِ پروکسی برای میزبانِ محلی -------------------------
     Chrome متغیرهای محیطیِ پروکسی سیستم را می‌خواند. اگر یک پروکسیِ
     سراسری (مثلاً socks5) تنظیم شده باشد، درخواستِ http://localhost هم
     از آن عبور می‌کند و شکست می‌خورد؛ آن‌وقت Chrome صفحهٔ
     chrome-error://chromewebdata/ را بارگذاری می‌کند، رویدادِ load *هم*
     شلیک می‌شود، و تست بی‌هیچ پیامی «undefined» می‌دهد.
     اندازه‌گیری‌شده: با ALL_PROXY تنظیم‌شده، location.href پس از ناوبری
     برابرِ chrome-error://chromewebdata/ بود. */
  '--proxy-bypass-list=<-loopback>',
  '--no-proxy-server',
  `--remote-debugging-port=${port}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErr = '';
chrome.stderr.on('data', d => { chromeErr += d.toString(); });

function getJSON(path) {
  return new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port, path }, r => {
      let b = '';
      r.on('data', c => (b += c));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
  });
}

async function waitForDevtools() {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { return await getJSON('/json/list'); }
    catch (_) {
      if (Date.now() > deadline) throw new Error('devtools not reachable\n' + chromeErr);
      await new Promise(r => setTimeout(r, 150));
    }
  }
}

function fail(msg) {
  process.stderr.write(msg + '\n');
  try { chrome.kill('SIGKILL'); } catch (_) {}
  process.exit(1);
}

(async () => {
  const targets = await waitForDevtools();
  const page = targets.find(t => t.type === 'page');
  if (!page) return fail('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
    }
  });

  const consoleLines = [];
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleLines.push('[log] ' + m.params.entry.text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      consoleLines.push('[exception] ' + (d.exception && d.exception.description || d.text));
    }
  });

  const timer = setTimeout(() => {
    fail('timeout after ' + timeoutMs + 'ms\n' + consoleLines.join('\n'));
  }, timeoutMs);

  /* ---------------------------------------------------------------------
     ناوبری، و انتظار برای *بارگذاریِ واقعیِ* صفحه
     ---------------------------------------------------------------------
     پیش از این، Runtime.evaluate بی‌درنگ پس از Page.navigate فرستاده می‌شد.
     با file:// این تصادفاً کار می‌کرد چون ناوبری تقریباً همزمان تمام می‌شد،
     ولی با http:// ارزیابی به بسترِ اجرای *قبلی* (about:blank) می‌چسبید و
     چون آن بستر هرگز `expr` را نمی‌ساخت، حلقهٔ انتظار تا انقضای مهلت
     می‌چرخید و خروجی `undefined` می‌شد. اندازه‌گیری‌شده: یک صفحهٔ بی‌ربطِ
     سه‌خطی هم روی http «undefined» می‌داد و روی file:// درست کار می‌کرد.

     رفع: منتظرِ رویدادِ Page.loadEventFired می‌مانیم (با مهلتِ خودش، تا اگر
     رویداد نیامد باز هم تلاش کنیم). این هم مسئله را حل می‌کند و هم اجازه
     می‌دهد تست‌هایی که به «بسترِ امن» نیاز دارند از روی http اجرا شوند —
     چیزی که برای getCoalescedEvents و pointerrawupdate الزامی است.
     --------------------------------------------------------------------- */
  const loaded = new Promise(res => {
    const onMsg = ev => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Page.loadEventFired') {
        ws.removeEventListener('message', onMsg);
        res(true);
      }
    };
    ws.addEventListener('message', onMsg);
    setTimeout(() => { ws.removeEventListener('message', onMsg); res(false); }, 30000);
  });
  const nav = await send('Page.navigate', { url });
  await loaded;
  if (nav && nav.errorText) {
    clearTimeout(timer);
    return fail('navigation failed: ' + nav.errorText + ' for ' + url);
  }
  /* ناوبریِ ناموفق هم رویدادِ load را شلیک می‌کند (روی صفحهٔ خطای Chrome).
     پس *صریحاً* بررسی می‌کنیم که واقعاً روی همان نشانی هستیم، وگرنه تست
     بی‌صدا «undefined» می‌داد و علتش پیدا نبود. */
  try {
    const where = await send('Runtime.evaluate', {
      expression: 'location.href', returnByValue: true,
    });
    const href = where && where.result && where.result.value;
    if (typeof href === 'string' && /^chrome-error:/.test(href)) {
      clearTimeout(timer);
      return fail('page did not load (got ' + href + ') for ' + url +
                  '\nاگر نشانی http است، بررسی کن سرور بالا باشد: node server.js');
    }
  } catch (_) { /* ادامه بده؛ ارزیابیِ اصلی خودش خطا را نشان می‌دهد */ }

  // انتظار برای رسیدنِ Promise سراسری
  let res;
  try {
    res = await send('Runtime.evaluate', {
      expression: `(async () => {
        const deadline = Date.now() + ${timeoutMs - 5000};
        while (typeof (${expr}) === 'undefined' && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 50));
        }
        return JSON.stringify(await (${expr}));
      })()`,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    });
  } catch (e) {
    clearTimeout(timer);
    return fail('evaluate failed: ' + e.message + '\n' + consoleLines.join('\n'));
  }
  clearTimeout(timer);

  if (res.exceptionDetails) {
    return fail('page exception: ' +
      JSON.stringify(res.exceptionDetails) + '\n' + consoleLines.join('\n'));
  }

  if (consoleLines.length) process.stderr.write(consoleLines.join('\n') + '\n');
  process.stdout.write(String(res.result.value) + '\n');
  try { chrome.kill('SIGKILL'); } catch (_) {}
  process.exit(0);
})().catch(e => fail(String(e && e.stack || e)));
