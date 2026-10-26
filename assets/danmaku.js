/* ============================================================
   乐园皮肤的弹幕层
   ------------------------------------------------------------
   只在 ly 皮肤、起始页形态、宽屏、非「减弱动效」时工作。
   挂在 .st-mast（那块画布）里，借它的 overflow:hidden 裁在圆角内 ——
   所以弹幕不会飘到左右栏的文字上。

   位移交给 CSS animation（translate3d，走合成层，不占主线程）；
   JS 只干两件事：挑一条空轨、算出这次该跑多久。
   ------------------------------------------------------------
   轨道不重叠的算法：
     元素左边缘从 x=W 出发，速度 v，宽 w。
     上一条的右边缘要退到 W-GAP 之后，新的才能进场：
       W - v·t + w_prev <= W - GAP  →  t >= (w_prev + GAP) / v
     把这个时刻记在 lane.freeAt 上，新来的一条挑 freeAt 最早的轨道。
   ============================================================ */
(function () {
  'use strict';

  /* 预置弹幕：一半是通用弹幕梗，一半贴着这个站（游戏 / 二次元 / 收藏夹 / 壁纸）。 */
  var POOL = [
    '前方高能', '妙啊', 'awsl', '爷青回', 'DNA 动了', '泪目', '666',
    '这壁纸我锁屏用了半年', '第一次见这么会排版的主页', '老板大气',
    '八重樱开的时候记得叫我', '星穹铁道，发车', '小埋又在吃薯片了',
    '收藏夹比我的还整齐', '乐园皮肤天下第一', '这配色我先偷走了',
    '有没有人跟我一样蹲壁纸', '老师的图在哪找的', '巡林小队集合',
    '这波啊，这波是视觉盛宴'
  ];

  var SPEED = 116;        // px/s，比 B 站慢一点，读得完
  var LANE_H = 34;        // 轨道高（含行距）
  var GAP = 28;           // 同轨两条之间至少留这么多
  var MIN_GAP = 2400;     // 自动弹幕的间隔（毫秒，会加随机）
  var MAX_GAP = 5200;
  var MAX_USER = 20;      // 本地最多留 20 条自己的留言
  var KEY = 'dyg-dm';
  var MIN_W = 720;        // 窄到这个宽度就不放了，挤得没法看

  var layer = null, lanes = [], running = false, timer = 0, resizeT = 0;
  var lastIdx = -1;

  function readUser() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Object.prototype.toString.call(a) === '[object Array]' ? a : [];
    } catch (e) { return []; }
  }
  function writeUser(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_USER))); } catch (e) {}
  }

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------- 轨道 ---------- */
  function layout() {
    if (!layer) return;
    var h = layer.clientHeight, w = layer.clientWidth;
    /* 只用画布上半部分：下半是刊头（Hello World），弹幕压上去会糊成一片 */
    var usable = Math.max(0, Math.floor(h * 0.56));
    var n = Math.max(1, Math.min(8, Math.floor(usable / LANE_H)));
    var ns = [];
    for (var i = 0; i < n; i++) {
      var old = lanes[i];
      ns.push({
        y: 14 + i * LANE_H,
        /* 重排轨道后旧的时间戳不能直接沿用，否则会「一开局全挤在一条上」 */
        freeAt: old ? old.freeAt : 0
      });
    }
    lanes = ns;
    layer.style.width = w + 'px';
  }

  function ensure() {
    if (layer && layer.isConnected) return layer;
    layer = document.querySelector('[data-dm-layer]');
    if (!layer) return null;
    lanes = [];
    layout();
    return layer;
  }

  function pickLane(now) {
    var best = 0;
    for (var i = 1; i < lanes.length; i++) {
      if (lanes[i].freeAt < lanes[best].freeAt) best = i;
    }
    return lanes[best] && lanes[best].freeAt <= now ? best : -1;
  }

  /* ---------- 发射 ---------- */
  /* 画布不可见（切到博客形态、或 .start 被隐藏）就别发 ——
     元素照样会建、动画照样跑，白烧帧 */
  function visible() {
    return !!(layer && layer.isConnected && layer.clientWidth > 8);
  }

  function spawn(text, mine) {
    if (!layer || !lanes.length || !visible()) return null;
    text = String(text || '').trim().slice(0, 32);
    if (!text) return null;

    if (!visible()) return null;
    var now = performance.now();
    var idx = pickLane(now);
    /* 没有空轨就丢掉这条，别硬塞（硬塞会叠字） */
    if (idx < 0) return null;
    var lane = lanes[idx];

    var el = document.createElement('i');
    el.className = 'dm-item' + (mine ? ' is-mine' : '');
    el.textContent = text;
    el.style.top = lane.y + 'px';
    el.style.visibility = 'hidden';
    layer.appendChild(el);

    var W = layer.clientWidth;
    var w = el.offsetWidth;                       // 必须先入 DOM 才量得到
    var dur = (W + w) / SPEED;

    el.style.setProperty('--dm-from', W + 'px');
    el.style.setProperty('--dm-to', (-w) + 'px');
    el.style.animationDuration = dur.toFixed(3) + 's';
    el.style.visibility = '';

    lane.freeAt = now + ((w + GAP) / SPEED) * 1000;

    el.addEventListener('animationend', function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, { once: true });
    return el;
  }

  function nextText() {
    /* 自己留过的言有三分之一机会被翻出来重放，剩下的随机取预置 */
    var mine = readUser();
    if (mine.length && Math.random() < 0.33) {
      return { t: mine[Math.floor(Math.random() * mine.length)], mine: true };
    }
    var i = Math.floor(Math.random() * POOL.length);
    if (i === lastIdx) i = (i + 1) % POOL.length;   // 别连着两条一样
    lastIdx = i;
    return { t: POOL[i], mine: false };
  }

  function tick() {
    if (!running) return;
    var n = nextText();
    spawn(n.t, n.mine);
    timer = setTimeout(tick, MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP));
  }

  /* ---------- 对外 ---------- */
  function start(stillMode) {
    if (stillMode || reduceMotion()) { stop(); return; }
    if (window.innerWidth < MIN_W) { stop(); return; }
    if (!ensure()) return;
    if (running) return;
    running = true;
    /* 开局先铺三条（错开轨道），否则要等好几秒画面才有东西 */
    [0, 900, 1800].forEach(function (d) {
      setTimeout(function () {
        if (running) { var n = nextText(); spawn(n.t, n.mine); }
      }, d);
    });
    timer = setTimeout(tick, MIN_GAP + 1200);
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    timer = 0;
    clearTimeout(resizeT);
    if (layer) {
      [].slice.call(layer.querySelectorAll('.dm-item')).forEach(function (e) {
        if (e.parentNode) e.parentNode.removeChild(e);
      });
    }
    lanes = [];
  }

  function send(text) {
    var t = String(text || '').trim().slice(0, 32);
    if (!t) return false;
    var list = readUser();
    if (list.indexOf(t) < 0) { list.push(t); writeUser(list); }
    /* 发送的弹幕即使画布没开弹幕也要能看见 —— 先把这一层拉起来 */
    if (!layer || !layer.isConnected) { if (!ensure()) return false; }
    if (!lanes.length) layout();
    var el = spawn(t, true);
    return !!el;
  }

  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (running) layout(); }, 220);
  });

  /* 切到后台就停表：CSS 动画由浏览器自己挂起，但我们的定时器不会 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(timer);
    } else if (running) {
      clearTimeout(timer);
      timer = setTimeout(tick, MIN_GAP);
    }
  });

  window.__dygDanmaku = {
    start: start,
    stop: stop,
    send: send,
    /* 给测试用 */
    state: function () {
      return {
        running: running,
        lanes: lanes.length,
        on: layer ? layer.querySelectorAll('.dm-item').length : 0,
        box: layer ? [layer.clientWidth, layer.clientHeight] : null,
        pool: POOL.length,
        mine: readUser().length,
        items: layer ? [].map.call(layer.querySelectorAll('.dm-item'), function (e) {
          var r = e.getBoundingClientRect();
          return { t: e.textContent, x: Math.round(r.left), y: Math.round(r.top),
                   w: Math.round(r.width), mine: e.classList.contains('is-mine') };
        }) : []
      };
    }
  };
})();
