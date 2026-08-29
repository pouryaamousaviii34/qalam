/* =====================================================================
   labs/imglib.js — ابزارِ تحلیلِ نقاب (PHASE A)
   ---------------------------------------------------------------------
   بدونِ وابستگی. همه‌ی توابع روی Uint8Array با ابعادِ (w,h) کار می‌کنند.
   ===================================================================== */
(function (g) {
  'use strict';
  const M = (g.QalamImg = {});

  /* ---- نقاب از تصویر: حذفِ کادر، فلش‌های قرمز، و آستانه‌گذاری ---- */
  M.maskFromImage = function (data, w, h, opt) {
    opt = opt || {};
    const inset = opt.inset == null ? 14 : opt.inset;
    const lumMax = opt.lumMax == null ? 110 : opt.lumMax;
    const mask = new Uint8Array(w * h);
    const red = new Uint8Array(w * h);
    let n = 0, nred = 0;
    for (let i = 0; i < w * h; i++) {
      const px = i % w, py = (i / w) | 0;
      if (px < inset || py < inset || px >= w - inset || py >= h - inset) continue;
      const r = data[i * 4], gg = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
      if (a < 8) continue;
      // فلش‌های قرمزِ راهنما: سیرِ قرمز
      if (r > 110 && r > gg * 1.7 && r > b * 1.7) { red[i] = 1; nred++; continue; }
      if (r * 0.299 + gg * 0.587 + b * 0.114 < lumMax) { mask[i] = 1; n++; }
    }
    return { mask: mask, red: red, count: n, redCount: nred };
  };

  /* ---- پر کردنِ سوراخ‌های ریزِ ناشی از حذفِ فلش‌ها -----------------
     فلش‌ها روی حرف افتاده‌اند، پس جای‌شان سوراخ می‌مانَد. هر پیکسلِ
     حذف‌شده که اکثریتِ همسایه‌هایش مرکب است، مرکب حساب می‌شود. ---- */
  M.healRedHoles = function (mask, red, w, h, iters) {
    for (let k = 0; k < (iters || 3); k++) {
      const add = [];
      for (let i = 0; i < w * h; i++) {
        if (mask[i] || !red[i]) continue;
        const px = i % w, py = (i / w) | 0;
        if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) continue;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) c += mask[(py + dy) * w + px + dx];
        }
        if (c >= 5) add.push(i);
      }
      if (!add.length) break;
      for (const i of add) mask[i] = 1;
    }
    return mask;
  };

  M.bbox = function (mask, w, h) {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < w * h; i++) if (mask[i]) {
      const px = i % w, py = (i / w) | 0;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  /* ---- تبدیلِ فاصله (chamfer 3-4، دو گذر) ------------------------
     out[i] = فاصله‌ی تقریبیِ پیکسل تا نزدیک‌ترین پیکسلِ خارج از نقاب.
     برای پیکسل‌های خارج از نقاب صفر است. */
  M.distanceTransform = function (mask, w, h) {
    const INF = 1e9;
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
    const A = 1, B = 1.41421356;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0) v = Math.min(v, d[i - w] + A);
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + B);
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + B);
      d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + A);
      if (y < h - 1) v = Math.min(v, d[i + w] + A);
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + B);
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + B);
      d[i] = v;
    }
    return d;
  };

  /* فاصله تا نزدیک‌ترین پیکسلِ *داخلِ* نقاب (برای سنجه‌ی مرزی) */
  M.distanceToMask = function (mask, w, h) {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
    return M.distanceTransform(inv, w, h);
  };

  /* ---- نازک‌سازیِ Zhang-Suen ------------------------------------- */
  M.skeletonize = function (src, w, h) {
    const m = Uint8Array.from(src);
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : m[y * w + x];
    let changed = true, guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      for (let step = 0; step < 2; step++) {
        const del = [];
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          if (!m[y * w + x]) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y),
                p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1),
                p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
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
        if (del.length) { changed = true; for (const i of del) m[i] = 0; }
      }
    }
    return m;
  };

  /* ---- گرافِ اسکلت: نقاطِ انتها، تقاطع، و شاخه‌ها ---------------- */
  M.skeletonGraph = function (sk, w, h) {
    const deg = new Uint8Array(w * h);
    const N8 = [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!sk[i]) continue;
      let c = 0;
      for (const [dx, dy] of N8) if (sk[(y + dy) * w + x + dx]) c++;
      deg[i] = c;
    }
    const nodes = [];
    for (let i = 0; i < w * h; i++) {
      if (sk[i] && (deg[i] === 1 || deg[i] >= 3)) nodes.push(i);
    }
    const isNode = new Uint8Array(w * h);
    for (const i of nodes) isNode[i] = 1;

    const visited = new Uint8Array(w * h);
    const branches = [];
    for (const start of nodes) {
      const sx = start % w, sy = (start / w) | 0;
      for (const [dx, dy] of N8) {
        const nx = sx + dx, ny = sy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        let cur = ny * w + nx;
        if (!sk[cur] || visited[cur]) continue;
        const pts = [{ x: sx, y: sy }];
        let prev = start;
        while (true) {
          pts.push({ x: cur % w, y: (cur / w) | 0 });
          visited[cur] = 1;
          if (isNode[cur]) break;
          const cx = cur % w, cy = (cur / w) | 0;
          let nxt = -1;
          for (const [ax, ay] of N8) {
            const qx = cx + ax, qy = cy + ay;
            if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
            const q = qy * w + qx;
            if (!sk[q] || q === prev || visited[q]) continue;
            nxt = q; break;
          }
          if (nxt < 0) break;
          prev = cur; cur = nxt;
        }
        if (pts.length > 3) branches.push(pts);
      }
    }
    return { deg, nodes, branches };
  };

  /* ---- بازنمونه‌برداریِ چندخطی بر مبنای طولِ قوس ------------------ */
  M.resample = function (pts, step) {
    if (pts.length < 2) return pts.slice();
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      let t = step - carry;
      while (t <= d) {
        out.push({ x: a.x + dx * (t / d), y: a.y + dy * (t / d) });
        t += step;
      }
      carry = (carry + d) % step;
    }
    const last = pts[pts.length - 1];
    const l2 = out[out.length - 1];
    if (Math.hypot(last.x - l2.x, last.y - l2.y) > step * 0.4) out.push(last);
    return out;
  };

  /* ---- هموارسازیِ چندخطی (میانگینِ متحرکِ متقارن) ----------------
     پله‌های پیکسلیِ اسکلت را برمی‌دارد ولی فرم را جابه‌جا نمی‌کند. */
  M.smoothPolyline = function (pts, passes, keepEnds) {
    let a = pts.map(p => ({ x: p.x, y: p.y }));
    for (let k = 0; k < (passes || 2); k++) {
      const b = a.map(p => ({ x: p.x, y: p.y }));
      for (let i = 1; i < a.length - 1; i++) {
        b[i].x = (a[i - 1].x + 2 * a[i].x + a[i + 1].x) / 4;
        b[i].y = (a[i - 1].y + 2 * a[i].y + a[i + 1].y) / 4;
      }
      if (!keepEnds) {
        if (a.length > 2) {
          b[0].x = (a[0].x * 2 + a[1].x) / 3; b[0].y = (a[0].y * 2 + a[1].y) / 3;
          const n = a.length - 1;
          b[n].x = (a[n].x * 2 + a[n - 1].x) / 3;
          b[n].y = (a[n].y * 2 + a[n - 1].y) / 3;
        }
      }
      a = b;
    }
    return a;
  };

  /* ---- کاهشِ نقاط با حفظِ شکل (Douglas-Peucker) ------------------ */
  M.simplify = function (pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [i0, i1] = stack.pop();
      const a = pts[i0], b = pts[i1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1e-9;
      let best = -1, bd = 0;
      for (let i = i0 + 1; i < i1; i++) {
        const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
        if (d > bd) { bd = d; best = i; }
      }
      if (best > 0 && bd > eps) {
        keep[best] = 1;
        stack.push([i0, best], [best, i1]);
      }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  };

  /* ---- Catmull-Rom → چندخطیِ متراکم (برای اجرا در موتور) --------- */
  M.catmullRom = function (cp, samplesPerSeg) {
    if (cp.length < 2) return cp.slice();
    const n = samplesPerSeg || 12;
    const out = [];
    const P = i => cp[Math.max(0, Math.min(cp.length - 1, i))];
    for (let i = 0; i < cp.length - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const q0 = -0.5 * t3 + t2 - 0.5 * t;
        const q1 = 1.5 * t3 - 2.5 * t2 + 1;
        const q2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
        const q3 = 0.5 * t3 - 0.5 * t2;
        out.push({ x: p0.x * q0 + p1.x * q1 + p2.x * q2 + p3.x * q3,
                   y: p0.y * q0 + p1.y * q1 + p2.y * q2 + p3.y * q3 });
      }
    }
    out.push(cp[cp.length - 1]);
    return out;
  };

  M.polyLength = function (pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
    return L;
  };

  /* ---- سنجه‌های خطا ---------------------------------------------- */
  M.compare = function (ref, out, w, h) {
    let inter = 0, uni = 0, onlyRef = 0, onlyOut = 0, nRef = 0, nOut = 0;
    for (let i = 0; i < w * h; i++) {
      const a = ref[i], b = out[i];
      if (a) nRef++;
      if (b) nOut++;
      if (a || b) uni++;
      if (a && b) inter++;
      else if (a) onlyRef++;
      else if (b) onlyOut++;
    }
    const dRef = M.distanceToMask(ref, w, h);   // فاصله تا نقابِ مرجع
    const dOut = M.distanceToMask(out, w, h);
    // مرزها
    const border = (m) => {
      const b = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        if (!m[i-1] || !m[i+1] || !m[i-w] || !m[i+w]) b.push(i);
      }
      return b;
    };
    const bRef = border(ref), bOut = border(out);
    const stat = (pts, d) => {
      if (!pts.length) return { mean: 0, max: 0, p95: 0 };
      const v = pts.map(i => d[i]).sort((a, b) => a - b);
      let s = 0; for (const x of v) s += x;
      return { mean: +(s / v.length).toFixed(3), max: +v[v.length-1].toFixed(3),
               p95: +v[Math.min(v.length-1, (v.length*0.95)|0)].toFixed(3) };
    };
    const r2o = stat(bRef, dOut), o2r = stat(bOut, dRef);
    return {
      refArea: nRef, outArea: nOut, intersection: inter, union: uni,
      iou: +(inter / Math.max(1, uni)).toFixed(4),
      precision: +(inter / Math.max(1, nOut)).toFixed(4),
      recall: +(inter / Math.max(1, nRef)).toFixed(4),
      areaError: +((nOut - nRef) / Math.max(1, nRef)).toFixed(4),
      missing: onlyRef, extra: onlyOut,
      boundaryRefToOut: r2o, boundaryOutToRef: o2r,
      boundaryMean: +(((r2o.mean + o2r.mean) / 2)).toFixed(3),
      hausdorff: +Math.max(r2o.max, o2r.max).toFixed(3),
      hausdorff95: +Math.max(r2o.p95, o2r.p95).toFixed(3),
    };
  };

  M.compareRegion = function (ref, out, w, h, box) {
    let inter = 0, uni = 0, nRef = 0, nOut = 0;
    for (let y = box.y0; y <= box.y1; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = box.x0; x <= box.x1; x++) {
        if (x < 0 || x >= w) continue;
        const i = y * w + x, a = ref[i], b = out[i];
        if (a) nRef++; if (b) nOut++;
        if (a || b) uni++; if (a && b) inter++;
      }
    }
    return { refArea: nRef, outArea: nOut,
             iou: +(inter / Math.max(1, uni)).toFixed(4),
             areaError: nRef ? +((nOut - nRef) / nRef).toFixed(4) : null };
  };

  M.maskToPng = function (mask, w, h, colorHex) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    x.fillStyle = colorHex || '#2a1d10';
    for (let i = 0; i < w * h; i++) if (mask[i]) x.fillRect(i % w, (i / w) | 0, 1, 1);
    return c.toDataURL('image/png');
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =====================================================================
   افزودنی PHASE D — استخراجِ محورِ میانیِ یک استروک بدونِ برازشِ دایره
   ===================================================================== */
