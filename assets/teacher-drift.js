/* 夜色皮肤专属：角色动图在整屏里随机飘，边自转边撞边反弹。
 *
 * 和星野同一层（星野 z 1，这里 z 2），都在内容（z 50）下面 ——
 * 它是背景里的一个活物，不该挡字也不该吃点击，所以 pointer-events: none。
 *
 * 四条必须守住的规矩：
 *   1. **只在夜色皮肤下存在**。别的皮肤连这个 JS 都不该下载
 *      （由 ui.js 的 ensureDrift() 按需加载），更不该下那张 104KB 的动图。
 *   2. **元素挂在 body 上**，不是挂在 .blog 里。站内换页是路由，
 *      .blog 的内容会被整块换掉，挂在那儿的元素每跳一页就没了。
 *   3. **减弱动效时整层不出现**。飘动没有「只改透明度」的等价写法，
 *      留一个停在半空、转到一半的角色比不画更奇怪（和樱花那层同样的取舍）。
 *   4. 页面切到后台就停 rAF，别在看不见的时候算。
 *
 * 反弹的两个细节（不加就会出问题）：
 *   - 每次反弹后给方向加一点随机偏转，否则会沿同一条对角线无限往返，
 *     看着像在轨道上滑动而不是在飘。
 *   - 分量太小的方向要拉开：几乎贴着水平或垂直走时，角色会沿着一条边
 *     蹭很久才弹一次。
 */
