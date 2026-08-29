/* =====================================================================
   reference-analyzer.js — تحلیلِ تصویرِ مرجع (Computer Vision کلاسیک)
   ---------------------------------------------------------------------
   کاملاً بدونِ DOM: ورودی یک ImageData خام است، پس هم در پنجره و هم در
   Web Worker اجرا می‌شود و می‌توان مستقیم تستش کرد.

   خطِ لوله (بخش ۱۱ درخواست، با دو تصمیمِ فنیِ بهتر که در جای خود توضیح
   داده شده است):

       ImageData
          ↓  Grayscale (Rec.601)
          ↓  برآوردِ زمینه از میانهٔ *حاشیه‌ها*  →  تصمیمِ قطبیت
          ↓  Contrast Normalization (کشِ صدکِ ۱ و ۹۹)
          ↓  Otsu Threshold      →  Binary Mask
          ↓  Morphological open(3×3) → close(3×3)
          ↓  Connected Components (۸-همسایگی، BFS)  →  حذفِ اجزای ریز
          ↓  Exact Euclidean Distance Transform  [FH]
          ↓  Zhang–Suen Thinning  →  Skeleton
          ↓  گرافِ اسکلت → طولانی‌ترین مسیر  →  Centerline مرتب
          ↓  Width Profile:  w(t) = 2 × EDT(centerline(t))
          ↓  Confidence
       ReferenceAnalysis

   دو تصمیمِ فنی که با «روشِ بهتر با توجه به تکنولوژیِ پروژه» عوض شده:

     ۱) به‌جای Distance Transform تقریبیِ chamfer، از الگوریتمِ *دقیقِ*
        Felzenszwalb–Huttenlocher استفاده شده: O(n) است، دقیقاً اقلیدسی
        است، و فقط دو گذرِ یک‌بعدی می‌خواهد. chamfer تا ~۵٪ خطا دارد و
        همان خطا مستقیماً به پهنای Stroke منتقل می‌شد.

     ۲) برآوردِ زمینه از میانهٔ حاشیه‌ها *پیش از* آستانه‌گذاری انجام می‌شود
        و قطبیت (مرکبِ تیره روی کاغذِ روشن، یا برعکس) استنتاج می‌شود.
        بدونِ این، یک تصویرِ مرجعِ سفید-روی-مشکی وارونه تحلیل می‌شد.

   مراجع:
     [OTS] N. Otsu, "A Threshold Selection Method from Gray-Level
           Histograms" (IEEE SMC 1979)
     [FH]  P. Felzenszwalb, D. Huttenlocher, "Distance Transforms of
           Sampled Functions" (Theory of Computing 2012 / TR 2004)
     [ZS]  T. Y. Zhang, C. Y. Suen, "A Fast Parallel Algorithm for
           Thinning Digital Patterns" (CACM 1984)
   ===================================================================== */