(function (g) {
  'use strict';
  const M = g.QalamImg;

  /* مؤلفه‌ی متصلِ بزرگ‌ترین، در ناحیه‌ی محدودشده */
  M.largestComponent = function (mask, w, h, keepFn) {
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      if (keepFn && !keepFn(i % w, (i / w) | 0)) continue;
      m[i] = 1;
    }
    const lab = new Int32Array(w * h).fill(-1);
    let best = null;
    for (let i = 0; i < w * h; i++) {
      if (!m[i] || lab[i] >= 0) continue;
      const id = i, st = [i], list = [];
      lab[i] = id;
      while (st.length) {
        const p = st.pop(), px = p % w, py = (p / w) | 0;
        list.push(p);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx, qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx;
          if (m[q] && lab[q] < 0) { lab[q] = id; st.push(q); }
        }
      }
      if (!best || list.length > best.length) best = list;
    }
    const out = new Uint8Array(w * h);
    if (best) for (const p of best) out[p] = 1;
    return out;
  };

  /* --------------------------------------------------------------------
     کوتاه‌ترین مسیر روی «بیشینه‌ی میدانِ فاصله»  (Dijkstra)
     --------------------------------------------------------------------
     هزینه‌ی هر یال:  طولِ گام / dist^power
     چون dist روی محورِ میانی بیشینه است، کم‌هزینه‌ترین مسیر از میانِ
     ضخامت می‌گذرد. این جایگزینِ اصولیِ «برازشِ دایره + پویشِ قطبی» است:
     هیچ فرضی درباره‌ی شکل (دایره/بیضی) ندارد و برای هلالِ نامتقارن هم
     درست کار می‌کند.
     -------------------------------------------------------------------- */
  M.medialPath = function (mask, w, h, dist, startIdx, endIdx, power) {
    const p = power == null ? 2.5 : power;
    const INF = Infinity;
    const cost = new Float64Array(w * h).fill(INF);
    const prev = new Int32Array(w * h).fill(-1);
    const done = new Uint8Array(w * h);
    // صفِ اولویتِ ساده (binary heap)
    const heap = [];
    const push = (i, c) => {
      heap.push({ i, c });
      let k = heap.length - 1;
      while (k > 0) {
        const par = (k - 1) >> 1;
        if (heap[par].c <= heap[k].c) break;
        const t = heap[par]; heap[par] = heap[k]; heap[k] = t; k = par;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let s = k;
          if (l < heap.length && heap[l].c < heap[s].c) s = l;
          if (r < heap.length && heap[r].c < heap[s].c) s = r;
          if (s === k) break;
          const t = heap[s]; heap[s] = heap[k]; heap[k] = t; k = s;
        }
      }
      return top;
    };
    cost[startIdx] = 0;
    push(startIdx, 0);
    const N = [[-1,-1,1.414],[0,-1,1],[1,-1,1.414],[-1,0,1],
               [1,0,1],[-1,1,1.414],[0,1,1],[1,1,1.414]];
    while (heap.length) {
      const cur = pop();
      const i = cur.i;
      if (done[i]) continue;
      done[i] = 1;
      if (i === endIdx) break;
      const cx = i % w, cy = (i / w) | 0;
      for (const [dx, dy, len] of N) {
        const qx = cx + dx, qy = cy + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = qy * w + qx;
        if (!mask[q] || done[q]) continue;
        const d = Math.max(0.6, dist[q]);
        const nc = cost[i] + len / Math.pow(d, p);
        if (nc < cost[q]) { cost[q] = nc; prev[q] = i; push(q, nc); }
      }
    }
    if (cost[endIdx] === INF) return null;
    const path = [];
    for (let i = endIdx; i >= 0; i = prev[i]) {
      path.push({ x: i % w, y: (i / w) | 0 });
      if (i === startIdx) break;
    }
    path.reverse();
    return path;
  };

  /* انحنای علامت‌دار در هر نقطه‌ی چندخطی (1/شعاعِ دایره‌ی گذرنده از سه نقطه) */
  M.curvatureProfile = function (pts, span) {
    const k = span || 3;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - k)], b = pts[i],
            c = pts[Math.min(pts.length - 1, i + k)];
      const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - b.x, by = c.y - b.y;
      const cross = ax * by - ay * bx;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      const lc = Math.hypot(c.x - a.x, c.y - a.y);
      const denom = la * lb * lc;
      out.push(denom < 1e-9 ? 0 : +(2 * cross / denom).toFixed(5));
    }
    return out;
  };

  /* Catmull-Rom → قطعاتِ بِزیهٔ مکعبی (نمایشِ استاندارد و قابل ویرایش) */
  M.catmullToBezier = function (cp) {
    const seg = [];
    const P = i => cp[Math.max(0, Math.min(cp.length - 1, i))];
    for (let i = 0; i < cp.length - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      seg.push({
        p0: [+p1.x.toFixed(2), +p1.y.toFixed(2)],
        c1: [+(p1.x + (p2.x - p0.x) / 6).toFixed(2), +(p1.y + (p2.y - p0.y) / 6).toFixed(2)],
        c2: [+(p2.x - (p3.x - p1.x) / 6).toFixed(2), +(p2.y - (p3.y - p1.y) / 6).toFixed(2)],
        p1: [+p2.x.toFixed(2), +p2.y.toFixed(2)],
      });
    }
    return seg;
  };

  /* عرضِ پوششی (انتگرالِ آلفا) عمود بر جهتِ محلی — سنجهٔ مصوبِ PHASE C */
  M.coverageWidth = function (alphaAt, pts, i, stepPx, reach) {
    const i0 = Math.max(0, i - 2), i1 = Math.min(pts.length - 1, i + 2);
    const dir = Math.atan2(pts[i1].y - pts[i0].y, pts[i1].x - pts[i0].x);
    const nx = -Math.sin(dir), ny = Math.cos(dir);
    const st = stepPx || 0.25, R = reach || 80;
    let sum = 0;
    for (let s = -R; s <= R; s += st) {
      sum += alphaAt(pts[i].x + nx * s, pts[i].y + ny * s) / 255 * st;
    }
    return { width: +sum.toFixed(3), dirRad: dir };
  };
})(typeof window !== 'undefined' ? window : globalThis);
