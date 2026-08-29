/* =====================================================================
   stylus.js — لایهٔ انتزاعِ قلم نوری (Stylus Abstraction Layer)
   ---------------------------------------------------------------------
   هدف: موتورِ قلم هرگز نباید مستقیماً به PointerEvent مرورگر نگاه کند.

       PointerEvent (Chrome / Firefox / Safari / …)
                 ↓
       Capability Detection   (نه Browser Detection)
                 ↓
       Normalization + Validity State Machine
                 ↓
       StylusState  ← تنها چیزی که موتور می‌بیند
                 ↓
       Brush / Nib Engine

   سه اصلِ حاکم:

   ۱) هیچ‌جا browser sniffing نیست. هر قابلیت با آزمونِ وجود/رفتار
      تشخیص داده می‌شود.

   ۲) «صفر» با «نداشتن» یکی نیست.
      طبق W3C Pointer Events Level 3 (§4.1):
        • pressure برای سخت‌افزارِ بی‌حسِ فشار «باید» در حالتِ فعالِ دکمه
          دقیقاً 0.5 و در غیرِ آن 0 باشد.
        • tiltX/tiltY برای سخت‌افزاری که زاویه نمی‌دهد «باید» 0 باشد.
        • twist برای سخت‌افزاری که آن را نمی‌دهد «باید» 0 باشد.
        • altitudeAngle پیش‌فرض π/2 است (قلمِ عمود) و اگر سخت‌افزار
          زاویه ندهد هم «باید» π/2 باشد.
        • azimuthAngle وقتی قلم کاملاً عمود است (altitude = π/2)
          «باید» 0 باشد، و اگر سخت‌افزار زاویه ندهد هم «باید» 0 باشد.
      نتیجه‌ی مهم: مقدارِ 0 در azimuth و (0,0) در tilt هم می‌تواند
      «دادهٔ نداشته» باشد و هم «قلمِ کاملاً عمود». تنها نشانهٔ قطعیِ
      وجودِ دادهٔ جهت‌گیری این است که altitudeAngle ≠ π/2 یا tilt ≠ (0,0).

   ۳) Graceful degradation: نبودنِ یک قابلیت باعثِ خرابی یا مقدارِ
      ساختگی نمی‌شود؛ فقط در StylusState به‌صورت UNSUPPORTED علامت
      می‌خورد تا UI بتواند صادقانه نشانش دهد.
   ===================================================================== */
