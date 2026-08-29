# Intelligent Assist + Real Ballpoint — گزارش معماری و طراحی

این سند دو بخش دارد:

1. **معماریِ موجود** — آنچه پیش از این Feature در پروژه بود (اندازه‌گیری‌شده از خودِ کد، نه حدس).
2. **طراحیِ لایهٔ تازه** — که *روی* آن معماری می‌نشیند و هیچ‌چیزِ آن را بازنویسی نمی‌کند.

---

## بخش ۱ — معماریِ موجود

### ۱٫۱ فایل‌ها و مرزها

| فایل | نقش | سراسری |
|---|---|---|
| `index.html` | پنجرهٔ اصلی (Monitor 1): نوارِ ابزار + چهار بوم | — |
| `mirror.html` | پنجرهٔ آینه (Monitor 2): «داربستِ» نامرئیِ همان شناسه‌های کنترل + همان سه اسکریپت | `window.__QALAM_MIRROR = true` |
| `stylus.js` | لایهٔ انتزاعِ قلم نوری؛ تشخیصِ قابلیت، نرمال‌سازیِ [PE3]، کالیبراسیونِ فشار | `window.QalamStylus` |
| `qalam-engine.js` | موتورِ بدونِ DOM: فشار → سطحِ تماس → مرکب → چندضلعیِ نوک | `window.QalamEngine` |
| `app.js` | DOM، کاغذها، رندرر، سیم‌کشیِ رویداد، پروتکلِ آینه، پنلِ کالیبراسیون، صدور PNG | `window.__qalamTest` … |
| `server.js` | سرورِ ایستا روی `:8123` | — |
| `bench/*` | هارنس و تست‌های headless (Chrome CDP خام، بدونِ npm) | `window.QalamHarness` |

### ۱٫۲ لایه‌های بوم (Monitor 1)

```
#paper (touch-action:none)
├── #paperTex   z-index 1   بافتِ کاغذ  ← و **تصویرِ مرجع** (paperType='custom')
├── #ink        z-index 2   مرکبِ خشک
├── #wetInk     z-index 2   استروکِ جاری (در DOM بعد از #ink ⇒ روی آن)
└── #guide      z-index 3   پیش‌نمایشِ نوک / راهنما
```

`#wetInk` در `app.js` به‌صورتِ برنامه‌ای ساخته و بعد از `#ink` درج می‌شود.

### ۱٫۳ مسیرِ دادهٔ Stroke — از قلم تا پیکسل

```
pointerdown / pointerrawupdate / pointermove   (روی #paper)
        │
        ├─ enqueueWithCoalesced(e)
        │     └─ QalamStylus.validateCoalesced(parent, list)   ← قاعدهٔ یکپارچگی
        │        (اگر والد فشار دارد و هیچ فرزندی ندارد، فهرست دور ریخته می‌شود)
        ↓
   normalizer.normalize(ev, ctx) → StylusState
        │   • فشار: normalizeRawPressure → کالیبراسیون (min/max, deadzone,
        │     EMA, curveExponent) با پنجرهٔ آماده‌سازیِ «میانهٔ ۳ نمونهٔ نخست»
        │   • جهت‌گیری: tilt ⇄ spherical، بردارِ قلم، lean/leanDir
        │   • سه‌حالته: UNKNOWN / SUPPORTED / UNSUPPORTED  (۰ ≠ نداشتن)
        ↓
   inputBuf.push(x, y, p, lean, leanDir, twist, t, flags, pRaw, srcCode)
        │   حلقهٔ Float32Array، stride=10، ظرفیت 8192، بدونِ تخصیصِ حافظه
        ↓
   requestAnimationFrame → onFrame → flushInput → inputBuf.drain(maxSamplesPerFrame, consumeRaw)
        ↓
   resampler.feed(...)          ← qalam-engine.js
        │   • spacing = clamp(contactSpan × spacingFactor, minSpacing, maxSpacing)
        │   • درون‌یابیِ Catmull-Rom، carry کسری بینِ رویدادها
        │   • حالتِ PENDING_INPUT: نمونهٔ نخست نگه داشته می‌شود تا جهت/سرعتِ
        │     واقعی معلوم شود (ضدِ «مهرِ تمام‌پهنا در آغاز استروک»)
        ↓
   emitSample(x, y, pMapped, lean, leanDir, twist, t, dir, speed, dwell, arc, isFirst)
        │   • هموارسازیِ موقعیت (EMA، با ramp پس از نمونهٔ سوم)
        │   • QE.computeContact → ContactState  (uHeel/uToe/width/thickness/angle/…)
        │   • محدودگرِ نرخِ کاهشِ پهنا (maxWidthDropPerPx)
        │   • QE.computeInk → InkState  (reservoir/flow/deposition/pooling/spread/absorption)
        │   • makeRecord() → یک رکوردِ نمونه
        ↓
   renderSegment(prev, rec)
        │   نوکِ تخت: پوشِ محدبِ ۸ نقطه‌ایِ دو footprint (جمعِ مینکوفسکیِ تقریبی)
        │   نوکِ گرد: خطِ گردسر با lineWidth = cw
        │   پروفایلِ چگالی: هستهٔ مات + نوارهای لبه با destination-over
        ↓
   pointerup → endStroke()
        │   flushInput(true) → applyTailTaper(s) → strokes.push(s)
        │   pushHistory({type:'stroke', data:s}) → flushWet() روی #ink
        │   mirrorSend begin/rec/end
```

