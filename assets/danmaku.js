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

  /* 预置弹幕，分四类混着用：
     ① 经典弹幕梗 ② 颜文字 ③ 夸赞 ④ 贴这个站的。
     素材是从公开的弹幕盘点里挑的，筛掉了带攻击性、牵扯具体明星或需要
     上下文才看得懂的那些 —— 这站不是视频，没有上下文，看不懂的梗等于噪音。
     长度大多控制在 12 字内，太长的一条要飘七八秒，会压住后面的。 */
  var POOL = [
    /* ① 经典梗 */
    '前方高能', '2333333', '红红火火恍恍惚惚', '真香', '火钳刘明',
    '空降成功', '讲个鬼故事，看进度条', '双手打字以示清白', '笑出猪叫声',
    '妈妈问我为什么跪着看', '不明觉厉', '好家伙', '破防了', '上头',
    '名场面', '认真你就输了', '是什么让我们相遇', '我裂开了', '绷不住了',
    '来人啊，给秀儿赐座', '这个我可以', '我从未见过如此厚颜无耻之人',
    '妙啊', 'awsl', '爷青回', '泪目', '666', 'DNA 动了',
    /* ② 颜文字 —— 弹幕文化里本来就有一大类是这个 */
    '(๑•̀ㅂ•́)و✧', 'ヽ(°▽°)ノ', '(´▽`ʃ♡ƪ)', '╮(￣▽￣)╭', '✧*。٩(ˊωˋ*)و✧*。',
    /* ③ 夸画面 */
    '神仙配色', '这构图绝了', '已收藏', '这手艺绝了',
    '什么神仙页面', '我愿意天天来', '这排版值一个赞', '细节拉满了',
    /* ④ 贴这个站 */
    '这壁纸我锁屏用了半年', '第一次见这么会排版的主页', '老板大气',
    '八重樱开的时候记得叫我', '星穹铁道，发车', '小埋又在吃薯片了',
    '收藏夹比我的还整齐', '乐园皮肤天下第一', '这配色我先偷走了',
    '有没有人跟我一样蹲壁纸', '老师的图在哪找的', '巡林小队集合',
    '这波啊，这波是视觉盛宴', '小埋的薯片分我一半', '收藏夹能借我抄抄吗',
    '乐园漫记单曲循环', '壁纸库该更新了吧', '弹幕从这儿飘过去真好看'
  ];

  var SPEED = 116;        // px/s，比 B 站慢一点，读得完
  var LANE_H = 34;        // 轨道高（含行距）
  var GAP = 28;           // 同轨两条之间至少留这么多
  /* 补水间隔：每轮看一眼「画面里还有几条」，少于 MIN_ON_SCREEN 就补一条。
     间隔别太长（空了没人补），也别太短（同时挤成一团）。 */
  var PUMP_MIN = 900;
  var PUMP_MAX = 1900;
  var MAX_USER = 20;      // 本地最多留 20 条自己的留言
  var KEY = 'dyg-dm';
  /* 480 而不是 720。现在层是 fixed 全屏 + clip-path，不依赖任何布局，
     窄屏也能正常飘；而 720 这个值在「1080 物理像素 + 200% 系统缩放」下会
     把 CSS 宽 540 误判成窄屏 → 弹幕直接不启动，用户永远看不到。
     这很可能是前面六轮都没解决的真正原因。 */
  var MIN_W = 480;

  var layer = null, lanes = [], running = false, timer = 0, resizeT = 0;
  var lastKick = {}, lastFail = '';
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
  /* 可见区边界（和 CSS 的 clip-path 同步）。
     inset(18% 30% 10% 17%) → 左右各裁 17% / 30% */
  function clipBox() {
    var W = layer ? layer.clientWidth : 0;
    return { left: W * 0.17, right: W * 0.70 };
  }

  function layout() {
    if (!layer) return;
    place();                       /* 先决定用哪条带（画布下 / 画布中） */
    /* 轨道范围直接按视口算，不去量任何元素 —— 层现在是 fixed 全屏，
       上下由 CSS 的 clip-path 裁掉，这里只要和它对齐就行。 */
    var vh = window.innerHeight;
    var top = vh * (layer.classList.contains('is-in-mast') ? 0.24 : 0.18);
    var bottom = vh * (layer.classList.contains('is-in-mast') ? 0.58 : 0.90);
    var usable = Math.max(0, bottom - top - 12);
    var n = Math.max(1, Math.min(8, Math.floor(usable / LANE_H)));
    var ns = [];
    for (var i = 0; i < n; i++) {
      var old = lanes[i];
      ns.push({ y: Math.round(top + 8 + i * LANE_H), freeAt: old ? old.freeAt : 0 });
    }
    lanes = ns;
  }

  function ensure() {
    if (layer && layer.isConnected) return layer;
    layer = document.querySelector('[data-dm-layer]');
    if (!layer) return null;
    lanes = [];
    layout();
    return layer;
  }

  /* 画布下方那一格的高度 = 画布底 到 搜索框顶 的距离。
     视口矮的时候上面几块会把 1fr 挤成 0，弹幕层就没地方了 ——
     这时候把它挪进画布中部（避开左下角的 Hello World 刊头），
     大屏再挪回来。不这么做的话，1440x600 以下弹幕永远是 0 高度，
     元素在发、但被 overflow 全裁掉，用户只会觉得「没有弹幕」。 */
  /* 120 而不是 90：90 时只放得下 2 条轨道，三条弹幕会挤在一起。
     120 能放 3 条，低于这个就干脆挪进画布（那里能放 4 条）。 */
  var MAST_MIN_GAP = 120;

  function place() {
    if (!layer) return;
    var mast = document.querySelector('.st-mast');
    var sp = document.querySelector('.search');
    if (!mast) return;
    var gap = sp ? (sp.getBoundingClientRect().top - mast.getBoundingClientRect().bottom) : 0;
    /* 画布和搜索框之间还有 120px 以上 → 用「画布底到搜索框顶」那条；
       挤没了就退到画布中部。两种都只是切 clip-path，不写像素。 */
    layer.classList.toggle('is-in-mast', gap < 120);
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

  var lastFail = '';
  function spawn(text, mine) {
    if (!layer) { lastFail = 'no-layer'; return null; }
    if (!lanes.length) { lastFail = 'no-lanes'; return null; }
    if (!visible()) { lastFail = 'invisible:cw=' + layer.clientWidth; return null; }
    text = String(text || '').trim().slice(0, 32);
    if (!text) return null;

    var now = performance.now();
    var idx = pickLane(now);
    /* 没有空轨就丢掉这条，别硬塞（硬塞会叠字） */
    if (idx < 0) {
      lastFail = 'no-lane free:' + lanes.map(function (l) { return Math.round(l.freeAt - now); }).join(',');
      return null;
    }
    lastFail = 'ok';
    var lane = lanes[idx];

    var el = document.createElement('i');
    /* 颜文字（含非中文/非 ASCII 符号的那些）单独给个类，字号要放大：
       14px 下一串半角符号挤成一团，看着是一堆小点，反而不如中文弹幕清楚。 */
    var kao = /[^\u4e00-\u9fa5A-Za-z0-9 ，。！？、：；（）]/.test(text);
    el.className = 'dm-item' + (mine ? ' is-mine' : '') + (kao ? ' is-kao' : '');
    el.textContent = text;
    el.style.top = lane.y + 'px';
    el.style.visibility = 'hidden';
    layer.appendChild(el);

    var W = layer.clientWidth;
    var w = el.offsetWidth;                       // 必须先入 DOM 才量得到

    /* 起点和终点要用**可见区**的边界，不是层的边界。
       层是 fixed 全屏（比如 2216 宽），但 clip-path 把右侧 30% 裁掉了 ——
       可见区右边界在 W*0.70。从 W 出发的话，弹幕要先在不可见区里走 665px，
       按 116px/s 要 5.7 秒才露头、走完全程 19 秒，用户根本等不到。
       实测层 2216 宽时就是这个症状：running=true、在飘 3 条，但一条都看不见。 */
    var box = clipBox();
    var from = Math.round(box.right) + 4;
    var to = Math.round(box.left - w) - 4;
    var dist = Math.max(80, from - to);
    /* 大屏要提速：固定 116px/s 在 2000px 宽的屏上要跑 12 秒，读都读完了还在飘 */
    var v = Math.max(SPEED, W * 0.13);
    var dur = dist / v;

    el.style.setProperty('--dm-from', from + 'px');
    el.style.setProperty('--dm-to', to + 'px');
    el.style.animationDuration = dur.toFixed(3) + 's';
    el.style.visibility = '';

    lane.freeAt = now + ((w + GAP) / v) * 1000;

    /* 生命周期用定时器管，不监听 animationend。
       动画事件在某些情况下会比预期早得多地触发（查了两轮没坐实原因），
       一旦早触发元素就被删了 —— 表现就是「发了但看不见」。
       定时器按算出来的时长兜底，早到不了、晚一点也无害（那时它已经在
       overflow 外面了，本来就不该被看见）。 */
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, Math.ceil(dur * 1000) + 400);
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

  var MIN_ON_SCREEN = 3;      // 低于这个数就补水

  function countOn() {
    return layer ? layer.querySelectorAll('.dm-item').length : 0;
  }

  function pump() {
    if (!running) return;
    if (!visible()) { timer = setTimeout(pump, 150); return; }   // 等层量出尺寸
    if (!lanes.length) layout();
    lastKick = { vis: true, cw: layer.clientWidth, on: countOn() };
    if (countOn() < MIN_ON_SCREEN) { var n = nextText(); spawn(n.t, n.mine); }
    timer = setTimeout(pump, PUMP_MIN + Math.random() * (PUMP_MAX - PUMP_MIN));
  }

  /* ---------- 对外 ---------- */
  function start(stillMode) {
    /* stillMode / reduceMotion 不再拦截启动（见 ui.js 那边的说明）：
       静默不显示比「动一点」更糟。参数留着是为了兼容调用方。 */
    if (window.innerWidth < MIN_W) { stop(); return; }
    if (!ensure()) return;
    if (running) return;
    running = true;
    /* 等层量出尺寸再开炮。
       层是刚被 syncDanmaku 拉起来的，这一刻它还排在网格里没量过，
       clientWidth 是 0 —— spawn 里的 visible() 会把开局这几条全当成
       「看不见」丢掉，结果就是「刷新后几乎没有弹幕」。
       这里用 setTimeout 轮询而不是 requestAnimationFrame：页面被判定为
       隐藏时（切后台、无头浏览器）rAF 会停，setTimeout 至少还会滴答。 */
    /* 保底补水：每 1~1.9 秒看一眼，画面上少于 3 条就补一条。
       原来是「开局用一串 setTimeout 一次铺满」，只要某一条因为层还没量出
       尺寸被丢掉，那就永远少一条，刷新几次看到 0 条、1 条都正常。
       现在改成持续补水 —— 任何一次失败，下一轮自然补上，不需要谁去补救。 */
    pump();
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
  /* .start 自己会滚（矮屏兜底），滚完搜索框上沿变了，层的 top/height 得重算 */
  window.addEventListener('scroll', function () {
    if (running && layer && !layer.classList.contains('is-in-mast')) place();
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(timer);
    } else if (running) {
      clearTimeout(timer);
      timer = setTimeout(pump, PUMP_MIN);
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
        poolList: POOL,
        kick: lastKick, fail: lastFail,
        layers: document.querySelectorAll('[data-dm-layer]').length,
        mine: readUser().length,
        items: layer ? (function () {
          var lr = layer.getBoundingClientRect();
          return [].map.call(layer.querySelectorAll('.dm-item'), function (e) {
            var r = e.getBoundingClientRect();
            /* x 是屏幕坐标（给人看的），rx 是相对容器左边缘的（给断言用的） */
            return { t: e.textContent, x: Math.round(r.left), rx: Math.round(r.left - lr.left),
                     y: Math.round(r.top), w: Math.round(r.width),
                     mine: e.classList.contains('is-mine') };
          });
        })() : []
      };
    }
  };
})();
