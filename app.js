(() => {
  'use strict';

  /* =====================================================================
     تورِ ایمنیِ راه‌اندازی
     ---------------------------------------------------------------------
     یکی از شکایت‌ها این بود که «در Firefox پنل کالیبراسیون دیده نمی‌شود».
     هر استثنای بی‌گرفته در این فایل، اجرای بقیه‌ی کد — و در نتیجه سیم‌کشیِ
     دکمه‌ی پنل — را متوقف می‌کند و کاربر فقط «چیزی نیست» می‌بیند.
     پس هر خطای راه‌اندازی *دیده* می‌شود، در هر مرورگری.
     ===================================================================== */
  function showFatal(msg) {
    try {
      let el = document.getElementById('qalamError');
      if (!el) {
        el = document.createElement('div');
        el.id = 'qalamError';
        document.body.appendChild(el);
      }
      el.textContent = 'Qalam init error — ' + msg +
        '\nUA: ' + navigator.userAgent;
    } catch (_) {}
  }
  window.addEventListener('error', e => {
    showFatal(String(e.message) + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0));
  });

  /* =====================================================================
     قلم نی آنلاین نیستان — موتور قلم نی خوشنویسی ایرانی
     ---------------------------------------------------------------------
     • قلم‌های ایرانی: نستعلیق، کتابت، شکسته، تحریری، درشت
     • نوک تخت (چلبی) با زاویه‌ی قابل تنظیم
     • ضخامت وابسته به فشار + نازک‌شدن با سرعت
     • قلم نوری (glow)
     • شبیه‌سازی کاغذ: دفتری / گلاسه‌ی روغنی / سنتی
     ===================================================================== */

  // ---------- DOM ----------
  const paper = document.getElementById('paper');
  const paperTex = document.getElementById('paperTex');
  const ink = document.getElementById('ink');
  const guide = document.getElementById('guide');

  /* ---------------------------------------------------------------------
     لایهٔ «مرکبِ خیس» (FINAL INK PASS — مسئلهٔ ۳)
     ---------------------------------------------------------------------
     استروکِ در حالِ نوشتن روی این لایه رسم می‌شود و در پایانِ استروک یک
     بار روی بومِ مرکبِ خشک ترکیب می‌شود. دلیلش انباشتِ آلفا است:

       گامِ نمونه‌برداری ~۰٫۷px و طولِ سطحِ تماس چند پیکسل ⇒ هر پیکسل با
       ~۱۱ چندضلعیِ متوالی پوشیده می‌شود. با source-over و آلفای ۰٫۸۸،
       نتیجه 1−(1−0.88)^11 ≈ 1 است، پس داخلِ خط *همیشه* اشباع می‌شد و
       کلِ مدلِ چگالی/نشست/تجمع در رستر گم می‌شد (اندازه‌گیری‌شده: دامنهٔ
       آلفای هستهٔ خط ۵ از ۲۵۵).

     روی لایهٔ خیس، هسته با آلفای ۱ پر می‌شود؛ پرکردنِ مات idempotent است
     (اندازه‌گیری‌شده در bench/probe-composite.html) پس انباشت صفر می‌شود و
     چگالی در *رنگ* کدگذاری می‌شود.

     این لایه یک canvas مستقل و روی #ink است، پس بازخوردِ زنده هیچ هزینهٔ
     ترکیبی برای ما ندارد — مرورگر خودش لایه‌ها را روی هم می‌گذارد.
     --------------------------------------------------------------------- */
  const wet = document.createElement('canvas');
  wet.id = 'wetInk';
  /* ---- چیدمانِ لایه‌ها ----------------------------------------------
       #paperTex  z-index 1   (بافتِ کاغذ — مات)
       #ink       z-index 2   (مرکبِ خشک)
       #wetInk    z-index 2   (استروکِ جاری؛ در DOM بعد از #ink ⇒ روی آن)
       #guide     z-index 3   (پیش‌نمایشِ نوک)
     z-index باید *صریح* ست شود. اگر ست نشود مقدارش auto (یعنی ۰) است و
     این بوم زیرِ بافتِ کاغذِ مات می‌رود: استروک در حالِ نوشتن دیده نمی‌شود
     و فقط وقتی قلم برداشته می‌شود (لحظهٔ ترکیب روی #ink) ظاهر می‌شود. */
  wet.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;' +
                      'z-index:2;pointer-events:none';
  ink.parentNode.insertBefore(wet, ink.nextSibling);
  // بومِ کمکی برای «فقط ناحیهٔ هم‌پوشانی» در گذرِ تکراری.
  // یک بار و هم‌اندازهٔ بوم اصلی ساخته می‌شود (در resize) تا در هر استروک
  // تخصیصِ حافظه‌ی تازه‌ای رخ ندهد.
  const xtra = document.createElement('canvas');

  const inkCtx = ink.getContext('2d', { alpha: true });
  /* فقط لایهٔ خیس به تأخیرِ کم نیاز دارد، چون همان است که هنگام نوشتن
     دیده می‌شود. بومِ مرکبِ خشک تنها در پایانِ استروک نوشته می‌شود و
     desynchronized روی آن نه لازم است و نه برای خواندنِ پیکسل (تست‌ها و
     ذخیرهٔ PNG) مطلوب. */
  const wetCtx = wet.getContext('2d', { desynchronized: true, alpha: true });
  const xtraCtx = xtra.getContext('2d', { alpha: true, willReadFrequently: false });
  /* هدفِ رسم. در طولِ یک استروکِ زنده به لایهٔ خیس اشاره می‌کند و در
     بازترسیم/undo به بومِ خشک. همه‌ی توابعِ رسم فقط از همین استفاده
     می‌کنند، پس هیچ‌کدام لازم نیست بدانند روی کدام لایه‌اند. */
  let ctx = inkCtx;
  const ptx = paperTex.getContext('2d', { alpha: true });
  const gtx = guide.getContext('2d', { desynchronized: true, alpha: true });

  const $ = id => document.getElementById(id);
  const sizeEl = $('size'), nibRatioEl = $('nibRatio'),
        nibThickEl = $('nibThick'),
        pressureEl = $('pressure'), angleEl = $('angle'),
        smoothEl = $('smooth'), opacityEl = $('opacity'),
        nibEl = $('nib'), colorEl = $('color');
  const autoReturnEl = $('autoReturn');
  const sizeVal = $('sizeVal'), nibRatioVal = $('nibRatioVal'),
        nibThickVal = $('nibThickVal'),
        pressureVal = $('pressureVal'), angleVal = $('angleVal'),
        smoothVal = $('smoothVal'), opacityVal = $('opacityVal');
  const hud = $('hud'), status = $('status');
  const lightBtn = $('lightBtn');

  /* =====================================================================
  /* =====================================================================
     کاغذها — خواص فیزیکی
     ===================================================================== */
  const PAPER_PRESETS = {
    daftari: {
      name: 'دفتری (مشق)',
      baseColor: '#ffffff', baseColorRGB: [255, 255, 255],
      roughness: 0.12, fiberDensity: 0.15,
      fiberLength: { min: 10, max: 60 }, fiberOpacity: { min: 0.02, max: 0.07 },
      laidLines: { enabled: false },
      absorption: { rate: 0.45, feathering: 0.05, edgeSpread: 0.35, bleed: 0.0 },
      guideLines: { enabled: true, spacing: 46, marginTop: 44, marginBottom: 18,
                    lineColor: 'rgba(150,148,145,0.45)', lineWidth: 1, baseOffset: 20,
                    ascender: { enabled: false }, descender: { enabled: false } },
      sheen: 0.0, specular: 0.02,
      vignette: { inner: 0.0, outer: 0.05 },
      inkSpread: 1.0, lineWidthMult: 1.0,
      inkMixColor: [210, 205, 195],
      seed: 42,
    },
    gloss: {
      name: 'گلاسه / روغنی',
      baseColor: '#fefefe', baseColorRGB: [254, 254, 254],
      roughness: 0.04, fiberDensity: 0.02,
      fiberLength: { min: 2, max: 8 }, fiberOpacity: { min: 0.005, max: 0.02 },
      laidLines: { enabled: false },
      absorption: { rate: 0.12, feathering: 0.02, edgeSpread: 0.3, bleed: 0.0 },
      guideLines: { enabled: false },
      sheen: 1.0, specular: 0.35,
      specularHighlight: { intensity: 0.45, falloff: 1.8, fresnel: true },
      vignette: { inner: 0.02, outer: 0.06 },
      inkSpread: 0.7, lineWidthMult: 1.0,
      inkMixColor: null,
      seed: 1337,
    },
    traditional: {
      name: 'سنتی دست‌ساز',
      baseColor: '#ebe0c8', baseColorRGB: [235, 224, 200],
      roughness: 0.55, fiberDensity: 0.7,
      fiberLength: { min: 20, max: 200 }, fiberOpacity: { min: 0.04, max: 0.18 },
      laidLines: { enabled: true, spacing: 35, opacity: 0.12, width: 2, waviness: 1.2 },
      absorption: { rate: 0.95, feathering: 0.6, edgeSpread: 2.5, bleed: 0.25 },
      guideLines: { enabled: true, spacing: 72, marginTop: 52, marginBottom: 30,
                    lineColor: 'rgba(120,100,80,0.20)', lineWidth: 1.2, baseOffset: 34,
                    ascender: { enabled: true, height: 34, color: 'rgba(110,96,76,0.16)', width: 1, dash: [6, 5] },
                    descender: { enabled: true, depth: 20, color: 'rgba(135,122,100,0.22)', width: 1 } },
      sheen: 0.0, specular: 0.01,
      vignette: { inner: 0.02, outer: 0.12 },
      inkSpread: 1.2, lineWidthMult: 1.0,
      inkMixColor: [140, 110, 60],
      seed: 9001,
    },

    /* =================================================================
       تذهیب — پالت از تصویرِ مرجع *اندازه‌گیری* شده است
       -----------------------------------------------------------------
       رنگ‌ها با کوانتیزهٔ median-cut روی تصویرِ مرجع درآمده‌اند، نه با حدس:
         زمینهٔ کاغذ (میانگینِ حاشیه‌ها) …… rgb(223,200,175)  #dfc8af
         روشن‌ترین خوشه ………………………… #f4e3cb
         طلاییِ میانی ………………………………… #b48054 و #c2a586
         شنگرفِ حاشیه ……………………………… #652a19
         مرکب (تیره‌ترین خوشه) …………… #290f0e
       بافتِ رنگیِ تصویر ۱۰۰٪ در بازهٔ گرم (hue 0–60) بود؛ هیچ آبی‌ای
       نداشت، پس این تم عمداً کاملاً گرم است.
       ================================================================= */
    tazhib: {
      name: 'تذهیب',
      baseColor: '#dfc8af', baseColorRGB: [223, 200, 175],
      roughness: 0.30, fiberDensity: 0.28,
      fiberLength: { min: 12, max: 90 }, fiberOpacity: { min: 0.02, max: 0.09 },
      laidLines: { enabled: false },
      absorption: { rate: 0.7, feathering: 0.35, edgeSpread: 1.4, bleed: 0.1 },
      // خطوطِ راهنما داخلِ کادرِ مُذهَّب می‌نشیند (marginTop از خودِ کادر)
      guideLines: { enabled: true, spacing: 64, marginTop: 96, marginBottom: 84,
                    lineColor: 'rgba(120,86,48,0.16)', lineWidth: 1, baseOffset: 30,
                    ascender: { enabled: true, height: 30, color: 'rgba(140,100,56,0.12)', width: 1, dash: [5, 5] },
                    descender: { enabled: false } },
      sheen: 0.10, specular: 0.05,
      vignette: { inner: 0.01, outer: 0.10 },
      inkSpread: 1.05, lineWidthMult: 1.0,
      // رقیق‌شدنِ مرکب به‌سویِ خودِ کاغذِ کهنه، نه سفیدِ خیالی
      inkMixColor: [214, 190, 160],
      seed: 4242,
      ornament: 'tazhib',
      // رنگِ قلم و سرِ «غلیظ» — همان دو خوشهٔ تیرهٔ تصویر
      inkDefault: '#290f0e',
      inkConcentrateTo: '#000000',
      palette: {
        cream: '#f4e3cb', gold: '#b48054', goldPale: '#c2a586',
        crimson: '#652a19', ink: '#290f0e',
      },
    },

    /* =================================================================
       کاشی‌کاری — پالت از تصویرِ مرجع اندازه‌گیری شده است
       -----------------------------------------------------------------
         لاجوردِ زمینه ……………… #131558 / #141663 (hue ≈ 238، ۴۴٪ سطح)
         تیره‌ترین لاجورد ………… #090a3c
         فیروزه‌ای ………………………… #3e879f و #83abb0 (hue 187–195، ۱۸٪)
         سفیدِ کاشی ………………………… #f5f8f0
         اُخرایی/خشتی ……………… #c88b62
       نکتهٔ مهم: زمینه تیره است، پس قلم باید *روشن* بنویسد. سرِ «غلیظ»
       مرکب هم به‌جای سیاه، سفید است — وگرنه «مرکبِ بیشتر» روی کاشیِ
       لاجوردی به‌معنی محو‌شدن می‌شد.
       ================================================================= */
    kashi: {
      name: 'کاشی‌کاری',
      baseColor: '#131558', baseColorRGB: [19, 21, 88],
      roughness: 0.16, fiberDensity: 0.0,
      fiberLength: { min: 2, max: 8 }, fiberOpacity: { min: 0.004, max: 0.02 },
      laidLines: { enabled: false },
      // لعابِ کاشی جاذب نیست: مرکب روی سطح می‌نشیند
      absorption: { rate: 0.10, feathering: 0.02, edgeSpread: 0.25, bleed: 0.0 },
      guideLines: { enabled: true, spacing: 70, marginTop: 104, marginBottom: 92,
                    lineColor: 'rgba(190,220,225,0.10)', lineWidth: 1, baseOffset: 34,
                    ascender: { enabled: false }, descender: { enabled: false } },
      sheen: 0.55, specular: 0.30,
      specularHighlight: { intensity: 0.30, falloff: 2.0, fresnel: true },
      vignette: { inner: 0.02, outer: 0.16 },
      inkSpread: 0.65, lineWidthMult: 1.0,
      // رقیق‌شدن به‌سویِ لاجوردِ زمینه
      inkMixColor: [40, 44, 110],
      seed: 7311,
      ornament: 'kashi',
      inkDefault: '#f5f8f0',
      inkConcentrateTo: '#ffffff',
      /* گذرِ دوبارهٔ مرکبِ روشن روی زمینهٔ تیره باید *روشن‌تر* کند، نه
         تیره‌تر؛ پس به‌جای multiply از screen استفاده می‌شود. */
      inkRepeatBlend: 'screen',
      palette: {
        cobalt: '#131558', cobaltDeep: '#090a3c', cobaltLift: '#272a65',
        turquoise: '#3e879f', turquoisePale: '#83abb0',
        white: '#f5f8f0', ochre: '#c88b62', cream: '#e8deb3',
      },
    },

    /* =================================================================
       زمینهٔ سفیدِ آینه
       -----------------------------------------------------------------
       پنجرهٔ آینه باید «نتیجهٔ تمیز» را نشان دهد: بدونِ عکسِ مرجع، بدونِ
       بافت، بدونِ خطِ راهنما. رقیق‌شدنِ مرکب هم به‌سویِ همین سفید است.
       ================================================================= */
    blank: {
      name: 'سفیدِ ساده',
      baseColor: '#ffffff', baseColorRGB: [255, 255, 255],
      roughness: 0.0, fiberDensity: 0.0,
      fiberLength: { min: 2, max: 8 }, fiberOpacity: { min: 0.004, max: 0.02 },
      laidLines: { enabled: false },
      absorption: { rate: 0.25, feathering: 0.04, edgeSpread: 0.35, bleed: 0.0 },
      guideLines: { enabled: false },
      sheen: 0.0, specular: 0.0,
      vignette: { inner: 0.0, outer: 0.0 },
      inkSpread: 0.85, lineWidthMult: 1.0,
      inkMixColor: [255, 255, 255],
      seed: 11,
      ornament: null,
      inkDefault: null,
      inkConcentrateTo: '#000000',
      inkRepeatBlend: 'multiply',
    },

    /* =================================================================
       عکسِ دلخواهِ کاربر
       -----------------------------------------------------------------
       مقادیرِ این preset هنگام بارگذاریِ عکس *از خودِ عکس* اندازه‌گیری و
       پر می‌شوند (loadPaperImage): رنگِ زمینه، رنگِ رقیق‌شدنِ مرکب، رنگِ
       پیش‌فرضِ قلم، سرِ غلیظ، و آمیزهٔ گذرِ تکرار. پس «رنگِ قلم مثلِ عکس
       دربیاید» به‌جای تنظیمِ دستی، از دادهٔ خودِ عکس می‌آید.
       ================================================================= */
    custom: {
      name: 'عکس دلخواه',
      baseColor: '#e8e4dc', baseColorRGB: [232, 228, 220],
      roughness: 0.0, fiberDensity: 0.0,
      fiberLength: { min: 2, max: 8 }, fiberOpacity: { min: 0.004, max: 0.02 },
      laidLines: { enabled: false },
      absorption: { rate: 0.45, feathering: 0.1, edgeSpread: 0.6, bleed: 0.05 },
      guideLines: { enabled: false },
      sheen: 0.0, specular: 0.02,
      vignette: { inner: 0.0, outer: 0.06 },
      inkSpread: 1.0, lineWidthMult: 1.0,
      inkMixColor: [232, 228, 220],
      seed: 5150,
      ornament: null,
      inkDefault: '#241a12',
      inkConcentrateTo: '#000000',
      inkRepeatBlend: 'multiply',
    },
  };

  /* =====================================================================
     ابزار ریاضی
     ===================================================================== */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) { let s = 0; for (let i = 0; i < 6; i++) s += rng(); return s - 3; }

  function hexToRgb(h) {
    const n = parseInt(String(h).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    const r = Math.max(0, Math.min(255, c[0] | 0)),
          g = Math.max(0, Math.min(255, c[1] | 0)),
          b = Math.max(0, Math.min(255, c[2] | 0));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  // چگالی مرکب یک پاره‌خط (0..1) — از میانگین چگالی دو سر؛ چگالی مستقل از هندسه
  function pointDensity(st) {
    return clamp(st.dens !== undefined ? st.dens : (st.pl ?? 1), 0, 1);
  }
  function segDensity(a, b) {
    return (pointDensity(a) + pointDensity(b)) / 2;
  }
  /* «تُنِ مرکب» = نشستِ مرکب، نگاشته به ۰..۱
     ---------------------------------------------------------------------
     این چیزی است که تیرگیِ *دیده‌شدهٔ* خط را می‌سازد. عمداً از inkAmt
     (deposition) می‌آید و نه از فشار: فشار سطحِ تماس را عوض می‌کند
     (هندسه)، و سرعت/درنگ/جریان مقدارِ مرکب را (تُن). پس «فشار = شفافیت»
     همچنان شکسته می‌مانَد.                                              */
  function pointTone(st) {
    const dep = st.inkAmt == null ? 1 : st.inkAmt;
    return clamp01((dep - cfg.inkToneDepMin) /
                   Math.max(1e-6, cfg.inkToneDepMax - cfg.inkToneDepMin));
  }
  function segTone(a, b) { return (pointTone(a) + pointTone(b)) * 0.5; }
  function mixHex(a, b, t) { // t=0 → a | t=1 → b
    const ca = hexToRgb(a), cb = hexToRgb(b);
    const r = Math.max(0, Math.min(255, Math.round(lerp(ca[0], cb[0], t)))),
          g = Math.max(0, Math.min(255, Math.round(lerp(ca[1], cb[1], t)))),
          bl = Math.max(0, Math.min(255, Math.round(lerp(ca[2], cb[2], t))));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  /* =====================================================================
     پُلِ موتور قلم نی (qalam-engine.js)
     ---------------------------------------------------------------------
     تنظیماتِ موتور از همان اسلایدرهای موجود ساخته می‌شود تا هیچ کنترلی
     از UI حذف یا معنایش عوض نشود؛ فقط پارامترهای تازه اضافه شده‌اند.
     ===================================================================== */
  const QE = window.QalamEngine;
  if (!QE) throw new Error('qalam-engine.js بارگذاری نشده است');

  // پارامترهای تازه‌ای که UI اسلایدر ندارد ولی باید configurable باشند
  // (پنلِ کالیبراسیون این‌ها را زنده تغییر می‌دهد)
  const TUNE = {
    pressureExponent: QE.DEFAULTS.pressureExponent,
    pressureSmoothing: QE.DEFAULTS.pressureSmoothing,
    pressureDeadzone: QE.DEFAULTS.pressureDeadzone,
    minContactRatio: QE.DEFAULTS.minContactRatio,
    heelLift: QE.DEFAULTS.heelLift,
    spacingFactor: QE.DEFAULTS.spacingFactor,
    minSpacing: QE.DEFAULTS.minSpacing,
    maxSpacing: QE.DEFAULTS.maxSpacing,
    maxSamplesPerEvent: QE.DEFAULTS.maxSamplesPerEvent,
    maxSamplesPerFrame: QE.DEFAULTS.maxSamplesPerFrame,
    velocityInkInfluence: QE.DEFAULTS.velocityInkInfluence,
    velocityWidthInfluence: QE.DEFAULTS.velocityWidthInfluence,
    velocityRef: QE.DEFAULTS.velocityRef,
    inkDensityFloor: QE.DEFAULTS.inkDensityFloor,
    inkPressureDensity: QE.DEFAULTS.inkPressureDensity,
    dwellPooling: QE.DEFAULTS.dwellPooling,
    startInkBoost: QE.DEFAULTS.startInkBoost,
    startInkLength: QE.DEFAULTS.startInkLength,
    tailLength: QE.DEFAULTS.tailLength,
    tailMinRatio: QE.DEFAULTS.tailMinRatio,
    tiltInfluence: QE.DEFAULTS.tiltInfluence,
    tiltContactInfluence: QE.DEFAULTS.tiltContactInfluence,
    pushPullInfluence: QE.DEFAULTS.pushPullInfluence,
    nibCornerRound: QE.DEFAULTS.nibCornerRound,
    positionSmoothing: QE.DEFAULTS.positionSmoothing,
    tiltThicknessInfluence: QE.DEFAULTS.tiltThicknessInfluence,
    leanRateLimit: QE.DEFAULTS.leanRateLimit,
    pushFlowPenalty: QE.DEFAULTS.pushFlowPenalty,
    pushEdgeRoughness: QE.DEFAULTS.pushEdgeRoughness,
    pushThreshold: QE.DEFAULTS.pushThreshold,
    paperAbsorption: QE.DEFAULTS.paperAbsorption,
    reservoirCapacity: QE.DEFAULTS.reservoirCapacity,
    reservoirRefill: QE.DEFAULTS.reservoirRefill,
    pxPerMm: QE.DEFAULTS.pxPerMm,
    velocityRef: QE.DEFAULTS.velocityRef,
    inkCoreAlpha: QE.DEFAULTS.inkCoreAlpha,
    inkFringeAlpha: QE.DEFAULTS.inkFringeAlpha,
    inkFringeRatio: QE.DEFAULTS.inkFringeRatio,
    inkFringeBase: QE.DEFAULTS.inkFringeBase,
    inkFringeMax: QE.DEFAULTS.inkFringeMax,
    inkFringeAbsorption: QE.DEFAULTS.inkFringeAbsorption,
    curvaturePoolMs: QE.DEFAULTS.curvaturePoolMs,
    velocitySpikeLimit: QE.DEFAULTS.velocitySpikeLimit,
    maxWidthDropPerPx: QE.DEFAULTS.maxWidthDropPerPx,
    pressureOutlierDrop: QE.DEFAULTS.pressureOutlierDrop,
    startInkDwellMs: QE.DEFAULTS.startInkDwellMs,
    // ---- لایهٔ خیس و پروفایلِ چگالیِ مرکب (FINAL INK PASS) ----
    inkWetLayer: QE.DEFAULTS.inkWetLayer,
    inkFringeBands: QE.DEFAULTS.inkFringeBands,
    inkPaperShowThrough: QE.DEFAULTS.inkPaperShowThrough,
    inkRepeatGain: QE.DEFAULTS.inkRepeatGain,
    inkToneDepMin: QE.DEFAULTS.inkToneDepMin,
    inkToneDepMax: QE.DEFAULTS.inkToneDepMax,
    inkDilutePale: QE.DEFAULTS.inkDilutePale,
    inkConcentrate: QE.DEFAULTS.inkConcentrate,
    inkDiluteDark: QE.DEFAULTS.inkDiluteDark,
    inkEdgeDilute: QE.DEFAULTS.inkEdgeDilute,
    // ---- پنجرهٔ آماده‌سازیِ فیلترِ فشار (رفعِ مسئلهٔ ۱) ----
    primingSamples: QE.DEFAULTS.primingSamples,
    // اگر > 0 باشد، پهنای نوک از میلی‌متر گرفته می‌شود و اسلایدرهای
    // «پهنای قلم × نسبت نوک» نادیده گرفته می‌شوند (برای آزمونِ پهنا).
    nibWidthMm: 0,
    /* اگر > 0 باشد، پهنای نوک و ضخامتِ تیغه *مستقل* و بر حسبِ پیکسل
       تعیین می‌شوند. لازم است چون maxThickness() ضخامت را به پهنا گره
       می‌زند و روی ۸px سقف می‌گذارد؛ در نتیجه «قلمِ کلفت» با نسبتِ
       ضخیم/نازکِ ۳–۴ (که در خطِ فارسیِ واقعی دیده می‌شود) دست‌نیافتنی بود. */
    nibWidthPx: 0,
    nibThicknessPx: 0,
  };

  const cfg = QE.createConfig(TUNE);

  /* =====================================================================
     ابزارهای نقاشی
     ---------------------------------------------------------------------
     هر ابزار فقط یک *پیکربندی* است، نه موتورِ جدا. همه از همان زنجیره
     می‌گذرند: فشار → سطحِ تماس → مدلِ مرکب → لایهٔ خیس. پس رفعِ «فشار از
     نخستین تماس»، پروفایلِ چگالی، تجمعِ درنگ و گذرِ تکرار برای همهٔ
     ابزارها برقرار است.

     تفاوت‌ها روی چند محور تنظیم می‌شوند:
       nib            شکلِ سطحِ تماس (تخت = قلمِ خوشنویسی، گرد = نقاشی)
       minContactRatio چقدر از نوک در فشارِ صفر روی کاغذ است
                       (ماژیک: زیاد ⇒ پهنای تقریباً ثابت؛
                        قلم‌مو: کم ⇒ پهنا کاملاً تابعِ فشار)
       inkFringe*     نرمیِ لبه
       velocityInkInfluence  اثرِ سرعت بر مقدارِ مرکب
       inkRepeatGain  چقدر گذرِ دوباره تیره‌تر می‌کند (آبرنگ: زیاد)
       opacity        شفافیتِ پایه
     ===================================================================== */
  const TOOLS = {
    reed: {
      name: 'قلم نی', nib: 'flat',
      controls: { nibRatio: 2.0, nibThick: 1.0, opacity: 100, smooth: 0.55 },
      cfg: {},
    },
    pencil: {
      name: 'مداد', nib: 'round',
      controls: { nibRatio: 2.2, nibThick: 0.5, opacity: 78, smooth: 0.35 },
      cfg: {
        minContactRatio: 0.22,
        // دانه‌دانگیِ گرافیت: لبهٔ کمی بازتر ولی باریک
        inkFringeBase: 0.35, inkFringeRatio: 0.30, inkFringeMax: 1.2,
        inkFringeAlpha: 0.55,
        velocityInkInfluence: 0.55,
        dwellPooling: 0.12,
        inkDilutePale: 0.42, inkConcentrate: 0.10,
        inkRepeatGain: 0.30,
      },
    },
    brush: {
      name: 'قلم‌مو', nib: 'round',
      controls: { nibRatio: 3.2, nibThick: 1.0, opacity: 92, smooth: 0.60 },
      cfg: {
        // پهنا کاملاً تابعِ فشار
        minContactRatio: 0.06,
        inkFringeBase: 0.85, inkFringeRatio: 0.75, inkFringeMax: 4.5,
        inkFringeAlpha: 0.50,
        velocityInkInfluence: 0.35,
        dwellPooling: 0.55,
        inkRepeatGain: 0.40,
      },
    },
    marker: {
      name: 'ماژیک', nib: 'round',
      controls: { nibRatio: 3.0, nibThick: 1.4, opacity: 88, smooth: 0.45 },
      cfg: {
        // پهنای تقریباً ثابت — نوکِ نمدیِ ماژیک زیرِ فشار پهن نمی‌شود
        minContactRatio: 0.72,
        inkFringeBase: 0.25, inkFringeRatio: 0.15, inkFringeMax: 0.9,
        inkFringeAlpha: 0.35,
        velocityInkInfluence: 0.10,
        dwellPooling: 0.10,
        inkDilutePale: 0.12, inkConcentrate: 0.06,
        inkRepeatGain: 0.22,
      },
    },
    water: {
      name: 'آبرنگ', nib: 'round',
      controls: { nibRatio: 4.2, nibThick: 1.0, opacity: 42, smooth: 0.7 },
      cfg: {
        minContactRatio: 0.10,
        inkFringeBase: 1.6, inkFringeRatio: 1.1, inkFringeMax: 7.0,
        inkFringeAlpha: 0.62, inkFringeAbsorption: 1.8,
        paperAbsorption: 0.85,
        velocityInkInfluence: 0.65,
        dwellPooling: 0.85,
        inkDilutePale: 0.55, inkConcentrate: 0.16,
        // مشخصهٔ آبرنگ: لایه روی لایه به‌سرعت سیر می‌شود
        inkRepeatGain: 0.60,
      },
    },
    /* ---- خودکارِ ساچمه‌ای -------------------------------------------
       این ابزار هم مثل بقیه «فقط یک Configuration» است. تفاوتش این است
       که *بقیهٔ* پارامترهایش زنده از پنلِ «دستیارِ هوشمند» می‌آید
       (QalamAssistUI.config)، چون کاربر باید بتواند پهنای پایه بر حسبِ
       میلی‌متر، جریانِ جوهر و جذبِ کاغذ را در لحظه عوض کند. */
    ballpoint: {
      name: 'خودکار (ساچمه‌ای)', nib: 'round',
      controls: { nibRatio: 2.0, nibThick: 1.0, opacity: 100, smooth: 0.45 },
      cfg: {
        minContactRatio: 0.58,
        velocityInkInfluence: 0.30,
        velocityWidthInfluence: 0.06,
        dwellPooling: 0.35,
        inkDilutePale: 0.26, inkConcentrate: 0.22,
        inkRepeatGain: 0.22,
      },
      // روشن‌کردنِ این ابزار خودکارِ واقعی را هم روشن می‌کند
      assist: { real_ballpoint_enabled: true },
    },
  };
  let currentTool = 'reed';
  let toolCfg = {};

  function setTool(id) {
    const T2 = TOOLS[id];
    if (!T2) return;
    currentTool = id;
    toolCfg = T2.cfg || {};
    if (nibEl) {
      nibEl.value = T2.nib;
      nibEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    for (const k in (T2.controls || {})) {
      const el = $(k);
      if (!el) continue;
      el.value = String(T2.controls[k]);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    for (const k in TOOLS) {
      const b = $('tool_' + k);
      if (b) b.classList.toggle('active', k === id);
    }
    /* ابزار می‌تواند کلیدهای لایهٔ دستیار را هم ست کند. «خودکار» آن را
       روشن و بقیهٔ ابزارها آن را خاموش می‌کنند، تا انتخابِ ابزار و رفتارِ
       جوهر هرگز از هم جدا نیفتند. */
    if (AUI) {
      const want = !!(T2.assist && T2.assist.real_ballpoint_enabled);
      if (AUI.settings.real_ballpoint_enabled !== want) {
        AUI.settings.real_ballpoint_enabled = want;
        AUI.saveSettings();
        AUI.syncPanel();
      }
    }
    syncConfig();
    if (status) status.textContent = 'ابزار: ' + T2.name;
  }
  window.__qalamTools = { TOOLS, setTool, get current() { return currentTool; } };
  // سیم‌کشیِ دکمه‌ها پس از ساختِ DOM انجام می‌شود (پایینِ همین فایل)

  /* لایه‌ی انتزاعِ قلم — تنها نقطه‌ی تماس با PointerEvent مرورگر.
     موتور فقط StylusState می‌بیند، پس تفاوت‌های Chrome/Firefox/Safari
     همه در stylus.js حل می‌شود و هیچ browser sniffing لازم نیست. */
  const QS = window.QalamStylus;
  if (!QS) throw new Error('stylus.js بارگذاری نشده است');
  const normalizer = new QS.StylusNormalizer();
  const SUP = QS.SUPPORT;

  /* ---------------------------------------------------------------------
     لایهٔ «دستیارِ هوشمند خوشنویسی» + «خودکارِ ساچمه‌ایِ واقعی»
     ---------------------------------------------------------------------
     یک لایهٔ *افزودنی* است، نه جانشین. اگر فایل‌هایش بارگذاری نشده باشند
     AUI برابر null می‌شود و برنامه دقیقاً مثل قبل کار می‌کند؛ و اگر
     بارگذاری شده باشند ولی کاربر فعالشان نکرده باشد، قلاب‌ها فوراً
     برمی‌گردند و هیچ مقداری را عوض نمی‌کنند (بخش ۵۲ و ۵۳ درخواست).
     `assistIO` یک شیءِ قابلِ استفادهٔ مجدد است تا در مسیرِ داغِ نمونه‌ها
     هیچ تخصیصِ حافظه‌ای رخ ندهد — همان اصلی که کلِ موتور بر آن است.
     --------------------------------------------------------------------- */
  const AUI = window.QalamAssistUI || null;
  const assistIO = {
    x: 0, y: 0, tMs: 0, isFirst: false,
    pressure: 0, pressureValid: false, pressureSupported: false,
    pressureFallback: false,
    speed: 0, dir: null, dwellMs: 0, arcLen: 0, dtMs: 8, lean: 0,
    contact: null, ink: null,
    nibWidth: 8, minContactRatio: 0.09, velocityRef: 0.42, pxPerMm: 96 / 25.4,
    toneMin: 0.35, toneMax: 1.30,
    gap: false,
  };

  // شیءِ قابلِ استفاده‌ی مجدد برای انتقالِ جهت‌گیری به موتور
  const orient = { lean: 0, leanDir: 0, leanValid: false, twist: 0, twistValid: false };
  let leanValidNow = false, twistValidNow = false;
  let prevLean = 0;
  let lastSampleT = 0;

  const resampler = new QE.Resampler(cfg);
  const inputBuf = new QE.InputBuffer(8192);
  const contact = new QE.ContactState();
  const inkState = new QE.InkState();
  const hull = new QE.Hull();
  const fpA = new Float32Array(8);
  const fpB = new Float32Array(8);
  // نسخه‌های بزرگ‌شده برای گذرِ حاشیه‌ی مرکب
  const fpAe = new Float32Array(8);
  const fpBe = new Float32Array(8);

  // آمارِ زنده برای پنلِ اشکال‌زدایی و بنچمارک
  const stats = {
    fps: 0, frameMs: 0,
    eventsPerSec: 0, samplesPerSec: 0,
    events: 0, samples: 0, segments: 0,
    bufferPeak: 0, overflow: 0, clamped: 0,
    rawPressure: 0, normPressure: 0, filtPressure: 0, mappedPressure: 0,
    contactW: 0, contactT: 0, contactOffset: 0, apparent: 0,
    velocity: 0, dirDeg: 0, nibDeg: 0, ink: 0, density: 0, dwell: 0,
    hasTilt: false, hasTwist: false, pressureSupported: false,
    tiltX: 0, tiltY: 0,
  };
  window.__qalamStats = stats;
  window.__qalamTune = TUNE;
  window.__qalamCfg = cfg;

  // بازسازیِ تنظیماتِ موتور از UI — در هر تغییرِ اسلایدر صدا زده می‌شود
  function syncConfig() {
    // پهنای کاملِ نوکِ چلبی: همان معنایی که پروژه از «پهنای قلم × نسبت نوک»
    // داشت، حفظ می‌شود تا خروجیِ بصری با تنظیماتِ قبلیِ کاربر نپرد.
    // ضریبِ اسلایدرِ «ضخامت تیغه» مثل نسخه‌ی قبلی کلِ نوک را کمی بزرگ
    // می‌کند تا حسِ تنظیماتِ قبلیِ کاربر عوض نشود.
    const thickScale = 1 + (nibThickMult() - 1) * 0.5;
    cfg.nibWidth = TUNE.nibWidthPx > 0
      ? Math.max(0.4, TUNE.nibWidthPx)
      : (TUNE.nibWidthMm > 0
          ? Math.max(0.4, TUNE.nibWidthMm * TUNE.pxPerMm)
          : Math.max(0.4, penSize() * nibRatio() * thickScale));
    cfg.nibThickness = TUNE.nibThicknessPx > 0
      ? Math.max(0.1, TUNE.nibThicknessPx) : maxThickness();
    cfg.nibAngle = Number(angleEl.value);
    cfg.angleMode = $('motionMode').classList.contains('active') ? 'motion'
                  : ($('dynamicMode').classList.contains('active') ? 'dynamic' : 'fixed');
    cfg.positionSmoothing = Number(smoothEl.value);
    // «حساسیت فشار» روی *منحنیِ کالیبراسیون* اثر می‌گذارد، نه روی هندسه.
    // نمای منحنی در stylus.js نگه داشته می‌شود تا ماندگار (persistent) باشد.
    const sens = clamp(Number(pressureEl.value), 0.1, 2);
    normalizer.calibration.params.curveExponent =
      clamp(TUNE.pressureExponent / sens, 0.25, 3.5);
    for (const k in TUNE) cfg[k] = TUNE[k];
    // لایهٔ ابزار *بعد از* TUNE اعمال می‌شود تا بر آن اولویت داشته باشد
    for (const k in toolCfg) cfg[k] = toolCfg[k];
    cfg.pressureExponent = normalizer.calibration.params.curveExponent;
    cfg.pressureSmoothing = normalizer.calibration.params.smoothing;
    cfg.pressureDeadzone = normalizer.calibration.params.deadzone;
    normalizer.calibration.params.outlierDrop = TUNE.pressureOutlierDrop;
    // پنجرهٔ آماده‌سازیِ فیلترِ فشار — یک منبعِ حقیقت، دو جا استفاده می‌شود
    normalizer.calibration.params.primeSamples =
      clamp(TUNE.primingSamples | 0, 1, 5);
    cfg.primingSamples = normalizer.calibration.params.primeSamples;
    cfg.inkSaturation = 1;
    /* لایهٔ دستیار، *آخرین* لایه است: پیکربندیِ نوکِ ساچمه‌ای بر TUNE و بر
       ابزار اولویت دارد. با خاموش‌بودنِ خودکار هیچ کلیدی دست نمی‌خورد. */
    if (AUI) AUI.config(cfg);
  }
  window.__qalamSyncConfig = syncConfig;


  /* =====================================================================
     رندر کاغذ (یک‌بار روی paperTex)
     ===================================================================== */
  let W = 1, H = 1, dpr = 1;
  let paperRect = null;
  let paperType = 'daftari';
  // عکسِ پس‌زمینهٔ کاربر (ImageBitmap یا HTMLImageElement)
  let customImage = null;
  let customImageName = '';
  function bgVeilAmount() {
    const el = $('bgVeil');
    const v = el ? Number(el.value) : 0.35;
    return isFinite(v) ? clamp(v, 0, 0.95) : 0.35;
  }

  /* ---------------------------------------------------------------------
     هندسهٔ *واقعیِ* رسمِ تصویرِ پس‌زمینه/مرجع روی کاغذ — یک منبعِ حقیقت
     ---------------------------------------------------------------------
     هم renderPaper از این استفاده می‌کند و هم لایهٔ «دستیارِ هوشمند» برای
     نگاشتِ مختصاتِ تحلیلِ مرجع. اگر دو نسخهٔ جدا از این حساب داشتیم، هر
     تغییرِ کوچکِ چیدمان یکی را از دیگری جدا می‌کرد و تطبیقِ مسیر بی‌صدا
     چند پیکسل می‌لنگید — خطایی که در خروجی دیده می‌شود ولی در کد نه.
     --------------------------------------------------------------------- */
  function imageFit() {
    if (!customImage) return null;
    const iw = customImage.width, ih = customImage.height;
    if (!(iw > 0 && ih > 0)) return null;
    // پوشش (cover): تمامِ صفحه پر می‌شود و نسبتِ ابعاد حفظ می‌ماند
    const s = Math.max(W / iw, H / ih);
    const dw = iw * s, dh = ih * s;
    return { iw: iw, ih: ih, s: s, dw: dw, dh: dh,
             ox: (W - dw) / 2, oy: (H - dh) / 2 };
  }

  function renderPaper() {
    ptx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ptx.clearRect(0, 0, W, H);
    const P = PAPER_PRESETS[paperType];
    /* بذر از خودِ preset می‌آید و ثابت است. این «قطعی‌بودن» شرطِ لازمِ
       خروجیِ بزرگ‌نمایی‌شده است: هنگام صدور، کاغذ در مقیاسِ بالاتر از نو
       رندر می‌شود و باید *همان* بافت دربیاید، نه بافتی تازه. */
    const rng = mulberry32(P.seed || 42);
    const [br, bg, bb] = P.baseColorRGB;

    ptx.fillStyle = P.baseColor;
    ptx.fillRect(0, 0, W, H);

    /* ---- عکسِ دلخواهِ کاربر ------------------------------------------
       چون ترنسفورم از قبل با dpr مقیاس شده، رسمِ عکس در مختصاتِ منطقی
       خودبه‌خود با تمامِ توانِ بومِ دستگاه انجام می‌شود؛ پس در صدورِ ۳×
       عکس هم با جزئیاتِ ۳× کشیده می‌شود (تا حدی که خودِ فایل دارد) و
       نه بزرگ‌نماییِ پیکسل. */
    if (paperType === 'custom' && customImage) {
      const fit = imageFit();
      if (fit) {
        ptx.imageSmoothingEnabled = true;
        ptx.imageSmoothingQuality = 'high';
        ptx.drawImage(customImage, fit.ox, fit.oy, fit.dw, fit.dh);
      }
      // پردهٔ محو: خط باید روی عکس خوانا بمانَد
      const veil = clamp(bgVeilAmount(), 0, 0.95);
      if (veil > 0.001) {
        ptx.fillStyle = `rgba(${br},${bg},${bb},${veil})`;
        ptx.fillRect(0, 0, W, H);
      }
      if (P.vignette.outer > 0) {
        const vg2 = ptx.createRadialGradient(
          W / 2, H / 2, Math.min(W, H) * 0.3,
          W / 2, H / 2, Math.max(W, H) * 0.7);
        vg2.addColorStop(0, 'rgba(0,0,0,0)');
        vg2.addColorStop(1, `rgba(0,0,0,${P.vignette.outer})`);
        ptx.fillStyle = vg2;
        ptx.fillRect(0, 0, W, H);
      }
      return;   // بافتِ کاغذِ مصنوعی روی عکس معنا ندارد
    }

    // --- نویز ریز سطح ---
    const cellSize = Math.max(2, Math.round(Math.min(W, H) / (8 + P.roughness * 24)));
    const noiseW = Math.ceil(W / cellSize), noiseH = Math.ceil(H / cellSize);
    const noiseAmp = P.roughness * 18;
    const nc = document.createElement('canvas');
    nc.width = noiseW; nc.height = noiseH;
    const nctx = nc.getContext('2d');
    const nd = nctx.createImageData(noiseW, noiseH);
    for (let i = 0; i < noiseW * noiseH; i++) {
      const n = gauss(rng) * noiseAmp;
      const j = i * 4;
      nd.data[j] = clamp(br + n, 0, 255);
      nd.data[j + 1] = clamp(bg + n, 0, 255);
      nd.data[j + 2] = clamp(bb + n, 0, 255);
      nd.data[j + 3] = 255;
    }
    nctx.putImageData(nd, 0, 0);
    ptx.imageSmoothingEnabled = true;
    ptx.drawImage(nc, 0, 0, noiseW, noiseH, 0, 0, W, H);

    // --- الیاف کاغذ ---
    if (P.fiberDensity > 0.01) {
      const fcount = Math.floor(W * H * 0.00035 * P.fiberDensity);
      ptx.lineWidth = 1; ptx.lineCap = 'round';
      for (let i = 0; i < fcount; i++) {
        const x = rng() * W, y = rng() * H, a = rng() * Math.PI * 2;
        const len = P.fiberLength.min + rng() * (P.fiberLength.max - P.fiberLength.min);
        const op = P.fiberOpacity.min + rng() * (P.fiberOpacity.max - P.fiberOpacity.min);
        const gr = 100 + rng() * 60;
        ptx.strokeStyle = `rgba(${gr},${gr - 10},${gr - 20},${op})`;
        ptx.beginPath();
        ptx.moveTo(x, y);
        ptx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ptx.stroke();
      }
    }

    // --- نقشِ تزئینیِ کاغذ (تذهیب / کاشی‌کاری) ---
    if (P.ornament) drawOrnament(P, rng);

    // --- خطوط قالب قلم‌سازی (laid lines) ---
    if (P.laidLines.enabled) {
      /* همه‌ی مختصات این‌جا در پیکسلِ *منطقی* (CSS) است.
         نسخه‌ی قبلی روی ترنسفورمِ dpr، دوباره در dpr ضرب می‌کرد؛ یعنی
         روی نمایشگرِ dpr=2 فاصله‌ی خطوط و حاشیه‌ها دو برابر می‌شد و در
         خروجیِ بزرگ‌نمایی‌شده کاملاً به‌هم می‌ریخت. */
      const sp = P.laidLines.spacing;
      const startY = (rng() * sp) % sp;
      ptx.strokeStyle = `rgba(80,70,55,${P.laidLines.opacity})`;
      ptx.lineWidth = P.laidLines.width;
      ptx.lineCap = 'round';
      for (let y = startY; y < H; y += sp) {
        const wave = P.laidLines.waviness;
        ptx.beginPath();
        ptx.moveTo(0, y);
        for (let x = 0; x < W; x += 20) {
          ptx.lineTo(x, y + Math.sin(x * 0.01 + rng() * 0.5) * wave);
        }
        ptx.lineTo(W, y);
        ptx.stroke();
      }
    }

    // --- خطوط راهنمای مشق (متناسب با فارسی) ---
    // هر ردیف: خطِ زمینه (کرسی) + خط‌چینِ ارتفاعِ حروفِ بلند (ا/ل/ط/ک)
    // + خطِ نقطه‌چینِ فرود (ج/چ/گ/ن/ی). مبنای چیدمان زیر خط زمینه است.
    if (P.guideLines.enabled) {
      const gl = P.guideLines;
      // مختصات در پیکسلِ منطقی — بدونِ ضربِ دوباره در dpr (توضیح بالا)
      const rowH = gl.spacing;
      const mT = gl.marginTop, mB = gl.marginBottom;
      const asc = gl.ascender || {};
      const dsc = gl.descender || {};
      for (let y0 = mT; y0 < H - mB; y0 += rowH) {
        // خط زمینه (کرسی) — جایی که نوکِ قلم می‌نشیند
        const yK = y0 + gl.baseOffset;
        ptx.strokeStyle = gl.lineColor;
        ptx.lineWidth = gl.lineWidth;
        ptx.setLineDash([]);
        ptx.beginPath(); ptx.moveTo(8, yK); ptx.lineTo(W - 12, yK); ptx.stroke();

        // خط‌چینِ ارتفاع حروفِ بلند: ا ، ل ، ط ، ظ ، ک
        if (asc.enabled) {
          ptx.strokeStyle = asc.color || 'rgba(140,130,110,0.14)';
          ptx.lineWidth = asc.width || gl.lineWidth;
          ptx.setLineDash(asc.dash || [6, 5]);
          const yA = yK - asc.height;
          ptx.beginPath(); ptx.moveTo(8, yA); ptx.lineTo(W - 12, yA); ptx.stroke();
          ptx.setLineDash([]);
        }

        // خطِ فرودِ حروفِ جهنده: ج ، چ ، گ ، ن ، ی (پایین‌تر از زمینه)
        if (dsc.enabled) {
          ptx.strokeStyle = dsc.color || 'rgba(150,140,120,0.2)';
          ptx.lineWidth = dsc.width || gl.lineWidth;
          ptx.setLineDash([2, 4]);
          const yD = yK + dsc.depth;
          ptx.beginPath(); ptx.moveTo(8, yD); ptx.lineTo(W - 12, yD); ptx.stroke();
          ptx.setLineDash([]);
        }
      }
    }

    // --- براقیت کاغذ گلاسه ---
    if (P.sheen > 0) {
      const g = ptx.createLinearGradient(0, 0, W * 0.6, H * 0.5);
      g.addColorStop(0, `rgba(255,255,255,${0.18 * P.sheen})`);
      g.addColorStop(0.4, `rgba(255,255,255,${0.04 * P.sheen})`);
      g.addColorStop(1, `rgba(140,130,110,${0.03 * P.sheen})`);
      ptx.fillStyle = g;
      ptx.fillRect(0, 0, W, H);

      const g2 = ptx.createLinearGradient(0, H * 0.85, 0, H);
      g2.addColorStop(0, 'rgba(255,255,255,0)');
      g2.addColorStop(1, `rgba(255,255,255,${0.12 * P.sheen})`);
      ptx.fillStyle = g2;
      ptx.fillRect(0, 0, W, H);
    }

    // --- وینیت ملایم ---
    if (P.vignette.outer > 0) {
      const vg = ptx.createRadialGradient(
        W / 2, H / 2, Math.min(W, H) * 0.3,
        W / 2, H / 2, Math.max(W, H) * 0.7
      );
      vg.addColorStop(0, `rgba(0,0,0,${P.vignette.inner})`);
      vg.addColorStop(1, `rgba(60,45,25,${P.vignette.outer})`);
      ptx.fillStyle = vg;
      ptx.fillRect(0, 0, W, H);
    }
  }

  /* =====================================================================
     نقشِ تزئینیِ کاغذ — تذهیب و کاشی‌کاری
     ---------------------------------------------------------------------
     همه‌ی مختصات در پیکسلِ *منطقی* است و همه‌ی تصادف‌ها از rng بذردارِ
     preset می‌آید؛ پس نقش قطعی است و در صدورِ بزرگ‌نمایی‌شده مو‌به‌مو
     بازتولید می‌شود.

     پالت‌ها حدس نیستند: با کوانتیزهٔ median-cut از تصاویرِ مرجع استخراج
     شده‌اند (اعدادش در PAPER_PRESETS نوشته شده).

     چرا نقش «رویِ کلِ سطح» پخش نمی‌شود؟ چون این کاغذِ *نوشتن* است. در
     تذهیبِ واقعی و در کتیبه‌های کاشی هم متن در یک کادرِ آرام می‌نشیند و
     تزئین دورِ آن است.
     ===================================================================== */
  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  // ستارهٔ n-پر (پایهٔ گرهِ خَتایی/گیریه)
  function starPath(c, cx, cy, points, rOut, rIn, rot) {
    c.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = rot + i * Math.PI / points;
      const r = (i & 1) ? rIn : rOut;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  }

  function drawOrnament(P, rng) {
    if (P.ornament === 'tazhib') return ornamentTazhib(P, rng);
    if (P.ornament === 'kashi') return ornamentKashi(P, rng);
  }

  /* ---------------------------------------------------------------------
     تذهیب: کادرِ مُذهَّب با شنگرف، و متنِ آرام در میان
     --------------------------------------------------------------------- */
  function ornamentTazhib(P, rng) {
    const c = ptx;
    const pal = P.palette;
    const m = clamp(Math.min(W, H) * 0.075, 20, 62);      // حاشیهٔ بیرونی
    const band = clamp(Math.min(W, H) * 0.030, 9, 22);    // پهنای نوارِ طلا
    const iw = W - 2 * m, ih = H - 2 * m;
    if (iw < 60 || ih < 60) return;

    c.save();
    c.lineJoin = 'round';

    // ---- حاشیهٔ بیرونِ کادر: کمی سیرتر از متن (کاغذِ کهنه) ----
    c.fillStyle = 'rgba(150,110,66,0.10)';
    c.fillRect(0, 0, W, H);
    // ---- میدانِ متن: یک لایهٔ کِرِمِ روشن ⇒ خط خواناتر ----
    c.fillStyle = pal.cream;
    c.globalAlpha = 0.55;
    c.fillRect(m + band + 4, m + band + 4,
               iw - 2 * (band + 4), ih - 2 * (band + 4));
    c.globalAlpha = 1;

    // ---- نوارِ طلا با سایه‌روشنِ عرضی (برجستگیِ طلاکاری) ----
    const g = c.createLinearGradient(0, m, 0, m + band);
    g.addColorStop(0, pal.goldPale);
    g.addColorStop(0.45, pal.gold);
    g.addColorStop(1, '#8d5f38');
    c.strokeStyle = g;
    c.lineWidth = band;
    c.strokeRect(m + band / 2, m + band / 2, iw - band, ih - band);

    // ---- دو خطِ شنگرفِ نازک، بیرون و درونِ نوار ----
    c.strokeStyle = pal.crimson;
    c.lineWidth = Math.max(1, band * 0.14);
    c.strokeRect(m, m, iw, ih);
    c.strokeRect(m + band, m + band, iw - 2 * band, ih - 2 * band);

    // ---- زنجیرهٔ اسلیمی درونِ نوار: کمانه‌های متناوب ----
    // یک نقشِ ساده و *منظم*؛ نویزِ تصادفی نیست
    const step = clamp(band * 1.35, 10, 26);
    c.strokeStyle = 'rgba(250,236,214,0.55)';
    c.lineWidth = Math.max(0.7, band * 0.10);
    const r0 = step * 0.36;
    const midT = m + band / 2;                 // مرکزِ نوارِ بالا
    const midB = m + ih - band / 2;            // مرکزِ نوارِ پایین
    const midL = m + band / 2;                 // مرکزِ نوارِ چپ
    const midR = m + iw - band / 2;            // مرکزِ نوارِ راست
    const scallop = (cx, cy, a0, a1) => {
      c.beginPath(); c.arc(cx, cy, r0, a0, a1); c.stroke();
    };
    let k = 0;
    for (let x = m + step / 2; x < m + iw - step / 2; x += step, k++) {
      const up = (k % 2) === 0;
      // نوارِ بالا و پایین — کمانه‌ها یک‌درمیان بالا/پایین باز می‌شوند
      scallop(x, midT, up ? Math.PI : 0, up ? 0 : Math.PI);
      scallop(x, midB, up ? 0 : Math.PI, up ? Math.PI : 0);
    }
    k = 0;
    for (let y = m + step / 2; y < m + ih - step / 2; y += step, k++) {
      const up = (k % 2) === 0;
      // نوارِ چپ و راست — همان الگو، چرخیده ۹۰ درجه
      scallop(midL, y, up ? Math.PI / 2 : -Math.PI / 2,
                       up ? -Math.PI / 2 : Math.PI / 2);
      scallop(midR, y, up ? -Math.PI / 2 : Math.PI / 2,
                       up ? Math.PI / 2 : -Math.PI / 2);
    }

    // ---- ترنجِ گوشه‌ها ----
    const rosette = clamp(band * 1.5, 12, 34);
    for (const [cx, cy] of [[m + band / 2, m + band / 2],
                            [m + iw - band / 2, m + band / 2],
                            [m + band / 2, m + ih - band / 2],
                            [m + iw - band / 2, m + ih - band / 2]]) {
      c.fillStyle = pal.crimson;
      starPath(c, cx, cy, 8, rosette * 0.5, rosette * 0.22, Math.PI / 8);
      c.fill();
      c.fillStyle = pal.gold;
      starPath(c, cx, cy, 8, rosette * 0.30, rosette * 0.13, 0);
      c.fill();
      c.fillStyle = pal.cream;
      c.beginPath(); c.arc(cx, cy, rosette * 0.10, 0, Math.PI * 2); c.fill();
    }

    // ---- لکه‌های کهنگیِ ملایمِ کاغذ (قطعی، از rng بذردار) ----
    const stains = 14;
    for (let i = 0; i < stains; i++) {
      const x = rng() * W, y = rng() * H;
      const r = 18 + rng() * 70;
      const gg = c.createRadialGradient(x, y, 0, x, y, r);
      gg.addColorStop(0, 'rgba(146,104,58,0.055)');
      gg.addColorStop(1, 'rgba(146,104,58,0)');
      c.fillStyle = gg;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /* ---------------------------------------------------------------------
     کاشی‌کاری: گرهِ ستاره‌ای روی لاجورد + کتیبهٔ میانی
     --------------------------------------------------------------------- */
  function ornamentKashi(P, rng) {
    const c = ptx;
    const pal = P.palette;
    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';

    /* ---- شبکهٔ گره -------------------------------------------------
       نکتهٔ رنگ‌سنجی: فیروزه باید *پوشا* باشد. اندازه‌گیری‌شده — فیروزهٔ
       #3e879f با آلفای ۰٫۵۵ روی لاجورد، آمیزه‌ای می‌دهد که فامش ۲۱۱° است،
       یعنی هنوز «آبی» است نه فیروزه‌ای؛ سهمِ فامِ فیروزه‌ای در تصویرِ
       رندرشده ۰٫۲٪ درآمد در برابر ۱۸٫۴٪ تصویرِ مرجع. با آلفای ~۰٫۹۵ فام
       به ۱۹۵° می‌رسد و واقعاً فیروزه‌ای دیده می‌شود — که با لعابِ واقعیِ
       کاشی هم سازگارتر است (لعاب پوشاست، نه لایهٔ رقیق). */
    const cell = clamp(Math.min(W, H) / 5.5, 48, 132);
    const cols = Math.ceil(W / cell) + 2, rows = Math.ceil(H / (cell * 0.86)) + 2;
    const rOut = cell * 0.44, rIn = rOut * 0.40;

    // بندهای مورب (لوزیِ زمینه) — فیروزه‌ای کم‌رنگ‌تر، برای بافت
    c.strokeStyle = 'rgba(62,135,159,0.45)';
    c.lineWidth = Math.max(1, cell * 0.030);
    for (let i = -rows; i < cols + rows; i++) {
      c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell + H, H); c.stroke();
      c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell - H, H); c.stroke();
    }

    for (let r = -1; r < rows; r++) {
      for (let q = -1; q < cols; q++) {
        const cx = q * cell + (r % 2 ? cell * 0.5 : 0);
        const cy = r * cell * 0.86;
        // هشت‌ضلعیِ زمینه: لاجوردِ روشن‌تر
        starPath(c, cx, cy, 8, rOut, rOut * 0.92, Math.PI / 8);
        c.fillStyle = pal.cobaltLift;
        c.fill();
        c.strokeStyle = 'rgba(245,248,240,0.35)';
        c.lineWidth = Math.max(0.8, cell * 0.014);
        c.stroke();
        // ستارهٔ هشت‌پرِ فیروزه‌ای — پوشا
        starPath(c, cx, cy, 8, rOut * 0.86, rIn, 0);
        c.fillStyle = pal.turquoise;
        c.globalAlpha = 0.95;
        c.fill();
        c.globalAlpha = 1;
        c.strokeStyle = 'rgba(245,248,240,0.55)';
        c.lineWidth = Math.max(0.7, cell * 0.012);
        c.stroke();
        // مغزیِ سفیدِ کاشی
        c.fillStyle = pal.white;
        c.globalAlpha = 0.85;
        c.beginPath(); c.arc(cx, cy, rOut * 0.15, 0, Math.PI * 2); c.fill();
        c.globalAlpha = 1;
        // خطِ موییِ اُخرایی
        c.strokeStyle = 'rgba(200,139,98,0.55)';
        c.lineWidth = Math.max(0.6, cell * 0.010);
        starPath(c, cx, cy, 8, rOut * 0.55, rOut * 0.26, Math.PI / 8);
        c.stroke();
      }
    }

    /* ---- کتیبهٔ میانی ----------------------------------------------
       پنل باید متن را خوانا کند ولی نقش را نکُشد. نسخهٔ اول با لاجوردِ
       سیرِ ۰٫۷۲ روی نقش می‌نشست و میانگینِ مرکز را به (21,25,74) می‌بُرد،
       در حالی که مرکزِ تصویرِ مرجع (66,68,126) است — یعنی روشن‌تر. پس
       پنل با لاجوردِ *روشن‌تر* و آلفای کمتر کشیده می‌شود تا نقش از زیرش
       دیده شود و روشناییِ مرکز به مرجع نزدیک بمانَد. */
    const m = clamp(Math.min(W, H) * 0.085, 22, 74);
    const rad = clamp(Math.min(W, H) * 0.045, 10, 34);
    if (W - 2 * m > 80 && H - 2 * m > 70) {
      roundRectPath(c, m, m, W - 2 * m, H - 2 * m, rad);
      c.fillStyle = 'rgba(46,52,120,0.55)';
      c.fill();
      // قابِ دوگانه: فیروزه‌ای بیرون، اُخرایی درون
      c.strokeStyle = 'rgba(62,135,159,0.95)';
      c.lineWidth = Math.max(1.6, Math.min(W, H) * 0.007);
      c.stroke();
      roundRectPath(c, m + 7, m + 7, W - 2 * m - 14, H - 2 * m - 14, Math.max(4, rad - 7));
      c.strokeStyle = 'rgba(200,139,98,0.75)';
      c.lineWidth = Math.max(0.9, Math.min(W, H) * 0.003);
      c.stroke();
      // ترنجِ فیروزه‌ای روی چهار گوشهٔ کتیبه — فیروزه در مرکز هم حاضر بمانَد
      const rr = clamp(Math.min(W, H) * 0.030, 9, 26);
      for (const [tx, ty] of [[m, m], [W - m, m], [m, H - m], [W - m, H - m]]) {
        starPath(c, tx, ty, 8, rr, rr * 0.42, Math.PI / 8);
        c.fillStyle = pal.turquoise;
        c.fill();
        c.strokeStyle = 'rgba(245,248,240,0.7)';
        c.lineWidth = Math.max(0.7, rr * 0.10);
        c.stroke();
        c.fillStyle = pal.white;
        c.beginPath(); c.arc(tx, ty, rr * 0.16, 0, Math.PI * 2); c.fill();
      }
      // برقِ لعاب روی پنل
      const gl2 = c.createLinearGradient(0, m, W * 0.7, m + (H - 2 * m) * 0.8);
      gl2.addColorStop(0, 'rgba(245,248,240,0.12)');
      gl2.addColorStop(0.5, 'rgba(245,248,240,0.03)');
      gl2.addColorStop(1, 'rgba(245,248,240,0)');
      roundRectPath(c, m, m, W - 2 * m, H - 2 * m, rad);
      c.fillStyle = gl2;
      c.fill();
    }

    // ---- ترکِ ریزِ لعاب (قطعی) ----
    c.strokeStyle = 'rgba(245,248,240,0.05)';
    c.lineWidth = 0.7;
    for (let i = 0; i < 26; i++) {
      let x = rng() * W, y = rng() * H;
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rng() - 0.5) * 46; y += (rng() - 0.5) * 46;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    c.restore();
  }

  /* =====================================================================
     پس‌زمینهٔ عکسِ دلخواه
     ---------------------------------------------------------------------
     رنگِ قلم و رفتارِ مرکب از *خودِ عکس* اندازه‌گیری می‌شود، نه با حدس:

       • رنگِ میانگین  ⇒ مقصدِ «رقیق‌شدنِ» مرکب (inkMixColor) و رنگِ پردهٔ محو
       • روشناییِ میانگین ⇒ تصمیمِ «قلم تیره بنویسد یا روشن»
       • خوشهٔ صدکِ ۵ ⇒ نامزدِ مرکبِ تیره
       • خوشهٔ صدکِ ۹۵ ⇒ نامزدِ مرکبِ روشن

     همان قاعده‌ای که برای تمِ کاشی لازم شد این‌جا هم اعمال می‌شود: روی
     پس‌زمینهٔ تیره، «مرکبِ بیشتر» یعنی پوشاننده‌تر، پس سرِ غلیظ سفید و
     آمیزهٔ گذرِ تکرار screen می‌شود.

     فایل با blob: خوانده می‌شود، پس بوم آلوده (tainted) نمی‌شود و
     صدورِ PNG سالم می‌مانَد. عکس از نشانیِ بیرونی پذیرفته نمی‌شود که
     همین تضمین از بین نرود.
     ===================================================================== */
  function measureImagePalette(img) {
    const n = 72;
    const iw = img.width, ih = img.height;
    const sc = Math.min(n / iw, n / ih, 1);
    const sw = Math.max(1, Math.round(iw * sc)), sh = Math.max(1, Math.round(ih * sc));
    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    c2.imageSmoothingEnabled = true;
    c2.drawImage(img, 0, 0, sw, sh);
    const d = c2.getImageData(0, 0, sw, sh).data;

    const px = [];
    let sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      sr += r; sg += g; sb += b;
      px.push([0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b]);
    }
    const cnt = px.length || 1;
    const mean = [Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)];
    const meanLuma = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
    px.sort((a, b) => a[0] - b[0]);
    const avgOf = (i0, i1) => {
      let r = 0, g = 0, b = 0, m = 0;
      for (let i = Math.max(0, i0); i < Math.min(px.length, i1); i++) {
        r += px[i][1]; g += px[i][2]; b += px[i][3]; m++;
      }
      return m ? [Math.round(r / m), Math.round(g / m), Math.round(b / m)] : mean;
    };
    const q = Math.max(1, Math.round(px.length * 0.05));
    return {
      mean: mean,
      meanLuma: meanLuma,
      dark: avgOf(0, q),
      light: avgOf(px.length - q, px.length),
      size: [iw, ih],
    };
  }

  function applyImagePalette(pal) {
    const P = PAPER_PRESETS.custom;
    const lumaOf = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

    /* پردهٔ محو، روشناییِ *دیده‌شده* را به‌سویِ رنگِ میانگین می‌کشد؛ پس
       تصمیمِ «قلمِ تیره یا روشن» باید بر مبنای همان روشناییِ نهایی باشد. */
    const veil = bgVeilAmount();
    const effLuma = lerp(pal.meanLuma, lumaOf(pal.mean), veil);

    P.baseColorRGB = pal.mean.slice();
    P.baseColor = rgbToHex(pal.mean);
    P.inkMixColor = pal.mean.slice();

    if (effLuma >= 128) {
      // پس‌زمینهٔ روشن ⇒ مرکبِ تیره
      let ink = pal.dark.slice();
      // اگر تیره‌ترین خوشه هم روشن است، تیره‌اش کن تا کنتراست بمانَد
      if (lumaOf(ink) > 96) ink = hexToRgb(mixHex(rgbToHex(ink), '#1a120c', 0.65));
      P.inkDefault = rgbToHex(ink);
      P.inkConcentrateTo = '#000000';
      P.inkRepeatBlend = 'multiply';
    } else {
      // پس‌زمینهٔ تیره ⇒ مرکبِ روشن (همان قاعدهٔ تمِ کاشی)
      let ink = pal.light.slice();
      if (lumaOf(ink) < 168) ink = hexToRgb(mixHex(rgbToHex(ink), '#fbfaf6', 0.7));
      P.inkDefault = rgbToHex(ink);
      P.inkConcentrateTo = '#ffffff';
      P.inkRepeatBlend = 'screen';
    }
    return P;
  }

  async function decodeImageFile(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file); } catch (_) { /* افتادن به مسیرِ دوم */ }
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('decode failed'));
        im.src = url;
      });
    } finally {
      // نشانی پس از decode لازم نیست؛ خودِ تصویر در حافظه است
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }

  async function loadPaperImage(file) {
    /* ★ گاردِ Monitor 2 (بخش ۳۲ و ۸۶): پنجرهٔ آینه هرگز تصویرِ مرجع
       نمی‌گیرد. این‌جا صریح رد می‌شود تا اگر کسی mirror.html را دستی باز
       کرد و عکسی رویش انداخت، قانون نشکند. */
    if (window.__QALAM_MIRROR) {
      status.textContent = 'پنجرهٔ آینه فقط خروجیِ نهایی را نشان می‌دهد — ' +
                           'تصویرِ مرجع فقط روی پنجرهٔ اصلی است.';
      return null;
    }
    if (!file || !/^image\//.test(file.type || '')) {
      status.textContent = 'فایلِ انتخاب‌شده عکس نیست.';
      return null;
    }
    let img;
    try {
      img = await decodeImageFile(file);
    } catch (e) {
      status.textContent = 'این عکس خوانده نشد: ' + (e && e.message ? e.message : e);
      return null;
    }
    customImage = img;
    customImageName = file.name || 'image';
    const pal = measureImagePalette(img);
    applyImagePalette(pal);
    // انتخابِ رنگِ قلمِ کاربر را دوباره آزاد می‌کنیم: رنگِ این عکس باید
    // اعمال شود، چون خودِ کاربر عکس را تازه انتخاب کرده است
    userPickedColor = false;
    setPaper('custom');
    status.textContent = 'پس‌زمینه: ' + customImageName + ' (' +
      pal.size[0] + '×' + pal.size[1] + ') — رنگِ قلم از خودِ عکس: ' +
      PAPER_PRESETS.custom.inkDefault;
    /* تحلیلِ مرجع فقط *همین‌جا* (هنگام import) اجرا می‌شود، به‌صورتِ async و
       قطعه‌قطعه. در مسیرِ داغِ قلم هیچ کارِ بینایی ماشین انجام نمی‌شود
       (بخش ۴۱ و ۴۲ درخواست). */
    if (AUI) AUI.setReference(customImage);
    return pal;
  }

  function resize() {
    const r = paper.getBoundingClientRect();    paperRect = r;
    W = r.width; H = r.height;
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    for (const c of [paperTex, ink, wet, guide]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    }    // بومِ ماسک هم‌اندازهٔ بوم اصلی — یک بار، نه در هر استروک
    xtra.width = Math.round(W * dpr);
    xtra.height = Math.round(H * dpr);
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ptx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderPaper();
    redraw();
    /* لایهٔ دستیار: نگاشتِ مرجع تابعِ W/H است، پس با هر تغییرِ اندازه از نو
       ساخته می‌شود. خودِ *تحلیلِ* مرجع بی‌اعتبار نمی‌شود (کش دست‌نخورده). */
    if (AUI) AUI.invalidate();
  }
  new ResizeObserver(resize).observe(paper);

  /* =====================================================================
     ترکیبِ لایهٔ خیس روی مرکبِ خشک
     ---------------------------------------------------------------------
     سه گذر، همه روی *مستطیلِ کثیف* و همه با drawImage (یعنی مستقل از
     تعدادِ نمونه‌های استروک):

       ۱) گذرِ عادی: source-over با آلفای inkPaperShowThrough
          (<۱ تا بافتِ کاغذ زیرِ مرکب کمی دیده شود)
       ۲) ساختِ ماسکِ هم‌پوشانی: کپیِ لایهٔ خیس ∩ مرکبِ *پیشین*
          (destination-in) — یعنی «کجا روی مرکبِ قبلی نوشتیم»
       ۳) گذرِ تکرار: multiply با آلفای inkRepeatGain فقط روی همان ماسک

     چرا این‌طور و نه فقط multiply؟ چون اندازه‌گیری (probe-composite.html)
     نشان داد multiply روی مرکبِ تیره rgb(40,30,20) در گذرِ دوم به
     rgb(9,6,3) می‌رسد؛ یعنی تقریباً سیاهِ دیجیتالی — همان چیزی که
     نمی‌خواهیم. با ماسک و آلفای کران‌دار، گذرِ دوم به‌اندازهٔ کنترل‌شده
     تیره‌تر می‌شود و بعد اشباع می‌شود، مثلِ مرکبِ واقعی.
     ===================================================================== */
  function deviceRect(bb, pad) {
    const p = pad == null ? 2 : pad;
    const x0 = Math.max(0, Math.floor((bb.x - p) * dpr));
    const y0 = Math.max(0, Math.floor((bb.y - p) * dpr));
    const x1 = Math.min(ink.width, Math.ceil((bb.x + bb.w + p) * dpr));
    const y1 = Math.min(ink.height, Math.ceil((bb.y + bb.h + p) * dpr));
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* مستطیلی که مرزهایش دقیقاً روی پیکسلِ *دستگاه* می‌افتد.
     لازم است چون هر مرزِ کسری، پیکسلِ نیمه‌پوشیده می‌سازد و پاک‌کردن/کلیپ
     روی آن، درزِ مویی به‌جا می‌گذارد. */
  function snapRect(bb, pad) {
    const q = 1 / dpr;
    const p = pad || 0;
    const x = Math.floor((bb.x - p) / q) * q;
    const y = Math.floor((bb.y - p) / q) * q;
    const w = Math.ceil((bb.x + bb.w + p) / q) * q - x;
    const h = Math.ceil((bb.y + bb.h + p) / q) * q - y;
    return { x: x, y: y, w: w, h: h };
  }

  function clearWet(bb, padDev) {
    wetCtx.save();
    wetCtx.setTransform(1, 0, 0, 1, 0, 0);
    if (bb) {
      const r = deviceRect(bb, padDev === undefined ? 3 : padDev);
      if (r) wetCtx.clearRect(r.x, r.y, r.w, r.h);
    } else {
      wetCtx.clearRect(0, 0, wet.width, wet.height);
    }
    wetCtx.restore();
  }

  /* کجای این کادر می‌تواند با مرکبِ *قبلاً ترکیب‌شده* هم‌پوشان باشد؟
     ---------------------------------------------------------------------
     خروجی:
       null   ⇒ هیچ هم‌پوشانی نیست، پس گذرِ تکرار قطعاً بی‌اثر است
                (ماسک کاملاً شفاف می‌شد) و دو drawImage حذف می‌شود
       rect   ⇒ کوچک‌ترین مستطیلی که همهٔ هم‌پوشانی‌ها را در بر می‌گیرد؛
                گذرِ تکرار فقط روی همان تکه اجرا می‌شود، نه کلِ کادرِ استروک
     در هر دو حالت نتیجهٔ پیکسلی مو‌به‌مو همان چیزی است که گذرِ کامل می‌داد. */
  const _ovRect = { x: 0, y: 0, w: 0, h: 0 };
  function overlapRect(bb, upto) {
    if (!bb) return bb;                     // نامعلوم ⇒ محافظه‌کارانه: همه‌جا
    const n = Math.min(upto === undefined ? strokes.length : upto, strokes.length);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const ob = strokes[i] && strokes[i].bb;
      if (!ob) return bb;                   // کادر نامعلوم ⇒ محافظه‌کارانه
      const ix0 = Math.max(bb.x, ob.x), iy0 = Math.max(bb.y, ob.y);
      const ix1 = Math.min(bb.x + bb.w, ob.x + ob.w);
      const iy1 = Math.min(bb.y + bb.h, ob.y + ob.h);
      if (ix1 <= ix0 || iy1 <= iy0) continue;
      if (ix0 < x0) x0 = ix0;
      if (iy0 < y0) y0 = iy0;
      if (ix1 > x1) x1 = ix1;
      if (iy1 > y1) y1 = iy1;
    }
    if (x1 <= x0) return null;
    _ovRect.x = x0; _ovRect.y = y0; _ovRect.w = x1 - x0; _ovRect.h = y1 - y0;
    return _ovRect;
  }

  /* ترکیبِ ناحیه‌ی bb از لایهٔ خیس روی مرکبِ خشک، و پاک‌کردنِ لایهٔ خیس.
     maskBB: ناحیه‌ای که می‌تواند با مرکبِ پیشین هم‌پوشان باشد
             null = هیچ هم‌پوشانی ⇒ گذرِ تکرار لازم نیست
             undefined = نامعلوم ⇒ کلِ ناحیه */
  function flushWet(bb, maskBB) {
    const r = bb ? deviceRect(bb, 3)
                 : { x: 0, y: 0, w: wet.width, h: wet.height };
    if (!r) { clearWet(null); return; }

    // ---- ۲) ماسکِ هم‌پوشانی با مرکبِ پیشین ----
    const gain = clamp(cfg.inkRepeatGain, 0, 1);
    const mr = (gain > 0.004 && maskBB !== null)
      ? (maskBB === undefined ? r : deviceRect(maskBB, 3))
      : null;
    if (mr) {
      xtraCtx.setTransform(1, 0, 0, 1, 0, 0);
      xtraCtx.globalCompositeOperation = 'source-over';
      xtraCtx.globalAlpha = 1;
      xtraCtx.clearRect(mr.x, mr.y, mr.w, mr.h);
      xtraCtx.drawImage(wet, mr.x, mr.y, mr.w, mr.h, mr.x, mr.y, mr.w, mr.h);
      xtraCtx.globalCompositeOperation = 'destination-in';
      xtraCtx.drawImage(ink, mr.x, mr.y, mr.w, mr.h, mr.x, mr.y, mr.w, mr.h);
      xtraCtx.globalCompositeOperation = 'source-over';
    }

    inkCtx.save();
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    // ---- ۱) گذرِ عادی ----
    inkCtx.globalCompositeOperation = 'source-over';
    inkCtx.globalAlpha = clamp(cfg.inkPaperShowThrough, 0.05, 1);
    inkCtx.drawImage(wet, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    // ---- ۳) گذرِ تکرار (فقط روی هم‌پوشانی) ----
    if (mr) {
      // نوعِ آمیزهٔ «گذرِ تکرار» وابسته به کاغذ است (توضیح در preset کاشی)
      inkCtx.globalCompositeOperation =
        PAPER_PRESETS[paperType].inkRepeatBlend || 'multiply';
      inkCtx.globalAlpha = gain;
      inkCtx.drawImage(xtra, mr.x, mr.y, mr.w, mr.h, mr.x, mr.y, mr.w, mr.h);
    }
    inkCtx.globalCompositeOperation = 'source-over';
    inkCtx.globalAlpha = 1;
    inkCtx.restore();

    /* لایهٔ خیس *کاملاً* پاک می‌شود، نه فقط ناحیه. اگر ذره‌ای مرکب بیرون
       از bb مانده باشد، در ترکیبِ استروکِ بعدی ظاهر می‌شود و «رسمِ زنده»
       با «بازترسیم» فرق می‌کند. هزینه: یک clearRect در هر استروک. */
    clearWet(null);
  }

  /* یک استروکِ کامل را با معناشناسیِ «اجتماع» رسم می‌کند: ابتدا روی لایهٔ
     خیس، بعد یک بار ترکیب. مسیرِ بازترسیم/undo/شبکهٔ آزمون از همین
     استفاده می‌کند تا ظاهرِ «رسمِ زنده» و «بازترسیم» مو‌به‌مو یکی بمانَد. */
  function drawViaWet(bb, fn, maskBB) {
    if (!cfg.inkWetLayer) { fn(); return; }
    const prev = ctx;
    clearWet(bb);
    ctx = wetCtx;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.shadowBlur = 0;
    try { fn(); } finally {
      ctx.restore();
      ctx = prev;
      flushWet(bb, maskBB);
    }
  }

  /* =====================================================================
     حالت نوشتن
     ===================================================================== */
  let drawing = false, pointerId = null, downStamp = 0;
  // last = آخرین نمونه‌ی *بازنمونه‌شده* (نه آخرین رویدادِ خام)
  let last = null;
  // lastPress فقط برای HUD/اشکال‌زدایی
  let lastPress = 0.5;
  let strokes = [], currentStroke = [], history = [];
  let lightPen = false;
  let erasing = false, lastErase = null, removedStack = [];
  // دکمه‌ی کنارِ قلم (XP-Pen) — نگه‌داشتنش زاویه‌ی نوک را عمودی می‌کند
  let barrelMode = true, barrelHeld = false;
  // آیا کاربر خودش رنگِ قلم را عوض کرده؟ اگر آری، تغییرِ کاغذ رنگش را
  // بازنویسی نمی‌کند.
  let userPickedColor = false;
  let suppressColorFlag = false;
  if (colorEl) {
    colorEl.addEventListener('input', () => {
      if (!suppressColorFlag) userPickedColor = true;
    });
  }
  const ERASER_R = 12;
  let lastUiPaint = 0;

  function pos(e) {
    const r = paperRect || paper.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function ui() {
    sizeVal.textContent = sizeEl.value;
    nibRatioVal.textContent = Number(nibRatioEl.value).toFixed(1);
    nibThickVal.textContent = Number(nibThickEl.value).toFixed(2);
    pressureVal.textContent = Number(pressureEl.value).toFixed(2);
    angleVal.textContent = angleEl.value + '°';
    smoothVal.textContent = Number(smoothEl.value).toFixed(2);
    opacityVal.textContent = opacityEl.value + '%';
    const bv = $('bgVeilVal'), bvEl = $('bgVeil');
    if (bv && bvEl) bv.textContent = Math.round(Number(bvEl.value) * 100) + '%';
  }
  document.querySelectorAll('input,select').forEach(e => e.addEventListener('input', ui));
  ui();

  /* =====================================================================
     زاویه‌ی نوک قلم
     ---------------------------------------------------------------------
     منطقِ زاویه به qalam-engine.js منتقل شد (QalamEngine.nibAngleRad):
       • حالتِ «ثابت»    → زاویه‌ی اسلایدر، با اصلاحِ کوچکی از tilt
       • حالتِ «جهت حرکت» → زاویه‌ی مسیر + زاویه‌ی اسلایدر
       • حالتِ «داینامیک» → twist، سپس tilt، سپس جهتِ حرکت به‌عنوان fallback
       • دکمه‌ی بارلِ قلم → نوکِ عمودی (۹۰°)

     یک اشکالِ نسخه‌ی قبلی هم این‌جا برطاف شد: در حالتِ داینامیک از
     e.azimuthAngle استفاده می‌شد و فقط `typeof/​isFinite` بررسی می‌شد؛
     ولی طبق [PE3] برای سخت‌افزارِ بدونِ گزارشِ زاویه، azimuthAngle
     الزاماً 0 است و وقتی قلم کاملاً عمود است (altitudeAngle = π/2) هم
     الزاماً 0 است. پس «صفر» به‌معنیِ «قلم به سمتِ ساعتِ ۳» تفسیر می‌شد و
     زاویه‌ی نوک بی‌دلیل عوض می‌شد. اکنون tiltX/tiltY (و نبودشان) صریحاً
     تشخیص داده می‌شود.
     ===================================================================== */

  /* =====================================================================
     ضخامت — فشار + سرعت (نازک‌شدن با فشار کم، کلفت‌شدن با فشار زیاد)
     ===================================================================== */
  function penSize() { return Number(sizeEl.value); }
  function nibRatio() { return Number(nibRatioEl.value); }
  function nibThickMult() { return clamp(Number(nibThickEl.value), 0.2, 8); }
  function inkAlpha() { return Number(opacityEl.value) / 100; }

  // a = نصف پهنای چلبی (فی‌البداهه از تنظیمات فعلی)
  function halfNibWidth() { return penSize() * nibRatio() * 0.5; }
  // ضخامتِ خودِ تیغه‌ی قلم — همیشه باریک و ناچیز، در هر سایزی؛ اصلِ نوشتن را
  // «طولِ» نوک (a) انجام می‌دهد و تیغه لبه‌ی تیز دارد. فقط فشار، طولِ تماس را
  // کم‌زیاد می‌کند؛ ضخامتِ تیغه‌ای به خودیِ خود کمتر از یک خطِ مو باقی می‌ماند.
  function maxThickness() {
    const base = Math.max(0.4, Math.min(1.1, halfNibWidth() * 0.11));
    // ضریبِ تنظیمِ کاربر «ضخامت تیغه»: 1 => رفتارِ فعلی (خطِ مو)، بیشتر => کلفت‌تر
    return clamp(base * nibThickMult(), 0.3, 8);
  }

  /* =====================================================================
     فشار (PHASE 4 / PHASE 17)
     ---------------------------------------------------------------------
     نکته‌ی مطابقتِ استاندارد [W3C Pointer Events L3 §4.1]:
       «برای سخت‌افزار و پلتفرمی که فشار را پشتیبانی نمی‌کند، مقدار
        pressure باید در حالتِ فعالِ دکمه 0.5 و در غیرِ آن 0 باشد.»
     پس عددِ 0.5 روی ماوس یک «فشارِ واقعی» نیست، بلکه «فشارِ نامعلوم» است و
     نباید مثل نصفِ فشارِ قلم تفسیر شود.
     ===================================================================== */
  // جانشینِ فشار برای ماوس: حرکتِ آهسته = فشارِ بیشتر (رفتارِ قبلیِ پروژه،
  // فقط با یکایِ px/ms به‌جای px/frame)
  function mousePressureFallback(speedPxPerMs) {
    const vn = clamp(speedPxPerMs / 0.85, 0, 1);
    return clamp(1 - vn * 0.85, 0.08, 1);
  }

  /* =====================================================================
     هندسه‌ی سطحِ تماسِ نوک (PHASE 6 / 7 / 8)
     ---------------------------------------------------------------------
     دیگر «دایره با شعاعِ متغیر» نداریم. هر نمونه به یک چندضلعیِ سطحِ تماس
     تبدیل می‌شود: مستطیلِ (گردگوشه‌ی) لبه‌ی بُرشِ نوک با
        طول    = cw (contact width)
        ضخامت  = ct (contact thickness)
        و مرکزی جابه‌جاشده به اندازه‌ی co روی محورِ نوک (بلندشدنِ پاشنه)
     رکوردهای قدیمی (بدون cw) از مسیرِ سازگاری رسم می‌شوند تا undo و
     استروک‌های پیشین سالم بمانند.
     ===================================================================== */
  function footprintOf(out, st, grow) {
    const angR = st.ang * Math.PI / 180;
    if (st.uh != null && st.nw != null) {
      // مسیرِ اصلی: پروفایلِ تماس در مختصاتِ محلیِ نوک
      return QE.footprintFromProfile(out, st.x, st.y, angR, st.nw,
                                     st.uh, st.ut, st.ct, grow);
    }
    if (grow > 0 && st.cw != null) {
      return QE.footprint(out, st.x, st.y, angR, st.cw + 2 * grow,
                          st.ct + 2 * grow, st.co || 0);
    }
    if (st.cw != null) {
      // رکوردهای فاز ۱ (پهنا + جابه‌جایی)
      return QE.footprint(out, st.x, st.y, angR, st.cw, st.ct, st.co || 0);
    }
    // ---- مسیرِ سازگاری با رکوردهای نسخه‌ی قبلی ----
    const pl = clamp(st.pl == null ? 1 : st.pl, 0.01, 1);
    const thick = nibThickMult();
    const thickScale = 1 + (thick - 1) * 0.5;
    const fullW = st.r * nibRatio() * pl * thickScale;
    const fullT = st.t * clamp(thick, 0.35, 2.2) * 2;
    return QE.footprint(out, st.x, st.y, angR, fullW, fullT, 0);
  }

  // شعاعِ گردیِ گوشه‌های سطحِ تماس (زیرِ ربع پیکسل، رسم نمی‌شود)
  function contactRound(st) {
    const t = st.ct != null ? st.ct : (st.t || 0.5) * 2;
    return t * 0.5 * clamp(cfg.nibCornerRound, 0, 1);
  }

  /* ---------------------------------------------------------------------
     پوشِ محدبِ حرکتِ نوک بین دو نمونه
     ---------------------------------------------------------------------
     [Knuth, METAFONT] خطِ حاصل از یک قلمِ چندضلعیِ محدب، پوشِ حرکتِ آن
     چندضلعی روی مسیر است (جمعِ مینکوفسکی). برای گامِ کوچکِ بازنمونه‌شده،
     پوشِ محدبِ دو footprint متوالی تقریبِ دقیقی از آن است.

     تفاوت با نسخه‌ی قبلی (fillRibbon):
       • قبل: 1 fill برای پوسته + 4 fill برای کلاهکِ گرد = ۵ فراخوانیِ رسم
       • حالا: 1 fill (و در نوکِ ضخیم، یک stroke برای گردکردنِ لبه)
       • هیچ آرایه/شیئی هم ساخته نمی‌شود (Float32Array از پیش‌ساخته)
     --------------------------------------------------------------------- */
  function sweepPath(c, a, b) {
    const n = hull.build(a, b);
    const hx = hull.outX, hy = hull.outY;
    c.beginPath();
    c.moveTo(hx[0], hy[0]);
    for (let i = 1; i < n; i++) c.lineTo(hx[i], hy[i]);
    c.closePath();
    return n;
  }

  /* یک پاره‌خط را با پروفایلِ چگالی می‌کشد.
     P = INK_PLAN — هسته + نوارهای لبه، ساختهٔ buildInkPlan */
  /* ---------------------------------------------------------------------
     چرا نوارهای لبه با 'destination-over' کشیده می‌شوند
     ---------------------------------------------------------------------
     اگر لبه را با source-over بکشیم، لبهٔ *هر پاره‌خط* دورِ تمامِ محیطِ
     خودش — از جمله دو سرِ آن که داخلِ بدنهٔ خط‌اند — رسم می‌شود. چون گامِ
     نمونه‌برداری منظم است، این لبه‌های داخلی به‌صورتِ نوارهای تیرهٔ متناوب
     (شانه‌ای) دیده می‌شوند — اندازه‌گیری‌شده و بدتر از حالتِ تخت.

     با 'destination-over' لبه فقط جایی دیده می‌شود که مرکبِ قبلی نیست،
     یعنی دقیقاً روی مرزِ بیرونیِ واقعیِ خط، و هیچ انباشتِ آلفایی هم رخ
     نمی‌دهد. ترتیبِ داخل→بیرون لازم است (توضیح در buildInkPlan).
     --------------------------------------------------------------------- */
  function fillSweep(c, recA, recB, P) {
    // ---- گذرهای لبه: از داخل به بیرون ----
    if (P.n > 0) {
      c.globalCompositeOperation = 'destination-over';
      for (let i = 0; i < P.n; i++) {
        if (P.alpha[i] <= 0.004 || P.grow[i] <= 0.01) continue;
        footprintOf(fpAe, recA, P.grow[i]);
        footprintOf(fpBe, recB, P.grow[i]);
        sweepPath(c, fpAe, fpBe);
        c.globalAlpha = P.alpha[i];
        c.fillStyle = P.color[i];
        c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }
    // ---- گذرِ هسته ----
    footprintOf(fpA, recA);
    footprintOf(fpB, recB);
    sweepPath(c, fpA, fpB);
    c.globalAlpha = P.coreAlpha;
    c.fillStyle = P.coreColor;
    c.fill();
  }

  // مهرِ یک نمونه‌ی تنها (نقطه / لحظه‌ی نشستنِ نوک)
  function polyPath(c, fp) {
    c.beginPath();
    c.moveTo(fp[0], fp[1]);
    c.lineTo(fp[2], fp[3]);
    c.lineTo(fp[4], fp[5]);
    c.lineTo(fp[6], fp[7]);
    c.closePath();
  }

  function fillFootprint(c, st, P) {
    if (P.n > 0) {
      c.globalCompositeOperation = 'destination-over';
      for (let i = 0; i < P.n; i++) {
        if (P.alpha[i] <= 0.004 || P.grow[i] <= 0.01) continue;
        footprintOf(fpAe, st, P.grow[i]);
        polyPath(c, fpAe);
        c.globalAlpha = P.alpha[i];
        c.fillStyle = P.color[i];
        c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }
    footprintOf(fpA, st);
    polyPath(c, fpA);
    c.globalAlpha = P.coreAlpha;
    c.fillStyle = P.coreColor;
    c.fill();
  }

  /* =====================================================================
     رنگ مرکب و تعامل با کاغذ
     ===================================================================== */
  function inkColor() { return colorEl.value; }

  /* ---------------------------------------------------------------------
     رنگ و شفافیتِ مرکب — PHASE 24
     ---------------------------------------------------------------------
     مهم: در نسخه‌ی قبلی چگالی مستقیماً از فشار می‌آمد
     (densityFromWidth = 0.5 + 0.5·pl) و هم رنگ را تا 0.88 به‌سوی رنگِ
     کاغذ می‌کشید و هم آلفا را تا 0.25 پایین می‌آورد؛ یعنی عملاً
     «فشار = شفافیت». این خلافِ رفتارِ قلمِ نی است: قلمِ نی با فشارِ کم
     خطِ *باریکِ* سیر می‌گذارد، نه خطِ پهنِ محو.

     اکنون:
       • هندسه (پهنای سطحِ تماس) کارِ اصلیِ فشار است.
       • چگالی از مدلِ مرکب می‌آید و کفِ آن inkDensityFloor است (≈0.86)،
         پس تغییرِ دیدنیِ تیرگی عمدتاً از سرعت/توقف می‌آید نه از فشار.
       • دامنه‌ی رقیق‌شدنِ رنگ کوچک شده تا ویژگیِ کاغذ حفظ شود ولی
         خطِ کم‌فشار محو نشود.
     --------------------------------------------------------------------- */
  /* حافظه‌ی نهانِ رنگ ------------------------------------------------
     نسخه‌ی قبلی در هر پاره‌خط getInkColor را صدا می‌زد و آن هم
     mixHex → hexToRgb (parseInt روی رشته) → toString(16) → الحاقِ رشته
     انجام می‌داد: یعنی چند هزار تجزیه/ساختِ رشته در ثانیه، فقط برای
     رنگ. رنگِ پایه و نوعِ کاغذ در طولِ یک استروک ثابت‌اند، پس یک جدولِ
     ۳۳ پله‌ای می‌سازیم و بعد جست‌وجو O(1) است.

     اکنون جدول دوبعدی است: [نوار][پلهٔ تُن]
       نوار ۰      = هستهٔ سیرِ خط
       نوار ۱..۳   = نوارهای نیمه‌خیسِ لبه (هرچه بیرون‌تر، رقیق‌تر)
     ------------------------------------------------------------------ */
  const IC_STEPS = 32;
  const IC_BANDS = 4;
  let icBase = null, icPaper = null;
  // امضای پارامترها به‌صورتِ *عدد* نگه داشته می‌شود، نه رشته: این تابع در
  // مسیرِ داغ چند بار در هر پاره‌خط صدا زده می‌شود و ساختنِ رشته در آن‌جا
  // یعنی چند هزار تخصیصِ حافظه در ثانیه و فشارِ GC.
  let icPale = NaN, icConc = NaN, icEdgeD = NaN;
  const icTab = [];
  function buildInkColorTable(base) {
    icBase = base; icPaper = paperType;
    icPale = cfg.inkDilutePale; icConc = cfg.inkConcentrate;
    icEdgeD = cfg.inkEdgeDilute;
    const P = PAPER_PRESETS[paperType];
    const pale = rgbToHex(P.inkMixColor || [252, 252, 248]);
    /* سرِ «غلیظ» — مرکبِ بیشتر.
       روی کاغذِ روشن، غلیظ‌تر یعنی تیره‌تر (به‌سویِ سیاه). روی کاغذِ
       تیره‌ای مثل کاشیِ لاجوردی که قلم *روشن* می‌نویسد، غلیظ‌تر یعنی
       پوشاننده‌تر (به‌سویِ سفید). وگرنه «تجمعِ مرکب» روی کاشی به‌معنی
       محو‌شدنِ خط می‌شد. هر کاغذ خودش تعیین می‌کند. */
    const dark = P.inkConcentrateTo || '#000000';
    const pl = Math.max(0, cfg.inkDilutePale);
    const cc = Math.max(0, cfg.inkConcentrate);
    for (let b = 0; b < IC_BANDS; b++) {
      const arr = icTab[b] || (icTab[b] = new Array(IC_STEPS + 1));
      // نوارِ بیرونی‌تر ⇒ مرکبِ رقیق‌تر (پر و بالِ الیافِ کاغذ)
      const extra = b === 0 ? 0 : cfg.inkEdgeDilute * (b / (IC_BANDS - 1));
      for (let i = 0; i <= IC_STEPS; i++) {
        const tone = i / IC_STEPS;
        // mix > 0 ⇒ به‌سوی کاغذ | mix < 0 ⇒ به‌سوی غلیظ
        const mix = lerp(pl, -cc, tone) + extra;
        arr[i] = mix >= 0 ? mixHex(base, pale, clamp(mix, 0, 1))
                          : mixHex(base, dark, clamp(-mix, 0, 1));
      }
    }
  }
  // tone = ۰ (کم‌ترین نشست) .. ۱ (بیش‌ترین نشست)
  function getInkTone(base, tone, band) {
    if (base !== icBase || paperType !== icPaper ||
        cfg.inkDilutePale !== icPale || cfg.inkConcentrate !== icConc ||
        cfg.inkEdgeDilute !== icEdgeD) {
      buildInkColorTable(base);
    }
    const i = (clamp01(tone) * IC_STEPS + 0.5) | 0;
    return icTab[clamp(band | 0, 0, IC_BANDS - 1)][i];
  }
  /* سازگاریِ عقب‌رو: امضای قدیمی getInkColor(base, density, isEdge) هنوز
     در چند مسیرِ سازگاری (رکوردهای نسخه‌های قبل) استفاده می‌شود. */
  function getInkColor(base, density, isEdge) {
    return getInkTone(base, density, isEdge ? 1 : 0);
  }
  // شفافیت: دامنه‌ی باریک — تیرگیِ خط تقریباً ثابت می‌ماند
  function densAlpha(density) {
    return inkAlpha() * clamp(0.72 + 0.28 * clamp(density, 0, 1), 0, 1);
  }

  /* ---------------------------------------------------------------------
     پروفایلِ چگالیِ مرکب  (مسئلهٔ ۳)
     ---------------------------------------------------------------------
     مقطعِ عرضیِ یک خطِ مرکبِ واقعی سه ناحیه دارد:

         کاغذ ┊ لبهٔ نیمه‌خیس ┊ هستهٔ سیر ┊ لبهٔ نیمه‌خیس ┊ کاغذ

     پس به‌جای یک fill مات، دو گذر می‌زنیم:
       • حاشیه: همان چندضلعی با خطِ پهن‌ترِ کم‌شفاف (= جمعِ مینکوفسکی با
         دیسک، یعنی یک حاشیهٔ مویینِ هندسی، نه blur و نه نویز)
       • هسته: پرکردنِ همان چندضلعی

     شفافیتِ هسته کمتر از ۱ است، پس:
       – گذرهای مکرر روی هم به‌طورِ طبیعی تیره‌تر می‌شوند
       – ولی پس از دو-سه لایه اشباع می‌شود، پس نوارنوار نمی‌افتد
     پهنای حاشیه از «جذبِ کاغذ» و «تجمعِ مرکب» می‌آید و کرانِ سخت دارد.
     هیچ مقدارِ تصادفی‌ای در کار نیست: خروجی برای ورودیِ یکسان یکسان است
     (تستِ «رسمِ افزایشی = بازترسیمِ کامل» همین را تضمین می‌کند).
     --------------------------------------------------------------------- */
  /* پهنای حاشیه در گام‌های ۰٫۲۵ پیکسل *گسسته* می‌شود.
     دلیل: اگر پهنا در هر نمونه ذره‌ای تغییر کند، مرزِ بیرونی در هر گام
     کمی جابه‌جا می‌شود و چون گامِ نمونه‌برداری منظم است، نوارهای متناوب
     (شانه‌ای) دیده می‌شود. با گسسته‌سازی، نمونه‌های همسایه مرزِ یکسان
     می‌گیرند و لبه یکدست می‌مانَد. */
  const FRINGE_STEP = 0.25;
  function inkFringeWidth(st, absorb, pooling) {
    const ct = st.ct != null ? st.ct : (st.t || 0.5) * 2;
    const raw = clamp(
      cfg.inkFringeBase +
      ct * cfg.inkFringeRatio +
      absorb * cfg.inkFringeAbsorption +
      pooling * 0.9,
      0, cfg.inkFringeMax);
    return Math.round(raw / FRINGE_STEP) * FRINGE_STEP;
  }

  // بیشینه‌ی پهنای حاشیه‌ای که یک نمونه می‌تواند بسازد (برای dirty region)
  function maxFringeOf(st) {
    return inkFringeWidth(st, st.inkSpread == null ? 0 : st.inkSpread, 0) *
           (1 + (st.rough == null ? 0 : st.rough) * 0.6);
  }

  function inkAlphaPair(densF, deposition, absorb) {
    const base = inkAlpha() * clamp(0.78 + 0.22 * clamp(densF, 0, 1), 0, 1);
    // نشستِ مرکب: حرکتِ تند ⇒ روشن‌تر، درنگ/کندی ⇒ سیرتر
    const depF = clamp(0.72 + 0.28 * clamp(deposition, 0, 2.5), 0.55, 1.18);
    const core = clamp(base * cfg.inkCoreAlpha * depF, 0, 1);
    const fringe = clamp(core * cfg.inkFringeAlpha * (0.7 + 0.6 * absorb), 0, 1);
    return { core: core, fringe: fringe };
  }

  /* =====================================================================
     برنامهٔ گذرهای مرکب — پروفایلِ چگالی از هسته تا کاغذ
     ---------------------------------------------------------------------
         کاغذ ┊ نوار ۲ ┊ نوار ۱ ┊  هستهٔ سیر  ┊ نوار ۱ ┊ نوار ۲ ┊ کاغذ

     روی *لایهٔ خیس* هسته با آلفای ۱ پر می‌شود. دلیلش انباشت است: هر پیکسل
     با ~۱۱ چندضلعیِ متوالی پوشیده می‌شود و پرکردنِ مات idempotent است، پس
     تُنِ مرکب در *رنگ* کدگذاری می‌شود نه در آلفا و در رستر گم نمی‌شود
     (اندازه‌گیریِ پیش از رفع: دامنهٔ آلفای هستهٔ خط ۵ از ۲۵۵).

     نوارهای لبه با 'destination-over' و از داخل به بیرون کشیده می‌شوند:
       • destination-over فقط پیکسلِ خالی را رنگ می‌کند ⇒ هیچ انباشتی
         روی لبه رخ نمی‌دهد و نوارهای شانه‌ای دیده نمی‌شود
       • ترتیبِ داخل→بیرون لازم است: اگر از بیرون شروع کنیم، نوارِ بیرونی
         تمامِ پیکسل‌های خالیِ داخلی را هم پر می‌کند و نوارهای درونی
         هرگز دیده نمی‌شوند
     هیچ مقدارِ تصادفی‌ای در کار نیست.
     ===================================================================== */
  const INK_PLAN = {
    coreAlpha: 1, coreColor: '#000', n: 0,
    grow: new Float32Array(IC_BANDS),
    alpha: new Float32Array(IC_BANDS),
    color: new Array(IC_BANDS),
  };

  function buildInkPlan(c, color, densF, tone, dep, absorb, fw) {
    const P = INK_PLAN;
    const onWet = (c === wetCtx) && cfg.inkWetLayer;
    P.coreColor = getInkTone(color, tone, 0);
    P.coreAlpha = onWet
      ? clamp(inkAlpha(), 0.02, 1)          // اجتماع: آلفا ثابت، تُن در رنگ
      : inkAlphaPair(densF, dep, absorb).core;

    const bands = clamp(cfg.inkFringeBands | 0, 0, IC_BANDS - 1);
    if (fw <= 0.12 || bands < 1) { P.n = 0; return P; }
    P.n = bands;
    const fa = clamp01(cfg.inkFringeAlpha) * (0.7 + 0.6 * clamp01(absorb));
    for (let i = 0; i < bands; i++) {
      // شعاعِ بیرونیِ نوار i (داخل → بیرون)
      const u = (i + 1) / bands;
      P.grow[i] = Math.round(fw * u / FRINGE_STEP) * FRINGE_STEP;
      // پروفایل: نوارِ چسبیده به هسته سیرترین، بیرونی‌ترین رقیق‌ترین
      P.alpha[i] = clamp(P.coreAlpha * fa * (1 - i / bands), 0, 1);
      P.color[i] = getInkTone(color, tone, Math.min(IC_BANDS - 1, i + 1));
    }
    return P;
  }

  /* =====================================================================
     قلم نوری — هاله‌ی نور دور خط
     ===================================================================== */
  function glowSeg(a, b) {
    const r = (a.r + b.r) * 0.5;
    const col = (a.color || inkColor());
    const w = r * nibRatio() * 2.4;
    // هاله‌ی بیرونی نرم
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = col;
    ctx.lineWidth = w * 2.2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    // بدنه‌ی نور
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = w * 1.1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    // هسته‌ی روشن
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = w * 0.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* =====================================================================
     نمونه ⟶ سطحِ تماس ⟶ مرکب ⟶ هندسه ⟶ رسم   (PHASE 8 / 9 / 10 / 11)
     ---------------------------------------------------------------------
     این تابع‌ها دیگر مستقیماً از رویدادِ pointer فراخوانی نمی‌شوند. مسیر:

        pointer event → InputBuffer → rAF → Resampler → emitSample()

     پس تعدادِ کارِ رسم تابعِ *مسافتِ حرکت* است، نه نرخِ گزارشِ سخت‌افزار.
     ===================================================================== */

  /* =====================================================================
     ماشینِ حالتِ استروک  (مسئلهٔ ۱ — بدونِ مهرِ تمام‌پهنا در آغاز)
     ---------------------------------------------------------------------
        IDLE → PENDING_INPUT → ACTIVE → ENDED
     در PENDING_INPUT هیچ مرکبی نمی‌نشیند: نمونهٔ نخست نگه داشته می‌شود تا
     جهت و سرعتِ واقعی معلوم شود، یا تا مهلتِ درنگ سر برسد (قلمِ بی‌حرکت).
     ===================================================================== */
  const STROKE = { IDLE: 'idle', PENDING: 'pending_input',
                   ACTIVE: 'active', ENDED: 'ended' };
  let strokeState = STROKE.IDLE;
  let pendingSinceMs = 0;
  // مهلتِ حالتِ انتظار: پس از آن، قلمِ بی‌حرکت واقعاً مرکب می‌گذارد
  const PENDING_TIMEOUT_MS = 45;

  // ثبتِ ۵ رویدادِ نخستِ هر استروک برای عیب‌یابی (مسئلهٔ ۱)
  const firstEvents = [];
  let firstEventLog = true;
  /* شمارنده‌های یکپارچگیِ خط (PHASE B) — برای اثباتِ رفعِ artifact */
  const integrity = { widthClamps: 0, lastClampRatio: 1,
                      speedSpikes: 0, pressureDrops: 0,
                      leanRateHits: 0, samples: 0, maxWidthDropRatio: 0,
                      maxWidthDropAtStep: 0 };
  window.__qalamIntegrity = integrity;
  window.__qalamFirstEvents = firstEvents;

  // وضعیتِ استروکِ جاری
  let strokeArc = 0;               // طولِ قوسِ پیموده‌شده از ابتدای استروک
  let smoothX = 0, smoothY = 0, smoothInit = false;
  let strokeSamples = 0;
  let lastDirRad = null;
  let prevDirForCurve = null, curvePool = 0;
  let strokeSeq = 0;               // شمارنده‌ی یکنواختِ استروک (ضدِ باگِ زمان‌مهر)

  /* دادهٔ *همان نمونه‌ای* که در حالِ رسم است — از بافر می‌آید، نه از
     normalizer.state. رسم یک فریم پس از دریافتِ رویداد انجام می‌شود، پس
     normalizer.state در آن لحظه به نمونهٔ دیگری تعلق دارد. */
  let samplePRaw = 0, sampleSrc = 0, samplePriming = false, samplePTrusted = false;
  /* آیا *همین نمونه* فشارِ سخت‌افزاریِ معتبر داشت؟ از پرچمِ داخلِ
     InputBuffer می‌آید، نه از normalizer.state (که به جدیدترین رویداد
     اشاره می‌کند و یک فریم جلوتر است). */
  let samplePValid = false;

  // نوکِ «تیز»: همان لبه‌ی تخت با تماسِ حساس‌ترِ فشار
  function nibProfileAdjust(nb) {
    /* همیشه از مقدارِ پایه محاسبه می‌شود تا اثرها روی هم انباشته نشوند.
       «پایه» یعنی مقدارِ ابزارِ فعال، و اگر ابزار چیزی نگفته باشد مقدارِ
       TUNE. پیش از این مستقیماً از TUNE خوانده می‌شد و همین، بازنویسیِ
       ابزار را دور می‌زد: ماژیک با minContactRatio=0.72 باید پهنای
       تقریباً ثابت بدهد، ولی این تابع آن را به ۰٫۰۹ برمی‌گرداند و
       نسبتِ پهنای کم‌فشار به پرفشار ۳٫۶ می‌شد (اندازه‌گیری‌شده).

       ★ همان اشکال، یک لایه بالاتر: لایهٔ دستیار (AUI.config) *آخرین*
       لایهٔ پیکربندی است و در syncConfig پس از ابزار اعمال می‌شود؛ ولی این
       تابع در beginStroke و در تغییرِ نوک، بعد از آن صدا زده می‌شود و
       minContactRatio نوکِ ساچمه‌ای (۰٫۵۸) را به مقدارِ ابزار برمی‌گرداند.
       اندازه‌گیریِ پیش از رفع: minContactRatio پس از beginStroke = 0.09
       در برابر 0.58 خواسته‌شده. پس ترتیبِ لایه‌ها باید *همیشه* حفظ شود:
       TUNE → tool → nib profile → assist. */
    const base = (toolCfg && toolCfg.minContactRatio != null)
      ? toolCfg.minContactRatio : TUNE.minContactRatio;
    if (nb === 'sharp') {
      cfg.minContactRatio = base * 0.35;
      cfg.pressureExponent = clamp(cfg.pressureExponent * 1.35, 0.25, 4);
    } else {
      cfg.minContactRatio = base;
    }
    if (AUI) AUI.config(cfg);
  }

  // رکوردِ یک نمونه — میدان‌های قدیمی حفظ شده‌اند تا undo / پاک‌کن /
  // ذخیره‌ی PNG / استروک‌های نسخه‌ی قبل بی‌عیب کار کنند.
  function makeRecord(x, y, angDeg, c, ink, vel, dirRad) {
    return {
      x: x, y: y,
      r: penSize(),                 // سازگاری
      t: c.thickness * 0.5,         // سازگاری: نصفِ ضخامت
      ang: angDeg,
      pl: c.ratio,                  // سازگاری: نسبتِ پهنا
      dens: ink.density,
      color: inkColor(),
      baseColor: inkColor(),      // رنگِ پایه، برای تغییرِ نوعِ کاغذ
      nb: nibEl.value,
      // ---- مدلِ تازه‌ی سطحِ تماس ----
      cw: c.width,                  // طولِ سطحِ تماس
      ct: c.thickness,              // ضخامتِ سطحِ تماس
      co: c.offset,                 // جابه‌جاییِ پاشنه (سازگاری)
      ap: c.apparent,               // پهنای دیده‌شده
      // ---- پروفایلِ تماس در مختصاتِ محلیِ نوک ----
      nw: cfg.nibWidth,             // پهنای کاملِ نوک در لحظهٔ ثبت
      uh: c.uHeel,
      ut: c.uToe,
      hs: c.heelSign,               // کدام سَرِ بازه پاشنه است
      inkAmt: ink.amount,
      inkSpread: ink.spread,
      rough: c.edgeRoughness,
      lean: c.lean,
      vel: vel,
      dir: dirRad === null ? 0 : dirRad,
    };
  }

  /* ---------------------------------------------------------------------
     callback بازنمونه‌بردار
     --------------------------------------------------------------------- */
  function emitSample(x, y, pMapped, lean, leanDir, twist, tMs, dirRad, speed,
                      dwellMs, arcLen, isFirst) {
    // ---- هموارسازیِ موقعیت (EMA) — در ابتدای استروک خام می‌مانَد تا
    //      نقطه‌ی شروع دقیقاً زیر نوک باشد
    let sx = x, sy = y;
    const sAmt = clamp(cfg.positionSmoothing, 0, 0.95);
    if (smoothInit && strokeSamples > 3 && sAmt > 0) {
      const ramp = Math.min(1, (strokeSamples - 3) / 6);
      const a = sAmt * ramp;
      sx = lerp(x, smoothX, a);
      sy = lerp(y, smoothY, a);
    }
    smoothX = sx; smoothY = sy; smoothInit = true;

    /* ---- قلابِ ۱ لایهٔ دستیار: پایدارسازی + اصلاحِ مسیر ----------------
       *پیش از* محاسبهٔ جهت و سطحِ تماس اجرا می‌شود، چون هر دو به موقعیت
       وابسته‌اند. وقتی دستیار خاموش است این تابع فوراً برمی‌گردد و
       هیچ مقداری را عوض نمی‌کند. */
    if (AUI) {
      const io = assistIO;
      io.x = sx; io.y = sy; io.tMs = tMs; io.isFirst = !!isFirst;
      AUI.position(io);
      sx = io.x; sy = io.y;
    }

    // ---- جهت (برای زاویه‌ی نوک و عدم‌تقارنِ پاشنه) ----
    let dr = dirRad;
    if (dr === null) dr = lastDirRad;
    else lastDirRad = dr;

    // ---- دکمه‌ی کنارِ قلم: نوک عمودی ----
    const forcedVertical = barrelMode && barrelHeld;
    const baseAngle = forcedVertical ? 90 : Number(angleEl.value);
    const savedAngle = cfg.nibAngle;
    cfg.nibAngle = baseAngle;
    const savedMode = cfg.angleMode;
    if (forcedVertical) cfg.angleMode = 'fixed';

    // ---- جهت‌گیریِ قلم (از StylusState، با پرچمِ اعتبار) ----
    orient.lean = lean;
    orient.leanDir = leanDir;
    orient.leanValid = leanValidNow;
    orient.twist = twist;
    orient.twistValid = twistValidNow;

    // ---- فشار + جهت‌گیری ⟶ پروفایلِ سطحِ تماس ----
    QE.computeContact(contact, cfg, pMapped, speed, dr, orient, prevLean);
    prevLean = contact.lean;

    /* ---- پیوستگیِ پهنای تماس (PHASE B) ----------------------------
       قاعده‌ی فیزیکی: اگر فشار/جهت/جهت‌گیری تغییرِ چشمگیری نکرده‌اند،
       پهنای تماس نباید ناگهان تغییر کند. این‌جا آهنگِ *کاهشِ* پهنا بر
       حسبِ پیکسلِ پیمایش کران می‌خورد.
       این «کفِ پهنا» نیست: اگر فشار واقعاً افتاده، پهنا هم می‌افتد — فقط
       پیوسته و در چند نمونه، نه در یک پرش. کلِ پروفایلِ تماس با هم مقیاس
       می‌شود تا هندسه‌ی toe/heel سالم بمانَد.

       ★ استثنایِ پنجرهٔ آماده‌سازی (رفعِ مسئلهٔ ۱):
       این محدودگر برای سرکوبِ پرتِ *میانِ* استروک است. در چند نمونهٔ نخست،
       فیلترِ فشار هنوز در حالِ آماده‌شدن است و اگر نمونهٔ pointerdown
       نمایندهٔ فشارِ واقعی نبوده باشد، محدودگر آن خطای یک‌نمونه‌ای را به یک
       «سرِ کلفتِ چندپیکسلی» تبدیل می‌کند. اندازه‌گیری‌شده: ۱۶ پیکسل مسافت
       تا نشستنِ پهنا. پس تا وقتی فیلتر آماده نشده، محدودگر خاموش است. */
    if (last && cfg.maxWidthDropPerPx > 0 && contact.width > 1e-6 &&
        !samplePriming && strokeSamples > cfg.primingSamples) {
      const stepPx = Math.hypot(sx - last.x, sy - last.y);
      const prevW = last.cw;
      if (prevW > 1e-6 && stepPx > 1e-6) {
        const allowed = prevW * Math.max(0.02,
          1 - cfg.maxWidthDropPerPx * stepPx);
        if (contact.width < allowed) {
          const k = allowed / contact.width;
          integrity.widthClamps++;
          integrity.lastClampRatio = +k.toFixed(3);
          contact.width = allowed;
          contact.ratio = clamp01(contact.ratio * k);
          const uc = (contact.uHeel + contact.uToe) * 0.5;
          const halfU = (contact.uToe - contact.uHeel) * 0.5 * k;
          contact.uHeel = clamp(uc - halfU, -1, 1);
          contact.uToe = clamp(uc + halfU, -1, 1);
          contact.thickness *= Math.min(1.25, Math.sqrt(k));
        }
      }
    }
    cfg.nibAngle = savedAngle;
    cfg.angleMode = savedMode;

    /* ---- مرکب (مدلِ تفکیک‌شده) ----
       تغییرِ تندِ جهت هم مثل درنگ باعثِ تجمعِ مرکب می‌شود: نوک لحظه‌ای
       می‌ایستد و مرکب فرصتِ نشستن پیدا می‌کند. این را به‌صورتِ «درنگِ
       معادل» وارد می‌کنیم تا مسیرِ محاسبه یکی بمانَد. */
    const dtMs = tMs - lastSampleT;
    lastSampleT = tMs;
    let dwellEq = dwellMs;
    if (dr !== null && prevDirForCurve !== null) {
      const turn = Math.abs(QE.angleDelta(dr, prevDirForCurve));
      curvePool = curvePool * 0.7 + turn * 0.3;
      dwellEq += clamp01(curvePool / Math.PI) * cfg.curvaturePoolMs;
    }
    if (dr !== null) prevDirForCurve = dr;
    QE.computeInk(inkState, cfg, contact.ratio, speed, dwellEq, arcLen,
                  contact.pushPull, contact.width * contact.thickness,
                  dtMs > 0 && dtMs < 200 ? dtMs : 8);

    /* ---- قلابِ ۲ لایهٔ دستیار: پهنای هدف + فیزیکِ خودکار + کاغذ --------
       نتیجه در همان ContactState و InkState نوشته می‌شود، پس makeRecord،
       رندرر، صدور PNG، پاک‌کن، Undo و آینه هیچ‌کدام تغییری لازم ندارند.
       با خاموش‌بودنِ دستیار، این تابع فوراً برمی‌گردد. */
    let assistGap = false;
    if (AUI) {
      const io = assistIO;
      io.x = sx; io.y = sy;
      io.pressure = pMapped;
      /* ---- اعتبارِ فشارِ *همین نمونه*، نه آخرین رویداد ------------------
         `normalizer.state` همیشه به جدیدترین *رویداد* اشاره می‌کند، ولی این
         تابع یک فریم بعد و روی یک نمونهٔ *بازنمونه‌شده* اجرا می‌شود. خواندنِ
         pressureValid از آن، اعتبارِ نمونهٔ دیگری را به این نمونه نسبت
         می‌دهد — دقیقاً همان اشتباهی که خودِ پروژه برای لاگِ عیب‌یابی‌اش
         مستند کرده و با آوردنِ pressureRaw و flags به داخلِ InputBuffer حل
         کرده است. اندازه‌گیریِ پیش از رفع: در میانهٔ استروکی با فشارِ ثابتِ
         ۰٫۵، مقدارِ valid برای نمونه‌های شمارهٔ ۱۵۰ و ۳۰۰ برابرِ false
         می‌شد و HUD «فشارِ واقعی» را صفر نشان می‌داد در حالی که قلم روی
         کاغذ بود.
         دو پرچمِ *همین نمونه* از بافر می‌آیند و معنایشان یکی نیست:
           FLAG_PRESSURE  → پشتیبانیِ سخت‌افزار در آن لحظه SUPPORTED بود
           FLAG_PTRUST    → خودِ این نمونه برای مقدار‌دهی قابلِ اعتماد بود
         «فشارِ قابلِ نمایش» یعنی نمونه‌ای که یا پشتیبانی تأیید شده یا
         دست‌کم خودش قابلِ اعتماد است — و در هر حال جانشین نباشد. صرفاً
         تکیه بر FLAG_PRESSURE کافی نیست، چون تأییدِ پشتیبانی به چند نمونه
         شاهد نیاز دارد و تا آن‌وقت HUD بی‌دلیل «صفر» می‌گفت. */
      const ssA = normalizer.state;
      io.pressureValid = (samplePValid || samplePTrusted) &&
                         !ssA.pressureIsFallback;
      io.pressureSupported = ssA.pressureSupport === SUP.SUPPORTED;
      io.pressureFallback = !!ssA.pressureIsFallback;
      io.speed = speed;
      io.dir = dr;
      io.dwellMs = dwellMs;
      io.arcLen = arcLen;
      io.dtMs = dtMs > 0 && dtMs < 200 ? dtMs : 8;
      io.lean = contact.lean;
      io.contact = contact;
      io.ink = inkState;
      io.nibWidth = cfg.nibWidth;
      io.minContactRatio = cfg.minContactRatio;
      io.velocityRef = cfg.velocityRef;
      io.pxPerMm = cfg.pxPerMm;
      /* بازهٔ نگاشتِ «نشستِ مرکب → تُنِ رنگ» را هم می‌فرستیم تا لایهٔ دستیار
         بتواند غنای جوهر را *داخلِ همان بازه* بنشاند و در سقفش اشباع نشود. */
      io.toneMin = cfg.inkToneDepMin;
      io.toneMax = cfg.inkToneDepMax;
      io.gap = false;
      AUI.shape(io);
      assistGap = !!io.gap;
    }

    const angDeg = contact.angleRad * 180 / Math.PI;
    const rec = makeRecord(sx, sy, angDeg, contact, inkState, speed, dr);
    /* شکافِ جوهرِ خودکار: از همان پرچمِ `skip` رندررِ موجود استفاده می‌شود
       (drawStrokePath و redrawStrokeRegionOnWet از قبل آن را می‌فهمند)، پس
       هیچ مسیرِ رسمِ تازه‌ای لازم نیست. پیش‌فرضِ مدل بسیار کم است. */
    if (assistGap) rec.skip = true;
    strokeSamples++;
    strokeArc = arcLen;
    if (strokeState === STROKE.PENDING) strokeState = STROKE.ACTIVE;

    integrity.samples++;
    integrity.speedSpikes = resampler.speedSpikes;
    integrity.pressureDrops = normalizer.calibration.clampedDrops;
    if (last && last.cw > 1e-6) {
      const stepPx = Math.max(1e-6, Math.hypot(sx - last.x, sy - last.y));
      const dropRatio = (last.cw - contact.width) / last.cw;   // >0 = باریک‌تر شد
      const perPx = dropRatio / stepPx;
      if (perPx > integrity.maxWidthDropRatio) {
        integrity.maxWidthDropRatio = +perPx.toFixed(4);
        integrity.maxWidthDropAtStep = +stepPx.toFixed(2);
      }
    }

    /* ---- لاگِ ۵ نمونهٔ نخستِ هر استروک ----------------------------
       همه‌ی میدان‌ها به *همین نمونه* تعلق دارند. نسخهٔ قبلی pressureRaw و
       source و tilt را از normalizer.state می‌خواند؛ چون رسم یک فریم بعد
       انجام می‌شود، آن مقادیر به نمونهٔ دیگری تعلق داشتند و لاگ به‌جای
       نشان‌دادنِ باگ، آن را پنهان می‌کرد (کنارِ هم «pressureRaw=0.15» و
       «contactWidth=11.7px» گزارش می‌شد). */
    if (firstEventLog && firstEvents.length < 5) {
      const ss0 = normalizer.state;
      firstEvents.push({
        n: firstEvents.length,
        // ---- منشأ و زمانِ همین نمونه ----
        source: QE.SRC_NAME[sampleSrc | 0] || String(sampleSrc),
        t: Math.round(tMs),
        isFirstOfStroke: !!isFirst,
        strokeState: strokeState,
        pointerType: ss0.pointerType,
        // ---- فشارِ همین نمونه، مرحله‌به‌مرحله ----
        pressureRaw: +samplePRaw.toFixed(4),
        pressureMapped: +pMapped.toFixed(4),
        pressureTrusted: samplePTrusted,
        pressurePriming: samplePriming,
        pressureRepriced: !!(isFirst && resampler.pending && resampler.pending.repriced),
        // ---- وضعیتِ پشتیبانی (وابسته به دستگاه، نه نمونه) ----
        pressureSupported: ss0.pressureSupport,
        pressureTrust: ss0.pressureTrust,
        pressureFallback: ss0.pressureIsFallback,
        // ---- جهت‌گیریِ همین نمونه ----
        lean: +lean.toFixed(4),
        leanDirDeg: +(leanDir * 180 / Math.PI).toFixed(1),
        leanValid: leanValidNow,
        twist: twist,
        // ---- هندسه و مرکبِ حاصل از همین نمونه ----
        x: +sx.toFixed(1), y: +sy.toFixed(1),
        speed: +speed.toFixed(4),
        dirDeg: dr === null ? null : +(dr * 180 / Math.PI).toFixed(1),
        contactWidth: +contact.width.toFixed(3),
        contactWidthMm: +(contact.width / cfg.pxPerMm).toFixed(3),
        contactThickness: +contact.thickness.toFixed(3),
        uHeel: +contact.uHeel.toFixed(3), uToe: +contact.uToe.toFixed(3),
        apparent: +contact.apparent.toFixed(3),
        inkAmount: +inkState.amount.toFixed(4),
        inkDensity: +inkState.density.toFixed(4),
        nibWidth: +cfg.nibWidth.toFixed(2),
        widthRatioOfNib: +(contact.width / cfg.nibWidth).toFixed(4),
      });
    }

    if (rec.skip) {
      /* شکافِ جوهرِ خودکار: نمونه ثبت می‌شود ولی رسم نمی‌شود و پاره‌خطِ
         بعدی هم از آن شروع نمی‌شود — دقیقاً همان معناشناسیِ `skip` در
         drawStrokePath، تا «رسمِ زنده = بازترسیمِ کامل» نشکند. */
      currentStroke.push(rec);
      last = null;
    } else {
      if (last) renderSegment(last, rec);
      else renderStamp(rec);
      currentStroke.push(rec);
      last = rec;
    }

    // ---- آمار برای پنلِ اشکال‌زدایی ----
    stats.samples++;
    const cal = normalizer.calibration;
    stats.rawPressure = cal.raw;
    stats.normPressure = cal.normalized;
    stats.filtPressure = cal.filtered;
    stats.mappedPressure = cal.mapped;
    stats.uHeel = contact.uHeel;
    stats.uToe = contact.uToe;
    stats.lean = contact.lean;
    stats.leanDeg = contact.leanDir * 180 / Math.PI;
    stats.relAngleDeg = contact.relAngle * 180 / Math.PI;
    stats.pushPull = contact.pushPull;
    stats.orientationFrom = contact.orientationFrom;
    stats.inkFlow = inkState.flow;
    stats.inkDeposition = inkState.deposition;
    stats.inkPooling = inkState.pooling;
    stats.inkSpread = inkState.spread;
    stats.inkAbsorption = inkState.absorption;
    stats.inkReservoir = inkState.reservoir;
    stats.contactW = contact.width;
    stats.contactT = contact.thickness;
    stats.contactOffset = contact.offset;
    stats.apparent = contact.apparent;
    stats.velocity = speed;
    stats.dirDeg = dr === null ? 0 : dr * 180 / Math.PI;
    stats.nibDeg = angDeg;
    stats.ink = inkState.amount;
    stats.density = inkState.density;
    stats.dwell = dwellMs;
    const ss = normalizer.state;
    stats.tiltX = ss.tiltX; stats.tiltY = ss.tiltY;
    stats.azimuthDeg = ss.azimuth * 180 / Math.PI;
    stats.altitudeDeg = ss.altitude * 180 / Math.PI;
    stats.twist = ss.twist;
    stats.orientationState = ss.orientationState;
    stats.pressureSupport = ss.pressureSupport;
    stats.tiltSupport = ss.tiltSupport;
    stats.orientationSupport = ss.orientationSupport;
    stats.twistSupport = ss.twistSupport;
    stats.pressureIsFallback = ss.pressureIsFallback;
    stats.pointerType = ss.pointerType;
  }

  /* ---------------------------------------------------------------------
     رسمِ یک مهرِ تنها (لحظه‌ی نشستنِ نوک / نقطه)
     --------------------------------------------------------------------- */
  function renderStamp(st) {
    const nb = st.nb || nibEl.value;
    const dens = pointDensity(st);
    const absorb = st.inkSpread == null ? 0 : st.inkSpread;
    const dep = st.inkAmt == null ? 1 : st.inkAmt;
    const fw = inkFringeWidth(st, absorb, 0);
    const P = buildInkPlan(ctx, st.color || inkColor(), dens, pointTone(st),
                           dep, absorb, fw);
    if (nb === 'round') {
      const r = Math.max(0.35, (st.cw != null ? st.cw : st.r) * 0.5);
      ctx.globalAlpha = P.coreAlpha;
      ctx.fillStyle = P.coreColor;
      ctx.beginPath(); ctx.arc(st.x, st.y, r, 0, Math.PI * 2); ctx.fill();
      return;
    }
    fillFootprint(ctx, st, P);
    stats.segments++;
  }

  /* ---------------------------------------------------------------------
     رسمِ یک پاره‌خط: پوشِ محدبِ دو سطحِ تماس
     ---------------------------------------------------------------------
     همین یک تابع هم برای رسمِ زنده و هم برای بازترسیم استفاده می‌شود؛
     در نسخه‌ی قبلی دو پیاده‌سازیِ جدا بود (drawSegment / drawSegmentRec) و
     ظاهرِ خط بعد از برداشتنِ قلم کمی تغییر می‌کرد.
     --------------------------------------------------------------------- */
  function renderSegment(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const color = b.color || inkColor();
    const nb = b.nb || nibEl.value;
    const P = PAPER_PRESETS[paperType];
    const isGlossy = paperType === 'gloss';
    const densF = segDensity(a, b);

    // --- نوکِ گرد (مداد / قلم‌مو / ماژیک / آبرنگ) ---
    if (nb === 'round') {
      /* شعاع از *سطحِ تماس* می‌آید، نه از اندازهٔ ثابتِ قلم.
         پیش از این `r` (که همان penSize است) و `t` استفاده می‌شد، پس نوکِ
         گرد تقریباً بی‌اعتنا به فشار بود — در حالی که `drawNibDot` همان
         نوک را با `cw` می‌کشید. یعنی «نقطه» و «خط» دو رفتارِ متفاوت
         داشتند. اکنون هر دو از cw می‌آیند و اصلِ پروژه («فشار ⇒ سطحِ
         تماس») برای نوکِ گرد هم برقرار است. */
      const rr = (a.cw != null && b.cw != null)
        ? (a.cw + b.cw) * 0.25
        : ((a.r + b.r) * 0.25 + (a.t + b.t) * 0.5);
      if (rr <= 0.02) return;
      const onWet = (ctx === wetCtx) && cfg.inkWetLayer;
      const tone = segTone(a, b);
      const absorbR = ((a.inkSpread == null ? 0 : a.inkSpread) +
                       (b.inkSpread == null ? 0 : b.inkSpread)) * 0.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (lightPen) {
        ctx.globalAlpha = 1; ctx.strokeStyle = color;
        ctx.shadowColor = color; ctx.shadowBlur = rr * 2.5;
        ctx.lineWidth = rr * 2;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.shadowBlur = 0;
        stats.segments++;
        return;
      }
      /* لبهٔ نرمِ قلم‌مو: یک گذرِ پهن‌ترِ کم‌شفاف با destination-over.
         همان تدبیرِ نوکِ تخت — پس نه انباشت می‌شود و نه شانه‌ای. */
      const fwR = inkFringeWidth(b, absorbR, 0);
      const bands = clamp(cfg.inkFringeBands | 0, 0, 3);
      if (fwR > 0.12 && bands > 0) {
        const fa = clamp01(cfg.inkFringeAlpha) * (0.7 + 0.6 * clamp01(absorbR));
        ctx.globalCompositeOperation = 'destination-over';
        for (let i = 0; i < bands; i++) {
          const grow = Math.round(fwR * ((i + 1) / bands) / FRINGE_STEP) * FRINGE_STEP;
          if (grow <= 0.01) continue;
          ctx.globalAlpha = clamp((onWet ? clamp(inkAlpha(), 0.02, 1)
                                         : densAlpha(densF)) * fa * (1 - i / bands), 0, 1);
          ctx.strokeStyle = getInkTone(color, tone, Math.min(3, i + 1));
          ctx.lineWidth = (rr + grow) * 2;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = onWet ? clamp(inkAlpha(), 0.02, 1) : densAlpha(densF);
      ctx.strokeStyle = getInkTone(color, tone, 0);
      ctx.lineWidth = rr * 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (isGlossy) {
        ctx.globalAlpha = densAlpha(densF) * 0.25;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = Math.max(0.6, rr * 0.9);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      stats.segments++;
      return;
    }

    if (dist < 1e-4) return;

    if (lightPen) glowSeg(a, b);


    /* --- بدنه‌ی خط: پوشِ محدبِ دو سطحِ تماس، با پروفایلِ چگالی --- */
    const dep = ((a.inkAmt == null ? 1 : a.inkAmt) +
                 (b.inkAmt == null ? 1 : b.inkAmt)) * 0.5;
    const absorb = ((a.inkSpread == null ? 0 : a.inkSpread) +
                    (b.inkSpread == null ? 0 : b.inkSpread)) * 0.5;
    const fw = inkFringeWidth(b, absorb, 0) *
               (1 + (b.rough == null ? 0 : b.rough) * 0.6);
    const IP = buildInkPlan(ctx, color, densF, segTone(a, b), dep, absorb, fw);
    fillSweep(ctx, a, b, IP);
    stats.segments++;

    // --- هایلایتِ کاغذِ گلاسه ---
    if (isGlossy) {
      const ap = b.ap == null ? b.t * 2 : b.ap;
      if (ap > 1.6) {
        ctx.globalAlpha = densAlpha(densF) * 0.18;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(0.5, ap * 0.28);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
  }

  // نامِ قبلی — برای مسیرهای بازترسیم
  function drawSegmentRec(a, b) { renderSegment(a, b); }

  /* =====================================================================
     دم و سرِ استروک (PHASE 11)
     ---------------------------------------------------------------------
     قلمِ نیِ واقعی هنگام برداشته‌شدن، پاشنه‌اش زودتر از پنجه از کاغذ جدا
     می‌شود؛ نتیجه یک «دمِ» تیزشونده است. اکنون این کار روی *سطحِ تماس*
     (cw / ct / co) انجام می‌شود، نه روی شفافیت.
     خروجی: مستطیلِ ناحیه‌ی تغییریافته، تا فقط همان‌جا بازترسیم شود.
     ===================================================================== */
  function applyTailTaper(stroke) {
    const n = stroke.length;
    if (n < 4) return null;
    // پرتابِ تندتر ⇒ دمِ بلندتر
    const v = stroke[n - 1].vel || 0;                   // px/ms
    const tailPx = clamp(cfg.tailLength * (0.55 + v * 1.8), 16, 140);
    let startI = 0, acc = 0;
    for (let i = n - 1; i > 0; i--) {
      acc += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
      if (acc >= tailPx) { startI = i; break; }
      if (i === 1) startI = 0;
    }
    if (n - 1 - startI < 3) startI = Math.max(0, n - 5);

    /* ناحیه‌ی dirty باید اجتماعِ حدودِ *پیش* و *پس* از تیپر باشد: تیپر
       ضخامت و حاشیه‌ی مرکب را کوچک می‌کند، پس حدودِ پس از آن کوچک‌تر است
       و اگر فقط همان را پاک کنیم، چند پیکسلِ کهنه از رسمِ زنده باقی
       می‌مانَد (اندازه‌گیری‌شده: ۲ پیکسل). */
    const bbBefore = boundsOfRange(stroke, Math.max(0, startI - 1), n - 1);

    const minR = clamp(cfg.tailMinRatio, 0.02, 1);
    for (let j = startI; j < n; j++) {
      const u = (j - startI) / Math.max(1, n - 1 - startI);
      // منحنیِ کسینوسی: آغازِ دم نرم، انتها تیز
      const ease = Math.pow(Math.cos(u * Math.PI / 2), 0.9);
      const st = stroke[j];
      const k = Math.max(minR, ease);
      if (st.uh != null && st.nw != null) {
        // ---- مسیرِ اصلی: کوتاه‌کردنِ بازه‌ی تماس در مختصاتِ محلیِ نوک ----
        // پاشنه از کاغذ بلند می‌شود و بازه به سمتِ پنجه جمع می‌شود؛ همان
        // کاری که نوکِ نی هنگام برداشته‌شدنِ قلم می‌کند.
        const len = st.ut - st.uh;
        const newLen = Math.max(0.02, len * k);
        if ((st.hs == null ? 1 : st.hs) > 0) {
          // پاشنه در u پایین‌تر ⇒ پنجه (ut) ثابت می‌مانَد
          st.uh = st.ut - newLen;
        } else {
          st.ut = st.uh + newLen;
        }
        st.ct = Math.max(0.35, st.ct * (0.55 + 0.45 * k));
        st.cw = st.nw * 0.5 * newLen;
        st.co = (st.uh + st.ut) * 0.5 * st.nw * 0.5;
        st.pl = st.pl == null ? k : Math.max(minR, st.pl * k);
        st.t = st.ct * 0.5;
      } else if (st.cw != null) {
        // رکوردهای فاز ۱
        const before = st.cw;
        st.cw = st.cw * k;
        st.ct = Math.max(0.35, st.ct * (0.55 + 0.45 * k));
        const heelSign = st.co === 0 ? 1 : Math.sign(st.co);
        st.co = (st.co || 0) + (before - st.cw) * 0.5 * clamp(cfg.heelLift, 0, 1) * heelSign;
        st.pl = st.pl == null ? k : Math.max(minR, st.pl * k);
        st.t = st.ct * 0.5;
      } else {
        st.t = Math.max(0.4, st.t * k);
        if (st.pl != null) st.pl = Math.max(minR, st.pl * k);
      }
    }
    const bbAfter = boundsOfRange(stroke, Math.max(0, startI - 1), n - 1);
    return unionBounds(bbBefore, bbAfter);
  }

  function unionBounds(a, b) {
    if (!a) return b;
    if (!b) return a;
    const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.w, b.x + b.w);
    const y2 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  // حدودِ دقیقِ گسترشِ یک نمونه روی کاغذ
  function sampleExtent(st) {
    // حاشیه‌ی مویینِ مرکب هم باید در ناحیه‌ی dirty حساب شود، وگرنه
    // بازترسیمِ ناحیه‌ای لبه‌ی خط را می‌بُرد.
    if (st.uh != null && st.nw != null) {
      const half = st.nw * 0.5;
      const reach = Math.max(Math.abs(st.uh), Math.abs(st.ut)) * half;
      return reach + st.ct * 0.5 + maxFringeOf(st) + 1.5;
    }
    if (st.cw != null) {
      return Math.abs(st.co || 0) + Math.max(st.cw, st.ct) * 0.5 +
             maxFringeOf(st) + 1.5;
    }
    return st.r + st.t + 2;
  }

  function boundsOfRange(s, i0, i1) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = i0; i <= i1 && i < s.length; i++) {
      const st = s[i];
      if (!st || st.skip || st.erased) continue;
      const rr = sampleExtent(st);
      if (st.x - rr < x1) x1 = st.x - rr;
      if (st.y - rr < y1) y1 = st.y - rr;
      if (st.x + rr > x2) x2 = st.x + rr;
      if (st.y + rr > y2) y2 = st.y + rr;
    }
    if (x2 < x1) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function strokeBounds(s) {
    return boundsOfRange(s, 0, s.length - 1);
  }

  const MAX_HISTORY = 400;         // کرانِ حافظه‌ی undo
  function pushHistory(act) {
    history.push(act);
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  }

  function endStroke(e) {
    if (!drawing || (e && e.pointerId !== pointerId)) return;
    drawing = false;
    // نمونه‌های باقی‌مانده در بافر را قبل از بستنِ استروک تخلیه کن
    flushInput(true);
    // اگر استروک هرگز حرکت نکرد (فقط گذاشتن و برداشتنِ قلم)، نمونهٔ
    // نگه‌داشته‌شده همین‌جا با درنگِ واقعی گذاشته می‌شود
    if (resampler.hasPending()) {
      // هیچ نمونهٔ فشارِ قابلِ‌اعتمادی نیامده؟ «فشارِ آغازینِ کنترل‌شده»
      // به‌کار می‌رود، نه تمام‌پهنا. (مسئلهٔ ۱ — نقطه‌ی بی‌حرکت)
      repriceFirstSample(true);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.shadowBlur = 0;
      resampler.flushPending(emitSample, performance.now() - pendingSinceMs);
      ctx.restore();
    }
    strokeState = STROKE.ENDED;

    const s = currentStroke;
    currentStroke = [];

    const flatEnd = autoReturnEl.checked;
    /* ---- بازسازیِ نهاییِ لایهٔ دستیار (Final Reconstruction Pipeline) ----
       روی *همان* آرایهٔ رکوردها کار می‌کند و هیچ نمونه‌ای اضافه یا حذف
       نمی‌کند؛ پس Undo همچنان یک واحد در هر استروک است، پاک‌کن و صدور PNG
       بی‌تغییر می‌مانند، و آینه همان رکوردهای اصلاح‌شده را می‌گیرد (چون
       پایین‌تر کلِ استروک از نو فرستاده می‌شود). */
    const assistBB = AUI ? AUI.endStroke(s) : null;
    /* لایهٔ دستیار ممکن است *ظرفیتِ* پهنای نوک را برای همین استروک بزرگ
       کرده باشد (Width Mode = Reference). حالا که استروک بسته شد، cfg از
       نو از اسلایدرها ساخته می‌شود تا آن افزایشِ موقت به استروکِ بعدی و به
       پیش‌نمایشِ نوک درز نکند. */
    if (AUI) syncConfig();
    if (s.length >= 4) {
      let tailBB = null;
      if (!flatEnd) tailBB = applyTailTaper(s);
      tailBB = unionBounds(assistBB, tailBB);
      s.bb = strokeBounds(s);
      strokes.push(s);
      pushHistory({ type: 'stroke', data: s });
      /* دمِ استروک روی *لایهٔ خیس* بازترسیم می‌شود، نه روی مرکبِ خشک.
         این هم ارزان‌تر است (فقط همین استروک، نه استروک‌های هم‌پوشان) و هم
         کلاسی از درزهای مویی را حذف می‌کند، چون لایهٔ خیس هنوز ترکیب
         نشده است. */
      if (tailBB) {
        if (cfg.inkWetLayer) redrawStrokeRegionOnWet(s, tailBB);
        else redrawRegion(tailBB);
      }
    } else if (s.length) {
      s.bb = strokeBounds(s);
      strokes.push(s);
      pushHistory({ type: 'stroke', data: s });
      if (assistBB) {
        if (cfg.inkWetLayer) redrawStrokeRegionOnWet(s, assistBB);
        else redrawRegion(assistBB);
      }
      if (s.length === 1) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawNibDot(s[0]);
        ctx.restore();
      }
    }

    // ---- ترکیبِ استروک روی مرکبِ خشک (یک بار در هر استروک) ----
    if (cfg.inkWetLayer) {
      ctx = inkCtx;
      // این استروک همین حالا به strokes اضافه شده؛ فقط استروک‌های *پیشین*
      // می‌توانند هم‌پوشان باشند.
      flushWet(s.bb || null,
               overlapRect(s.bb, Math.max(0, strokes.length - 1)));
    }

    /* آینه: هرچه از این استروک نفرستاده‌ایم (از جمله تغییراتِ تیپرِ دم)
       با یک همگام‌سازیِ کوچک فرستاده می‌شود. تیپر رکوردهای موجود را
       *عوض* می‌کند، پس فرستادنِ دنبالهٔ تازه کافی نیست و همان استروک از
       نو فرستاده می‌شود. */
    if (mirrorOn && s.length) {
      mirrorSend({ t: 'begin', id: mirrorStrokeId, env: mirrorEnv() });
      mirrorSend({ t: 'rec', id: mirrorStrokeId, recs: s });
      mirrorSend({ t: 'end', id: mirrorStrokeId });
    }
    mirrorSentCount = 0;

    resetStrokeState();
    barrelHeld = false;
    gtx.clearRect(0, 0, W, H);
    status.textContent = 'آماده برای نوشتن';
  }

  /* بازترسیمِ ناحیه‌ای *یک* استروک روی لایهٔ خیس.
     حاشیهٔ اضافه لازم است چون گذرِ حاشیه با destination-over کشیده می‌شود و
     دیده‌شدنش به رسم‌شدنِ همسایه بستگی دارد؛ بدونِ حاشیه، لبه جایی ظاهر
     می‌شود که در رسمِ پیوسته پنهان بود. */
  function redrawStrokeRegionOnWet(stroke, bb) {
    if (!bb) return;
    const m = cfg.maxSpacing * 3 + cfg.inkFringeMax + 2;
    /* ناحیه روی مرزِ پیکسلِ دستگاه چفت می‌شود و *همان* ناحیه هم پاک و هم
       clip می‌شود.
       بدونِ clip، بازترسیم پیکسل‌های بیرونِ ناحیه را دوباره رنگ می‌کند و
       آن‌جا لبه‌های آنتی‌الیاس‌شده روی هم انباشته می‌شوند: پرکردنِ مات روی
       پیکسلی که پوششِ جزئی دارد idempotent *نیست*
       (0.5 → 0.5 + 0.5·0.5 = 0.75). اندازه‌گیری‌شده: ۶۵–۲۶۳ پیکسل اختلاف
       با «بازترسیمِ کامل»، همه در ناحیهٔ دمِ استروک و همه با آلفای بیشتر در
       مسیرِ افزایشی. با clip، تعدادِ پاره‌خط‌های انتخابی می‌تواند
       سخاوتمندانه باشد بی‌آنکه بیرون از ناحیه چیزی عوض شود. */
    const reg = snapRect(bb, m);
    clearWet(reg, 0);
    const sel = { x: reg.x - m, y: reg.y - m, w: reg.w + 2 * m, h: reg.h + 2 * m };
    const prev = ctx;
    ctx = wetCtx;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.rect(reg.x, reg.y, reg.w, reg.h);
    ctx.clip();
    let p = null;
    for (const st of stroke) {
      if (st.skip || st.erased) { p = null; continue; }
      if (p) {
        if (segIntersects(p, st, sel.x, sel.y, sel.w, sel.h)) renderSegment(p, st);
      } else if (!(st.x + sampleExtent(st) < sel.x ||
                   st.x - sampleExtent(st) > sel.x + sel.w ||
                   st.y + sampleExtent(st) < sel.y ||
                   st.y - sampleExtent(st) > sel.y + sel.h)) {
        drawNibDot(st);
      }
      p = st;
    }
    ctx.restore();
    ctx = prev;
  }

  function resetStrokeState() {
    last = null; smoothInit = false;
    strokeSamples = 0; strokeArc = 0; lastDirRad = null;
    leanValidNow = false; twistValidNow = false; prevLean = 0;
    prevDirForCurve = null; curvePool = 0;
    lastSampleT = 0;
    integrity.widthClamps = 0; integrity.samples = 0;
    integrity.maxWidthDropRatio = 0; integrity.maxWidthDropAtStep = 0;
    strokeState = STROKE.IDLE;
    resampler.reset();
    normalizer.resetStroke();
    inkState.reset(cfg);
    inputBuf.clear();
    lastPress = 0.5;
  }

  /* =====================================================================
     بازترسیم
     ---------------------------------------------------------------------
     هر استروک *جداگانه* از راهِ لایهٔ خیس ترکیب می‌شود، به همان ترتیبی که
     در زمانِ نوشتن ترکیب شده بود. این تضمین می‌کند «رسمِ زنده» و
     «بازترسیم» پیکسل‌به‌پیکسل یکی باشند (تستِ REGION در tests.html).
     ===================================================================== */
  function redraw() {
    inkCtx.save();
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkCtx.clearRect(0, 0, W, H);
    inkCtx.restore();
    clearWet(null);
    for (let i = 0; i < strokes.length; i++) drawStrokeUnion(strokes[i], i);
    if (currentStroke.length) {
      if (drawing && cfg.inkWetLayer) {
        // استروکِ زنده هنوز روی لایهٔ خیس است و نباید ترکیب شود
        const prev = ctx;
        ctx = wetCtx;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.shadowBlur = 0;
        drawStrokePath(currentStroke);
        ctx.restore();
        ctx = prev;
      } else {
        drawStrokeUnion(currentStroke);
      }
    }
    drawOverlayLabels();
  }

  // یک استروکِ کامل با معناشناسیِ اجتماع (لایهٔ خیس) + یک ترکیب
  // idx: جایگاهِ استروک در آرایه — برای تشخیصِ هم‌پوشانی با استروک‌های پیشین
  function drawStrokeUnion(stroke, idx) {
    if (!stroke || !stroke.length) return;
    if (!cfg.inkWetLayer) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.shadowBlur = 0;
      drawStrokePath(stroke);
      ctx.restore();
      return;
    }
    const bb = stroke.bb || strokeBounds(stroke);
    if (!bb) return;
    drawViaWet(bb, () => drawStrokePath(stroke),
               overlapRect(bb, idx === undefined ? undefined : idx));
  }

  // رسمِ یک استروک از روی رکوردها — برای بازترسیمِ کامل و undo
  function drawStrokePath(stroke) {
    if (!stroke || !stroke.length) return;
    if (stroke.length === 1) {
      const st = stroke[0];
      if (st.skip || st.erased) return;
      drawNibDot(st);
      return;
    }
    let prev = null;
    for (const st of stroke) {
      if (st.skip || st.erased) { prev = null; continue; }
      if (prev) drawSegmentRec(prev, st);
      else drawNibDot(st);
      prev = st;
    }
  }

  // مهرِ نوک برای نقطه/لحظه‌ی نشستنِ قلم — همان هندسه‌ی سطحِ تماس
  function nibLineMark(st, dens) {
    const inkDens = pointDensity(st);
    if (st.cw != null || st.uh != null) {
      const absorb2 = st.inkSpread == null ? 0 : st.inkSpread;
      const dep2 = st.inkAmt == null ? 1 : st.inkAmt;
      const fw2 = inkFringeWidth(st, absorb2, 0);
      const IP = buildInkPlan(ctx, st.color || inkColor(), inkDens,
                              pointTone(st), dep2, absorb2, fw2);
      fillFootprint(ctx, st, IP);
      return;
    }
    // مسیرِ سازگاری با رکوردهای قدیمی
    ctx.fillStyle = getInkTone(st.color || inkColor(), pointTone(st), 0);
    ctx.globalAlpha = (ctx === wetCtx && cfg.inkWetLayer)
      ? clamp(inkAlpha(), 0.02, 1)
      : densAlpha(dens == null ? inkDens : dens);
    const ang = st.ang * Math.PI / 180;
    const pl = clamp(st.pl == null ? 1 : st.pl, 0.01, 1);
    const thickScale = 1 + (nibThickMult() - 1) * 0.5;
    const a = st.r * nibRatio() * 0.5 * pl * thickScale;
    const b = Math.max(0.6, st.t);
    const c = Math.cos(ang), s = Math.sin(ang);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = b;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(st.x - a * c, st.y - a * s);
    ctx.lineTo(st.x + a * c, st.y + a * s);
    ctx.stroke();
  }

  // نقطه‌ی تنها
  function drawNibDot(st) {
    if (st.skip || st.erased) return;
    const nb = st.nb || nibEl.value;
    const densP = pointDensity(st);
    if (nb === 'round') {
      const r = st.cw != null ? st.cw * 0.5 : st.r * 0.5 + st.t;
      ctx.globalAlpha = (ctx === wetCtx && cfg.inkWetLayer)
        ? clamp(inkAlpha(), 0.02, 1) : densAlpha(densP);
      ctx.fillStyle = getInkTone(st.color || inkColor(), pointTone(st), 0);
      ctx.beginPath(); ctx.arc(st.x, st.y, Math.max(0.4, r), 0, Math.PI * 2); ctx.fill();
    } else {
      nibLineMark(st, densP);
    }
  }

  /* =====================================================================
     بازترسیمِ ناحیه‌ای (dirty region)  — PHASE 14
     ---------------------------------------------------------------------
     ریشه‌ی گیرکردنِ «رفتن روی حرفِ نوشته‌شده» همین‌جا بود: نسخه‌ی قبلی در
     هر pointerup کلِ استروک‌های هم‌پوشان را از نو رسم می‌کرد
     (O(تعدادِ کلِ نقاطِ استروک‌های هم‌پوشان)). حالا:

       ۱) ناحیه clip می‌شود ⇒ رسمِ بیرونِ ناحیه هزینه‌ای ندارد
       ۲) حذفِ بازه با destination-out فقط در همان مستطیل
       ۳) کَشتِ سطحِ *پاره‌خط* (نه سطحِ استروک) ⇒ از یک استروکِ بلند فقط
          دو-سه پاره‌خطِ داخلِ ناحیه بازرسم می‌شود
     ===================================================================== */
  function segIntersects(a, b, rx, ry, rw, rh) {
    const ea = sampleExtent(a), eb = sampleExtent(b);
    const e = ea > eb ? ea : eb;
    const x1 = (a.x < b.x ? a.x : b.x) - e;
    const x2 = (a.x > b.x ? a.x : b.x) + e;
    const y1 = (a.y < b.y ? a.y : b.y) - e;
    const y2 = (a.y > b.y ? a.y : b.y) + e;
    return !(x1 > rx + rw || x2 < rx || y1 > ry + rh || y2 < ry);
  }

  function redrawRegion(bb, pad) {
    if (!bb) return;
    pad = pad == null ? 1 : pad;
    // چفت‌کردنِ مستطیل روی مرزِ پیکسلِ *دستگاه*: در غیرِ این‌صورت
    // destination-out و clip لبه‌ی نیمه‌پوشیده می‌سازند و درزِ مویی
    // روی مرزِ ناحیه دیده می‌شود.
    const q = 1 / dpr;
    const rx = Math.floor((bb.x - pad) / q) * q;
    const ry = Math.floor((bb.y - pad) / q) * q;
    const rw = Math.ceil((bb.x + bb.w + pad) / q) * q - rx;
    const rh = Math.ceil((bb.y + bb.h + pad) / q) * q - ry;

    // ---- ۱) پاک‌کردنِ ناحیه روی مرکبِ خشک ----
    inkCtx.save();
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkCtx.beginPath();
    inkCtx.rect(rx, ry, rw, rh);
    inkCtx.clip();
    inkCtx.globalCompositeOperation = 'destination-out';
    inkCtx.fillStyle = 'rgba(0,0,0,1)';
    inkCtx.fillRect(rx, ry, rw, rh);
    inkCtx.globalCompositeOperation = 'source-over';
    inkCtx.restore();

    /* حاشیه‌ی کَشتِ پاره‌خط‌ها از خودِ ناحیه بزرگ‌تر است.
       دلیل: گذرِ حاشیه‌ی مرکب با 'destination-over' کشیده می‌شود، پس
       دیده‌شدنش به این بستگی دارد که همسایه‌اش قبلاً رسم شده باشد یا نه.
       اگر فقط پاره‌خط‌های داخلِ ناحیه را بازرسم کنیم، همسایه‌شان نیست و
       حاشیه جایی دیده می‌شود که در بازترسیمِ کامل پنهان بود (اندازه‌گیری:
       ۲ پیکسل اختلاف). با یک حاشیه‌ی چند پیکسلی، همسایه‌ها هم بازرسم
       می‌شوند و ترتیبِ پوشانیدگی بازسازی می‌شود. هزینه: چند پاره‌خطِ
       بیشتر — ناچیز. */
    const m = cfg.maxSpacing * 3 + cfg.inkFringeMax + 2;
    const sx0 = rx - m, sy0 = ry - m, sw0 = rw + 2 * m, sh0 = rh + 2 * m;
    const region = { x: rx, y: ry, w: rw, h: rh };

    // ---- ۲) بازترسیمِ استروک‌های هم‌پوشان، هرکدام با یک ترکیبِ جدا ----
    for (const other of strokes) {
      const ob = other.bb;
      if (ob && (ob.x > sx0 + sw0 || ob.x + ob.w < sx0 ||
                 ob.y > sy0 + sh0 || ob.y + ob.h < sy0)) continue;
      const paint = () => {
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();
        let prev = null;
        for (const st of other) {
          if (st.skip || st.erased) { prev = null; continue; }
          if (prev) {
            if (segIntersects(prev, st, sx0, sy0, sw0, sh0)) renderSegment(prev, st);
          } else if (!(st.x + sampleExtent(st) < sx0 || st.x - sampleExtent(st) > sx0 + sw0 ||
                       st.y + sampleExtent(st) < sy0 || st.y - sampleExtent(st) > sy0 + sh0)) {
            drawNibDot(st);
          }
          prev = st;
        }
      };
      if (cfg.inkWetLayer) {
        drawViaWet(region, paint);
      } else {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.shadowBlur = 0;
        paint();
        ctx.restore();
      }
    }
  }

  /* =====================================================================
     پاک‌کن
     ===================================================================== */
  function eraseNear(x, y, arr, out) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const st = arr[i];
      if (st.erased) continue;
      if (Math.hypot(st.x - x, st.y - y) <= ERASER_R + sampleExtent(st) * 0.5) {
        st.erased = true;
        out.push(st);
      }
    }
  }

  function eraseMove(ev) {
    const p = pos(ev);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    const pts = [p];
    if (lastErase) {
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - lastErase.x, p.y - lastErase.y) / (ERASER_R * 0.5)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        pts.push({ x: lerp(lastErase.x, p.x, t), y: lerp(lastErase.y, p.y, t) });
      }
    }
    for (const q of pts) { ctx.moveTo(q.x + ERASER_R, q.y); ctx.arc(q.x, q.y, ERASER_R, 0, Math.PI * 2); }
    ctx.fill();
    ctx.restore();

    const out = removedStack;
    let mx = Infinity, Mx = -Infinity, my = Infinity, My = -Infinity;
    for (const q of pts) {
      if (q.x < mx) mx = q.x; if (q.x > Mx) Mx = q.x;
      if (q.y < my) my = q.y; if (q.y > My) My = q.y;
    }
    const ux = mx - ERASER_R, uy = my - ERASER_R;
    const uw = (Mx - mx) + 2 * ERASER_R, uh = (My - my) + 2 * ERASER_R;
    for (const arr of strokes) {
      const bb = arr.bb;
      if (bb && (bb.x > ux + uw || bb.x + bb.w < ux || bb.y > uy + uh || bb.y + bb.h < uy)) continue;
      for (const q of pts) eraseNear(q.x, q.y, arr, out);
    }
    for (const q of pts) eraseNear(q.x, q.y, currentStroke, out);
    lastErase = p;
  }

  function endErase(e) {
    if (!drawing) return;
    if (e && e.pointerId !== undefined && e.pointerId !== pointerId) return;
    drawing = false;
    if (removedStack.length) pushHistory({ type: 'erase', stamps: removedStack });
    removedStack = []; lastErase = null;
    mirrorSyncAll();
    gtx.clearRect(0, 0, W, H);
    status.textContent = 'پاک‌کن فعال — روی خط بکشید تا محو شود';
  }

  /* =====================================================================
     لایه‌ی ورودی (PHASE 3 / PHASE 13)
     ---------------------------------------------------------------------
     معماری:

        Pointer Events
              ↓  (فقط نوشتن در بافر — بدون هیچ رسمی)
        Ring Buffer (Float32Array)
              ↓  requestAnimationFrame
        Resampler (طولِ قوس + carry کسری)
              ↓
        Nib Contact Model → Ink Model → Geometry
              ↓
        Renderer (dirty region)

     دو تصمیمِ کلیدی که باگ #۱ را حل می‌کند:

     ۱) *یک* منبعِ ورودی.
        طبق W3C Pointer Events L3 §4.2.5:
          «اجتماعِ فهرست‌های coalesced همه‌ی pointerrawupdateهای
           ارسال‌شده از آخرین pointermove، با coalesced eventهای
           pointermove بعدی یکسان است»
          و «در این حالت‌ها احتمالاً نیازی به گوش‌دادن به انواعِ دیگرِ
           رویدادِ pointer نیست.»
        نسخه‌ی قبلی هم به pointerrawupdate گوش می‌داد و هم به
        pointermove + getCoalescedEvents ⇒ هر نمونه‌ی سخت‌افزار *دو بار*
        پردازش و رسم می‌شد (اندازه‌گیری‌شده: نسبتِ ۲٫۰۰ نمونه‌ی تحویلی).
        بدتر: چون pointermove پس از rawupdateها می‌آید، پیمایش دوباره از
        نقطه‌ی جلوتر به عقب انجام می‌شد ⇒ رسمِ رفت‌وبرگشتی، آلفای دوبار
        انباشته و سرعتِ نوسانی.

     ۲) نمونه‌برداری بر مبنای *مسافت*، با کرانِ سخت.
        قبلاً هر رویداد ⇒ یک قطعه‌ی رسم؛ تنها دروازه یک آستانه‌ی ثابتِ
        0.5px بود که به اندازه‌ی قلم کاری نداشت. حالا:
          spacing = clamp(contactSpan × spacingFactor, MIN, MAX)
          n       = clamp(ceil(dist / spacing), 1, MAX_PER_EVENT)
        و باقیمانده‌ی کسری بین رویدادها نگه داشته می‌شود.
     ===================================================================== */

  // زمینه‌ی نرمال‌سازی (شیءِ قابلِ استفاده‌ی مجدد، بدون تخصیص در مسیرِ داغ)
  const normCtx = { originX: 0, originY: 0, source: '', fallbackPressure: 0.75,
                    tiltOverride: null, pressureOverride: undefined };

  // «آیا از آخرین pointermove به این‌سو، pointerrawupdate رسیده؟»
  // طبق [PE3] §4.2.5 اجتماعِ coalesced eventهای همان rawupdateها با
  // coalesced eventهای pointermove بعدی یکسان است؛ پس اگر rawupdate آمده
  // باشد، آن pointermove تکراری است و باید نادیده گرفته شود. اگر دستگاه یا
  // مرورگری rawupdate ندهد (Safari، بسترِ غیرِ secure)، این پرچم هرگز
  // روشن نمی‌شود و pointermove خودش منبعِ ورودی می‌ماند.
  let rawSinceMove = false;
  let rawUpdateSeen = false;          // فقط برای نمایش در پنلِ اشکال‌زدایی
  let rafId = 0;
  let lastFrameMs = 0, frameAcc = 0, frameCount = 0;
  let evtWindowStart = 0, evtWindowCount = 0, sampleWindowStart = 0, sampleWindowCount = 0;

  // آخرین موقعیت/زمانِ خام — فقط برای پیش‌نمایش و شبیه‌سازیِ فشارِ ماوس
  let rawSpeed = 0;

  const F_PRESSURE = QE.FLAG_PRESSURE, F_TILT = QE.FLAG_TILT, F_TWIST = QE.FLAG_TWIST;
  const F_PTRUST = QE.FLAG_PTRUST, F_PPRIMING = QE.FLAG_PPRIMING;

  // ---- ۱) گرفتنِ رویداد: هیچ رسمی این‌جا انجام نمی‌شود -----------------
  function enqueueEvent(ev, src) {
    const r = paperRect || paper.getBoundingClientRect();
    normCtx.originX = r.left;
    normCtx.originY = r.top;
    normCtx.source = src || '';
    /* تخمینِ جانشینِ فشار (فقط اگر سخت‌افزار فشار نداشته باشد).
       نکته‌ی مهم: در آغازِ استروک سرعت *نامعلوم* است، نه صفر. اگر صفر
       بگیریم mousePressureFallback مقدارِ ۱ (تمام‌پهنا) می‌دهد و همان
       «مهرِ تمام‌پهنا در آغاز» را برای ماوس بازتولید می‌کند. پس تا وقتی
       بازنمونه‌بردار سرعتِ واقعی ندارد، از فشارِ آغازینِ کنترل‌شده استفاده
       می‌شود. */
    const spd = resampler.speed;
    normCtx.fallbackPressure = spd > 0
      ? mousePressureFallback(spd)
      : clamp01(normalizer.calibration.params.unknownPressure);

    const st = normalizer.normalize(ev, normCtx);

    let flags = 0;
    if (st.pressureSupport === SUP.SUPPORTED) flags |= F_PRESSURE;
    if (st.pressureTrusted) flags |= F_PTRUST;
    if (st.pressurePriming) flags |= F_PPRIMING;
    // اعتبارِ جهت‌گیری *در همین نمونه* — دیگر یک قفلِ چسبانِ سراسری نیست.
    // این همان چیزی است که «پریدنِ زاویه به عمودی پس از اولین حرکت» را
    // ایجاد می‌کرد: قفلِ سراسری روشن می‌ماند ولی مقدارِ tilt همان رویداد
    // صفر بود، و atan2(0,0)=0 لبه را به صفر درجه می‌کشید.
    if (st.orientationState === QS.ORIENTATION.VALID ||
        st.orientationState === QS.ORIENTATION.HELD) flags |= F_TILT;
    if (st.twistSupport === SUP.SUPPORTED && st.twist !== 0) flags |= F_TWIST;

    /* بافر: [x, y, pressure(کالیبره), lean, leanDir, twist, t, flags,
              pressureRaw, sourceCode]
       دو میدانِ آخر فقط برای *صداقتِ عیب‌یابی* است: رسم یک فریم بعد انجام
       می‌شود، پس خواندنِ normalizer.state در لحظهٔ رسم دادهٔ نمونهٔ دیگری
       را می‌دهد. لاگِ نسخهٔ قبلی همین اشتباه را داشت. */
    inputBuf.push(st.x, st.y, st.pressure, st.lean, st.leanDir, st.twist,
                  st.t, flags, st.pressureRaw,
                  QE.SRC_CODE[normCtx.source] === undefined
                    ? 0 : QE.SRC_CODE[normCtx.source]);
    stats.events++;
    evtWindowCount++;
    const sz = inputBuf.size();
    if (sz > stats.bufferPeak) stats.bufferPeak = sz;
    stats.overflow = inputBuf.overflow;
    scheduleFrame();
  }

  // یک رویداد + همه‌ی نمونه‌های coalescedش را در بافر بریز
  /* ---------------------------------------------------------------------
     ورودِ رویداد + اعتبارسنجیِ فهرستِ coalesced
     ---------------------------------------------------------------------
     [PE3] §10.3: user agent باید برای رویدادهای داخلِ فهرستِ coalesced
     «بقیه‌ی خصیصه‌ها را با مقادیرِ پیش‌فرض مقدار اولیه بدهد». مرورگری که
     این را تحت‌اللفظی اجرا کند، فرزندانی با pressure=0 و tilt=0 می‌سازد
     در حالی که والد مقدارِ درست دارد. Chrome 150 (اندازه‌گیری‌شده) آن‌ها
     را حفظ می‌کند؛ برای Firefox آزمون نشده است.

     پس به‌جای تشخیصِ مرورگر، قاعده‌ی یکپارچگیِ داده اعمال می‌شود:
       • اگر والد در تماس فشارِ مثبت دارد و هیچ فرزندی ندارد ⇒ فهرست را
         دور می‌ریزیم و از خودِ والد استفاده می‌کنیم.
       • اگر فقط شیب گم شده ⇒ فهرست را نگه می‌داریم و شیبِ والد را تزریق
         می‌کنیم.
     این همان چیزی است که می‌تواند «فشار در Firefox روی پهنا اثر ندارد»
     را توضیح دهد، و رفعش هیچ کدِ مخصوصِ مرورگر لازم ندارد.
     --------------------------------------------------------------------- */
  const coalescedStats = { used: 0, rejected: 0, tiltInjected: 0,
                           lastReason: '' };
  window.__qalamCoalesced = coalescedStats;

  function enqueueWithCoalesced(e) {
    let list = null;
    if (typeof e.getCoalescedEvents === 'function') {
      // [PE3] این متد فقط در secure context کار می‌کند و در Safari نیست
      try { list = e.getCoalescedEvents(); } catch (_) { list = null; }
    }
    if (list && list.length) {
      const v = QS.validateCoalesced(e, list);
      coalescedStats.lastReason = v.reason;
      if (!v.usable) {
        coalescedStats.rejected++;
        enqueueEvent(e, e.type + ':coalesced-rejected');
        return;
      }
      coalescedStats.used++;
      normCtx.tiltOverride = null;
      if (v.tiltFromParent) {
        coalescedStats.tiltInjected++;
        normCtx.tiltOverride = { tiltX: e.tiltX | 0, tiltY: e.tiltY | 0 };
      }
      normalizer.obs.coalescedSeen += list.length;
      for (let i = 0; i < list.length; i++) enqueueEvent(list[i], 'coalesced');
      normCtx.tiltOverride = null;
    } else {
      enqueueEvent(e, e.type);
    }
  }

  // ---- ۲) تخلیه‌ی بافر و رسم — یک بار در هر فریم ----------------------
  function scheduleFrame() {
    if (rafId) return;
    rafId = requestAnimationFrame(onFrame);
  }

  function onFrame(ts) {
    rafId = 0;
    const t0 = performance.now();
    flushInput(false);
    // آینه: رکوردهای تازهٔ همین فریم
    mirrorPumpStroke();

    // ---- آمار FPS / نرخ نمونه ----
    if (lastFrameMs) {
      frameAcc += ts - lastFrameMs;
      frameCount++;
      if (frameAcc >= 500) {
        stats.fps = Math.round(1000 / (frameAcc / frameCount));
        frameAcc = 0; frameCount = 0;
      }
    }
    lastFrameMs = ts;
    stats.frameMs = performance.now() - t0;

    const now = performance.now();
    if (now - evtWindowStart >= 1000) {
      stats.eventsPerSec = Math.round(evtWindowCount * 1000 / Math.max(1, now - evtWindowStart));
      evtWindowStart = now; evtWindowCount = 0;
    }
    if (now - sampleWindowStart >= 1000) {
      stats.samplesPerSec = Math.round(sampleWindowCount * 1000 / Math.max(1, now - sampleWindowStart));
      sampleWindowStart = now; sampleWindowCount = 0;
    }

    // HUD — حداکثر ~۱۵ بار در ثانیه
    if (now - lastUiPaint > 66) {
      lastUiPaint = now;
      hud.textContent =
        `press: ${stats.mappedPressure.toFixed(2)} | contact: ${stats.contactW.toFixed(1)}px` +
        ` | width: ${stats.apparent.toFixed(1)}px | ink: ${stats.ink.toFixed(2)}` +
        ` | v: ${(stats.velocity * 1000).toFixed(0)}px/s | nib: ${Math.round(stats.nibDeg)}°` +
        ` | ${stats.fps}fps` +
        (barrelMode && barrelHeld ? ' | ⬍ عمودی' : '');
    }

    /* مهلتِ حالتِ انتظار: قلم روی کاغذ است ولی حرکتی نکرده ⇒ نقطه/درنگِ
       واقعی. حالا با سرعتِ «نامعلوم» (نه صفر) مرکب می‌گذاریم. */
    if (drawing && strokeState === STROKE.PENDING && resampler.hasPending() &&
        (now - pendingSinceMs) >= PENDING_TIMEOUT_MS) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.shadowBlur = 0;
      resampler.flushPending(emitSample, now - pendingSinceMs);
      ctx.restore();
    }

    if (typeof updateDebugPanel === 'function') updateDebugPanel();
    // لایهٔ دستیار: HUD فشار و لایهٔ Debug — هر دو خودشان نرخِ رسم را
    // محدود می‌کنند، پس این فراخوانی در مسیرِ فریم هزینه‌ای اضافه نمی‌کند
    if (AUI) AUI.frame(now);
    if (drawing && (inputBuf.size() > 0 ||
        (strokeState === STROKE.PENDING && resampler.hasPending()))) {
      scheduleFrame();
    }
  }

  // نمونه‌های داخلِ بافر را بازنمونه و رسم می‌کند
  function flushInput(force) {
    if (inputBuf.size() === 0) return;
    syncConfig();
    nibProfileAdjust(nibEl.value);

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.shadowBlur = 0;

    const before = stats.samples;
    const budget = force ? 1e9 : cfg.maxSamplesPerFrame;
    inputBuf.drain(budget, consumeRaw);
    sampleWindowCount += stats.samples - before;

    ctx.restore();

    // نشانگرِ زاویه‌ی نوک — یک بار در هر فریم، نه در هر رویداد
    if (last && (last.nb || nibEl.value) !== 'round') {
      gtx.clearRect(0, 0, W, H);
      nibAngleIndicator(last);
    }
    stats.clamped = resampler.droppedToClamp;
  }

  /* ---------------------------------------------------------------------
     بازقیمت‌گذاریِ فشارِ نمونهٔ نخست  (رفعِ ریشه‌ایِ مسئلهٔ ۱)
     ---------------------------------------------------------------------
     نمونهٔ pointerdown در حالتِ PENDING_INPUT نگه داشته می‌شود، پس هنوز
     رسم نشده است. تا وقتی رسم نشده، حق داریم فشارش را با بهترین تخمینِ
     موجود اصلاح کنیم:

       • اگر فیلترِ فشار حالا با میانهٔ چند نمونهٔ نخست آماده شده،
         همان مقدار را می‌گذاریم؛
       • اگر هیچ نمونهٔ فشارِ قابلِ‌اعتمادی نیامده (مثلاً سخت‌افزارِ بی‌فشار
         و رویدادِ ۰٫۵ استاندارد، و قلم هم حرکت نکرده) از
         unknownPressure استفاده می‌شود — یک «فشارِ آغازینِ کنترل‌شده»،
         نه تمام‌پهنا.

     اندازه‌گیریِ پیش از این رفع (bench/diag-first-ink.html، pointerdown=0.5
     و بقیهٔ نمونه‌ها=0.15): پهنای تماسِ نمونهٔ اول 11.72px در برابر 5.07px
     پایا (۲٫۳۱ برابر) و ۱۶px مسافت تا نشستن.
     --------------------------------------------------------------------- */
  function repriceFirstSample(force) {
    if (!resampler.hasPending()) return false;
    const cal = normalizer.calibration;
    if (cal.trustedSamples > 0) {
      // فیلتر با نمونه‌های واقعی آماده شده ⇒ همان مقدار
      return resampler.repriceFirst(cal.mapped);
    }
    if (force) {
      const u = clamp01(cal.params.unknownPressure);
      return resampler.repriceFirst(Math.pow(u, Math.max(0.05, cal.params.curveExponent)));
    }
    return false;
  }

  function consumeRaw(x, y, p, lean, leanDir, twist, tMs, flags, pRaw, srcCode) {
    // فشار از قبل در stylus.js کالیبره شده است (normalize → calibration)
    leanValidNow = (flags & F_TILT) !== 0;
    twistValidNow = (flags & F_TWIST) !== 0;
    lastPress = p;
    samplePRaw = pRaw;
    sampleSrc = srcCode;
    samplePriming = (flags & F_PPRIMING) !== 0;
    samplePTrusted = (flags & F_PTRUST) !== 0;
    samplePValid = (flags & F_PRESSURE) !== 0;

    /* نمونهٔ نگه‌داشته‌شده هنوز رسم نشده؛ اگر فیلترِ فشار در این فاصله
       آماده شده باشد، همان نمونه با فشارِ درست رسم می‌شود. */
    if (resampler.hasPending() && samplePTrusted) repriceFirstSample(false);

    // گامِ نمونه‌برداری از پهنایِ *فعلیِ* سطحِ تماس می‌آید (نه از اندازه‌ی
    // قلم): قلمِ ریز گامِ کوچک‌تر می‌خواهد، ولی هرگز کمتر از minSpacing.
    const span = Math.max(cfg.minSpacing, cfg.nibWidth * clamp01(p) + cfg.nibThickness);

    resampler.feed(x, y, p, lean, leanDir, twist, tMs,
                   leanValidNow, twistValidNow, true, span, emitSample);
    rawSpeed = resampler.speed;
  }

  /* =====================================================================
     رویدادهای قلم
     ===================================================================== */
  function beginStroke(ev) {
    drawing = true;
    pointerId = ev.pointerId;
    downStamp = ev.timeStamp || 0;
    strokeSeq++;
    try { paper.setPointerCapture(pointerId); } catch (_) {}
    currentStroke = [];
    resetStrokeState();
    rawSinceMove = false;
    gtx.clearRect(0, 0, W, H);
    syncConfig();
    nibProfileAdjust(nibEl.value);

    strokeState = STROKE.PENDING;
    pendingSinceMs = performance.now();
    firstEvents.length = 0;

    // استروکِ جاری روی لایهٔ خیس نوشته می‌شود (معناشناسیِ اجتماع)
    if (cfg.inkWetLayer) { clearWet(null); ctx = wetCtx; }

    // آینه: آغازِ استروک + محیطِ رسم
    mirrorStrokeId++;
    mirrorSentCount = 0;
    mirrorSend({ t: 'begin', id: mirrorStrokeId, env: mirrorEnv() });

    // لایهٔ دستیار: انتخابِ Centerline مرجع و صفرکردنِ فیلترها
    if (AUI) {
      const p0 = pos(ev);
      AUI.beginStroke(p0.x, p0.y);
    }

    enqueueWithCoalesced(ev);
    /* در PENDING هیچ مرکبی نمی‌نشیند. رویدادِ pointerdown فقط وارد
       بازنمونه‌بردار می‌شود و همان‌جا نگه داشته می‌شود تا جهت/سرعتِ واقعی
       بیاید. پس دیگر «مهرِ تمام‌پهنا پیش از اولین حرکت» رخ نمی‌دهد. */
    flushInput(true);
  }

  paper.addEventListener('pointerdown', e => {
    // دکمه‌های کنارِ قلم (بارل): فقط وضعیت را ثبت کن، خط نکش
    if (e.pointerType === 'pen' && e.button !== 0) {
      barrelHeld = (e.buttons & (2 | 8 | 16)) !== 0;
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (drawing && currentStroke.length) {
      currentStroke.bb = strokeBounds(currentStroke);
      strokes.push(currentStroke);
      pushHistory({ type: 'stroke', data: currentStroke });
      currentStroke = [];
    }
    if (erasing) {
      drawing = true;
      pointerId = e.pointerId;
      downStamp = e.timeStamp || 0;
      try { paper.setPointerCapture(pointerId); } catch (_) {}
      lastErase = null; removedStack = [];
      eraseMove(e);
      return;
    }
    beginStroke(e);
  });

  /* ---------------------------------------------------------------------
     یک منبعِ ورودی — نه دو تا.
     pointerrawupdate پرنرخ‌ترین منبع است؛ اگر مرورگر آن را بدهد،
     pointermove برای رسم نادیده گرفته می‌شود (و برعکس).
     --------------------------------------------------------------------- */
  paper.addEventListener('pointerrawupdate', e => {
    rawUpdateSeen = true;
    rawSinceMove = true;
    if (!drawing || e.pointerId !== pointerId) return;
    if (e.pointerType === 'pen') barrelHeld = (e.buttons & (2 | 8 | 16)) !== 0;
    if (erasing) { eraseMove(e); return; }
    enqueueWithCoalesced(e);
  });

  paper.addEventListener('pointermove', e => {
    if (!drawing || e.pointerId !== pointerId) return;
    if (e.pointerType === 'pen') barrelHeld = (e.buttons & (2 | 8 | 16)) !== 0;
    if (erasing) { eraseMove(e); return; }
    // rawupdateهای همین فریم، همین نمونه‌ها را قبلاً تحویل داده‌اند
    if (rawSinceMove) { rawSinceMove = false; return; }
    enqueueWithCoalesced(e);
  });

  // اگر دکمه‌ی بارل رویدادها را قطع کرده بود و نوکِ قلم هنوز روی کاغذ است
  paper.addEventListener('pointermove', e => {
    if (drawing || erasing || e.pointerType !== 'pen') return;
    if ((e.buttons & 1) !== 0) beginStroke(e);
  });

  paper.addEventListener('pointerup', e => {
    // رهاییِ دکمه‌ی کنارِ قلم نباید خط را تمام کند
    if (e.pointerType === 'pen' && e.button !== 0) { barrelHeld = false; return; }
    erasing ? endErase(e) : endStroke(e);
  });
  paper.addEventListener('pointercancel', e => {
    // کانسلِ ناشی از دکمه‌ی کنارِ قلم (بارل) — نباید خط را قطع کند
    if (e.pointerType === 'pen' && barrelHeld) return;
    erasing ? endErase(e) : endStroke(e);
  });
  // راست‌کلیکِ قلم (دکمه‌ی بارل) هرگز نباید منوی مرورگر را باز کند
  document.addEventListener('contextmenu', e => e.preventDefault());
  paper.addEventListener('lostpointercapture', e => {
    /* فقط از دست‌رفتنِ capture برای اشاره‌گرِ *دیگری* (یا وقتی نمی‌نویسیم)
       باید وضعیت را پاک کند.
       نسخهٔ قبلی این تصمیم را با مقایسهٔ e.timeStamp و downStamp می‌گرفت.
       این شکننده است: مبنا و دقتِ DOMHighResTimeStamp و ترتیبِ نسبیِ
       رویدادهای capture بین مرورگرها تضمین‌شده نیست؛ یک مقایسهٔ اشتباه،
       استروکِ در جریان را بی‌صدا قطع می‌کند و کاربر آن را «فشار اثر
       ندارد» می‌بیند. شناسهٔ اشاره‌گر یک معیارِ قطعی و مرورگرمستقل است. */
    if (drawing && e.pointerId === pointerId) return;
    drawing = false;
    if (cfg.inkWetLayer) { ctx = inkCtx; clearWet(null); }
    resetStrokeState();
    lastErase = null; barrelHeld = false;
    rawSinceMove = false;
  });

  // پیش‌نمایش نوک روی برگه
  paper.addEventListener('pointermove', e => {
    if (drawing || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    if (e.pointerType === 'pen') barrelHeld = (e.buttons & (2 | 8 | 16)) !== 0;
    const p = pos(e);
    /* حالتِ Hover (بخش ۴۷): هیچ استروکی ساخته نمی‌شود، ولی HUD می‌تواند
       فشارِ لحظه‌ای را نشان دهد. فشار از خودِ رویداد خوانده می‌شود و اگر
       سخت‌افزار فشار ندهد، HUD صریحاً «Pressure unavailable» می‌گوید. */
    if (AUI) {
      const raw = QS.normalizeRawPressure(e.pressure);
      const sup = normalizer.pressureSupport();
      AUI.hover(raw === QS.PRESSURE_INVALID ? 0 : raw,
                sup === SUP.SUPPORTED, sup === SUP.UNSUPPORTED);
      AUI.frame(performance.now());
    }
    gtx.clearRect(0, 0, W, H);
    if (erasing) {
      gtx.save(); gtx.globalAlpha = .5;
      gtx.strokeStyle = '#b3271f'; gtx.lineWidth = 1.5;
      gtx.beginPath(); gtx.arc(p.x, p.y, ERASER_R, 0, Math.PI * 2); gtx.stroke();
      gtx.restore();
      return;
    }
    drawNibPreview(p.x, p.y);
  });
  paper.addEventListener('pointerleave', () => { gtx.clearRect(0, 0, W, H); });

  // نشانگرِ زنده‌ی زاویهٔ نوک روی برگه — با دکمه‌ی قلم قرمز و کاملاً عمودی می‌شود
  function nibAngleIndicator(st) {
    const vertical = barrelMode && barrelHeld;
    const ang = (vertical ? 90 : st.ang) * Math.PI / 180;
    /* نشانگر باید *سطحِ تماسِ فعلی* را نشان دهد، نه کلِ پهنای نوک.
       نسخهٔ قبلی همیشه تمامِ پهنا را می‌کشید و در فشارِ کم یک خطِ راهنمای
       تمام‌پهنا روی برگه دیده می‌شد. */
    const halfContact = (st.uh != null && st.nw != null)
      ? Math.max(Math.abs(st.uh), Math.abs(st.ut)) * st.nw * 0.5
      : st.r * nibRatio() * 0.5 * 0.9;
    const a = Math.max(4, halfContact);
    const c = Math.cos(ang), s = Math.sin(ang);
    const x = st.x, y = st.y;
    gtx.save();
    gtx.lineCap = 'round';
    gtx.globalAlpha = vertical ? .95 : .55;
    gtx.strokeStyle = vertical ? '#e04020' : 'rgba(20,14,8,.6)';
    gtx.lineWidth = 1.6;
    gtx.beginPath();
    gtx.moveTo(x - c * a, y - s * a);
    gtx.lineTo(x + c * a, y + s * a);
    gtx.stroke();
    if (vertical) {
      gtx.globalAlpha = .85;
      gtx.strokeStyle = 'rgba(224,64,32,.75)';
      gtx.lineWidth = 1;
      gtx.setLineDash([3, 3]);
      gtx.beginPath(); gtx.moveTo(x, y - a * 1.7); gtx.lineTo(x, y + a * 1.7); gtx.stroke();
      gtx.setLineDash([]);
    }
    gtx.restore();
  }

  function drawNibPreview(x, y) {
    const r = penSize();
    const psc = 0.55;                      // پیش‌نمایش کوچک‌تر/کم‌کلفت‌تر از نوکِ واقعی
    const t = Math.max(0.4, r * 0.35 * psc);
    const vertical = barrelMode && barrelHeld;
    const ang = (vertical ? 90 : Number(angleEl.value)) * Math.PI / 180;
    const a = r * nibRatio() * 0.5 * psc, b = t;
    const c = Math.cos(ang), s = Math.sin(ang);
    gtx.save();
    gtx.lineCap = 'round';
    gtx.globalAlpha = vertical ? .95 : .5;
    // حالت عمودی: خط به‌رنگِ قرمزِ درخشان — دیده‌شدنِ صاف‌شدنِ قلم واضح است
    gtx.strokeStyle = vertical ? '#e04020' : inkColor();
    gtx.lineWidth = Math.max(0.6, b);
    gtx.beginPath();
    gtx.moveTo(x - a * c, y - a * s);
    gtx.lineTo(x + a * c, y + a * s);
    gtx.stroke();
    gtx.globalAlpha = vertical ? 1 : .85;
    gtx.lineWidth = Math.max(1, b + 1.5);
    gtx.strokeStyle = 'rgba(20,14,8,.9)';
    gtx.stroke();
    // خطِ محورِ عمودیِ راهنما در حالت دکمه‌ی قلم
    if (vertical) {
      gtx.globalAlpha = .9;
      gtx.strokeStyle = 'rgba(224,64,32,.8)';
      gtx.lineWidth = 1;
      gtx.setLineDash([3, 3]);
      gtx.beginPath(); gtx.moveTo(x, y - a * 2.2); gtx.lineTo(x, y + a * 2.2); gtx.stroke();
      gtx.setLineDash([]);
    }
    gtx.restore();
  }

  /* =====================================================================
     کنترل‌ها
     ===================================================================== */
  lightBtn.addEventListener('click', () => {
    lightPen = !lightPen;
    lightBtn.classList.toggle('active', lightPen);
    lightBtn.textContent = lightPen ? 'روشن' : 'خاموش';
    status.textContent = lightPen ? 'قلم نوری روشن شد — خط با هاله‌ی نور می‌درخشد' : 'قلم نوری خاموش شد';
  });

  const PAPER_BTN = {
    daftari: 'paperDaftari', gloss: 'paperGloss', traditional: 'paperTraditional',
    tazhib: 'paperTazhib', kashi: 'paperKashi',
    custom: 'paperImageBtn',
  };
  const PAPER_NOTE = {
    daftari: 'کاغذ دفتری (مشق) — جذب مرکب، خطوط راهنما',
    gloss: 'کاغذ گلاسه / روغنی — سطح براق، خط تیز و تمیز',
    traditional: 'کاغذ سنتی دست‌ساز — بافت عمیق و کهنه',
    tazhib: 'تذهیب — کادرِ مُذهَّب و شنگرف؛ رنگِ قلم روی مرکبِ کهنه تنظیم شد',
    kashi: 'کاشی‌کاری — لاجورد و فیروزه؛ رنگِ قلم روی سفیدِ کتیبه تنظیم شد',
    custom: 'پس‌زمینهٔ عکسِ دلخواه — رنگِ قلم از پالتِ خودِ عکس اندازه‌گیری شد',
  };

  const setPaper = (type) => {
    const prev = paperType;
    paperType = type;
    for (const k in PAPER_BTN) {
      const b = $(PAPER_BTN[k]);
      if (b) b.classList.toggle('active', k === type);
    }
    const P = PAPER_PRESETS[paperType];

    /* رنگِ قلمِ متناسب با کاغذ.
       ---------------------------------------------------------------
       روی کاغذِ لاجوردیِ کاشی، مرکبِ تیره دیده نمی‌شود؛ کتیبه‌های کاشی هم
       در واقعیت سفید/فیروزه‌ای‌اند. پس هر کاغذ می‌تواند رنگِ پیش‌فرضِ خودش
       را داشته باشد (inkDefault) و فقط وقتی اعمال می‌شود که کاربر خودش
       رنگ را دست‌کاری نکرده باشد یا رنگِ فعلی رنگِ پیش‌فرضِ کاغذِ قبلی
       باشد — تا انتخابِ آگاهانهٔ کاربر از بین نرود. */
    const prevDefault = PAPER_PRESETS[prev] && PAPER_PRESETS[prev].inkDefault;
    if (P.inkDefault && colorEl &&
        (!userPickedColor || colorEl.value === prevDefault)) {
      suppressColorFlag = true;
      colorEl.value = P.inkDefault;
      colorEl.dispatchEvent(new Event('input', { bubbles: true }));
      suppressColorFlag = false;
    }

    renderPaper();
    for (const stroke of strokes) {
      for (const st of stroke) {
        const t = clamp((1 - (st.fade || 1)) / 0.75, 0, 1) * 0.82;
        // نکته: st.inkAmt یک *عدد* است (مقدارِ مرکب)، نه رنگ. رنگِ پایه
        // در st.baseColor/st.color نگه داشته می‌شود.
        st.color = mixHex(st.baseColor || st.color || inkColor(), P.baseColor, t);
      }
    }
    redraw();
    // آینه زمینهٔ خودش را دارد، ولی رنگِ مرکب عوض شده
    mirrorSyncAll();
    /* لایهٔ دستیار: تصویرِ مرجع «کاغذِ عکسِ دلخواه» است. وقتی کاربر به یک
       کاغذِ دیگر می‌رود، دیگر مرجعی روی صفحه نیست، پس تحلیل هم باید کنار
       گذاشته شود — وگرنه مسیر به Centerlineای اصلاح می‌شد که کاربر
       نمی‌بیندش. */
    if (AUI) {
      if (paperType === 'custom' && customImage) AUI.setReference(customImage);
      else AUI.setReference(null);
    }
    status.textContent = PAPER_NOTE[type] || '';
  };
  for (const k in PAPER_BTN) {
    const b = $(PAPER_BTN[k]);
    // دکمهٔ «عکس دلخواه» فایل می‌خواهد، پس مسیرِ خودش را دارد
    if (b && k !== 'custom') b.onclick = () => setPaper(k);
  }

  // ---- دکمه‌های ابزار ----
  for (const k in TOOLS) {
    const b = $('tool_' + k);
    if (b) b.onclick = () => setTool(k);
  }

  /* ---- عکسِ دلخواه: دکمه، انتخابِ فایل، و کشیدن‌ورهاکردن ------------- */
  {
    const btn = $('paperImageBtn'), inp = $('paperImage'), veil = $('bgVeil');
    if (btn && inp) {
      btn.onclick = () => inp.click();
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        if (f) loadPaperImage(f);
        inp.value = '';           // انتخابِ دوبارهٔ همان فایل هم کار کند
      });
    }
    if (veil) {
      veil.addEventListener('input', () => {
        if (paperType !== 'custom' || !customImage) return;
        /* پردهٔ محو روشناییِ دیده‌شده را عوض می‌کند، پس تصمیمِ «قلمِ تیره یا
           روشن» هم باید از نو گرفته شود — وگرنه با محوِ زیاد روی عکسِ
           تیره، قلمِ روشن روی زمینهٔ روشن‌شده گم می‌شد. */
        const pal = measureImagePalette(customImage);
        const prevDefault = PAPER_PRESETS.custom.inkDefault;
        applyImagePalette(pal);
        if (!userPickedColor && colorEl &&
            (colorEl.value === prevDefault || !colorEl.value)) {
          suppressColorFlag = true;
          colorEl.value = PAPER_PRESETS.custom.inkDefault;
          colorEl.dispatchEvent(new Event('input', { bubbles: true }));
          suppressColorFlag = false;
        }
        renderPaper();
        redraw();
      });
    }
    // کشیدن و رهاکردنِ عکس روی کاغذ
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    paper.addEventListener('dragover', e => {
      stop(e);
      try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    });
    paper.addEventListener('drop', e => {
      stop(e);
      const dt = e.dataTransfer;
      const f = dt && dt.files && dt.files[0];
      if (f) loadPaperImage(f);
      else status.textContent = 'فقط فایلِ عکس پذیرفته می‌شود (نه نشانیِ بیرونی) ' +
                                'تا خروجیِ PNG سالم بمانَد.';
    });
  }
  window.__qalamPaper = {
    loadPaperImage, measureImagePalette, applyImagePalette, setPaper,
    get customImage() { return customImage; },
    presets: PAPER_PRESETS,
  };

  $('clear').onclick = () => {
    strokes = []; currentStroke = []; history = [];
    overlayLabels = [];
    resetStrokeState();
    ctx = inkCtx;
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkCtx.clearRect(0, 0, W, H);
    inkCtx.shadowBlur = 0;
    clearWet(null);
    gtx.clearRect(0, 0, W, H);
    mirrorSend({ t: 'clear' });
  };
  $('undo').onclick = () => {
    const act = history.pop();
    if (!act) return;
    if (act.type === 'stroke') {
      const i = strokes.lastIndexOf(act.data);
      if (i > -1) strokes.splice(i, 1);
    } else {
      for (const st of act.stamps) st.erased = false;
    }
    redraw();
    mirrorSyncAll();
  };
  $('eraserBtn').onclick = () => {
    erasing = !erasing;
    $('eraserBtn').classList.toggle('active', erasing);
    paper.style.cursor = erasing ? 'none' : 'crosshair';
    status.textContent = erasing ? 'پاک‌کن فعال — روی خط بکشید تا محو شود' : 'پاک‌کن خاموش شد';
  };
  /* =====================================================================
     صدورِ PNG با کیفیتِ بالا
     ---------------------------------------------------------------------
     نسخه‌ی قبلی همان بومِ نمایش را کپی می‌کرد، پس کیفیتِ خروجی برابرِ
     dpr نمایشگر بود (روی نمایشگرِ معمولی: ۱ برابر) و بزرگ‌کردنش فقط
     درون‌یابیِ پیکسل می‌شد.

     اکنون خروجی از *رکوردها* در مقیاسِ دلخواه از نو رستریزه می‌شود:
     همان هندسهٔ سطحِ تماس، همان مدلِ مرکب، ولی روی شبکهٔ ریزتر. بافتِ
     کاغذ هم در همان مقیاس از نو ساخته می‌شود (بذرش ثابت است، پس همان
     بافت است نه بافتی تازه).

     پیاده‌سازی عمداً همان مسیرِ رسمِ عادی را به کار می‌گیرد و فقط dpr را
     موقتاً بالا می‌برد؛ این‌طور هیچ کدِ رسمِ دومی وجود ندارد که با کدِ
     اصلی از هم بپاشد. در پایان، اندازه‌ها و بافت بازگردانده می‌شوند.

     چون toDataURL هم‌زمان (sync) است، مرورگر بین این دو حالت چیزی رسم
     نمی‌کند و کاربر پرش نمی‌بیند.
     ===================================================================== */
  const EXPORT_MAX_PIXELS = 40e6;     // کرانِ حافظه‌ی بوم (~۴۰ مگاپیکسل)

  function exportScaleOf() {
    const el = $('exportScale');
    const v = el ? Number(el.value) : 2;
    return clamp(isFinite(v) && v > 0 ? v : 2, 1, 8);
  }

  function applyCanvasSize() {
    for (const c of [paperTex, ink, wet, guide]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    xtra.width = Math.round(W * dpr);
    xtra.height = Math.round(H * dpr);
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ptx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function renderAtScale(scale, fn) {
    const savedDpr = dpr;
    const savedCtx = ctx;
    let target = clamp(scale, 1, 8);
    // کرانِ حافظه: اگر بوم بزرگ‌تر از حد شود، مقیاس کم می‌شود
    while (target > 1 && W * H * target * target > EXPORT_MAX_PIXELS) target -= 0.5;
    dpr = target;
    ctx = inkCtx;
    try {
      applyCanvasSize();
      renderPaper();
      redraw();
      return fn(target);
    } finally {
      dpr = savedDpr;
      ctx = savedCtx;
      applyCanvasSize();
      renderPaper();
      redraw();
    }
  }

  function exportPNG() {
    const scale = exportScaleOf();
    const url = renderAtScale(scale, () => {
      const out = document.createElement('canvas');
      out.width = ink.width;
      out.height = ink.height;
      const o = out.getContext('2d');
      o.drawImage(paperTex, 0, 0);
      o.drawImage(ink, 0, 0);
      // اگر در میانهٔ یک استروک ذخیره شد، لایهٔ خیس هم باید در خروجی باشد
      o.drawImage(wet, 0, 0);
      return out.toDataURL('image/png');
    });
    const a = document.createElement('a');
    a.download = 'neyestan-nastaliq@' + exportScaleOf() + 'x.png';
    a.href = url;
    a.click();
    status.textContent = 'PNG با مقیاس ' + exportScaleOf() + '× ذخیره شد (' +
      Math.round(W * exportScaleOf()) + '×' + Math.round(H * exportScaleOf()) + ' پیکسل)';
  }
  $('save').onclick = exportPNG;
  window.__qalamExport = { exportPNG, renderAtScale, exportScaleOf };

  $('twistMode').onclick = () => {
    $('twistMode').classList.add('active');
    $('motionMode').classList.remove('active');
    $('dynamicMode').classList.remove('active');
    status.textContent = 'زاویه ثابت — زاویه قلم با اسلایدر تنظیم می‌شود';
  };
  $('motionMode').onclick = () => {
    $('motionMode').classList.add('active');
    $('twistMode').classList.remove('active');
    $('dynamicMode').classList.remove('active');
    status.textContent = 'جهت حرکت — نوک قلم در جهت حرکت می‌چرخد';
  };
  $('dynamicMode').onclick = () => {
    $('dynamicMode').classList.add('active');
    $('twistMode').classList.remove('active');
    $('motionMode').classList.remove('active');
    status.textContent = 'زاویه داینامیک — از وضعیت واقعی قلم دیجیتال';
  };

  $('vertBtn').onclick = () => {
    barrelMode = !barrelMode;
    $('vertBtn').classList.toggle('active', barrelMode);
    status.textContent = barrelMode
      ? 'نگه‌داشتن دکمه‌ی قلم (XP-Pen) → نوک عمودی می‌شود'
      : 'دکمه‌ی قلم غیرفعال است';
  };

  // Ink API برای پیش‌رسمِ بدون تأخیر
  let inkPresenter = null;
  try {
    if (navigator.ink && typeof navigator.ink.requestPresenter === 'function') {
      navigator.ink.requestPresenter({ presentationArea: paper })
        .then(p => { inkPresenter = p; })
        .catch(() => {});
    }
  } catch (_) {}
  /* ---------------------------------------------------------------------
     ردِ کم‌تأخیرِ واگذارشده (Ink API) — علتِ سومِ مسئلهٔ ۱
     ---------------------------------------------------------------------
     ‏`navigator.ink` فقط در Chromium وجود دارد (اندازه‌گیری‌شده در
     bench/probe.html: Chrome ⇒ دارد). این ردّ را **کامپوزیتور** رسم
     می‌کند، پیش از مرکبِ JS، و شکلش یک **دیسکِ گِرد** است.

     نسخهٔ قبلی قطرش را از `last.r * 0.5 + last.t` می‌گرفت، یعنی از
     *اسلایدرِ اندازهٔ قلم* — کاملاً مستقل از فشار. نتیجه: با فشارِ کم هم
     یک لکهٔ گِردِ پهن در لحظهٔ نشستنِ قلم ظاهر می‌شد که فقط در Chrome
     دیده می‌شد. این سومین علتِ «تمام‌پهنا بودنِ آغازِ استروک» بود.

     اصلاح:
       • در حالتِ PENDING/آغاز هیچ ردی ارائه نمی‌شود؛
       • قطر از پهنای *واقعیِ دیده‌شدهٔ* سطحِ تماس (ap) می‌آید و به آن
         محدود می‌شود؛
       • برای نوکِ تختِ نی، دیسکِ گِرد نمایندهٔ درستی نیست، پس قطر به
         ضخامتِ تماس محدود می‌شود تا از هندسهٔ واقعی بزرگ‌تر نشود.
     --------------------------------------------------------------------- */
  let inkTrailEnabled = true;
  window.__qalamInkTrail = v => { inkTrailEnabled = !!v; };

  function inkTrail(e) {
    if (!inkTrailEnabled || !inkPresenter || !drawing || !e) return;
    // در انتظارِ نمونهٔ معتبر هیچ چیزی رسم نمی‌شود
    if (strokeState !== STROKE.ACTIVE || !last) return;
    const ap = last.ap == null ? 0 : last.ap;
    const ct = last.ct == null ? 1 : last.ct;
    // نه پهن‌تر از خودِ خط، و نه پهن‌تر از ضخامتِ تیغه‌ی نوک
    const d = Math.min(ap, Math.max(1, ct));
    if (!(d > 0.6)) return;
    try {
      inkPresenter.updateInkTrailStartPoint(e, {
        color: getInkColor(last.color || inkColor(), pointDensity(last), false),
        diameter: d,
      });
    } catch (_) {}
  }
  paper.addEventListener('pointermove', e => inkTrail(e));

  /* =====================================================================
     برچسب‌های روپوش (برای شبکه‌ی آزمون) — در بازترسیم هم بازسازی می‌شوند
     ===================================================================== */
  let overlayLabels = [];
  function drawOverlayLabels() {
    if (!overlayLabels.length) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7a5c3a';
    ctx.font = '12px Tahoma, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const l of overlayLabels) ctx.fillText(l.text, l.x, l.y);
    ctx.restore();
  }

  /* =====================================================================
     تولیدِ استروکِ مصنوعی — پایه‌ی «شبکهٔ آزمون فشار» و تست‌های خودکار
     ---------------------------------------------------------------------
     همان زنجیره‌ی موتور را طی می‌کند (فشار → سطح تماس → مرکب → هندسه)
     ولی به وضعیتِ زنده‌ی نوشتن دست نمی‌زند.
     ===================================================================== */
  function synthStroke(pts, pressureFn, dtMs) {
    syncConfig();
    nibProfileAdjust(nibEl.value);
    const rs = new QE.Resampler(cfg);
    const cal = new QS.PressureCalibration(normalizer.calibration.params);
    const c = new QE.ContactState();
    const ik = new QE.InkState();
    const out = [];
    dtMs = dtMs || 5;

    // EMA فشار را با مقدارِ آغازین گرم کن تا ردیفِ آزمون واقعاً همان فشار باشد
    const p0 = pressureFn(0);
    cal.reset();
    for (let i = 0; i < 25; i++) cal.process(p0, true);

    /* امضای موتور: computeContact(out, cfg, pMapped, speed, dirRad, orient,
       prevLean) و computeInk(out, cfg, ratio, speed, dwellMs, arc, pushPull,
       area, dtMs). نسخهٔ قبلیِ این تابع امضای *قدیمیِ* ده‌آرگومانی را صدا
       می‌زد، پس شبکهٔ آزمونِ فشار و تست‌های واحد در واقع مسیرِ دیگری را
       می‌سنجیدند (سرعت و مرکب اشتباه بود). */
    let prevL = 0;
    const onSample = (x, y, rp, tx, ty, tw, t, dir, speed, dwell, arc) => {
      QE.computeContact(c, cfg, rp, speed, dir, null, prevL);
      prevL = c.lean;
      QE.computeInk(ik, cfg, c.ratio, speed, dwell, arc, c.pushPull,
                    c.width * c.thickness, dtMs);
      out.push(makeRecord(x, y, c.angleRad * 180 / Math.PI, c, ik, speed, dir));
    };

    for (let i = 0; i < pts.length; i++) {
      const u = pts.length > 1 ? i / (pts.length - 1) : 0;
      const p = cal.process(pressureFn(u), true);
      const span = Math.max(cfg.minSpacing, cfg.nibWidth * p + cfg.nibThickness);
      rs.feed(pts[i].x, pts[i].y, p, 0, 0, 0, i * dtMs, false, false, true,
              span, onSample);
    }
    // نمونهٔ نگه‌داشته‌شده (نقطهٔ آغاز) هم باید ثبت شود — و در *ابتدای*
    // آرایه، وگرنه ترتیبِ پاره‌خط‌ها به‌هم می‌ریزد
    if (rs.hasPending()) {
      const tmp = [];
      const collect = (x, y, rp, tx, ty, tw, t, dir, speed, dwell, arc) => {
        QE.computeContact(c, cfg, rp, speed, dir, null, prevL);
        QE.computeInk(ik, cfg, c.ratio, speed, dwell, arc, c.pushPull,
                      c.width * c.thickness, dtMs);
        tmp.push(makeRecord(x, y, c.angleRad * 180 / Math.PI, c, ik, speed, dir));
      };
      rs.flushPending(collect, 0);
      for (let i = tmp.length - 1; i >= 0; i--) out.unshift(tmp[i]);
    }
    return out;
  }

  function commitStroke(recs, taper) {
    if (!recs.length) return null;
    if (taper) applyTailTaper(recs);
    recs.bb = strokeBounds(recs);
    strokes.push(recs);
    pushHistory({ type: 'stroke', data: recs });
    // همان مسیرِ «اجتماع + یک ترکیب» که استروکِ زنده طی می‌کند
    drawStrokeUnion(recs);
    return recs;
  }

  /* =====================================================================
     شبکهٔ آزمون فشار (PHASE 21)
     ---------------------------------------------------------------------
     همه‌ی ردیف‌ها پهنای نوکِ *یکسان* دارند و فقط فشار عوض می‌شود؛ پس
     چیزی که چشم می‌بیند این است:
         فشار  →  سطحِ تماس  →  نشستِ مرکب
     نه:
         فشار  →  شفافیت
     ===================================================================== */
  const GRID_LEVELS = [0.1, 0.25, 0.5, 0.75, 1.0];
  function drawPressureGrid() {
    const rows = GRID_LEVELS.length;
    const marginX = 88, marginTop = 46;
    const usableH = H - marginTop - 40;
    const step = Math.max(28, Math.min(90, usableH / rows));
    const x0 = marginX, x1 = W - 36;
    if (x1 - x0 < 60) return;

    overlayLabels = [];
    for (let r = 0; r < rows; r++) {
      const y = marginTop + step * (r + 0.5);
      const pts = [];
      const n = 90;
      for (let i = 0; i < n; i++) {
        pts.push({ x: x0 + (x1 - x0) * (i / (n - 1)), y: y });
      }
      const lvl = GRID_LEVELS[r];
      const recs = synthStroke(pts, () => lvl, 6);
      commitStroke(recs, false);
      const cw = recs.length ? recs[Math.floor(recs.length / 2)].cw : 0;
      overlayLabels.push({
        x: 8, y: y,
        text: 'p=' + lvl.toFixed(2) + '  →  ' + cw.toFixed(2) + 'px',
      });
    }
    drawOverlayLabels();
    status.textContent =
      'شبکهٔ آزمون فشار: پهنای نوک ثابت است؛ آنچه تغییر می‌کند سطحِ تماس است، نه شفافیت.';
  }

  if ($('gridBtn')) $('gridBtn').addEventListener('click', drawPressureGrid);

  /* =====================================================================
     پنل کالیبراسیون (PHASE 20)
     ===================================================================== */
  const dbg = $('dbg');
  const dbgOn = () => dbg && !dbg.hidden;
  if ($('dbgToggle')) {
    $('dbgToggle').addEventListener('click', () => {
      dbg.hidden = !dbg.hidden;
      $('dbgToggle').classList.toggle('active', !dbg.hidden);
      if (!dbg.hidden) { drawCurveView(); updateDebugPanel(); }
    });
  }
  if ($('dbgClose')) {
    $('dbgClose').addEventListener('click', () => {
      dbg.hidden = true;
      $('dbgToggle').classList.remove('active');
    });
  }

  // ---- اسلایدرهای پارامتر (PHASE 16) ----
  const TUNE_UI = [
    ['t_pexp', 'pressureExponent', 2],
    ['t_psm', 'pressureSmoothing', 2],
    ['t_minc', 'minContactRatio', 2],
    ['t_heel', 'heelLift', 2],
    ['t_spf', 'spacingFactor', 2],
    ['t_minsp', 'minSpacing', 2],
    ['t_maxev', 'maxSamplesPerEvent', 0],
    ['t_vink', 'velocityInkInfluence', 2],
    ['t_vw', 'velocityWidthInfluence', 2],
    ['t_floor', 'inkDensityFloor', 2],
    ['t_pool', 'dwellPooling', 2],
    ['t_start', 'startInkBoost', 2],
    ['t_tail', 'tailLength', 0],
    ['t_tilt', 'tiltInfluence', 2],
    ['t_tiltc', 'tiltContactInfluence', 2],
    ['t_round', 'nibCornerRound', 2],
    ['t_mm', 'nibWidthMm', 1],
  ];
  function syncTuneUI() {
    for (const [id, key, dp] of TUNE_UI) {
      const el = $(id), lab = $(id + 'Val');
      if (!el) continue;
      el.value = String(TUNE[key]);
      if (lab) lab.textContent = Number(TUNE[key]).toFixed(dp);
    }
  }
  for (const [id, key, dp] of TUNE_UI) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('input', () => {
      TUNE[key] = Number(el.value);
      const lab = $(id + 'Val');
      if (lab) lab.textContent = Number(el.value).toFixed(dp);
      syncConfig();
      drawCurveView();
    });
  }
  if ($('t_reset')) {
    $('t_reset').addEventListener('click', () => {
      for (const [, key] of TUNE_UI) TUNE[key] = QE.DEFAULTS[key];
      syncTuneUI();
      syncConfig();
      drawCurveView();
    });
  }
  syncTuneUI();

  // بازکردنِ پنل با ?debug=1 یا کلیدِ Ctrl+Shift+D — مستقل از مرورگر
  try {
    if (/[?&]debug=1/.test(location.search) && dbg) {
      dbg.hidden = false;
      $('dbgToggle').classList.add('active');
    }
  } catch (_) {}
  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      if (!dbg) return;
      dbg.hidden = !dbg.hidden;
      $('dbgToggle').classList.toggle('active', !dbg.hidden);
      if (!dbg.hidden) { drawCurveView(); updateDebugPanel(); }
    }
  });

  // ---- نمودار منحنی فشار ----
  function drawCurveView() {
    const cv = $('d_curve');
    if (!cv || !dbgOn()) return;
    const c2 = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    c2.clearRect(0, 0, w, h);
    c2.strokeStyle = '#e0d6c4';
    c2.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = h * i / 4;
      c2.beginPath(); c2.moveTo(0, gy); c2.lineTo(w, gy); c2.stroke();
      const gx = w * i / 4;
      c2.beginPath(); c2.moveTo(gx, 0); c2.lineTo(gx, h); c2.stroke();
    }
    // منحنیِ فشار → نسبتِ سطحِ تماس
    c2.strokeStyle = '#6b4e32';
    c2.lineWidth = 1.6;
    c2.beginPath();
    for (let i = 0; i <= 60; i++) {
      const p = i / 60;
      const m = Math.pow(p, Math.max(0.05, normalizer.calibration.params.curveExponent));
      const ratio = clamp01(cfg.minContactRatio +
                            m * (cfg.maxContactRatio - cfg.minContactRatio));
      const x = p * (w - 2) + 1, y = h - 1 - ratio * (h - 2);
      i ? c2.lineTo(x, y) : c2.moveTo(x, y);
    }
    c2.stroke();
    // خطِ مرجعِ خطی
    c2.strokeStyle = '#c9beabaa';
    c2.setLineDash([3, 3]);
    c2.beginPath(); c2.moveTo(1, h - 1); c2.lineTo(w - 1, 1); c2.stroke();
    c2.setLineDash([]);
  }

  // ---- نمای سطحِ تماسِ نوک ----
  function drawNibView() {
    const cv = $('d_nibview');
    if (!cv || !dbgOn()) return;
    const c2 = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    c2.clearRect(0, 0, w, h);
    const nibW = cfg.nibWidth;
    const sc = Math.min((w - 16) / Math.max(1, nibW), 6);
    const cx = w / 2, cy = h / 2;
    const ang = (stats.nibDeg || cfg.nibAngle) * Math.PI / 180;

    // پهنای کاملِ نوک (خط‌چین)
    c2.strokeStyle = '#c9beab';
    c2.setLineDash([3, 3]);
    c2.lineWidth = 1;
    c2.beginPath();
    c2.moveTo(cx - Math.cos(ang) * nibW * 0.5 * sc, cy - Math.sin(ang) * nibW * 0.5 * sc);
    c2.lineTo(cx + Math.cos(ang) * nibW * 0.5 * sc, cy + Math.sin(ang) * nibW * 0.5 * sc);
    c2.stroke();
    c2.setLineDash([]);

    // سطحِ تماسِ فعلی
    const cwv = stats.contactW || 0, ctv = Math.max(0.5, stats.contactT || 0.5);
    const off = stats.contactOffset || 0;
    QE.footprint(fpA, cx, cy, ang, cwv * sc, Math.max(2, ctv * sc), off * sc);
    c2.fillStyle = '#6b4e32';
    c2.beginPath();
    c2.moveTo(fpA[0], fpA[1]);
    c2.lineTo(fpA[2], fpA[3]);
    c2.lineTo(fpA[4], fpA[5]);
    c2.lineTo(fpA[6], fpA[7]);
    c2.closePath();
    c2.fill();

    // جهتِ حرکت
    if (stats.velocity > 0.001) {
      const d = stats.dirDeg * Math.PI / 180;
      c2.strokeStyle = '#b3271f';
      c2.lineWidth = 1.2;
      c2.beginPath();
      c2.moveTo(cx, cy);
      c2.lineTo(cx + Math.cos(d) * 26, cy + Math.sin(d) * 26);
      c2.stroke();
    }
  }

  const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const setBar = (id, v) => {
    const el = $(id);
    if (el) el.style.width = (clamp01(v) * 100).toFixed(1) + '%';
  };

  /* ---- برچسبِ خوانا برای سه‌حالتِ پشتیبانی -----------------------
     هرگز کلِ UI پنهان نمی‌شود؛ فقط وضعیت صادقانه نوشته می‌شود. */
  function supLabel(v) {
    if (v === SUP.SUPPORTED) return 'پشتیبانی می‌شود';
    if (v === SUP.UNSUPPORTED) return 'پشتیبانی نمی‌شود';
    return 'نامعلوم (هنوز داده‌ای نیامده)';
  }
  const yn = b => (b ? 'دارد' : 'ندارد');

  function updateCapabilityPanel() {
    if (!dbgOn()) return;
    const rep = normalizer.capabilityReport();
    setTxt('c_ptype', rep.pointerType || '—');
    setTxt('c_pressure', supLabel(rep.pressure) +
      (stats.pressureIsFallback ? ' — جانشین فعال' : ''));
    setTxt('c_tilt', supLabel(rep.tilt));
    setTxt('c_orient', supLabel(rep.orientation));
    setTxt('c_twist', supLabel(rep.twist));
    setTxt('c_tang', supLabel(rep.tangential));
    setTxt('c_raw', yn(rep.api.pointerrawupdate));
    setTxt('c_coal', yn(rep.api.getCoalescedEvents));
    setTxt('c_sph', yn(rep.api.altitudeAngle && rep.api.azimuthAngle));
    setTxt('c_secure', yn(rep.api.secureContext));
    setTxt('c_src', rawUpdateSeen ? 'pointerrawupdate' : 'pointermove (coalesced)');
    setTxt('c_ostate', rep.orientationState || '—');
    setTxt('c_ofrom', stats.orientationFrom || '—');

    setTxt('d_alt', stats.altitudeDeg.toFixed(1) + '°');
    setTxt('d_az', stats.azimuthDeg.toFixed(1) + '°');
    setTxt('d_tw', Math.round(stats.twist) + '°');
    setTxt('d_lean', stats.lean.toFixed(3));
    setTxt('d_leandir', stats.leanDeg.toFixed(1) + '°');
    setTxt('d_rel', stats.relAngleDeg.toFixed(1) + '°');
    setTxt('d_pp', stats.pushPull.toFixed(2) +
      (stats.pushPull > 0.2 ? ' (راندن)' : (stats.pushPull < -0.2 ? ' (کشیدن)' : '')));
    setTxt('d_uprof', stats.uHeel.toFixed(2) + ' … ' + stats.uToe.toFixed(2));

    setTxt('i_res', stats.inkReservoir.toFixed(2));
    setTxt('i_flow', stats.inkFlow.toFixed(2));
    setTxt('i_dep', stats.inkDeposition.toFixed(2));
    setTxt('i_pool', stats.inkPooling.toFixed(2));
    setTxt('i_spread', stats.inkSpread.toFixed(2));
    setTxt('i_abs', stats.inkAbsorption.toFixed(2));

    const o = rep.observedPressureRange;
    setTxt('k_obs', (o.min == null ? '—' : o.min.toFixed(3)) + ' … ' +
                    (o.max == null ? '—' : o.max.toFixed(3)));
  }

  /* ---- اسلایدرهای کالیبراسیونِ فشار (ماندگار) -------------------- */
  const CAL_UI = [
    ['k_min', 'minRawPressure', 3],
    ['k_max', 'maxRawPressure', 3],
    ['k_dz', 'deadzone', 3],
    ['k_sm', 'smoothing', 2],
    ['k_exp', 'curveExponent', 2],
  ];
  function syncCalUI() {
    const cp = normalizer.calibration.params;
    for (const [id, key, dp] of CAL_UI) {
      const el = $(id), lab = $(id + 'Val');
      if (!el) continue;
      el.value = String(cp[key]);
      if (lab) lab.textContent = Number(cp[key]).toFixed(dp);
    }
  }
  for (const [id, key, dp] of CAL_UI) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('input', () => {
      normalizer.calibration.params[key] = Number(el.value);
      const lab = $(id + 'Val');
      if (lab) lab.textContent = Number(el.value).toFixed(dp);
      if (key === 'curveExponent') TUNE.pressureExponent = Number(el.value);
      syncConfig();
      drawCurveView();
      setTxt('k_state', 'تغییر ذخیره‌نشده');
    });
  }
  if ($('k_save')) $('k_save').addEventListener('click', () => {
    setTxt('k_state', normalizer.calibration.save() ? 'ذخیره شد' : 'ذخیره ممکن نشد');
  });
  if ($('k_reset')) $('k_reset').addEventListener('click', () => {
    normalizer.calibration.restoreDefaults();
    syncCalUI(); syncConfig(); drawCurveView();
    setTxt('k_state', 'به پیش‌فرض بازگشت');
  });
  if ($('k_auto')) $('k_auto').addEventListener('click', () => {
    const ok2 = normalizer.calibration.autoRange();
    syncCalUI(); syncConfig(); drawCurveView();
    setTxt('k_state', ok2 ? 'از مشاهده کالیبره شد'
                          : 'دادهٔ کافی نیست — با قلم از کم‌فشار تا پرفشار بکشید');
  });
  syncCalUI();

  function updateDebugPanel() {
    if (!dbgOn()) return;
    updateCapabilityPanel();
    setTxt('d_praw', stats.rawPressure.toFixed(3));
    setBar('b_praw', stats.rawPressure);
    setTxt('d_pnorm', stats.normPressure.toFixed(3));
    setBar('b_pnorm', stats.normPressure);
    setTxt('d_pfilt', stats.filtPressure.toFixed(3));
    setBar('b_pfilt', stats.filtPressure);
    setTxt('d_pmap', stats.mappedPressure.toFixed(3));
    setBar('b_pmap', stats.mappedPressure);
    setTxt('d_psup', stats.pressureSupported ? 'بله' : 'خیر (0.5 قراردادی)');

    setTxt('d_cw', stats.contactW.toFixed(2) + ' px');
    setTxt('d_ct', stats.contactT.toFixed(2) + ' px');
    setTxt('d_co', stats.contactOffset.toFixed(2) + ' px');
    setTxt('d_ap', stats.apparent.toFixed(2) + ' px');
    setTxt('d_nib', Math.round(stats.nibDeg) + '°');
    setTxt('d_dir', Math.round(stats.dirDeg) + '°');
    setTxt('d_tilt', Math.round(stats.tiltX) + ' / ' + Math.round(stats.tiltY));

    setTxt('d_vel', stats.velocity.toFixed(3) + ' px/ms');
    setTxt('d_ink', stats.ink.toFixed(2));
    setTxt('d_dens', stats.density.toFixed(2));
    setTxt('d_dwell', Math.round(stats.dwell) + ' ms');

    setTxt('d_fps', String(stats.fps));
    setTxt('d_ft', stats.frameMs.toFixed(2) + ' ms');
    setTxt('d_eps', String(stats.eventsPerSec));
    setTxt('d_sps', String(stats.samplesPerSec));
    setTxt('d_bpk', String(stats.bufferPeak));
    setTxt('d_bov', String(stats.overflow));
    setTxt('d_clamp', String(stats.clamped));
    setTxt('d_src', rawUpdateSeen ? 'pointerrawupdate' : 'pointermove (coalesced)');

    drawNibView();
  }

  /* =====================================================================
     رابطِ آزمون — برای tests.html و بنچمارک
     ===================================================================== */
  /* =====================================================================
     آینه — نمایشِ زندهٔ همان نوشته در یک پنجرهٔ دیگر
     ---------------------------------------------------------------------
     کاربردش: عکسِ مرجع را پس‌زمینه می‌کنی و رویش می‌نویسی/می‌کشی، و پنجرهٔ
     آینه همان اثر را روی زمینهٔ *سفید* نشان می‌دهد — یعنی نتیجهٔ تمیز،
     بدونِ مرجع. برای نمایش روی مانیتورِ دوم یا ویدئوپروژکتور هم همین است.

     ── چه چیزی فرستاده می‌شود؟ ──────────────────────────────────────
     *رکوردهای* استروک، نه پیکسل. یعنی آینه با همان موتور و همان کد رسم
     می‌کند، پس خروجی‌اش عیناً همان است و به اندازهٔ پنجرهٔ خودش رندر
     می‌شود (نه بزرگ‌نماییِ پیکسل). این تصمیم عمدی است: جایگزین‌ها
     `canvas.captureStream()` یا فرستادنِ `ImageBitmap` بودند که هر دو
     پیکسل می‌فرستند و کیفیت را به اندازهٔ پنجرهٔ مبدأ قید می‌زنند.

     ── مسیرِ پیام ────────────────────────────────────────────────────
     ۱) `BroadcastChannel` — از مارس ۲۰۲۲ Baseline و در همهٔ مرورگرهای
        هدف موجود است؛ بینِ پنجره/تب/فریمِ *هم‌مبدأ* کار می‌کند و پیام را
        به فرستنده برنمی‌گرداند.
     ۲) `win.postMessage(msg, '*')` روی دستهٔ پنجرهٔ باز‌شده — به‌عنوان
        مسیرِ پشتیبان.
     هر دو با هم استفاده می‌شوند و گیرنده با شمارهٔ ترتیب، پیامِ تکراری را
     دور می‌ریزد.

     ⚠ محدودیتِ مهم: با `file://` مبدأ «مات» (opaque) است و
     BroadcastChannel بینِ دو پنجره کار نمی‌کند. پس آینه سرورِ محلی لازم
     دارد (`node server.js`). اگر روی file:// باز شده باشد، همین را
     صریح می‌گوییم به‌جای اینکه بی‌صدا کار نکند.

     ── چرا Document Picture-in-Picture پیش‌فرض نیست؟ ────────────────
     `documentPictureInPicture.requestWindow()` پنجرهٔ «همیشه-رو» می‌دهد
     که برای این کار عالی است، ولی Limited availability است (فایرفاکس
     ندارد) و فقط در بستر امن کار می‌کند. پس به‌عنوان *ارتقای اختیاری*
     استفاده می‌شود و پایه همان `window.open` است که همه‌جا کار می‌کند.
     ===================================================================== */
  const MIRROR_CHANNEL = 'qalam-mirror-v1';
  const isMirror = !!window.__QALAM_MIRROR;
  let mirrorChan = null;
  let mirrorWin = null;
  let mirrorOn = false;
  let mirrorSeq = 0;
  let mirrorSentCount = 0;      // چند رکورد از استروکِ جاری فرستاده شده
  let mirrorStrokeId = 0;

  function mirrorEnv() {
    return {
      W: W, H: H,
      opacity: Number(opacityEl.value),
      nib: nibEl.value,
      color: inkColor(),
      cfg: {
        inkWetLayer: cfg.inkWetLayer,
        inkFringeBands: cfg.inkFringeBands,
        inkFringeBase: cfg.inkFringeBase,
        inkFringeRatio: cfg.inkFringeRatio,
        inkFringeMax: cfg.inkFringeMax,
        inkFringeAlpha: cfg.inkFringeAlpha,
        inkFringeAbsorption: cfg.inkFringeAbsorption,
        inkPaperShowThrough: cfg.inkPaperShowThrough,
        inkRepeatGain: cfg.inkRepeatGain,
        inkToneDepMin: cfg.inkToneDepMin,
        inkToneDepMax: cfg.inkToneDepMax,
        inkDilutePale: cfg.inkDilutePale,
        inkConcentrate: cfg.inkConcentrate,
        inkEdgeDilute: cfg.inkEdgeDilute,
        nibCornerRound: cfg.nibCornerRound,
        maxSpacing: cfg.maxSpacing,
        nibWidth: cfg.nibWidth,
        nibThickness: cfg.nibThickness,
      },
    };
  }

  function mirrorSend(msg) {
    if (isMirror || !mirrorOn) return;
    msg.seq = ++mirrorSeq;
    try { if (mirrorChan) mirrorChan.postMessage(msg); } catch (_) {}
    try {
      if (mirrorWin && !mirrorWin.closed) mirrorWin.postMessage(msg, '*');
    } catch (_) {}
  }

  // رکوردهای تازهٔ استروکِ جاری را به آینه می‌دهد (هر فریم، نه هر نمونه)
  function mirrorPumpStroke() {
    if (isMirror || !mirrorOn) return;
    if (currentStroke.length > mirrorSentCount) {
      const recs = currentStroke.slice(mirrorSentCount);
      mirrorSentCount = currentStroke.length;
      mirrorSend({ t: 'rec', id: mirrorStrokeId, recs: recs });
    }
  }

  function mirrorSyncAll() {
    if (isMirror || !mirrorOn) return;
    mirrorSend({ t: 'sync', env: mirrorEnv(), strokes: strokes });
  }

  function openMirror() {
    if (isMirror) return;
    const secure = window.isSecureContext;
    const fileOrigin = location.protocol === 'file:';
    const url = 'mirror.html';
    try {
      mirrorWin = window.open(url, 'qalamMirror',
        'width=' + Math.round(Math.min(1280, screen.availWidth * 0.6)) +
        ',height=' + Math.round(Math.min(860, screen.availHeight * 0.7)));
    } catch (_) { mirrorWin = null; }
    if (!mirrorWin) {
      status.textContent = 'مرورگر اجازهٔ بازکردنِ پنجره را نداد — ' +
        'پنجرهٔ بازشو (popup) را برای این صفحه مجاز کن.';
      return;
    }
    if (!mirrorChan && typeof BroadcastChannel === 'function' && !fileOrigin) {
      try {
        mirrorChan = new BroadcastChannel(MIRROR_CHANNEL);
        // آینه با «سلام» درخواستِ همگام‌سازیِ کامل می‌کند
        mirrorChan.onmessage = e => {
          if (e.data && e.data.t === 'hello') mirrorSyncAll();
        };
      } catch (_) { mirrorChan = null; }
    }
    mirrorOn = true;
    const btn = $('mirrorBtn');
    if (btn) btn.classList.add('active');
    status.textContent = fileOrigin
      ? 'آینه باز شد، ولی با file:// پیام بینِ پنجره‌ها رد و بدل نمی‌شود. ' +
        'برای آینه، پروژه را با `node server.js` اجرا کن.'
      : 'آینه باز شد — همین اثر روی زمینهٔ سفید' +
        (secure ? '' : ' (بسترِ ناامن: Document PiP در دسترس نیست)');
    // اولین همگام‌سازی پس از بالا آمدنِ پنجره
    setTimeout(mirrorSyncAll, 400);
    setTimeout(mirrorSyncAll, 1200);
  }

  function closeMirror() {
    mirrorOn = false;
    try { if (mirrorWin && !mirrorWin.closed) mirrorWin.close(); } catch (_) {}
    mirrorWin = null;
    const btn = $('mirrorBtn');
    if (btn) btn.classList.remove('active');
    status.textContent = 'آینه بسته شد';
  }

  function toggleMirror() {
    if (mirrorOn) closeMirror(); else openMirror();
  }
  if ($('mirrorBtn')) $('mirrorBtn').onclick = toggleMirror;

  /* ---------------------------------------------------------------------
     سمتِ گیرنده — همان کدِ رسم، فقط ورودی‌اش از پیام می‌آید
     --------------------------------------------------------------------- */
  if (isMirror) {
    let lastSeq = 0;
    let mStrokeId = -1;

    function applyEnv(env) {
      if (!env) return;
      if (env.opacity != null) {
        opacityEl.value = String(env.opacity);
        opacityEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (env.nib) nibEl.value = env.nib;
      if (env.cfg) for (const k in env.cfg) cfg[k] = env.cfg[k];
    }

    function mirrorApply(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.seq) {
        if (msg.seq <= lastSeq) return;      // پیامِ تکراری از مسیرِ دوم
        lastSeq = msg.seq;
      }
      switch (msg.t) {
        case 'begin':
          applyEnv(msg.env);
          currentStroke = [];
          mStrokeId = msg.id;
          if (cfg.inkWetLayer) { clearWet(null); ctx = wetCtx; }
          break;

        case 'rec': {
          if (!msg.recs || !msg.recs.length) break;
          if (cfg.inkWetLayer) ctx = wetCtx;
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.shadowBlur = 0;
          for (const rec of msg.recs) {
            const prev = currentStroke.length
              ? currentStroke[currentStroke.length - 1] : null;
            currentStroke.push(rec);
            if (prev) renderSegment(prev, rec);
            else renderStamp(rec);
          }
          ctx.restore();
          break;
        }

        case 'end': {
          const s = currentStroke;
          currentStroke = [];
          if (s.length) {
            s.bb = strokeBounds(s);
            strokes.push(s);
            pushHistory({ type: 'stroke', data: s });
          }
          if (cfg.inkWetLayer) {
            ctx = inkCtx;
            flushWet(s.bb || null,
                     overlapRect(s.bb, Math.max(0, strokes.length - 1)));
          }
          break;
        }

        case 'sync':
          applyEnv(msg.env);
          strokes = Array.isArray(msg.strokes) ? msg.strokes.slice() : [];
          for (const st of strokes) if (st && !st.bb) st.bb = strokeBounds(st);
          currentStroke = [];
          ctx = inkCtx;
          redraw();
          break;

        case 'clear':
          strokes = []; currentStroke = []; history = [];
          ctx = inkCtx;
          clearWet(null);
          inkCtx.save();
          inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          inkCtx.clearRect(0, 0, W, H);
          inkCtx.restore();
          break;
      }
    }

    window.__qalamMirrorApply = mirrorApply;
    window.addEventListener('message', e => mirrorApply(e.data));
    if (typeof BroadcastChannel === 'function' &&
        location.protocol !== 'file:') {
      try {
        const ch = new BroadcastChannel(MIRROR_CHANNEL);
        ch.onmessage = e => mirrorApply(e.data);
        // درخواستِ همگام‌سازیِ کامل از پنجرهٔ اصلی
        ch.postMessage({ t: 'hello' });
        setTimeout(() => ch.postMessage({ t: 'hello' }), 600);
      } catch (_) {}
    }
    if (window.opener) {
      try { window.opener.postMessage({ t: 'hello' }, '*'); } catch (_) {}
    }
  } else if (window.opener === null && typeof BroadcastChannel === 'function' &&
             location.protocol !== 'file:') {
    /* پنجرهٔ اصلی حتی پیش از بازکردنِ آینه هم به «سلام» پاسخ می‌دهد، تا
       اگر کاربر mirror.html را دستی باز کرد، کار کند. */
    try {
      const ch = new BroadcastChannel(MIRROR_CHANNEL);
      ch.onmessage = e => {
        if (e.data && e.data.t === 'hello') {
          mirrorChan = mirrorChan || ch;
          mirrorOn = true;
          const btn = $('mirrorBtn');
          if (btn) btn.classList.add('active');
          mirrorSyncAll();
        }
      };
      mirrorChan = ch;
    } catch (_) {}
  }
  window.addEventListener('message', e => {
    if (!isMirror && e.data && e.data.t === 'hello') mirrorSyncAll();
  });

  window.__qalamMirror = {
    open: openMirror, close: closeMirror, toggle: toggleMirror,
    send: mirrorSend, syncAll: mirrorSyncAll, env: mirrorEnv,
    get on() { return mirrorOn; },
    get isMirror() { return isMirror; },
    channel: MIRROR_CHANNEL,
  };

  /* =====================================================================
     راه‌اندازیِ لایهٔ «دستیارِ هوشمند» + «خودکارِ ساچمه‌ایِ واقعی»
     ---------------------------------------------------------------------
     پُل (bridge) تنها چیزی است که لایهٔ تازه از app.js می‌بیند. هر تابعِ
     این پُل یک *خواندنِ* وضعیتِ موجود است یا یک عملِ موجود؛ هیچ‌کدام
     منطقِ تازه‌ای در app.js نمی‌سازد. پس اگر روزی این لایه حذف شود، فقط
     همین بلوک و چهار قلاب باید برداشته شوند.
     ===================================================================== */
  if (AUI) {
    AUI.init({
      paperEl: paper,
      dims: () => ({ W: W, H: H, dpr: dpr }),
      imageFit: imageFit,
      nibWidth: () => cfg.nibWidth,
      /* ظرفیتِ پهنای نوک را برای همین استروک تضمین می‌کند.
         لازم است چون سطحِ تماس هرگز از پهنای کاملِ نوک بیشتر نمی‌شود
         (ratio ∈ [0,1])، پس در Width Mode = Reference یک مرجعِ پهن‌تر از
         نوک بی‌صدا کران می‌خورد. کرانِ بالا می‌گذارد تا یک تحلیلِ خراب
         نتواند نوک را بی‌نهایت بزرگ کند. */
      ensureNibWidth: want => {
        const cap = Math.min(Math.max(want, cfg.nibWidth), 240);
        if (cap > cfg.nibWidth) {
          cfg.nibWidth = cap;
          // ضخامتِ تیغه هم برای نوکِ گرد باید همراه شود
          if (nibEl.value === 'round') cfg.nibThickness = cap;
        }
        return cfg.nibWidth;
      },
      heelLift: () => cfg.heelLift,
      sampleExtent: sampleExtent,
      status: msg => { if (status) status.textContent = msg; },
      // پنل می‌تواند ابزار را هم عوض کند تا انتخابِ ابزار و رفتارِ جوهر
      // هرگز از هم جدا نیفتند
      setBallpointTool: on => {
        if (on && currentTool !== 'ballpoint') setTool('ballpoint');
        else if (!on && currentTool === 'ballpoint') setTool('reed');
        else syncConfig();
      },
      redrawRegion: bb => {
        if (!bb) return;
        if (cfg.inkWetLayer) redraw(); else redrawRegion(bb);
      },
    });
    // اگر تنظیماتِ ذخیره‌شده «خودکار» را روشن نگه داشته بود، ابزار را هم
    // همان‌طور بالا می‌آوریم
    if (AUI.settings.real_ballpoint_enabled && currentTool !== 'ballpoint') {
      setTool('ballpoint');
    } else {
      syncConfig();
    }
    if (customImage) AUI.setReference(customImage);
  }

  window.__qalamTest = {
    QE, cfg, TUNE, stats,
    synthStroke, commitStroke, drawPressureGrid,
    syncConfig, redraw, redrawRegion, strokeBounds, sampleExtent,
    footprintOf, contactRound,
    get strokes() { return strokes; },
    get history() { return history; },
    get currentStroke() { return currentStroke; },
    get drawing() { return drawing; },
    get rawUpdateSeen() { return rawUpdateSeen; },
    get rawSinceMove() { return rawSinceMove; },
    get bufferSize() { return inputBuf.size(); },
    resampler, normalizer, stylus: QS,
    capabilities: () => normalizer.capabilityReport(),
    dims: () => ({ W, H, dpr }),
    inkCanvas: ink,
    // برای تست‌های لایهٔ دستیار
    assist: AUI,
    imageFit: imageFit,
    setPaper: setPaper,
    loadPaperImage: loadPaperImage,
    get paperType() { return paperType; },
    get customImage() { return customImage; },
    setCustomImage: img => { customImage = img; },
  };
  status.textContent = 'آماده — قلم نی تنها: پهنای نوک، نسبت چلبی، فشار (نازک/کلفت) و شفافیت را تنظیم کن.';
})();
