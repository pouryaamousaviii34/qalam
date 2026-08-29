/* =====================================================================
   labs/lab.js — بسترِ مشترکِ آزمایشگاه‌های تصویری
   ---------------------------------------------------------------------
   موتورِ واقعیِ برنامه را در یک بوم پنهان بالا می‌آورد، استروکِ مصنوعی
   می‌کشد و پهنای *واقعاً رندرشده* را از پیکسل‌ها اندازه می‌گیرد.
   پس ادعاها با تصویرِ خروجی سنجیده می‌شوند، نه با اعداد داخلیِ موتور.
   ===================================================================== */
(function (global) {
  'use strict';
  const L = (global.QalamLab = {});

  L.boot = async function () {
    const H = global.QalamHarness;
    H.buildDOM(1000, 640);
    await new Promise(r => setTimeout(r, 60));
    await H.loadEngine('../stylus.js');
    await H.loadEngine('../qalam-engine.js');
    await H.loadEngine('../app.js');
    await new Promise(r => setTimeout(r, 150));
    L.H = H;
    L.T = global.__qalamTest;
    if (!L.T) throw new Error('engine test API not exposed');
    L.ink = L.T.inkCanvas;
    L.ictx = L.ink.getContext('2d');
    return L.T;
  };

  L.clear = async function () {
    document.getElementById('clear').click();
    await L.H.waitFrame();
  };

  L.set = function (id, v) { L.H.setControl(id, v); };

  /* پهنای مرکب در یک ستونِ عمودی (px در واحدِ CSS).
     y0/y1 پنجره‌ی جست‌وجو را محدود می‌کند؛ بدونِ آن، مرکبِ ردیف‌های
     دیگرِ همان بوم هم شمرده می‌شد. */
  L.columnWidth = function (x, y0, y1) {
    const d = L.T.dims();
    const px = Math.round(x * d.dpr);
    if (px < 0 || px >= L.ink.width) return 0;
    const r0 = Math.max(0, Math.round((y0 == null ? 0 : y0) * d.dpr));
    const r1 = Math.min(L.ink.height, Math.round(
      (y1 == null ? L.ink.height / d.dpr : y1) * d.dpr));
    if (r1 <= r0) return 0;
    const img = L.ictx.getImageData(px, r0, 1, r1 - r0).data;
    let top = -1, bot = -1;
    for (let r = 0; r < r1 - r0; r++) {
      if (img[r * 4 + 3] > 10) { if (top < 0) top = r; bot = r; }
    }
    return top < 0 ? 0 : (bot - top + 1) / d.dpr;
  };

  // پهنای مرکب در یک سطرِ افقی
  L.rowWidth = function (y) {
    const d = L.T.dims();
    const py = Math.round(y * d.dpr);
    if (py < 0 || py >= L.ink.height) return 0;
    const img = L.ictx.getImageData(0, py, L.ink.width, 1).data;
    let a = -1, b = -1;
    for (let c = 0; c < L.ink.width; c++) {
      if (img[c * 4 + 3] > 10) { if (a < 0) a = c; b = c; }
    }
    return a < 0 ? 0 : (b - a + 1) / d.dpr;
  };

  /* عرضِ خط عمود بر جهتِ حرکت: ناحیه‌ی مرکب را در راستای عمود بر dir
     پویش می‌کند. برای خطِ مستقیم دقیق است. */
  L.perpWidth = function (cx, cy, dirRad, maxR) {
    const d = L.T.dims();
    const nx = -Math.sin(dirRad), ny = Math.cos(dirRad);
    const R = maxR || 90;
    const img = L.ictx.getImageData(0, 0, L.ink.width, L.ink.height).data;
    const at = (x, y) => {
      const px = Math.round(x * d.dpr), py = Math.round(y * d.dpr);
      if (px < 0 || py < 0 || px >= L.ink.width || py >= L.ink.height) return 0;
      return img[(py * L.ink.width + px) * 4 + 3];
    };
    let a = null, b = null;
    for (let s = -R; s <= R; s += 0.25) {
      if (at(cx + nx * s, cy + ny * s) > 10) { if (a === null) a = s; b = s; }
    }
    return a === null ? 0 : (b - a);
  };

  /* سنجهٔ نوارنواری: آلفا را روی خطِ میانیِ یک خطِ افقی نمونه می‌گیرد و
     نوسانِ آن را برمی‌گرداند. عددِ بزرگ = نوارهای متناوبِ مصنوعی. */
  L.ribbing = function (y, x0, x1) {
    const d = L.T.dims();
    const py = Math.round(y * d.dpr);
    const a = [];
    for (let x = x0; x <= x1; x += 1) {
      const px = Math.round(x * d.dpr);
      if (px < 0 || px >= L.ink.width || py < 0 || py >= L.ink.height) continue;
      a.push(L.ictx.getImageData(px, py, 1, 1).data[3]);
    }
    if (!a.length) return { n: 0, min: 0, max: 0, range: 0, std: 0 };
    let mn = 255, mx = 0, sum = 0;
    for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    const mean = sum / a.length;
    let s2 = 0;
    for (const v of a) s2 += (v - mean) * (v - mean);
    return { n: a.length, min: mn, max: mx, range: mx - mn,
             std: +Math.sqrt(s2 / a.length).toFixed(2), mean: +mean.toFixed(2) };
  };

  // میانگینِ آلفا (تیرگیِ دیده‌شده) در یک ناحیه
  L.meanAlpha = function (x, y, w, h) {
    const d = L.T.dims();
    const px = Math.max(0, Math.round(x * d.dpr)), py = Math.max(0, Math.round(y * d.dpr));
    const pw = Math.min(L.ink.width - px, Math.round(w * d.dpr));
    const ph = Math.min(L.ink.height - py, Math.round(h * d.dpr));
    if (pw <= 0 || ph <= 0) return 0;
    const img = L.ictx.getImageData(px, py, pw, ph).data;
    let sum = 0, n = 0;
    for (let i = 3; i < img.length; i += 4) {
      if (img[i] > 10) { sum += img[i]; n++; }
    }
    return n ? sum / n / 255 : 0;
  };

  // تصویرِ ترکیبیِ کاغذ + مرکب را در یک <img> نشان بده
  L.snapshot = function (targetImgId, sx, sy, sw, sh, scale) {
    const d = L.T.dims();
    scale = scale || 1;
    const out = document.createElement('canvas');
    sx = sx || 0; sy = sy || 0;
    sw = sw || d.W; sh = sh || d.H;
    out.width = Math.round(sw * scale);
    out.height = Math.round(sh * scale);
    const o = out.getContext('2d');
    o.imageSmoothingEnabled = false;
    o.drawImage(document.getElementById('paperTex'),
      sx * d.dpr, sy * d.dpr, sw * d.dpr, sh * d.dpr, 0, 0, out.width, out.height);
    o.drawImage(L.ink,
      sx * d.dpr, sy * d.dpr, sw * d.dpr, sh * d.dpr, 0, 0, out.width, out.height);
    const url = out.toDataURL('image/png');
    const el = targetImgId ? document.getElementById(targetImgId) : null;
    if (el) el.src = url;
    return url;
  };

  // استروکِ مصنوعی با فشارِ ثابت یا تابعِ فشار، مستقیماً از موتور
  L.stroke = function (pts, pressure, dtMs) {
    const fn = typeof pressure === 'function' ? pressure : () => pressure;
    const recs = L.T.synthStroke(pts, fn, dtMs || 6);
    L.T.commitStroke(recs, false);
    return recs;
  };

  L.line = function (x0, y0, x1, y1, n) {
    const out = [];
    n = n || 80;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      out.push({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u });
    }
    return out;
  };
  L.arc = function (cx, cy, r, a0, a1, n) {
    const out = [];
    n = n || 90;
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i / (n - 1));
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return out;
  };

  L.table = function (targetId, headers, rows) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = '<table><tr>' + headers.map(h => '<th>' + h + '</th>').join('') +
      '</tr>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') +
      '</tr>').join('') + '</table>';
  };
})(typeof window !== 'undefined' ? window : globalThis);
