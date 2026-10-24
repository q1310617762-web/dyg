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
  var H = 140;          /* 画布设计高度上限，只做兜底；实际高度看 --viz-h */
  /* 频谱柱覆盖的频段。analyser 是 fftSize=512 → 256 个 bin，
     44.1kHz 下一个 bin ≈ 86Hz；取到 96（≈8kHz）为止，
     再往右全是空的，画出来是一排贴地的死柱。 */
  var SB_LO = 2, SB_HI = 96;
  var VBINS = 12;       /* 低频能量（≈0–1.1kHz），只用来判「有没有声音」 */

  var box, cvs, g, W = 0, VH = H, dpr = 1;
  var BARS = 0, barRaw = [], barLv = [], barPk = [];
  var petals = [];
  var raf = 0, running = false, painted = false;
  var audio = null, actx = null, anode = null, abuf = null, srcNode = null;
  var wired = false, dead = false, zeroStreak = 0, probeGap = 0;
  var lastPeak = 0, tPrev = 0, scrollTimer = 0, smooth = 0;
  var colors = {};

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

    /* 留 3px 余量。原来是 6px，但刊头盒高度统一之后（八重那档行盒比别的高 27px）
       起始页的富余少了，6px 会让 1440×900 只剩 88px，够不着「够看」的 90。
       3px 仍留得住「最后一根柱子的峰值帽不贴容器边」。 */
    var avail = core.clientHeight - rest - 3;
    var want = Math.max(64, Math.min(140, Math.round(window.innerHeight * 0.11)));

    /* 富余不够时理论上可以靠 scrollTop 把它顶出来，但那条路是走不通的：
       .start-core 是「垂直居中 + 内滚」的容器，可视化一展开，刊头自己就顶到
       容器上沿了 —— 此时 mast.top - core.top 只剩 4px，可借的余量其实是 0。
       上一版按「展开前」的刊头位置去估（量出来 21px），预算虚高，
       1366×768 展开后有 7px 落在可视区外，而滚动兜底因为 maxScroll=0 也救不回来。
       所以预算就是实打实的可用高度，不预支滚动。 */
    var cr0 = core.getBoundingClientRect();
    var topGap = mast ? Math.max(0, mast.getBoundingClientRect().top - cr0.top - 4) : 0;
    window.__dygVizGap = { topGap: Math.round(topGap) };   /* 诊断用 */

    /* avail 可能是负的（矮屏起始页本来就溢出），负的部分不能算进预算 */
    var budget = Math.max(0, avail);
    var h = Math.min(want, budget);
    if (h < 18) h = 0;   /* 连 18px 都挤不出来就别硬塞一条头发丝 */
    /* 窄屏不出现：手机起始页本来就排到屏幕外（收藏和看板娘的气泡已经叠在一起），
       再塞一条频谱只是把重叠弄得更难看。 */
    if (window.innerWidth < 720) h = 0;

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

  /* ---------- 音频接入 ----------
     顺序是硬要求：必须「AudioContext 真的 running 了」才去 createMediaElementSource。
     这一步不可撤销 —— 接上之后这个 <audio> 的声音就永久改走音频图，
     要是此刻 AudioContext 还是 suspended（这次 play 不是用户手势触发、
     或者被浏览器策略挡了），页面上时间照走、进度条照动，但一点声音都没有。
     所以先确认能出声再接管；接不上就让它继续走伪频谱，至少别把声音弄没。 */
  var wireTries = 0;
  function wire() {
    if (wired || !audio || wireTries > 4) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    wireTries++;

    try {
      if (!actx) actx = new AC();
    } catch (e) { actx = null; return; }

    var go = function () {
      if (wired || !audio || !actx) return;
      /* 还是没跑起来就别接管，下次 play 再试 */
      if (actx.state !== 'running') return;
      try {
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
        wired = false; anode = null; srcNode = null;
      }
    };

    if (actx.state === 'running') go();
    else actx.resume().then(go, go);
  }

  /* ---------- 频谱 ----------
     每根柱一段频段。柱宽按指数分配（`^1.9`）：低频信息密，
     平均分的话鼓和贝斯全挤在最左边两三根里，右边一大排贴地的死柱。 */
  function barN() {
    return Math.max(18, Math.min(64, Math.floor(W / 14)));
  }

  function binEdge(j, n) {
    var t = j / n;
    return SB_LO + Math.round((SB_HI - SB_LO) * Math.pow(t, 1.9));
  }

  /* 拿不到频谱时的兜底：用播放进度算一列确定性数值。
     视觉上和真频谱同构，但不会假装自己在反映音乐。 */
  function pseudoBars() {
    var t = audio ? (audio.currentTime || 0) : 0;
    for (var i = 0; i < BARS; i++) {
      var u = i / BARS;
      var beat = 0.5 + 0.5 * Math.sin(t * 3.1);
      var v = (0.10 + 0.62 * beat * Math.pow(1 - u, 1.25)) *
              (0.62 + 0.38 * Math.sin(t * 2.3 + i * 0.55));
      barRaw[i] = Math.max(0.03, Math.min(1, v));
    }
  }

  /* 测试钩子返回标量时，展开成一列有起伏的柱子 ——
     这样老的检查脚本（喂一个数）仍然能验「在动」。 */
  function feedBars(lv) {
    var t = (audio ? (audio.currentTime || 0) : 0) + performance.now() / 1000;
    for (var i = 0; i < BARS; i++) {
      var u = i / BARS;
      var v = lv * (0.30 + 0.70 * (1 - u * 0.55)) *
              (0.45 + 0.55 * Math.abs(Math.sin(t * 2.1 + i * 0.42)));
      barRaw[i] = Math.max(0.02, Math.min(1, v));
    }
  }

  /* 填 barRaw[i]。真频谱优先，拿不到就退到伪频谱。 */
  function pull() {
    if (BARS < 1) return;

    if (window.__dygVizFeed) {
      var f = window.__dygVizFeed();
      if (typeof f === 'number') feedBars(f);
      else if (f && f.length) for (var q = 0; q < BARS; q++) barRaw[q] = f[q % f.length];
      return;
    }
    if (!wired || !anode) { pseudoBars(); return; }
    /* 接管之后 AudioContext 被挂起（切后台、系统休眠）同样会静音，
       这里顺手救一次，别让「播着播着没声了」变成要刷新才好的问题。 */
    if (actx && actx.state === 'suspended') actx.resume().catch(function () {});

    /* dead 只代表「这一阵拿不到频谱」，不是永久判决。
       音乐本来就有静音前奏、间奏、淡出，连续 1.5 秒全零就判死的话，
       一首歌只要有一段安静，后面整首都变成假曲线了（换歌也不恢复）。
       所以每隔 2 秒放一次探测，有声音就自己回来。 */
    if (dead) {
      if (++probeGap < 120) { pseudoBars(); return; }
      probeGap = 0;
    }

    try {
      if (actx.state === 'suspended') actx.resume().catch(function () {});
      anode.getByteFrequencyData(abuf);

      var mx = 0;
      for (var k = 0; k < VBINS; k++) if (abuf[k] > mx) mx = abuf[k];
      if (mx === 0) {
        if (++zeroStreak > 90) dead = true;
        pseudoBars();
        return;
      }
      zeroStreak = 0;
      dead = false;

      for (var i = 0; i < BARS; i++) {
        var a = binEdge(i, BARS), b = binEdge(i + 1, BARS);
        if (b <= a) b = a + 1;
        var s = 0, top = 0;
        for (var j = a; j < b && j < abuf.length; j++) { s += abuf[j]; if (abuf[j] > top) top = abuf[j]; }
        /* 取「均值 + 峰值」的折中：纯均值太温吞，纯峰值太跳 */
        var v = (s / (b - a) * 0.45 + top * 0.55) / 255;
        /* 高频天生低，不做倾斜右边会一直贴地 */
        v *= 1 + 1.15 * (i / BARS);
        barRaw[i] = Math.max(0, Math.min(1, Math.pow(v, 1.25)));
      }
    } catch (e) {
      dead = true;
      pseudoBars();
    }
  }

  /* 圆角矩形：Chrome 有 roundRect，老浏览器退回手画 */
  function rrect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
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

    var n = barN();
    if (n !== BARS) {                       /* 宽度变了就重建柱子 */
      BARS = n;
      barRaw = []; barLv = []; barPk = [];
      for (var z = 0; z < BARS; z++) { barRaw.push(0); barLv.push(0); barPk.push(0); }
    }

    pull();

    /* 一阶低通：analyser 自带 smoothing，但 pow() 会把小波动一起放大，
       画出来像心电图；再过一道才像山。峰值帽只升不快降，留住「刚刚那一击」。 */
    var sum = 0, tallest = 0, tallX = 0;
    for (var i = 0; i < BARS; i++) {
      var v = barRaw[i];
      barLv[i] = barLv[i] ? barLv[i] * 0.55 + v * 0.45 : v;
      if (barLv[i] > barPk[i]) barPk[i] = barLv[i];
      else barPk[i] = Math.max(barLv[i], barPk[i] - dt * 0.00055);
      sum += barLv[i];
      if (barLv[i] > tallest) { tallest = barLv[i]; tallX = i; }
    }
    var avg = sum / BARS;
    var prev = smooth;
    smooth = smooth ? smooth * 0.45 + avg * 0.55 : avg;

    /* 电平 → 屏幕 y 的映射，全用容器真实高度算。
       留白跟着高度缩：矮屏（1366×768 只剩 26px）上固定 18px 留白
       会把动态范围吃掉三分之二。倒影要占一点底部，所以 PAD_B 给得比原来宽。 */
    var PAD_T = Math.min(10, VH * 0.13), PAD_B = Math.min(16, Math.max(7, VH * 0.20));
    var range = Math.max(8, VH - PAD_T - PAD_B);
    var base = VH - PAD_B;
    var yOf = function (lv) { return base - lv * range; };

    /* 峰顶飘樱花：正在上涨、过了阈值、且跟上一朵拉开距离
       （从最高的那根柱顶冒出来，不是固定贴在最右边） */
    if (smooth > 0.5 && smooth > prev && now - lastPeak > 260) {
      spawnPetal(tallest > 0.05 ? (tallX + 0.5) * (W / BARS) : W - 4,
                 yOf(tallest) - 6, tallest);
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

    var gap = W > 460 ? 3 : 2;
    var bw = Math.max(2, (W - gap * (BARS - 1)) / BARS);
    var rad = Math.min(bw / 2, 3);

    /* 柱子渐变：顶部亮粉、底部深梅，比单一色更有体积感 */
    var grad = g.createLinearGradient(0, yOf(1), 0, base);
    grad.addColorStop(0, colors.fillTop);
    grad.addColorStop(1, colors.line);

    /* 倒影：基线下面一段压扁的同色柱子，很淡。
       这条线把整排柱子「钉」在地上，不然矮屏上看上去像飘着的一排色块。 */
    g.save();
    g.globalAlpha = 0.16;
    g.fillStyle = colors.line;
    for (var r = 0; r < BARS; r++) {
      var rb = Math.max(1.5, barLv[r] * range * 0.55);
      rrect(r * (bw + gap), base, bw, Math.min(PAD_B, rb), rad);
      g.fill();
    }
    g.restore();

    /* 基线：一条极淡的发丝线（不是结构线，只是让柱子有落脚点） */
    g.globalAlpha = 0.22;
    g.fillStyle = colors.line;
    g.fillRect(0, base, W, 1);
    g.globalAlpha = 1;

    for (var q = 0; q < BARS; q++) {
      var x = q * (bw + gap);
      var bh = Math.max(1.5, barLv[q] * range);
      rrect(x, base - bh, bw, bh, rad);
      g.fillStyle = grad;
      g.fill();
    }

    /* 峰值帽：留住刚刚那一击，慢慢往下掉。
       矮屏（1366×768 只有 26px，动态范围不到 20px）上帽子和柱顶挤在一起，
       看起来像一排断掉的虚线，所以太矮就干脆不画。 */
    if (range >= 22) {
      g.fillStyle = colors.line;
      g.globalAlpha = 0.75;
      for (var c2 = 0; c2 < BARS; c2++) {
        var pk = barPk[c2];
        if (pk < 0.08) continue;
        var cy = base - Math.max(1.5, pk * range) - 2.5;
        if (cy < 0) continue;
        rrect(c2 * (bw + gap), cy, bw, 2, Math.min(bw / 2, 1));
        g.fill();
      }
      g.globalAlpha = 1;
    }

    /* 左右两端淡出：不然整排柱子是被「切」在左右边上的，
       看上去像一张条形图，而不是从页面里浮出来的一条频谱。 */
    g.globalCompositeOperation = 'destination-out';
    var fade = g.createLinearGradient(0, 0, W, 0);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.07, 'rgba(0,0,0,0)');
    fade.addColorStop(0.93, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fade;
    g.fillRect(0, 0, W, VH);
    g.globalCompositeOperation = 'source-over';

    for (var e = 0; e < petals.length; e++) drawPetal(petals[e]);
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
       resize() 才拿得到它去建画布和绘制坐标系。
       fit() 给 0 就是「这块屏放不下」（窄屏 / 起始页一格不剩）：
       干脆不开始，别挂个 0 高度的画布空转。 */
    if (!fit()) return;
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
    for (var i = 0; i < BARS; i++) { barLv[i] = 0; barPk[i] = 0; barRaw[i] = 0; }
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
    if (running) { fit(); resize(); return; }
    /* 之前放不下（窄屏 / 起始页挤满）没开始，窗口拉大了要自己长出来 */
    if (audio && !audio.paused) start();
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
