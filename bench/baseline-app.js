(() => {
  'use strict';

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
  const ctx = ink.getContext('2d', { desynchronized: true, alpha: true });
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
    },
  };

  /* =====================================================================
     ابزار ریاضی
     ===================================================================== */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
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
  // چگالی (تیرگی جوهر) از میزان فشار/عرض — کم‌فشار = جوهر رقیق‌تر/کمرنگ‌تر (محوِ طبیعیِ
  // قلمِ نی با کفِ دیده‌شونده)؛ پرفشار = جوهرِ سیر و تیره. فقط رقیق می‌شود، محوِ صفر نه.
  function densityFromWidth(pl) {
    return clamp(0.5 + 0.5 * pl, 0, 1);
  }
  function mixHex(a, b, t) { // t=0 → a | t=1 → b
    const ca = hexToRgb(a), cb = hexToRgb(b);
    const r = Math.max(0, Math.min(255, Math.round(lerp(ca[0], cb[0], t)))),
          g = Math.max(0, Math.min(255, Math.round(lerp(ca[1], cb[1], t)))),
          bl = Math.max(0, Math.min(255, Math.round(lerp(ca[2], cb[2], t))));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  /* =====================================================================
     رندر کاغذ (یک‌بار روی paperTex)
     ===================================================================== */
  let W = 1, H = 1, dpr = 1;
  let paperRect = null;
  let paperType = 'daftari';

  function renderPaper() {
    ptx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ptx.clearRect(0, 0, W, H);
    const P = PAPER_PRESETS[paperType];
    const seed = paperType === 'daftari' ? 42 : (paperType === 'gloss' ? 1337 : 9001);
    const rng = mulberry32(seed);
    const [br, bg, bb] = P.baseColorRGB;

    ptx.fillStyle = P.baseColor;
    ptx.fillRect(0, 0, W, H);

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

    // --- خطوط قالب قلم‌سازی (laid lines) ---
    if (P.laidLines.enabled) {
      const sp = P.laidLines.spacing * dpr;
      const startY = (rng() * sp) % sp;
      ptx.strokeStyle = `rgba(80,70,55,${P.laidLines.opacity})`;
      ptx.lineWidth = P.laidLines.width;
      ptx.lineCap = 'round';
      for (let y = startY; y < H * dpr; y += sp) {
        const wave = P.laidLines.waviness;
        ptx.beginPath();
        ptx.moveTo(0, y);
        for (let x = 0; x < W * dpr; x += 20) {
          ptx.lineTo(x, y + Math.sin(x * 0.01 + rng() * 0.5) * wave);
        }
        ptx.lineTo(W * dpr, y);
        ptx.stroke();
      }
    }

    // --- خطوط راهنمای مشق (متناسب با فارسی) ---
    // هر ردیف: خطِ زمینه (کرسی) + خط‌چینِ ارتفاعِ حروفِ بلند (ا/ل/ط/ک)
    // + خطِ نقطه‌چینِ فرود (ج/چ/گ/ن/ی). مبنای چیدمان زیر خط زمینه است.
    if (P.guideLines.enabled) {
      const gl = P.guideLines;
      const rowH = gl.spacing * dpr;
      const mT = gl.marginTop * dpr, mB = gl.marginBottom * dpr;
      const asc = gl.ascender || {};
      const dsc = gl.descender || {};
      for (let y0 = mT; y0 < H * dpr - mB; y0 += rowH) {
        // خط زمینه (کرسی) — جایی که نوکِ قلم می‌نشیند
        const yK = y0 + gl.baseOffset * dpr;
        ptx.strokeStyle = gl.lineColor;
        ptx.lineWidth = gl.lineWidth;
        ptx.setLineDash([]);
        ptx.beginPath(); ptx.moveTo(8 * dpr, yK); ptx.lineTo((W - 12) * dpr, yK); ptx.stroke();

        // خط‌چینِ ارتفاع حروفِ بلند: ا ، ل ، ط ، ظ ، ک
        if (asc.enabled) {
          ptx.strokeStyle = asc.color || 'rgba(140,130,110,0.14)';
          ptx.lineWidth = asc.width || gl.lineWidth;
          ptx.setLineDash((asc.dash || [6, 5]).map(v => v * dpr));
          const yA = yK - asc.height * dpr;
          ptx.beginPath(); ptx.moveTo(8 * dpr, yA); ptx.lineTo((W - 12) * dpr, yA); ptx.stroke();
          ptx.setLineDash([]);
        }

        // خطِ فرودِ حروفِ جهنده: ج ، چ ، گ ، ن ، ی (پایین‌تر از زمینه)
        if (dsc.enabled) {
          ptx.strokeStyle = dsc.color || 'rgba(150,140,120,0.2)';
          ptx.lineWidth = dsc.width || gl.lineWidth;
          ptx.setLineDash([2 * dpr, 4 * dpr]);
          const yD = yK + dsc.depth * dpr;
          ptx.beginPath(); ptx.moveTo(8 * dpr, yD); ptx.lineTo((W - 12) * dpr, yD); ptx.stroke();
          ptx.setLineDash([]);
        }
      }
    }

    // --- براقیت کاغذ گلاسه ---
    if (P.sheen > 0) {
      const g = ptx.createLinearGradient(0, 0, W * 0.6 * dpr, H * 0.5 * dpr);
      g.addColorStop(0, `rgba(255,255,255,${0.18 * P.sheen})`);
      g.addColorStop(0.4, `rgba(255,255,255,${0.04 * P.sheen})`);
      g.addColorStop(1, `rgba(140,130,110,${0.03 * P.sheen})`);
      ptx.fillStyle = g;
      ptx.fillRect(0, 0, W, H);

      const g2 = ptx.createLinearGradient(0, H * 0.85 * dpr, 0, H * dpr);
      g2.addColorStop(0, 'rgba(255,255,255,0)');
      g2.addColorStop(1, `rgba(255,255,255,${0.12 * P.sheen})`);
      ptx.fillStyle = g2;
      ptx.fillRect(0, 0, W, H);
    }

    // --- وینیت ملایم ---
    if (P.vignette.outer > 0) {
      const vg = ptx.createRadialGradient(
        W / 2 * dpr, H / 2 * dpr, Math.min(W, H) * 0.3 * dpr,
        W / 2 * dpr, H / 2 * dpr, Math.max(W, H) * 0.7 * dpr
      );
      vg.addColorStop(0, `rgba(0,0,0,${P.vignette.inner})`);
      vg.addColorStop(1, `rgba(60,45,25,${P.vignette.outer})`);
      ptx.fillStyle = vg;
      ptx.fillRect(0, 0, W, H);
    }
  }

  function resize() {
    const r = paper.getBoundingClientRect();
    paperRect = r;
    W = r.width; H = r.height;
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    for (const c of [paperTex, ink, guide]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ptx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderPaper();
    redraw();
  }
  new ResizeObserver(resize).observe(paper);

  /* =====================================================================
     حالت نوشتن
     ===================================================================== */
  let drawing = false, pointerId = null, downStamp = 0;
  let last = null, smoothPoint = null, lastRaw = null, lastStep = 0, lastTime = 0;
  let moveVel = 0, warmup = 0, lastPress = 0.5;
  let strokes = [], currentStroke = [], history = [];
  let lightPen = false;
  let erasing = false, lastErase = null, removedStack = [];
  // دکمه‌ی کنارِ قلم (XP-Pen) — نگه‌داشتنش زاویه‌ی نوک را عمودی می‌کند
  let barrelMode = true, barrelHeld = false;
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
  }
  document.querySelectorAll('input,select').forEach(e => e.addEventListener('input', ui));
  ui();

  /* =====================================================================
     زاویه‌ی نوک قلم
     ===================================================================== */
  function motionAngle(p) {
    if (!last) return Number(angleEl.value);
    const dx = p.x - last.x, dy = p.y - last.y;
    if (Math.hypot(dx, dy) < 1.2) return Number(angleEl.value);
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }

  function getAngle(e, p) {
    // دکمه‌ی قلم نگه‌داشته شد → هر زاویه‌ای که بود، نوک عمودی می‌شود (90°)
    if (barrelMode && barrelHeld) return 90;
    const manual = Number(angleEl.value);
    if (typeof e.twist === 'number' && e.twist !== 0) {
      return (e.twist + manual + 360) % 180;
    }
    if ($('dynamicMode').classList.contains('active') &&
        e.pointerType === 'pen' && typeof e.azimuthAngle === 'number' &&
        Number.isFinite(e.azimuthAngle)) {
      const az = e.azimuthAngle * 180 / Math.PI;
      return (90 - az + manual + 360) % 180;
    }
    if ($('motionMode').classList.contains('active')) {
      return (motionAngle(p) + manual + 360) % 180;
    }
    return manual;
  }

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

  // نسبتِ پهنای فعلیِ نوک به پهنای کامل (0..1) — از ضخامتِ خط گرفته می‌شود
  // تا با کم‌شدن فشار، هم ضخامت و هم پهنای کل قلم کم‌شود
  function penScale(t) {
    return clamp((t - 0.06) / (maxThickness() - 0.06), 0, 1);
  }

  // فشار مؤثر واقعی — برای قلم لامسی/دیجیتال فشارِ واقعی پوینتر؛
  // برای ماوس (که همیشه 0.5 است) فشارِ شبیه‌سازی‌شده با سرعت حرکت
  function effectivePressure(e) {
    if (e.pointerType === 'pen' || e.pointerType === 'touch') {
      if (typeof e.pressure === 'number') {
        // در بالاآوردنِ قلم (e.g. انتهای پرتاب) سخت‌افزار 0 می‌فرستد.
        // در اولین تماس، 0 ممکن است نویزِ شروع باشد — اما اگر کاربر با کمترین فشار
        // شروع کند، باید نوکِ تیزِ باریک شود نه مهرِ پهنِ کل قلم؛ پس فقط یک فشارِ
        // خیلی کم جایگزین می‌شود تا شروع همیشه نوکِ نقطه‌ای باشد.
        if (e.pressure <= 0) return currentStroke.length === 0 ? 0.06 : 0.02;
        return e.pressure;
      }
      return 0.5;
    }
    // ماوس: حرکت آهسته = فشار بیشتر (کلفت)، حرکت سریع = فشار کم (نازک)
    const vn = clamp(moveVel / 14, 0, 1);
    return clamp(1 - vn * 0.9, 0.05, 1);
  }

  // t = نصف ضخامت خط (پیکسل): از یک خطِ مو تا تقریباً نصف پهنای چلبی
  function thicknessFactor(e) {
    const sens = clamp(Number(pressureEl.value), 0.1, 2);
    const p = clamp(effectivePressure(e), 0, 1);
    // منحنی فشارِ تقریباً خطی (متناسب با فشار)؛ حساسیتِ بیشتر = شیبِ تندتر
    const curve = Math.pow(p, clamp(1.15 - sens * 0.25, 0.5, 1.4));
    const maxT = maxThickness();
    const pressureT = lerp(0.07, maxT, curve);

    // ضخامتِ تابعِ سرعت: «سرعت عادی نوشتن» آستانه‌ی صفرِ نازک‌شدن است — زیرِ آن،
    // ضخامت فقط از فشار می‌آید (خطِ عادیِ نوشتن). بالاترِ آن، خط زودتر از قبل
    // نازک می‌شود. یکای moveVel: پیکسل در فریمِ ~16.7ms
    // (سرعتِ عادیِ نوشتن ≈ 120–180px/s ≈ 2–3px/فریم).
    const NORMAL_SPEED = 2.5, FAST_SPEED = 24;
    let vScale = clamp((moveVel - NORMAL_SPEED) / (FAST_SPEED - NORMAL_SPEED), 0, 1);

    // «سرعتِ بالاتر از عادی + فشارِ کم» → نازک‌شدن حتی زودتر آغاز می‌شود:
    // هرچه فشار کمتر، همین‌ سرعتِ کم‌تر هم کم‌کم خط را باریک می‌کند.
    const pLow = clamp((0.5 - p) / 0.4, 0, 1);
    vScale = clamp(vScale + vScale * pLow * 0.8, 0, 1);

    return clamp(lerp(pressureT, 0.06, vScale * 0.97), 0.06, maxT);
  }

  /* =====================================================================
     هندسه‌ی نوک تخت (چلبی)
     هر نقطه: a = نصف پهنای چلبی (متناسب با فشار)، b = نصف ضخامت (از فشار)
     ===================================================================== */
  function nibCorners(p) {
    // فشارِ کم → کلِ نوک باریک‌تر؛ فشارِ کامل → پهنای کاملِ چلبی
    const pl = clamp(p.pl ?? 1, 0.01, 1);
    // اسلایدر «ضخامت تیغه» کلِ نوک (هم طول و هم تیغه) را مقیاس می‌کند تا
    // موقع نوشتن، کلفتیِ خط واقعاً تغییر کند.
    const thick = nibThickMult();
    // مقیاسِ نرم‌تر: اسلایدر 1→1x، تا 8→حدود 4.5x
    const thickScale = 1 + (thick - 1) * 0.5;
    const a = p.r * nibRatio() * 0.5 * pl * thickScale;
    const b = p.t * clamp(thick, 0.35, 2.2);
    const ang = p.ang * Math.PI / 180;
    const c = Math.cos(ang), s = Math.sin(ang);
    const x = p.x, y = p.y;
    return [
      { x: x + a * c - b * s, y: y + a * s + b * c },
      { x: x - a * c - b * s, y: y - a * s + b * c },
      { x: x - a * c + b * s, y: y - a * s - b * c },
      { x: x + a * c + b * s, y: y + a * s - b * c },
    ];
  }

  // پر کردنِ نوار (ribbon) بین دو نوک تخت — یک مسیرِ واحد با قانونِ nonzero
  // (پوسته‌ی محدبِ ۸ گوشه‌ی دو مهرِ نوک) تا در هر فاصله/زاویه‌ای — حتی عمود بر
  // جهتِ حرکت — هیچ شکافی بر جا نمانَد و آلفا هم یکنواخت بماند.
  function convexHull2(pts) {
    const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const lo = [], up = [];
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    for (const q of p) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
      up.push(q);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  function fillRibbon(c0, c1) {
    const hull = convexHull2(c0.concat(c1));
    ctx.beginPath();
    ctx.moveTo(hull[0].x, hull[0].y);
    for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
    ctx.closePath();
    ctx.fill();
    // کلاهکِ گرد در دو سرِ هر مهرِ نوک — تا خط، مربعی/تخت به‌نظر نرسد
    roundCaps(c0);
    roundCaps(c1);
  }

  // دو دایره در لبه‌های کوتاهِ (ضخامتِ) مهرِ نوک: سرِ خط گرد می‌شود
  function roundCaps(c) {
    const d0x = c[0].x - c[3].x, d0y = c[0].y - c[3].y;
    const r0 = Math.max(0.4, Math.hypot(d0x, d0y) * 0.5);
    ctx.beginPath();
    ctx.arc(c[0].x - d0x * 0.5, c[0].y - d0y * 0.5, r0, 0, Math.PI * 2);
    ctx.fill();
    const d1x = c[1].x - c[2].x, d1y = c[1].y - c[2].y;
    const r1 = Math.max(0.4, Math.hypot(d1x, d1y) * 0.5);
    ctx.beginPath();
    ctx.arc(c[1].x - d1x * 0.5, c[1].y - d1y * 0.5, r1, 0, Math.PI * 2);
    ctx.fill();
  }

  /* =====================================================================
     رنگ مرکب و تعامل با کاغذ
     ===================================================================== */
  function inkColor() { return colorEl.value; }

  function getInkColor(base, density, isEdge) {
    const P = PAPER_PRESETS[paperType];
    // روی کاغذهای جاذب: جوهرِ نازک/کم‌فشار به سمت رنگ کاغذ می‌رود (قهوه‌ایِ روشنِ مرکبِ سنتی)
    // روی گلاسه: به‌سوی سفیدِ خنثی (جوهرِ رقیقِ نشسته روی سطح صیقلی)
    const target = P.inkMixColor || [252, 252, 248];
    // هرچه فشار/چگالی کم‌تر → جوهر رقیق‌تر و روشن‌تر؛ فشار زیاد → تقریباً رنگ پایه (مشکیِ گرم)
    const mixAmount = isEdge
      ? lerp(0.88, 0.06, clamp(density, 0, 1))
      : lerp(0.78, 0.12, clamp(density, 0, 1));
    return mixHex(base, rgbToHex(target), clamp(mixAmount, 0, 1));
  }
  // شاخصِ شفافیتِ مرکب هر پاره‌خط: فشار زیاد → پُررنگ؛ ضعیف → نیمه‌شفاف (جوهرِ کم)
  function densAlpha(density) {
    return inkAlpha() * clamp(0.25 + 0.75 * density, 0, 1);
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
     رسمِ یک نقطه + قطعه
     ===================================================================== */
  function drawPoint(e) {
    const p = pos(e);
    if (e.pointerType === 'pen' && typeof e.pressure === 'number') lastPress = e.pressure;
    // نگه‌داشتنِ بی‌حرکتِ قلم: تکرارِ رسم نکن تا رنگ پخش نشود
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return;

    const target = {
      x: p.x,
      y: p.y,
      r: penSize(),
      t: thicknessFactor(e),
      ang: getAngle(e, p),
      color: inkColor(),
      nb: nibEl.value,
    };

    // پهنای نسبیِ قلم از روِ ضخامتِ فعلی (پرفشار = کلِ پهنا، کم‌فشار = باریک)
    target.pl = penScale(target.t);
    // چگالی (تیرگی) جوهر — جدا از هندسه: کم‌فشار = خطِ باریکِ تیره، نه خطِ محو
    target.dens = densityFromWidth(target.pl);

    // هموارسازی تطبیقی
    const s = Number(smoothEl.value);
    // سرعتِ بزرگ (فقط پرتابِ تندِ واقعی) نرمی را کم می‌کند؛
    // در حرکتِ معمولی، اسلایدرِ «نرمی» کاملاً اثر می‌کند.
    const vel01 = clamp(lastStep / 12, 0, 1);
    let sPos = clamp(s * 0.9 * (1 - vel01 * 0.5), 0, 0.9);
    if (warmup < 8) { warmup++; sPos = 0; }
    else if (warmup < 13) { warmup++; sPos *= (warmup - 7) / 5; }

    const q = smoothPoint
      ? {
          x: lerp(target.x, smoothPoint.x, sPos),
          y: lerp(target.y, smoothPoint.y, sPos),
          r: lerp(target.r, smoothPoint.r, warmup > 8 ? 0.15 : 0),
          t: lerp(target.t, smoothPoint.t, 0.15),
          ang: target.ang,
          pl: target.pl,
          dens: target.dens,
          color: target.color,
          nb: target.nb,
        }
      : target;

    if (last) drawSegment(last, q);
    else {
      currentStroke.push({ ...q });
      // همین لحظه که قلم روی صفحه نشست، خطِ نوک را بکش (حتی قبل از هیچ حرکتی)
      if (q.nb !== 'round') {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        nibLineMark(q, clamp(q.pl ?? 1, 0.02, 1));
        ctx.restore();
      }
    }

    last = q;
    smoothPoint = q;

    // نشانگرِ زنده‌ی زاویهٔ نوک روی برگه (حین نوشتن دیده می‌شود)
    gtx.clearRect(0, 0, W, H);
    if (q.nb !== 'round') nibAngleIndicator(q);

    const nowUI = Date.now();
    if (nowUI - lastUiPaint > 60) {
      lastUiPaint = nowUI;
      const wPct = Math.round(penScale(target.t) * 100);
      hud.textContent =
        `press: ${effectivePressure(e).toFixed(2)} | w: ${wPct}% | thick: ${target.t.toFixed(1)}px | ` +
        `speed: ${moveVel.toFixed(1)} | twist: ${typeof e.twist === 'number' ? e.twist : 0}°` +
        (barrelMode && barrelHeld ? ' | ⬍ عمودی' : '');
    }
  }

  function drawSegment(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return;

    const color = b.color || inkColor();
    const nb = b.nb || nibEl.value;
    const P = PAPER_PRESETS[paperType];
    const absorb = P.absorption;
    const isGlossy = paperType === 'gloss';

    // --- نوک گرد: ضربه‌ی خط ضخیم ---
    if (nb === 'round') {
      const r = (a.r + b.r) * 0.25 + (a.t + b.t) * 0.5;
      if (r <= 0.02) return;
      const densC = pointDensity(b);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.globalAlpha = densAlpha(densC);
      if (lightPen) { ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = r * 2; ctx.shadowColor = color; ctx.shadowBlur = r * 2.5; }
      ctx.strokeStyle = getInkColor(color, densC, false);
      ctx.lineWidth = r * 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.shadowBlur = 0;
      if (isGlossy) {
        ctx.globalAlpha = densAlpha(densC) * 0.25;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = Math.max(0.6, r * 0.9);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
      currentStroke.push({ ...b });
      return;
    }

    // --- نوک تخت / تیز: نوار چلبی ---
    const c0 = nibCorners(a);
    const c1 = nibCorners(b);

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const densF = segDensity(a, b);
    const centerColor = getInkColor(color, densF, false);
    const edgeColor = getInkColor(color, densF, true);

    // حرکتِ خیلی کوچک: همان مهرِ نوک را رسم کن (طوری که با بازرسمِ پایان یکسان باشد)
    if (dist < 2) {
      nibLineMark(b, densF, centerColor);
      ctx.restore();
      const er0 = { ...b };
      if (nb === 'sharp' && lastPress < 0.25) {
        er0.t = er0.t * 0.4;
        if (er0.pl != null) er0.pl = Math.max(0.02, er0.pl * 0.4);
      }
      currentStroke.push(er0);
      return;
    }

    if (lightPen) {
      // هاله‌ی نور
      glowSeg(a, b);
    }

    // لبه‌ی پر و بال (کاغذ جاذب) — یک خطِ پهن و کم‌رنگ دورِ نوار
    if (nb === 'flat' && absorb.feathering > 0.1 && !lightPen) {
      ctx.globalAlpha = densAlpha(densF) * absorb.feathering * 0.5;
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = Math.max(0.5, (b.t + a.t) * 0.5 * nibRatio() * 0.5);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // بدنه‌ی اصلی نوار
    ctx.globalAlpha = densAlpha(densF);
    ctx.fillStyle = centerColor;
    fillRibbon(c0, c1);

    // روی کاغذ گلاسه: هایلایتِ مرکزیِ روشن (نورِ بازتاب از سطح)
    if (isGlossy && (a.t + b.t) * 0.5 > 1.2) {
      ctx.globalAlpha = densAlpha(densF) * 0.18;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(0.5, (a.t + b.t) * 0.5 * 0.8);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    ctx.restore();

    // رکورد برای بازترسیم
    const rec = { ...b };
    // تیز کردن نوک: اگر نوک تیز است و فشار کم شده، ضخامت و پهنا را کم‌تر نگه می‌داریم
    if (nb === 'sharp' && lastPress < 0.25) {
      rec.t = rec.t * 0.4;
      if (rec.pl != null) rec.pl = Math.max(0.02, rec.pl * 0.4);
    }
    currentStroke.push(rec);
  }

  /* =====================================================================
     تیپرشدن انتهای حرف (برش صاف)
     ===================================================================== */
  // دمِ هر خط (برش/بُرِشِ نرم): با کم‌شدن فشار، از خط به نوکِ تیزِ نقطه‌ای می‌رسد
  // همیشه موقع برداشتنِ قلم اجرا می‌شود تا پایانِ د-ر-و-ن هم‌واره نوکِ تیز شود.
  function applyTailTaper(stroke) {
    const n = stroke.length;
    if (n < 4) return;
    // پرتابِ تند → دمِ بلندتر و نازک‌تر؛ لیفتِ آرام → یک نوکِ کوتاه ولی تیز
    const tailPx = clamp(moveVel * 2.6 + 16, 24, 90);
    let startI = 0, acc = 0;
    for (let i = n - 1; i > 0; i--) {
      acc += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
      if (acc >= tailPx) { startI = i; break; }
      if (i === 1) startI = 0;
    }
    if (n - 1 - startI < 3) startI = Math.max(0, n - 5);
    // منحنیِ کسینوسی: ابتدا نرم، انتها به‌نقطه‌یِ تیز میل می‌کند — مانند قلم نیِ واقعی.
    // کفِ قابلِ‌دیدن نگه می‌داریم تا نوکِ تیزِ واضحِ دیدنی باقی بماند، نه محوِ
    // ساب‌پیکسلیِ نامرئی.
    for (let j = startI; j < n; j++) {
      const t = (j - startI) / (n - 1 - startI);
      const ease = Math.pow(Math.cos(t * Math.PI / 2), 0.9);
      // میانه→ابتدا نرم؛ پایان→تند و نقطه‌ای (نسبتِ مستقیم با کم‌شدنِ فشار)
      stroke[j].t = Math.max(0.5, stroke[j].t * ease);
      if (stroke[j].pl != null) stroke[j].pl = Math.max(0.22, stroke[j].pl * ease);
    }
  }

  function strokeBounds(s) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const st of s) {
      if (st.skip || st.erased) continue;
      const rr = st.r + st.t + 2;
      if (st.x - rr < x1) x1 = st.x - rr;
      if (st.y - rr < y1) y1 = st.y - rr;
      if (st.x + rr > x2) x2 = st.x + rr;
      if (st.y + rr > y2) y2 = st.y + rr;
    }
    if (x2 < x1) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function endStroke(e) {
    if (!drawing || e.pointerId !== pointerId) return;
    if (e.timeStamp < downStamp) return;
    drawing = false;
    const s = currentStroke;
    currentStroke = [];

    const flatEnd = autoReturnEl.checked;
    if (s.length >= 4) {
      const bb = strokeBounds(s);
      if (bb) s.bb = bb;
      if (!flatEnd) applyTailTaper(s);
      strokes.push(s);
      history.push({ type: 'stroke', data: s });
      taperRedraw(bb, s);
    } else if (s.length) {
      const bb = strokeBounds(s);
      if (bb) s.bb = bb;
      strokes.push(s);
      history.push({ type: 'stroke', data: s });
      // یک نقطه‌ی تنها (فقط گذاشتنِ قلم روی صفحه) — همین‌حالا خط/نوک را رسم کن
      if (s.length === 1) drawNibDot(s[0]);
    }

    last = null; smoothPoint = null; moveVel = 0; lastPress = 0.5; lastRaw = null; lastStep = 0; lastTime = 0;
    barrelHeld = false;
    gtx.clearRect(0, 0, W, H);
    status.textContent = 'آماده برای نوشتن';
  }

  /* =====================================================================
     بازترسیم
     ===================================================================== */
  function redraw() {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.shadowBlur = 0;
    for (const stroke of strokes) drawStrokePath(stroke);
    drawStrokePath(currentStroke);
    ctx.restore();
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

  // نسخه‌ی رکوردیِ drawSegment (بدون تأثیر روی currentStroke)
  function drawSegmentRec(a, b) {
    const color = b.color || inkColor();
    const nb = b.nb || nibEl.value;
    const P = PAPER_PRESETS[paperType];
    const isGlossy = paperType === 'gloss';

    if (nb === 'round') {
      const r = (a.r + b.r) * 0.25 + (a.t + b.t) * 0.5;
      if (r <= 0.02) return;
      const densC = pointDensity(b);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.globalAlpha = densAlpha(densC);
      if (lightPen) { ctx.globalAlpha = 1; ctx.shadowColor = color; ctx.shadowBlur = r * 2.5; }
      ctx.strokeStyle = getInkColor(color, densC, false);
      ctx.lineWidth = r * 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.shadowBlur = 0;
      if (isGlossy) {
        ctx.globalAlpha = densAlpha(densC) * 0.25;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = Math.max(0.6, r * 0.9);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // بازترسیمِ پاره‌خطِ خیلی کوتاه: خط بکش، نه مستطیل
    if (Math.hypot(b.x - a.x, b.y - a.y) < 2 && nb !== 'round') {
      nibLineMark(b, segDensity(a, b));
      ctx.restore();
      return;
    }
    if (lightPen) glowSeg(a, b);
    ctx.globalAlpha = densAlpha(segDensity(a, b));
    ctx.fillStyle = getInkColor(color, segDensity(a, b), false);
    fillRibbon(nibCorners(a), nibCorners(b));
    if (isGlossy && (a.t + b.t) * 0.5 > 1.2) {
      ctx.globalAlpha = densAlpha(segDensity(a, b)) * 0.18;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(0.5, (a.t + b.t) * 0.5 * 0.8);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  // خطِ نوک (برای نقطه/نگه‌داشتنِ قلم): نه مستطیلِ توپر —
  // همان‌طور که قلم نی یک خط بر جای می‌گذارد.
  function nibLineMark(st, dens) {
    const ang = st.ang * Math.PI / 180;
    const pl = clamp(st.pl ?? 1, 0.01, 1);
    const thickScale = 1 + (nibThickMult() - 1) * 0.5;
    const a = st.r * nibRatio() * 0.5 * pl * thickScale;
    const b = Math.max(0.6, st.t);
    const c = Math.cos(ang), s = Math.sin(ang);
    const x = st.x, y = st.y;
    const inkDens = pointDensity(st);
    ctx.strokeStyle = getInkColor(st.color || inkColor(), inkDens, false);
    ctx.globalAlpha = densAlpha(dens ?? inkDens);
    ctx.lineWidth = b;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - a * c, y - a * s);
    ctx.lineTo(x + a * c, y + a * s);
    ctx.stroke();
  }

  // نقطه‌ی تنها: به‌جای مستطیل، یک خطِ کوتاه در امتدادِ زاویه‌ی نوک
  function drawNibDot(st) {
    if (st.skip || st.erased) return;
    const nb = st.nb || nibEl.value;
    const densP = clamp(st.pl ?? 1, 0.02, 1);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = densAlpha(densP);
    if (nb === 'round') {
      const r = st.r * 0.5 + st.t;
      ctx.fillStyle = getInkColor(st.color || inkColor(), densP, false);
      ctx.beginPath(); ctx.arc(st.x, st.y, Math.max(0.5, r), 0, Math.PI * 2); ctx.fill();
    } else {
      nibLineMark(st, densP);
    }
    ctx.restore();
  }

  // بازترسیمِ فقطِ ناحیه‌ی دم (تیپر) — برای سرعت بعد از برداشتن قلم
  function taperRedraw(bb, s) {
    if (!bb) return;
    const pad = 1;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fillRect(bb.x - pad, bb.y - pad, bb.w + 2 * pad, bb.h + 2 * pad);
    ctx.restore();

    // استروک‌های هم‌پوشانِ این ناحیه را دوباره بکش
    for (const other of strokes) {
      if (other === s) continue;
      const ob = other.bb;
      if (ob && (ob.x > bb.x + bb.w + pad || ob.x + ob.w < bb.x - pad ||
                 ob.y > bb.y + bb.h + pad || ob.y + ob.h < bb.y - pad)) continue;
      let prev = null;
      for (const st of other) {
        if (st.skip || st.erased) { prev = null; continue; }
        if (prev) drawSegmentRec(prev, st);
        prev = st;
      }
    }
    // خودِ استروکِ دم‌تیپرشده
    let prev = null;
    for (const st of s) {
      if (st.skip || st.erased) { prev = null; continue; }
      if (prev) drawSegmentRec(prev, st);
      else drawNibDot(st);
      prev = st;
    }
  }

  /* =====================================================================
     پاک‌کن
     ===================================================================== */
  function eraseNear(x, y, arr, out) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const st = arr[i];
      if (st.erased) continue;
      if (Math.hypot(st.x - x, st.y - y) <= ERASER_R + st.t * 0.5) {
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
    if (e && e.timeStamp < downStamp) return;
    drawing = false;
    if (removedStack.length) history.push({ type: 'erase', stamps: removedStack });
    removedStack = []; lastErase = null; lastRaw = null; lastStep = 0; lastTime = 0;
    gtx.clearRect(0, 0, W, H);
    status.textContent = 'پاک‌کن فعال — روی خط بکشید تا محو شود';
  }

  /* =====================================================================
     رویدادهای قلم
     ===================================================================== */
  function handleMoveEv(ev) {
    // وضعیت دکمه‌ی کنارِ قلم را به‌روز نگه‌دار (برداشتنِ دکمه حتی بدون pointerup)
    if (ev.pointerType === 'pen') {
      barrelHeld = (ev.buttons & (2 | 8 | 16)) !== 0;
      // اگر کانسلِ دکمه نوشتن را قطع کرده ولی نوک قلم هنوز روی صفحه است → ادامه بده
      if (!drawing && !erasing && (ev.buttons & 33)) {
        drawing = true; pointerId = ev.pointerId;
        downStamp = ev.timeStamp || 0;
        lastRaw = null; lastStep = 0; lastTime = 0;
        last = null; smoothPoint = null; currentStroke = [];
        moveVel = 0; lastPress = 0.5; warmup = 0;
        gtx.clearRect(0, 0, W, H);
        try { paper.setPointerCapture(ev.pointerId); } catch (_) {}
      }
      if (erasing) { eraseMove(ev); return; }
    } else if (erasing) { eraseMove(ev); return; }
    const p = pos(ev);
    const now = ev.timeStamp || Date.now();
    if (lastRaw) {
      lastStep = Math.hypot(p.x - lastRaw.x, p.y - lastRaw.y);
      // سرعتِ زمانی‌محور (پیکسل در فریمِ ~16.7ms)
      const dt = Math.max(1, now - lastTime);
      const v = lastStep * (16.7 / dt);
      moveVel = moveVel === 0 ? v : moveVel * 0.5 + v * 0.5;
    }
    lastRaw = p;
    lastTime = now;
    drawPoint(ev);
  }

  paper.addEventListener('pointerdown', e => {
    // دکمه‌های کنارِ قلم (بارل): فقط وضعیت را ثبت کن، خط نکش
    if (e.pointerType === 'pen' && e.button !== 0) {
      barrelHeld = (e.buttons & (2 | 8 | 16)) !== 0;
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    downStamp = e.timeStamp || 0;
    if (drawing && currentStroke.length) {
      strokes.push(currentStroke);
      history.push({ type: 'stroke', data: currentStroke });
    }
    drawing = true;
    pointerId = e.pointerId;
    try { paper.setPointerCapture(pointerId); } catch (_) {}
    lastRaw = null; lastStep = 0;
    if (erasing) { lastErase = null; removedStack = []; eraseMove(e); return; }
    lastTime = 0;
    last = null; smoothPoint = null; currentStroke = [];
    moveVel = 0; lastPress = 0.5; warmup = 0;
    gtx.clearRect(0, 0, W, H);
    drawPoint(e);
  });

  paper.addEventListener('pointermove', e => {
    if (!drawing || e.pointerId !== pointerId) return;
    const raw2 = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : [];
    const evs = raw2.length ? raw2.slice(-40) : [e];
    for (const ev of evs) handleMoveEv(ev);
  });

  paper.addEventListener('pointerrawupdate', e => {
    if (!drawing || e.pointerId !== pointerId) return;
    handleMoveEv(e);
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
  // راست‌کلیکِ قلم (بذر دکمه) هرگز نباید منوی مرورگر را باز کند
  document.addEventListener('contextmenu', e => e.preventDefault());
  paper.addEventListener('lostpointercapture', e => {
    if (drawing && (e.timeStamp || 0) >= downStamp) return;
    drawing = false; last = null; smoothPoint = null;
    moveVel = 0; lastPress = 0.5; lastRaw = null; lastStep = 0;
    lastTime = 0; lastErase = null; barrelHeld = false;
  });

  // پیش‌نمایش نوک روی برگه
  paper.addEventListener('pointermove', e => {
    if (drawing || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    if (e.pointerType === 'pen') barrelHeld = (e.buttons & (2 | 8 | 16)) !== 0;
    const p = pos(e);
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
    const a = Math.max(10, st.r * nibRatio() * 0.5 * 0.9);
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

  const setPaper = (type) => {
    paperType = type;
    $('paperDaftari').classList.toggle('active', type === 'daftari');
    $('paperGloss').classList.toggle('active', type === 'gloss');
    $('paperTraditional').classList.toggle('active', type === 'traditional');
    const P = PAPER_PRESETS[paperType];
    renderPaper();
    for (const stroke of strokes) {
      for (const st of stroke) {
        const t = clamp((1 - (st.fade || 1)) / 0.75, 0, 1) * 0.82;
        st.color = mixHex(st.ink || inkColor(), P.baseColor, t);
      }
    }
    redraw();
    status.textContent = type === 'daftari'
      ? 'کاغذ دفتری (مشق) — جذب مرکب، خطوط راهنما'
      : (type === 'gloss'
        ? 'کاغذ گلاسه / روغنی — سطح براق، خط تیز و تمیز'
        : 'کاغذ سنتی دست‌ساز — بافت عمیق و کهنه');
  };
  $('paperDaftari').onclick = () => setPaper('daftari');
  $('paperGloss').onclick = () => setPaper('gloss');
  $('paperTraditional').onclick = () => setPaper('traditional');

  $('clear').onclick = () => {
    strokes = []; currentStroke = []; history = [];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.shadowBlur = 0;
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
  };
  $('eraserBtn').onclick = () => {
    erasing = !erasing;
    $('eraserBtn').classList.toggle('active', erasing);
    paper.style.cursor = erasing ? 'none' : 'crosshair';
    status.textContent = erasing ? 'پاک‌کن فعال — روی خط بکشید تا محو شود' : 'پاک‌کن خاموش شد';
  };
  $('save').onclick = () => {
    const out = document.createElement('canvas');
    out.width = Math.round(W * dpr); out.height = Math.round(H * dpr);
    const o = out.getContext('2d');
    o.drawImage(paperTex, 0, 0);
    o.drawImage(ink, 0, 0);
    const a = document.createElement('a');
    a.download = 'neyestan-nastaliq.png';
    a.href = out.toDataURL('image/png');
    a.click();
  };

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
  function inkTrail(e) {
    if (!inkPresenter || !drawing || !e || !last) return;
    try {
      inkPresenter.updateInkTrailStartPoint(e, {
        color: inkColor(),
        diameter: Math.max(1.5, last.r * 0.5 + last.t),
      });
    } catch (_) {}
  }
  paper.addEventListener('pointerdown', e => inkTrail(e));
  paper.addEventListener('pointermove', e => inkTrail(e));

  status.textContent = 'آماده — قلم نی تنها: پهنای نوک، نسبت چلبی، فشار (نازک/کلفت) و شفافیت را تنظیم کن.';
})();