### ۱٫۴ شکلِ ذخیره‌سازیِ Stroke

**نه** Bézier، **نه** raster خالص، **نه** vector path.
یک **polyline نمونه‌برداری‌شده با هندسهٔ سطحِ تماس در هر نمونه** است که به رستر
پوش‌زده می‌شود. هر رکورد (`makeRecord`):

```
{ x, y,                       موقعیت (پیکسلِ منطقیِ #paper)
  r, t, pl, co,               میدان‌های سازگاریِ نسخه‌های قبل
  ang,                        زاویهٔ لبهٔ نوک (درجه)
  cw, ct,                     طول و ضخامتِ سطحِ تماس (px)
  nw, uh, ut, hs,             پروفایلِ تماس در مختصاتِ محلیِ نوک
  ap,                         پهنای دیده‌شده
  dens, inkAmt, inkSpread,    چگالی / نشست / پخشِ مرکب
  rough, lean, vel, dir,
  color, baseColor, nb,
  skip?, erased?, fade? }     پرچم‌های رندر (پاک‌کن و…)
```

`strokes` آرایه‌ای از این آرایه‌ها است، هرکدام با `bb` (کرانِ خود).
`history` آرایهٔ `{type:'stroke'|'erase', data}` — **هر استروک یک واحدِ Undo**.
صدور PNG (`exportPNG`) از همین رکوردها در مقیاسِ دلخواه *از نو رستریزه* می‌کند.

### ۱٫۵ فشار

* منبعِ واقعی: `PointerEvent.pressure` — و فقط آن.
* `pressureSupport()` سه‌حالته است. مشاهدهٔ *هر* مقدارِ غیرِ `{0, 0.5}` در حالتِ
  فعالِ دکمه اثباتِ وجودِ حسگر است (مستقل از `pointerType`).
* اگر UNSUPPORTED: `pressureIsFallback = true` و مقدارِ جانشین (سرعت‌محور)
  استفاده می‌شود — با پرچمِ صریح، هرگز به‌عنوان فشارِ واقعی.
* کالیبراسیون ماندگار در `localStorage['qalam.stylus.calibration.v1']`.

### ۱٫۶ آینه و دو مانیتور

* `MIRROR_CHANNEL = 'qalam-mirror-v1'` روی `BroadcastChannel` + `window.postMessage`
  (دو مسیر، با `seq` برای حذفِ تکرار).
* پیام‌ها: `begin{id,env}` · `rec{id,recs}` · `end{id}` · `sync{env,strokes}` ·
  `clear` · `hello`.
* `mirrorEnv()` فقط این‌ها را می‌فرستد: `W,H,opacity,nib,color` و زیرمجموعه‌ای از
  `cfg` که به *مرکب و هندسهٔ نوک* مربوط است.
  **هیچ فیلدی از تصویرِ مرجع، `paperType`، `customImage` یا `bgVeil` فرستاده نمی‌شود.**
* آینه *همان* `renderSegment` را اجرا می‌کند (کدِ دوم وجود ندارد) و کاغذِ خودش را
  روی `blank` می‌گذارد.

### ۱٫۷ تصویرِ مرجع در وضعِ موجود

«عکسِ دلخواه» = تصویرِ مرجع:

```
loadPaperImage(file) → decodeImageFile → customImage
      → measureImagePalette (median-cut) → applyImagePalette
      → setPaper('custom') → renderPaper()
```

`renderPaper()` آن را روی `#paperTex` با **cover** می‌کشد:

```
s  = max(W/iw, H/ih)
dw = iw·s ,  dh = ih·s
drawImage(img, (W−dw)/2, (H−dh)/2, dw, dh)
سپس پردهٔ محو: fillRect با rgba(baseColorRGB, bgVeil)
```

