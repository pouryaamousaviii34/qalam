/* =====================================================================
   assist-engine.js — لایهٔ «دستیارِ هوشمندِ خوشنویسی» + «فیزیکِ خودکارِ واقعی»
   ---------------------------------------------------------------------
   این فایل کاملاً مستقل از DOM است (مثل qalam-engine.js) تا بتوان آن را
   تست و بنچمارک کرد. هیچ‌جا Math.random صدا زده نمی‌شود: هر «ریزنوسانِ
   طبیعی» از نویزِ *قطعیِ* هش‌محور می‌آید تا رسمِ افزایشی و بازترسیمِ کامل
   پیکسل‌به‌پیکسل یکی بمانند (همان تضمینی که تستِ REGION پروژه دارد).

   زنجیره:

     StylusState (فشارِ واقعی)
            ↓
     PressureEngine        فشار ⇄ پهنا (رفت و برگشت ⇒ Target Pressure)
            ↓
     Stabilizer            One Euro Filter — حذفِ لرزشِ دست
            ↓
     PathMatcher           نزدیک‌ترین نقطهٔ Centerline با پیشرویِ یکنواخت
            ↓
     WidthProfile          پهنای هدف در t نرمال‌شده
            ↓
     BallpointModel        تماسِ ساچمه، جریانِ جوهر، تجمع، شکاف، ریزنوسان
            ↓
     PaperModel            زبری/جذبِ کاغذ
            ↓
     applyWidthScale()     نوشتنِ نتیجه در ContactState موجود

   مراجع:
     [1EU] G. Casiez, N. Roussel, D. Vogel, "1€ Filter: A Simple Speed-based
           Low-pass Filter for Noisy Input in Interactive Systems" (CHI 2012)
     [PER] K. Perlin, "An Image Synthesizer" (SIGGRAPH '85) — درون‌یابیِ
           همبستهٔ نویزِ شبکه‌ای (این‌جا value noise، نه gradient noise)
     [MOXI] N. Chu, C.-L. Tai, "MoXi" (SIGGRAPH 2005) — جذب/پخشِ کاغذ
     [BAL] فیزیکِ کیفیِ خودکارِ ساچمه‌ای: انتقالِ جوهر تابعِ سطحِ تماسِ ساچمه،
           سرعتِ خطی و مقدارِ جوهرِ رسیده به ساچمه است — نه تابعِ شفافیت.
   ===================================================================== */