(function () {
  var IMG = 'assets/img/teacher.webp';
  var SPEED = 26;        /* px/s，飘动速度 */
  var SPIN = 13;         /* 度/s，自转速度。转一圈约 28 秒 */
  var MIN_RATIO = 0.24;  /* 速度分量下限（占 SPEED 的比例） */

  var box = null, img = null;
  var W = 0, H = 0, w = 0, h = 0;
  var x = 0, y = 0, vx = 0, vy = 0, rot = 0, spin = 0;
  var raf = 0, last = 0, running = false;

  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  function measure() {
    W = window.innerWidth;
    H = window.innerHeight;
    if (!box) return;
    w = box.offsetWidth;
    h = box.offsetHeight;
    /* 兜底：图片还没解码时 offsetHeight 是 0，w/h 拿到 0 就等于没有边界，
       角色会一路飘出视口（这个 bug 真的发生过）。宽度按 theme.css 里同一个
       clamp 推算，高度按图片固有比例 400:391。两处要一起改。 */
    if (!w) w = Math.min(Math.max(94, W * 0.13), 170);
    if (!h) h = w * 391 / 400;
  }

  /* 把速度方向偏转一个随机角后重新归一化。
     不这么做的话反弹是纯镜面反射，轨迹会退化成一条固定的对角线。 */
  function retarget() {
    var a = Math.atan2(vy, vx) + rnd(-0.45, 0.45);
    vx = Math.cos(a) * SPEED;
    vy = Math.sin(a) * SPEED;
    var lo = SPEED * MIN_RATIO;
    if (Math.abs(vx) < lo) vx = (vx < 0 ? -1 : 1) * lo;
    if (Math.abs(vy) < lo) vy = (vy < 0 ? -1 : 1) * lo;
    var m = Math.sqrt(vx * vx + vy * vy) || 1;
    vx = vx / m * SPEED;
    vy = vy / m * SPEED;
  }

  /* 当前角度下外接盒的半宽/半高（角色绕自身中心转）。
     只按未旋转的 w×h 判边界是不够的：45° 时外接盒最大约 1.41 倍，
     170px 宽的角色会占到 240px —— 左上角没越界，视觉上已经出框了。 */
  function bounds() {
    var rad = rot * Math.PI / 180;
    var c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    return { hw: (w * c + h * s) / 2, hh: (w * s + h * c) / 2 };
  }

  /* 在「旋转后也不出框」的允许范围里随机落一个位置。
     允许范围是中心点 ∈ [hw, W-hw] × [hh, H-hh]，再减半盒子换回左上角。 */
  function seed() {
    if (!w || !h) return;
    var b = bounds();
    var hw = Math.min(b.hw, W / 2), hh = Math.min(b.hh, H / 2);
    var loX = hw - w / 2, hiX = W - hw - w / 2;
    var loY = hh - h / 2, hiY = H - hh - h / 2;
    x = hiX > loX ? rnd(loX, hiX) : (W - w) / 2;
    y = hiY > loY ? rnd(loY, hiY) : (H - h) / 2;
  }

  /* 撞边：夹回 + 反转该轴速度 + 随机偏转。
     两件事不能省：
       - 夹回用**中心点 ± 外接盒半宽**，不是左上角 ± w/h；
       - 视角比外接盒还小时（窄屏/矮屏）没有可飘空间，`min(…, W/2)` 把角色钉在中间，
         否则反复夹来夹去会抖成一条竖线。 */
  function bounce() {
    if (!w || !h) return;              /* 图还没解码，量不到盒子 */
    var b = bounds();
    var hw = Math.min(b.hw, W / 2);
    var hh = Math.min(b.hh, H / 2);
    var cx = x + w / 2, cy = y + h / 2;
    var dirX = 0, dirY = 0;

    if (cx - hw < 0) { cx = hw; dirX = 1; }          /* 撞左墙 → 之后必须朝右 */
    else if (cx + hw > W) { cx = W - hw; dirX = -1; }
    if (cy - hh < 0) { cy = hh; dirY = 1; }
    else if (cy + hh > H) { cy = H - hh; dirY = -1; }

    if (!dirX && !dirY) return;
    x = cx - w / 2;
    y = cy - h / 2;
    retarget();
    /* retarget 是随机偏转，在角落两墙同时命中时可能又指回墙上 —— 强制朝内。
       Math.abs 只改符号不改大小，SPEED 保持不变。 */
    if (dirX) vx = Math.abs(vx) * dirX;
    if (dirY) vy = Math.abs(vy) * dirY;
  }

  function place() {
    if (!box) return;
    box.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + rot.toFixed(1) + 'deg)';
  }

  function step(now) {
    if (!running) return;
    var dt = Math.min((now - last) / 1000, 0.05);   /* 切回前台时别跳一大步 */
    last = now;
    x += vx * dt;
    y += vy * dt;
    rot = (rot + spin * dt) % 360;
    bounce();
    place();
    raf = requestAnimationFrame(step);
  }

  function ensure() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'dyg-drift';
    box.setAttribute('aria-hidden', 'true');
    img = document.createElement('img');
    img.src = IMG;
    img.alt = '';
    img.decoding = 'async';
    box.appendChild(img);
    document.body.appendChild(box);

    measure();
    rot = rnd(0, 360);
    spin = Math.random() < 0.5 ? -SPIN : SPIN;
    /* 初始位置也要按「旋转后」的盒子算，否则一启动就在边上裁掉一块 */
    seed();
    var a = rnd(0, Math.PI * 2);
    vx = Math.cos(a) * SPEED;
    vy = Math.sin(a) * SPEED;
    place();

    /* 图还没解码完时 offsetHeight 是 0，量出来的盒子不可信 → 解码后重新落位。
       盒子尺寸没变就别动，免得已经在飘的时候突然跳一下。 */
    function relayout() {
      var hadH = h;
      measure();
      if (hadH === h) return;
      seed();
      place();
    }
    if (img.complete && img.naturalWidth) relayout();
    else img.addEventListener('load', relayout);

    window.addEventListener('resize', function () {
      measure();
      bounce();            /* 变小后可能整个落在边界外，夹回来再继续 */
      if (!running) place();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (box && box.classList.contains('on')) {
        resume();
      }
    });
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
    measure();
    box.classList.add('on');
    resume();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (box) box.classList.remove('on');
  }

  window.__dygDrift = {
    start: start,
    stop: stop,
    /* 给测试用：位置、速度、转角、以及在不在动 */
    state: function () {
      return {
        mounted: !!box,
        on: !!(box && box.classList.contains('on')),
        running: running,
        x: Math.round(x), y: Math.round(y), rot: Math.round(rot),
        vx: Math.round(vx), vy: Math.round(vy),
        box: box ? [Math.round(w), Math.round(h)] : null,
        view: [W, H]
      };
    }
  };
})();