### ۱٫۸ مختصات

```
tablet/digitizer  →(مرورگر)→  clientX/clientY
       │  pos(e) = clientX − paperRect.left ,  clientY − paperRect.top
       ↓
Canvas Logical (CSS px از #paper)      ← همهٔ رکوردها در همین فضا هستند
       │  setTransform(dpr,0,0,dpr,0,0) ,  dpr = clamp(devicePixelRatio, 1, 2)
       ↓
Canvas Device px
```

آینه: رکوردها در همان *فضای منطقی* فرستاده می‌شوند و آینه با `dpr` خودش رسم
می‌کند. پس Scaling بینِ دو مانیتور امروز ۱:۱ منطقی است و هیچ فرضی بر یکسان‌بودنِ
رزولوشن وجود ندارد.

### ۱٫۹ Undo

`history` + `MAX_HISTORY`. دکمهٔ `#undo` آخرین عمل را برمی‌دارد و `redraw()`
می‌کند. الگو **History-Based با اکشن‌های typed** است، نه Command با undo/redo دوطرفه.

---

## بخش ۲ — طراحیِ لایهٔ تازه

### ۲٫۱ اصولِ حاکم

1. **هیچ بازنویسی.** لایهٔ تازه فقط در سه نقطهٔ مشخص به `app.js` قلاب می‌شود:
   `beginStroke` · `emitSample` · `endStroke` (و یک قلاب برای import تصویر).
2. **خاموش = رفتارِ قبل، بیت‌به‌بیت.** وقتی `intelligent_assist_enabled = false`
   و `real_ballpoint_enabled = false`، هیچ‌یک از قلاب‌ها مقداری را عوض نمی‌کند.
3. **خروجی از راهِ میدان‌های موجودِ رکورد.** پهنا/مرکب/جوهر همه در `cw, ct, uh,
   ut, dens, inkAmt, inkSpread` نوشته می‌شوند؛ پس رندرر، صدورِ PNG، پاک‌کن، Undo
   و **آینه** بی‌هیچ تغییری کار می‌کنند.
4. **تصویرِ مرجع هرگز به Monitor 2 نمی‌رود** — و این حالا با یک گاردِ صریح
   تضمین می‌شود، نه فقط با «اتفاقاً فرستاده نمی‌شود».

### ۲٫۲ فایل‌های تازه

| فایل | نقش | سراسری |
|---|---|---|
| `assist-engine.js` | بدونِ DOM: فیلترها، پروفایلِ پهنا، موتورِ فشار، تطبیقِ مسیر، بازسازی، فیزیکِ خودکار، کاغذ | `window.QalamAssist` |
| `reference-analyzer.js` | بدونِ DOM: Threshold → Skeleton → Distance Transform → Width Profile → Confidence + Cache | `window.QalamReference` |
| `assist-ui.js` | پنلِ «دستیارِ هوشمند»، HUD فشار، سنجه‌های Debug، ماندگاریِ تنظیمات | `window.QalamAssistUI` |
| `bench/assist-tests.html` | تست‌های واحدِ لایهٔ تازه (همان سبکِ `bench/tests.html`) | — |

### ۲٫۳ زنجیرهٔ پردازش

```
Pen Device
    ↓  (بی‌تغییر) stylus.js  → StylusState  → فشارِ واقعی، lean، twist
    ↓  (بی‌تغییر) InputBuffer → rAF → Resampler
    ↓
emitSample()
    │
    ├── ۱  Stabilizer          One Euro Filter روی (x,y) — حذفِ لرزشِ دست
    │
    ├── ۲  PathMatcher         نزدیک‌ترین نقطهٔ Centerline مرجع، با پیشرویِ
    │                          یکنواخت روی طولِ قوس (بدونِ وابستگی به تعدادِ نقاط)
    │
    ├── ۳  Path Correction     lerp(user, projected, assist × confidence)
    │
    ├── ۴  Width Decision      Pressure | Reference | Hybrid
    │                          → applyWidthScale(contact, targetWidth)
    │
    ├── ۵  Ballpoint Physics   ballContact, inkFlow, buildUp, gap, microVariation
    │                          → coverage/deposition + ریزنوسانِ پهنا
    │
    ├── ۶  Paper Interaction   absorption/roughness → inkSpread و پهنای حاشیه
    │
    └── ۷  Feedback            actual/target pressure و actual/target width → HUD
    ↓
makeRecord() → renderSegment()   (بی‌تغییر)
    ↓
endStroke() → finalize()  ← هموارسازیِ نهاییِ پروفایلِ پهنا + Taper خودکار
    ↓
strokes / history / mirrorSend        (بی‌تغییر)
    ↓
Monitor 1: Reference + Ink        Monitor 2: Final Ink ONLY
```

