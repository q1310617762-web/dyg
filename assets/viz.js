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
  var H = 140;          /* 画布设计高度上限，只做兜底；实际高度看 --viz-h */

  var box, cvs, g, W = 0, VH = H, dpr = 1;
  var hist = [];
  var petals = [];
  var raf = 0, running = false, painted = false;
  var audio = null, actx = null, anode = null, abuf = null, srcNode = null;
  var wired = false, dead = false, zeroStreak = 0, probeGap = 0;
  var lastPeak = 0, tPrev = 0, scrollTimer = 0, smooth = 0;
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
  /* 绘制高度必须等于容器实际给的高度（--viz-h，由 fit 算出）。
     之前写死 140：1440×900 容器只有 97、1366×768 只有 64，
     而 canvas 是 bottom:0 对齐的，多出来的部分全被容器顶部裁掉 ——
     波峰正好画在顶部，于是电平一过 0.5 就被削成一条平线。 */
  function vizH() {
    if (!box) return H;
    var v = parseFloat(getComputedStyle(box).getPropertyValue('--viz-h'));
    return (v > 0 ? v : H);
  }

  function resize() {
    if (!cvs || !box) return;
    var w = box.clientWidth || 0;
    if (!w) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = w;
    VH = Math.round(vizH());
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(VH * dpr);
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

    /* 量之前必须先把高度归零，而且必须先把 transition 关掉。
       否则 fit() 会自我反馈：给了 26px → 刊头被 flex 分布顶上去 → topGap 变 0
       → 这次算出 0 → 缩回去 → 刊头又下来 → 又算出 26……
       更阴的是：只写 --viz-h:0 而不停 transition 的话，元素还在 450ms 的
       过渡路上，读 offsetHeight 读到的仍是中间高度，刊头也还在上头 ——
       归零等于没做，预算一次比一次小，最后缩没。 */
    var animate = !box.classList.contains('on');   /* 只有首次展开要放动画 */
    box.classList.add('measuring');
    box.style.setProperty('--viz-h', '0px');
    void core.offsetHeight;                        /* 强制回流，让 0 落定 */

    /* 不能用 scrollHeight 反推：内容比容器矮时 scrollHeight 恒等于 clientHeight，
       算出来的富余永远是 0（踩过）。只能把兄弟块的盒高一个一个加起来。 */
    var rest = 0;
    var mast = null;
    var kids = core.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === box) continue;
      if (!mast && kids[i].classList && kids[i].classList.contains('st-mast')) mast = kids[i];
      var cs = getComputedStyle(kids[i]);
      rest += kids[i].getBoundingClientRect().height +
              (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }
    var pcs = getComputedStyle(core);
    rest += (parseFloat(pcs.paddingTop) || 0) + (parseFloat(pcs.paddingBottom) || 0);

    var avail = core.clientHeight - rest - 6;    /* 留 6px 余量 */
    var want = Math.max(64, Math.min(140, Math.round(window.innerHeight * 0.11)));

    /* 富余不够时只能用「scrollTop」把它顶出来，而 .start-core 是内滚容器，
       滚多少刊头就往上走多少 —— 上一版直接 scrollIntoView，1366×768 把刊头
       从 y=79 顶到 y=17，1280×720 直接顶到 -16，HELLO WORLD 被切掉半个字。
       刊头上沿到 core 上沿之间那段空白（topGap）才是可以「借」的上限。 */
    var topGap = 0;
    if (mast) {
      var cr = core.getBoundingClientRect();
      var mr = mast.getBoundingClientRect();
      /* 要加回 core.scrollTop：fit() 会被 resize 再调一次，那时可能已经滚过了，
         不减回去的话预算越算越少，可视化会自己越缩越矮 */
      topGap = Math.max(0, mr.top - cr.top + core.scrollTop - 4);
    }

    /* avail 可能是负的（1280×720 起始页本来就溢出 13px），负的部分不能算进预算 */
    var budget = Math.max(0, avail) + topGap;
    var h = Math.min(want, budget);
    if (h < 18) h = 0;   /* 连 18px 都挤不出来就别硬塞一条头发丝 */

    /* 写高度时 measuring 还挂着 —— 当场生效、不起过渡。
       只有「首次展开」才回一次 0 再写 h，让 .on 加上那一刻有 0→h 的生长动画；
       重复 fit（resize）就直接跳到新值，别把动画再放一遍。 */
    box.style.setProperty('--viz-h', h + 'px');
    box.classList.remove('measuring');
    if (animate) {
      box.style.setProperty('--viz-h', '0px');
      void box.offsetHeight;
      box.style.setProperty('--viz-h', h + 'px');
    }
    /* 诊断用：空间算错了能一眼看出来 */
    window.__dygVizFit = { rest: Math.round(rest), avail: Math.round(avail),
                           topGap: Math.round(topGap), budget: Math.round(budget),
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
    if (!wired || !anode) return pseudo();

    /* dead 只代表「这一阵拿不到频谱」，不是永久判决。
       音乐本来就有静音前奏、间奏、淡出，连续 1.5 秒全零就判死的话，
       一首歌只要有一段安静，后面整首都变成假曲线了（而且换歌也不恢复）。
       这里改成每隔 2 秒放一次探测，有声音就自己回来。 */
    if (dead) {
      if (++probeGap < 120) return pseudo();
      probeGap = 0;
    }

    try {
      if (actx.state === 'suspended') actx.resume().catch(function () {});
      anode.getByteFrequencyData(abuf);
      var s = 0, mx = 0;
      for (var i = 0; i < VBINS; i++) { s += abuf[i]; if (abuf[i] > mx) mx = abuf[i]; }
      if (mx === 0) {
        if (++zeroStreak > 90) dead = true;
        return pseudo();
      }
      zeroStreak = 0;
      dead = false;
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
    if (!g || !W || !VH) return;

    /* 切到博客形态就别画了：.start 是 visibility:hidden，画了也看不见 */
    if (document.documentElement.getAttribute('data-mode') !== 'start') return;

    var dt = tPrev ? Math.min(now - tPrev, 60) : 16;
    tPrev = now;

    var v = level();
    /* 一阶低通。频谱本身有 smoothingTimeConstant=.8，但 pow(0.72)
       会把小波动一起放大，画出来像心电图；再过一道才像山。 */
    smooth = smooth ? smooth * 0.55 + v * 0.45 : v;
    var prev = hist[POINTS - 1];
    hist.push(smooth);
    hist.shift();

    /* 电平 → 屏幕 y 的映射，全用容器真实高度算。
       PAD_T / PAD_B 是上下留白：底部留 8px 让基线不贴着裁切边，
       顶部留 10px 让满电平的峰尖不被切到。
       但矮屏（1366×768 只剩 31px）上固定 18px 留白会把动态范围吃掉三分之二，
       所以留白跟着高度缩，比例不变。 */
    var PAD_T = Math.min(10, VH * 0.13), PAD_B = Math.min(8, VH * 0.10);
    var range = Math.max(8, VH - PAD_T - PAD_B);
    var yOf = function (lv) { return VH - PAD_B - lv * range; };

    /* 峰顶飘樱花：正在上涨、且过了阈值、且跟上一朵拉开距离 */
    if (smooth > 0.55 && smooth > prev && now - lastPeak > 260) {
      spawnPetal(W - 4, yOf(smooth) - 6, smooth);
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

    g.clearRect(0, 0, W, VH);

    /* 曲线：二次贝塞尔中点法，比直线连起来柔和 */
    var pts = [];
    for (var j = 0; j < POINTS; j++) {
      pts.push({ x: j / (POINTS - 1) * W, y: yOf(hist[j]) });
    }

    g.beginPath();
    g.moveTo(pts[0].x, VH);
    g.lineTo(pts[0].x, pts[0].y);
    for (var m = 1; m < POINTS; m++) {
      var a = pts[m - 1], b = pts[m];
      g.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    g.lineTo(pts[POINTS - 1].x, pts[POINTS - 1].y);
    g.lineTo(W, VH);
    g.closePath();

    var grad = g.createLinearGradient(0, PAD_T, 0, yOf(0));
    grad.addColorStop(0, hexA(colors.fillTop, 0.42));
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
    /* 1.6 → 2：容器矮到 80px 时 1.6px 的线在 2 倍屏上几乎糊掉 */
    g.lineWidth = 2;
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

    /* 路由换过页的话 .start 已经是新节点，老的 box 不在文档里 —— 重新挂 */
    if (!box || !box.isConnected || !cvs || !cvs.isConnected) {
      if (!mount()) return;
    }

    readColors();
    wire();
    /* 顺序不能反：fit() 先把真实高度写进 --viz-h，
       resize() 才拿得到它去建画布和绘制坐标系。 */
    fit();
    resize();
    /* 重新开始就别带着上一次的降级状态 */
    dead = false; zeroStreak = 0; probeGap = 0;
    running = true;
    tPrev = 0;
    if (box) box.classList.add('on');
    if (!raf) raf = requestAnimationFrame(frame);

    /* 展开后如果整块落在可视区外，就把它滚进来。
       关键：.start-core 是内滚容器，滚多少刊头就往上走多少。
       所以必须自己算滚动量并夹在 topGap 里 —— 用 scrollIntoView 会一路滚到底，
       1366×768 把 HELLO WORLD 顶掉 62px，1280×720 直接顶出屏幕。
       fit() 已经把 h 控制在「avail + topGap」以内，理论上需要的滚动量不会超，
       这里再夹一次是防过渡期间量到的中间值把预算骗过去。 */
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      if (!running || !box) return;
      var core = box.parentElement;
      if (!core) return;
      var r = box.getBoundingClientRect(), cr = core.getBoundingClientRect();
      var need = r.bottom - cr.bottom;
      if (need <= 1) return;

      var mast = core.querySelector('.st-mast');
      var maxScroll = mast
        ? Math.max(0, mast.getBoundingClientRect().top - cr.top - 4)
        : need;
      var delta = Math.min(need, maxScroll);
      if (delta <= 1) return;

      var reduce = window.matchMedia &&
                   window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (typeof core.scrollTo === 'function') {
        core.scrollTo({ top: core.scrollTop + delta, behavior: reduce ? 'auto' : 'smooth' });
      } else {
        core.scrollTop = core.scrollTop + delta;
      }
    }, 480);                       /* 等 height 过渡（450ms）走完再量 */
  }

  function stop() {
    if (!running) return;
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = 0; }
    if (box) box.classList.remove('on');
    petals.length = 0;
    for (var i = 0; i < POINTS; i++) hist[i] = 0;
    dead = false; zeroStreak = 0; probeGap = 0; smooth = 0;
  }

  /* 视口真的变了才重算。
     绝不能对 box 自己挂 ResizeObserver：box 的高度是本脚本写的，观察它等于
     自己触发自己。改观察 .start-core 也不够：core 是内滚容器，box 一变高就
     冒出竖向滚动条、clientWidth 掉 15px，RO 又响一次 —— 照样自激，
     实测高度会在 0→26 之间永远爬不上去。 */
  var ro = null, lastW = 0, lastH = 0, resizeBound = false, hookedAudio = null;

  function onResize() {
    if (window.innerWidth === lastW && window.innerHeight === lastH) return;
    lastW = window.innerWidth; lastH = window.innerHeight;
    if (running) fit();
    resize();
  }

  /* 可取多次：路由从子页面回起始页时，.start 是 importNode 搬进来的全新节点，
     老的 box 已经脱离文档 —— 不重新挂就会往一个看不见的 canvas 上画，
     表现是「歌在放、播放键也对，就是没有波」。 */
  function mount() {
    var b = document.querySelector('[data-viz]');
    if (!b) return false;
    var c = b.querySelector('canvas');
    if (!c) return false;
    box = b; cvs = c;

    resize();
    if (!resizeBound) {
      window.addEventListener('resize', onResize);
      resizeBound = true;
    }
    if (window.ResizeObserver) {
      if (ro) ro.disconnect();
      ro = new ResizeObserver(onResize);
      if (box.parentElement) ro.observe(box.parentElement);
    }
    lastW = window.innerWidth; lastH = window.innerHeight;

    /* audio 是在 ui.js 闭包里建的那个，全局唯一一份。
       重挂时不能重复加监听，否则 play 会被 start() 收好几遍。 */
    var hook = function () {
      if (!window.__dygUi || !window.__dygUi.audio) return;
      var a = window.__dygUi.audio();
      if (!a || a === hookedAudio) return;
      hookedAudio = a;
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
    return true;
  }

  window.__dygViz = {
    start: start,
    stop: stop,
    /* 皮肤切换时用：不是八重就立刻收起来 */
    syncTheme: function (id) {
      readColors();
      if (id !== 'miko') stop();
      else if (audio && !audio.paused) start();
    },
    /* 诊断用：一眼看出「挂没挂上 play」「接没接上 Web Audio」
       「是不是在演假曲线」「画布建了多高」。排查时全靠这个。 */
    state: function () {
      return { hooked: !!audio, wired: wired, dead: dead, running: running,
               vh: VH, w: W, petals: petals.length,
               audioPaused: audio ? audio.paused : null,
               actx: actx ? actx.state : null };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
