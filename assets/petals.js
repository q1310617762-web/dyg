/* ============================================================
   樱花飘落（只在「八重」皮肤下启用）
   ────────────────────────────────────────────────────────────
   纯 Canvas 2D，无依赖，写法和 starfield.js 一致：
   canvas 由 JS 插入 body，层级在 body 背景之上、.start / .blog 内容之下，
   所以花瓣是从文字和卡片的后面落下来的，不会挡字。

   每片花瓣都是独立的：
     · 大小  7–20px，大的慢、小的快
     · 方向  横向漂移 −20…+20 px/s —— 有的斜着，有的几乎竖直
     · 摆动  叠加正弦横摆，不是直线下落
     · 翻转  scaleX 用 cos 收缩，模拟花瓣边翻身边落（真实的樱花就是这样）
   ============================================================ */
(function () {
  'use strict';

  var COLORS = ['#ef98ba', '#e987ab', '#f3a8c3', '#f5b6cd'];
  var MAX = 34;             // 上限，别在手机上撒满屏
  var MIN = 10;

  var cv = null, ctx = null;
  var W = 0, H = 0, DPR = 1;
  var petals = [];
  var raf = 0, last = 0;
  var running = false;

  /* 单瓣：宽的一头带缺口、窄的一头收成把儿。坐标 0..1。 */
  function drawPetal(g, p) {
    var s = p.size;
    /* 翻转用 scaleX 收缩模拟，但下限给到 .42：
       纯 cos 会让三分之一的瓣正好侧过来，看上去是一道细划痕而不是花瓣。 */
    var sx = 0.42 + 0.58 * Math.cos(p.spin);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.scale(sx, 1);
    g.transform(s, 0, 0, s, 0, 0);        // 单位路径放大到 size
    g.beginPath();
    /* 宽高比约 1:1.6 —— 原来是 1:1.9，太瘦，小尺寸下看着像一道划痕 */
    g.moveTo(0.50, 0.96);
    g.bezierCurveTo(0.28, 0.88, 0.17, 0.66, 0.22, 0.44);
    g.bezierCurveTo(0.26, 0.25, 0.42, 0.09, 0.46, 0.03);
    g.lineTo(0.50, 0.11);
    g.lineTo(0.54, 0.03);
    g.bezierCurveTo(0.58, 0.09, 0.74, 0.25, 0.78, 0.44);
    g.bezierCurveTo(0.83, 0.66, 0.72, 0.88, 0.50, 0.96);
    g.closePath();
    g.fillStyle = p.color;
    g.fill();
    g.restore();
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function spawn(initial) {
    var size = rnd(11, 16);
    if (Math.random() < 0.26) size = rnd(18, 26);   // 少数大片，大小要不一样
    var dir = Math.random();
    var drift;
    if (dir < 0.42) drift = rnd(-20, -6);           // 往左斜
    else if (dir < 0.84) drift = rnd(6, 20);        // 往右斜
    else drift = rnd(-2, 2);                        // 基本竖直
    return {
      size: size,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      x: rnd(-40, W + 40),
      y: initial ? rnd(-H * 0.2, H) : rnd(-160, -20),
      baseX: 0,          // 由 x 反推，摆动叠加在它上面
      vy: rnd(26, 40) * (14 / (size + 6)),          // 大的慢
      drift: drift,
      sway: rnd(8, 26),
      swayW: rnd(0.5, 1.1),                          // rad/s
      phase: rnd(0, 6.28),
      rot: rnd(0, 6.28),
      vr: rnd(-0.7, 0.7),                            // 自转 rad/s
      spin: rnd(0, 6.28),
      spinV: rnd(0.6, 1.7),
      alpha: rnd(0.62, 0.95)
    };
  }

  function seed() {
    var n = Math.round((W * H) / 30000);
    n = Math.max(MIN, Math.min(MAX, n));
    petals = [];
    for (var i = 0; i < n; i++) {
      var p = spawn(true);
      p.baseX = p.x;
      petals.push(p);
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
  }

  function frame(t) {
    if (!running) return;
    if (!last) last = t;
    var dt = Math.min((t - last) / 1000, 0.05);   // 切回标签页时别跳一大步
    last = t;

    ctx.clearRect(0, 0, W, H);

    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      p.y += p.vy * dt;
      p.baseX += p.drift * dt;
      p.phase += p.swayW * dt;
      p.rot += p.vr * dt;
      p.spin += p.spinV * dt;
      p.x = p.baseX + Math.sin(p.phase) * p.sway;

      if (p.y > H + p.size * 2 || p.baseX < -120 || p.baseX > W + 120) {
        var q = spawn(false);
        q.baseX = q.x;
        petals[i] = q;
        p = q;
      }

      ctx.globalAlpha = p.alpha;
      drawPetal(ctx, p);
    }
    ctx.globalAlpha = 1;

    raf = requestAnimationFrame(frame);
  }

  function start(still) {
    /* 减弱动效时不跑：飘落没有「只改透明度」的等价写法，
       停下来比留一堆卡在半空的花瓣干净。 */
    if (still) { stop(); return; }
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'dyg-petals';
      cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv);
      ctx = cv.getContext('2d');
      window.addEventListener('resize', function () {
        clearTimeout(cv._rt);
        cv._rt = setTimeout(resize, 180);
      });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
        } else if (running && !raf) {
          last = 0;
          raf = requestAnimationFrame(frame);
        }
      });
    }
    if (running) return;
    running = true;
    cv.classList.add('on');
    resize();
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (cv) {
      cv.classList.remove('on');
      ctx && ctx.clearRect(0, 0, W, H);
    }
  }

  window.__dygPetals = { start: start, stop: stop };
})();