(function (global) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  function angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }

  /* ===================================================================
     ۰) پیش‌فرض‌ها — همه قابلِ تنظیم، هیچ‌کدام Hard-Code در مسیرِ محاسبه
     =================================================================== */
  const DEFAULTS = {
    /* ---- کلید اصلی: خاموش ⇒ رفتارِ قبلیِ پروژه، بیت‌به‌بیت ---- */
    intelligent_assist_enabled: false,
    real_ballpoint_enabled: false,

    /* ---- حالت‌ها ---- */
    assist_mode: 'free',          // 'free' | 'reference'
    style: 'calligraphy',         // 'calligraphy' | 'drawing' | 'custom'
    width_mode: 'pressure',       // 'pressure' | 'reference' | 'hybrid'
    training_mode: false,
    debug_overlay: false,

    /* ---- قدرتِ کمک ---- */
    assist_strength: 0.5,         // ۰ = مسیرِ کاربر، ۱ = بازسازیِ کاملِ مرجع
    smoothing_strength: 0.35,     // ۰ = خام، ۱ = بسیار نرم
    // شعاعِ جست‌وجوی مرجع بر حسبِ ضریبی از پهنای مرجع در آن نقطه
    match_tolerance: 2.6,
    // سقفِ مطلقِ جست‌وجو (px) — از پهنای نوک مشتق می‌شود، این فقط ضریب است
    match_max_radius_nib: 6.0,

    /* ---- فشار ---- */
    pressure_enabled: true,
    pressure_curve: 'normal',     // 'soft' | 'normal' | 'hard' | 'linear' | 'custom'
    pressure_curve_gamma: 1.0,    // فقط در حالتِ custom
    pressure_sensitivity: 1.0,    // ضریبی روی نمای منحنی
    pressure_min: 0.0,            // کف پهنا به‌صورتِ نسبتِ فشار
    pressure_max: 1.0,
    show_pressure: true,
    show_target_pressure: true,
    show_target_width: true,
    // سهمِ فشار در حالتِ Hybrid — کران‌دار تا کاربر شکلِ مرجع را خراب نکند
    hybrid_pressure_range: 0.25,

    /* ---- خودکارِ ساچمه‌ای ---- */
    pen_preset: 'default',
    base_width_mm: 0.5,
    ink_flow: 1.0,
    ink_density: 1.0,
    ink_build_up: 0.35,
    ink_dryness: 0.0,             // ۰ = پرجوهر، ۱ = خشک (شکافِ بیشتر)
    velocity_response: 0.30,
    natural_variation: 0.22,      // ریزنوسانِ طبیعی (نه لرزش!)
    start_taper: 0.55,
    end_taper: 0.70,
    // زاویهٔ قلم اگر دستگاه tilt نداشت، اثرش در ساچمه‌ای بسیار محدود است
    tilt_influence: 0.15,

    /* ---- کاغذ ---- */
    paper_type: 'plain',
    paper_roughness: 0.25,
    paper_absorption: 0.30,

    /* ---- کارایی ---- */
    analysis_max_side: 1024,
    // گامِ بازنمونه‌برداریِ Centerline بر حسب پیکسلِ تحلیل
    centerline_step: 1.5,
  };

  /* پیش‌تنظیم‌های خودکار — «فقط Configuration»، نه موتورِ جدا (بخش ۱۱۱) */
  const PEN_PRESETS = {
    default:  { name: 'Real Ballpoint – Default', base_width_mm: 0.50, ink_flow: 1.00, ink_density: 1.00, ink_build_up: 0.35, ink_dryness: 0.00, velocity_response: 0.30, natural_variation: 0.22 },
    fine:     { name: 'Fine Ballpoint',           base_width_mm: 0.30, ink_flow: 0.88, ink_density: 0.96, ink_build_up: 0.22, ink_dryness: 0.10, velocity_response: 0.38, natural_variation: 0.26 },
    medium:   { name: 'Medium Ballpoint',         base_width_mm: 0.70, ink_flow: 1.02, ink_density: 1.02, ink_build_up: 0.40, ink_dryness: 0.00, velocity_response: 0.28, natural_variation: 0.20 },
    smooth:   { name: 'Smooth Ballpoint',         base_width_mm: 0.60, ink_flow: 1.12, ink_density: 1.05, ink_build_up: 0.30, ink_dryness: 0.00, velocity_response: 0.16, natural_variation: 0.10 },
    heavy:    { name: 'Heavy Ink Ballpoint',      base_width_mm: 0.90, ink_flow: 1.25, ink_density: 1.10, ink_build_up: 0.62, ink_dryness: 0.00, velocity_response: 0.20, natural_variation: 0.16 },
    dry:      { name: 'Dry Ballpoint',            base_width_mm: 0.45, ink_flow: 0.70, ink_density: 0.88, ink_build_up: 0.14, ink_dryness: 0.55, velocity_response: 0.46, natural_variation: 0.40 },
  };

  /* پیش‌تنظیم‌های کاغذ (بخش ۱۰۲) — روی جذب/زبری/پخش اثر می‌گذارند */
  const PAPER_TYPES = {
    plain:       { name: 'Plain Paper',       roughness: 0.25, absorption: 0.30 },
    notebook:    { name: 'Notebook Paper',    roughness: 0.32, absorption: 0.38 },
    smooth:      { name: 'Smooth Paper',      roughness: 0.10, absorption: 0.16 },
    rough:       { name: 'Rough Paper',       roughness: 0.70, absorption: 0.62 },
    premium:     { name: 'Premium Paper',     roughness: 0.16, absorption: 0.22 },
    calligraphy: { name: 'Calligraphy Paper', roughness: 0.40, absorption: 0.55 },
  };

  const CURVE_GAMMA = { soft: 0.62, normal: 0.85, hard: 1.65, linear: 1.0 };

  function createSettings(overrides) {
    const s = {};
    for (const k in DEFAULTS) s[k] = DEFAULTS[k];
    if (overrides) for (const k in overrides) {
      if (overrides[k] !== undefined && overrides[k] !== null) s[k] = overrides[k];
    }
    return s;
  }

  function applyPenPreset(settings, id) {
    const p = PEN_PRESETS[id];
    if (!p) return false;
    settings.pen_preset = id;
    for (const k in p) if (k !== 'name') settings[k] = p[k];
    return true;
  }
  function applyPaperType(settings, id) {
    const p = PAPER_TYPES[id];
    if (!p) return false;
    settings.paper_type = id;
    settings.paper_roughness = p.roughness;
    settings.paper_absorption = p.absorption;
    return true;
  }

  /* ===================================================================
     ۱) One Euro Filter  [1EU]
     -------------------------------------------------------------------
     چرا این و نه EMA خالص؟ EMA با ضریبِ ثابت یا لرزش را نمی‌گیرد یا قلم
     را عقب می‌اندازد. One Euro فرکانسِ قطع را با *سرعتِ* حرکت بالا می‌برد:
     در حرکتِ آهسته (که لرزش دیده می‌شود) فیلترِ قوی، و در حرکتِ تند
     (که تأخیر دیده می‌شود) فیلترِ ضعیف.
     =================================================================== */
  function LowPass() { this.y = 0; this.s = 0; this.init = false; }
  LowPass.prototype.reset = function () { this.init = false; return this; };
  LowPass.prototype.filter = function (v, a) {
    if (!this.init) { this.s = v; this.init = true; }
    else this.s = a * v + (1 - a) * this.s;
    this.y = v;
    return this.s;
  };

  function alphaOf(cutoffHz, dtSec) {
    if (!(cutoffHz > 0) || !(dtSec > 0)) return 1;
    const tau = 1 / (TAU * cutoffHz);
    return 1 / (1 + tau / dtSec);
  }

  /* فیلترِ دوبعدی: مشتقِ هر محور جدا، ولی فرکانسِ قطع از *تندیِ دوبعدی*
     می‌آید. اگر هر محور فرکانسِ خودش را داشته باشد، در حرکتِ مورب دو محور
     نامتقارن فیلتر می‌شوند و مسیر کمی «پله‌ای» می‌شود. */
  function OneEuro2D() {
    this.px = new LowPass(); this.py = new LowPass();
    this.dx = new LowPass(); this.dy = new LowPass();
    this.minCutoff = 1.2; this.beta = 0.012; this.dCutoff = 1.0;
    this.reset();
  }
  OneEuro2D.prototype.reset = function () {
    this.px.reset(); this.py.reset(); this.dx.reset(); this.dy.reset();
    this.lastT = -1; this.lastX = 0; this.lastY = 0; this.has = false;
    this.speedHat = 0;
    return this;
  };
  /* smoothing ∈ [0,1] → (minCutoff, beta)
     -------------------------------------------------------------------
     نگاشت **هندسی** است، نه خطی. دلیلش اندازه‌گیری است، نه سلیقه:
     فرکانسِ قطع لگاریتمی حس می‌شود. با نگاشتِ خطیِ 120→0.8Hz، در وسطِ
     اسلایدر فرکانسِ قطع همچنان ~۹۰Hz بود و اسلایدر عملاً در ۹۰٪ مسیرش
     هیچ کاری نمی‌کرد. اندازه‌گیریِ «دندانه‌داری» (میانگینِ |مشتقِ دوم|) روی
     لرزشِ ۱۰Hz دستِ انسان با نرخِ نمونهٔ ۲۰۰Hz:

         نگاشتِ خطیِ قبلی:  s=0.5 → 0.1362   (خامْ 0.1426 ⇒ ۴٪ کاهش)
         نگاشتِ هندسی:      s=0.5 → 0.0790   (⇒ ۴۵٪ کاهش)

     و beta: با beta≈0 یک استروکِ تند (۱۲۰۰px/s) ۱۳۳px عقب می‌مانْد — یعنی
     همان «تأخیرِ قلم» که بخش ۱۹ درخواست صریحاً ممنوع کرده. اندازه‌گیری:

         beta=0.000 → عقب‌ماندگیِ ۱۳۳px
         beta=0.007 → ۱۹px
         beta=0.030 → ۵px   ← انتخاب‌شده (لرزشِ آهسته همچنان ۷۳٪ کم می‌شود)

     پس beta با شدتِ هموارسازی بالا می‌رود: هرچه فیلتر قوی‌تر، محافظتِ
     بیشتری برای حرکتِ تندِ عمدی لازم است. */
  OneEuro2D.prototype.configure = function (smoothing) {
    const s = clamp01(smoothing);
    const HI = 90, LO = 0.9;                  // Hz
    this.minCutoff = HI * Math.pow(LO / HI, s);
    this.beta = 0.035 * s;
    this.dCutoff = 1.0;
    return this;
  };
  // out = {x, y}؛ tMs بر حسب میلی‌ثانیه
  OneEuro2D.prototype.filter = function (out, x, y, tMs) {
    if (!this.has) {
      this.has = true; this.lastT = tMs;
      this.lastX = x; this.lastY = y;
      this.px.filter(x, 1); this.py.filter(y, 1);
      out.x = x; out.y = y;
      return out;
    }
    let dt = (tMs - this.lastT) / 1000;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 120;
    this.lastT = tMs;

    const ad = alphaOf(this.dCutoff, dt);
    const vx = this.dx.filter((x - this.lastX) / dt, ad);
    const vy = this.dy.filter((y - this.lastY) / dt, ad);
    this.lastX = x; this.lastY = y;
    const speed = Math.sqrt(vx * vx + vy * vy);
    this.speedHat = speed;

    const cutoff = this.minCutoff + this.beta * speed;
    const a = alphaOf(cutoff, dt);
    out.x = this.px.filter(x, a);
    out.y = this.py.filter(y, a);
    return out;
  };

  /* ===================================================================
     ۲) موتورِ فشار — رفت و برگشت
     -------------------------------------------------------------------
     ورودی: فشارِ *کالیبره‌شدهٔ* stylus.js (۰..۱). این‌جا هیچ کالیبراسیونِ
     دومی انجام نمی‌شود؛ آن کار جای خودش را دارد و تکرارش یعنی دو منبعِ
     حقیقت. کارِ این‌جا فقط نگاشتِ *معکوس‌پذیرِ* فشار ⇄ پهنا است.
     =================================================================== */
  function PressureEngine(settings) { this.s = settings; }
  PressureEngine.prototype.gamma = function () {
    const s = this.s;
    const base = s.pressure_curve === 'custom'
      ? Math.max(0.05, s.pressure_curve_gamma)
      : (CURVE_GAMMA[s.pressure_curve] === undefined ? 1 : CURVE_GAMMA[s.pressure_curve]);
    // حساسیتِ بیشتر ⇒ نمای کوچک‌تر ⇒ رسیدنِ سریع‌تر به پهنای زیاد
    return clamp(base / Math.max(0.05, s.pressure_sensitivity), 0.05, 8);
  };
  // فشارِ نرمال‌شده در بازهٔ مفیدِ تنظیم‌شدهٔ کاربر
  PressureEngine.prototype.normalize = function (p) {
    const s = this.s;
    const lo = clamp01(s.pressure_min), hi = clamp01(s.pressure_max);
    if (hi - lo < 1e-6) return clamp01(p);
    return clamp01((clamp01(p) - lo) / (hi - lo));
  };
  PressureEngine.prototype.curve = function (p) {
    return Math.pow(clamp01(this.normalize(p)), this.gamma());
  };
  // پهنا از فشار
  PressureEngine.prototype.widthOf = function (p, wMin, wMax) {
    return wMin + (wMax - wMin) * this.curve(p);
  };
  /* فشارِ لازم برای یک پهنای معین — معکوسِ تحلیلیِ همان تابع.
     این «Target Pressure» است و *فقط* برای نمایش/آموزش به کار می‌رود.
     اگر پهنای خواسته‌شده بیرونِ توانِ قلم باشد، خروجی کران می‌خورد و
     پرچمِ outOfRange برمی‌گردد تا UI صادق بمانَد. */
  PressureEngine.prototype.pressureFor = function (w, wMin, wMax) {
    const span = wMax - wMin;
    if (!(span > 1e-9)) return { p: 0, outOfRange: true };
    const r = (w - wMin) / span;
    const out = r < 0 || r > 1;
    const q = Math.pow(clamp01(r), 1 / this.gamma());
    // برگرداندن به فضای فشارِ خامِ کالیبره‌شده (عکسِ normalize)
    const lo = clamp01(this.s.pressure_min), hi = clamp01(this.s.pressure_max);
    return { p: clamp01(lo + q * Math.max(1e-6, hi - lo)), outOfRange: out };
  };

  /* ===================================================================
     ۳) نویزِ قطعیِ همبسته — «ریزنوسانِ طبیعی»، نه Noise تصادفی
     -------------------------------------------------------------------
     بخش ۱۰۰ درخواست صریح است: random(x,y) ممنوع. پس:
       • value noise روی شبکهٔ یک‌بعدی/دوبعدی با هشِ عدد‌صحیح
       • درون‌یابیِ smoothstep ⇒ پیوسته و مشتق‌پیوسته (بی‌پله)
       • دامنهٔ کوچک، دو اکتاو
     ورودی‌ها *فضایی/طولِ قوسی* هستند، نه شمارندهٔ نمونه؛ پس بازترسیم و
     رسمِ زنده یک نتیجه می‌دهند و با Zoom هم بافت نمی‌پرد.
     =================================================================== */
  function hash1(i, seed) {
    let h = (i | 0) * 374761393 + (seed | 0) * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return ((h >>> 0) / 4294967296);
  }
  function hash2(ix, iy, seed) {
    let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return ((h >>> 0) / 4294967296);
  }
  const smoothstep = t => t * t * (3 - 2 * t);

  // نویزِ یک‌بعدی در بازهٔ [-1, +1]
  function noise1(x, seed) {
    const i = Math.floor(x), f = x - i;
    const a = hash1(i, seed), b = hash1(i + 1, seed);
    return (lerp(a, b, smoothstep(f)) - 0.5) * 2;
  }
  function fbm1(x, seed) {
    return noise1(x, seed) * 0.68 + noise1(x * 2.31 + 11.7, seed + 101) * 0.32;
  }
  // نویزِ دوبعدی در بازهٔ [-1, +1] — برای بافتِ کاغذ (مستقل از Zoom)
  function noise2(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smoothstep(x - ix), fy = smoothstep(y - iy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return (lerp(lerp(a, b, fx), lerp(c, d, fx), fy) - 0.5) * 2;
  }
  function fbm2(x, y, seed) {
    return noise2(x, y, seed) * 0.6 +
           noise2(x * 2.17 + 5.3, y * 2.17 - 3.1, seed + 77) * 0.27 +
           noise2(x * 4.41 - 9.7, y * 4.41 + 2.9, seed + 313) * 0.13;
  }

  /* ===================================================================
     ۴) پروفایلِ پهنا — داده‌ای مستقل از رزولوشن (بخش ۲۶)
     =================================================================== */
  function WidthProfile(ts, ws) {
    this.ts = ts || new Float32Array(0);
    this.ws = ws || new Float32Array(0);
  }
  WidthProfile.prototype.length = function () { return this.ts.length; };
  WidthProfile.prototype.sample = function (t) {
    const n = this.ts.length;
    if (n === 0) return 0;
    if (n === 1) return this.ws[0];
    const u = clamp01(t);
    // ts یکنواختِ صعودی است ⇒ جست‌وجوی دودویی
    let lo = 0, hi = n - 1;
    if (u <= this.ts[0]) return this.ws[0];
    if (u >= this.ts[n - 1]) return this.ws[n - 1];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.ts[mid] <= u) lo = mid; else hi = mid;
    }
    const t0 = this.ts[lo], t1 = this.ts[hi];
    const f = (t1 - t0) > 1e-9 ? (u - t0) / (t1 - t0) : 0;
    return lerp(this.ws[lo], this.ws[hi], f);
  };
  WidthProfile.prototype.min = function () {
    let m = Infinity;
    for (let i = 0; i < this.ws.length; i++) if (this.ws[i] < m) m = this.ws[i];
    return isFinite(m) ? m : 0;
  };
  WidthProfile.prototype.max = function () {
    let m = -Infinity;
    for (let i = 0; i < this.ws.length; i++) if (this.ws[i] > m) m = this.ws[i];
    return isFinite(m) ? m : 0;
  };
  WidthProfile.prototype.scaled = function (k) {
    const ws = new Float32Array(this.ws.length);
    for (let i = 0; i < ws.length; i++) ws[i] = this.ws[i] * k;
    return new WidthProfile(this.ts, ws);
  };
  /* هموارسازیِ پروفایل: میانهٔ ۵ (ضدِ پرت) سپس گاوسیِ سبک (پیوستگی).
     بدونِ این، هر پیکسلِ اضافیِ ماسکِ مرجع یک پلهٔ دیدنی در پهنا می‌سازد. */
  WidthProfile.prototype.smooth = function (radius) {
    const n = this.ws.length;
    if (n < 5) return this;
    const med = new Float32Array(n);
    const buf = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      for (let k = -2; k <= 2; k++) buf[k + 2] = this.ws[clamp(i + k, 0, n - 1)];
      buf.sort((a, b) => a - b);
      med[i] = buf[2];
    }
    const r = Math.max(1, radius | 0 || 2);
    const sigma = r * 0.6;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0, wsum = 0;
      for (let k = -r; k <= r; k++) {
        const w = Math.exp(-(k * k) / (2 * sigma * sigma));
        sum += med[clamp(i + k, 0, n - 1)] * w;
        wsum += w;
      }
      out[i] = sum / wsum;
    }
    return new WidthProfile(this.ts, out);
  };
  // ساخت از نمونه‌های (arcLength, width) — t خودش نرمال می‌شود
  WidthProfile.fromArc = function (arcs, widths, count) {
    const n = count === undefined ? arcs.length : count;
    if (n <= 0) return new WidthProfile();
    const total = arcs[n - 1];
    const ts = new Float32Array(n), ws = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ts[i] = total > 1e-9 ? arcs[i] / total : (n > 1 ? i / (n - 1) : 0);
      ws[i] = widths[i];
    }
    return new WidthProfile(ts, ws);
  };

  /* ===================================================================
     ۵) ابزارهای مسیر
     =================================================================== */
  const PathTools = {
    // طولِ تجمعیِ یک polyline در آرایهٔ داده‌شده
    arcLengths: function (pts, out) {
      const n = pts.length;
      const a = out || new Float32Array(n);
      a[0] = 0;
      for (let i = 1; i < n; i++) {
        a[i] = a[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      return a;
    },
    totalLength: function (pts) {
      let s = 0;
      for (let i = 1; i < pts.length; i++) {
        s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      return s;
    },
    /* بازنمونه‌برداری بر مبنای طولِ قوس (بخش ۱۸).
       خروجی: آرایهٔ تازه‌ای از {x,y}. گام از DPI/رزولوشن می‌آید، نه عددِ ثابت. */
    resample: function (pts, step) {
      const n = pts.length;
      if (n < 2 || !(step > 0)) return pts.slice();
      const out = [{ x: pts[0].x, y: pts[0].y }];
      let carry = 0;
      for (let i = 1; i < n; i++) {
        const x0 = pts[i - 1].x, y0 = pts[i - 1].y;
        const dx = pts[i].x - x0, dy = pts[i].y - y0;
        const d = Math.hypot(dx, dy);
        if (d < 1e-9) continue;
        let t = step - carry;
        while (t <= d) {
          const u = t / d;
          out.push({ x: x0 + dx * u, y: y0 + dy * u });
          t += step;
        }
        carry = d - (t - step);
      }
      const last = pts[n - 1];
      const tail = out[out.length - 1];
      if (Math.hypot(last.x - tail.x, last.y - tail.y) > step * 0.35) {
        out.push({ x: last.x, y: last.y });
      }
      return out;
    },
    /* هموارسازیِ چندگذرهٔ polyline (میانگینِ ۱-۲-۱، نگه‌داشتنِ دو سر).
       برای Centerline استخراج‌شده از اسکلت لازم است، چون اسکلتِ پیکسلی
       همیشه پله‌های ۱ پیکسلی دارد. */
    smooth: function (pts, passes) {
      let cur = pts;
      const p = Math.max(0, passes | 0);
      for (let k = 0; k < p; k++) {
        const n = cur.length;
        if (n < 3) break;
        const out = new Array(n);
        out[0] = cur[0]; out[n - 1] = cur[n - 1];
        for (let i = 1; i < n - 1; i++) {
          out[i] = {
            x: (cur[i - 1].x + 2 * cur[i].x + cur[i + 1].x) * 0.25,
            y: (cur[i - 1].y + 2 * cur[i].y + cur[i + 1].y) * 0.25,
          };
        }
        cur = out;
      }
      return cur;
    },
    tangentAt: function (pts, i) {
      const n = pts.length;
      if (n < 2) return 0;
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      return Math.atan2(b.y - a.y, b.x - a.x);
    },
  };

  /* ===================================================================
     ۶) شبکهٔ مکانی — جست‌وجوی نزدیک‌ترین نقطه در O(1) میانگین
     -------------------------------------------------------------------
     چرا شبکه و نه درختِ k-d؟ چون نقاطِ Centerline تقریباً یکنواخت روی
     مسیر پخش‌اند و چگالیِ فضایی‌شان یکسان است؛ در این حالت شبکهٔ ساده
     هم سریع‌تر است و هم هیچ تخصیصِ حافظه‌ای در مسیرِ داغ ندارد.
     =================================================================== */
  function SpatialGrid(cell) {
    this.cell = Math.max(1, cell || 8);
    this.map = new Map();
    this.pts = [];
  }
  SpatialGrid.prototype._key = function (cx, cy) { return cx * 73856093 ^ cy * 19349663; };
  SpatialGrid.prototype.add = function (x, y, payload) {
    const i = this.pts.length;
    this.pts.push({ x: x, y: y, d: payload });
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    const k = this._key(cx, cy);
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    arr.push(i);
    return i;
  };
  /* نزدیک‌ترین نقطه در شعاعِ r. خروجی در شیءِ out نوشته می‌شود (بی‌تخصیص).
     out = { found, x, y, dist, index, data } */
  SpatialGrid.prototype.nearest = function (out, x, y, r) {
    out.found = false; out.dist = Infinity; out.index = -1; out.data = null;
    const rad = Math.max(this.cell, r);
    const c0x = Math.floor((x - rad) / this.cell), c1x = Math.floor((x + rad) / this.cell);
    const c0y = Math.floor((y - rad) / this.cell), c1y = Math.floor((y + rad) / this.cell);
    const r2 = rad * rad;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const arr = this.map.get(this._key(cx, cy));
        if (!arr) continue;
        for (let j = 0; j < arr.length; j++) {
          const p = this.pts[arr[j]];
          const dx = p.x - x, dy = p.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && d2 < out.dist) {
            out.dist = d2; out.index = arr[j]; out.data = p.d;
            out.x = p.x; out.y = p.y; out.found = true;
          }
        }
      }
    }
    if (out.found) out.dist = Math.sqrt(out.dist);
    return out;
  };

  /* ===================================================================
     ۷) تطبیقِ مسیرِ کاربر با Centerline مرجع
     -------------------------------------------------------------------
     روشِ انتخابی (بخش ۱۴): **Arc-Length Parameterization + Nearest Point
     Projection با پیشرویِ یکنواخت**، نه DTW.
     دلیلِ انتخاب — اندازه‌گیریِ خودِ معماری:
       • DTW به *کلِ* مسیرِ کاربر نیاز دارد ⇒ نمی‌شود زنده اجرا شد بدونِ
         تأخیر؛ و پروژه صریحاً روی «Incremental، بدونِ Lag» تأکید دارد.
       • Centerline مرجع از قبل بر طولِ قوس بازنمونه شده است، پس یک
         پارامترِ یکنواخت t دارد. نزدیک‌ترین نقطه با شبکهٔ مکانی O(1) است.
       • «پیشرویِ یکنواخت» (اجازه ندادن به پرشِ رو به عقب بیش از یک آستانه)
         همان کاری را می‌کند که هم‌ترازیِ DTW می‌کرد: مستقل از سرعت و
         تعدادِ نقاطِ کاربر می‌شود، بدونِ هیچ هزینهٔ حافظه‌ای.
     =================================================================== */
  function PathMatcher() {
    this.reset();
    this._q = { found: false, x: 0, y: 0, dist: 0, index: -1, data: null };
  }
  PathMatcher.prototype.reset = function () {
    this.stroke = null;      // مرجعِ انتخاب‌شده در pen-down
    this.lastIdx = -1;
    /* جهتِ پیمایشِ کاربر روی Centerline.
       ترتیبِ نقاطِ Centerline از اسکلت می‌آید و *دلبخواه* است (تستِ
       مصنوعی: مسیر از x=357 به x=41 استخراج شد، یعنی برعکسِ جهتِ رسم).
       پس نمی‌توان فرض کرد کاربر از ایندکسِ صفر شروع می‌کند؛ جهت باید از
       خودِ حرکتِ کاربر استنتاج شود، وگرنه محدودگرِ «پیشرویِ یکنواخت» هر
       گام را «رو به عقب» می‌دید و کلِ تطبیق را رد می‌کرد. */
    this.dir = 0;            // ۰ = نامعلوم، +۱ / −۱ = جهتِ ایندکس
    this.matched = 0;
    this.missed = 0;
    return this;
  };
  /* انتخابِ Centerline در لحظهٔ pen-down: نزدیک‌ترین Centerline در شعاع.
     چند Stroke (بخش ۳۷) به‌همین‌شکل پشتیبانی می‌شود: هر جزءِ متصل یک
     Centerline مستقل با پروفایلِ پهنای خودش دارد. */
  /* radiusOf(rs) → شعاعِ مجازِ *همان* Stroke.
     -------------------------------------------------------------------
     ★ چرا تابع و نه یک عددِ واحد؟ رگرسیونِ یک باگِ اندازه‌گیری‌شده:
     نسخهٔ نخست یک شعاعِ سراسری می‌گرفت که از پهنای *بزرگ‌ترین* جزءِ مرجع
     ساخته می‌شد. اگر تصویرِ مرجع یک لکه/کادرِ پهن جایی داشت (در آزمون: یک
     مستطیلِ ۸۰×۴۰)، شعاع به ۲۱۳px می‌رسید و استروکی که کاربر ۱۹۰px *دورتر*
     از هر مرجعی می‌کشید هم به مرجع چسبانده می‌شد. یعنی یک جزءِ بی‌ربط،
     Tolerance کلِ تصویر را باد می‌کرد. */
  PathMatcher.prototype.pick = function (refStrokes, x, y, radiusOf) {
    this.reset();
    if (!refStrokes || !refStrokes.length) return null;
    const rf = typeof radiusOf === 'function' ? radiusOf : (() => radiusOf);
    let best = null, bestD = Infinity;
    for (let i = 0; i < refStrokes.length; i++) {
      const rs = refStrokes[i];
      if (!rs.grid) continue;
      const r = rf(rs);
      if (!(r > 0)) continue;
      rs.grid.nearest(this._q, x, y, r);
      if (this._q.found && this._q.dist < bestD) { bestD = this._q.dist; best = rs; }
    }
    this.stroke = best;
    return best;
  };
  /* out = { found, x, y, dist, t, width, tangent }
     x,y = نقطهٔ تصویرشده روی Centerline؛ t = پارامترِ نرمال‌شده. */
  PathMatcher.prototype.project = function (out, x, y, radius) {
    out.found = false;
    const rs = this.stroke;
    if (!rs || !rs.grid) { this.missed++; return out; }
    rs.grid.nearest(this._q, x, y, radius);
    if (!this._q.found) { this.missed++; return out; }
    let idx = this._q.index;
    /* پیشرویِ یکنواخت: پرشِ رو به عقب بیش از backLimit نقطه پذیرفته
       نمی‌شود. این همان چیزی است که وقتی مرجع خودش را قطع می‌کند (مثلاً
       حرفِ «A» یا یک حلقه) از «پریدنِ» تصویر به شاخهٔ اشتباه جلو می‌گیرد.
       جهت از خودِ حرکتِ کاربر استنتاج می‌شود، نه از ترتیبِ ایندکس. */
    const limit = rs.backLimit === undefined ? 24 : rs.backLimit;
    if (this.lastIdx >= 0) {
      const delta = idx - this.lastIdx;
      if (this.dir === 0 && Math.abs(delta) >= 2) this.dir = delta > 0 ? 1 : -1;
      if (this.dir !== 0) {
        const back = -this.dir * delta;      // > ۰ یعنی رو به عقب
        if (back > limit) {
          // به‌جای پرش، در همسایگیِ *جلوروِ* آخرین تطبیق خطی جست‌وجو می‌کنیم
          const n = rs.points.length;
          const span = limit * 3;
          let bi = -1, bd = Infinity;
          for (let s = 0; s <= span; s++) {
            const i = this.lastIdx + this.dir * s;
            if (i < 0 || i >= n) break;
            const dx = rs.points[i].x - x, dy = rs.points[i].y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; bi = i; }
          }
          if (bi >= 0 && Math.sqrt(bd) <= radius) idx = bi;
          else { this.missed++; return out; }
        }
      }
    }
    this.lastIdx = idx;
    this.matched++;
    const p = rs.points[idx];
    out.found = true;
    out.x = p.x; out.y = p.y;
    out.dist = Math.hypot(p.x - x, p.y - y);
    out.t = rs.ts[idx];
    out.width = rs.widths[idx];
    out.tangent = rs.tangents[idx];
    out.index = idx;
    return out;
  };
  PathMatcher.prototype.coverage = function () {
    const tot = this.matched + this.missed;
    return tot > 0 ? this.matched / tot : 0;
  };

  /* ===================================================================
     ۸) مدلِ کاغذ  (بخش ۱۰۱–۱۰۵)
     -------------------------------------------------------------------
     کاغذ فقط یک Texture نیست: یک مدلِ کوچک با دو مشخصهٔ فیزیکی است که
     روی *مرکب* اثر می‌گذارد، نه روی پس‌زمینه:
        roughness  → نوسانِ پوششِ جوهر و زبریِ لبه
        absorption → پخشِ جوهر (پهنای حاشیه) و کم‌شدنِ تیرگیِ سطح
     =================================================================== */
  function PaperModel(settings) { this.s = settings; }
  PaperModel.prototype.roughness = function () { return clamp01(this.s.paper_roughness); };
  PaperModel.prototype.absorption = function () { return clamp01(this.s.paper_absorption); };
  /* نوسانِ پوشش در یک نقطه — تابعِ *مکان*، پس با Zoom نمی‌پرد و در
     بازترسیم همان مقدار درمی‌آید. mmScale واحدِ فیزیکی می‌دهد تا بافت
     مستقل از DPI بمانَد. */
  PaperModel.prototype.grainAt = function (x, y, pxPerMm, seed) {
    const r = this.roughness();
    if (r < 1e-4) return 0;
    // دانهٔ کاغذ در مقیاسِ ~۰٫۳mm دیده می‌شود
    const k = Math.max(0.05, pxPerMm * 0.3);
    return fbm2(x / k, y / k, seed === undefined ? 1337 : seed) * r;
  };

  /* ===================================================================
     ۹) فیزیکِ خودکارِ ساچمه‌ای  (بخش ۹۳–۹۹، ۱۱۲–۱۲۱)
     -------------------------------------------------------------------
     مدلِ مفهومی:

        Pen Body → Ballpoint Tip → Ball Contact → Ink Transfer → Paper

     نکتهٔ کلیدی که این را از «Brush + Noise» جدا می‌کند:
       • «سطحِ تماسِ ساچمه» یک مقدارِ *حالت‌دار* است که با آهنگِ محدود
         تغییر می‌کند (ساچمه جرم و اصطکاک دارد؛ در یک نمونه نمی‌پرد).
       • «جوهرِ رسیده به ساچمه» یک مخزنِ کوچکِ حالت‌دار است: حرکتِ تند آن
         را تخلیه می‌کند و توقف پُرش می‌کند. همین است که هم Ink Gap در
         حرکتِ تند و هم Ink Build-Up در توقف را از *یک* مدل درمی‌آورد،
         نه از دو افکتِ جدا.
       • نتیجه در «پوششِ جوهر» و «پهنای اثر» می‌نشیند، نه در Opacity.
     =================================================================== */
  function BallpointState() { this.reset(); }
  BallpointState.prototype.reset = function () {
    this.contact = 0;         // ۰..۱ شدتِ تماسِ ساچمه با کاغذ
    this.tipInk = 1;          // جوهرِ رسیده به ساچمه (۰..۱)
    this.coverage = 1;        // پوششِ جوهر در این نمونه (۰..۱)
    this.deposition = 1;      // نشستِ جوهر (سازگار با InkState.amount)
    this.widthMul = 1;        // ضریبِ ریزنوسانِ پهنا
    this.gap = false;         // شکافِ جوهر در این نمونه؟
    this.buildUp = 0;         // تجمعِ جوهر (۰..۱)
    this.started = 0;         // مسافتِ طی‌شده از آغازِ استروک
    return this;
  };

  /* in = {
       pressure,     فشارِ کالیبره‌شده (۰..۱) یا -1 اگر نامعلوم
       speed,        px/ms  (منفی = نامعلوم)
       dwellMs,
       turn,         تغییرِ جهت بر حسبِ رادیان (۰..π)
       arcLen,       طولِ قوس از آغازِ استروک (px)
       lean,         خوابیدنِ قلم (۰..۱) — در ساچمه‌ای اثرِ کم
       dtMs,
       velocityRef,  سرعتِ مرجعِ نوشتنِ عادی (px/ms) — از cfg موتور
       pxPerMm
     } */
  function stepBallpoint(st, s, inp) {
    const pxPerMm = inp.pxPerMm > 0 ? inp.pxPerMm : (96 / 25.4);
    const vRef = inp.velocityRef > 0 ? inp.velocityRef : 0.42;
    const speed = inp.speed >= 0 ? inp.speed : vRef;
    const vRel = clamp(speed / vRef, 0, 4);
    const p = inp.pressure >= 0 ? clamp01(inp.pressure) : 0.5;
    const dt = inp.dtMs > 0 && inp.dtMs < 200 ? inp.dtMs : 8;

    /* ---- ۱) تماسِ ساچمه، با آهنگِ محدود -------------------------------
       ساچمه بی‌جرم نیست: هدفِ تماس از فشار می‌آید، ولی رسیدن به آن چند
       نمونه طول می‌کشد. همین است که «شروعِ نرمِ خودکار» (بخش ۱۱۶) را
       بدونِ هیچ تیپرِ مصنوعی می‌سازد. */
    const leanDrop = 1 - clamp01(inp.lean) * clamp01(s.tilt_influence);
    const target = clamp01((0.42 + 0.58 * p) * leanDrop);
    const rate = clamp01(0.10 + 0.22 * (dt / 8));
    st.contact += (target - st.contact) * rate;

    /* ---- ۲) مخزنِ نوکِ ساچمه — دینامیکِ اشباع‌شونده -------------------
       نسخهٔ نخست تخلیه را *مستقل از موجودی* گرفته بود:
           tipInk ← tipInk − drain + refill
       چون drain به tipInk وابسته نبود، این معادله تعادل نداشت و به یکی از
       دو کرانه می‌چسبید. اندازه‌گیری‌شده: حتی در «نوشتنِ عادی با قلمِ پرجوهر»
       مقدارِ پایا tipInk ≈ 0.002 می‌شد، یعنی قلم *همیشه* کم‌جوهر بود.

       فیزیکِ درست: فقط جوهری که *هست* می‌تواند منتقل شود، و مویینگی فقط
       جای *خالی* را پر می‌کند. پس هر دو جمله وابسته به موجودی‌اند:

           drain  = tipInk     × (مسافت / L) × f(تماس)
           refill = (1−tipInk) × Δt × rate × flow

       این یک تعادلِ نمایی می‌سازد:  tipInk_eq = B / (A + B)
       با مقادیرِ زیر، اندازه‌گیریِ عددی:
           نوشتنِ عادی، قلمِ پرجوهر …… ≈ 0.80  (سالم)
           ۴ برابرِ سرعت …………………… ≈ 0.49  (سبک‌تر، مثلِ واقعیت)
           قلمِ خشک با سرعتِ زیاد …… ≈ 0.14  (کم‌جوهر ⇒ امکانِ شکاف) */
    const dist = Math.max(0, speed * dt);
    const flowBase = Math.max(0.05, s.ink_flow) * (1 - clamp01(s.ink_dryness) * 0.55);
    // طولِ مشخصهٔ تخلیه: ۳۰ میلی‌متر نوشتن، مستقل از DPI
    const drainLen = Math.max(1e-6, 30 * pxPerMm);
    const drain = st.tipInk * (dist / drainLen) * (0.35 + 0.65 * st.contact);
    const refill = (1 - st.tipInk) * (dt / 1000) * (12 * flowBase);
    st.tipInk = clamp01(st.tipInk - drain + refill);

    /* ---- ۳) تجمعِ جوهر: توقف، کندی، و پیچِ تند --------------------- */
    const dwellF = clamp01(inp.dwellMs / 150);
    const turnF = clamp01((inp.turn || 0) / Math.PI);
    const slowF = clamp01((1 - vRel) * 0.9);
    st.buildUp = clamp01((dwellF * 0.55 + turnF * 0.30 + slowF * 0.35) *
                         clamp01(s.ink_build_up) * 1.6);

    /* ---- ۴) پوششِ جوهر ---------------------------------------------
       پوشش = تماس × جوهرِ نوک، با کفِ چگالی و اثرِ کران‌دارِ سرعت. */
    const velPenalty = clamp01(s.velocity_response) *
                       clamp01((vRel - 1) / 3);
    const floor = clamp01(0.74 + 0.18 * clamp01(s.ink_density));
    let cov = floor + (1 - floor) *
              clamp01(st.contact * (0.45 + 0.55 * st.tipInk)) *
              (1 - velPenalty);
    cov = clamp01(cov + st.buildUp * 0.10);

    /* ---- ۵) ریزنوسانِ طبیعیِ همبسته (بخش ۹۹، ۱۲۱) -------------------
       تابعِ طولِ قوس، نه شمارندهٔ نمونه ⇒ در بازترسیم همان است.
       دامنه با «جوهرِ نوکِ کم» بزرگ‌تر می‌شود: خودکارِ کم‌جوهر ناهمگون‌تر
       می‌نویسد. این همان تفاوتِ «Realistic» و «Random» است. */
    const nv = clamp01(s.natural_variation);
    const mmArc = inp.arcLen / pxPerMm;
    // دو مقیاس: ~۱٫۵mm (موجِ بلند) و ~۰٫۴mm (دانهٔ ریز)
    const wobble = fbm1(mmArc / 1.5, 7717);
    const grain = fbm1(mmArc / 0.4, 5153);
    const starve = 1 - st.tipInk;
    const covNoise = (grain * 0.55 + wobble * 0.45) * nv * (0.05 + 0.20 * starve);
    cov = clamp01(cov + covNoise);
    st.coverage = cov;

    // پهنا: نوسانِ *بسیار* کم — ساچمه پهنای تقریباً ثابتی دارد
    st.widthMul = clamp(1 + wobble * nv * 0.045 + st.buildUp * 0.06, 0.80, 1.30);

    /* ---- ۶) شکافِ جوهر (بخش ۹۸) -----------------------------------
       سه شرط باید *همزمان* برقرار باشد: سرعتِ زیاد، مخزنِ نوکِ تقریباً
       خالی، و افتادنِ نویزِ همبسته زیرِ یک آستانهٔ سخت‌گیر.

       آستانه به‌صورتِ *صدکِ* توزیعِ نویز بیان می‌شود، نه یک عددِ دلبخواه.
       نسخهٔ نخست `grain < −(1 − risk·1.4)` بود؛ با risk ≈ 0.71 آستانه
       *مثبت* می‌شد و چون ۴۷٪ نمونه‌ها گرینِ منفی دارند، شکاف از «رویدادِ
       نادر» به «حالتِ غالب» تبدیل می‌شد. اندازه‌گیریِ پیش از رفع: ۳۵۹ شکاف
       در ۴۰۰ نمونه.

       توزیعِ اندازه‌گیری‌شدهٔ fbm1 (۴۰۰۰ نمونه):
           grain < −0.3 …… ۱۹٪
           grain < −0.5 …… ۷٪
           grain < −0.7 …… ۲٪
           grain < −0.9 …… ۰٫۱٪
       پس آستانه در بازهٔ [−0.9, −0.45] می‌مانَد: حتی در بدترین حالت،
       شکاف زیرِ ~۱۰٪ نمونه‌ها می‌مانَد و خط «بریده» به نظر نمی‌رسد. */
    const dryness = clamp01(s.ink_dryness);
    const gapRisk = clamp01((vRel - 1.6) / 2.4) *
                    clamp01(1 - st.tipInk / 0.35) *
                    clamp01(0.15 + dryness);
    st.gap = gapRisk > 0.06 && grain < lerp(-0.9, -0.45, clamp01(gapRisk));

    /* ---- ۷) نشستِ جوهر — سازگار با InkState.amount ----------------
       بازهٔ inkToneDepMin..Max موتور همین را به «تُنِ رنگ» تبدیل می‌کند،
       پس تغییراتِ پوشش *دیده* می‌شوند بدونِ هیچ تغییری در رندرر. */
    st.deposition = clamp(0.35 + 1.05 * cov + st.buildUp * 0.35, 0, 2.5);
    st.started = inp.arcLen;
    return st;
  }

  /* ===================================================================
     ۱۰) نوشتنِ پهنای هدف در ContactState  (بدونِ خرابیِ هندسهٔ toe/heel)
     -------------------------------------------------------------------
     همان تدبیری که app.js در محدودگرِ maxWidthDropPerPx به کار می‌برد:
     کلِ پروفایل با هم مقیاس می‌شود تا نسبتِ پاشنه/پنجه سالم بمانَد.
     =================================================================== */
  function applyWidthScale(contact, k) {
    const kk = clamp(k, 0.02, 24);
    if (!(kk > 0) || Math.abs(kk - 1) < 1e-6) return contact;
    // پهنای کاملِ نوک را *پیش از* دست‌کاری نگه می‌داریم (width = nibW × ratio)
    const nibW = contact.ratio > 1e-6 ? contact.width / contact.ratio : 0;
    contact.width *= kk;
    contact.ratio = clamp01(contact.ratio * kk);
    const uc = (contact.uHeel + contact.uToe) * 0.5;
    const halfU = (contact.uToe - contact.uHeel) * 0.5 * kk;
    contact.uHeel = clamp(uc - halfU, -1, 1);
    contact.uToe = clamp(uc + halfU, -1, 1);
    if (nibW > 0) contact.offset = (contact.uHeel + contact.uToe) * 0.5 * nibW * 0.5;
    /* ضخامتِ سطحِ تماس با جذرِ ضریب مقیاس می‌شود، نه خطی: در یک نوکِ
       واقعی سطحِ تماس دوبعدی است و بزرگ‌شدنش در هر دو محور توزیع می‌شود.
       کران‌ها می‌گذارند تا نوکِ تخت به «کپسول» تبدیل نشود. */
    contact.thickness *= clamp(Math.sqrt(kk), 0.35, 1.6);
    return contact;
  }
  // پهنای هدف را مستقیم می‌نشاند (نه ضریب) — برای Width Mode = Reference
  function setContactWidth(contact, targetWidth) {
    if (!(contact.width > 1e-6) || !(targetWidth > 0)) return contact;
    return applyWidthScale(contact, targetWidth / contact.width);
  }

  /* --------------------------------------------------------------------
     همان کار، ولی روی یک *رکوردِ* app.js (نام‌های میدان متفاوت است)
     --------------------------------------------------------------------
     قراردادِ رکورد (از makeRecord / applyTailTaper پروژه):
        cw = nw × 0.5 × (ut − uh)      ct = ضخامت      t = ct/2
        co = (uh + ut)/2 × nw × 0.5    pl = نسبتِ پهنا
     دقیقاً همان جبرِ applyTailTaper به کار می‌رود تا دو مسیرِ متفاوتِ
     مقیاس‌دهی در پروژه نداشته باشیم.
     -------------------------------------------------------------------- */
  function scaleRecordWidth(rec, k, heelLift) {
    const kk = clamp(k, 0.02, 24);
    if (!(kk > 0) || Math.abs(kk - 1) < 1e-6) return rec;
    const hl = heelLift === undefined ? 1 : clamp01(heelLift);
    if (rec.uh != null && rec.nw != null) {
      const len = rec.ut - rec.uh;
      const newLen = clamp(len * kk, 0.02, 2);
      /* کوتاه/بلندشدن از سمتِ پاشنه: پنجه ثابت می‌مانَد. با heelLift = 0
         بازه حولِ مرکز متقارن تغییر می‌کند (همان معناشناسیِ موتور). */
      const uc = (rec.uh + rec.ut) * 0.5;
      if (hl > 0.5) {
        if ((rec.hs == null ? 1 : rec.hs) > 0) rec.uh = rec.ut - newLen;
        else rec.ut = rec.uh + newLen;
      } else {
        rec.uh = uc - newLen * 0.5;
        rec.ut = uc + newLen * 0.5;
      }
      rec.uh = clamp(rec.uh, -1, 1);
      rec.ut = clamp(rec.ut, -1, 1);
      rec.cw = rec.nw * 0.5 * (rec.ut - rec.uh);
      rec.ct = Math.max(0.2, rec.ct * clamp(Math.sqrt(kk), 0.35, 1.6));
      rec.co = (rec.uh + rec.ut) * 0.5 * rec.nw * 0.5;
      if (rec.pl != null) rec.pl = clamp01(rec.pl * kk);
      rec.t = rec.ct * 0.5;
    } else if (rec.cw != null) {
      rec.cw = rec.cw * kk;
      rec.ct = Math.max(0.2, rec.ct * clamp(Math.sqrt(kk), 0.35, 1.6));
      if (rec.pl != null) rec.pl = clamp01(rec.pl * kk);
      rec.t = rec.ct * 0.5;
    } else {
      rec.t = Math.max(0.2, rec.t * kk);
      if (rec.pl != null) rec.pl = clamp01(rec.pl * kk);
    }
    return rec;
  }

  /* ===================================================================
     ۱۱) Taper — سر و دمِ طبیعی  (بخش ۱۱۶–۱۱۸، ۲۸)
     -------------------------------------------------------------------
     ضریبِ پهنا بر حسبِ «مسافت از سر» و «مسافت تا دم». در حالتِ ساچمه‌ای
     مقدارِ پیش‌فرض کم و طبیعی است، نه تیپرِ خوشنویسیِ کامل.
     =================================================================== */
  function taperFactor(s, arcFromStart, arcToEnd, refLen) {
    const L = Math.max(1e-6, refLen);
    let k = 1;
    const st = clamp01(s.start_taper);
    if (st > 0 && arcFromStart >= 0) {
      const u = clamp01(arcFromStart / (L * 0.65));
      // ورودِ نرم: 1 - st·(1-u)^2
      k *= 1 - st * (1 - u) * (1 - u);
    }
    const en = clamp01(s.end_taper);
    if (en > 0 && arcToEnd >= 0) {
      const u = clamp01(arcToEnd / (L * 0.9));
      k *= 1 - en * (1 - u) * (1 - u);
    }
    return clamp(k, 0.04, 1);
  }

  /* ===================================================================
     ۱۲) بازسازیِ نهاییِ Stroke  (Final Reconstruction Pipeline)
     -------------------------------------------------------------------
     در pen-up اجرا می‌شود، روی *همان* آرایهٔ رکوردهای موجود. کارش:
       ۱) هموارسازیِ پروفایلِ پهنا در طولِ استروک (حذفِ پله‌های تک‌نمونه‌ای)
       ۲) اعمالِ Taper سر و دم بر مبنای طولِ *واقعیِ* استروک
     هیچ رکوردی اضافه/حذف نمی‌شود، پس Undo، پاک‌کن، صدور PNG و آینه
     دست‌نخورده می‌مانند. خروجی: کرانِ ناحیهٔ تغییریافته یا null.
     =================================================================== */
  function finalizeStroke(recs, s, opts) {
    const n = recs ? recs.length : 0;
    if (n < 3) return null;
    const o = opts || {};
    const wantSmooth = o.smoothWidth !== false;
    const wantTaper = o.taper !== false;
    /* تیپرِ *دم* پیش‌فرض روشن است، ولی app.js خودش applyTailTaper دارد که
       دمِ قلمِ نی را می‌سازد و تست‌شده است. پس در ادغام، دم به آن سپرده
       می‌شود و این‌جا فقط سر تیپر می‌خورد — وگرنه دو تیپر روی هم می‌افتاد
       و انتهای خط بی‌دلیل نازک می‌شد. */
    const wantEnd = o.taperEnd !== false;
    const heelLift = o.heelLift === undefined ? 1 : o.heelLift;
    const extraOf = typeof o.extentOf === 'function' ? o.extentOf : null;
    if (!wantSmooth && !wantTaper) return null;

    // طولِ قوس
    const arc = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      arc[i] = arc[i - 1] + Math.hypot(recs[i].x - recs[i - 1].x, recs[i].y - recs[i - 1].y);
    }
    const total = arc[n - 1];
    if (!(total > 1e-6)) return null;

    const before = new Float32Array(n);
    for (let i = 0; i < n; i++) before[i] = recs[i].cw == null ? 0 : recs[i].cw;

    // ---- ۱) هموارسازیِ پهنا: کرنلِ دوجمله‌ایِ ۵ نمونه (۱ ۴ ۶ ۴ ۱) ----
    const target = new Float32Array(n);
    if (wantSmooth) {
      const W5 = [1, 4, 6, 4, 1], SW = 16;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = -2; k <= 2; k++) sum += before[clamp(i + k, 0, n - 1)] * W5[k + 2];
        target[i] = sum / SW;
      }
    } else {
      for (let i = 0; i < n; i++) target[i] = before[i];
    }

    /* کرانِ ناحیهٔ تغییریافته = اجتماعِ حدودِ *پیش* و *پس* از تغییر.
       اگر فقط «پس» را بگیریم و پهنا کوچک شده باشد، چند پیکسلِ کهنه از
       رسمِ زنده باقی می‌مانَد — همان مسئله‌ای که applyTailTaper پروژه هم
       با unionBounds حل کرده است. */
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function grow(rec) {
      const ext = extraOf ? extraOf(rec)
                          : (Math.max(rec.cw || 0, rec.ct || 0) * 0.75 + 4);
      if (rec.x - ext < minX) minX = rec.x - ext;
      if (rec.y - ext < minY) minY = rec.y - ext;
      if (rec.x + ext > maxX) maxX = rec.x + ext;
      if (rec.y + ext > maxY) maxY = rec.y + ext;
    }

    let changed = false;
    for (let i = 0; i < n; i++) {
      let w = target[i];
      if (wantTaper) w *= taperFactor(s, arc[i], wantEnd ? (total - arc[i]) : -1, total);
      const rec = recs[i];
      if (before[i] > 1e-6 && Math.abs(w - before[i]) > 1e-4) {
        grow(rec);                                  // حدودِ پیش از تغییر
        scaleRecordWidth(rec, w / before[i], heelLift);
        grow(rec);                                  // حدودِ پس از تغییر
        changed = true;
      }
    }
    if (!changed || !isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /* ===================================================================
     ۱۳) صادرات
     =================================================================== */
  global.QalamAssist = {
    DEFAULTS, PEN_PRESETS, PAPER_TYPES, CURVE_GAMMA,
    createSettings, applyPenPreset, applyPaperType,
    LowPass, OneEuro2D, alphaOf,
    PressureEngine,
    WidthProfile, PathTools, SpatialGrid, PathMatcher,
    PaperModel, BallpointState, stepBallpoint,
    applyWidthScale, setContactWidth, scaleRecordWidth,
    taperFactor, finalizeStroke,
    noise1, noise2, fbm1, fbm2, hash1, hash2,
    clamp, clamp01, lerp, angleDelta,
    VERSION: '1.0.0',
  };
})(typeof window !== 'undefined' ? window : globalThis);