(function (global) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  const OPTS = {
    // کمینهٔ مساحتِ یک جزء بر حسبِ نسبت از کلِ تصویر
    minComponentArea: 0.00018,
    // کمینهٔ مساحتِ مطلق (پیکسل) — ضدِ نویزِ نمکی
    minComponentPx: 24,
    // گامِ بازنمونه‌برداریِ Centerline (پیکسلِ تحلیل)
    centerlineStep: 1.5,
    // تعدادِ گذرهای هموارسازیِ Centerline
    centerlineSmooth: 3,
    // بیشینهٔ تعدادِ Stroke استخراج‌شده (ضدِ تصویرِ پرنویز)
    maxStrokes: 64,
    // اگر جداییِ Otsu کمتر از این باشد، تصویر عملاً دوقطبی نیست
    minSeparability: 0.18,
    // درصدِ کشِ کنتراست
    stretchLow: 0.01,
    stretchHigh: 0.99,
  };

  function createOptions(over) {
    const o = {};
    for (const k in OPTS) o[k] = OPTS[k];
    if (over) for (const k in over) if (over[k] !== undefined) o[k] = over[k];
    return o;
  }

  /* ===================================================================
     ۱) خاکستری + برآوردِ زمینه + قطبیت
     =================================================================== */
  function toGray(rgba, w, h, out) {
    const g = out || new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      const a = rgba[j + 3];
      // پیکسلِ شفاف = کاغذِ سفید (PNG با پس‌زمینهٔ شفاف بسیار رایج است)
      if (a < 8) { g[i] = 255; continue; }
      const y = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
      // آلفای جزئی: با سفید ترکیب می‌شود، وگرنه لبهٔ آنتی‌الیاسِ PNG
      // به‌اشتباه «مرکبِ تیره» شمرده می‌شد
      g[i] = a >= 250 ? y : (y * a + 255 * (255 - a)) / 255;
    }
    return g;
  }

  function medianOfBorder(g, w, h) {
    // نوارِ حاشیه به پهنای max(2, 2٪ کوچک‌ترین بُعد)
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    const hist = new Uint32Array(256);
    let n = 0;
    for (let y = 0; y < h; y++) {
      const edgeRow = y < band || y >= h - band;
      for (let x = 0; x < w; x++) {
        if (!edgeRow && x >= band && x < w - band) { x = w - band - 1; continue; }
        hist[g[y * w + x]]++; n++;
      }
    }
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc * 2 >= n) return v; }
    return 255;
  }

  /* کشِ کنتراست بر مبنای صدک — نه min/max، چون یک پیکسلِ پرت کلِ کش را
     بی‌اثر می‌کند (تصویرِ اسکن‌شده تقریباً همیشه چند پیکسلِ ۰ و ۲۵۵ دارد). */
  function stretchContrast(g, o) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    const n = g.length;
    const loTarget = n * o.stretchLow, hiTarget = n * o.stretchHigh;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= loTarget) { lo = v; break; } }
    acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hiTarget) { hi = v; break; } }
    if (hi - lo < 8) return { lo: lo, hi: hi, applied: false };
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = clamp((v - lo) * 255 / (hi - lo), 0, 255);
    for (let i = 0; i < g.length; i++) g[i] = lut[g[i]];
    return { lo: lo, hi: hi, applied: true };
  }

  /* ===================================================================
     ۲) Otsu  [OTS] — با بازگرداندنِ «جداییِ» η به‌عنوان معیارِ اعتماد
     =================================================================== */
  function otsu(g) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    const n = g.length;
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * hist[v];
    const mean = sum / n;
    let wB = 0, sumB = 0, best = -1, thr = 127, bestVar = 0;
    for (let v = 0; v < 256; v++) {
      wB += hist[v];
      if (wB === 0) continue;
      const wF = n - wB;
      if (wF === 0) break;
      sumB += v * hist[v];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF) / (n * n);
      if (between > best) { best = between; thr = v; bestVar = between; }
    }
    let total = 0;
    for (let v = 0; v < 256; v++) total += hist[v] * (v - mean) * (v - mean);
    total /= n;
    return {
      threshold: thr,
      separability: total > 1e-9 ? clamp01(bestVar / total) : 0,
    };
  }

  /* ===================================================================
     ۳) مورفولوژی — open سپس close، هر دو با ساختارِ ۳×۳
     =================================================================== */
  function erode(src, dst, w, h) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!src[i]) { dst[i] = 0; continue; }
        let keep = 1;
        for (let dy = -1; dy <= 1 && keep; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) { keep = 0; break; }
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w || !src[yy * w + xx]) { keep = 0; break; }
          }
        }
        dst[i] = keep;
      }
    }
    return dst;
  }
  function dilate(src, dst, w, h) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            if (src[yy * w + xx]) { on = 1; break; }
          }
        }
        dst[y * w + x] = on;
      }
    }
    return dst;
  }

  /* ===================================================================
     ۴) اجزای متصل (۸-همسایگی، BFS با صفِ Int32Array)
     =================================================================== */
  function connectedComponents(mask, w, h, minPx) {
    const labels = new Int32Array(w * h).fill(-1);
    const queue = new Int32Array(w * h);
    const comps = [];
    let next = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start] >= 0) continue;
      const id = next++;
      let qh = 0, qt = 0;
      queue[qt++] = start;
      labels[start] = id;
      let area = 0, minX = w, minY = h, maxX = 0, maxY = 0;
      while (qh < qt) {
        const p = queue[qh++];
        const py = (p / w) | 0, px = p - py * w;
        area++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = py + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = px + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (mask[q] && labels[q] < 0) { labels[q] = id; queue[qt++] = q; }
          }
        }
      }
      comps.push({ id: id, area: area, x: minX, y: minY,
                   w: maxX - minX + 1, h: maxY - minY + 1, keep: area >= minPx });
    }
    return { labels: labels, comps: comps };
  }

  /* ===================================================================
     ۵) Distance Transform اقلیدسیِ *دقیق*  [FH]
     -------------------------------------------------------------------
     خروجی: فاصلهٔ هر پیکسل تا نزدیک‌ترین پیکسلِ **غیرِ** ماسک (پیکسلِ
     کاغذ). یعنی داخلِ Stroke بزرگ و روی مرز صفر است.
     پیچیدگی O(w·h)، بدونِ هیچ تقریبی.
     =================================================================== */
  const INF = 1e20;
  function dt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
    return d;
  }

  function distanceTransform(mask, w, h) {
    const m = Math.max(w, h);
    const f = new Float64Array(m), d = new Float64Array(m);
    const v = new Int32Array(m + 1), z = new Float64Array(m + 2);
    const sq = new Float64Array(w * h);
    // مقدارِ اولیه: کاغذ = 0، مرکب = INF
    for (let i = 0; i < sq.length; i++) sq[i] = mask[i] ? INF : 0;
    // گذرِ ستونی
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = sq[y * w + x];
      dt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) sq[y * w + x] = d[y];
    }
    // گذرِ سطری
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) f[x] = sq[row + x];
      dt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) sq[row + x] = d[x];
    }
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(sq[i]);
    return out;
  }

  /* ===================================================================
     ۶) نازک‌سازیِ Zhang–Suen  [ZS]
     =================================================================== */
  function thin(mask, w, h) {
    const img = Uint8Array.from(mask);
    const del = [];
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : img[y * w + x];
    let changed = true, guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      for (let step = 0; step < 2; step++) {
        del.length = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            if (!img[y * w + x]) continue;
            const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y),
                  p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1),
                  p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
            const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (B < 2 || B > 6) continue;
            let A = 0;
            const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
            for (let i = 0; i < 8; i++) if (!seq[i] && seq[i + 1]) A++;
            if (A !== 1) continue;
            if (step === 0) {
              if (p2 * p4 * p6 !== 0) continue;
              if (p4 * p6 * p8 !== 0) continue;
            } else {
              if (p2 * p4 * p8 !== 0) continue;
              if (p2 * p6 * p8 !== 0) continue;
            }
            del.push(y * w + x);
          }
        }
        if (del.length) {
          for (let i = 0; i < del.length; i++) img[del[i]] = 0;
          changed = true;
        }
      }
    }
    return img;
  }

  /* ===================================================================
     ۷) اسکلت → Centerline مرتب
     -------------------------------------------------------------------
     روش: قطرِ گرافِ اسکلت با دو BFS (از هر پیکسل به دورترین، سپس از آن
     به دورترین) و بازسازیِ مسیر با اشاره‌گرِ والد.
     برای اسکلتِ درخت‌گونه (که ردِ Stroke است) *دقیقاً* طولانی‌ترین مسیر
     را می‌دهد؛ برای اسکلتِ دارای حلقه (مثل حرفِ «o») یک مسیرِ طولانیِ
     معتبر می‌دهد که برای هدفِ ما (پارامترسازیِ مسیرِ اصلی) کافی است.
     شاخه‌های فرعی در نسخهٔ اول نگه داشته نمی‌شوند؛ ولی ساختارِ خروجی
     چند Centerline در هر تصویر را می‌پذیرد، پس افزودنِ «گرافِ Stroke»
     کاملِ بخش ۳۷ بعداً بدونِ تغییرِ قرارداد ممکن است.
     =================================================================== */
  function longestPath(pixels, inSkel, w, h) {
    // pixels: آرایهٔ ایندکس‌های اسکلتِ همین جزء
    if (pixels.length === 0) return [];
    if (pixels.length === 1) return [pixels[0]];
    const dist = new Map();
    const parent = new Map();
    const queue = new Int32Array(pixels.length);

    function bfs(from) {
      dist.clear(); parent.clear();
      let qh = 0, qt = 0;
      queue[qt++] = from;
      dist.set(from, 0); parent.set(from, -1);
      let far = from, farD = 0;
      while (qh < qt) {
        const p = queue[qh++];
        const d = dist.get(p);
        if (d > farD) { farD = d; far = p; }
        const py = (p / w) | 0, px = p - py * w;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = py + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = px + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!inSkel[q] || dist.has(q)) continue;
            dist.set(q, d + 1); parent.set(q, p);
            queue[qt++] = q;
          }
        }
      }
      return far;
    }

    /* شروع از یک نقطهٔ *انتهایی* (درجهٔ ۱) اگر وجود دارد: BFS از انتها
       پایدارتر است و از انتخابِ نقطهٔ میانی به‌عنوان یک سرِ مسیر جلو
       می‌گیرد. */
    let seed = pixels[0];
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      const py = (p / w) | 0, px = p - py * w;
      let deg = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = px + dx, yy = py + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (inSkel[yy * w + xx]) deg++;
        }
      }
      if (deg === 1) { seed = p; break; }
    }
    const a = bfs(seed);
    const b = bfs(a);
    // بازسازیِ مسیر از b تا a
    const path = [];
    let cur = b;
    let guard = pixels.length + 4;
    while (cur !== -1 && guard-- > 0) {
      path.push(cur);
      const pr = parent.get(cur);
      cur = pr === undefined ? -1 : pr;
    }
    path.reverse();
    return path;
  }

  /* ===================================================================
     ۸) تحلیلِ کامل — به‌صورتِ async و قطعه‌قطعه
     -------------------------------------------------------------------
     چرا async؟ چون این تحلیل *فقط هنگام import تصویر* اجرا می‌شود و نباید
     رشتهٔ UI را بلاک کند. با yield بین مراحل، هر مرحله یک تسکِ جدا می‌شود
     و مرورگر می‌تواند فریم بزند. در مسیرِ داغِ قلم *هیچ* کارِ CV نیست.
     =================================================================== */
  const yieldNow = () => new Promise(r => (global.setTimeout ? global.setTimeout(r, 0) : r()));

  async function analyze(rgba, w, h, options, onProgress) {
    const o = createOptions(options);
    const t0 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    const report = p => { if (onProgress) try { onProgress(p); } catch (_) {} };

    if (!(w > 2 && h > 2)) {
      return emptyAnalysis(w, h, 'تصویر بسیار کوچک است');
    }

    report('grayscale');
    const gray = toGray(rgba, w, h);
    const bgLevel = medianOfBorder(gray, w, h);
    await yieldNow();

    report('contrast');
    const stretch = stretchContrast(gray, o);
    await yieldNow();

    report('threshold');
    const ot = otsu(gray);
    /* قطبیت: کدام طرفِ آستانه «مرکب» است؟ از زمینهٔ *اندازه‌گیری‌شده*
       تصمیم گرفته می‌شود، نه از فرضِ «مرکب تیره است».
       قراردادِ آستانه همان قراردادِ Otsu است: ردهٔ تیره = [0 … thr] و
       ردهٔ روشن = [thr+1 … 255]. با `<` (به‌جای `<=`) یک تصویرِ کاملاً
       دوسطحی — که آستانه‌اش دقیقاً روی سطحِ تیره می‌افتد — تمامِ مرکبش را
       از دست می‌داد (اندازه‌گیری‌شده: thr=0 و «۰ پیکسل مرکب»). */
    const bgAfter = stretch.applied && stretch.hi > stretch.lo
      ? clamp((bgLevel - stretch.lo) * 255 / (stretch.hi - stretch.lo), 0, 255)
      : bgLevel;
    const inkIsDark = bgAfter > ot.threshold;
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = inkIsDark ? (gray[i] <= ot.threshold ? 1 : 0)
                         : (gray[i] > ot.threshold ? 1 : 0);
    }
    await yieldNow();

    report('morphology');
    const tmp = new Uint8Array(w * h);
    const mask = new Uint8Array(w * h);
    erode(raw, tmp, w, h);        // open = erode → dilate
    dilate(tmp, mask, w, h);
    dilate(mask, tmp, w, h);      // close = dilate → erode
    erode(tmp, mask, w, h);
    await yieldNow();

    report('components');
    const minPx = Math.max(o.minComponentPx,
                           Math.round(w * h * o.minComponentArea));
    const cc = connectedComponents(mask, w, h, minPx);
    // ماسکِ پاک‌شده: فقط اجزای نگه‌داشته‌شده
    const keep = new Uint8Array(cc.comps.length);
    let inkPx = 0;
    for (let i = 0; i < cc.comps.length; i++) keep[i] = cc.comps[i].keep ? 1 : 0;
    for (let i = 0; i < mask.length; i++) {
      const l = cc.labels[i];
      if (l < 0 || !keep[l]) mask[i] = 0;
      else inkPx++;
    }
    await yieldNow();

    report('distance');
    const edt = distanceTransform(mask, w, h);
    await yieldNow();

    report('skeleton');
    const skel = thin(mask, w, h);
    await yieldNow();

    report('centerlines');
    // پیکسل‌های اسکلت به تفکیکِ جزء
    const byComp = new Map();
    for (let i = 0; i < skel.length; i++) {
      if (!skel[i]) continue;
      const l = cc.labels[i];
      if (l < 0 || !keep[l]) { skel[i] = 0; continue; }
      let arr = byComp.get(l);
      if (!arr) { arr = []; byComp.set(l, arr); }
      arr.push(i);
    }

    const strokes = [];
    const order = Array.from(byComp.keys())
      .sort((a, b) => cc.comps[b].area - cc.comps[a].area)
      .slice(0, o.maxStrokes);

    for (const l of order) {
      const px = byComp.get(l);
      const path = longestPath(px, skel, w, h);
      if (path.length < 3) continue;
      // پیکسل → نقطه
      let pts = new Array(path.length);
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const y = (p / w) | 0;
        pts[i] = { x: p - y * w + 0.5, y: y + 0.5 };
      }
      pts = smoothPts(pts, o.centerlineSmooth);
      pts = resamplePts(pts, o.centerlineStep);
      if (pts.length < 3) continue;

      const n = pts.length;
      const widths = new Float32Array(n);
      const ts = new Float32Array(n);
      const tangents = new Float32Array(n);
      const arcs = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        arcs[i] = arcs[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      const total = arcs[n - 1];
      for (let i = 0; i < n; i++) {
        ts[i] = total > 1e-9 ? arcs[i] / total : (n > 1 ? i / (n - 1) : 0);
        // پهنا = ۲ × فاصله تا مرز، با درون‌یابیِ دوخطی روی EDT
        widths[i] = 2 * bilinear(edt, w, h, pts[i].x - 0.5, pts[i].y - 0.5);
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        tangents[i] = Math.atan2(b.y - a.y, b.x - a.x);
      }
      smoothWidths(widths);
      const comp = cc.comps[l];
      strokes.push({
        componentId: l,
        points: pts, ts: ts, widths: widths, tangents: tangents, arcs: arcs,
        length: total,
        bbox: { x: comp.x, y: comp.y, w: comp.w, h: comp.h },
        area: comp.area,
        meanWidth: mean(widths),
        minWidth: minOf(widths),
        maxWidth: maxOf(widths),
      });
    }
    await yieldNow();

    report('confidence');
    const conf = confidenceOf(strokes, inkPx, w, h, ot, o);
    const t1 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();

    return {
      ok: strokes.length > 0,
      width: w, height: h,
      strokes: strokes,
      mask: mask, edt: edt, skeleton: skel,
      threshold: ot.threshold,
      separability: ot.separability,
      inkIsDark: inkIsDark,
      backgroundLevel: bgLevel,
      inkPixels: inkPx,
      fillRatio: inkPx / (w * h),
      confidence: conf.value,
      confidenceParts: conf.parts,
      note: conf.note,
      analysisMs: Math.round((t1 - t0) * 10) / 10,
    };
  }

  function emptyAnalysis(w, h, note) {
    return {
      ok: false, width: w, height: h, strokes: [],
      mask: null, edt: null, skeleton: null,
      threshold: 127, separability: 0, inkIsDark: true,
      backgroundLevel: 255, inkPixels: 0, fillRatio: 0,
      confidence: 0, confidenceParts: {}, note: note || '', analysisMs: 0,
    };
  }

  /* ===================================================================
     ۹) کمکی‌ها
     =================================================================== */
  function bilinear(f, w, h, x, y) {
    const x0 = clamp(Math.floor(x), 0, w - 1), y0 = clamp(Math.floor(y), 0, h - 1);
    const x1 = clamp(x0 + 1, 0, w - 1), y1 = clamp(y0 + 1, 0, h - 1);
    const fx = clamp01(x - x0), fy = clamp01(y - y0);
    const a = f[y0 * w + x0], b = f[y0 * w + x1];
    const c = f[y1 * w + x0], d = f[y1 * w + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function smoothPts(pts, passes) {
    let cur = pts;
    for (let k = 0; k < (passes | 0); k++) {
      const n = cur.length;
      if (n < 3) break;
      const out = new Array(n);
      out[0] = cur[0]; out[n - 1] = cur[n - 1];
      for (let i = 1; i < n - 1; i++) {
        out[i] = { x: (cur[i - 1].x + 2 * cur[i].x + cur[i + 1].x) * 0.25,
                   y: (cur[i - 1].y + 2 * cur[i].y + cur[i + 1].y) * 0.25 };
      }
      cur = out;
    }
    return cur;
  }
  function resamplePts(pts, step) {
    const n = pts.length;
    if (n < 2 || !(step > 0)) return pts;
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let carry = 0;
    for (let i = 1; i < n; i++) {
      const x0 = pts[i - 1].x, y0 = pts[i - 1].y;
      const dx = pts[i].x - x0, dy = pts[i].y - y0;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      let t = step - carry;
      while (t <= d) {
        out.push({ x: x0 + dx * (t / d), y: y0 + dy * (t / d) });
        t += step;
      }
      carry = d - (t - step);
    }
    const last = pts[n - 1], tail = out[out.length - 1];
    if (Math.hypot(last.x - tail.x, last.y - tail.y) > step * 0.35) {
      out.push({ x: last.x, y: last.y });
    }
    return out;
  }
  // میانهٔ ۵ سپس گاوسیِ سبک — درجا
  function smoothWidths(ws) {
    const n = ws.length;
    if (n < 5) return ws;
    const med = new Float32Array(n);
    const buf = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      for (let k = -2; k <= 2; k++) buf[k + 2] = ws[clamp(i + k, 0, n - 1)];
      buf.sort((a, b) => a - b);
      med[i] = buf[2];
    }
    const kern = [1, 4, 6, 4, 1], sw = 16;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += med[clamp(i + k, 0, n - 1)] * kern[k + 2];
      ws[i] = s / sw;
    }
    return ws;
  }
  function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function minOf(a) { let m = Infinity; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return isFinite(m) ? m : 0; }
  function maxOf(a) { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return isFinite(m) ? m : 0; }

  /* -------------------------------------------------------------------
     Confidence  (بخش ۳۶)
     -------------------------------------------------------------------
     چهار شاهدِ مستقل، هر کدام در [0,1]:

       separability  جداییِ Otsu — آیا تصویر واقعاً دوقطبی است؟
       fillOk        نسبتِ مرکب: نه تقریباً خالی، نه تقریباً پرِ سیاه
       strokeLike    آیا ماسک شبیهِ «خط» است؟  مساحت ≈ طولِ اسکلت × پهنای
                     میانگین. اگر تصویر لکه/بافت باشد این نسبت خراب می‌شود.
       widthStable   ضریبِ تغییراتِ پهنا — پهنای کاملاً پرنوسان یعنی ماسکِ
                     پرنویز، نه Stroke خوشنویسیِ واقعی.

     نتیجه، میانگینِ وزن‌دار است. اگر Confidence کم باشد، لایهٔ بالاتر
     شدتِ کمک را ضرب در آن می‌کند (Final Correction = Assist × Confidence).
     ------------------------------------------------------------------- */
  function confidenceOf(strokes, inkPx, w, h, ot, o) {
    const parts = {};
    parts.separability = clamp01((ot.separability - o.minSeparability) /
                                 Math.max(1e-6, 1 - o.minSeparability));
    const fill = inkPx / (w * h);
    // بازهٔ سالم: ۰٫۲٪ تا ۴۵٪ — بیرونِ آن به‌تدریج جریمه
    parts.fillOk = fill <= 0 ? 0
      : clamp01(Math.min(fill / 0.002, 1)) * clamp01((0.55 - fill) / 0.10);
    if (!strokes.length) {
      parts.strokeLike = 0; parts.widthStable = 0;
      return { value: 0, parts: parts, note: 'هیچ Stroke قابلِ استخراجی پیدا نشد' };
    }
    let areaSum = 0, predicted = 0, cvSum = 0, wTot = 0;
    for (const s of strokes) {
      areaSum += s.area;
      predicted += s.length * Math.max(0.5, s.meanWidth);
      let m = s.meanWidth, v = 0;
      for (let i = 0; i < s.widths.length; i++) v += (s.widths[i] - m) * (s.widths[i] - m);
      v = s.widths.length ? Math.sqrt(v / s.widths.length) : 0;
      const cv = m > 1e-6 ? v / m : 1;
      cvSum += cv * s.length; wTot += s.length;
    }
    const r = predicted > 1e-6 ? areaSum / predicted : 0;
    // r نزدیکِ ۱ ⇒ شبیهِ خط. r ≫ ۱ ⇒ لکه. r ≪ ۱ ⇒ اسکلتِ پرشاخه
    parts.strokeLike = clamp01(1 - Math.abs(Math.log(Math.max(1e-6, r))) / 1.4);
    const cv = wTot > 1e-6 ? cvSum / wTot : 1;
    parts.widthStable = clamp01(1 - (cv - 0.15) / 0.85);

    const value = clamp01(
      parts.separability * 0.32 +
      parts.fillOk * 0.18 +
      parts.strokeLike * 0.32 +
      parts.widthStable * 0.18);
    let note = '';
    if (value < 0.35) note = 'اعتمادِ تحلیلِ مرجع پایین است — کمک محدود می‌شود';
    else if (value < 0.6) note = 'اعتمادِ تحلیلِ مرجع متوسط است';
    return { value: value, parts: parts, note: note };
  }

  /* ===================================================================
     ۱۰) حافظهٔ نهانِ تحلیل  (بخش ۴۱)
     -------------------------------------------------------------------
     کلید از *هویتِ* تصویر ساخته می‌شود، نه از محتوایش: خودِ شیءِ تصویر
     (WeakMap) به‌علاوهٔ ابعادِ بومِ تحلیل و امضای گزینه‌ها. پس اگر تصویر
     عوض نشده، دوباره تحلیل نمی‌شود.
     =================================================================== */
  function ReferenceCache() {
    this.map = new WeakMap();
    this.hits = 0; this.misses = 0;
  }
  ReferenceCache.prototype._sig = function (w, h, o) {
    return w + 'x' + h + '|' + o.centerlineStep + '|' + o.minComponentArea +
           '|' + o.maxStrokes;
  };
  ReferenceCache.prototype.get = function (key, w, h, o) {
    const e = this.map.get(key);
    if (e && e.sig === this._sig(w, h, o)) { this.hits++; return e.analysis; }
    this.misses++;
    return null;
  };
  ReferenceCache.prototype.set = function (key, w, h, o, analysis) {
    try { this.map.set(key, { sig: this._sig(w, h, o), analysis: analysis }); }
    catch (_) {}
    return analysis;
  };
  ReferenceCache.prototype.clear = function () { this.map = new WeakMap(); };

  /* ===================================================================
     ۱۱) جای بازِ تحلیل‌گرِ AI  (بخش ۸۲)
     -------------------------------------------------------------------
     اگر روزی یک مدلِ یادگیری بخواهد جای این خطِ لوله بنشیند، فقط باید
     همان قراردادِ خروجی را برگرداند. هیچ‌جای دیگری تغییر نمی‌کند.
     =================================================================== */
  let customAnalyzer = null;
  function registerAnalyzer(fn) { customAnalyzer = typeof fn === 'function' ? fn : null; }
  function activeAnalyzer() { return customAnalyzer || analyze; }

  global.QalamReference = {
    OPTS, createOptions,
    toGray, medianOfBorder, stretchContrast, otsu,
    erode, dilate, connectedComponents,
    dt1d, distanceTransform, thin, longestPath,
    bilinear, smoothWidths, confidenceOf,
    analyze, emptyAnalysis,
    ReferenceCache, registerAnalyzer, activeAnalyzer,
    VERSION: '1.0.0',
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
