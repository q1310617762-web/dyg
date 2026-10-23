/* ============================================================
   星野背景（只在「夜幕」皮肤下启用）
   ────────────────────────────────────────────────────────────
   纯 Canvas 2D，无依赖。和 starfield-demo.html 同一套算法：
   立方体分布 → 绕 Y 轴旋转 → 透视投影 → 预渲染光点贴图。
   这里剥掉了 demo 的标题和提示，只留 start/stop。
   canvas 由 JS 插入 body，层级夹在 body::before（背景光）和 .blog（内容）之间。
   ============================================================ */
(function () {
  'use strict';

  var COUNT = 900;          // 站点里有大图和正文，比 demo 的 1300 少一些
  var FOCAL = 820;
  var SPRITE = 96;
  var ANGLE_PER_MS = 0.00012;

  var cv = null, ctx = null;
  var W = 0, H = 0, CX = 0, CY = 0;
  var stars = [];
  var SPR = {};
  var raf = 0;
  var running = false;
  var still = false;        // true = 只画一帧静态

  function makeGlow(size, tint) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var r = size / 2;
    var grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0.00, 'rgba(255,255,255,1)');
    grd.addColorStop(0.30, 'rgba(255,255,255,0.98)');
    grd.addColorStop(0.40, tint.replace('A', '0.55'));
    grd.addColorStop(0.58, tint.replace('A', '0.14'));
    grd.addColorStop(0.80, tint.replace('A', '0.03'));
    grd.addColorStop(1.00, tint.replace('A', '0'));
    g.fillStyle = grd;
    g.beginPath();
    g.arc(r, r, r, 0, 6.28318);
    g.fill();
    return c;
  }

  function makeFlare(size, tint) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var r = size / 2;
    var grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0.00, 'rgba(255,255,255,1)');
    grd.addColorStop(0.26, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.38, tint.replace('A', '0.62'));
    grd.addColorStop(0.60, tint.replace('A', '0.14'));
    grd.addColorStop(1.00, tint.replace('A', '0'));
    g.fillStyle = grd;

    var waist = r * 0.125;
    var tip = r * 0.98;
    g.beginPath();
    g.moveTo(r, r - tip);
    g.quadraticCurveTo(r + waist, r - waist, r + tip, r);
    g.quadraticCurveTo(r + waist, r + waist, r, r + tip);
    g.quadraticCurveTo(r - waist, r + waist, r - tip, r);
    g.quadraticCurveTo(r - waist, r - waist, r, r - tip);
    g.closePath();
    g.fill();
    return c;
  }

  function makeStar() {
    return {
      x: (Math.random() - 0.5) * 3000,
      y: (Math.random() - 0.5) * 1700,
      z: (Math.random() - 0.5) * 3000,
      r: Math.random() * 1.5 + 0.35,
      a: Math.random() * 0.55 + 0.35,
      tw: Math.random() * Math.PI * 2,
      hue: Math.random() < 0.22 ? 1 : 0,
      shape: Math.random() < 0.24 ? 1 : 0,
      pPh: Math.random() * 6.28318,
      pSp: 0.0012 + Math.random() * 0.0012,
      pAmp: 0.22 + Math.random() * 0.18
    };
  }

  function resize() {
    if (!cv) return;
    W = window.innerWidth;
    H = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CX = W / 2;
    CY = H / 2;
  }

  function draw(t) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    var ang = still ? 0 : t * ANGLE_PER_MS;
    var ca = Math.cos(ang), sa = Math.sin(ang);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var rx = s.x * ca - s.z * sa;
      var rz = s.x * sa + s.z * ca;
      var k = FOCAL / (rz + 2200);
      var sx = CX + rx * k;
      var sy = CY + s.y * k;
      if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;

      var pulse = still ? 1 : 1 + s.pAmp * Math.sin(t * s.pSp + s.pPh);
      var tw = still ? 1 : 0.7 + 0.3 * Math.sin(t * 0.0012 + s.tw);
      var alpha = Math.min(0.95, s.a * k * 2.3) * tw * (0.72 + 0.28 * pulse);
      var d = Math.max(3.2, s.r * k * 20) * pulse;

      var img;
      if (s.shape) {
        img = s.hue ? SPR.flareB : SPR.flareW;
        d = Math.min(24, Math.max(5, d * 1.18));
      } else {
        img = s.hue ? SPR.glowB : SPR.glowW;
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, sx - d / 2, sy - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!running) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  }

  function ensure() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.id = 'dyg-sky';
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    ctx = cv.getContext('2d', { alpha: true });
    ctx.imageSmoothingQuality = 'high';

    SPR.glowW = makeGlow(SPRITE, 'rgba(226,234,255,A)');
    SPR.glowB = makeGlow(SPRITE, 'rgba(150,170,255,A)');
    SPR.flareW = makeFlare(SPRITE, 'rgba(226,234,255,A)');
    SPR.flareB = makeFlare(SPRITE, 'rgba(150,170,255,A)');

    stars = [];
    for (var i = 0; i < COUNT; i++) stars.push(makeStar());

    resize();
    window.addEventListener('resize', function () {
      resize();
      if (still) draw(0);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (cv && cv.classList.contains('on')) {
        start(still);
      }
    });
  }

  /* still = true 时只画一帧，用于「减弱动效」环境 */
  function start(stillMode) {
    ensure();
    still = !!stillMode;
    cv.classList.add('on');
    resize();
    if (still) {
      draw(0);
      return;
    }
    if (running) return;
    running = true;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (cv) cv.classList.remove('on');
    if (ctx) ctx.clearRect(0, 0, W, H);
  }

  window.__dygSky = { start: start, stop: stop };
})();