### ۲٫۴ تحلیلِ تصویرِ مرجع

```
customImage
   ↓  رسمِ روی یک بومِ تحلیل (سمتِ بلند ≤ analysisMaxSide، پیش‌فرض 1024)
Grayscale (Rec.601)
   ↓  برآوردِ زمینه از میانهٔ حاشیه‌ها  → تصمیمِ قطبیت (مرکب تیره یا روشن؟)
Contrast Normalization (کشِ صدکِ ۱ و ۹۹)
   ↓
Otsu Threshold  → Binary Mask
   ↓  Morphological open(3×3) سپس close(3×3)
Connected Components (BFS، ۸-همسایگی)  → حذفِ اجزای ریز
   ↓
Exact Euclidean Distance Transform (Felzenszwalb–Huttenlocher، O(n))
   ↓
Zhang–Suen Thinning → Skeleton
   ↓  گرافِ اسکلت → طولانی‌ترین مسیر در هر جزء → Centerline (polyline مرتب)
   ↓  هموارسازیِ Centerline + بازنمونه‌برداری بر طولِ قوس
Width Profile:  w(t) ≈ 2 × EDT(centerline(t))   با هموارسازیِ میانه+گاوسی
   ↓
Confidence = f(نسبتِ پرشدگی، تناسبِ اسکلت، پیوستگی، نسبتِ سیگنال به نویزِ آستانه)
   ↓
ReferenceAnalysis  (کش‌شده؛ اگر تصویر عوض نشود دوباره تحلیل نمی‌شود)
```

تحلیل **فقط هنگام import** انجام می‌شود و به قطعه‌های زمانی شکسته می‌شود
(`yield` بین مراحل) تا رشتهٔ UI بلاک نشود. در مسیرِ داغِ قلم هیچ کارِ CV نیست:
فقط جست‌وجوی شبکه‌ایِ نزدیک‌ترین نقطه، که O(1) میانگین است.

### ۲٫۵ نگاشتِ مختصات

تحلیل در فضای پیکسلِ *بومِ تحلیل* انجام می‌شود. تبدیل به فضای منطقیِ بوم
دقیقاً از همان فرمولِ `renderPaper()` می‌آید (هیچ عددی Hard-Code نیست):

```
s   = max(W/iw, H/ih)            iw,ih = ابعادِ تصویرِ اصلی
ox  = (W − iw·s)/2               oy = (H − ih·s)/2
k   = iw / aw                    aw = پهنای بومِ تحلیل

analysis(ax, ay) → canvas:   x = ox + ax·k·s ,  y = oy + ay·k·s
canvas(x, y) → analysis:     ax = (x − ox)/(k·s) , ay = (y − oy)/(k·s)
پهنا:                        wCanvas = wAnalysis · k · s
```

این تبدیل در هر `resize` بازساخته می‌شود؛ خودِ تحلیل بی‌اعتبار نمی‌شود.
DPI/Scaling سیستم روی `W,H` و `dpr` اثر دارد و هر دو از API خوانده می‌شوند.

### ۲٫۶ نگاشتِ فشار

```
Raw device pressure  (PointerEvent.pressure)
   ↓  stylus.js: clamp → normalize(minRaw..maxRaw) → deadzone → EMA → curveExponent
pMapped ∈ [0,1]                      ← «Actual Pressure»
   ↓  PressureEngine.widthOf(p)
width = wMin + (wMax − wMin) · p^γ    γ از پیش‌تنظیمِ Soft/Normal/Hard/Linear/Custom
   ↓  معکوسِ تحلیلی
PressureEngine.pressureFor(w) = ((w − wMin)/(wMax − wMin))^(1/γ)   ← «Target Pressure»
```

`wMin/wMax` از `cfg.nibWidth` و `minContactRatio` گرفته می‌شوند، نه از عددِ ثابت.
Target Pressure فقط **نمایشی/آموزشی** است؛ در Width Mode = Reference پهنای نهایی
از مرجع می‌آید و به فشارِ واقعی وابسته نیست (تستِ پذیرشِ ۳ و ۵).

### ۲٫۷ استخراجِ پهنای مرجع

