/* =====================================================================
   assist-ui.js — لایهٔ اجرایی و رابطِ کاربریِ «دستیارِ هوشمند» + «خودکارِ واقعی»
   ---------------------------------------------------------------------
   این فایل تنها جایی است که سه چیز به هم وصل می‌شوند:

       QalamAssist        (ریاضیات، بدونِ DOM)
       QalamReference     (بینایی ماشین، بدونِ DOM)
       app.js             (رندرر و ورودیِ موجودِ پروژه)

   قرارداد با app.js — فقط قلاب (hook)، نه بازنویسی:

       AUI.init(bridge)          یک بار در راه‌اندازی
       AUI.beginStroke(x, y)     در pointerdown
       AUI.position(io)          در emitSample، *پیش از* محاسبهٔ جهت/تماس
       AUI.shape(io)             در emitSample، *پس از* computeContact/computeInk
       AUI.endStroke(recs)       در pointerup → کرانِ ناحیهٔ تغییریافته یا null
       AUI.setReference(img)     پس از import تصویر
       AUI.invalidate()          در resize / تغییرِ کاغذ
       AUI.frame(now)            هر فریم (HUD و لایهٔ Debug)
       AUI.hover(p, supported)   در حرکتِ بی‌تماسِ قلم

   وقتی هر دو کلیدِ اصلی خاموش‌اند، هیچ‌یک از این قلاب‌ها *هیچ* مقداری را
   عوض نمی‌کند: نه موقعیت، نه پهنا، نه مرکب. رفتار دقیقاً همان نسخهٔ
   پیشین است (بخش ۵۲ و ۵۳ و ۸۵ درخواست).

   ★ قانونِ غیرقابلِ مذاکره (بخش ۳۲ و ۸۶):
     تصویرِ مرجع و لایهٔ Debug فقط روی Monitor 1 هستند. در حالتِ آینه
     (window.__QALAM_MIRROR) این فایل خودش را کاملاً غیرفعال می‌کند و
     هیچ بومِ تازه‌ای نمی‌سازد. پروتکلِ آینه هم هیچ فیلدی از مرجع ندارد.
   ===================================================================== */
