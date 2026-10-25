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
    if (box) { w = box.offsetWidth; h = box.offsetHeight; }
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

  function bounce() {
    var hit = false;
    if (x < 0) { x = 0; vx = -vx; hit = true; }
    else if (x > W - w) { x = W - w; vx = -vx; hit = true; }
    if (y < 0) { y = 0; vy = -vy; hit = true; }
    else if (y > H - h) { y = H - h; vy = -vy; hit = true; }
    if (hit) retarget();
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
    /* 从画面中间某一侧出发，方向随机 */
    x = rnd(0, Math.max(1, W - w));
    y = rnd(0, Math.max(1, H - h));
    var a = rnd(0, Math.PI * 2);
    vx = Math.cos(a) * SPEED;
    vy = Math.sin(a) * SPEED;
    rot = rnd(0, 360);
    spin = Math.random() < 0.5 ? -SPIN : SPIN;
    place();

    window.addEventListener('resize', function () {
      measure();
      /* 窗口变小后可能整个落在边界外，夹回来再继续 */
      x = Math.max(0, Math.min(x, Math.max(0, W - w)));
      y = Math.max(0, Math.min(y, Math.max(0, H - h)));
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