برای هر نقطهٔ Centerline، `EDT` فاصله تا نزدیک‌ترین پیکسلِ غیرِمرکب را می‌دهد؛
پس `width ≈ 2·EDT`. پروفایل روی `t ∈ [0,1]` نرمال می‌شود (مستقل از رزولوشن)،
با فیلترِ میانهٔ ۵ و سپس گاوسیِ σ≈۲ هموار می‌شود، و در `WidthProfile` ذخیره
می‌شود:

```
{ ts: Float32Array,   // t نرمال‌شده
  ws: Float32Array,   // پهنا در فضای تحلیل
  sample(t) → پهنا با درون‌یابیِ خطی }
```

### ۲٫۸ یکپارچگیِ آینه

* `mirrorEnv()` هیچ فیلدِ تازه‌ای از assist نمی‌گیرد جز آن‌هایی که *در رکوردها
  دیده نمی‌شوند* و برای رسمِ یکسان لازم‌اند (هیچ‌کدام به مرجع مربوط نیست).
* گاردِ صریح: در حالتِ آینه (`window.__QALAM_MIRROR`)،
  `QalamAssistUI` خودش را غیرفعال می‌کند، لایهٔ Debug رسم نمی‌شود، و
  `setReference()` رد می‌شود.
* لایهٔ Reference و لایهٔ Debug هر دو روی `#paperTex` / `#guide` هستند و هیچ‌کدام
  در پروتکلِ آینه نیستند.

### ۲٫۹ کلیدهای تنظیمات (`localStorage['qalam.assist.v1']`)

```
intelligent_assist_enabled   assist_strength      smoothing_strength
width_mode                   pressure_enabled     pressure_curve
pressure_min                 pressure_max         show_pressure
show_target_pressure         show_target_width    style
assist_mode                  training_mode        debug_overlay
real_ballpoint_enabled       pen_preset           base_width
pressure_sensitivity         velocity_response    ink_flow
ink_density                  ink_build_up         ink_dryness
paper_type                   paper_roughness      paper_absorption
natural_variation            start_taper          end_taper
```

### ۲٫۱۰ چیزی که عمداً *پیاده نشده*

* **AI / Deep Learning** — طبق بخش ۸۰ و ۸۲ درخواست. جای آن در
  `QalamReference.registerAnalyzer()` باز است تا بعداً یک تحلیل‌گرِ AI بتواند
  همان قراردادِ `ReferenceAnalysis` را برگرداند.
* **Perspective کاغذ** — فقط Transform (scale/offset) پیاده شده؛ ساختارِ
  `refTransform` جای ماتریسِ کامل را دارد.
* **Stroke Order خودکار از تصویرِ پیچیده** — Multi-Stroke پشتیبانی می‌شود
  (چند Centerline و انتخابِ خودکار در pen-down) ولی ترتیبِ نوشتن استنتاج نمی‌شود.

---

## بخش ۳ — نتایجِ اندازه‌گیری‌شده

### ۳٫۱ تست‌ها

| مجموعه | تعداد | نتیجه | نکته |
|---|---|---|---|
| `bench/tests.html` (موجود، پیش از این Feature) | ۱۶۵ | ۱۶۵ ✅ | **لایهٔ دستیار را بارگذاری نمی‌کند** ⇒ رگرسیونِ «فایل‌ها نباشند» |
| `bench/assist-tests.html` (تازه) | ۱۴۹ | ۱۴۹ ✅ | رگرسیونِ «فایل‌ها باشند ولی خاموش» + واحد + پذیرش |
| `bench/assist-mirror.html` (تازه، دو پنجره‌ای) | ۳۵ | ۳۵ ✅ | Monitor 1/2 واقعی با iframe و خواندنِ پیکسل |
| **جمع** | **۳۴۹** | **۳۴۹ ✅** | همه روی `http://` یعنی در بسترِ امن |

اجرا:

```bash
node server.js &
node bench/run-headless.js "http://localhost:8123/bench/tests.html"         window.__testResult
node bench/run-headless.js "http://localhost:8123/bench/assist-tests.html"  window.__assistTestResult
node bench/run-headless.js "http://localhost:8123/bench/assist-mirror.html" window.__mirrorTestResult
```

### ۳٫۲ دو سطحِ رگرسیون (بخش ۵۲، ۵۳، ۶۳، ۸۵)

1. **فایل‌ها بارگذاری نشده‌اند** — `tests.html` فقط `stylus.js`، `qalam-engine.js` و
   `app.js` را می‌خواند. `AUI === null` و هر چهار قلاب حذف می‌شوند.
   نتیجه: ۱۶۵/۱۶۵.
