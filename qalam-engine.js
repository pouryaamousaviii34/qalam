/* =====================================================================
   qalam-engine.js — موتور شبیه‌سازی قلم نی (Reed Pen / Qalam)
   ---------------------------------------------------------------------
   این فایل کاملاً مستقل از DOM است تا بتوان آن را تست و بنچمارک کرد.
   وظایف:

     Stylus Input → [PressurePipeline] → [Resampler] → [NibContactModel]
                  → [InkModel] → Footprint Polygon → (رندرر بیرونی)

   اصل حاکم بر طراحی:
     فشار ⟶ تغییرشکل/تماسِ نوک ⟶ سطحِ تماس ⟶ هندسه‌ی خط ⟶ نشستِ مرکب
   نه:
     فشار ⟶ شفافیت

   مراجع (خلاصه؛ شرح کامل در گزارش):
     [PE3]  W3C Pointer Events Level 3 — معناشناسی pressure/tilt/twist/
            azimuth/altitude و رویدادهای coalesced و pointerrawupdate.
     [MF]   D. E. Knuth, "METAFONT: The Program" — مدلِ «قلمِ چندضلعیِ محدب»
            که خط، پوشِ (envelope) حرکتِ چندضلعیِ نوک روی مسیر است؛ یعنی
            حاصلِ جمعِ مینکوفسکیِ چندضلعیِ نوک با مسیر.
     [HOB]  J. D. Hobby, "Rasterizing Curves of Constant Width" (JACM 1989)
            — پیمایشِ چندضلعیِ محدب روی مسیر و مسائلِ گسسته‌سازی.
     [STR]  S. Strassmann, "Hairy Brushes" (SIGGRAPH '86) — قلم به‌صورت
            دسته‌ای از مو با وضعیتِ داخلی (مرکبِ محدود، سایش).
     [MOXI] N. S.-H. Chu, C.-L. Tai, "MoXi: Real-Time Ink Dispersion in
            Absorbent Paper" (SIGGRAPH 2005) — پخش/تجمعِ مرکب در کاغذ.
     [BAX]  W. Baxter et al., "DAB: Interactive Haptic Painting with 3D
            Virtual Brushes" (SIGGRAPH 2001) — تغییرشکلِ نوک تابعِ فشار.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ===================================================================
     ۱) پارامترهای قابل تنظیم (PHASE 16)
     ===================================================================
     همه‌ی مقادیر پیش‌فرض بر پایه‌ی این منطق انتخاب شده‌اند:
       • واحدِ طول = پیکسل CSS
       • واحدِ زمان = میلی‌ثانیه
       • «سرعت عادیِ نوشتنِ خوشنویسی» ≈ 120–200 px/s ⇒ ≈ 0.12–0.2 px/ms
     =================================================================== */
  const DEFAULTS = {
    /* ---- هندسه‌ی نوک ---------------------------------------------- */
    // پهنای کاملِ لبه‌ی بُرشِ نوک (چلبی). واحد: پیکسل.
    nibWidth: 8,
    // ضخامتِ خودِ تیغه (لبه‌ی بُرش). قلمِ نی لبه‌ی تیز دارد ⇒ کوچک.
    nibThickness: 1.0,
    // زاویه‌ی لبه‌ی نوک نسبت به محور X، درجه.
    nibAngle: 109,
    // گِردیِ گوشه‌های سطحِ تماس (0 = مستطیلِ تیز، 1 = کپسول).
    nibCornerRound: 0.35,

    /* ---- خطِ لولهٔ فشار (PHASE 17) --------------------------------- */
    // بازه‌ی مفیدِ فشارِ سخت‌افزار؛ زیر pressureMin عملاً تماسی نیست.
    pressureMin: 0.02,
    pressureMax: 1.0,
    // ناحیه‌ی مرده: نوسانِ کمتر از این مقدار نادیده گرفته می‌شود.
    pressureDeadzone: 0.012,
    // ضریبِ EMA برای هموارسازیِ فشار (۱ = بدون هموارسازی).
    // 0.35 ≈ ثابتِ زمانیِ ~2 نمونه؛ تأخیرِ محسوس ایجاد نمی‌کند.
    pressureSmoothing: 0.35,
    // نمای منحنیِ فشار: >1 ⇒ کنترلِ ظریف‌تر در فشارِ کم.
    pressureExponent: 0.85,

    /* ---- نگاشتِ فشار به سطحِ تماس (PHASE 6) ------------------------ */
    // کمینه‌ی نسبتِ سطحِ تماس در فشارِ ~0 (نوکِ مویی، نه صفرِ نامرئی).
    minContactRatio: 0.09,
    maxContactRatio: 1.0,
    // ضخامتِ تیغه هم با فشار کمی پهن می‌شود (splay) — [BAX]
    thicknessGain: 0.55,

    /* ---- عدم‌تقارنِ سطحِ تماس (PHASE 7) ---------------------------- */
    // 0 = تماس متقارن از مرکز کم می‌شود
    // 1 = تماس فقط از سمتِ «پاشنه» عقب می‌نشیند و «پنجه» ثابت می‌ماند
    heelLift: 0.7,
    // اگر tilt در دسترس نباشد، جهتِ پاشنه از جهتِ حرکت گرفته می‌شود.
    heelFromDirection: true,

    /* ---- نمونه‌برداری (PHASE 3 / PHASE 14) ------------------------- */
    // spacing = clamp(contactSpan * spacingFactor, minSpacing, maxSpacing)
    spacingFactor: 0.30,
    minSpacing: 0.70,
    maxSpacing: 3.0,
    // سقفِ نمونه در هر رویدادِ ورودی و در هر فریم — کرانِ سختِ کار
    maxSamplesPerEvent: 24,
    maxSamplesPerFrame: 320,
    // هموارسازیِ موقعیت (EMA) — 0 = خام
    positionSmoothing: 0.5,
    // درجه‌ی درون‌یابیِ مسیر: 'catmullrom' یا 'linear'
    interpolation: 'catmullrom',

    /* ---- سرعت (PHASE 9) ------------------------------------------- */
    velocitySmoothing: 0.35,
    /* سرعتِ مرجعِ «نوشتنِ عادی» (px/ms).
       اندازه‌گیریِ خطِ آزمون: 550px در 1000ms ⇒ 0.55px/ms. خوشنویسیِ
       واقعی ≈ 100–500px/s ⇒ 0.1–0.5px/ms. مقدارِ قبلی (0.18) باعث می‌شد
       نوشتنِ عادی «تندِ زیاد» شمرده شود و همیشه جریمهٔ پهنا بگیرد؛ در
       نتیجه *نمونهٔ اول* (که سرعتش صفر است) جریمه نمی‌گرفت و از بقیهٔ خط
       پهن‌تر می‌شد. این ریشهٔ «مهرِ تمام‌پهنا در آغاز استروک» بود. */
    velocityRef: 0.42,
    // اثر سرعت بر مرکب: 0 = بی‌اثر، 1 = پرشور
    velocityInkInfluence: 0.35,
    // اثر سرعت بر پهنای تماس (قلمِ نی در حرکتِ تند کمی سبک‌تر می‌شود)
    velocityWidthInfluence: 0.18,
    velocityMax: 3.0,

    /* ---- مرکب (PHASE 10) ------------------------------------------ */
    inkFlow: 1.0,
    inkSaturation: 1.0,
    // کفِ چگالیِ مرکب: تضمین می‌کند فشارِ کم ⇒ خطِ *باریکِ تیره*،
    // نه خطِ محو. این پارامتر همان چیزی است که «فشار = شفافیت» را می‌شکند.
    inkDensityFloor: 0.86,
    // سهمِ فشار در چگالی (کم) — پیش‌فرض قبلیِ پروژه ~0.75 بود.
    inkPressureDensity: 0.14,
    // تجمعِ مرکب هنگام توقف (pooling)
    dwellPooling: 0.45,
    dwellRefMs: 140,
    // مرکبِ اضافیِ لحظه‌ی نشستنِ نوک (PHASE 11)
    startInkBoost: 0.35,
    startInkLength: 7,
    // مرکبِ آغاز فقط اگر قلم لحظه‌ای درنگ کند آزاد می‌شود
    startInkDwellMs: 90,
    // «درنگِ معادل» که یک چرخشِ ۱۸۰ درجه‌ای تولید می‌کند (تجمع در گوشه)
    curvaturePoolMs: 55,
    // دمِ انتهای حرکت
    tailLength: 40,
    tailMinRatio: 0.18,
    // نامتقارنیِ کشیدن/راندن قلم — تقریبی [approximation]
    pushPullInfluence: 0.12,

    /* ---- پروفایلِ چگالیِ مرکب (Ink Density Profile) ----------------
       مرکب روی کاغذ «هندسهٔ سیاهِ توپر» نیست. مقطعِ عرضیِ یک خطِ مرکب:

            کاغذ │ لبهٔ نیمه‌خیس │  هستهٔ سیر  │ لبهٔ نیمه‌خیس │ کاغذ
                 └──── fringe ──┴─── core ───┴── fringe ────┘

       این با دو گذرِ رسم ساخته می‌شود، بدونِ هیچ نویزِ تصادفی:
         ۱) گذرِ حاشیه: همان چندضلعی، با خطِ پهن‌ترِ کم‌شفاف (جمعِ
            مینکوفسکی با یک دیسک ⇒ حاشیهٔ مویینِ واقعی)
         ۲) گذرِ هسته: همان چندضلعی، پرشده با شفافیتِ بالا
       هزینه: ۲ فراخوانیِ رسم در هر پاره‌خط (پیش از این ۱، و در نسخهٔ
       اصلیِ پروژه ۵). */
    // شفافیتِ هستهٔ خط (۱ = کاملاً مات ⇒ گذرهای مکرر تیره‌تر نمی‌شوند)
    inkCoreAlpha: 0.985,
    // شفافیتِ حاشیهٔ نیمه‌خیس نسبت به هسته
    inkFringeAlpha: 0.42,
    // پهنای حاشیه بر حسبِ نسبت از ضخامتِ تماس + مقدارِ ثابتِ px
    inkFringeRatio: 0.55,
    inkFringeBase: 0.55,
    // بیشینهٔ پهنای حاشیه (px) — کرانِ سختِ هزینه و ظاهر
    inkFringeMax: 3.2,
    // اثرِ جذبِ کاغذ بر پهنای حاشیه
    inkFringeAbsorption: 1.1,

    /* ---- لایهٔ خیس + پروفایلِ چندنواره (FINAL INK PASS) -------------
       ریشهٔ «خطِ تخت و برداری» (اندازه‌گیری‌شده در
       bench/diag-first-ink.html، Chrome 150 و Firefox 154):

         هر پاره‌خط با source-over و آلفای هسته ≈۰٫۸۸ روی بومِ مرکب
         رسم می‌شد. گامِ نمونه‌برداری ۰٫۷px و طولِ سطحِ تماس چند پیکسل
         است، پس هر پیکسل با ~۱۱ چندضلعیِ متوالی پوشیده می‌شد:
             1 − (1 − 0.88)^11 ≈ 1
         یعنی داخلِ خط همیشه اشباع می‌شد. سنجه: آلفای هستهٔ خط در طولِ
         مسیر [249…253] ⇒ دامنهٔ ۵ از ۲۵۵ (۲٪)، در حالی که inkAmt مدل
         بین ۰٫۶۰ و ۰٫۸۴ (۴۱٪ اختلاف) نوسان داشت. تجمعِ درنگ ۲۵۵ در
         برابر ۲۵۲، و گذرِ دوم روی همان مسیر ۲۵۵ در برابر ۲۵۲: یعنی
         مدلِ مرکب کاملاً در رستر گم می‌شد.

       رفع: استروکِ جاری روی یک لایهٔ «خیس» جدا رسم می‌شود که در آن
       هسته با آلفای ۱ پر می‌شود (پس idempotent است و انباشت ندارد) و
       چگالی در *رنگ* کدگذاری می‌شود؛ سپس لایهٔ خیس یک بار با
       'multiply' روی مرکبِ خشک ترکیب می‌شود. نتیجه:
         • تغییراتِ چگالی/نشست/تجمع در طولِ خط دیده می‌شوند
         • گذرِ دوم روی حرفِ قبلی به‌طورِ طبیعی تیره‌تر می‌شود (multiply)
         • هیچ نویزِ تصادفی، هیچ بازترسیمِ کاملِ بوم و هیچ خواندنِ پیکسل
           در مسیرِ داغ اضافه نمی‌شود (هزینه: یک drawImage در هر استروک) */
    inkWetLayer: true,
    /* تعدادِ نوارهای نیمه‌خیسِ بیرونِ هسته (۰ = بدونِ حاشیه).
       اندازه‌گیری‌شده (bench/diag-cost.html): تعدادِ fill دقیقاً
       segments×(1+bands) است، یعنی هر نوار یک fillِ کاملِ چندضلعی در
       مسیرِ داغ اضافه می‌کند؛ ولی نمایهٔ لبه با ۱، ۲ و ۳ نوار عملاً یکی
       است، چون پهنای کلِ حاشیه (~۱٫۴px) از تعدادِ نوارها کوچک‌تر است:
           bands=1 → [[114,43],[206,33],[247,31] …]
           bands=2 → [[101,51],[217,34],[247,31] …]
           bands=3 → [[ 90,55],[226,35],[247,31] …]
       پس ۱ نوار انتخاب شده: همان هزینهٔ دو-fillِ پیش از این فاز، با همان
       لبهٔ نیمه‌خیس. اگر کسی حاشیهٔ پهن‌تری خواست (کاغذِ جاذب)، افزایشِ
       inkFringeMax معنا دارد، نه افزایشِ تعدادِ نوار. */
    inkFringeBands: 1,
    // آلفای ترکیبِ لایهٔ خیس روی مرکبِ خشک؛ <۱ ⇒ بافتِ کاغذ کمی دیده شود
    inkPaperShowThrough: 0.97,
    /* نگاشتِ «نشستِ مرکب» به «رنگِ مرکب»: نشستِ کم ⇒ رنگ کمی به‌سوی
       کاغذ رقیق می‌شود. این «فشار = شفافیت» نیست: فشار سطحِ تماس را
       عوض می‌کند و این‌جا فقط سرعت/درنگ/جریان اثر دارند.
       بازه عمداً از «کم‌ترین نشستِ حرکتِ تند» تا «نشستِ تجمعِ درنگ» کشیده
       شده است. اگر بالای بازه را روی نشستِ *نوشتنِ عادی* بگذاریم، تجمعِ
       درنگ (که نشست را تا ۱٫۴۵ برابر می‌برد) در بالای بازه اشباع می‌شود و
       دیده نمی‌شود — اندازه‌گیری‌شده: تیرگیِ نقطهٔ توقف ۳۰٫۵ در برابر
       ۲۹٫۵ همسایه، یعنی عملاً صفر. */
    inkToneDepMin: 0.35,
    inkToneDepMax: 1.30,
    /* دو سرِ نگاشتِ تُن:
         نشستِ کم  ⇒ مرکب به‌سوی رنگِ کاغذ رقیق می‌شود (inkDilutePale)
         نشستِ زیاد ⇒ مرکب *غلیظ‌تر* از رنگِ پایه می‌شود (inkConcentrate)
       نقطهٔ خنثی (جایی که رنگ دقیقاً رنگِ انتخابیِ کاربر است) خودش از
       نسبتِ این دو درمی‌آید:  t0 = pale / (pale + concentrate).
       با مقادیرِ پیش‌فرض t0 ≈ 0.58 که همان نشستِ «نوشتنِ عادی» است. اگر
       فقط رقیق‌شدگی داشتیم، نوشتنِ عادی همیشه روشن‌تر از رنگِ انتخابی
       دیده می‌شد (اندازه‌گیری‌شده: روشناییِ ۵۶ در برابر ۳۱ رنگِ پایه). */
    inkDilutePale: 0.30,
    inkConcentrate: 0.22,
    inkDiluteDark: 0.00,   // نگه‌داشته‌شده برای سازگاری (استفاده نمی‌شود)
    inkEdgeDilute: 0.16,   // رقیق‌شدگیِ افزودهٔ نوارهای لبه
    /* تیره‌شدنِ کران‌دارِ «گذرِ دوباره روی حرفِ نوشته‌شده».
       اندازه‌گیری‌شده (bench/probe-composite.html): multiply خالص روی مرکبِ
       rgb(40,30,20) در گذرِ دوم به rgb(9,6,3) می‌رسد — تقریباً سیاهِ
       دیجیتالی. پس multiply فقط روی *ماسکِ هم‌پوشانی* و با این آلفا
       اعمال می‌شود تا افزایشِ مرکب طبیعی و اشباع‌شونده بمانَد. ۰ = خاموش */
    inkRepeatGain: 0.35,
    /* تعدادِ نمونه‌ای که فیلترِ فشار برای آماده‌شدن می‌گیرد. در این پنجره
       محدودگرهای نرخ خاموش‌اند (توضیحِ کامل در stylus.js). */
    primingSamples: 3,

    /* ---- زاویه/جهت (PHASE 12) ------------------------------------- */
    // 'fixed' | 'motion' | 'dynamic'
    angleMode: 'fixed',
    // اثرِ tilt بر زاویه‌ی نوک
    tiltInfluence: 0.55,
    // اثر tilt بر سطحِ تماس (قلمِ خوابیده ⇒ سطحِ بیشتر)
    tiltContactInfluence: 0.25,
    // اثرِ خوابیدنِ قلم بر ضخامتِ سطحِ تماس (پهنِ‌شدنِ ردِ تیغه)
    tiltThicknessInfluence: 0.45,
    // کرانِ نرخِ تغییرِ lean در هر نمونه — ضدِ جهشِ هندسه هنگام نوسانِ tilt
    leanRateLimit: 0.08,
    /* ---- یکپارچگیِ خط (PHASE B) ----------------------------------
       کرانِ پرشِ سرعت بر حسبِ ضریبی از velocityRef در هر نمونه */
    velocitySpikeLimit: 1.5,
    /* حذفِ «تک‌نمونه‌ی پرت» فشار: اگر یک نمونه از هر دو همسایه‌اش بیش از
       این مقدار پایین‌تر باشد و همسایه‌ها به هم نزدیک باشند، نویز است.
       ۰ = خاموش. تغییرِ *واقعیِ* فشار (که چند نمونه ادامه دارد) دست‌نخورده
       می‌مانَد، چون این فیلتر فقط پرتِ یک‌نمونه‌ای را می‌گیرد. */
    pressureOutlierDrop: 0.12,
    /* بیشینه‌ی افتِ ناخواسته‌ی پهنای تماس در هر پیکسلِ پیمایش (نسبی).
       این «کفِ پهنا» نیست: فقط آهنگِ تغییر را محدود می‌کند و وقتی فشار
       واقعاً کم شده، پهنا آزادانه (ولی پیوسته) کم می‌شود. */
    maxWidthDropPerPx: 0.14,

    /* ---- مقیاس فیزیکی --------------------------------------------- */
    // برای اینکه بتوان پهنای نوک را در میلی‌متر تعیین کرد.
    // 96 CSS px = 1 inch = 25.4 mm  ⇒  1mm ≈ 3.7795 px
    pxPerMm: 96 / 25.4,

    /* ---- Push / Pull (PHASE 3 درخواست) ---------------------------- */
    // کشیدن (pull) قلم نی روان است؛ راندن (push) نوک را در کاغذ فرو
    // می‌برد، جریان را کم و لبه را زبر می‌کند. [APPROXIMATION]
    pushFlowPenalty: 0.18,
    pushEdgeRoughness: 0.35,
    // زاویه‌ای که «راندن» شمرده می‌شود، بر حسب انحراف از عمودِ لبه
    pushThreshold: 0.35,

    /* ---- مخزنِ مرکب (PHASE 14 درخواست) ---------------------------- */
    // ظرفیتِ مخزن بر حسبِ «واحدِ مرکب»؛ 0 یعنی مدلِ مخزن خاموش است
    reservoirCapacity: 0,
    reservoirRefill: 0,
    // نفوذِ کاغذ: هرچه بیشتر، مرکبِ نشسته بیشتر پهن می‌شود
    paperAbsorption: 0.35,
  };

  function createConfig(overrides) {
    const cfg = {};
    for (const k in DEFAULTS) cfg[k] = DEFAULTS[k];
    if (overrides) for (const k in overrides) {
      if (overrides[k] !== undefined && overrides[k] !== null) cfg[k] = overrides[k];
    }
    return cfg;
  }

  /* ===================================================================
     ۲) ریاضیاتِ کمکی — بدون تخصیصِ حافظه
     =================================================================== */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const DEG = Math.PI / 180;

  // اختلافِ زاویه‌ی دو جهت در بازه‌ی [-π, π]
  function angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  /* ===================================================================
     ۳) خطِ لولهٔ فشار (PHASE 17)
     -------------------------------------------------------------------
        Raw → Clamp → Normalize → Deadzone → Smooth (EMA) → Curve
     -------------------------------------------------------------------
     نکته‌ی مطابقتِ استاندارد [PE3]:
       • pressure در بازه‌ی [0,1] است.
       • برای سخت‌افزارِ بدونِ حسِ فشار، مقدار MUST برابر 0.5 در حالتِ
         فعالِ دکمه و 0 در غیرِ آن باشد. پس عددِ 0.5 «فشارِ واقعی» نیست
         و باید به‌عنوان «فشار نامعلوم» تفسیر شود.
     =================================================================== */
  function PressurePipeline(cfg) {
    this.cfg = cfg;
    this.reset();
  }
  PressurePipeline.prototype.reset = function () {
    this.raw = 0;
    this.normalized = 0;
    this.filtered = 0;
    this.mapped = 0;
    this._held = 0;
    this._primed = false;
    return this;
  };
  // raw: مقدارِ خامِ رویداد | supported: آیا سخت‌افزار واقعاً فشار می‌دهد
  PressurePipeline.prototype.push = function (raw, supported, fallback) {
    const c = this.cfg;
    this.raw = raw;

    let v;
    if (supported) {
      v = clamp01(raw);
    } else {
      // ماوس/دستگاهِ بی‌فشار: مقدارِ جانشین (مثلاً از سرعت) استفاده می‌شود
      v = clamp01(fallback === undefined ? 0.5 : fallback);
    }

    // Normalize روی بازه‌ی مفیدِ سخت‌افزار
    let n = (v - c.pressureMin) / Math.max(1e-6, c.pressureMax - c.pressureMin);
    n = clamp01(n);

    // Deadzone: نوساناتِ ریزِ حسگر را حذف می‌کند بدون افزودنِ تأخیر
    if (this._primed && Math.abs(n - this._held) < c.pressureDeadzone) n = this._held;
    this._held = n;
    this.normalized = n;

    // Smoothing (EMA)
    const a = clamp01(c.pressureSmoothing);
    this.filtered = this._primed ? this.filtered + (n - this.filtered) * a : n;
    this._primed = true;

    // Pressure Curve
    this.mapped = Math.pow(this.filtered, Math.max(0.05, c.pressureExponent));
    return this.mapped;
  };

  /* ===================================================================
     ۴) مدلِ سطحِ تماسِ نوک (PHASE 6 / PHASE 7)
     -------------------------------------------------------------------
     نوکِ قلمِ نی یک لبه‌ی بُرشِ تخت است؛ سطحِ تماسِ آن روی کاغذ یک
     «مستطیلِ گردگوشه» است با:
        طول  = contactWidth   (بخشی از پهنای کاملِ نوک که تماس دارد)
        عرض  = contactThick   (ضخامتِ تیغه، با فشار کمی پهن می‌شود)
     و مهم‌تر: با کم‌شدنِ فشار، قلم روی پاشنه می‌چرخد و تماس از یک سَر
     عقب می‌نشیند، نه از دو سر به‌طرفِ مرکز. این را با heelOffset
     مدل می‌کنیم (PHASE 7).
     =================================================================== */

  // خروجی در یک شیءِ قابلِ استفاده‌ی مجدد نوشته می‌شود (بدون تخصیص)
  /* --------------------------------------------------------------------
     ContactProfile — «سطحِ تماس» به‌جای «یک عدد پهنا»
     --------------------------------------------------------------------
     مختصاتِ محلیِ نوک: u روی لبه‌ی بُرش، از -1 (پاشنه) تا +1 (پنجه).

              TOE (u = +1)
        ┌───────────────────┐
        │                   │  ← ضخامتِ تیغه (thickness)
        │   [uHeel , uToe]  │  ← بازه‌ی تماس
        └───────────────────┘
              HEEL (u = -1)

     فشارِ کامل  ⇒ [-1, +1]           (کلِ لبه روی کاغذ)
     فشارِ متوسط ⇒ [-0.1, +1]          (پاشنه بلند شده)
     فشارِ کم    ⇒ [+0.8, +1]          (فقط پنجه)
     و اگر heelLift = 0 باشد ⇒ [-r, +r] (تقارنِ حولِ مرکز)

     پس این‌جا «کاهش تماس از کدام سَر» یک پارامترِ صریحِ هندسی است، نه
     نتیجه‌ی جانبیِ مقیاس‌کردنِ یک مستطیل.
     -------------------------------------------------------------------- */
  function ContactState() {
    // ---- پروفایلِ تماس در مختصاتِ محلیِ نوک ----
    this.uHeel = -1;        // سرِ پاشنه‌ایِ بازه‌ی تماس ∈ [-1,1]
    this.uToe = 1;          // سرِ پنجه‌ایِ بازه‌ی تماس ∈ [-1,1]
    // ---- مشتقاتِ پیکسلی (برای رندرر) ----
    this.width = 0;         // طولِ سطحِ تماس (px)
    this.thickness = 0;     // عرضِ سطحِ تماس (px)
    this.offset = 0;        // جابه‌جاییِ مرکزِ تماس روی محورِ نوک (px)
    this.ratio = 0;         // width / nibWidth ∈ [0,1]
    this.angleRad = 0;      // زاویه‌ی نهاییِ لبه‌ی نوک
    this.apparent = 0;      // پهنای دیده‌شده، عمود بر جهتِ حرکت
    this.heelSign = 1;      // کدام سَرِ لبه «پاشنه» است (+1 / -1)
    // ---- وضعیتِ سه‌بعدیِ قلم ----
    this.lean = 0;          // 0 = عمود، 1 = خوابیده
    this.leanDir = 0;       // جهتِ خوابیدن (rad)
    this.relAngle = 0;      // زاویه‌ی لبه نسبت به جهتِ حرکت (rad)
    this.pushPull = 0;      // -1 = کاملاً کشیدن، +1 = کاملاً راندن
    this.edgeRoughness = 0; // زبریِ لبه ناشی از راندنِ قلم
    this.orientationFrom = 'config'; // 'twist' | 'lean' | 'motion' | 'config'
  }

  /* --------------------------------------------------------------------
     زاویه‌ی لبه‌ی نوک — زنجیره‌ی صریحِ اولویت
     --------------------------------------------------------------------
     ترتیبِ خواسته‌شده (و از نظر فیزیکی هم درست):

       ۱) twist  — چرخشِ بدنه‌ی قلم حولِ محورِ خودش. لبه‌ی بُرش به بدنه
          چسبیده، پس این *دقیقاً* چرخشِ لبه است. بهترین منبع.
       ۲) جهتِ خوابیدنِ قلم (leanDir از azimuth/altitude یا از tilt).
          [APPROXIMATION] فرض می‌کنیم خطاط لبه را عمود بر جهتِ خوابیدن
          نگه می‌دارد؛ این فرض برای وضعیتِ متعارفِ گرفتنِ قلم درست است
          ولی نحوه‌ی گرفتنِ قلم از دیجیتایزر قابل خواندن نیست.
       ۳) جهتِ حرکتِ خط.
       ۴) زاویه‌ی تنظیم‌شده در UI.

     نکته‌ی حیاتی (بخش ۲۸ درخواست): «صفر» ورودیِ معتبر نیست.
     lean == 0 و twistValid == false یعنی «بی‌اطلاع»، و در آن حالت
     هیچ چرخشی اعمال نمی‌شود. تفکیکِ valid/invalid در stylus.js انجام
     شده و این‌جا فقط پرچم‌ها مصرف می‌شوند.
     -------------------------------------------------------------------- */
  function resolveNibAngle(cfg, baseDeg, dirRad, orient) {
    const base = baseDeg * DEG;
    const mode = cfg.angleMode;

    // حالتِ «ثابت»: فقط زاویه‌ی UI، با اصلاحِ کوچکی از خوابیدنِ قلم
    if (mode === 'fixed') {
      if (orient && orient.leanValid && cfg.tiltInfluence > 0 && orient.lean > 0.08) {
        const target = orient.leanDir + Math.PI * 0.5;
        const w = clamp01(cfg.tiltInfluence) * clamp01(orient.lean) * 0.35;
        return { ang: base + angleDelta(target, base) * w, from: 'lean' };
      }
      return { ang: base, from: 'config' };
    }

    if (mode === 'motion') {
      if (dirRad !== null) return { ang: dirRad + base, from: 'motion' };
      return { ang: base, from: 'config' };
    }

    // mode === 'dynamic' — زنجیره‌ی کامل
    if (orient && orient.twistValid) {
      return { ang: orient.twist * DEG + base, from: 'twist' };
    }
    if (orient && orient.leanValid && orient.lean > 0.02) {
      // لبه عمود بر جهتِ خوابیدن  [APPROXIMATION]
      return { ang: orient.leanDir + Math.PI * 0.5 + base, from: 'lean' };
    }
    if (dirRad !== null) return { ang: dirRad + base, from: 'motion' };
    return { ang: base, from: 'config' };
  }

  /* --------------------------------------------------------------------
     کدام سَرِ لبه «پاشنه» است؟
     --------------------------------------------------------------------
     اگر قلم خوابیده باشد، پاشنه سمتِ مخالفِ خوابیدن است (وزنِ قلم روی
     پنجه می‌افتد). اگر دادهٔ خوابیدن نداشته باشیم، سَرِ عقبیِ لبه نسبت
     به جهتِ حرکت را پاشنه می‌گیریم.  [APPROXIMATION]
     -------------------------------------------------------------------- */
  function resolveHeelSign(cfg, angRad, dirRad, orient) {
    const ax = Math.cos(angRad), ay = Math.sin(angRad);
    if (orient && orient.leanValid && orient.lean > 0.02) {
      const d = Math.cos(orient.leanDir) * ax + Math.sin(orient.leanDir) * ay;
      if (Math.abs(d) > 1e-6) return d > 0 ? -1 : 1;
    }
    if (cfg.heelFromDirection && dirRad !== null) {
      const d = Math.cos(dirRad) * ax + Math.sin(dirRad) * ay;
      if (Math.abs(d) > 1e-6) return d > 0 ? -1 : 1;
    }
    return 1;
  }

  /* --------------------------------------------------------------------
     computeContact — فشار/شیب/سرعت/جهت  ⟶  ContactProfile
     --------------------------------------------------------------------
     orient = {
       lean, leanDir, leanValid,     // از StylusState
       twist, twistValid,
     }  یا null (بی‌اطلاع)
     -------------------------------------------------------------------- */
  function computeContact(out, cfg, pMapped, speed, dirRad, orient, prevLean) {
    const nibW = Math.max(0.05, cfg.nibWidth);
    const nibT = Math.max(0.05, cfg.nibThickness);

    /* ---- خوابیدنِ قلم، با محدودیتِ نرخِ تغییر در *هر دو* جهت ----
       PHASE B — باگِ «لاغرشدنِ ناگهانی»:
       نسخه‌ی قبلی محدودگرِ نرخ را فقط وقتی اعمال می‌کرد که جهت‌گیری معتبر
       بود. اگر جهت‌گیری در میانه‌ی استروک نامعتبر/کهنه می‌شد
       (ORIENTATION.EXPIRED)، مقدارِ lean در یک نمونه از مثلاً 0.7 به 0
       می‌پرید. چون سطحِ تماس با
             tiltGain   = 1 + lean·tiltContactInfluence      (تا +۲۵٪)
             leanThick  = 1 + lean·tiltThicknessInfluence    (تا +۴۵٪)
       مقیاس می‌شود، خط در یک نمونه تا ۲۵٪ باریک و تا ۴۵٪ نازک می‌شد —
       بدونِ هیچ تغییرِ واقعی در فشار، جهت یا مسیر. یعنی artifact.
       حالا lean همیشه — چه معتبر و چه نامعتبر — فقط با آهنگِ محدود حرکت
       می‌کند، پس بازگشت به «قلمِ عمود» هم نرم است.                     */
    let lean = 0, leanValid = false, leanDir = 0;
    const prevOk = (typeof prevLean === 'number' && isFinite(prevLean));
    if (orient && orient.leanValid) {
      lean = clamp01(orient.lean);
      leanDir = orient.leanDir;
      leanValid = true;
    } else {
      // جهت‌گیری نداریم ⇒ هدف صفر است، ولی *به‌تدریج*
      lean = 0;
      leanDir = prevOk && orient ? (orient.leanDir || 0) : 0;
      leanValid = prevOk && prevLean > 1e-3;   // تا وقتی به صفر نرسیده، معتبر بمان
    }
    if (prevOk) {
      const lim = Math.max(1e-4, cfg.leanRateLimit);
      if (lean - prevLean > lim) lean = prevLean + lim;
      else if (prevLean - lean > lim) lean = prevLean - lim;
    }
    out.lean = lean;
    out.leanDir = leanDir;

    /* ---- سرعت: حرکتِ تندتر ⇒ نوک سبک‌تر می‌نشیند ----
       نکتهٔ مهم (رفعِ باگِ نمونهٔ نخست): وقتی سرعت *نامعلوم* است
       (speed < 0)، جریمهٔ سرعت باید همان مقدارِ «نوشتنِ عادی» باشد، نه
       صفر. اگر صفر باشد، نمونهٔ اولِ هر استروک — که هنوز حرکتی ندیده —
       پهن‌ترین حالتِ ممکن را می‌گیرد و در فشارِ ۱ دقیقاً تمامِ پهنای نوک
       را می‌مهد. speed < 0 قراردادِ «نامعلوم» است. */
    const speedKnown = speed >= 0;
    const effSpeed = speedKnown ? speed : cfg.velocityRef;
    const vRel = clamp(effSpeed / Math.max(1e-6, cfg.velocityRef), 0, cfg.velocityMax);
    const vExcess = clamp01((vRel - 1) / Math.max(1e-6, cfg.velocityMax - 1));
    const vWidth = 1 - vExcess * clamp01(cfg.velocityWidthInfluence);

    // ---- نگاشتِ اصلیِ فشار ⟶ نسبتِ سطحِ تماس ----
    // f(pressure) غیرِ خطی و قابلِ کالیبراسیون؛ pMapped از قبل از منحنیِ
    // فشار گذشته است، پس این‌جا فقط نگاشتِ هندسی انجام می‌شود.
    const eff = clamp01(pMapped) * vWidth;
    // قلمِ خوابیده سطحِ بیشتری از لبه را روی کاغذ می‌گذارد
    const tiltGain = leanValid ? 1 + lean * clamp01(cfg.tiltContactInfluence) : 1;
    let ratio = clamp01(
      (cfg.minContactRatio + eff * (cfg.maxContactRatio - cfg.minContactRatio)) * tiltGain
    );
    out.ratio = ratio;
    out.width = nibW * ratio;

    // ---- ضخامتِ تیغه: فشار کمی پهنش می‌کند، خوابیدنِ قلم بیشتر ----
    const leanThick = leanValid ? 1 + lean * clamp01(cfg.tiltThicknessInfluence) : 1;
    out.thickness = nibT *
      (1 - cfg.thicknessGain * 0.5 + cfg.thicknessGain * eff) * leanThick;

    // ---- زاویه‌ی لبه ----
    const res = resolveNibAngle(cfg, cfg.nibAngle, dirRad, orient);
    out.angleRad = res.ang;
    out.orientationFrom = res.from;
    out.heelSign = resolveHeelSign(cfg, res.ang, dirRad, orient);

    /* ---- پروفایلِ تماس در مختصاتِ محلیِ نوک (PHASE 2 درخواست) ----
       بازه‌ی تماس روی u ∈ [-1,1]. با heelLift = 1 سَرِ پنجه ثابت می‌مانَد
       و بازه فقط از سمتِ پاشنه کوتاه می‌شود؛ با heelLift = 0 بازه حولِ
       مرکز متقارن کوچک می‌شود.                                        */
    const hl = clamp01(cfg.heelLift);
    const halfR = ratio;                 // نصفِ طولِ بازه در مقیاسِ u
    // با heelSign = +1، پاشنه در سمتِ u منفی است؛ پس هرچه پاشنه بیشتر
    // بلند شود، مرکزِ بازه به سمتِ +(1-r) (پنجه) می‌رود و برعکس.
    const ucFull = out.heelSign > 0 ? (1 - halfR) : -(1 - halfR);
    const uc = lerp(0, ucFull, hl);
    out.uHeel = clamp(uc - halfR, -1, 1);
    out.uToe = clamp(uc + halfR, -1, 1);
    out.offset = uc * nibW * 0.5;

    // ---- push / pull  (بخش ۳ درخواست) ----
    if (dirRad !== null) {
      out.relAngle = angleDelta(out.angleRad, dirRad);
      // اگر جهتِ حرکت مؤلفه‌ای در راستای «رو به پاشنه» داشته باشد،
      // قلم رانده می‌شود. مؤلفه‌ی عمود بر لبه علامتِ آن را می‌دهد.
      const nx = -Math.sin(out.angleRad), ny = Math.cos(out.angleRad);
      const dot = Math.cos(dirRad) * nx + Math.sin(dirRad) * ny;
      out.pushPull = clamp(dot * out.heelSign, -1, 1);
      const push = Math.max(0, Math.abs(out.pushPull) - clamp01(cfg.pushThreshold)) /
                   Math.max(1e-6, 1 - clamp01(cfg.pushThreshold));
      out.edgeRoughness = (out.pushPull > 0 ? push : 0) * clamp01(cfg.pushEdgeRoughness);
    } else {
      out.relAngle = 0; out.pushPull = 0; out.edgeRoughness = 0;
    }

    // ---- پهنای دیده‌شده (PHASE 12) ----
    if (dirRad === null) {
      out.apparent = out.width;
    } else {
      const th = out.relAngle;
      out.apparent = Math.abs(out.width * Math.sin(th)) +
                     Math.abs(out.thickness * Math.cos(th));
    }
    return out;
  }

  /* --------------------------------------------------------------------
     چندضلعیِ سطحِ تماس (footprint)
     -------------------------------------------------------------------
     چهار گوشه در یک Float32Array از پیش‌ساخته نوشته می‌شود:
        [x0,y0, x1,y1, x2,y2, x3,y3]
     ترتیب: دو گوشه‌ی سرِ «پنجه»، دو گوشه‌ی سرِ «پاشنه».
     -------------------------------------------------------------------- */
  /* از پروفایلِ محلیِ نوک (uHeel..uToe) به چهار گوشه‌ی پیکسلی */
  /* grow > 0 چندضلعی را از هر چهار طرف به اندازه‌ی grow بزرگ می‌کند.
     برای ساختِ «حاشیه‌ی مویینِ» مرکب لازم است: پوشِ محدبِ دو footprintِ
     بزرگ‌شده، همان جمعِ مینکوفسکیِ خط با یک مستطیلِ اندکی بزرگ‌تر است، و
     مرزِ بیرونی‌اش صاف است — برخلافِ stroke کردنِ محیط که کلاهکِ گردِ هر
     پاره‌خط را هم بیرون می‌زند و لبه را دندانه‌دار می‌کند. */
  function footprintFromProfile(out, x, y, angRad, nibWidth, uHeel, uToe,
                                thickness, grow) {
    const half = nibWidth * 0.5;
    const g = grow > 0 ? grow : 0;
    const a0 = uHeel * half - g, a1 = uToe * half + g;
    const b = Math.max(0.05, thickness) * 0.5 + g;
    const c = Math.cos(angRad), s = Math.sin(angRad);
    const bx = -s * b, by = c * b;
    out[0] = x + c * a1 + bx; out[1] = y + s * a1 + by;
    out[2] = x + c * a0 + bx; out[3] = y + s * a0 + by;
    out[4] = x + c * a0 - bx; out[5] = y + s * a0 - by;
    out[6] = x + c * a1 - bx; out[7] = y + s * a1 - by;
    return out;
  }

  function footprint(out, x, y, angRad, width, thickness, offset) {
    const a = width * 0.5, b = Math.max(0.05, thickness) * 0.5;
    const c = Math.cos(angRad), s = Math.sin(angRad);
    const cx = x + c * offset, cy = y + s * offset;
    const ax = c * a, ay = s * a;   // نیم‌بردارِ طولِ لبه
    const bx = -s * b, by = c * b;  // نیم‌بردارِ ضخامت
    out[0] = cx + ax + bx; out[1] = cy + ay + by;
    out[2] = cx - ax + bx; out[3] = cy - ay + by;
    out[4] = cx - ax - bx; out[5] = cy - ay - by;
    out[6] = cx + ax - bx; out[7] = cy + ay - by;
    return out;
  }

  /* ===================================================================
     ۵) پوشِ محدبِ ۸ نقطه‌ای — بدون تخصیصِ حافظه
     -------------------------------------------------------------------
     دو footprint متوالی را به یک ناحیه‌ی پیوسته تبدیل می‌کند. این همان
     ایده‌ی «پوشِ حرکتِ قلمِ چندضلعیِ محدب» در METAFONT/Hobby است [MF][HOB]
     که برای گامِ کوچک، تقریبِ بسیار خوبی از جمعِ مینکوفسکی است.
     =================================================================== */
  function Hull() {
    this.xs = new Float32Array(16);
    this.ys = new Float32Array(16);
    this.idx = new Int32Array(16);
    this.stack = new Int32Array(20);
    this.outX = new Float32Array(16);
    this.outY = new Float32Array(16);
    this.n = 0;
  }
  Hull.prototype.build = function (fpA, fpB) {
    const xs = this.xs, ys = this.ys, idx = this.idx;
    for (let i = 0; i < 4; i++) {
      xs[i] = fpA[i * 2]; ys[i] = fpA[i * 2 + 1];
      xs[i + 4] = fpB[i * 2]; ys[i + 4] = fpB[i * 2 + 1];
    }
    const n = 8;
    for (let i = 0; i < n; i++) idx[i] = i;
    // insertion sort روی (x, y) — n=8 پس هزینه‌اش ناچیز و بدون تخصیص است
    for (let i = 1; i < n; i++) {
      const k = idx[i];
      let j = i - 1;
      while (j >= 0 && (xs[idx[j]] > xs[k] ||
                       (xs[idx[j]] === xs[k] && ys[idx[j]] > ys[k]))) {
        idx[j + 1] = idx[j]; j--;
      }
      idx[j + 1] = k;
    }
    const st = this.stack;
    let top = 0;
    const cross = (o, a, b) =>
      (xs[a] - xs[o]) * (ys[b] - ys[o]) - (ys[a] - ys[o]) * (xs[b] - xs[o]);

    // زنجیره‌ی پایین
    for (let i = 0; i < n; i++) {
      const q = idx[i];
      while (top >= 2 && cross(st[top - 2], st[top - 1], q) <= 0) top--;
      st[top++] = q;
    }
    // زنجیره‌ی بالا
    const lower = top + 1;
    for (let i = n - 2; i >= 0; i--) {
      const q = idx[i];
      while (top >= lower && cross(st[top - 2], st[top - 1], q) <= 0) top--;
      st[top++] = q;
    }
    top--; // نقطه‌ی آغاز تکرار شده است

    const ox = this.outX, oy = this.outY;
    for (let i = 0; i < top; i++) { ox[i] = xs[st[i]]; oy[i] = ys[st[i]]; }
    this.n = top;
    return top;
  };

  /* ===================================================================
     ۶) مدلِ مرکب (PHASE 10)
     -------------------------------------------------------------------
        inkAmount = flow × contactFactor × velocityFactor × dwellFactor
                          × startFactor × pushPullFactor
     همه‌ی ضرایب clamp می‌شوند. این عدد *مقدارِ مرکبِ نشسته* است، نه
     شفافیت؛ رندرر تصمیم می‌گیرد چقدر از آن را به چگالی/رنگ تبدیل کند و
     inkDensityFloor تضمین می‌کند که خطِ کم‌فشار «باریک» شود نه «محو».
     پخشِ واقعیِ سیال ([MOXI]) در این نسخه پیاده نشده؛ فقط جای آن باز است.
     =================================================================== */
  /* --------------------------------------------------------------------
     مدلِ مرکب — مؤلفه‌های تفکیک‌شده (بخش ۱۴ درخواست)
     --------------------------------------------------------------------
        reservoir   : مرکبِ موجود در شیارِ نی            [APPROXIMATION]
        flow        : نرخِ خروجِ مرکب از شیار            [APPROXIMATION]
        deposition  : مرکبی که واقعاً روی کاغذ می‌نشیند
        pooling     : تجمعِ مرکب هنگام درنگ/کندی
        spread      : پهن‌شدنِ مرکب روی الیاف (پر و بال)
        absorption  : سهمی که کاغذ می‌بلعد (روی تیرگیِ سطح اثر دارد)

     هیچ‌کدام شبیه‌سازیِ سیالِ واقعی نیستند؛ اما از هم جدا و مستقل‌اند تا
     بعداً بتوان هرکدام را با یک مدلِ فیزیکی‌تر (مثلاً MoXi برای spread و
     absorption) جایگزین کرد بی‌آنکه بقیه دست بخورد.

     مرجعِ کیفی برای «مخزن + سایش»: Strassmann, Hairy Brushes (1986).
     مرجعِ کیفی برای «پخش/تجمع در کاغذِ جاذب»: Chu & Tai, MoXi (2005).
     -------------------------------------------------------------------- */
  function InkState() {
    this.reservoir = 1;     // ۰..۱ (اگر مدلِ مخزن خاموش باشد همیشه ۱)
    this.flow = 1;
    this.deposition = 1;
    this.pooling = 0;
    this.spread = 0;
    this.absorption = 0;
    // خروجی‌های سازگارِ رندرر
    this.amount = 1;
    this.density = 1;
    this.starved = false;   // مخزن خالی شده؟
  }

  InkState.prototype.reset = function (cfg) {
    this.reservoir = 1;
    this.flow = 1; this.deposition = 1;
    this.pooling = 0; this.spread = 0; this.absorption = 0;
    this.amount = 1; this.density = 1; this.starved = false;
    return this;
  };

  /* in = {
       contactRatio, contactArea, speed, dwellMs, arcFromStart,
       pushPull, dtMs
     } */
  function computeInk(out, cfg, contactRatio, speed, dwellMs, arcFromStart,
                      pushPull, contactArea, dtMs) {
    const cr = clamp01(contactRatio);

    /* ---- ۱) مخزن -------------------------------------------------- */
    if (cfg.reservoirCapacity > 0) {
      const use = (contactArea || cr) * (dtMs || 8) / 1000 /
                  Math.max(1e-6, cfg.reservoirCapacity);
      out.reservoir = clamp01(out.reservoir - use +
                              (cfg.reservoirRefill * (dtMs || 8) / 1000));
    } else {
      out.reservoir = 1;
    }
    out.starved = out.reservoir < 0.08;

    /* ---- ۲) جریان ------------------------------------------------- */
    // سرعتِ بالا ⇒ فرصتِ کمترِ مویینگی ⇒ جریانِ کمتر
    const vRel = clamp(speed / Math.max(1e-6, cfg.velocityRef), 0, cfg.velocityMax);
    const vFactor = 1 - clamp01(cfg.velocityInkInfluence) *
                        clamp01((vRel - 1) / Math.max(1e-6, cfg.velocityMax - 1));
    // راندنِ قلم جریان را کم می‌کند  [APPROXIMATION]
    const push = Math.max(0, pushPull || 0);
    const pushF = 1 - push * clamp01(cfg.pushFlowPenalty);
    out.flow = clamp(cfg.inkFlow * vFactor * pushF * out.reservoir, 0, 4);

    /* ---- ۳) تجمع در درنگ ------------------------------------------ */
    out.pooling = clamp01(dwellMs / Math.max(1, cfg.dwellRefMs)) *
                  clamp01(cfg.dwellPooling);

    /* ---- ۴) مرکبِ آغازِ خط ----------------------------------------
       قلمِ نی در لحظهٔ نشستن مرکبِ ذخیره‌شده در شیار را آزاد می‌کند — ولی
       این اثر **وابسته به درنگ** است: اگر قلم را بگذاری و بی‌درنگ حرکت
       کنی، لکه‌ای نمی‌ماند. نسخهٔ قبلی این را فقط تابعِ «فاصله از آغاز»
       گرفته بود، پس نمونهٔ اولِ *هر* استروک ۱٫۳۵ برابر مرکب می‌گرفت و یک
       نقطهٔ تیرهٔ مصنوعی می‌ساخت. */
    const startWindow = clamp01(1 - arcFromStart / Math.max(0.5, cfg.startInkLength));
    const dwellGate = clamp01(dwellMs / Math.max(1, cfg.startInkDwellMs));
    const startF = 1 + clamp01(cfg.startInkBoost) * startWindow * dwellGate;

    /* ---- ۵) نشست ------------------------------------------------- */
    out.deposition = clamp(
      out.flow * (0.35 + 0.65 * cr) * (1 + out.pooling) * startF, 0, 4);

    /* ---- ۶) جذب و پخشِ کاغذ -------------------------------------- */
    out.absorption = clamp01(cfg.paperAbsorption) *
                     clamp01(0.4 + 0.6 * out.deposition * 0.5);
    out.spread = clamp(out.pooling * 0.5 + out.absorption * 0.35, 0, 1.5);

    /* ---- خروجیِ سازگار ------------------------------------------- */
    out.amount = out.deposition;
    // چگالیِ دیده‌شده: کفِ ثابت + سهمِ کوچکِ فشار + سهمِ تجمع، منهای
    // سهمی که کاغذ بلعیده (روی سطح کمتر می‌مانَد)
    out.density = clamp(
      cfg.inkSaturation * (
        cfg.inkDensityFloor +
        cfg.inkPressureDensity * cr +
        out.pooling * 0.10 -
        out.absorption * 0.06
      ) * (out.starved ? 0.55 : 1), 0, 1);
    return out;
  }

  /* ===================================================================
     ۷) بازنمونه‌برداری بر مبنای طولِ قوس (PHASE 3)
     -------------------------------------------------------------------
     هدف: تعدادِ نمونه‌ها تابعِ *مسافتِ واقعیِ حرکت* باشد، نه تعدادِ
     رویدادِ سخت‌افزار و نه اندازه‌ی قلم.

        spacing = clamp(contactSpan × spacingFactor, MIN_SPACING, MAX_SPACING)
        n       = clamp(ceil(distance / spacing), 1, MAX_SAMPLES_PER_EVENT)
        // اگر n به سقف خورد، spacing بازمحاسبه می‌شود تا شکافی نمانَد
        spacing = distance / n

     باقیمانده‌ی کسری (carry) بین رویدادها نگه داشته می‌شود تا هیچ
     نمونه‌ای گم یا تکرار نشود.
     =================================================================== */
  function RawPoint() {
    this.x = 0; this.y = 0; this.p = 0;
    this.tiltX = 0; this.tiltY = 0; this.twist = 0;
    this.t = 0; this.hasTilt = false; this.hasTwist = false;
    this.supported = false;
  }

  function Resampler(cfg) {
    this.cfg = cfg;
    // چهار نقطه‌ی خامِ آخر برای Catmull-Rom
    this._ring = [new RawPoint(), new RawPoint(), new RawPoint(), new RawPoint()];
    this._count = 0;
    this.reset();
  }

  Resampler.prototype.reset = function () {
    this._count = 0;
    // نمونهٔ نخست نگه داشته می‌شود تا جهت و سرعتِ واقعی معلوم شود
    // (حالتِ PENDING_INPUT). هیچ مرکبی پیش از آن نمی‌نشیند.
    this.pending = null;
    this.pendingEmitted = false;
    this.carry = 0;
    this.arcLength = 0;
    this.lastEmitX = 0;
    this.lastEmitY = 0;
    this.hasEmit = false;
    this.speed = 0;
    this.dwellMs = 0;
    this.dirRad = null;
    this.emitted = 0;
    this.droppedToClamp = 0;
    this.speedSpikes = 0;
    return this;
  };

  Resampler.prototype._push = function (x, y, p, tiltX, tiltY, twist, t,
                                        hasTilt, hasTwist, supported) {
    const r = this._ring;
    const slot = r[3];
    r[3] = r[2]; r[2] = r[1]; r[1] = r[0]; r[0] = slot;
    slot.x = x; slot.y = y; slot.p = p;
    slot.tiltX = tiltX; slot.tiltY = tiltY; slot.twist = twist;
    slot.t = t; slot.hasTilt = hasTilt; slot.hasTwist = hasTwist;
    slot.supported = supported;
    if (this._count < 4) this._count++;
    return slot;
  };

  // نقطه‌ی خامِ i-ام از انتها (0 = جدیدترین)
  Resampler.prototype.at = function (i) {
    return this._ring[Math.min(i, this._count - 1)];
  };

  /* --------------------------------------------------------------------
     یک رویدادِ ورودی را می‌گیرد و نمونه‌های بازنمونه‌شده را با فراخوانیِ
     emit(x, y, pressure, tiltX, tiltY, twist, tMs, dirRad, speed, dwellMs,
          arcFromStart, isFirst) تولید می‌کند.
     خروجی: تعدادِ نمونه‌های تولیدشده.
     -------------------------------------------------------------------- */
  Resampler.prototype.feed = function (x, y, p, tiltX, tiltY, twist, tMs,
                                       hasTilt, hasTwist, supported,
                                       contactSpan, emit) {
    const cfg = this.cfg;
    const prev = this._count ? this.at(0) : null;
    this._push(x, y, p, tiltX, tiltY, twist, tMs, hasTilt, hasTwist, supported);

    if (!prev) {
      /* ---- PENDING_INPUT ----------------------------------------------
         نمونهٔ نخست را *نگه می‌داریم* و هیچ مرکبی نمی‌گذاریم. دلیل:
           • جهتِ حرکت هنوز نامعلوم است، پس heelSign و پهنای دیده‌شده
             بی‌مبنا محاسبه می‌شدند؛
           • سرعت نامعلوم است، و اگر آن را صفر بگیریم نمونهٔ اول جریمهٔ
             سرعت نمی‌گیرد و از بقیهٔ خط پهن‌تر می‌شود — همان «مهرِ
             تمام‌پهنا در آغازِ استروک».
         به‌محضِ رسیدنِ نمونهٔ دوم، همین نقطه با جهت و سرعتِ *واقعی* رسم
         می‌شود. اگر نمونهٔ دومی نیاید (قلم بی‌حرکت روی کاغذ)،
         flushPending با علامتِ «بی‌حرکت» آن را می‌گذارد.
         ------------------------------------------------------------------ */
      this.lastEmitX = x; this.lastEmitY = y;
      this.hasEmit = true;
      this.carry = 0;
      this.arcLength = 0;
      this.dwellMs = 0;
      this.pending = {
        x: x, y: y, p: p, tiltX: tiltX, tiltY: tiltY, twist: twist, t: tMs,
      };
      this.pendingEmitted = false;
      return 0;
    }

    const dx = x - prev.x, dy = y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dt = Math.max(0.5, tMs - prev.t);

    /* ---- سرعت (هموارشده و مقاوم به پرش) ----------------------------
       PHASE B: dt در برخی دسته‌های رویداد به کفِ 0.5ms می‌خورد؛ آن‌وقت یک
       جهشِ ۳ پیکسلی سرعتی ۶px/ms می‌سازد (۱۴ برابرِ مرجع) و چون پهنا با
       velocityWidthInfluence به سرعت گره خورده، خط برای یک نمونه باریک
       می‌شود. پس نرخِ *افزایشِ* سرعت هم کران دارد.                     */
    let instSpeed = dist / dt;
    if (!isFinite(instSpeed) || instSpeed < 0) instSpeed = 0;
    const vClamp = cfg.velocityRef * Math.max(1, cfg.velocitySpikeLimit);
    if (this.hasEmit && this.speed > 0 && instSpeed > this.speed + vClamp) {
      this.speedSpikes++;
      instSpeed = this.speed + vClamp;
    }
    const vs = clamp01(cfg.velocitySmoothing);
    this.speed = this.hasEmit && this.speed > 0
      ? this.speed + (instSpeed - this.speed) * vs
      : instSpeed;

    // ---- زمانِ درنگ (برای pooling) -----------------------------------
    if (dist < 0.35) this.dwellMs += dt;
    else this.dwellMs = Math.max(0, this.dwellMs - dt * 2);

    if (dist < 1e-4) return 0;

    const dirRad = Math.atan2(dy, dx);
    this.dirRad = dirRad;

    /* نمونهٔ نگه‌داشته‌شده را حالا با جهت و سرعتِ واقعی می‌گذاریم */
    if (this.pending && !this.pendingEmitted) {
      const q = this.pending;
      this.pendingEmitted = true;
      this.emitted++;
      emit(q.x, q.y, q.p, q.tiltX, q.tiltY, q.twist, q.t,
           dirRad, this.speed, this.dwellMs, 0, true);
      this.lastEmitX = q.x; this.lastEmitY = q.y;
    }

    // ---- فاصله‌ی نمونه‌برداری (کرانِ سختِ باگ #۱) ---------------------
    const span = Math.max(0.05, contactSpan);
    let spacing = clamp(span * cfg.spacingFactor, cfg.minSpacing, cfg.maxSpacing);

    const total = dist + this.carry;
    let n = Math.floor(total / spacing);
    if (n < 1) {
      // حرکت از یک گامِ نمونه کمتر بود: فقط جمع کن و چیزی نکش
      this.carry = total;
      return 0;
    }
    if (n > cfg.maxSamplesPerEvent) {
      // به سقف خورد ⇒ گام را بزرگ کن تا شکافی نمانَد (نه اینکه نمونه بیندازیم)
      this.droppedToClamp += n - cfg.maxSamplesPerEvent;
      n = cfg.maxSamplesPerEvent;
      spacing = total / n;
    }

    // ---- درون‌یابیِ مسیر --------------------------------------------
    // Catmull-Rom روی p1=prev, p2=cur با p0/p3 از نقاطِ قبلی
    const useCR = cfg.interpolation === 'catmullrom' && this._count >= 3;
    const p1 = prev, p2 = this.at(0);
    const p0 = this._count >= 3 ? this.at(2) : p1;
    const p3 = p2; // نقطه‌ی بعدی هنوز نرسیده ⇒ برون‌یابی نمی‌کنیم

    let emittedNow = 0;
    const carry0 = this.carry;
    for (let i = 1; i <= n; i++) {
      // فاصله‌ی این نمونه از ابتدای همین پاره‌خط
      const d = i * spacing - carry0;
      const u = clamp01(d / Math.max(1e-6, dist));

      let sx, sy;
      if (useCR) {
        // Catmull-Rom یکنواخت با tension 0.5
        const t2 = u * u, t3 = t2 * u;
        const q0 = -0.5 * t3 + t2 - 0.5 * u;
        const q1 = 1.5 * t3 - 2.5 * t2 + 1.0;
        const q2 = -1.5 * t3 + 2.0 * t2 + 0.5 * u;
        const q3 = 0.5 * t3 - 0.5 * t2;
        sx = p0.x * q0 + p1.x * q1 + p2.x * q2 + p3.x * q3;
        sy = p0.y * q0 + p1.y * q1 + p2.y * q2 + p3.y * q3;
      } else {
        sx = lerp(p1.x, p2.x, u);
        sy = lerp(p1.y, p2.y, u);
      }

      const sp = lerp(p1.p, p2.p, u);
      // فیلدِ tiltX اکنون «میزانِ خوابیدنِ قلم» (lean) است: عددِ اسکالر،
      // درون‌یابیِ خطی درست است.
      const stx = lerp(p1.tiltX, p2.tiltX, u);
      // فیلدِ tiltY اکنون «جهتِ خوابیدن» (leanDir) بر حسبِ رادیان است:
      // درون‌یابیِ خطی روی مرزِ ±π می‌پرد، پس کوتاه‌ترین کمان لازم است.
      const sty = p1.tiltY + angleDelta(p2.tiltY, p1.tiltY) * u;
      const stw = lerp(p1.twist, p2.twist, u);
      const st = lerp(p1.t, p2.t, u);

      const ddx = sx - this.lastEmitX, ddy = sy - this.lastEmitY;
      const step = Math.sqrt(ddx * ddx + ddy * ddy);
      this.arcLength += step;
      const localDir = step > 1e-6 ? Math.atan2(ddy, ddx) : dirRad;

      emit(sx, sy, sp, stx, sty, stw, st, localDir, this.speed,
           this.dwellMs, this.arcLength, false);

      this.lastEmitX = sx; this.lastEmitY = sy;
      emittedNow++;
      this.emitted++;
    }
    this.carry = total - n * spacing;
    if (this.carry < 0) this.carry = 0;
    return emittedNow;
  };
  /* -------------------------------------------------------------------
     تخلیه‌ی نمونه‌ی نگه‌داشته‌شده
     -------------------------------------------------------------------
     دو کاربرد:
       • قلم روی کاغذ گذاشته شده و حرکت نمی‌کند (نقطه / درنگ)
       • استروک تمام شده و هرگز حرکتی نشد
     سرعت را «نامعلوم» (-1) می‌فرستیم تا مدلِ تماس همان جریمه‌ی سرعتِ
     نوشتنِ عادی را اعمال کند، نه صفر. جهت هم نامعلوم است.
     ------------------------------------------------------------------- */
  Resampler.prototype.flushPending = function (emit, dwellMs) {
    if (!this.pending || this.pendingEmitted) return 0;
    const q = this.pending;
    this.pendingEmitted = true;
    this.emitted++;
    emit(q.x, q.y, q.p, q.tiltX, q.tiltY, q.twist, q.t,
         null, -1, dwellMs === undefined ? this.dwellMs : dwellMs, 0, true);
    this.lastEmitX = q.x; this.lastEmitY = q.y;
    return 1;
  };
  Resampler.prototype.hasPending = function () {
    return !!(this.pending && !this.pendingEmitted);
  };

  /* -------------------------------------------------------------------
     بازقیمت‌گذاریِ فشارِ نمونهٔ نگه‌داشته‌شده  (رفعِ مسئلهٔ ۱)
     -------------------------------------------------------------------
     نمونهٔ نخست (pointerdown) در حالتِ PENDING_INPUT نگه داشته می‌شود تا
     جهت و سرعتِ واقعی معلوم شود؛ ولی *فشارِ* آن همان مقدارِ لحظهٔ
     pointerdown بود. اگر آن مقدار نمایندهٔ فشارِ کاربر نباشد (مقدارِ
     پیش‌فرضِ ۰٫۵ یا جهشِ آستانهٔ دیجیتایزر) نمونهٔ اول با سطحِ تماسِ اشتباه
     رسم می‌شد. حالا لایهٔ ورودی، پس از آماده‌شدنِ فیلترِ فشار، همان نمونه
     را با مقدارِ درست دوباره قیمت‌گذاری می‌کند. هیچ تأخیری اضافه نمی‌شود
     چون این نمونه هنوز رسم نشده است.
     ------------------------------------------------------------------- */
  Resampler.prototype.repriceFirst = function (p) {
    if (this.pending && !this.pendingEmitted && typeof p === 'number' && isFinite(p)) {
      const v = clamp01(p);
      this.pending.p = v;
      this.pending.repriced = true;
      /* نقطهٔ خامِ متناظر در حلقه هم باید اصلاح شود، وگرنه درون‌یابیِ
         پاره‌خطِ اول (sp = lerp(p1.p, p2.p, u)) همچنان از مقدارِ غلط شروع
         می‌کند و چند نمونهٔ بعدی هم پهن‌تر می‌مانند (اندازه‌گیری‌شده:
         نمونهٔ دوم ۵٫۴۹px در برابر ۵٫۰۷px). این تابع فقط تا وقتی *تنها یک*
         نقطهٔ خام داریم صدا زده می‌شود، پس at(0) همان نقطهٔ pointerdown است. */
      if (this._count === 1) this._ring[0].p = v;
      return true;
    }
    return false;
  };

  /* ===================================================================
     ۸) حلقهٔ بافرِ ورودی (PHASE 13)
     -------------------------------------------------------------------
     رویدادهای pointer به‌جای رسمِ فوری، در یک حلقهٔ Float32Array نوشته
     می‌شوند و requestAnimationFrame آن‌ها را تخلیه می‌کند. هیچ شیئی در
     مسیرِ داغِ ورودی ساخته نمی‌شود.
        stride = 10 : [x, y, pressure, tiltX, tiltY, twist, t, flags,
                       pressureRaw, sourceCode]
     flags bit0 = فشارِ سخت‌افزاری معتبر، bit1 = tilt معتبر،
           bit2 = twist معتبر، bit3 = فشارِ این نمونه قابلِ اعتماد است،
           bit4 = فیلترِ فشار هنوز در پنجرهٔ آماده‌سازی است

     چرا pressureRaw و sourceCode هم در بافر می‌آیند؟
     ---------------------------------------------------------------
     چون رسم یک فریم *بعد* از دریافتِ رویداد انجام می‌شود، خواندنِ
     `normalizer.state` در لحظهٔ رسم مقدارِ *جدیدترین* رویداد را می‌دهد،
     نه مقدارِ همان نمونه‌ای که رسم می‌شود. لاگِ عیب‌یابیِ نسخهٔ قبلی
     همین اشتباه را داشت و به همین دلیل ریشهٔ مسئلهٔ ۱ را پنهان می‌کرد:
     کنارِ هم «pressureRaw=0.15» و «contactWidth=11.7px» گزارش می‌شد،
     یعنی داده‌ای که به‌هیچ‌وجه با هم به یک نمونه تعلق نداشتند.
     =================================================================== */
  const STRIDE = 10;
  const SRC_CODE = { '': 0, pointerdown: 1, pointerrawupdate: 2, pointermove: 3,
                     coalesced: 4, 'pointerdown:coalesced-rejected': 5,
                     'pointermove:coalesced-rejected': 6,
                     'pointerrawupdate:coalesced-rejected': 7, flush: 8 };
  const SRC_NAME = ['', 'pointerdown', 'pointerrawupdate', 'pointermove',
                    'coalesced', 'pointerdown:coalesced-rejected',
                    'pointermove:coalesced-rejected',
                    'pointerrawupdate:coalesced-rejected', 'flush'];
  function InputBuffer(capacity) {
    this.cap = capacity || 4096;
    this.buf = new Float32Array(this.cap * STRIDE);
    this.head = 0;   // ایندکسِ نوشتن
    this.tail = 0;   // ایندکسِ خواندن
    this.overflow = 0;
  }
  InputBuffer.prototype.clear = function () {
    this.head = this.tail = 0; this.overflow = 0;
  };
  InputBuffer.prototype.size = function () { return this.head - this.tail; };
  InputBuffer.prototype.push = function (x, y, p, tiltX, tiltY, twist, t, flags,
                                         pRaw, srcCode) {
    if (this.head - this.tail >= this.cap) {
      // سرریز: قدیمی‌ترین نمونه را رها کن (تأخیر بر دقت مقدم است)
      this.tail++;
      this.overflow++;
    }
    const i = (this.head % this.cap) * STRIDE;
    const b = this.buf;
    b[i] = x; b[i + 1] = y; b[i + 2] = p; b[i + 3] = tiltX;
    b[i + 4] = tiltY; b[i + 5] = twist; b[i + 6] = t; b[i + 7] = flags;
    b[i + 8] = pRaw === undefined ? 0 : pRaw;
    b[i + 9] = srcCode === undefined ? 0 : srcCode;
    this.head++;
  };
  // cb(x, y, p, tiltX, tiltY, twist, t, flags, pRaw, srcCode) — حداکثر max نمونه
  InputBuffer.prototype.drain = function (max, cb) {
    const b = this.buf;
    let n = 0;
    while (this.tail < this.head && n < max) {
      const i = (this.tail % this.cap) * STRIDE;
      cb(b[i], b[i + 1], b[i + 2], b[i + 3], b[i + 4], b[i + 5], b[i + 6],
         b[i + 7], b[i + 8], b[i + 9]);
      this.tail++; n++;
    }
    return n;
  };
  // فقط نگاه‌کردن به فشارِ کالیبره‌شده‌ی نمونهٔ i-ام از دمِ صف (بدون مصرف)
  InputBuffer.prototype.peekPressure = function (i) {
    const idx = this.tail + (i || 0);
    if (idx >= this.head) return null;
    return this.buf[(idx % this.cap) * STRIDE + 2];
  };

  /* ===================================================================
     ۹) صادرات
     =================================================================== */
  global.QalamEngine = {
    DEFAULTS,
    createConfig,
    PressurePipeline,
    Resampler,
    InputBuffer,
    Hull,
    ContactState,
    InkState,
    computeContact,
    computeInk,
    footprint,
    footprintFromProfile,
    resolveNibAngle,
    resolveHeelSign,
    // ابزار
    clamp, clamp01, lerp, angleDelta, DEG,
    FLAG_PRESSURE: 1,
    FLAG_TILT: 2,
    FLAG_TWIST: 4,
    FLAG_PTRUST: 8,
    FLAG_PPRIMING: 16,
    SRC_CODE, SRC_NAME,
    VERSION: '2.1.0',
  };
})(typeof window !== 'undefined' ? window : globalThis);
