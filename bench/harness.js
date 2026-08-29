/* =====================================================================
   harness.js — بستر مشترک تست/بنچمارک برای موتور قلم نی
   ---------------------------------------------------------------------
   • DOM موردنیاز app.js را می‌سازد (بدون وابستگی به index.html)
   • شمارنده‌ی draw call روی CanvasRenderingContext2D نصب می‌کند
   • رویدادهای مصنوعی PointerEvent (pen/mouse) با coalescedEvents می‌سازد
   این فایل باید *قبل از* app.js اجرا شود.
   ===================================================================== */
(function () {
  'use strict';

  const H = (window.QalamHarness = {});

  /* ------------------------------------------------------------------
     1) ساخت DOM — همان شناسه‌هایی که app.js انتظار دارد
     ------------------------------------------------------------------ */
  const RANGES = [
    ['bgVeil', 0, 0.9, 0.05, 0.35],
    ['size', 1, 40, 1, 4],
    ['nibRatio', 2, 6, 0.1, 2.0],
    ['nibThick', 0.2, 8, 0.05, 1.0],
    ['pressure', 0.1, 2, 0.05, 1],
    ['opacity', 10, 100, 1, 100],
    ['angle', 0, 180, 1, 109],
    ['smooth', 0, 0.95, 0.05, 0.55],
  ];
  const VALUE_SPANS = [
    'sizeVal', 'nibRatioVal', 'nibThickVal', 'pressureVal',
    'angleVal', 'smoothVal', 'opacityVal', 'bgVeilVal',
  ];
  const BUTTONS = [
    'lightBtn', 'paperDaftari', 'paperGloss', 'paperTraditional',
    'paperTazhib', 'paperKashi', 'paperImageBtn', 'mirrorBtn',
    'tool_reed', 'tool_pencil', 'tool_brush', 'tool_marker', 'tool_water',
    'tool_ballpoint', 'assistBtn',
    'clear', 'undo', 'eraserBtn', 'save',
    'twistMode', 'motionMode', 'dynamicMode', 'vertBtn',
    'dbgToggle', 'gridBtn', 'dbgClose',
  ];
  // اسلایدرهای پنل کالیبراسیون (اختیاری برای موتور، لازم برای تست‌ها)
  const TUNE_RANGES = [
    't_pexp', 't_psm', 't_minc', 't_heel', 't_spf', 't_minsp', 't_maxev',
    't_vink', 't_vw', 't_floor', 't_pool', 't_start', 't_tail',
    't_tilt', 't_tiltc', 't_round', 't_mm',
    'k_min', 'k_max', 'k_dz', 'k_sm', 'k_exp',
  ];
  // شناسه‌های متنیِ پنل کالیبراسیون
  const DBG_TEXT = [
    'd_praw','d_pnorm','d_pfilt','d_pmap','d_psup','d_cw','d_ct','d_co','d_ap',
    'd_nib','d_dir','d_tilt','d_vel','d_ink','d_dens','d_dwell','d_fps','d_ft',
    'd_eps','d_sps','d_bpk','d_bov','d_clamp','d_src',
    'c_ptype','c_pressure','c_tilt','c_orient','c_twist','c_tang','c_raw',
    'c_coal','c_sph','c_secure','c_src','c_ostate','c_ofrom',
    'd_alt','d_az','d_tw','d_lean','d_leandir','d_rel','d_pp','d_uprof',
    'i_res','i_flow','i_dep','i_pool','i_spread','i_abs','k_obs','k_state',
    'b_praw','b_pnorm','b_pfilt','b_pmap',
  ];
  const DBG_BUTTONS = ['k_auto','k_save','k_reset'];

  H.buildDOM = function buildDOM(w, h) {
    w = w || 900; h = h || 600;
    const host = document.createElement('div');
    host.id = 'app';
    document.body.appendChild(host);

    const bar = document.createElement('div');
    bar.className = 'toolbar';
    host.appendChild(bar);

    for (const [id, min, max, step, val] of RANGES) {
      const el = document.createElement('input');
      el.type = 'range'; el.id = id;
      el.min = String(min); el.max = String(max);
      el.step = String(step); el.value = String(val);
      bar.appendChild(el);
    }
    for (const id of VALUE_SPANS) {
      const s = document.createElement('span');
      s.id = id; bar.appendChild(s);
    }
    const sel = document.createElement('select');
    sel.id = 'nib';
    for (const v of ['flat', 'sharp', 'round']) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v; sel.appendChild(o);
    }
    bar.appendChild(sel);

    const col = document.createElement('input');
    col.type = 'color'; col.id = 'color'; col.value = '#2a1d10';
    bar.appendChild(col);

    // انتخابگرِ کیفیتِ خروجی (صدورِ PNG)
    const ex = document.createElement('select');
    ex.id = 'exportScale';
    for (const v of ['1', '2', '3', '4']) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v + 'x';
      if (v === '2') o.selected = true;
      ex.appendChild(o);
    }
    bar.appendChild(ex);

    const ar = document.createElement('input');
    ar.type = 'checkbox'; ar.id = 'autoReturn';
    bar.appendChild(ar);

    const fi = document.createElement('input');
    fi.type = 'file'; fi.id = 'paperImage';
    bar.appendChild(fi);

    for (const id of BUTTONS) {
      const b = document.createElement('button');
      b.id = id; b.textContent = id;
      if (id === 'paperDaftari' || id === 'twistMode' || id === 'vertBtn') b.className = 'active';
      bar.appendChild(b);
    }

    // پنلِ کالیبراسیونِ پنهان + اسلایدرهای پارامتر
    const dbgBox = document.createElement('div');
    dbgBox.id = 'dbg';
    dbgBox.hidden = true;
    for (const id of TUNE_RANGES) {
      const el = document.createElement('input');
      el.type = 'range'; el.id = id;
      el.min = '0'; el.max = '100'; el.step = '0.01';
      dbgBox.appendChild(el);
      const b = document.createElement('b');
      b.id = id + 'Val';
      dbgBox.appendChild(b);
    }
    const treset = document.createElement('button');
    treset.id = 't_reset';
    dbgBox.appendChild(treset);
    for (const id of DBG_BUTTONS) {
      const b = document.createElement('button');
      b.id = id; dbgBox.appendChild(b);
    }
    for (const id of DBG_TEXT) {
      const e = document.createElement('b');
      e.id = id; dbgBox.appendChild(e);
    }
    for (const id of ['d_curve', 'd_nibview']) {
      const c = document.createElement('canvas');
      c.id = id; c.width = 150; c.height = 90;
      dbgBox.appendChild(c);
    }
    host.appendChild(dbgBox);

    const paper = document.createElement('div');
    paper.id = 'paper';
    paper.style.cssText =
      `position:relative;width:${w}px;height:${h}px;overflow:hidden;touch-action:none;`;
    for (const id of ['paperTex', 'ink', 'guide']) {
      const c = document.createElement('canvas');
      c.id = id;
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      paper.appendChild(c);
    }
    const hudEl = document.createElement('div');
    hudEl.id = 'hud'; paper.appendChild(hudEl);
    host.appendChild(paper);

    const st = document.createElement('div');
    st.id = 'status'; host.appendChild(st);

    H.paper = paper;
    return paper;
  };

  /* ------------------------------------------------------------------
     2) شمارنده‌ی draw call — قبل از بارگذاری موتور نصب می‌شود
     ------------------------------------------------------------------ */
  const COUNTED = [
    'fill', 'stroke', 'fillRect', 'clearRect', 'drawImage',
    'beginPath', 'arc', 'moveTo', 'lineTo', 'save', 'restore',
    'putImageData', 'getImageData', 'createImageData',
  ];
  H.counters = Object.create(null);

  H.instrument = function instrument() {
    const proto = CanvasRenderingContext2D.prototype;
    for (const name of COUNTED) {
      if (typeof proto[name] !== 'function' || proto[name].__qalamWrapped) continue;
      const orig = proto[name];
      const c = H.counters;
      c[name] = 0;
      const wrapped = function () {
        c[name]++;
        return orig.apply(this, arguments);
      };
      wrapped.__qalamWrapped = true;
      proto[name] = wrapped;
    }
  };
  H.resetCounters = function () {
    for (const k in H.counters) H.counters[k] = 0;
  };
  H.snapshotCounters = function () {
    const out = {};
    for (const k in H.counters) out[k] = H.counters[k];
    // پروکسیِ «draw call» = عملیاتی که واقعاً رستریزه می‌کند
    out.drawCalls = (out.fill | 0) + (out.stroke | 0) + (out.fillRect | 0) +
                    (out.drawImage | 0) + (out.putImageData | 0);
    return out;
  };

  /* ------------------------------------------------------------------
     2b) شمارنده‌ی زمانِ واقعیِ CPU
     ------------------------------------------------------------------
     زمانِ انتظار برای vsync در rAF جزء هزینه‌ی موتور نیست. برای مقایسه‌ی
     منصفانه‌ی موتورِ سنکرون (قدیمی) با موتورِ rAF-محور (جدید) دو سهم را
     جدا اندازه می‌گیریم:
       • dispatchBusyMs : زمانِ اجرای هندلرهای pointer (سنکرون)
       • rafBusyMs      : زمانِ اجرای callbackهای rAF موتور
     مجموعِ این دو = «زمانِ اشغالِ ترد اصلی» و سنجه‌ی اصلیِ ما است.
     ------------------------------------------------------------------ */
  H.rafBusyMs = 0;
  H.rafCalls = 0;
  H.dispatchBusyMs = 0;
  H._harnessRaf = null;

  H.instrumentRaf = function () {
    if (H._harnessRaf) return;
    const orig = window.requestAnimationFrame.bind(window);
    H._harnessRaf = orig;
    window.requestAnimationFrame = function (cb) {
      // callbackهای خودِ harness (انتظار برای فریم) شمرده نمی‌شوند
      if (cb && cb.__harness) return orig(cb);
      return orig(function (ts) {
        const t = performance.now();
        try { return cb(ts); }
        finally { H.rafBusyMs += performance.now() - t; H.rafCalls++; }
      });
    };
  };
  H.waitFrame = function () {
    return new Promise(res => {
      const f = function () { res(); };
      f.__harness = true;
      (H._harnessRaf || window.requestAnimationFrame)(f);
    });
  };
  H.resetBusy = function () {
    H.rafBusyMs = 0; H.rafCalls = 0; H.dispatchBusyMs = 0;
  };

  /* ------------------------------------------------------------------
     3) ساخت رویداد مصنوعی
     ------------------------------------------------------------------ */
  let nextPointerId = 100;
  H.newPointerId = () => ++nextPointerId;

  H.supportsCoalescedInit = (function () {
    try {
      const child = new PointerEvent('pointermove', { pointerId: 1 });
      const p = new PointerEvent('pointermove', { pointerId: 1, coalescedEvents: [child] });
      return typeof p.getCoalescedEvents === 'function' && p.getCoalescedEvents().length === 1;
    } catch (_) { return false; }
  })();

  // s = { x, y, pressure, tiltX, tiltY, twist, t }
  function initFrom(type, s, pointerId, pointerType, buttons) {
    const r = H.paper.getBoundingClientRect();
    return {
      bubbles: true, cancelable: type !== 'pointerrawupdate' && type !== 'pointercancel',
      composed: true,
      pointerId, pointerType,
      isPrimary: true,
      button: (type === 'pointerdown' || type === 'pointerup') ? 0 : -1,
      buttons: buttons === undefined ? 1 : buttons,
      clientX: r.left + s.x,
      clientY: r.top + s.y,
      pressure: s.pressure === undefined ? 0.5 : s.pressure,
      tiltX: s.tiltX || 0,
      tiltY: s.tiltY || 0,
      twist: s.twist || 0,
    };
  }

  // مهرِ زمانِ رویدادهای مصنوعی: Event.timeStamp فقط-خواندنی است و از
  // زمانِ ساخت می‌آید؛ چون همه‌ی رویدادهای یک دسته در یک لحظه ساخته
  // می‌شوند، dt واقعی صفر می‌شد و سرعت/درنگ بی‌معنا. پس مهرِ زمانِ
  // یکنواخت را روی نمونه (s.t) تعریف و روی خودِ رویداد ست می‌کنیم.
  function stampEvent(ev, t) {
    if (t === undefined || t === null) return ev;
    try { Object.defineProperty(ev, 'timeStamp', { value: t, configurable: true }); }
    catch (_) {}
    return ev;
  }

  H.makeEvent = function (type, s, pointerId, pointerType, coalesced) {
    const init = initFrom(type, s, pointerId, pointerType);
    if (coalesced && coalesced.length && H.supportsCoalescedInit) {
      init.coalescedEvents = coalesced.map(
        cs => stampEvent(new PointerEvent(type, initFrom(type, cs, pointerId, pointerType)), cs.t)
      );
    }
    return stampEvent(new PointerEvent(type, init), s.t);
  };

  H.dispatch = function (ev) { H.paper.dispatchEvent(ev); };

  /* ------------------------------------------------------------------
     4) تولید مسیرهای آزمون
     ------------------------------------------------------------------ */
  // خط راست با سرعت ثابت (px بر نمونه) و منحنی فشار دلخواه
  // dtMs: فاصله‌ی زمانیِ نمونه‌ها؛ پیش‌فرض 5ms (≈200Hz)
  H.pathLine = function (x0, y0, x1, y1, n, pressureFn, dtMs) {
    const dt = dtMs || 5, t0 = performance.now();
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1);
      out.push({
        x: x0 + (x1 - x0) * u,
        y: y0 + (y1 - y0) * u,
        pressure: pressureFn ? pressureFn(u) : 0.7,
        t: t0 + i * dt,
      });
    }
    return out;
  };

  H.pathCircle = function (cx, cy, rad, n, pressureFn, dtMs) {
    const dt = dtMs || 5, t0 = performance.now();
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1 || 1), a = u * Math.PI * 2;
      out.push({
        x: cx + Math.cos(a) * rad,
        y: cy + Math.sin(a) * rad,
        pressure: pressureFn ? pressureFn(u) : 0.7,
        t: t0 + i * dt,
      });
    }
    return out;
  };

  // زیگزاگ تند با تغییر جهت — بدترین حالت برای هموارسازی
  H.pathZigzag = function (x0, y0, len, amp, n, pressureFn, dtMs) {
    const dt = dtMs || 5, t0 = performance.now();
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1 || 1);
      out.push({
        x: x0 + len * u,
        y: y0 + Math.sin(u * Math.PI * 12) * amp,
        pressure: pressureFn ? pressureFn(u) : 0.7,
        t: t0 + i * dt,
      });
    }
    return out;
  };

  /* ------------------------------------------------------------------
     5) پخشِ یک استروک با نرخِ سخت‌افزاریِ مشخص و coalescing واقع‌گرا
     ------------------------------------------------------------------
     hz            : نرخ نمونه‌ی سخت‌افزار (مثلاً 200 برای تبلت قلم)
     framesPerSec  : نرخ تحویلِ pointermove (مثلاً 60)
     rawUpdate     : اگر true، pointerrawupdate هم مثل مرورگر واقعی
                     پیش از هر pointermove ارسال می‌شود
     ------------------------------------------------------------------ */
  H.playStroke = async function (samples, opt) {
    opt = opt || {};
    const pointerType = opt.pointerType || 'pen';
    const hz = opt.hz || 200;
    const fps = opt.framesPerSec || 60;
    const perFrame = Math.max(1, Math.round(hz / fps));
    const rawUpdate = opt.rawUpdate !== false;
    const id = H.newPointerId();
    const frameTimes = [];

    let t = performance.now();
    H.dispatch(H.makeEvent('pointerdown', samples[0], id, pointerType));
    H.dispatchBusyMs += performance.now() - t;

    for (let i = 1; i < samples.length; i += perFrame) {
      const batch = samples.slice(i, i + perFrame);
      if (!batch.length) break;
      const t0 = performance.now();
      if (rawUpdate) {
        for (const s of batch) {
          H.dispatch(H.makeEvent('pointerrawupdate', s, id, pointerType));
        }
      }
      H.dispatch(H.makeEvent(
        'pointermove', batch[batch.length - 1], id, pointerType, batch
      ));
      const dispatchMs = performance.now() - t0;
      H.dispatchBusyMs += dispatchMs;
      frameTimes.push(dispatchMs);
      // به موتورهای rAF-محور فرصتِ پردازش بده
      if (opt.waitFrame !== false) await H.waitFrame();
    }

    t = performance.now();
    H.dispatch(H.makeEvent('pointerup', samples[samples.length - 1], id, pointerType));
    const upTime = performance.now() - t;
    H.dispatchBusyMs += upTime;
    if (opt.waitFrame !== false) { await H.waitFrame(); await H.waitFrame(); }

    return { frameTimes, upTime };
  };

  H.stats = function (arr) {
    if (!arr.length) return { n: 0, mean: 0, p50: 0, p95: 0, max: 0 };
    const s = arr.slice().sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      n: arr.length,
      mean: sum / arr.length,
      p50: s[(s.length * 0.5) | 0],
      p95: s[Math.min(s.length - 1, (s.length * 0.95) | 0)],
      max: s[s.length - 1],
    };
  };

  H.setControl = function (id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  H.loadEngine = function (src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  };
})();