2. **فایل‌ها بارگذاری شده‌اند ولی خاموش‌اند** — و مهم‌تر، **بیت‌به‌بیت**:
   همان ورودی دو بار پخش شد و هر ۸ میدانِ هندسی/مرکبِ هر ۲۴۶ رکورد یکی بود.

### ۳٫۳ سنجه‌های تستِ پذیرش

| تست | سنجه | نتیجه |
|---|---|---|
| ۱ — لرزشِ دست | دندانه‌داری (میانگین \|مشتقِ دوم\|) | ۰٫۶۲ → ۰٫۳۳ (۴۶٪ کاهش)، جابه‌جاییِ کل حفظ شد (dx=397) |
| ۳ — ضخامت از مرجع | `cw` با فشارِ **یکنواختِ ۰٫۵** | ۱۰٫۸ → ۴۷٫۵ → ۲۰٫۴ px (مرجع: ۴۹٫۶ px) |
| ۴ — فشار | ضخامتِ رستر در فشارِ ۰٫۲ و ۰٫۸ | ۵٫۰ → ۹٫۰ px |
| ۵ — Target Pressure | معکوسِ منحنی | خطای رفت‌وبرگشت ۱٫۱e-۱۶ |
| ۶ — Mirror + Reference | پیکسل‌های جوهردار روی دو مانیتور | ۵۹۹۳ = ۵۹۹۳ (نسبت ۱٫۰۰۰) |
| ۶ — مرجع روی Monitor 2 | تعدادِ رنگ‌های متمایزِ `#paperTex` | Monitor 1: ۹۴ · **Monitor 2: ۱** |
| ۷ — Mirror OFF | مرکبِ آینه پس از `clear` | بی‌تغییر (۵۹۹۳) |
| ۹ — سریع | بیشینهٔ گامِ نمونه در ۵۰۰Hz | ۱٫۰۶px (سقف ۳px)، ۰ سرریز |
| ۱۰ — آهسته | نسبتِ پهنای بدنه | ۱٫۲ (سقف ۲٫۴) |
| ۱۱ — Hover | استروکِ ساخته‌شده | ۰ |
| ۱۳ — مرجعِ خراب | Crash / Confidence | بی‌Crash · ۰٫۹۴۶ → ۰٫۹۲۴ |

اصلاحِ مسیر (تستِ پذیرشِ ۶): فاصلهٔ میانگین تا Centerline از **۵٫۸۱px به ۲٫۴۴px**
رسید — یعنی «حل مشکل ۲» با عدد.

### ۳٫۴ کارایی

| سنجه | نتیجه |
|---|---|
| p95 زمانِ پردازشِ ورودی، دستیار روشن، ۳۳۰Hz | **۱٫۱۰ ms** (بودجهٔ ۶۰FPS = ۱۶٫۷ms) |
| میانگین | ۰٫۳۷ ms |
| تطبیقِ مسیر، کلِ یک استروکِ ۶۰۰ نمونه‌ای | ۰٫۰۰ ms |
| بازسازی، کلِ استروک | ۱٫۷۰ ms |
| سرریزِ بافر / نمونهٔ گم‌شده | ۰ / ۰ |
| تحلیلِ مرجع (۴۰۰×۲۰۰) | ۴۸–۶۶ ms، **فقط هنگام import** |
| `bench/bench.html` (بی‌ارتباط با دستیار) | ۰٫۲۵–۰٫۵۴ ms کارِ هر فریم، ۰ سرریز |

### ۳٫۵ باگ‌های واقعیِ پیدا و رفع‌شده در این کار

هر مورد با اندازه‌گیری پیدا شد، نه با بازبینیِ چشمی؛ و هر کدام حالا یک آزمونِ
رگرسیون دارد.

1. **آستانهٔ Otsu مرکب را دور می‌ریخت.** با `gray < threshold` روی تصویرِ کاملاً
   دوسطحی، آستانه روی خودِ سطحِ تیره می‌افتاد و ماسک **صفر پیکسل** می‌شد
   (`thr=0`، `strokes=0`). قراردادِ درستِ Otsu ردهٔ تیره را `[0…thr]` می‌گیرد.
2. **ترتیبِ نقاطِ Centerline دلبخواه است.** اسکلت مسیر را از `x=357` به `x=41`
   داد، یعنی برعکسِ جهتِ رسم. محدودگرِ «پیشرویِ یکنواخت» هر گام را «رو به عقب»
   می‌دید و پوششِ تطبیق به ۰٫۰۱ می‌رسید. حالا جهت از حرکتِ *کاربر* استنتاج می‌شود.
