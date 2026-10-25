/* 夜幕皮肤专属：角色动图在整屏里随机飘，边自转边撞边反弹。
 *
 * 和星野同一层（星野 z 1，这里 z 2），都在内容（z 50）下面 ——
 * 它们是背景里的活物，不该挡字也不该吃点击，所以 pointer-events: none。
 *
 * 四条必须守住的规矩：
 *   1. **只在夜幕皮肤下存在**。别的皮肤连这个 JS 都不该下载
 *      （由 ui.js 的 ensureDrift() 按需加载），更不该下那些动图。
 *   2. **元素挂在 body 上**，不是挂在 .blog 里。站内换页是路由，
 *      .blog 的内容会被整块换掉，挂在那儿的元素每跳一页就没了。
 *   3. **减弱动效时整层不出现**。飘动没有「只改透明度」的等价写法，
 *      留一个停在半空、转到一半的角色比不画更奇怪（和樱花那层同样的取舍）。
 *   4. 页面切到后台就停 rAF，别在看不见的时候算。
 *
 * 反弹的三个细节（不加就会出问题）：
 *   - 每次反弹后给方向加一点随机偏转，否则会沿同一条对角线无限往返，
 *     看着像在轨道上滑动而不是在飘。偏转完还要**强制朝内**：角落两墙
 *     同时命中时，随机偏转有可能又指回墙上。
 *   - 分量太小的方向要拉开：几乎贴着水平或垂直走时，角色会沿着一条边
 *     蹭很久才弹一次。
 *   - **边界要按旋转后的外接盒算**。角色绕自身中心转，45° 时外接盒比
 *     原尺寸大 41%，按左上角判会「没越界但视觉上已经被裁掉」。
 *
 * 第二个角色（兔兔伯爵）是**延迟加载**的：等页面 load 之后有空闲再要。
 * 本站到 GitHub Pages 只有 8.6 KB/s，首屏带宽不能让一张装饰图抢走。
 */