(function (global) {
  'use strict';

  const A = global.QalamAssist;
  const R = global.QalamReference;
  const IS_MIRROR = !!global.__QALAM_MIRROR;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  const STORE_KEY = 'qalam.assist.v1';

  /* ===================================================================
     ۱) تنظیمات — ماندگار در localStorage، با همان نام‌های بخش ۷۰ و ۱۴۹
     =================================================================== */
  const settings = A ? A.createSettings() : {};

  function loadSettings() {
    try {
      const s = global.localStorage && global.localStorage.getItem(STORE_KEY);
      if (!s) return false;
      const o = JSON.parse(s);
      for (const k in A.DEFAULTS) {
        if (o[k] !== undefined && typeof o[k] === typeof A.DEFAULTS[k]) settings[k] = o[k];
      }
      return true;
    } catch (_) { return false; }
  }
  function saveSettings() {
    try {
      global.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
      return true;
    } catch (_) { return false; }
  }
  function resetSettings() {
    for (const k in A.DEFAULTS) settings[k] = A.DEFAULTS[k];
    saveSettings();
    syncPanel();
    log('تنظیمات به پیش‌فرض برگشت');
  }
  // صدور/ورودِ پیش‌تنظیمِ قلم (بخش ۱۵۰)
  function exportPreset() { return JSON.stringify(settings, null, 2); }
  function importPreset(text) {
    try {
      const o = JSON.parse(text);
      for (const k in A.DEFAULTS) {
        if (o[k] !== undefined && typeof o[k] === typeof A.DEFAULTS[k]) settings[k] = o[k];
      }
      saveSettings(); syncPanel(); invalidate();
      log('پیش‌تنظیم بارگذاری شد');
      return true;
    } catch (e) { log('پیش‌تنظیم خوانده نشد: ' + e.message); return false; }
  }

  /* ===================================================================
     ۲) لاگ — کران‌دار، تا Performance خراب نشود (بخش ۵۴)
     =================================================================== */
  const logLines = [];
  let logEnabled = false;
  function log(msg) {
    if (!logEnabled) return;
    const line = '[Assist] ' + msg;
    logLines.push(line);
    if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
    // در مسیرِ داغ هرگز صدا زده نمی‌شود؛ فقط رویدادهای گسسته
    if (global.console && global.console.debug) global.console.debug(line);
  }

  /* ===================================================================
     ۳) وضعیتِ اجرایی
     =================================================================== */
  let bridge = null;            // پُلِ app.js
  let ready = false;

  const st = {
    // ---- تحلیلِ مرجع ----
    image: null,                // شیءِ تصویرِ مرجع (کلیدِ کش)
    analysis: null,
    analyzing: false,
    refStrokes: [],             // در مختصاتِ منطقیِ بوم
    transform: null,            // {kS, ox, oy}
    transformSig: '',
    // ---- ابزارها ----
    matcher: A ? new A.PathMatcher() : null,
    euro: A ? new A.OneEuro2D() : null,
    ball: A ? new A.BallpointState() : null,
    press: null,
    paper: null,
    cache: R ? new R.ReferenceCache() : null,
    // ---- وضعیتِ استروکِ جاری ----
    drawing: false,
    strokeStart: { x: 0, y: 0 },
    matchOut: { found: false, x: 0, y: 0, dist: 0, t: 0, width: 0, tangent: 0, index: -1 },
    userPath: [],               // برای لایهٔ Debug (کران‌دار)
    fixedPath: [],
    prevDir: null,
    /* ---- مقادیرِ *ثابت در طولِ یک استروک*، یک بار در beginStroke ----------
       هیچ‌یک از این‌ها نمی‌تواند بینِ دو نمونه عوض شود (تنظیمات فقط از پنل
       تغییر می‌کند و پنل در حالِ نوشتن دست‌رس نیست). محاسبهٔ دوباره‌شان در
       هر نمونه یعنی پرداختِ هزینهٔ Math.pow و یک حلقه روی همهٔ پهناهای
       مرجع، ۵۰۰ بار در ثانیه. */
    stab: 0,            // شدتِ پایدارسازی
    pathAmt: 0,         // شدتِ اصلاحِ مسیر  (assist × confidence)
    widthAmt: 0,        // شدتِ اصلاحِ پهنا
    matchRadius: 0,     // شعاعِ Tolerance برای Stroke انتخاب‌شده
    // ظرفیتِ پهنای نوکِ لازم برای Stroke مرجعِ جاری (۰ = بی‌نیاز)
    needNibWidth: 0,
    /* پهنای قلمی که *کاربر* تنظیم کرده، پیش از هر کشیدنِ ظرفیت.
       مبنای محاسبهٔ Target Pressure است: «با قلمِ خودت چقدر فشار لازم است؟» */
    penNibWidth: 0,
    // ---- بازخورد ----
    hud: {
      pressure: 0, pressureSupported: false, pressureFallback: false,
      actualWidth: 0, targetWidth: 0, targetPressure: 0,
      targetOutOfRange: false,
      refFound: false, refConfidence: 0, refT: 0,
      coverage: 1, buildUp: 0, gap: false,
      hovering: false,
    },
    // ---- سنجه‌های Debug (بخش ۵۵) ----
    metrics: {
      inputPoints: 0, resampledPoints: 0,
      rawLength: 0, correctedLength: 0,
      pressureSum: 0, pressureMax: 0,
      matchMs: 0, shapeMs: 0, analysisMs: 0,
      matched: 0, missed: 0,
      trainPath: 0, trainWidth: 0, trainPressure: 0,
    },
    // ---- بومِ لایهٔ Debug (فقط Monitor 1) ----
    ovl: null, ovlCtx: null,
  };

  /* پرچمِ فعال‌بودن — همان چیزی که «خاموش = رفتارِ قبل» را تضمین می‌کند */
  /* ★ در حالتِ آینه هر دو همیشه خاموش‌اند.
     Monitor 2 استروکِ *نهایی* را از پروتکلِ آینه می‌گیرد؛ اگر لایهٔ دستیار
     آن‌جا هم دوباره اجرا شود، همان هندسه دو بار اصلاح می‌شود و خروجیِ دو
     مانیتور از هم جدا می‌افتد. این گارد ساختاری است، نه تنظیمی. */
  function assistOn() {
    return ready && !IS_MIRROR && settings.intelligent_assist_enabled &&
           settings.assist_strength > 0;
  }
  function ballpointOn() { return ready && !IS_MIRROR && settings.real_ballpoint_enabled; }
  function anyOn() { return assistOn() || ballpointOn(); }
  function traceOn() {
    return assistOn() && settings.assist_mode === 'reference' &&
           st.refStrokes.length > 0;
  }

  /* ===================================================================
     ۴) نگاشتِ مختصات — analysis ⇄ canvas
     -------------------------------------------------------------------
     دقیقاً از هندسهٔ *واقعیِ* رسمِ تصویر در renderPaper گرفته می‌شود
     (bridge.imageFit)، پس هیچ عددی Hard-Code نیست و تغییرِ اندازهٔ پنجره،
     DPI، یا نسبتِ ابعادِ تصویر خودبه‌خود لحاظ می‌شود.
     =================================================================== */
  function buildTransform() {
    st.transform = null;
    st.transformSig = '';
    if (!bridge || !st.analysis || !st.analysis.ok) return null;
    const fit = bridge.imageFit ? bridge.imageFit() : null;
    if (!fit || !(fit.s > 0)) return null;
    // analysis px → image px → canvas px
    const k = fit.iw / Math.max(1, st.analysis.width);
    const kS = k * fit.s;
    st.transform = { kS: kS, ox: fit.ox, oy: fit.oy, fit: fit };
    st.transformSig = [fit.iw, fit.ih, fit.s.toFixed(6), fit.ox.toFixed(3),
                       fit.oy.toFixed(3), st.analysis.width].join('|');
    return st.transform;
  }

  /* Centerlineهای مرجع را به فضای منطقیِ بوم می‌برد و شبکهٔ مکانی می‌سازد.
     تحلیل خودش بی‌اعتبار نمی‌شود؛ فقط این تصویر دوباره ساخته می‌شود. */
  function projectReference() {
    st.refStrokes = [];
    const T = st.transform;
    if (!T || !st.analysis || !st.analysis.ok) return;
    for (const rs of st.analysis.strokes) {
      const n = rs.points.length;
      if (n < 3) continue;
      const pts = new Array(n);
      const widths = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pts[i] = { x: T.ox + rs.points[i].x * T.kS, y: T.oy + rs.points[i].y * T.kS };
        widths[i] = rs.widths[i] * T.kS;
      }
      let mean = 0;
      for (let i = 0; i < n; i++) mean += widths[i];
      mean = n ? mean / n : 0;
      const cell = clamp(mean * 1.2, 4, 48);
      const grid = new A.SpatialGrid(cell);
      for (let i = 0; i < n; i++) grid.add(pts[i].x, pts[i].y, i);
      st.refStrokes.push({
        points: pts, widths: widths, ts: rs.ts, tangents: rs.tangents,
        grid: grid, length: rs.length * T.kS, meanWidth: mean,
        // سقفِ پرشِ رو به عقب بر حسبِ تعدادِ نقطه — از گامِ واقعی مشتق می‌شود
        backLimit: Math.max(8, Math.round(mean * 2.5 / Math.max(0.5, T.kS * 1.5))),
        profile: new A.WidthProfile(rs.ts, widths),
      });
    }
    log('reference projected — ' + st.refStrokes.length + ' stroke(s)');
  }

  function ensureTransform() {
    if (!st.analysis || !st.analysis.ok) return;
    const before = st.transformSig;
    buildTransform();
    if (st.transformSig !== before || !st.refStrokes.length) projectReference();
  }

  function invalidate() {
    if (!ready) return;
    st.transformSig = '';
    ensureTransform();
    resizeOverlay();
  }

  /* ===================================================================
     ۵) تحلیلِ تصویرِ مرجع
     =================================================================== */
  async function setReference(img) {
    if (IS_MIRROR) return null;          // ★ گاردِ Monitor 2
    if (!ready || !R || !A) return null;
    if (!img) {
      st.image = null; st.analysis = null; st.refStrokes = [];
      updateRefLabel();
      return null;
    }
    st.image = img;
    const maxSide = Math.max(64, settings.analysis_max_side | 0);
    const iw = img.width | 0, ih = img.height | 0;
    if (!(iw > 1 && ih > 1)) return null;
    const scale = Math.min(1, maxSide / Math.max(iw, ih));
    const aw = Math.max(2, Math.round(iw * scale));
    const ah = Math.max(2, Math.round(ih * scale));

    const opts = R.createOptions({ centerlineStep: settings.centerline_step });
    const cached = st.cache.get(img, aw, ah, opts);
    if (cached) {
      st.analysis = cached;
      log('reference analysis cache hit');
      invalidate(); updateRefLabel();
      return cached;
    }

    let rgba;
    try {
      const c = global.document.createElement('canvas');
      c.width = aw; c.height = ah;
      const cx = c.getContext('2d', { willReadFrequently: true });
      // پس‌زمینهٔ سفید: PNG شفاف نباید «مرکبِ سیاه» شمرده شود
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, aw, ah);
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, aw, ah);
      rgba = cx.getImageData(0, 0, aw, ah).data;
    } catch (e) {
      log('reference raster failed: ' + e.message);
      return null;
    }

    st.analyzing = true;
    updateRefLabel();
    log('reference analysis started (' + aw + '×' + ah + ')');
    let res = null;
    try {
      res = await R.activeAnalyzer()(rgba, aw, ah, opts, null);
    } catch (e) {
      log('reference analysis failed: ' + e.message);
      res = R.emptyAnalysis(aw, ah, 'تحلیل با خطا متوقف شد: ' + e.message);
    }
    st.analyzing = false;
    st.analysis = res;
    st.metrics.analysisMs = res.analysisMs;
    st.cache.set(img, aw, ah, opts, res);
    log('reference analysis completed — strokes=' + res.strokes.length +
        ' confidence=' + res.confidence.toFixed(2) + ' in ' + res.analysisMs + 'ms');
    if (res.note) log(res.note);
    invalidate();
    updateRefLabel();
    if (bridge && bridge.status && res.note) bridge.status(res.note);
    return res;
  }

  function confidence() {
    return st.analysis && st.analysis.ok ? clamp01(st.analysis.confidence) : 0;
  }

  /* ===================================================================
     ۶) قلاب‌های مسیرِ داغ
     =================================================================== */
  function beginStroke(x, y) {
    st.drawing = true;
    st.strokeStart.x = x; st.strokeStart.y = y;
    st.prevDir = null;
    st.userPath.length = 0;
    st.fixedPath.length = 0;
    const m = st.metrics;
    m.inputPoints = 0; m.resampledPoints = 0;
    m.rawLength = 0; m.correctedLength = 0;
    m.pressureSum = 0; m.pressureMax = 0;
    m.matchMs = 0; m.shapeMs = 0;
    m.matched = 0; m.missed = 0;
    st.stab = 0; st.pathAmt = 0; st.widthAmt = 0; st.matchRadius = 0;
    if (!anyOn()) return;
    /* ---- تصمیم‌های ثابتِ این استروک، *یک بار* ------------------------- */
    st.stab = stabAmount();
    if (st.euro) { st.euro.reset().configure(st.stab); }
    if (st.ball) st.ball.reset();
    if (st.matcher) st.matcher.reset();
    ensureTransform();
    if (traceOn()) {
      const picked = st.matcher.pick(st.refStrokes, x, y, radiusOf);
      st.matchRadius = picked ? radiusOf(picked) : 0;
      log('stroke started — reference ' + (picked ? 'matched' : 'not matched') +
          (picked ? ' (r=' + st.matchRadius.toFixed(1) + 'px)' : ''));
      /* پهنای قلمی که کاربر تنظیم کرده، *پیش از* هر کشیدنِ ظرفیت.
         این مبنای «Target Pressure» است (بخش ۲۴ و ۸۷). */
      st.penNibWidth = bridge && bridge.nibWidth ? bridge.nibWidth() : 0;
      st.pathAmt = pathAmount();
      st.widthAmt = widthAmount();
      st.needNibWidth = requiredNibWidth();
      if (st.needNibWidth > 0 && bridge && bridge.ensureNibWidth) {
        const got = bridge.ensureNibWidth(st.needNibWidth);
        if (got < st.needNibWidth - 0.01) {
          log('reference width ' + st.needNibWidth.toFixed(1) +
              'px exceeds the pen capacity ' + got.toFixed(1) + 'px');
        }
      }
    } else {
      st.needNibWidth = 0;
      st.penNibWidth = bridge && bridge.nibWidth ? bridge.nibWidth() : 0;
      log('stroke started');
    }
    clearOverlay();
  }

  /* شعاعِ Tolerance برای *یک* Stroke مرجع — از پهنای خودِ آن Stroke و
     پهنای نوک مشتق می‌شود، نه از عددِ ثابت و نه از بزرگ‌ترین جزءِ تصویر
     (بخش ۱۵ و ۷۱ درخواست). */
  function radiusOf(rs) {
    const nib = bridge && bridge.nibWidth ? bridge.nibWidth() : 8;
    return Math.max(nib * settings.match_max_radius_nib * 0.5,
                    (rs && rs.meanWidth > 0 ? rs.meanWidth : nib) *
                    settings.match_tolerance);
  }

  /* -------------------------------------------------------------------
     ظرفیتِ پهنای نوکِ لازم برای Stroke مرجعِ انتخاب‌شده  (تستِ پذیرشِ ۳ و ۵)
     -------------------------------------------------------------------
     پهنای سطحِ تماس هرگز از پهنای کاملِ نوک بیشتر نمی‌شود
     (ratio ∈ [0,1] در خودِ موتور). پس اگر مرجع پهن‌تر از نوک باشد،
     «Width Mode = Reference» بی‌صدا شکست می‌خورد. اندازه‌گیری‌شده: مرجعِ
     ۴۹٫۶px با خودکارِ ۰٫۷mm (نوکِ ۲٫۶۵px) روی ۲٫۵۶px کران می‌خورد و
     پروفایلِ نازک→کلفت→نازک کاملاً تخت می‌شد.

     تصمیمِ صریح: در حالتِ مرجع، *ظرفیتِ* نوک تا بیشینهٔ پهنای مرجع بزرگ
     می‌شود. این «تقلب» نیست؛ همان معنایی است که کاربر با انتخابِ Reference
     خواسته: «پهنا را از مرجع بگیر، نه از اندازهٔ قلم.»
     ------------------------------------------------------------------- */
  function requiredNibWidth() {
    const rs = st.matcher && st.matcher.stroke;
    if (!rs || widthAmount() <= 0) return 0;
    let need = 0;
    for (let i = 0; i < rs.widths.length; i++) {
      if (rs.widths[i] > need) need = rs.widths[i];
    }
    if (settings.width_mode === 'hybrid') {
      need *= 1 + clamp01(settings.hybrid_pressure_range);
    }
    return need;
  }

  /* شدتِ پایدارسازی: ۰ در assist_strength = ۰، و از ۲۵٪ به بالا کاملاً
     تابعِ اسلایدرِ «نرمی». (بخش ۱۶: ۲۵٪ = فقط Smoothing و Stabilization) */
  function stabAmount() {
    if (!assistOn() && !ballpointOn()) return 0;
    if (!assistOn()) return 0;                  // فقط خودکار ⇒ پایدارسازی نه
    const gate = clamp01(settings.assist_strength / 0.25);
    return clamp01(settings.smoothing_strength) * gate;
  }
  /* شدتِ اصلاحِ *مسیر*: زیر ۲۵٪ صفر، در ۱۰۰٪ کامل. ضرب در Confidence
     (بخش ۳۶: Final Correction = AssistStrength × Confidence) */
  function pathAmount() {
    if (!traceOn()) return 0;
    const s = clamp01((settings.assist_strength - 0.25) / 0.75);
    return s * confidence();
  }
  /* شدتِ اصلاحِ *پهنا*:
     Width Mode یک «حالت» است نه یک «شدت» — این تصمیمِ صریحِ طراحی است و
     در docs/INTELLIGENT_ASSIST.md مستند شده:
       pressure  ⇒ ۰   (پهنا فقط از فشار؛ رفتارِ قبلیِ پروژه)
       reference ⇒ Confidence  (مرجع پهنا را تعیین می‌کند — تستِ پذیرشِ ۳ و ۵)
       hybrid    ⇒ Confidence، با تعدیلِ کران‌دارِ فشار
     ولی در assist_strength = 0 همه‌چیز خاموش است (تستِ پذیرشِ «۰٪»). */
  function widthAmount() {
    if (!traceOn()) return 0;
    if (settings.width_mode === 'pressure') return 0;
    return confidence();
  }

  /* -------------------------------------------------------------------
     position(io) — io = { x, y, tMs, isFirst }
     خروجی: io.x / io.y ممکن است عوض شوند.
     ------------------------------------------------------------------- */
  const _pt = { x: 0, y: 0 };
  function position(io) {
    if (!anyOn()) return io;
    const m = st.metrics;
    m.inputPoints++;
    const rawX = io.x, rawY = io.y;
    /* سنجه‌ها فقط وقتی جمع می‌شوند که پنلی برای دیدنشان باز باشد.
       ★ چهار فراخوانیِ performance.now() و دو Math.hypot در هر نمونه، در
       نرخِ ۵۰۰Hz یعنی ۳۰۰۰ عمل در ثانیه برای عددی که با ۸Hz نمایش داده
       می‌شود. مسیرِ داغ نباید هزینهٔ ابزارِ سنجش را بپردازد. */
    const measure = settings.debug_overlay || settings.training_mode;

    // ---- ۱) پایدارسازی: One Euro Filter (حذفِ لرزشِ دست) ----
    /* پیکربندیِ فیلتر در beginStroke و در تغییرِ تنظیمات انجام می‌شود، نه
       در هر نمونه: هیچ‌یک از ورودی‌هایش (assist_strength و
       smoothing_strength) نمی‌تواند بینِ دو نمونه عوض شود، و configure یک
       Math.pow دارد. */
    if (st.stab > 0.001 && st.euro) {
      st.euro.filter(_pt, io.x, io.y, io.tMs);
      io.x = _pt.x; io.y = _pt.y;
    }

    // ---- ۲) تطبیق با مرجع + اصلاحِ مسیر ----
    st.matchOut.found = false;
    if (traceOn() && st.matcher.stroke) {
      const t0 = measure ? perfNow() : 0;
      st.matcher.project(st.matchOut, io.x, io.y, st.matchRadius);
      if (measure) m.matchMs += perfNow() - t0;
      if (st.matchOut.found) {
        m.matched++;
        const pa = st.pathAmt;
        if (pa > 0.001) {
          io.x = lerp(io.x, st.matchOut.x, pa);
          io.y = lerp(io.y, st.matchOut.y, pa);
        }
      } else {
        m.missed++;
      }
    }

    // ---- ۳) مسیرها برای لایهٔ Debug (کران‌دار، بدونِ رشد بی‌پایان) ----
    if (measure) {
      if (st.userPath.length < 4000) {
        st.userPath.push(rawX, rawY);
        st.fixedPath.push(io.x, io.y);
      }
      if (m.inputPoints > 1) {
        m.rawLength += Math.hypot(rawX - m._lrx, rawY - m._lry);
        m.correctedLength += Math.hypot(io.x - m._lcx, io.y - m._lcy);
      }
      m._lrx = rawX; m._lry = rawY; m._lcx = io.x; m._lcy = io.y;
    }
    return io;
  }

  /* -------------------------------------------------------------------
     shape(io) — io = {
        x, y, pressure, pressureValid, pressureSupported, pressureFallback,
        speed, dir, dwellMs, arcLen, dtMs, lean,
        contact, ink, nibWidth, minContactRatio, velocityRef, pxPerMm
     }
     خروجی: contact (پهنا/ضخامت/پروفایل) و ink (amount/density/spread)
     ------------------------------------------------------------------- */
  function shape(io) {
    if (!anyOn()) return io;
    const t0 = perfNow();
    const m = st.metrics;
    const c = io.contact, ink = io.ink;
    m.resampledPoints++;
    const p = io.pressureValid ? clamp01(io.pressure) : -1;
    if (p >= 0) {
      m.pressureSum += p;
      if (p > m.pressureMax) m.pressureMax = p;
    }

    /* بازهٔ پهنای قلم — از خودِ موتور، نه از عددِ ثابت.
       ★ نکتهٔ مهم: اگر ظرفیتِ نوک را برای جا‌دادنِ مرجع بزرگ کرده باشیم
       (needNibWidth)، آن پهنای *موقت* نمایندهٔ قلمی که کاربر تنظیم کرده
       نیست. «Target Pressure» یعنی «برای رسیدن به این ضخامت با *قلمِ
       خودت* چقدر فشار لازم است» — پس باید نسبت به پهنای واقعیِ قلم حساب
       شود، نه نسبت به ظرفیتِ کشیده‌شده.
       اندازه‌گیریِ پیش از رفع: با مرجعِ ۶۲px و نوکِ موقتِ ۶۲px، پهنای هدف
       دقیقاً روی کفِ بازه می‌افتاد و Target Pressure صفر گزارش می‌شد. */
    const penW = Math.max(0.2, st.penNibWidth > 0 ? st.penNibWidth : io.nibWidth);
    const wMax = Math.max(0.2, io.nibWidth);
    const wMin = wMax * clamp01(io.minContactRatio);
    const penMax = penW;
    const penMin = penW * clamp01(io.minContactRatio);

    /* ---- ۱) پهنای هدف ---------------------------------------------- */
    let targetW = c.width;
    const wa = widthAmount();
    if (wa > 0.001 && st.matchOut.found && st.matchOut.width > 0.05) {
      let refW = st.matchOut.width;
      if (settings.width_mode === 'hybrid') {
        /* تعدیلِ کران‌دارِ فشار: کاربر می‌تواند پهنا را کمی جابه‌جا کند ولی
           نمی‌تواند شکلِ Stroke را خراب کند (بخش ۲۵). */
        const rng = clamp01(settings.hybrid_pressure_range);
        const pc = st.press ? st.press.curve(p < 0 ? 0.5 : p) : 0.5;
        refW *= 1 + rng * (2 * pc - 1);
      }
      targetW = lerp(c.width, refW, wa);
      st.hud.targetWidth = refW;
      st.hud.refFound = true;
      st.hud.refT = st.matchOut.t;
    } else {
      st.hud.targetWidth = 0;
      st.hud.refFound = false;
    }

    /* ---- ۲) فیزیکِ خودکارِ ساچمه‌ای ---------------------------------- */
    if (ballpointOn()) {
      let turn = 0;
      if (io.dir !== null && st.prevDir !== null) turn = Math.abs(A.angleDelta(io.dir, st.prevDir));
      if (io.dir !== null) st.prevDir = io.dir;
      A.stepBallpoint(st.ball, settings, {
        pressure: p, speed: io.speed, dwellMs: io.dwellMs, turn: turn,
        arcLen: io.arcLen, lean: io.lean, dtMs: io.dtMs,
        velocityRef: io.velocityRef, pxPerMm: io.pxPerMm,
      });
      // ریزنوسانِ پهنا (بسیار کم — ساچمه پهنای تقریباً ثابتی دارد)
      targetW *= st.ball.widthMul;

      /* ---- ۳) اثرِ متقابلِ جوهر و کاغذ ----------------------------- */
      const paper = st.paper;
      const grain = paper.grainAt(io.x, io.y, io.pxPerMm || 3.7795, 20261);
      const rough = paper.roughness();
      const cov = clamp01(st.ball.coverage + grain * 0.06 * rough);
      const absorb = paper.absorption();

      /* «غنای جوهر» را به‌صورتِ یک عددِ نرمالِ ۰..۱ می‌سازیم و بعد آن را
         در *همان بازهٔ تُنِ* موتور می‌نشانیم (inkToneDepMin..Max که از cfg
         می‌آید). چرا این‌طور و نه نوشتنِ یک عددِ خام در ink.amount؟
         چون pointTone پروژه با همان بازه نرمال می‌کند؛ اگر عددِ خام بنویسیم
         و کسی روزی بازه را عوض کند، تغییراتِ پوششِ جوهر بی‌صدا در سقفِ
         بازه اشباع می‌شود و دیده نمی‌شود — همان اشکالی که خودِ پروژه یک بار
         در FINAL INK PASS اندازه‌گیری و مستند کرده است. */
      const covN = clamp01((cov - 0.70) / 0.30);
      const tone01 = clamp01(0.30 + 0.45 * covN + 0.35 * st.ball.buildUp);
      const tMin = io.toneMin === undefined ? 0.35 : io.toneMin;
      const tMax = io.toneMax === undefined ? 1.30 : io.toneMax;
      ink.amount = tMin + (tMax - tMin) * tone01;
      /* خودکارِ ساچمه‌ای پوشا است: چگالی بالا می‌مانَد و «کم‌جوهری» در
         *تُن* دیده می‌شود، نه در شفافیت. (بخش ۹۲ و ۱۲۴) */
      ink.density = clamp01(0.88 + 0.12 * covN - absorb * 0.06);
      // جذبِ کاغذ ⇒ پخشِ بیشتر ⇒ حاشیهٔ پهن‌ترِ نرم‌تر
      ink.spread = clamp(absorb * (0.55 + 0.45 * rough) +
                         st.ball.buildUp * 0.35, 0, 1.5);
      io.gap = st.ball.gap;
      st.hud.coverage = cov;
      st.hud.buildUp = st.ball.buildUp;
      st.hud.gap = st.ball.gap;
    }

    /* ---- ۴) نشاندنِ پهنای نهایی در ContactState ---------------------- */
    if (targetW > 0.02 && c.width > 1e-6 && Math.abs(targetW - c.width) > 1e-4) {
      A.setContactWidth(c, targetW);
    }

    /* ---- ۵) بازخورد: Actual و Target — دو مفهومِ جدا (بخش ۸۷) -------- */
    st.hud.pressure = p < 0 ? 0 : p;
    st.hud.pressureSupported = !!io.pressureSupported;
    st.hud.pressureFallback = !!io.pressureFallback;
    st.hud.actualWidth = c.width;
    st.hud.refConfidence = confidence();
    if (st.press && st.hud.targetWidth > 0) {
      // نسبت به قلمِ *کاربر*، نه به ظرفیتِ موقتِ مرجع
      const tp = st.press.pressureFor(st.hud.targetWidth, penMin, penMax);
      st.hud.targetPressure = tp.p;
      st.hud.targetOutOfRange = tp.outOfRange;
    } else {
      st.hud.targetPressure = 0;
      st.hud.targetOutOfRange = false;
    }
    st.hud.hovering = false;
    m.shapeMs += perfNow() - t0;
    return io;
  }

  /* -------------------------------------------------------------------
     endStroke(recs) → کرانِ ناحیهٔ تغییریافته یا null
     ------------------------------------------------------------------- */
  function endStroke(recs) {
    st.drawing = false;
    st.needNibWidth = 0;      // ظرفیتِ موقت فقط برای همان استروک بود
    /* ---- بازخوردِ فشار پس از برداشتنِ قلم (بخش ۴۷) --------------------
       «Actual Pressure» یعنی فشارِ *همین لحظه*. وقتی قلم روی کاغذ نیست،
       نگه‌داشتنِ آخرین مقدار یک دروغِ کوچک است: کاربر عددی می‌بیند که
       دیگر واقعیت ندارد. پس صفر می‌شود، ولی *پهنای هدف* و اعتمادِ مرجع
       می‌مانند چون به وضعیتِ قلم وابسته نیستند و در Training Mode لازم‌اند. */
    st.hud.pressure = 0;
    st.hud.actualWidth = 0;
    st.hud.gap = false;
    st.hud.hovering = false;
    if (!anyOn() || !recs || recs.length < 3) { finishMetrics(recs); return null; }
    const bb = A.finalizeStroke(recs, settings, {
      smoothWidth: true,
      // Taper فقط در حالتِ خودکار معنا دارد؛ قلمِ نی دمِ خودش را دارد
      taper: ballpointOn(),
      // دم به applyTailTaper خودِ app.js سپرده می‌شود (تستِ‌شده و موجود)
      taperEnd: false,
      heelLift: bridge && bridge.heelLift ? bridge.heelLift() : 1,
      extentOf: bridge && bridge.sampleExtent ? bridge.sampleExtent : null,
    });
    finishMetrics(recs);
    log('stroke reconstruction completed — samples=' + recs.length +
        ' matched=' + st.metrics.matched + '/' +
        (st.metrics.matched + st.metrics.missed));
    return bb;
  }

  function finishMetrics(recs) {
    const m = st.metrics;
    if (!recs || !recs.length) return;
    // ---- سنجه‌های Training Mode (بخش ۱۳۶) ----
    const tot = m.matched + m.missed;
    m.trainPath = tot ? m.matched / tot : 0;
    if (st.refStrokes.length && st.matcher && st.matcher.stroke) {
      // دقتِ پهنا: میانگینِ ۱ − |actual − target| / target
      let acc = 0, n = 0;
      const rs = st.matcher.stroke;
      for (const rec of recs) {
        if (rec.cw == null) continue;
        // نزدیک‌ترین نقطهٔ مرجع برای همین رکورد
        rs.grid.nearest(_nq, rec.x, rec.y, rs.meanWidth * 3 + 8);
        if (!_nq.found) continue;
        const tw = rs.widths[_nq.data];
        if (!(tw > 0.05)) continue;
        acc += clamp01(1 - Math.abs(rec.cw - tw) / tw);
        n++;
      }
      m.trainWidth = n ? acc / n : 0;
    } else m.trainWidth = 0;
    m.trainPressure = m.resampledPoints
      ? clamp01(1 - Math.abs((m.pressureSum / m.resampledPoints) -
                             (st.hud.targetPressure || (m.pressureSum / m.resampledPoints))))
      : 0;
  }
  const _nq = { found: false, x: 0, y: 0, dist: 0, index: -1, data: null };

  function hover(p, supported, fallback) {
    if (!ready) return;
    st.hud.hovering = true;
    st.hud.pressure = clamp01(p);
    st.hud.pressureSupported = !!supported;
    st.hud.pressureFallback = !!fallback;
  }

  const perfNow = () => (global.performance && global.performance.now)
    ? global.performance.now() : Date.now();

  /* -------------------------------------------------------------------
     config(cfg) — شکل‌دادنِ پیکربندیِ موتور برای نوکِ ساچمه‌ای
     -------------------------------------------------------------------
     در انتهای syncConfig پروژه صدا زده می‌شود، یعنی *پس از* لایهٔ TUNE و
     لایهٔ ابزار. بنابراین اولویت دارد، ولی فقط وقتی کاربر خودکار را روشن
     کرده باشد. با خاموش‌بودنش هیچ کلیدی از cfg دست نمی‌خورد.

     چرا این‌جا و نه یک ابزارِ تازه در TOOLS؟ چون پارامترهای خودکار *زنده*
     از پنل عوض می‌شوند (پهنای پایه بر حسبِ میلی‌متر، جریانِ جوهر، جذبِ
     کاغذ…) و TOOLS در پروژه یک شیءِ ثابتِ Configuration است. ابزارِ
     `tool_ballpoint` هم اضافه شده، ولی کارش فقط روشن‌کردنِ همین کلید است.
     ------------------------------------------------------------------- */
  function config(cfg) {
    if (!ready || !cfg) return cfg;
    if (!ballpointOn()) { applyNibCapacity(cfg); return cfg; }
    const pxPerMm = cfg.pxPerMm > 0 ? cfg.pxPerMm : (96 / 25.4);
    const w = Math.max(0.4, clamp(settings.base_width_mm, 0.1, 3) * pxPerMm);

    /* نوکِ ساچمه‌ای یک *دایره* است، نه یک لبهٔ برش. پس سطحِ تماس تقریباً
       مربع/دایره است: پهنا ≈ ضخامت. همین یک تصمیم، خروجی را از «قلمِ نی»
       جدا می‌کند بی‌آنکه رندرر عوض شود. */
    cfg.nibWidth = w;
    cfg.nibThickness = w;
    /* پهنا فقط تا حدی تابعِ فشار است: خودکار زیرِ فشار پهن نمی‌شود، فقط
       تماسِ ساچمه کامل‌تر می‌شود. بازهٔ پهنا ≈ [0.58w … w]. */
    cfg.minContactRatio = clamp(0.58 - clamp01(settings.pressure_sensitivity - 1) * 0.12,
                                0.35, 0.9);
    cfg.thicknessGain = 0.25;
    cfg.heelLift = 0;            // ساچمه پاشنه ندارد
    cfg.nibCornerRound = 1;      // سطحِ تماسِ گرد
    cfg.angleMode = 'fixed';     // زاویهٔ لبه برای نوکِ گرد بی‌معناست
    cfg.tiltContactInfluence = clamp01(settings.tilt_influence) * 0.4;
    cfg.tiltThicknessInfluence = clamp01(settings.tilt_influence) * 0.4;
    // سرعت: اثرِ کران‌دار و هموار (بخش ۱۱۴ و ۱۱۹ — فشار عاملِ اصلی است)
    cfg.velocityWidthInfluence = clamp01(settings.velocity_response) * 0.18;
    cfg.velocityInkInfluence = clamp01(settings.velocity_response);
    cfg.dwellPooling = clamp01(settings.ink_build_up);
    cfg.paperAbsorption = clamp01(settings.paper_absorption);
    cfg.inkFlow = clamp(settings.ink_flow, 0.1, 2);
    // خودکار لکه نمی‌گذارد: مرکبِ آغازِ خط خاموش، رمپِ شروع کارِ مدلِ تماس است
    cfg.startInkBoost = 0;
    /* لبهٔ خط: نه برداریِ کامل، نه دندانه‌دار (بخش ۱۲۶). پهنای حاشیه از
       زبری و جذبِ کاغذ می‌آید و کرانِ سختِ کوچکی دارد. */
    const rough = clamp01(settings.paper_roughness);
    const absorb = clamp01(settings.paper_absorption);
    cfg.inkFringeBands = 1;
    cfg.inkFringeBase = 0.20 + 0.35 * rough;
    cfg.inkFringeRatio = 0.10 + 0.20 * absorb;
    cfg.inkFringeMax = 0.6 + 1.6 * absorb;
    cfg.inkFringeAlpha = 0.34 + 0.20 * rough;
    cfg.inkFringeAbsorption = 0.6 + 0.8 * absorb;
    // گذرِ دوباره روی خطِ نوشته‌شده کمی تیره‌تر می‌شود، ولی اشباع‌شونده
    cfg.inkRepeatGain = 0.22;
    applyNibCapacity(cfg);
    return cfg;
  }

  /* ★ ظرفیتِ نوک باید در *هر* بازسازیِ پیکربندی از نو اعمال شود، نه فقط
     یک بار در pen-down. دلیلش اندازه‌گیری است: app.js یک شنوندهٔ `input`
     روی همهٔ کنترل‌ها دارد و syncConfig در طولِ یک استروک ده‌ها بار صدا
     زده می‌شود (اندازه‌گیری‌شده: ۴۲ بار در یک استروکِ ۱۲۰ نمونه‌ای). هر بار
     nibWidth از اسلایدرها بازسازی می‌شد و ظرفیتِ افزایش‌یافته را پاک
     می‌کرد؛ نتیجه‌اش این بود که پهنای مرجع فقط در نمونهٔ اول اثر داشت. */
  function applyNibCapacity(cfg) {
    if (!(st.needNibWidth > 0)) return cfg;
    if (!st.drawing) return cfg;              // فقط در طولِ استروکِ جاری
    if (cfg.nibWidth < st.needNibWidth) {
      cfg.nibWidth = Math.min(st.needNibWidth, 240);
      if (ballpointOn()) cfg.nibThickness = cfg.nibWidth;
    }
    return cfg;
  }

  /* ===================================================================
     ۷) بومِ لایهٔ Debug — فقط Monitor 1، هرگز در پروتکلِ آینه
     =================================================================== */
  function ensureOverlay() {
    if (IS_MIRROR || st.ovl || !bridge || !bridge.paperEl) return null;
    const c = global.document.createElement('canvas');
    c.id = 'assistOverlay';
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;' +
                      'z-index:3;pointer-events:none';
    bridge.paperEl.appendChild(c);
    st.ovl = c;
    st.ovlCtx = c.getContext('2d', { alpha: true });
    resizeOverlay();
    return c;
  }
  function resizeOverlay() {
    if (!st.ovl || !bridge || !bridge.dims) return;
    const d = bridge.dims();
    st.ovl.width = Math.round(d.W * d.dpr);
    st.ovl.height = Math.round(d.H * d.dpr);
    st.ovl.style.width = d.W + 'px';
    st.ovl.style.height = d.H + 'px';
    st.ovlCtx.setTransform(d.dpr, 0, 0, d.dpr, 0, 0);
  }
  function clearOverlay() {
    if (!st.ovlCtx || !bridge) return;
    const d = bridge.dims();
    st.ovlCtx.clearRect(0, 0, d.W, d.H);
  }

  function drawOverlay() {
    if (IS_MIRROR) return;
    const showDbg = settings.debug_overlay;
    const showGuide = settings.training_mode;
    if (!showDbg && !showGuide) { if (st.ovl) clearOverlay(); return; }
    ensureOverlay();
    if (!st.ovlCtx) return;
    clearOverlay();
    const c = st.ovlCtx;

    // ---- Centerline مرجع ----
    if (st.refStrokes.length) {
      c.save();
      c.lineWidth = 1.2;
      c.setLineDash([5, 4]);
      c.strokeStyle = showGuide ? 'rgba(30,120,220,0.42)' : 'rgba(30,120,220,0.30)';
      for (const rs of st.refStrokes) {
        c.beginPath();
        c.moveTo(rs.points[0].x, rs.points[0].y);
        for (let i = 1; i < rs.points.length; i++) c.lineTo(rs.points[i].x, rs.points[i].y);
        c.stroke();
      }
      c.setLineDash([]);
      // ---- پهنای هدف: دو مرزِ مرجع ----
      if (showDbg) {
        c.strokeStyle = 'rgba(30,120,220,0.18)';
        c.lineWidth = 1;
        for (const rs of st.refStrokes) {
          for (let side = -1; side <= 1; side += 2) {
            c.beginPath();
            for (let i = 0; i < rs.points.length; i++) {
              const t = rs.tangents[i];
              const nx = -Math.sin(t) * rs.widths[i] * 0.5 * side;
              const ny = Math.cos(t) * rs.widths[i] * 0.5 * side;
              const x = rs.points[i].x + nx, y = rs.points[i].y + ny;
              if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
            }
            c.stroke();
          }
        }
      }
      c.restore();
    }

    if (!showDbg) return;
    // ---- مسیرِ خامِ کاربر (نیمه‌شفاف) و مسیرِ اصلاح‌شده ----
    c.save();
    if (st.userPath.length >= 4) {
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(200,60,40,0.35)';
      c.beginPath();
      c.moveTo(st.userPath[0], st.userPath[1]);
      for (let i = 2; i < st.userPath.length; i += 2) c.lineTo(st.userPath[i], st.userPath[i + 1]);
      c.stroke();
    }
    if (st.fixedPath.length >= 4) {
      c.lineWidth = 1.4;
      c.strokeStyle = 'rgba(20,150,90,0.55)';
      c.beginPath();
      c.moveTo(st.fixedPath[0], st.fixedPath[1]);
      for (let i = 2; i < st.fixedPath.length; i += 2) c.lineTo(st.fixedPath[i], st.fixedPath[i + 1]);
      c.stroke();
    }
    c.restore();
  }

  /* ===================================================================
     ۸) HUD فشار  (بخش ۲۲، ۴۰)
     =================================================================== */
  let hudEl = null, hudParts = null;
  function ensureHud() {
    if (IS_MIRROR || hudEl || !global.document || !global.document.body) return;
    const d = global.document;
    hudEl = d.createElement('div');
    hudEl.id = 'assistHud';
    hudEl.hidden = true;
    hudEl.innerHTML =
      '<div class="ah-row"><span>PRESSURE</span><b data-k="p">0%</b></div>' +
      '<div class="ah-bar"><i data-k="pb"></i></div>' +
      '<div class="ah-row" data-r="tp"><span>TARGET PRESSURE</span><b data-k="tp">—</b></div>' +
      '<div class="ah-bar" data-r="tp"><i data-k="tpb" class="ah-t"></i></div>' +
      '<div class="ah-row"><span>ACTUAL WIDTH</span><b data-k="aw">0.0 px</b></div>' +
      '<div class="ah-row" data-r="tw"><span>TARGET WIDTH</span><b data-k="tw">—</b></div>' +
      '<div class="ah-row" data-r="conf"><span>REF CONFIDENCE</span><b data-k="conf">—</b></div>' +
      '<div class="ah-note" data-k="note"></div>';
    d.body.appendChild(hudEl);
    hudParts = {};
    hudEl.querySelectorAll('[data-k]').forEach(e => { hudParts[e.dataset.k] = e; });
    hudParts.rows = {};
    hudEl.querySelectorAll('[data-r]').forEach(e => {
      const k = e.dataset.r;
      (hudParts.rows[k] || (hudParts.rows[k] = [])).push(e);
    });
  }
  function showRows(key, on) {
    if (!hudParts || !hudParts.rows[key]) return;
    for (const e of hudParts.rows[key]) e.hidden = !on;
  }

  let lastHudPaint = 0;
  function updateHud(now) {
    if (IS_MIRROR) return;
    const want = ready && settings.show_pressure &&
                 (settings.intelligent_assist_enabled || settings.real_ballpoint_enabled);
    if (!want) { if (hudEl) hudEl.hidden = true; return; }
    ensureHud();
    if (!hudEl) return;
    hudEl.hidden = false;
    // ۲۰ بار در ثانیه کافی است — HUD نباید در مسیرِ داغ هزینه بسازد
    if (now - lastHudPaint < 50) return;
    lastHudPaint = now;
    const h = st.hud;
    const pct = v => Math.round(clamp01(v) * 100) + '%';

    if (h.pressureSupported) {
      hudParts.p.textContent = pct(h.pressure) + (h.pressureFallback ? ' (تخمینی)' : '');
    } else {
      // بخش ۴۵: هرگز مقدارِ جعلی نساز
      hudParts.p.textContent = h.pressureFallback ? pct(h.pressure) + ' (تخمینی)'
                                                  : 'Pressure unavailable';
    }
    hudParts.pb.style.width = (clamp01(h.pressure) * 100) + '%';

    const showTP = settings.show_target_pressure && h.targetWidth > 0;
    showRows('tp', showTP);
    if (showTP) {
      hudParts.tp.textContent = pct(h.targetPressure) +
                                (h.targetOutOfRange ? ' (بیرونِ توانِ قلم)' : '');
      hudParts.tpb.style.width = (clamp01(h.targetPressure) * 100) + '%';
    }
    hudParts.aw.textContent = h.actualWidth.toFixed(1) + ' px';
    const showTW = settings.show_target_width && h.targetWidth > 0;
    showRows('tw', showTW);
    if (showTW) hudParts.tw.textContent = h.targetWidth.toFixed(1) + ' px';

    const showConf = st.analysis && st.analysis.ok;
    showRows('conf', showConf);
    if (showConf) hudParts.conf.textContent = pct(st.analysis.confidence);

    let note = '';
    if (st.analyzing) note = 'تحلیلِ مرجع در جریان…';
    else if (settings.assist_mode === 'reference' && !st.refStrokes.length) {
      note = 'مرجعی تحلیل نشده — یک عکس وارد کن';
    } else if (st.analysis && st.analysis.ok && st.analysis.confidence < 0.35) {
      note = 'Reference confidence low — کمک محدود شد';
    } else if (settings.training_mode) {
      note = 'مسیر ' + pct(st.metrics.trainPath) +
             ' · پهنا ' + pct(st.metrics.trainWidth);
    } else if (h.gap) note = 'ink gap';
    hudParts.note.textContent = note;
    hudParts.note.hidden = !note;
  }

  function frame(now) {
    if (!ready || IS_MIRROR) return;
    updateHud(now === undefined ? perfNow() : now);
    drawOverlay();
    updateDebugPanel();
  }

  /* ===================================================================
     ۹) پنلِ «دستیارِ هوشمند»  (بخش ۳۸)
     -------------------------------------------------------------------
     پنل *به‌صورتِ برنامه‌ای* ساخته می‌شود، نه در index.html. دلیل:
     mirror.html و bench/harness.js هر دو یک «داربستِ» دستی از شناسه‌های
     کنترل‌ها می‌سازند و اگر app.js به شناسهٔ تازه‌ای *نیاز* پیدا کند،
     هر دو باید عوض شوند و هر تستِ موجود شکننده می‌شود. با ساختِ
     برنامه‌ای، این پنل هیچ پیش‌نیازی به DOM بیرونی ندارد.
     =================================================================== */
  const CTL = [];   // { el, get, set }
  let panelEl = null, dbgPanelEl = null;

  function row(label, node) {
    const d = global.document;
    const w = d.createElement('label');
    w.className = 'ap-row';
    const s = d.createElement('span');
    s.textContent = label;
    w.appendChild(s);
    w.appendChild(node);
    return w;
  }
  function mkRange(key, min, max, step, fmt) {
    const d = global.document;
    const box = d.createElement('span');
    box.className = 'ap-range';
    const i = d.createElement('input');
    i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step);
    const b = d.createElement('b');
    const paint = () => { b.textContent = fmt ? fmt(Number(i.value)) : i.value; };
    i.addEventListener('input', () => {
      settings[key] = Number(i.value);
      paint(); onSettingChange(key);
    });
    box.appendChild(i); box.appendChild(b);
    CTL.push({ key: key, sync: () => { i.value = String(settings[key]); paint(); } });
    return box;
  }
  function mkCheck(key) {
    const d = global.document;
    const i = d.createElement('input');
    i.type = 'checkbox';
    i.addEventListener('change', () => { settings[key] = i.checked; onSettingChange(key); });
    CTL.push({ key: key, sync: () => { i.checked = !!settings[key]; } });
    return i;
  }
  function mkSelect(key, opts) {
    const d = global.document;
    const s = d.createElement('select');
    for (const o of opts) {
      const op = d.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      s.appendChild(op);
    }
    s.addEventListener('change', () => { settings[key] = s.value; onSettingChange(key); });
    CTL.push({ key: key, sync: () => { s.value = String(settings[key]); } });
    return s;
  }
  function mkButton(text, fn, title) {
    const b = global.document.createElement('button');
    b.type = 'button'; b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  }
  function section(title) {
    const h = global.document.createElement('h4');
    h.textContent = title;
    return h;
  }

  function onSettingChange(key) {
    if (key === 'pen_preset') A.applyPenPreset(settings, settings.pen_preset);
    if (key === 'paper_type') A.applyPaperType(settings, settings.paper_type);
    if (key === 'pen_preset' || key === 'paper_type') syncPanel();
    if (key === 'smoothing_strength' && st.euro) st.euro.configure(stabAmount());
    if (key === 'analysis_max_side' || key === 'centerline_step') {
      if (st.cache) st.cache.clear();
      if (st.image) setReference(st.image);
    }
    if (key === 'real_ballpoint_enabled' && bridge && bridge.setBallpointTool) {
      bridge.setBallpointTool(!!settings.real_ballpoint_enabled);
    }
    if (key === 'debug_overlay' || key === 'training_mode') {
      if (!settings.debug_overlay && !settings.training_mode) clearOverlay();
      syncDebugPanelVisibility();
    }
    logEnabled = !!(settings.debug_overlay || settings.training_mode);
    saveSettings();
    invalidate();
  }

  function buildPanel() {
    if (IS_MIRROR || panelEl || !global.document || !global.document.body) return;
    const d = global.document;
    injectStyle();

    panelEl = d.createElement('div');
    panelEl.id = 'assistPanel';
    panelEl.hidden = true;

    const head = d.createElement('div');
    head.className = 'ap-head';
    const t = d.createElement('strong');
    t.textContent = 'دستیارِ هوشمند خوشنویسی';
    head.appendChild(t);
    head.appendChild(mkButton('×', () => togglePanel(false)));
    panelEl.appendChild(head);

    const body = d.createElement('div');
    body.className = 'ap-body';
    panelEl.appendChild(body);

    body.appendChild(row('Enable Intelligent Assist', mkCheck('intelligent_assist_enabled')));
    body.appendChild(row('Mode', mkSelect('assist_mode', [
      ['free', 'Free — بدونِ مرجع'],
      ['reference', 'Reference Trace — از روی مرجع'],
    ])));
    body.appendChild(row('Assist Strength', mkRange('assist_strength', 0, 1, 0.05,
      v => Math.round(v * 100) + '%')));
    body.appendChild(row('Width', mkSelect('width_mode', [
      ['pressure', 'Pressure'], ['reference', 'Reference'], ['hybrid', 'Hybrid'],
    ])));
    body.appendChild(row('Hybrid Pressure Range', mkRange('hybrid_pressure_range', 0, 0.6, 0.05,
      v => '±' + Math.round(v * 100) + '%')));
    body.appendChild(row('Smoothing', mkRange('smoothing_strength', 0, 1, 0.05,
      v => Math.round(v * 100) + '%')));
    body.appendChild(row('Match Tolerance', mkRange('match_tolerance', 0.5, 6, 0.1,
      v => v.toFixed(1) + '×')));
    body.appendChild(row('Style', mkSelect('style', [
      ['calligraphy', 'Calligraphy'], ['drawing', 'Drawing'], ['custom', 'Custom'],
    ])));

    body.appendChild(section('فشار'));
    body.appendChild(row('Pressure', mkCheck('pressure_enabled')));
    body.appendChild(row('Pressure Curve', mkSelect('pressure_curve', [
      ['soft', 'Soft'], ['normal', 'Normal'], ['hard', 'Hard'],
      ['linear', 'Linear'], ['custom', 'Custom'],
    ])));
    body.appendChild(row('Curve Gamma (custom)', mkRange('pressure_curve_gamma', 0.2, 3, 0.05,
      v => v.toFixed(2))));
    body.appendChild(row('Pressure Sensitivity', mkRange('pressure_sensitivity', 0.2, 3, 0.05,
      v => v.toFixed(2))));
    body.appendChild(row('Pressure Min', mkRange('pressure_min', 0, 0.5, 0.01, v => v.toFixed(2))));
    body.appendChild(row('Pressure Max', mkRange('pressure_max', 0.5, 1, 0.01, v => v.toFixed(2))));
    body.appendChild(row('Show Pressure', mkCheck('show_pressure')));
    body.appendChild(row('Show Target Pressure', mkCheck('show_target_pressure')));
    body.appendChild(row('Show Target Width', mkCheck('show_target_width')));

    body.appendChild(section('خودکارِ ساچمه‌ایِ واقعی'));
    body.appendChild(row('Real Ballpoint', mkCheck('real_ballpoint_enabled')));
    body.appendChild(row('Pen Preset', mkSelect('pen_preset',
      Object.keys(A.PEN_PRESETS).map(k => [k, A.PEN_PRESETS[k].name]))));
    body.appendChild(row('Base Width (mm)', mkRange('base_width_mm', 0.2, 1.4, 0.05,
      v => v.toFixed(2) + ' mm')));
    body.appendChild(row('Ink Flow', mkRange('ink_flow', 0.3, 1.6, 0.02, v => v.toFixed(2))));
    body.appendChild(row('Ink Density', mkRange('ink_density', 0.4, 1.4, 0.02, v => v.toFixed(2))));
    body.appendChild(row('Ink Build-up', mkRange('ink_build_up', 0, 1, 0.05, v => v.toFixed(2))));
    body.appendChild(row('Ink Dryness', mkRange('ink_dryness', 0, 1, 0.05, v => v.toFixed(2))));
    body.appendChild(row('Velocity Response', mkRange('velocity_response', 0, 1, 0.05, v => v.toFixed(2))));
    body.appendChild(row('Natural Variation', mkRange('natural_variation', 0, 1, 0.05,
      v => Math.round(v * 100) + '%')));
    body.appendChild(row('Start Taper', mkRange('start_taper', 0, 1, 0.05, v => v.toFixed(2))));
    body.appendChild(row('End Taper', mkRange('end_taper', 0, 1, 0.05, v => v.toFixed(2))));

    body.appendChild(section('کاغذ'));
    body.appendChild(row('Paper Type', mkSelect('paper_type',
      Object.keys(A.PAPER_TYPES).map(k => [k, A.PAPER_TYPES[k].name]))));
    body.appendChild(row('Paper Roughness', mkRange('paper_roughness', 0, 1, 0.05, v => v.toFixed(2))));
    body.appendChild(row('Paper Absorption', mkRange('paper_absorption', 0, 1, 0.05, v => v.toFixed(2))));

    body.appendChild(section('آموزش و اشکال‌زدایی'));
    body.appendChild(row('Training Mode', mkCheck('training_mode')));
    body.appendChild(row('Debug Overlay', mkCheck('debug_overlay')));
    body.appendChild(row('Analysis Max Side', mkRange('analysis_max_side', 256, 2048, 64,
      v => v + ' px')));

    const refLine = d.createElement('div');
    refLine.className = 'ap-ref';
    refLine.id = 'assistRefState';
    body.appendChild(refLine);

    const btns = d.createElement('div');
    btns.className = 'ap-btns';
    btns.appendChild(mkButton('تحلیلِ دوبارهٔ مرجع', () => {
      if (st.cache) st.cache.clear();
      if (st.image) setReference(st.image);
      else log('تصویرِ مرجعی وارد نشده است');
    }));
    btns.appendChild(mkButton('صدورِ پیش‌تنظیم', () => {
      const txt = exportPreset();
      try {
        const blob = new global.Blob([txt], { type: 'application/json' });
        const a = d.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'My Ballpoint Pen.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (_) { log(txt); }
    }, 'تنظیماتِ قلم را در یک فایل JSON ذخیره کن'));
    const imp = d.createElement('input');
    imp.type = 'file'; imp.accept = 'application/json,.json'; imp.hidden = true;
    imp.addEventListener('change', () => {
      const f = imp.files && imp.files[0];
      if (!f) return;
      const fr = new global.FileReader();
      fr.onload = () => importPreset(String(fr.result));
      fr.readAsText(f);
      imp.value = '';
    });
    btns.appendChild(imp);
    btns.appendChild(mkButton('ورودِ پیش‌تنظیم', () => imp.click()));
    btns.appendChild(mkButton('پیش‌فرض', resetSettings));
    body.appendChild(btns);

    d.body.appendChild(panelEl);
    buildDebugPanel();
    syncPanel();
  }

  function updateRefLabel() {
    const el = global.document && global.document.getElementById('assistRefState');
    if (!el) return;
    if (st.analyzing) { el.textContent = 'مرجع: در حالِ تحلیل…'; return; }
    if (!st.analysis) { el.textContent = 'مرجع: وارد نشده'; return; }
    const a = st.analysis;
    el.textContent = 'مرجع: ' + a.strokes.length + ' stroke · اعتماد ' +
      Math.round(a.confidence * 100) + '% · ' + a.width + '×' + a.height +
      ' · ' + a.analysisMs + 'ms' + (a.note ? ' · ' + a.note : '');
  }

  function syncPanel() {
    for (const c of CTL) { try { c.sync(); } catch (_) {} }
    updateRefLabel();
  }

  function togglePanel(force) {
    buildPanel();
    if (!panelEl) return;
    panelEl.hidden = force === undefined ? !panelEl.hidden : !force;
    if (!panelEl.hidden) syncPanel();
  }

  /* ---- پنلِ سنجه‌های Debug (بخش ۵۵) ---- */
  let dbgFields = null;
  function buildDebugPanel() {
    if (IS_MIRROR || dbgPanelEl) return;
    const d = global.document;
    dbgPanelEl = d.createElement('div');
    dbgPanelEl.id = 'assistDebug';
    dbgPanelEl.hidden = true;
    dbgPanelEl.innerHTML =
      '<strong>Assist Metrics</strong>' +
      ['inputPoints:Input Points', 'resampledPoints:Resampled Points',
       'rawLength:Raw Length', 'correctedLength:Corrected Length',
       'avgPressure:Average Pressure', 'maxPressure:Max Pressure',
       'actualWidth:Actual Width', 'targetWidth:Target Width',
       'assist:Assist Strength', 'conf:Reference Confidence',
       'match:Matched / Total',
       'tMatch:Matching', 'tShape:Reconstruction', 'tAnalysis:Reference Analysis',
       'trainPath:Path Accuracy', 'trainWidth:Width Accuracy']
        .map(s => {
          const p = s.split(':');
          return '<div class="ad-row"><span>' + p[1] + '</span><b data-d="' + p[0] + '">—</b></div>';
        }).join('');
    d.body.appendChild(dbgPanelEl);
    dbgFields = {};
    dbgPanelEl.querySelectorAll('[data-d]').forEach(e => { dbgFields[e.dataset.d] = e; });
  }
  function syncDebugPanelVisibility() {
    if (!dbgPanelEl) return;
    dbgPanelEl.hidden = !(settings.debug_overlay || settings.training_mode);
  }
  let lastDbgPaint = 0;
  function updateDebugPanel() {
    if (!dbgPanelEl || dbgPanelEl.hidden) return;
    const now = perfNow();
    if (now - lastDbgPaint < 120) return;
    lastDbgPaint = now;
    const m = st.metrics, h = st.hud, f = dbgFields;
    const n = m.resampledPoints || 1;
    f.inputPoints.textContent = m.inputPoints;
    f.resampledPoints.textContent = m.resampledPoints;
    f.rawLength.textContent = m.rawLength.toFixed(0) + ' px';
    f.correctedLength.textContent = m.correctedLength.toFixed(0) + ' px';
    f.avgPressure.textContent = (m.pressureSum / n).toFixed(2);
    f.maxPressure.textContent = m.pressureMax.toFixed(2);
    f.actualWidth.textContent = h.actualWidth.toFixed(1) + ' px';
    f.targetWidth.textContent = h.targetWidth > 0 ? h.targetWidth.toFixed(1) + ' px' : '—';
    f.assist.textContent = Math.round(settings.assist_strength * 100) + '%';
    f.conf.textContent = st.analysis && st.analysis.ok
      ? Math.round(st.analysis.confidence * 100) + '%' : '—';
    f.match.textContent = m.matched + ' / ' + (m.matched + m.missed);
    f.tMatch.textContent = m.matchMs.toFixed(2) + ' ms';
    f.tShape.textContent = m.shapeMs.toFixed(2) + ' ms';
    f.tAnalysis.textContent = m.analysisMs ? m.analysisMs + ' ms' : '—';
    f.trainPath.textContent = Math.round(m.trainPath * 100) + '%';
    f.trainWidth.textContent = Math.round(m.trainWidth * 100) + '%';
  }

  /* ---- سبک‌ها: یک بار، در یک <style> اختصاصی ---- */
  let styleInjected = false;
  function injectStyle() {
    if (styleInjected || !global.document) return;
    styleInjected = true;
    const s = global.document.createElement('style');
    s.id = 'assistStyle';
    s.textContent = `
#assistPanel{position:fixed;z-index:60;left:12px;top:12px;width:340px;max-height:88vh;
 overflow:auto;background:rgba(22,20,17,.96);color:#e9e0cd;border:1px solid #6b6156;
 border-radius:10px;font:12px/1.6 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45)}
#assistPanel .ap-head{display:flex;justify-content:space-between;align-items:center;
 padding:8px 10px;border-bottom:1px solid #453d34;position:sticky;top:0;
 background:rgba(22,20,17,.98)}
#assistPanel .ap-head button{background:#2c251d;color:#e9e0cd;border:1px solid #6b6156;
 border-radius:6px;cursor:pointer;width:24px;height:24px;line-height:1}
#assistPanel .ap-body{padding:8px 10px 12px}
#assistPanel h4{margin:12px 0 4px;font-size:11px;letter-spacing:.04em;color:#c9ba9e;
 border-bottom:1px dashed #453d34;padding-bottom:3px}
#assistPanel .ap-row{display:flex;justify-content:space-between;align-items:center;
 gap:8px;padding:2px 0}
#assistPanel .ap-row>span{flex:1 1 auto;opacity:.86}
#assistPanel .ap-range{display:flex;align-items:center;gap:6px}
#assistPanel .ap-range input{width:118px}
#assistPanel .ap-range b{min-width:5.5ch;text-align:left;font-variant-numeric:tabular-nums}
#assistPanel select{background:#2c251d;color:#e9e0cd;border:1px solid #6b6156;
 border-radius:5px;padding:1px 4px;max-width:170px}
#assistPanel .ap-ref{margin-top:10px;padding:6px 8px;background:#1b1712;border-radius:6px;
 border:1px solid #3d362d;font-size:11px;opacity:.9}
#assistPanel .ap-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#assistPanel .ap-btns button{background:#2c251d;color:#e9e0cd;border:1px solid #6b6156;
 border-radius:6px;padding:3px 8px;cursor:pointer;font:inherit}
#assistHud{position:fixed;z-index:58;right:12px;bottom:12px;width:210px;
 background:rgba(18,16,13,.90);color:#e9e0cd;border:1px solid #6b6156;border-radius:9px;
 padding:8px 10px;font:11px/1.5 ui-monospace,monospace;pointer-events:none}
#assistHud .ah-row{display:flex;justify-content:space-between;gap:8px}
#assistHud .ah-row b{font-variant-numeric:tabular-nums}
#assistHud .ah-bar{height:6px;background:#332c24;border-radius:3px;overflow:hidden;
 margin:2px 0 5px}
#assistHud .ah-bar i{display:block;height:100%;width:0;background:#d8a24a}
#assistHud .ah-bar i.ah-t{background:#4a9ad8}
#assistHud .ah-note{margin-top:4px;font-size:10px;opacity:.8;color:#e8c98a}
#assistDebug{position:fixed;z-index:58;right:12px;top:12px;width:230px;
 background:rgba(18,16,13,.90);color:#e9e0cd;border:1px solid #6b6156;border-radius:9px;
 padding:8px 10px;font:10.5px/1.5 ui-monospace,monospace;pointer-events:none}
#assistDebug strong{display:block;margin-bottom:4px;color:#c9ba9e}
#assistDebug .ad-row{display:flex;justify-content:space-between;gap:8px}
#assistDebug .ad-row b{font-variant-numeric:tabular-nums}
`;
    global.document.head.appendChild(s);
  }

  /* ===================================================================
     ۱۰) راه‌اندازی
     =================================================================== */
  function init(b) {
    if (!A || !R) return false;
    bridge = b || {};
    st.press = new A.PressureEngine(settings);
    st.paper = new A.PaperModel(settings);
    loadSettings();
    logEnabled = !!(settings.debug_overlay || settings.training_mode);
    ready = true;
    if (IS_MIRROR) {
      // ★ Monitor 2: هیچ UI، هیچ Overlay، هیچ مرجع. فقط مرکبِ نهایی.
      log('mirror window — assist UI disabled');
      return true;
    }
    buildPanel();
    syncDebugPanelVisibility();
    // دکمهٔ نوارِ ابزار، اگر index.html آن را داشته باشد
    const btn = global.document && global.document.getElementById('assistBtn');
    if (btn) btn.addEventListener('click', () => togglePanel());
    global.addEventListener('keydown', e => {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) { togglePanel(); e.preventDefault(); }
    });
    ensureOverlay();
    log('Enabled=' + settings.intelligent_assist_enabled +
        ' Ballpoint=' + settings.real_ballpoint_enabled);
    return true;
  }

  global.QalamAssistUI = {
    init, beginStroke, position, shape, endStroke, config,
    setReference, invalidate, frame, hover,
    togglePanel, syncPanel, saveSettings, loadSettings, resetSettings,
    exportPreset, importPreset,
    settings: settings,
    state: st,
    get logLines() { return logLines.slice(); },
    get enabled() { return anyOn(); },
    get assistEnabled() { return assistOn(); },
    get ballpointEnabled() { return ballpointOn(); },
    get traceEnabled() { return traceOn(); },
    confidence,
    stabAmount, pathAmount, widthAmount,
    isMirror: IS_MIRROR,
    VERSION: '1.0.0',
  };
})(typeof window !== 'undefined' ? window : globalThis);