(function (global) {
  'use strict';

  const HALF_PI = Math.PI / 2;
  const RAD2DEG = 180 / Math.PI;
  const DEG2RAD = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ===================================================================
     ۱) وضعیتِ پشتیبانی — سه‌حالته، نه بولین
     =================================================================== */
  const SUPPORT = {
    UNKNOWN: 'unknown',        // هنوز داده‌ای ندیده‌ایم
    SUPPORTED: 'supported',    // مشاهده شد که دادهٔ واقعی می‌آید
    UNSUPPORTED: 'unsupported',// مشاهده شد که فقط مقدارِ پیش‌فرض می‌آید
  };

  const ORIENTATION = {
    UNKNOWN: 'unknown',
    VALID: 'valid',            // همین رویداد جهت‌گیریِ معتبر داشت
    HELD: 'held',              // جهت‌گیریِ معتبر نداشت، آخرین معتبر نگه داشته شد
    EXPIRED: 'expired',        // مدتی جهت‌گیری نیامده؛ به fallback برمی‌گردیم
  };

  /* ===================================================================
     ۲) تشخیصِ قابلیتِ ایستا (API-level)
     -------------------------------------------------------------------
     این‌ها فقط می‌گویند «مرورگر این property/رویداد را دارد یا نه»؛
     نمی‌گویند «سخت‌افزار داده می‌دهد یا نه». آن دومی فقط با مشاهده
     معلوم می‌شود (بخش ۴).
     =================================================================== */
  function detectApi() {
    const out = {
      pointerEvent: typeof global.PointerEvent === 'function',
      secureContext: !!global.isSecureContext,
      pointerrawupdate: 'onpointerrawupdate' in global,
      getCoalescedEvents: false,
      getPredictedEvents: false,
      pressure: false, tangentialPressure: false,
      tiltX: false, tiltY: false, twist: false,
      altitudeAngle: false, azimuthAngle: false,
      persistentDeviceId: false,
      inkPresenter: !!(global.navigator && global.navigator.ink &&
                       typeof global.navigator.ink.requestPresenter === 'function'),
      maxTouchPoints: (global.navigator && global.navigator.maxTouchPoints) || 0,
    };
    if (!out.pointerEvent) return out;
    let probe = null;
    try { probe = new global.PointerEvent('pointermove', { pointerId: 1 }); }
    catch (_) { return out; }
    out.getCoalescedEvents = typeof probe.getCoalescedEvents === 'function';
    out.getPredictedEvents = typeof probe.getPredictedEvents === 'function';
    for (const k of ['pressure', 'tangentialPressure', 'tiltX', 'tiltY', 'twist',
                     'altitudeAngle', 'azimuthAngle', 'persistentDeviceId']) {
      out[k] = (k in probe);
    }
    // آیا مرورگر بین tilt و spherical تبدیل می‌کند؟ ([PE3] §4.1.5 الزامی است)
    out.convertsSphericalToTilt = false;
    out.convertsTiltToSpherical = false;
    try {
      const a = new global.PointerEvent('pointermove',
        { pointerId: 2, tiltX: -23, tiltY: 41 });
      if (out.altitudeAngle) {
        out.convertsTiltToSpherical = Math.abs(a.altitudeAngle - HALF_PI) > 1e-6;
      }
      if (out.altitudeAngle && out.azimuthAngle) {
        const b = new global.PointerEvent('pointermove',
          { pointerId: 3, altitudeAngle: Math.PI / 6, azimuthAngle: Math.PI / 3 });
        out.convertsSphericalToTilt = (b.tiltX !== 0 || b.tiltY !== 0);
      }
    } catch (_) {}
    return out;
  }

  /* ===================================================================
     ۳) تبدیلِ مختصات — پیاده‌سازیِ الگوریتمِ [PE3] §4.1.5
     -------------------------------------------------------------------
     مرورگرها معمولاً فقط یکی از دو نمایش را از پلتفرم می‌گیرند و آن یکی
     را محاسبه می‌کنند. ما نباید propertyها را بی‌تبدیل با هم قاطی کنیم؛
     پس همیشه به یک نمایشِ واحد می‌رویم:

        (tiltX, tiltY)  یا  (altitude, azimuth)
                     ↓
        بردارِ یکهٔ سه‌بعدیِ قلم  (vx, vy, vz)
                     ↓
        lean (میزانِ خوابیدن)  +  leanDir (جهتِ خوابیدن روی صفحه)
                     ↓
        جهت‌گیریِ نوک  →  سطحِ تماسِ دوبعدی
     =================================================================== */
  function tiltToSpherical(tiltXdeg, tiltYdeg, out) {
    const tx = tiltXdeg * DEG2RAD, ty = tiltYdeg * DEG2RAD;
    let azimuth = 0, altitude = 0;
    if (tiltXdeg === 0) {
      if (tiltYdeg > 0) azimuth = HALF_PI;
      else if (tiltYdeg < 0) azimuth = 3 * HALF_PI;
    } else if (tiltYdeg === 0) {
      if (tiltXdeg < 0) azimuth = Math.PI;
    } else if (Math.abs(tiltXdeg) === 90 || Math.abs(tiltYdeg) === 90) {
      azimuth = 0;
    } else {
      const tanX = Math.tan(tx), tanY = Math.tan(ty);
      azimuth = Math.atan2(tanY, tanX);
      if (azimuth < 0) azimuth += 2 * Math.PI;
    }
    if (Math.abs(tiltXdeg) === 90 || Math.abs(tiltYdeg) === 90) {
      altitude = 0;
    } else if (tiltXdeg === 0) {
      altitude = HALF_PI - Math.abs(ty);
    } else if (tiltYdeg === 0) {
      altitude = HALF_PI - Math.abs(tx);
    } else {
      altitude = Math.atan(
        1 / Math.sqrt(
          Math.tan(tx) * Math.tan(tx) + Math.tan(ty) * Math.tan(ty)
        )
      );
    }
    out.azimuth = azimuth;
    out.altitude = altitude;
    return out;
  }

  function sphericalToTilt(altitude, azimuth, out) {
    let tiltXrad = 0, tiltYrad = 0;
    if (altitude === 0) {
      if (azimuth === 0 || azimuth === 2 * Math.PI) tiltXrad = HALF_PI;
      else if (azimuth === HALF_PI) tiltYrad = HALF_PI;
      else if (azimuth === Math.PI) tiltXrad = -HALF_PI;
      else if (azimuth === 3 * HALF_PI) tiltYrad = -HALF_PI;
      else if (azimuth > 0 && azimuth < HALF_PI) { tiltXrad = HALF_PI; tiltYrad = HALF_PI; }
      else if (azimuth > HALF_PI && azimuth < Math.PI) { tiltXrad = -HALF_PI; tiltYrad = HALF_PI; }
      else if (azimuth > Math.PI && azimuth < 3 * HALF_PI) { tiltXrad = -HALF_PI; tiltYrad = -HALF_PI; }
      else { tiltXrad = HALF_PI; tiltYrad = -HALF_PI; }
    } else {
      const tanAlt = Math.tan(altitude);
      tiltXrad = Math.atan(Math.cos(azimuth) / tanAlt);
      tiltYrad = Math.atan(Math.sin(azimuth) / tanAlt);
    }
    out.tiltX = tiltXrad * RAD2DEG;
    out.tiltY = tiltYrad * RAD2DEG;
    return out;
  }

  // بردارِ یکهٔ قلم: z به سمتِ بالا (خارج از صفحه)
  function penVector(altitude, azimuth, out) {
    const ca = Math.cos(altitude);
    out.vx = Math.cos(azimuth) * ca;
    out.vy = Math.sin(azimuth) * ca;
    out.vz = Math.sin(altitude);
    // lean = 0 وقتی قلم عمود است، = 1 وقتی روی صفحه خوابیده
    out.lean = clamp01(Math.sqrt(out.vx * out.vx + out.vy * out.vy));
    out.leanDir = (out.vx === 0 && out.vy === 0) ? 0 : Math.atan2(out.vy, out.vx);
    return out;
  }

  /* ===================================================================
     ۴) کالیبراسیونِ فشار — با ذخیره‌سازیِ ماندگار
     -------------------------------------------------------------------
        rawPressure
          → device normalization  (minRaw..maxRaw)
          → deadzone
          → smoothing (EMA)
          → curve (exponent + gamma قابل تنظیم)
          → physicalPressure ∈ [0,1]
     =================================================================== */
  const CAL_DEFAULTS = {
    minRawPressure: 0.02,
    maxRawPressure: 1.0,
    deadzone: 0.012,
    smoothing: 0.35,
    curveExponent: 0.85,
    // بیشینه‌ی افتِ مجازِ فشار در هر نمونه (ضدِ نمونه‌ی پرت) — ۰ = خاموش
    outlierDrop: 0.12,
    // فشارِ جانشین وقتی سخت‌افزار فشار نمی‌دهد (ماوس یا درایورِ بی‌فشار)
    fallbackMode: 'velocity',      // 'velocity' | 'constant'
    fallbackConstant: 0.75,
    // آستانه‌ی تشخیصِ «سخت‌افزار فشار می‌دهد»
    detectSamples: 12,
    /* ---- پنجرهٔ آماده‌سازیِ فیلترِ فشار (رفعِ ریشه‌ایِ مسئلهٔ ۱) --------
       اندازه‌گیری‌شده (bench/diag-first-ink.html، Chrome 150 و Firefox 154):
       اگر نمونهٔ pointerdown نمایندهٔ فشارِ واقعیِ کاربر نباشد — مثلاً
       ۰٫۵ که طبق [PE3] §4.1 «مقدارِ پیش‌فرضِ سخت‌افزارِ بی‌حسِ فشار» است،
       یا جهشِ لحظهٔ عبور از آستانهٔ دیجیتایزر — آن *یک* نمونه فیلترِ EMA را
       مقدار‌دهیِ اولیه می‌کرد (`_primed=false ⇒ filtered = normalized`) و
       سپس دو محدودگرِ نرخ (outlierDrop و maxWidthDropPerPx) اجازه نمی‌دادند
       سریع اصلاح شود. نتیجهٔ اندازه‌گیری‌شده با pointerdown=0.5 و بقیه=0.15:
           پهنای تماسِ نمونهٔ اول 11.72px در برابر 5.07px حالتِ پایا
           (۲٫۳۱ برابر)، و ۱۶ پیکسل مسافت تا نشستن ⇒ یک «سرِ تمام‌پهنا».
       رفع: فیلتر با *میانهٔ* چند نمونهٔ نخست مقدار‌دهی می‌شود، نه با نمونهٔ
       اول. میانه هم به جهشِ بالا و هم به فرودِ پایین مقاوم است و چون
       حالتِ PENDING_INPUT پیش از رسیدنِ نمونهٔ دوم چیزی رسم نمی‌کند،
       هیچ تأخیرِ دیدنی اضافه نمی‌شود.
       primeSamples = 1 رفتارِ قدیمی را برمی‌گرداند. */
    primeSamples: 3,
    /* فشاری که فقط وقتی استروک *هیچ* نمونهٔ فشارِ قابلِ‌اعتمادی نداشته
       به کار می‌رود (مثلاً یک کلیکِ ماوس بی‌حرکت). «فشارِ آغازینِ
       کنترل‌شده» — نه تمام‌پهنا. */
    unknownPressure: 0.55,
  };
  const CAL_KEY = 'qalam.stylus.calibration.v1';

  function PressureCalibration(overrides) {
    this.params = {};
    for (const k in CAL_DEFAULTS) this.params[k] = CAL_DEFAULTS[k];
    this.load();
    if (overrides) for (const k in overrides) {
      if (overrides[k] !== undefined) this.params[k] = overrides[k];
    }
    this.reset();
    // آمارِ مشاهده‌شده — برای پیشنهادِ خودکارِ min/max
    this.observedMin = Infinity;
    this.observedMax = -Infinity;
  }
  PressureCalibration.prototype.reset = function () {
    this.raw = 0; this.normalized = 0; this.filtered = 0;
    this.mapped = 0; this._held = 0; this._primed = false;
    this.clampedDrops = 0;
    // پنجرهٔ آماده‌سازی: تا پر نشود، فیلتر با میانهٔ نمونه‌ها ست می‌شود
    this._prime = [0, 0, 0, 0, 0];
    this._primeN = 0;
    this.priming = true;
    this.trustedSamples = 0;
    return this;
  };
  PressureCalibration.prototype.load = function () {
    try {
      const s = global.localStorage && global.localStorage.getItem(CAL_KEY);
      if (!s) return false;
      const o = JSON.parse(s);
      for (const k in CAL_DEFAULTS) {
        if (typeof o[k] === typeof CAL_DEFAULTS[k]) this.params[k] = o[k];
      }
      return true;
    } catch (_) { return false; }
  };
  PressureCalibration.prototype.save = function () {
    try {
      global.localStorage.setItem(CAL_KEY, JSON.stringify(this.params));
      return true;
    } catch (_) { return false; }
  };
  PressureCalibration.prototype.restoreDefaults = function () {
    for (const k in CAL_DEFAULTS) this.params[k] = CAL_DEFAULTS[k];
    this.save();
    return this;
  };
  // پیشنهادِ بازهٔ سخت‌افزار از مشاهده (دکمه‌ی «کالیبره کن» در UI)
  PressureCalibration.prototype.autoRange = function () {
    if (!isFinite(this.observedMin) || !isFinite(this.observedMax)) return false;
    if (this.observedMax - this.observedMin < 0.05) return false;
    this.params.minRawPressure = Math.max(0, this.observedMin);
    this.params.maxRawPressure = Math.min(1, this.observedMax);
    this.save();
    return true;
  };
  PressureCalibration.prototype.clearObserved = function () {
    this.observedMin = Infinity; this.observedMax = -Infinity;
  };

  /* میانهٔ n مقدارِ نخستِ آرایه — بدون تخصیصِ حافظه.
     n=2 عمداً *کمینه* را برمی‌گرداند: در آغازِ استروک، خطای «پهن‌تر از
     واقع» به‌شکلِ یک سرِ کلفت دیده می‌شود ولی خطای «باریک‌تر از واقع» فقط
     یک نمونه نازکیِ نامحسوس است؛ پس با دو نمونه، محافظه‌کارانه‌تر است. */
  const _medScratch = [0, 0, 0, 0, 0];
  function medianOf(a, n) {
    if (n <= 1) return a[0];
    if (n === 2) return a[0] < a[1] ? a[0] : a[1];
    for (let i = 0; i < n; i++) _medScratch[i] = a[i];
    // مرتب‌سازیِ درجی روی حداکثر ۵ عضو — بدون تخصیصِ حافظه
    for (let i = 1; i < n; i++) {
      const v = _medScratch[i];
      let j = i - 1;
      while (j >= 0 && _medScratch[j] > v) { _medScratch[j + 1] = _medScratch[j]; j--; }
      _medScratch[j + 1] = v;
    }
    return (n & 1) ? _medScratch[(n - 1) >> 1]
                   : Math.min(_medScratch[n / 2 - 1], _medScratch[n / 2]);
  }

  /* value: فشارِ فیزیکیِ ورودی (خام یا جانشین) → mapped
     trusted: آیا این نمونه برای *مقدار‌دهیِ اولیه* قابلِ اعتماد است؟
              (مقدارِ پیش‌فرضِ استاندارد ۰٫۵ در حالتِ «پشتیبانی نامعلوم»
               نیست — [PE3] §4.1) */
  PressureCalibration.prototype.process = function (value, trusted) {
    const p = this.params;
    this.raw = value;
    let n = (clamp01(value) - p.minRawPressure) /
            Math.max(1e-6, p.maxRawPressure - p.minRawPressure);
    n = clamp01(n);
    if (this._primed && Math.abs(n - this._held) < p.deadzone) n = this._held;
    this._held = n;
    this.normalized = n;

    const primeN = Math.max(1, Math.min(5, p.primeSamples | 0 || 1));
    let f;

    if (this._primeN < primeN) {
      /* ---- پنجرهٔ آماده‌سازی --------------------------------------
         فیلتر با میانهٔ نمونه‌های نخست ست می‌شود، نه با نمونهٔ اول. هیچ
         محدودگرِ نرخی در این پنجره اعمال نمی‌شود تا اصلاح *فوری* باشد:
         محدودگرها برای سرکوبِ پرتِ میانِ استروک‌اند، نه برای کند‌کردنِ
         همگراییِ آغازِ استروک (که همان artifact بود).                */
      if (trusted === false && this.trustedSamples === 0) {
        // نمونهٔ بی‌اعتماد در آغازِ استروک: در پنجره حساب نمی‌شود.
        // اگر تا پایانِ استروک هیچ نمونهٔ معتبری نیاید، لایهٔ بالاتر از
        // unknownPressure استفاده می‌کند.
        f = this._primeN > 0 ? medianOf(this._prime, this._primeN) : n;
      } else {
        if (trusted !== false) this.trustedSamples++;
        this._prime[this._primeN++] = n;
        f = medianOf(this._prime, this._primeN);
      }
      this.priming = this._primeN < primeN;
    } else {
      this.priming = false;
      const a = clamp01(p.smoothing);
      f = this.filtered + (n - this.filtered) * a;

      /* ---- حذفِ «تک‌نمونه‌ی پرتِ» فشار، بدونِ افزودنِ تأخیر (PHASE B) ----
         یک میانه‌ی سه‌نمونه‌ای، یک نمونه تأخیر می‌آورد. به‌جایش نرخِ *کاهش*
         را محدود می‌کنیم و نرخِ افزایش را آزاد می‌گذاریم:
           • رهاکردنِ واقعیِ فشار چند نمونه طول می‌کشد ⇒ دست‌نخورده می‌رسد
           • یک فرودِ تک‌نمونه‌ای (مثل 0.78 → 0.42 → 0.77) کران می‌خورد و
             نمونه‌ی بعد فوراً جبران می‌کند
         این «کفِ فشار» نیست؛ فقط شیبِ نزول را محدود می‌کند. */
      const maxDrop = Math.max(0, p.outlierDrop === undefined ? 0.12 : p.outlierDrop);
      if (maxDrop > 0 && this.filtered - f > maxDrop) {
        this.clampedDrops++;
        f = this.filtered - maxDrop;
      }
      if (trusted !== false) this.trustedSamples++;
    }

    this.filtered = f;
    this._primed = true;
    this.mapped = Math.pow(this.filtered, Math.max(0.05, p.curveExponent));
    return this.mapped;
  };

  /* ===================================================================
     ۴b) normalizePressure — تابعِ مرکزیِ فشار (مرورگرمستقل)
     -------------------------------------------------------------------
     قوانینِ صریح:
        undefined / null / NaN / غیرِعدد  →  INVALID  (نه صفر!)
        v < 0                            →  clamp به 0
        v > 1                            →  clamp به 1
        v === 0                          →  **مقدارِ معتبر** است
     الگوی ممنوع:  if (!pressure) pressure = defaultPressure
     چون 0 را «نداشتن» تشخیص می‌دهد. این‌جا فقط Number.isFinite و
     بررسیِ صریحِ undefined به کار می‌رود.
     =================================================================== */
  const PRESSURE_INVALID = -1;

  function normalizeRawPressure(value) {
    if (value === undefined || value === null) return PRESSURE_INVALID;
    if (typeof value !== 'number' || !isFinite(value)) return PRESSURE_INVALID;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;   // شاملِ 0 که معتبر است
  }

  /* normalizePressure(event, calibration) → { raw, valid, calibrated }
     نقطه‌ی واحدِ ورودِ فشار برای همه‌ی مرورگرها. */
  function normalizePressure(event, calibration) {
    const raw = normalizeRawPressure(event ? event.pressure : undefined);
    const valid = raw !== PRESSURE_INVALID;
    return {
      raw: valid ? raw : 0,
      valid: valid,
      calibrated: valid && calibration ? calibration.process(raw) : 0,
    };
  }

  /* -------------------------------------------------------------------
     مقدارِ پیش‌فرضِ استانداردِ فشار
     -------------------------------------------------------------------
     [PE3] §4.1: «برای سخت‌افزار و پلتفرمی که فشار را پشتیبانی نمی‌کند،
     مقدار MUST در حالتِ فعالِ دکمه 0.5 و در غیرِ آن 0 باشد.»
     پس تا وقتی *ندیده‌ایم* که این دستگاه مقداری غیر از {0, 0.5} بدهد،
     عددِ دقیقِ 0.5 شاهدی بر فشارِ واقعی نیست و نباید فیلترِ فشار را
     مقدار‌دهیِ اولیه کند. به‌محضِ دیدنِ یک مقدارِ غیرِ پیش‌فرض، پشتیبانی
     SUPPORTED می‌شود و از آن پس 0.5 یک مقدارِ کاملاً معتبر است.
     ------------------------------------------------------------------- */
  const SPEC_DEFAULT_PRESSURE = 0.5;

  /* -------------------------------------------------------------------
     اعتبارسنجیِ فهرستِ coalesced نسبت به رویدادِ والد
     -------------------------------------------------------------------
     [PE3] §10.3 می‌گوید user agent باید برای هر رویدادِ داخلِ فهرستِ
     coalesced، «بقیه‌ی خصیصه‌ها را با مقادیرِ پیش‌فرضِ PointerEvent مقدار
     اولیه بدهد». اگر مرورگری این جمله را تحت‌اللفظی اجرا کند، فرزندان
     فشار/شیبِ صفر خواهند داشت در حالی که والد مقدارِ درست دارد.

     اندازه‌گیری‌شده: Chrome 150 فشار و tilt فرزندان را **حفظ می‌کند**
     (bench/probe.html: preservesPressure=true, preservesTilt=true).
     برای Firefox آزمون نشده است.

     پس به‌جای اعتماد یا تشخیصِ مرورگر، یک قاعده‌ی *یکپارچگیِ داده* داریم:
     اگر والد در حالتِ تماس فشارِ مثبت دارد ولی هیچ‌یک از فرزندان چنین
     نیستند، فهرستِ coalesced ناقص است و باید نادیده گرفته شود.
     ------------------------------------------------------------------- */
  function validateCoalesced(parent, list) {
    if (!list || !list.length) return { usable: false, reason: 'empty' };
    const pRaw = normalizeRawPressure(parent ? parent.pressure : undefined);
    const parentHasPressure = pRaw !== PRESSURE_INVALID && pRaw > 0;

    let childWithPressure = 0, childWithTilt = 0, childWithPos = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const cr = normalizeRawPressure(c ? c.pressure : undefined);
      if (cr !== PRESSURE_INVALID && cr > 0) childWithPressure++;
      if (c && ((c.tiltX | 0) !== 0 || (c.tiltY | 0) !== 0)) childWithTilt++;
      if (c && (typeof c.clientX === 'number')) childWithPos++;
    }
    if (childWithPos === 0) return { usable: false, reason: 'no-position' };
    if (parentHasPressure && childWithPressure === 0) {
      return { usable: false, reason: 'children-lost-pressure',
               parentPressure: pRaw };
    }
    const parentHasTilt = parent &&
      (((parent.tiltX | 0) !== 0) || ((parent.tiltY | 0) !== 0));
    return {
      usable: true,
      reason: 'ok',
      // اگر فقط شیب گم شده باشد، فهرست را نگه می‌داریم ولی شیبِ والد را
      // به فرزندان تزریق می‌کنیم (در لایه‌ی بالاتر).
      tiltFromParent: parentHasTilt && childWithTilt === 0,
      childWithPressure: childWithPressure,
      childWithTilt: childWithTilt,
    };
  }

  /* ===================================================================
     ۵) StylusState — تنها ساختاری که موتور می‌بیند
     =================================================================== */
  function StylusState() {
    // موقعیت و زمان
    this.x = 0; this.y = 0; this.t = 0;
    this.pointerId = -1;
    this.pointerType = '';
    this.buttons = 0;

    // فشار
    this.pressureRaw = 0;        // مقدارِ خامِ رویداد
    this.pressure = 0;           // پس از کالیبراسیون (۰..۱)
    this.pressureSupport = SUPPORT.UNKNOWN;
    this.pressureIsFallback = false;
    this.pressureValid = false;   // آیا رویداد فشارِ عددیِ معتبر داشت؟
    /* آیا این نمونه برای مقدار‌دهیِ اولیهٔ فیلتر/رسمِ نخستین مرکب
       قابلِ اعتماد است؟ 'real' | 'spec-default' | 'fallback' | 'invalid' */
    this.pressureTrust = 'invalid';
    this.pressureTrusted = false;
    // آیا فیلترِ فشار هنوز در پنجرهٔ آماده‌سازی است؟
    this.pressurePriming = true;

    // شیب
    this.tiltX = 0; this.tiltY = 0;
    this.tiltSupport = SUPPORT.UNKNOWN;

    // جهت‌گیریِ کره‌ای
    this.azimuth = 0;            // rad
    this.altitude = HALF_PI;     // rad  (π/2 = عمود)
    this.orientationSupport = SUPPORT.UNKNOWN;
    this.orientationState = ORIENTATION.UNKNOWN;

    // بردارِ قلم و مشتقاتش
    this.vx = 0; this.vy = 0; this.vz = 1;
    this.lean = 0;               // ۰ = عمود، ۱ = خوابیده
    this.leanDir = 0;            // rad

    // چرخشِ بدنهٔ قلم حولِ محورِ خودش
    this.twist = 0;              // deg
    this.twistSupport = SUPPORT.UNKNOWN;

    // فشارِ مماسی (چرخ ایربراش)
    this.tangentialPressure = 0;
    this.tangentialSupport = SUPPORT.UNKNOWN;

    // منشأِ رویداد
    this.source = '';            // 'pointerdown' | 'rawupdate' | 'pointermove' | 'coalesced'
    this.isFirst = false;
  }

  /* ===================================================================
     ۶) Normalizer — ماشینِ حالتِ اعتبار
     =================================================================== */
  const NORM_DEFAULTS = {
    // تا این مدت پس از آخرین جهت‌گیریِ معتبر، همان مقدار نگه داشته می‌شود.
    // این همان چیزی است که «پریدنِ زاویه به عمودی پس از اولین حرکت» را
    // از بین می‌برد، بدون اینکه دادهٔ کهنه را برای همیشه نگه داریم.
    orientationHoldMs: 350,
    // برای فشار هم همان منطق: 0 در حالتِ فعالِ دکمه، طبق [PE3] یعنی
    // «بی‌فشار»؛ ولی وسطِ یک استروکِ فعال احتمالِ دادهٔ گم‌شده هست.
    pressureHoldMs: 120,
    // پس از این تعداد نمونه‌ی «فقط 0.5»، فشار را UNSUPPORTED می‌گیریم
    pressureDetectSamples: 12,
  };

  function StylusNormalizer(opts) {
    this.opts = {};
    for (const k in NORM_DEFAULTS) this.opts[k] = NORM_DEFAULTS[k];
    if (opts) for (const k in opts) if (opts[k] !== undefined) this.opts[k] = opts[k];

    this.api = detectApi();
    this.calibration = new PressureCalibration();
    this.state = new StylusState();
    this._sph = { azimuth: 0, altitude: HALF_PI };
    this._vec = { vx: 0, vy: 0, vz: 1, lean: 0, leanDir: 0 };
    this.resetStroke();

    // شمارنده‌های تشخیصِ رفتارِ سخت‌افزار (بینِ استروک‌ها حفظ می‌شوند)
    this.obs = {
      pressureSamples: 0, pressureNonDefault: 0, pressureExactHalf: 0,
      pressureZeroWithButton: 0,
      tiltSamples: 0, tiltNonZero: 0,
      orientationSamples: 0, orientationValid: 0,
      twistNonZero: 0, tangentialNonZero: 0,
      coalescedSeen: 0, rawUpdateSeen: 0, moveSeen: 0,
    };
  }

  StylusNormalizer.prototype.resetStroke = function () {
    this._lastValidAzimuth = 0;
    this._lastValidAltitude = HALF_PI;
    this._lastValidOrientationT = -Infinity;
    this._hasValidOrientation = false;
    this._lastValidPressure = 0;
    this._lastValidPressureT = -Infinity;
    this._hasValidPressure = false;
    this._first = true;
    this.calibration.reset();
    return this;
  };

  /* -------------------------------------------------------------------
     اعتبارِ جهت‌گیریِ *یک رویداد*
     -------------------------------------------------------------------
     طبق [PE3]:
       • اگر سخت‌افزار زاویه نمی‌دهد: tilt=(0,0)، altitude=π/2، azimuth=0
       • اگر قلم واقعاً عمود است:      tilt=(0,0)، altitude=π/2، azimuth=0
     پس این دو حالت از هم قابلِ تفکیک نیستند. تصمیمِ ما:
       هر دو «جهت‌گیریِ نامعتبر/بی‌اطلاع» شمرده می‌شوند، چون در هر دو
       حالت چرخاندنِ لبهٔ نوک بر اساس این داده اشتباه است.
     ------------------------------------------------------------------- */
  StylusNormalizer.prototype._orientationValidity = function (ev, override) {
    const api = this.api;
    const hasSph = api.altitudeAngle && api.azimuthAngle;
    let tiltX = api.tiltX ? (ev.tiltX | 0) : 0;
    let tiltY = api.tiltY ? (ev.tiltY | 0) : 0;
    // اگر فهرستِ coalesced شیب را از دست داده باشد، شیبِ والد تزریق می‌شود
    if (override && tiltX === 0 && tiltY === 0) {
      tiltX = override.tiltX | 0; tiltY = override.tiltY | 0;
    }
    const tiltNonDefault = (tiltX !== 0 || tiltY !== 0);

    let altitude = HALF_PI, azimuth = 0, sphNonDefault = false;
    if (hasSph && typeof ev.altitudeAngle === 'number' &&
        isFinite(ev.altitudeAngle)) {
      altitude = ev.altitudeAngle;
      azimuth = (typeof ev.azimuthAngle === 'number' && isFinite(ev.azimuthAngle))
        ? ev.azimuthAngle : 0;
      sphNonDefault = Math.abs(altitude - HALF_PI) > 1e-6;
    }

    if (sphNonDefault) {
      return { valid: true, altitude: altitude, azimuth: azimuth,
               tiltX: tiltX, tiltY: tiltY, from: 'spherical' };
    }
    if (tiltNonDefault) {
      // از tilt به کره‌ای می‌رویم تا نمایشِ داخلی همیشه یکی باشد
      tiltToSpherical(tiltX, tiltY, this._sph);
      return { valid: true, altitude: this._sph.altitude,
               azimuth: this._sph.azimuth, tiltX: tiltX, tiltY: tiltY,
               from: 'tilt' };
    }
    return { valid: false, altitude: HALF_PI, azimuth: 0,
             tiltX: 0, tiltY: 0, from: 'none' };
  };

  /* -------------------------------------------------------------------
     تشخیصِ رفتارِ فشارِ سخت‌افزار — استنتاج از خودِ استاندارد
     -------------------------------------------------------------------
     [PE3]: «برای سخت‌افزار و پلتفرمی که فشار را پشتیبانی نمی‌کند،
     مقدار باید در حالتِ فعالِ دکمه 0.5 و در غیرِ آن 0 باشد.»
     پس مشاهدهٔ *هر* مقدارِ فشارِ غیرِ {0, 0.5} در حالتِ فعالِ دکمه،
     اثباتِ وجودِ حسگرِ فشار است — مستقل از این‌که pointerType چه باشد.
     این نکته مهم است چون در بعضی درایورها/پلتفرم‌ها قلمِ تبلت به‌عنوان
     pointerType="mouse" گزارش می‌شود؛ اگر فقط به pointerType تکیه کنیم،
     فشارِ واقعی را دور می‌ریزیم.
     ------------------------------------------------------------------- */
  StylusNormalizer.prototype._observePressure = function (raw, buttonsActive) {
    const o = this.obs;
    if (!this.api.pressure || typeof raw !== 'number') return;
    if (!buttonsActive) return;
    o.pressureSamples++;
    if (raw === 0.5) o.pressureExactHalf++;
    else if (raw === 0) o.pressureZeroWithButton++;
    else {
      o.pressureNonDefault++;
      const c = this.calibration;
      if (raw < c.observedMin) c.observedMin = raw;
      if (raw > c.observedMax) c.observedMax = raw;
    }
  };

  StylusNormalizer.prototype.pressureSupport = function () {
    const o = this.obs;
    if (!this.api.pressure) return SUPPORT.UNSUPPORTED;
    if (o.pressureNonDefault > 0) return SUPPORT.SUPPORTED;
    if (o.pressureSamples >= this.opts.pressureDetectSamples &&
        o.pressureExactHalf === o.pressureSamples) return SUPPORT.UNSUPPORTED;
    return SUPPORT.UNKNOWN;
  };
  StylusNormalizer.prototype.tiltSupport = function () {
    const o = this.obs;
    if (!this.api.tiltX && !this.api.altitudeAngle) return SUPPORT.UNSUPPORTED;
    if (o.tiltNonZero > 0) return SUPPORT.SUPPORTED;
    if (o.tiltSamples >= this.opts.pressureDetectSamples) return SUPPORT.UNSUPPORTED;
    return SUPPORT.UNKNOWN;
  };
  StylusNormalizer.prototype.orientationSupport = function () {
    const o = this.obs;
    if (!this.api.altitudeAngle && !this.api.tiltX) return SUPPORT.UNSUPPORTED;
    if (o.orientationValid > 0) return SUPPORT.SUPPORTED;
    if (o.orientationSamples >= this.opts.pressureDetectSamples) return SUPPORT.UNSUPPORTED;
    return SUPPORT.UNKNOWN;
  };
  StylusNormalizer.prototype.twistSupport = function () {
    if (!this.api.twist) return SUPPORT.UNSUPPORTED;
    if (this.obs.twistNonZero > 0) return SUPPORT.SUPPORTED;
    return SUPPORT.UNKNOWN;
  };
  StylusNormalizer.prototype.tangentialSupport = function () {
    if (!this.api.tangentialPressure) return SUPPORT.UNSUPPORTED;
    if (this.obs.tangentialNonZero > 0) return SUPPORT.SUPPORTED;
    return SUPPORT.UNKNOWN;
  };

  /* -------------------------------------------------------------------
     normalize(ev, ctx) → StylusState
     -------------------------------------------------------------------
     ctx = { originX, originY, source, fallbackPressure }
     fallbackPressure: تخمینِ سرعت‌محور، فقط وقتی فشار پشتیبانی نمی‌شود
     ------------------------------------------------------------------- */
  StylusNormalizer.prototype.normalize = function (ev, ctx) {
    const s = this.state;
    const api = this.api;
    const o = this.obs;

    s.x = ev.clientX - ctx.originX;
    s.y = ev.clientY - ctx.originY;
    s.t = (typeof ev.timeStamp === 'number' && ev.timeStamp > 0)
      ? ev.timeStamp : (global.performance ? performance.now() : Date.now());
    s.pointerId = ev.pointerId;
    s.pointerType = ev.pointerType || '';
    s.buttons = ev.buttons | 0;
    s.source = ctx.source || '';
    s.isFirst = this._first;

    const buttonsActive = (s.buttons & 1) !== 0 || ctx.assumeContact === true;

    /* ---- فشار ---------------------------------------------------- */
    // تنها مسیرِ ورودِ فشار: تابعِ مرکزی، با تفکیکِ «۰ معتبر» از «نامعتبر»
    const rawNorm = api.pressure
      ? normalizeRawPressure(ctx.pressureOverride !== undefined
          ? ctx.pressureOverride : ev.pressure)
      : PRESSURE_INVALID;
    const rawValid = rawNorm !== PRESSURE_INVALID;
    const rawP = rawValid ? rawNorm : 0;
    s.pressureValid = rawValid;
    s.pressureRaw = rawP;
    this._observePressure(rawP, buttonsActive);
    const psup = this.pressureSupport();
    s.pressureSupport = psup;

    let physical;
    let trusted = true;
    if (psup === SUPPORT.UNSUPPORTED) {
      // هیچ حسگرِ فشاری نیست ⇒ حالتِ صریحِ جانشین (بدونِ ادعای فشارِ واقعی)
      s.pressureIsFallback = true;
      s.pressureTrust = 'fallback';
      const cp = this.calibration.params;
      physical = cp.fallbackMode === 'constant'
        ? cp.fallbackConstant
        : (typeof ctx.fallbackPressure === 'number' ? ctx.fallbackPressure
                                                    : cp.fallbackConstant);
    } else if (!rawValid) {
      s.pressureIsFallback = false;
      s.pressureTrust = 'invalid';
      trusted = false;
      physical = this._hasValidPressure ? this._lastValidPressure : 0;
    } else {
      s.pressureIsFallback = false;
      /* ---- «۰٫۵ در حالتِ پشتیبانیِ نامعلوم» = فشارِ نامعلوم ----------
         این تنها جایی است که مقدارِ خام رد می‌شود، و دقیقاً بر پایهٔ متنِ
         [PE3] §4.1 است — نه بر پایهٔ تشخیصِ مرورگر. اثرش: چنین نمونه‌ای
         فیلتر را مقدار‌دهیِ اولیه نمی‌کند و لایهٔ بالاتر آن را «قابلِ
         رسم» نمی‌شمارد؛ پس هیچ مهرِ تمام‌پهنایی پیش از رسیدنِ دادهٔ واقعی
         نمی‌نشیند.                                                    */
      if (psup === SUPPORT.UNKNOWN && rawP === SPEC_DEFAULT_PRESSURE) {
        s.pressureTrust = 'spec-default';
        trusted = false;
      } else {
        s.pressureTrust = 'real';
      }
      // «۰ در حالتِ فعالِ دکمه» می‌تواند لیفتِ واقعی باشد یا دادهٔ گم‌شده.
      // در میانهٔ یک استروکِ فعال، برای مدتِ کوتاهی آخرین مقدارِ معتبر را
      // نگه می‌داریم تا خط ناگهان قطع/نازک نشود؛ pointerup خودش پایانِ
      // استروک را مدیریت می‌کند.
      if (rawP > 0) {
        physical = rawP;
        if (trusted) {
          this._lastValidPressure = rawP;
          this._lastValidPressureT = s.t;
          this._hasValidPressure = true;
        }
      } else if (this._hasValidPressure && buttonsActive &&
                 (s.t - this._lastValidPressureT) <= this.opts.pressureHoldMs) {
        physical = this._lastValidPressure;
      } else {
        physical = 0;
      }
    }
    s.pressureTrusted = trusted;
    s.pressure = this.calibration.process(physical, trusted);
    s.pressurePriming = this.calibration.priming;

    /* ---- شیب و جهت‌گیری ------------------------------------------ */
    const v = this._orientationValidity(ev, ctx.tiltOverride);
    o.orientationSamples++;
    o.tiltSamples++;
    if (v.tiltX !== 0 || v.tiltY !== 0) o.tiltNonZero++;

    if (v.valid) {
      o.orientationValid++;
      this._lastValidAzimuth = v.azimuth;
      this._lastValidAltitude = v.altitude;
      this._lastValidOrientationT = s.t;
      this._hasValidOrientation = true;
      s.azimuth = v.azimuth;
      s.altitude = v.altitude;
      s.tiltX = v.tiltX;
      s.tiltY = v.tiltY;
      s.orientationState = ORIENTATION.VALID;
    } else if (this._hasValidOrientation &&
               (s.t - this._lastValidOrientationT) <= this.opts.orientationHoldMs) {
      // ★ هستهٔ رفعِ اشکالِ «زاویه پس از اولین حرکت به عمودی می‌پرد»:
      //   هرگز مقدارِ نامعتبر را روی مقدارِ معتبر نمی‌نویسیم.
      s.azimuth = this._lastValidAzimuth;
      s.altitude = this._lastValidAltitude;
      sphericalToTilt(s.altitude, s.azimuth, s);
      s.orientationState = ORIENTATION.HELD;
    } else {
      // دادهٔ جهت‌گیری نداریم (یا کهنه شده) ⇒ صریحاً «عمود/بی‌اطلاع»
      s.azimuth = 0;
      s.altitude = HALF_PI;
      s.tiltX = 0; s.tiltY = 0;
      s.orientationState = this._hasValidOrientation
        ? ORIENTATION.EXPIRED : ORIENTATION.UNKNOWN;
    }
    s.orientationSupport = this.orientationSupport();
    s.tiltSupport = this.tiltSupport();

    penVector(s.altitude, s.azimuth, this._vec);
    s.vx = this._vec.vx; s.vy = this._vec.vy; s.vz = this._vec.vz;
    s.lean = this._vec.lean; s.leanDir = this._vec.leanDir;

    /* ---- چرخشِ بدنه و فشارِ مماسی ------------------------------- */
    const tw = (api.twist && typeof ev.twist === 'number') ? ev.twist : 0;
    if (tw !== 0) o.twistNonZero++;
    s.twist = tw;
    s.twistSupport = this.twistSupport();

    const tp = (api.tangentialPressure && typeof ev.tangentialPressure === 'number')
      ? ev.tangentialPressure : 0;
    if (tp !== 0) o.tangentialNonZero++;
    s.tangentialPressure = tp;
    s.tangentialSupport = this.tangentialSupport();

    this._first = false;
    return s;
  };

  /* ===================================================================
     ۷) گزارشِ قابلیت — برای UI کالیبراسیون (بخش ۳۳/۳۵ درخواست)
     -------------------------------------------------------------------
     UI هرگز نباید کاملاً پنهان شود؛ فقط باید بگوید چه چیزی پشتیبانی
     می‌شود و چه چیزی نه.
     =================================================================== */
  StylusNormalizer.prototype.capabilityReport = function () {
    return {
      api: this.api,
      pressure: this.pressureSupport(),
      tilt: this.tiltSupport(),
      orientation: this.orientationSupport(),
      twist: this.twistSupport(),
      tangential: this.tangentialSupport(),
      observed: this.obs,
      pointerType: this.state.pointerType,
      orientationState: this.state.orientationState,
      calibration: this.calibration.params,
      observedPressureRange: {
        min: isFinite(this.calibration.observedMin) ? this.calibration.observedMin : null,
        max: isFinite(this.calibration.observedMax) ? this.calibration.observedMax : null,
      },
    };
  };

  global.QalamStylus = {
    SUPPORT, ORIENTATION,
    PRESSURE_INVALID, SPEC_DEFAULT_PRESSURE,
    normalizeRawPressure, normalizePressure, validateCoalesced,
    StylusState, StylusNormalizer, PressureCalibration,
    detectApi, tiltToSpherical, sphericalToTilt, penVector,
    CAL_DEFAULTS, NORM_DEFAULTS,
    HALF_PI, RAD2DEG, DEG2RAD, clamp, clamp01,
    VERSION: '1.1.0',
  };
})(typeof window !== 'undefined' ? window : globalThis);