3. **اسلایدرِ نرمی در ۹۰٪ مسیرش بی‌اثر بود.** نگاشتِ خطیِ فرکانسِ قطع
   (۱۲۰→۰٫۸Hz) در وسطِ اسلایدر همچنان ~۹۰Hz می‌داد: کاهشِ دندانه‌داری ۴٪ در
   برابر ۴۵٪ نگاشتِ هندسی.
4. **هموارسازی قلم را عقب می‌انداخت.** با `beta≈0` یک استروکِ ۱۲۰۰px/s **۱۳۳px**
   عقب می‌مانْد. با `beta = 0.035·s` به ۵px رسید و لرزشِ آهسته همچنان ۷۳٪ کم شد.
5. **مخزنِ نوکِ ساچمه تعادل نداشت.** چون تخلیه به موجودی وابسته نبود، `tipInk`
   حتی در نوشتنِ عادی به **۰٫۰۰۲** می‌چسبید (قلم همیشه کم‌جوهر). با دینامیکِ
   اشباع‌شونده: ۰٫۸۰ عادی · ۰٫۴۲ تند · ۰٫۱۶ خشکِ تند.
6. **شکافِ جوهر حالتِ غالب شده بود.** آستانهٔ `−(1 − risk·1.4)` با ریسکِ ۰٫۷۱
   *مثبت* می‌شد و چون ۴۷٪ نویز منفی است، **۳۵۹ از ۴۰۰** نمونه شکاف می‌شد. حالا
   آستانه بر پایهٔ صدکِ اندازه‌گیری‌شدهٔ توزیعِ نویز است: ۱۷/۴۰۰ برای قلمِ خشک، ۰ پیش‌فرض.
7. **Tolerance با یک جزءِ بی‌ربط باد می‌کرد.** شعاعِ جست‌وجو از پهنای *بزرگ‌ترین*
   جزءِ تصویر ساخته می‌شد؛ یک مستطیلِ ۸۰×۴۰ در گوشهٔ مرجع شعاع را به ۲۱۳px
   می‌رساند و استروکی ۱۹۰px دورتر هم به مرجع چسبانده می‌شد. شعاع اکنون *برای هر
   Stroke جدا* محاسبه می‌شود.
8. **`nibProfileAdjust` پیکربندیِ خودکار را پاک می‌کرد.** در `beginStroke` بعد از
   `syncConfig` صدا زده می‌شود و `minContactRatio` را از ۰٫۵۸ به ۰٫۰۹ برمی‌گرداند.
   ترتیبِ لایه‌ها اکنون همیشه `TUNE → tool → nib → assist` است.
9. **ظرفیتِ پهنای نوک در طولِ استروک پاک می‌شد.** `syncConfig` در یک استروکِ
   ۱۲۰ نمونه‌ای **۴۲ بار** صدا زده می‌شود (شنوندهٔ `input` روی همهٔ کنترل‌ها)، و هر
   بار `nibWidth` را از اسلایدرها بازمی‌ساخت. پس در `Width Mode = Reference`
   پهنای مرجع فقط در نمونهٔ اول اثر داشت. ظرفیت اکنون در خودِ `config()` دوباره
   اعمال می‌شود و در `endStroke` آزاد می‌شود.
10. **`bench/run-headless.js` روی `http://` بی‌صدا شکست می‌خورد.**
    `Runtime.evaluate` بی‌درنگ پس از `Page.navigate` فرستاده می‌شد و به بسترِ
    اجرای قبلی (`about:blank`) می‌چسبید؛ خروجی `undefined` بود بی‌هیچ پیامی. حالا
    منتظرِ `Page.loadEventFired` می‌مانَد، صفحهٔ خطای Chrome را تشخیص می‌دهد، و
    پروکسیِ سراسری را برای loopback کنار می‌گذارد. **این یک باگِ موجود در ابزارِ
    تست پروژه بود، نه در این Feature** — ولی بدونِ رفعش، تستِ دو مانیتوره
    (که به بسترِ امن نیاز دارد) قابلِ اجرا نبود.

11. **اعتبارِ فشار از رویدادِ اشتباه خوانده می‌شد.** `io.pressureValid` از
    `normalizer.state` می‌آمد، ولی آن همیشه به *جدیدترین رویداد* اشاره می‌کند
    در حالی که `emitSample` یک فریم بعد و روی یک نمونهٔ *بازنمونه‌شده* اجرا
    می‌شود. اندازه‌گیری‌شده: در میانهٔ استروکی با فشارِ ثابت، نمونه‌های ۱۵۰ و
    ۳۰۰ پرچمِ `valid=false` می‌گرفتند و HUD «فشارِ واقعی: ۰» نشان می‌داد در
    حالی که قلم روی کاغذ بود. حالا پرچم از خودِ `InputBuffer` می‌آید — همان
    تدبیری که پروژه پیش‌تر برای لاگِ عیب‌یابی‌اش به کار برده بود.
