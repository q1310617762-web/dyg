/* ============================================================
   viz.js · 起始页音乐可视化（八重皮肤专属）
   ────────────────────────────────────────────────────────────
   形态：声波丘壑 —— 一条横向填充曲线从右往左推移，低频决定振幅，
   峰顶飘出樱花。只在 miko（八重）皮肤下启用，配色全部走樱花令牌。
   用户定的两条规则：
     1. 只在八重皮肤出现（跟花瓣、看板娘一样）
     2. 没播放时完全隐藏，播放才长出来 —— 所以不占位、不留空白

   ── 四条硬约束，都是会真出事的 ────────────────────────────
   1. createMediaElementSource 同一个 <audio> 只能调一次，第二次抛
      InvalidStateError（实测确认）。节点必须缓存在闭包里，不能每首曲子重建。
   2. 接上 Web Audio 后声音只从音频图里出，analyser 必须再 connect 到
      destination，否则整站静音。
   3. AudioContext 要在用户手势里建 / resume。这里是 play 事件里，安全。
   4. 切到博客形态后 .start 是 visibility:hidden，rAF 必须跳过绘制，
      否则后台白烧电。
   ============================================================ */
(function () {
  var POINTS = 150;     /* 横向采样点数：60fps 下约 2.5 秒的窗口 */
  var VBINS = 12;       /* 取前 12 个频点（约 0–1.1kHz）当低频能量 */
  var H = 140;          /* 画布设计高度，和 CSS 里的 height 对齐 */

  var box, cvs, g, W = 0, dpr = 1;
  var hist = [];
  var petals = [];
  var raf = 0, running = false, painted = false;
  var audio = null, actx = null, anode = null, abuf = null, srcNode = null;
  var wired = false, dead = false, zeroStreak = 0;
  var lastPeak = 0, tPrev = 0;
  var colors = {};

  for (var i = 0; i < POINTS; i++) hist.push(0);

  /* ---------- 颜色：从皮肤令牌读，换皮肤不用改代码 ---------- */
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    var pick = function (n, fb) { return (cs.getPropertyValue(n) || '').trim() || fb; };
    colors = {
      fillTop: pick('--sakura-1', '#e35c8a'),
      line: pick('--sakura-2', '#c0396a'),
      petal: pick('--sakura-petal', '#f4a0bf')
    };
  }

  function themeOK() {
    return (document.documentElement.getAttribute('data-theme') || '') === 'miko';
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    if (!cvs || !box) return;
    var w = box.clientWidth || 0;
    if (!w) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = w;
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(H * dpr);
    g = cvs.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- 高度：实测，不用 vh 猜 ----------
     起始页整页 overflow:hidden，放不下就只能靠 .start-core 内滚，
     把收藏推出屏幕是很难看的。所以拿「容器可视高 − 其余内容高」算真实的富余：
     够就给，不够就缩，太窄（<56px）就整个不出现。 */
  function fit() {
    if (!box) return 0;
    var core = box.parentElement;
    if (!core) return 0;

    /* 不能用 scrollHeight 反推：内容比容器矮时 scrollHeight 恒等于 clientHeight，
       算出来的富余永远是 0（踩过）。只能把兄弟块的盒高一个一个加起来。 */
    var rest = 0;
    var kids = core.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === box) continue;
      var cs = getComputedStyle(kids[i]);
      rest += kids[i].getBoundingClientRect().height +
              (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }
    var pcs = getComputedStyle(core);
    rest += (parseFloat(pcs.paddingTop) || 0) + (parseFloat(pcs.paddingBottom) || 0);

    var avail = core.clientHeight - rest - 6;    /* 留 6px 余量 */
    var want = Math.max(64, Math.min(140, Math.round(window.innerHeight * 0.11)));

    /* 实测：1920×1080 富余 143px，1440×900 富余 143px，1366×768 只剩 16px，
       手机 390×844 只有 45px —— 起始页本来就塞得满（刊头/时钟/搜索/问候/收藏）。
       所以富余不够时不再放弃，而是保底给 64px，多出来的让 .start-core 内滚：
       它本来就有 overflow-y:auto + overscroll-behavior:contain，
       滚一点点比「小屏上根本没有这个功能」好。
       只有窗口小到离谱（缺口 >120px）才彻底不出现。 */
    var h = Math.min(want, Math.max(avail, 64));
    if (avail < -120) h = 0;
    box.style.setProperty('--viz-h', h + 'px');
    /* 诊断用：空间算错了能一眼看出来 */
    window.__dygVizFit = { rest: Math.round(rest), avail: Math.round(avail),
                           want: want, h: h, coreH: core.clientHeight };
    return h;
  }

  /* ---------- 音频接入 ---------- */
  function wire() {
    if (wired || !audio) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      actx = new AC();
      /* 只允许一次：重复调用会抛 InvalidStateError */
      srcNode = actx.createMediaElementSource(audio);
      anode = actx.createAnalyser();
      anode.fftSize = 512;
      anode.smoothingTimeConstant = 0.8;
      abuf = new Uint8Array(anode.frequencyBinCount);
      srcNode.connect(anode);
      /* 必须接回 destination，不然除了可视化哪儿都没声 */
      anode.connect(actx.destination);
      wired = true;
    } catch (e) {
      wired = false; actx = null; anode = null; srcNode = null;
    }
  }

  /* 拿不到频谱时的兜底：用播放进度算一条确定性曲线。
     视觉上和真频谱同构，看不出是假的，但不会假装自己在反映音乐。 */
  function pseudo() {
    if (!audio) return 0.35;
    var t = audio.currentTime || 0;
    var v = Math.sin(t * 1.9) * 0.34 + Math.sin(t * 2.7 + 1.1) * 0.26 +
            Math.sin(t * 0.8 + 2.4) * 0.22;
    return Math.max(0, Math.min(1, 0.40 + v * 0.40));
  }

  function level() {
    /* 测试钩子：CI / 无音频设备的环境里，直接喂电平值验证绘制。
       不设置就不生效，生产路径完全不受影响。 */
    if (window.__dygVizFeed) return window.__dygVizFeed();
    if (dead || !wired || !anode) return pseudo();
    try {
      if (actx.state === 'suspended') actx.resume().catch(function () {});
      anode.getByteFrequencyData(abuf);
      var s = 0, mx = 0;
      for (var i = 0; i < VBINS; i++) { s += abuf[i]; if (abuf[i] > mx) mx = abuf[i]; }
      /* 连续 1.5 秒全零，说明这条路走不通（iOS 上常见），转兜底 */
      if (mx === 0) { if (++zeroStreak > 90) dead = true; }
      else zeroStreak = 0;
      var v = s / (VBINS * 255);
      return Math.pow(v, 0.72);   /* 提一点小音量时的可见度 */
    } catch (e) {
      dead = true;
      return pseudo();
    }
  }

  /* ---------- 樱花 ---------- */
  function spawnPetal(x, y, power) {
    if (petals.length > 14) return;
    petals.push({
      x: x, y: y,
      r: 3.2 + power * 3.4,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.035,
      vy: -(0.25 + Math.random() * 0.5),
      vx: (Math.random() - 0.5) * 0.28,
      life: 1
    });
  }

  function drawPetal(p) {
    g.save();
    g.globalAlpha = Math.max(0, p.life) * 0.95;
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    for (var k = 0; k < 5; k++) {
      g.rotate(Math.PI * 2 / 5);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(p.r * 0.55, -p.r * 0.42, p.r * 0.26, -p.r);
      g.quadraticCurveTo(0, -p.r * 0.68, -p.r * 0.26, -p.r);
      g.quadraticCurveTo(-p.r * 0.55, -p.r * 0.42, 0, 0);
      g.closePath();
      g.fillStyle = colors.petal;
      g.fill();
    }
    g.restore();
  }

  /* ---------- 一帧 ---------- */
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!g || !W) return;

    /* 切到博客形态就别画了：.start 是 visibility:hidden，画了也看不见 */
    if (document.documentElement.getAttribute('data-mode') !== 'start') return;

    var dt = tPrev ? Math.min(now - tPrev, 60) : 16;
    tPrev = now;

    var v = level();
    var prev = hist[POINTS - 1];
    hist.push(v);
    hist.shift();

    /* 峰顶飘樱花：正在上涨、且过了阈值、且跟上一朵拉开距离 */
    if (v > 0.55 && v > prev && now - lastPeak > 260) {
      var x = W - 4;
      var y = H - v * (H - 26) - 10;
      spawnPetal(x, y, v);
      lastPeak = now;
    }

    for (var i = petals.length - 1; i >= 0; i--) {
      var p = petals[i];
      p.x += p.vx * dt / 16;
      p.y += p.vy * dt / 16;
      p.rot += p.spin * dt / 16;
      p.life -= dt / 2600;
      if (p.life <= 0 || p.y < -12) petals.splice(i, 1);
    }

    g.clearRect(0, 0, W, H);

    /* 曲线：二次贝塞尔中点法，比直线连起来柔和 */
    var pts = [];
    for (var j = 0; j < POINTS; j++) {
      pts.push({
        x: j / (POINTS - 1) * W,
        y: H - hist[j] * (H - 20)
      });
    }

    g.beginPath();
    g.moveTo(pts[0].x, H);
    g.lineTo(pts[0].x, pts[0].y);
    for (var m = 1; m < POINTS; m++) {
      var a = pts[m - 1], b = pts[m];
      g.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    g.lineTo(pts[POINTS - 1].x, pts[POINTS - 1].y);
    g.lineTo(W, H);
    g.closePath();

    var grad = g.createLinearGradient(0, H - (H - 20), 0, H);
    grad.addColorStop(0, hexA(colors.fillTop, 0.38));
    grad.addColorStop(1, hexA(colors.fillTop, 0.02));
    g.fillStyle = grad;
    g.fill();

    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (var n = 1; n < POINTS; n++) {
      var c = pts[n - 1], d = pts[n];
      g.quadraticCurveTo(c.x, c.y, (c.x + d.x) / 2, (c.y + d.y) / 2);
    }
    g.lineTo(pts[POINTS - 1].x, pts[POINTS - 1].y);
    g.strokeStyle = colors.line;
    g.lineWidth = 1.6;
    g.lineJoin = 'round';
    g.stroke();

    for (var q = 0; q < petals.length; q++) drawPetal(petals[q]);
  }

  /* #rrggbb -> rgba()，支持三位简写 */
  function hexA(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16),
        gg = parseInt(h.slice(2, 4), 16),
        b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(gg) || isNaN(b)) return 'rgba(227,92,138,' + a + ')';
    return 'rgba(' + r + ',' + gg + ',' + b + ',' + a + ')';
  }

  /* ---------- 起停 ---------- */
  /* force 只给测试用：真机没有音频设备时 audio 永远是 paused，
     没有这个口子就完全没法自动化验证展开与绘制。 */
  function start(force) {
    if (running) return;
    if (!themeOK()) return;                 /* 只有八重皮肤 */
    if (!window.__dygUi || !window.__dygUi.audio) return;
    audio = window.__dygUi.audio();
    if (!audio || (audio.paused && !force)) return;

    readColors();
    wire();
    resize();
    running = true;
    tPrev = 0;
    fit();                              /* 算高度，不够就缩 / 不出现 */
    if (box) box.classList.add('on');
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (box) box.classList.remove('on');
    petals.length = 0;
    for (var i = 0; i < POINTS; i++) hist[i] = 0;
  }

  function mount() {
    box = document.querySelector('[data-viz]');
    if (!box) return;
    cvs = box.querySelector('canvas');
    if (!cvs) return;

    resize();
    var onResize = function () { resize(); if (running) fit(); };
    if (window.ResizeObserver) {
      new ResizeObserver(onResize).observe(box);
      window.addEventListener('resize', onResize);
    } else {
      window.addEventListener('resize', onResize);
    }

    /* audio 是在 ui.js 闭包里建的那个，全局唯一一份 */
    var hook = function () {
      if (!window.__dygUi || !window.__dygUi.audio) return;
      var a = window.__dygUi.audio();
      if (!a || a === audio) return;
      audio = a;
      a.addEventListener('play', function () { start(); });
      a.addEventListener('pause', stop);
      a.addEventListener('ended', stop);
      a.addEventListener('error', stop);
      if (!a.paused) start();
    };
    hook();
    /* ui.js 可能还没 boot 完，晚一步再试 */
    setTimeout(hook, 300);
  }

  window.__dygViz = {
    start: start,
    stop: stop,
    /* 皮肤切换时用：不是八重就立刻收起来 */
    syncTheme: function (id) {
      readColors();
      if (id !== 'miko') stop();
      else if (audio && !audio.paused) start();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
