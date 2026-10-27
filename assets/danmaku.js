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
    '(≧∇≦)ﾉ', '(*´∀`)~♥', '(￣▽￣)ノ', '(*/ω＼*)', '(｡･ω･｡)ﾉ♡',
    '∑(ﾟДﾟノ)ノ', 'o(╥﹏╥)o', '٩(๑❛ᴗ❛๑)۶', '(๑˃̵ᴗ˂̵)و',
    /* ③ 带 emoji 的（光有颜文字不够，真彩表情也要有）。
       挑的都是**深色或高饱和**的：🎨🖼 这类淡色字形压在浅黄绿底上几乎看不见，
       彩色等于没有，所以换掉了。 */
    '太好看了吧✨', '收藏啦🌸', '截图存下来了📸', '已加入书签🔖',
    '天天来报到🎉', '来沾沾喜气🍀', 'awsl🥰', '笑不活了😂',
    /* ④ 夸画面 */
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

  /* 字号档位：真弹幕本来就有大有小，全用 14px 看着像一堵砖墙。
     每发一条随机抽一档，写进 --dm-fs，CSS 的 font-size 读这个变量
     （不能写 inline 的 font-size —— 那会和「换肤零位移」那条规矩打架，
     而且没法让颜文字按同比例放大）。
     权重偏向中间两档：最大和最小都是点缀，多了就乱、看着像故障。 */
  var SIZES = [
    { px: 12.5, w: 0.26 },
    { px: 14.5, w: 0.38 },
    { px: 17.5, w: 0.24 },
    { px: 20.5, w: 0.12 }
  ];
  var SIZE_W = SIZES.reduce(function (a, s) { return a + s.w; }, 0);
  function pickSize() {
    var r = Math.random() * SIZE_W;
    for (var i = 0; i < SIZES.length; i++) { r -= SIZES[i].w; if (r <= 0) return SIZES[i].px; }
    return SIZES[1].px;
  }

  /* emoji 的字形自带一圈内边距，同一个 font-size 下画出来只有中文的 ~0.8 倍，
     17px 的弹幕里那个 🎉 小得像一粒灰。所以把 emoji 单独包成 .dm-e 放大一号。
     这里用 ES6 的 u 标志（\u{...} 需要它），站点其它地方没有更强的语法要求，没问题。 */
  var EMO_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]+/gu;

  /* 把文字填进元素：没有 emoji 就整段 textContent，有就按 emoji 切开。
     全程用 createTextNode，不拼 innerHTML —— 这是用户输入，不能过 HTML 解析。 */
  function fill(el, text) {
    if (!EMO_RE.test(text)) { el.textContent = text; return 0; }
    EMO_RE.lastIndex = 0;
    var i = 0, n = 0, m;
    while ((m = EMO_RE.exec(text))) {
      if (m.index > i) el.appendChild(document.createTextNode(text.slice(i, m.index)));
      var s = document.createElement('span');
      s.className = 'dm-e';
      s.textContent = m[0];
      el.appendChild(s);
      i = m.index + m[0].length;
      n++;
    }
    if (i < text.length) el.appendChild(document.createTextNode(text.slice(i)));
    return n;
  }

  /* 截断别把 emoji 劈成两半（surrogate pair 切一半会渲染成 �） */
  function cut(s, max) {
    var t = String(s || '').trim();
    if (t.length <= max) return t;
    t = t.slice(0, max);
    var c = t.charCodeAt(t.length - 1);
    if (c >= 0xD800 && c <= 0xDBFF) t = t.slice(0, -1);
    return t;
  }

  var SPEED = 116;        // px/s，比 B 站慢一点，读得完
  /* 轨道间距下限。最坏一条的行盒是：最大档 20.5px × 1.2(颜文字) × 1.25(emoji)
     × 1.25(行高) ≈ 38px，所以间距不能低于 40，否则大号的带 emoji 弹幕
     会和相邻轨道的糊到一起。写 36 时 208px 的带子会排 5 轨（step 41.6）没问题，
     但更矮的带子（150px）会排 4 轨、step 37.5，就压线了。 */
  var LANE_H = 40;
  var GAP = 28;           // 同轨两条之间至少留这么多
  /* 补水间隔：每轮看一眼「画面里还有几条」，少于 MIN_ON_SCREEN 就补一条。
     这个值受一条硬约束：一条弹幕从进场到出场大约 4.5 秒（宽屏 v≈280px/s、
     全程 ~1300px），所以要在画面上同时维持 N 条，每秒就得发出 N/4.5 条。
     想维持 12 条 → 每秒得发 12/4.5≈2.7 条，间隔写 250~650 才供得上；
     写 700~1500 的话发送速度追不上消失速度，画面永远停在五六条。
     （实测 2216×1145：300~800 → 平均 7.7 条；250~650 → 10 条；220~580 → 10.3 条。
     再快也上不去了 —— 补水是一轮一条，池子再密就成糊墙了。峰值都是 12。） */
  var PUMP_MIN = 220;
  var PUMP_MAX = 580;
  var MAX_USER = 20;      // 本地最多留 20 条自己的留言
  var KEY = 'dyg-dm';
  /* 480 而不是 720。现在层是 fixed 全屏 + clip-path，不依赖任何布局，
     窄屏也能正常飘；而 720 这个值在「1080 物理像素 + 200% 系统缩放」下会
     把 CSS 宽 540 误判成窄屏 → 弹幕直接不启动，用户永远看不到。
     这很可能是前面六轮都没解决的真正原因。 */
  var MIN_W = 480;

  var layer = null, lanes = [], running = false, timer = 0, resizeT = 0;
  var lastKick = {}, lastFail = '';
  var rangeTop = 0, rangeBottom = 0;   // 弹幕可见区的上下边界（像素，视口坐标）
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
    place();
    /* 轨道全部落在可见区里 —— rangeTop / rangeBottom 由 place() 算好，
       就是 clip-path 裁出来的那条带，不再自己猜百分比。 */
    var usable = Math.max(0, rangeBottom - rangeTop - 12);
    var n = Math.max(1, Math.min(8, Math.floor(usable / LANE_H)));
    /* 轨道在整条带里**均分**，不是按 LANE_H 一条条贴着往上堆。
       带子通常有五百多像素高（画布底 → 搜索框顶），按 36px 堆 8 条只占上半截，
       下面一大片永远空着 —— 一屏里一半留白是设计红线里明写不许的。
       上限 10 条，再多就成密集恐惧；矮屏仍然退回按 LANE_H 紧排。 */
    var step = usable / n;
    var ns = [];
    for (var i = 0; i < n; i++) {
      var old = lanes[i];
      ns.push({ y: Math.round(rangeTop + 8 + i * step), freeAt: old ? old.freeAt : 0 });
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

  /* 弹幕带 = 搜索框上沿往上 BAND_H 的一条，只占画布下方那片空白的下半截。
     为什么不铺满整段：2k 屏上「壁纸底 → 搜索框顶」有 530px 高，
     而同时只有五六条在飘 —— 一条孤零零横在正中，像屏幕上的一粒灰，不像弹幕。
     收成 220px（约 5 条轨道）后弹幕都聚在搜索框上方，上面的留白交回给版面。 */
  var BAND_H = 220;

  /* 上边界是硬墙：**绝不越过壁纸底**。
     以前窗口矮的时候会退进画布中部（.is-in-mast），用户明确否掉了这条 ——
     弹幕只能出现在壁纸下方、搜索框上方这块地里。所以现在哪怕只剩三四十像素，
     也只在这条窄缝里排 1~2 条轨道，不再翻上去画在画面上。 */
  function place() {
    if (!layer) return;
    var mast = document.querySelector('.st-mast');
    var sp = document.querySelector('.search');
    if (!mast || !sp) return;
    var mr = mast.getBoundingClientRect();
    var spTop = sp.getBoundingClientRect().top;

    rangeBottom = spTop;
    rangeTop = Math.max(mr.bottom, spTop - BAND_H);
    /* 上下用像素精确传给 clip-path，左右仍由 CSS 的百分比管 */
    layer.style.setProperty('--dm-top', Math.round(rangeTop) + 'px');
    layer.style.setProperty('--dm-bottom', Math.round(window.innerHeight - rangeBottom) + 'px');
  }

  /* 在所有空轨里**随机**挑一条。
     原来是「挑 freeAt 最早的那条」，等于从上往下一条条填 —— 带子有五百多像素高，
     结果是弹幕永远挤在最上面三行，下面三分之二一片空白。随机挑就自然散开，
     整条带子都会用到；仍然只挑空的，所以不会叠字。 */
  function pickLane(now) {
    var free = [];
    for (var i = 0; i < lanes.length; i++) {
      if (lanes[i].freeAt <= now) free.push(i);
    }
    if (!free.length) return -1;
    return free[Math.floor(Math.random() * free.length)];
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
    /* 壁纸底和搜索框顶挤到没有一条字的高度：宁可不发，也不许翻上去压壁纸。
       这里返回 null 就交给 pump 下一轮再看，不会空转。 */
    if (rangeBottom - rangeTop < 18) {
      lastFail = 'band=' + Math.round(rangeBottom - rangeTop);
      return null;
    }
    text = cut(text, 32);
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
    /* 颜文字 / emoji（含非中文、非 ASCII 符号的那些）单独给个类，字号按倍率放大：
       小字号下一串半角符号挤成一团，看着是一堆小点，反而不如中文弹幕清楚。 */
    var kao = /[^\u4e00-\u9fa5A-Za-z0-9 ，。！？、：；（）]/.test(text);
    el.className = 'dm-item' + (mine ? ' is-mine' : '') + (kao ? ' is-kao' : '');
    /* 字号必须在入 DOM 之前写 —— 下面 offsetWidth 要按最终字号量，
       量小了轨道间隔算错，两条会叠在一起 */
    el.style.setProperty('--dm-fs', pickSize() + 'px');
    fill(el, text);
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
    /* 时长写成变量，不写 animation-duration —— 见 theme.css 里的说明：
       全局的 `prefers-reduced-motion` 规则用 !important 压掉了 inline 的
       animation-duration，只有 var() 能在那种情况下保住原值。 */
    el.style.setProperty('--dm-dur', dur.toFixed(3) + 's');
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

  /* 画面上正在飘的那些文字。密起来以后（同时十来条）撞车的概率不小 ——
     76 条池子里抽 12 条，同一屏出现两条「天天来报到🎉」看着很廉价。 */
  function onScreen() {
    var s = {};
    if (layer) {
      var ns = layer.querySelectorAll('.dm-item');
      for (var i = 0; i < ns.length; i++) s[ns[i].textContent] = 1;
    }
    return s;
  }

  function nextText() {
    /* 自己留过的言有三分之一机会被翻出来重放，剩下的随机取预置 */
    var mine = readUser();
    if (mine.length && Math.random() < 0.33) {
      return { t: mine[Math.floor(Math.random() * mine.length)], mine: true };
    }
    var on = onScreen();
    var i = -1;
    /* 抽 8 次，避开已经在画面上的；实在抽不到（池子被占满）就随便给一条 */
    for (var k = 0; k < 8; k++) {
      var j = Math.floor(Math.random() * POOL.length);
      if (j !== lastIdx && !on[POOL[j]]) { i = j; break; }
      if (i < 0) i = j;
    }
    lastIdx = i;
    return { t: POOL[i], mine: false };
  }

  /* 12：用户要「密一些」。轨道只有 5 条，但同一条轨道可以前后错开排好几条
     （前一条挪出 GAP 之后就能放下一条，宽屏上只要 0.6 秒），所以「几轨」不等于
     「几条」—— 5 条轨道上可以同时在飘十来条。可见区 1157px 宽，一条平均 110px
     加 28 间距，一条轨道最多排得下 8 条，12 条摊到 5 轨平均每轨 2.4 条，还早。 */
  var MIN_ON_SCREEN = 12;     // 低于这个数就补水

  function countOn() {
    return layer ? layer.querySelectorAll('.dm-item').length : 0;
  }

  function pump() {
    if (!running) return;
    if (!visible()) { timer = setTimeout(pump, 150); return; }   // 等层量出尺寸
    if (!lanes.length) layout();
    lastKick = { vis: true, cw: layer.clientWidth, on: countOn() };
    if (countOn() < MIN_ON_SCREEN) { var n = nextText(); spawn(n.t, n.mine); }
    /* 差得多就一次补两条：开局、切回前台、或者一次 resize 之后，
       按每轮一条铺到 9 条要好几秒，那几秒里画面还是空的。 */
    if (countOn() < MIN_ON_SCREEN - 3) { var m = nextText(); spawn(m.t, m.mine); }
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
    var t = cut(text, 32);
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
    if (running && layer) place();
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
                     fs: Math.round(parseFloat(getComputedStyle(e).fontSize) * 10) / 10,
                     kao: e.classList.contains('is-kao'),
                     mine: e.classList.contains('is-mine') };
          });
        })() : []
      };
    }
  };
})();