12. **Target Pressure نسبت به قلمِ اشتباه حساب می‌شد.** پس از کشیدنِ ظرفیتِ
    نوک برای جا‌دادنِ مرجع، بازهٔ پهنا هم عوض می‌شد و پهنای هدف دقیقاً روی کفِ
    بازه می‌افتاد ⇒ `Target Pressure = 0`. اکنون مبنا پهنای قلمی است که
    *کاربر* تنظیم کرده (`penNibWidth`)، که همان معنای «با قلمِ خودت چقدر فشار
    لازم است؟» را می‌دهد.
13. **فشارِ نمایش‌داده‌شده پس از برداشتنِ قلم نمی‌خوابید.** HUD آخرین مقدار
    (۳۸٪) را نگه می‌داشت، در حالی که قلم روی کاغذ نبود. طبق بخش ۴۷، اکنون
    «Actual Pressure» و «Actual Width» در `endStroke` صفر می‌شوند، ولی پهنای
    هدف و اعتمادِ مرجع می‌مانند چون به وضعیتِ قلم وابسته نیستند.

### ۳٫۷ دو نکته که *باگ نبودند* و عمداً دست‌نخورده ماندند

هر دو در جریانِ تست پیدا شدند و بررسی نشان داد رفتارِ موجود **درست** است:

1. **فشارِ دقیقِ ۰٫۵ به‌عنوان «بی‌حسِ فشار» تفسیر می‌شود.** آزمونِ اولِ من
   ۲۰۰ نمونه با فشارِ دقیقاً ۰٫۵ می‌فرستاد و انتظار داشت HUD فشارِ واقعی نشان
   دهد؛ ولی `stylus.js` طبق [PE3] §4.1 درست تشخیص داد که این امضای
   سخت‌افزارِ *بی‌حسِ فشار* است، به حالتِ جانشین رفت، و طبق بخش ۴۵ حق نداشت
   آن را «فشارِ واقعی» نشان دهد. **آزمون اصلاح شد، نه کد.**
2. **باریک‌شدنِ سر و دمِ استروک.** سنجشِ اولیه نسبتِ پهنای ۵٫۵ می‌داد و شبیهِ
   «ضخامتِ غیرطبیعی» بود؛ ولی همه‌اش از تیپرِ *خواسته‌شدهٔ* آغاز و دمِ قلمِ نی
   می‌آمد. آزمون اکنون بدنهٔ پایا (۵۰٪ میانی) را می‌سنجد و *وجودِ* تیپر را هم
   جداگانه تأیید می‌کند.

### ۳٫۶ فایل‌ها

**تازه:**

```
assist-engine.js            ۱۰۲۴ خط   ریاضیات، بدونِ DOM
reference-analyzer.js        ۷۶۲ خط   بینایی ماشین، بدونِ DOM
assist-ui.js                ۱۳۰۱ خط   ادغام + UI + HUD + Debug
bench/assist-tests.html     ۱۲۸۰ خط   ۱۴۹ آزمون
bench/assist-mirror.html     ۴۶۰ خط   ۳۵ آزمونِ دو پنجره‌ای
docs/INTELLIGENT_ASSIST.md            همین سند
```

**تغییر‌یافته:**

```
app.js            چهار قلاب + imageFit() + پُل + ابزارِ خودکار + گاردِ آینه
index.html        سه <script> + دکمهٔ «پنل دستیار» + دکمهٔ ابزارِ «خودکار»
mirror.html       دکمهٔ ابزار در داربست + یادداشتِ صریحِ «چرا assist بارگذاری نمی‌شود»
bench/harness.js  دو شناسهٔ تازه در داربستِ دکمه‌ها
bench/run-headless.js  رفعِ باگِ ناوبریِ http + تشخیصِ صفحهٔ خطا + کنارگذاشتنِ پروکسی
```

هیچ تابعِ موجودی حذف یا بازنویسی نشد. تنها تغییرِ رفتاریِ خارج از لایهٔ دستیار،
افزودنِ `if (AUI) AUI.config(cfg)` در انتهای `nibProfileAdjust` و `syncConfig`
است که با `AUI === null` بی‌اثر است.