(function () {
  /* defer: true 的角色等首屏忙完再加载 */
  var CAST = [
    { id: 'dyg-drift-teacher', src: 'assets/img/teacher.webp', defer: false },
    { id: 'dyg-drift-bunny', src: 'assets/img/bunny.webp', defer: true }
  ];

  var SPEED = 26;        /* px/s，飘动速度 */
  var SPIN = 13;         /* 度/s，自转速度。转一圈约 28 秒 */
  var MIN_RATIO = 0.24;  /* 速度分量下限（占 SPEED 的比例） */

  var actors = [];
  var W = 0, H = 0;
  var raf = 0, last = 0, running = false;

  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  function measure(a) {
    if (!a.el) return;
    a.w = a.el.offsetWidth;
    a.h = a.el.offsetHeight;
    /* 兜底：图片还没解码时 offsetHeight 是 0，w/h 拿到 0 就等于没有边界，
       角色会一路飘出视口（这个 bug 真的发生过）。宽度按 theme.css 里同一个
       clamp 推算，高度按各自动图的固有比例。改 CSS 宽度要同步改这里。 */
    if (!a.w) a.w = Math.min(Math.max(94, W * 0.13), 170);
    if (!a.h) a.h = a.w * (a.ratio || 0.9);
  }

  /* 当前角度下外接盒的半宽/半高（角色绕自身中心转）。
     只按未旋转的 w×h 判边界是不够的：45° 时外接盒最大约 1.41 倍。 */
  function bounds(a) {
    var rad = a.rot * Math.PI / 180;
    var c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    return { hw: (a.w * c + a.h * s) / 2, hh: (a.w * s + a.h * c) / 2 };
  }

  /* 在「旋转后也不出框」的允许范围里随机落一个位置。
     允许范围是中心点 ∈ [hw, W-hw] × [hh, H-hh]，再减半盒子换回左上角。 */
  function seed(a) {
    if (!a.w || !a.h) return;
    var b = bounds(a);
    var hw = Math.min(b.hw, W / 2), hh = Math.min(b.hh, H / 2);
    var loX = hw - a.w / 2, hiX = W - hw - a.w / 2;
    var loY = hh - a.h / 2, hiY = H - hh - a.h / 2;
    a.x = hiX > loX ? rnd(loX, hiX) : (W - a.w) / 2;
    a.y = hiY > loY ? rnd(loY, hiY) : (H - a.h) / 2;
  }

  /* 把速度方向偏转一个随机角后重新归一化。
     不这么做的话反弹是纯镜面反射，轨迹会退化成一条固定的对角线。 */
  function retarget(a) {
    var ang = Math.atan2(a.vy, a.vx) + rnd(-0.45, 0.45);
    a.vx = Math.cos(ang) * SPEED;
    a.vy = Math.sin(ang) * SPEED;
    var lo = SPEED * MIN_RATIO;
    if (Math.abs(a.vx) < lo) a.vx = (a.vx < 0 ? -1 : 1) * lo;
    if (Math.abs(a.vy) < lo) a.vy = (a.vy < 0 ? -1 : 1) * lo;
    var m = Math.sqrt(a.vx * a.vx + a.vy * a.vy) || 1;
    a.vx = a.vx / m * SPEED;
    a.vy = a.vy / m * SPEED;
  }

  function bounce(a) {
    if (!a.w || !a.h) return;              /* 图还没解码，量不到盒子 */
    var b = bounds(a);
    /* 视角比外接盒还小时（窄屏/矮屏）没有可飘空间，min(…, W/2) 把角色钉在中间，
       否则反复夹来夹去会抖成一条竖线 */
    var hw = Math.min(b.hw, W / 2);
    var hh = Math.min(b.hh, H / 2);
    var cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    var dirX = 0, dirY = 0;

    if (cx - hw < 0) { cx = hw; dirX = 1; }          /* 撞左墙 → 之后必须朝右 */
    else if (cx + hw > W) { cx = W - hw; dirX = -1; }
    if (cy - hh < 0) { cy = hh; dirY = 1; }
    else if (cy + hh > H) { cy = H - hh; dirY = -1; }

    if (!dirX && !dirY) return;
    a.x = cx - a.w / 2;
    a.y = cy - a.h / 2;
    retarget(a);
    /* retarget 是随机偏转，在角落两墙同时命中时可能又指回墙上 —— 强制朝内。
       Math.abs 只改符号不改大小，SPEED 保持不变。 */
    if (dirX) a.vx = Math.abs(a.vx) * dirX;
    if (dirY) a.vy = Math.abs(a.vy) * dirY;
  }

  function place(a) {
    if (!a.el) return;
    a.el.style.transform = 'translate3d(' + a.x.toFixed(1) + 'px,' + a.y.toFixed(1) +
      'px,0) rotate(' + a.rot.toFixed(1) + 'deg)';
  }

  function step(now) {
    if (!running) return;
    var dt = Math.min((now - last) / 1000, 0.05);   /* 切回前台时别跳一大步 */
    last = now;
    for (var i = 0; i < actors.length; i++) {
      var a = actors[i];
      if (!a.el) continue;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot = (a.rot + a.spin * dt) % 360;
      bounce(a);
      place(a);
    }
    raf = requestAnimationFrame(step);
  }

  function mount(a) {
    if (a.el) return;
    var el = document.createElement('div');
    el.className = 'dyg-drift';
    el.id = a.id;
    el.setAttribute('aria-hidden', 'true');
    var img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    /* 盒子尺寸没变就别重新落位，免得已经在飘的时候突然跳一下 */
    img.addEventListener('load', function () {
      var had = a.h;
      measure(a);
      if (!a.ratio && a.w) a.ratio = a.h / a.w;
      if (had === a.h) return;
      seed(a);
      place(a);
    });
    img.src = a.src;
    el.appendChild(img);
    document.body.appendChild(el);
    a.el = el;

    measure(a);
    a.rot = rnd(0, 360);
    a.spin = Math.random() < 0.5 ? -SPIN : SPIN;
    seed(a);                    /* 初始位置也要按旋转后的盒子算 */
    var ang = rnd(0, Math.PI * 2);
    a.vx = Math.cos(ang) * SPEED;
    a.vy = Math.sin(ang) * SPEED;
    place(a);
    if (running) el.classList.add('on');
  }

  function ensure() {
    if (actors.length) return;
    W = window.innerWidth;
    H = window.innerHeight;
    CAST.forEach(function (cfg) {
      var a = { id: cfg.id, src: cfg.src, defer: cfg.defer,
                el: null, w: 0, h: 0, ratio: 0,
                x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: SPIN };
      actors.push(a);
      if (!cfg.defer) mount(a);
    });

    window.addEventListener('resize', function () {
      W = window.innerWidth;
      H = window.innerHeight;
      actors.forEach(function (a) {
        if (!a.el) return;
        measure(a);
        bounce(a);            /* 变小后可能整个落在边界外，夹回来再继续 */
        if (!running) place(a);
      });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (document.querySelector('.dyg-drift.on')) {
        resume();
      }
    });

    /* 延迟的角色：首屏忙完了再要，别跟首屏抢那点带宽（8.6 KB/s） */
    var deferred = actors.filter(function (a) { return a.defer && !a.el; });
    if (deferred.length) {
      var kick = function () {
        var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1200); };
        idle(function () { deferred.forEach(function (a) { measure(a); mount(a); }); });
      };
      if (document.readyState === 'complete') kick();
      else window.addEventListener('load', kick, { once: true });
    }
  }

  function resume() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(step);
  }

  /* still = true（减弱动效）时整层不出现 */
  function start(stillMode) {
    if (stillMode) { stop(); return; }
    ensure();
    W = window.innerWidth;
    H = window.innerHeight;
    actors.forEach(function (a) { if (a.el) a.el.classList.add('on'); });
    resume();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    actors.forEach(function (a) { if (a.el) a.el.classList.remove('on'); });
  }

  window.__dygDrift = {
    start: start,
    stop: stop,
    /* 给测试用：每个角色的位置、速度、转角，以及在不在动 */
    state: function () {
      return {
        mounted: actors.filter(function (a) { return a.el; }).length,
        on: actors.filter(function (a) { return a.el && a.el.classList.contains('on'); }).length,
        running: running,
        view: [W, H],
        cast: actors.map(function (a) {
          return {
            id: a.id, mounted: !!a.el,
            on: !!(a.el && a.el.classList.contains('on')),
            x: Math.round(a.x), y: Math.round(a.y), rot: Math.round(a.rot),
            vx: Math.round(a.vx), vy: Math.round(a.vy),
            box: a.el ? [Math.round(a.w), Math.round(a.h)] : null
          };
        })
      };
    }
  };
})();
