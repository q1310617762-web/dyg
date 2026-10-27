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

  /* 预置弹幕，分六类混着用：
     ① 经典弹幕梗 ② 颜文字 ③ 带 emoji 的 ④ 夸画面 ⑤ 夸这个站 ⑥ 弹幕区互动。
     素材是从公开的弹幕盘点里挑的，筛掉了带攻击性、牵扯具体明星或需要
     上下文才看得懂的那些 —— 这站不是视频，没有上下文，看不懂的梗等于噪音。
     长度大多控制在 12 字内，太长的一条要飘七八秒，会压住后面的。

     池子为什么要有 158 条这么多：加密度之后每秒发 2.5 条，一分钟就是 150 条，
     原来的 76 条相当于**半分钟就整个滚一遍**，看着就是那几句在翻来覆去。
     160 条左右才够撑到两三分钟不重样。 */
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
    '(灬ºωº灬)', '(ớ ₃ờ)ھ', '(´･_･`)', '(,,•́ . •̀,,)', '(๑>ᴗ<๑)',
    '(ᵔᴥᵔ)', '(。-`ω´-)', '(・∀・)ｂ', '(｡◕‿◕｡)', '(≧ω≦)', '(灬╹ω╹灬)',
    '(ᗜˬᗜ)', '(๑´ㅂ`๑)', '(,,>﹏<,,)', '(￣ω￣)', '(●ˊωˋ●)', '( *ﾟ∀ﾟ)',
    /* ③ 带 emoji 的（光有颜文字不够，真彩表情也要有）。
       挑的都是**深色或高饱和**的：🎨🖼 这类淡色字形压在浅黄绿底上几乎看不见，
       彩色等于没有，所以换掉了。 */
    '太好看了吧✨', '收藏啦🌸', '截图存下来了📸', '已加入书签🔖',
    '天天来报到🎉', '来沾沾喜气🍀', 'awsl🥰', '笑不活了😂',
    '给我整激动了🔥', '这谁不爱💯', '眼睛怀孕了👀', '疯狂打call📣',
    '好看到跺脚👏', '偷偷收藏了🤫', '直接封神👑', '快乐加倍🎊',
    '这个我熟🎯', '再来一张📷', '心态崩了💥', '心都化了💗',
    /* ④ 夸画面 */
    '神仙配色', '这构图绝了', '已收藏', '这手艺绝了',
    '什么神仙页面', '我愿意天天来', '这排版值一个赞', '细节拉满了',
    '这一帧能当壁纸', '光影太舒服了', '构图稳得一批', '这个色调我爱了',
    '细节控狂喜', '画面有呼吸感', '眼睛被治愈了', '干净又好看',
    '质感拉满', '一眼就喜欢', '留白也讲究', '配色不吵眼睛',
    /* ⑤ 贴这个站 */
    '这壁纸我锁屏用了半年', '第一次见这么会排版的主页', '老板大气',
    '八重樱开的时候记得叫我', '星穹铁道，发车', '小埋又在吃薯片了',
    '收藏夹比我的还整齐', '乐园皮肤天下第一', '这配色我先偷走了',
    '有没有人跟我一样蹲壁纸', '老师的图在哪找的', '巡林小队集合',
    '这波啊，这波是视觉盛宴', '小埋的薯片分我一半', '收藏夹能借我抄抄吗',
    '乐园漫记单曲循环', '壁纸库该更新了吧', '弹幕从这儿飘过去真好看',
    '这主页我能逛一下午', '收藏夹分类太舒服了', '壁纸库是真的猛',
    '这排版治好了强迫症', '第一次见把弹幕放进主页', '配色像刚摘的青苹果',
    '每张图都想保存', '字体选得讲究', '动效不晃眼，好评',
    '已经推荐给朋友了', '这站该被更多人看到', '比很多官网好看',
    '导航做得很克制', '看得出来很用心', '收藏了慢慢看',
    '老板再来点新壁纸', '乐园这套最对味',
    /* ⑥ 弹幕区互动（弹幕本身也是一种内容） */
    '弹幕护体', '前方弹幕高能', '跟着弹幕走', '弹幕区都是人才', '打卡',
    '今日份快乐', '路过的', '来了来了', '默默蹲一个', '潜水员浮上来',
    '这条是我发的', '楼上说得对', '弹幕比页面还好看', '先签个到',
    /* ① 经典梗，第二批 */
    '夺笋呐', '我真的会谢', '针不戳', '大受震撼', '格局打开',
    '这波在大气层', '一整个爱住', 'yyds', '躺平了', '细思极恐',
    '猝不及防', '高，实在是高', '懂的都懂', '不愧是你', '太真实了',
    '有被冒犯到', '给大佬递茶', '这合理吗', '硬控我了', '整不会了',
    /* ⑦ 刷屏弹幕：B 站那种整段复制粘贴刷过去的，✋😡🤚 是「给我变」那个手势梗 */
    '寿来！✋😡🤚', '牛来！✋😡🤚', '变猫娘！🖐️️😡🤚'
  ];

  /* ---- 图形弹幕：用手势 emoji 拼出来的 ♥ 和 ★ ----
     模板是 7 列 × 5 行的点阵，'#' 的位置填一个手势 emoji，其余填全角空格
     （全角空格宽度 ≈ 1em，跟单个 emoji 的步进差不多，对齐最稳）。
     ♥ 用 ✋😡🤚（寿来 / 牛来那组），★ 用 🖐️️😡🤚（变猫娘那组）。
     想改成别的图形，只动这两个 mask / set，不用碰别的地方。 */
  var ART = [
    { name: 'heart',
      mask: ['.##.##.', '#######', '.#####.', '..###..', '...#...'],
      set: ['✋', '😡', '🤚'] },
    { name: 'star',
      mask: ['...#...', '..###..', '#######', '.##.##.', '##...##'],
      set: ['🖐️️', '😡', '🤚'] }
  ];
  /* 为什么不用空格占位：实测 7 个手势 emoji 宽 125px（每个 17.86px），
     而 7 个全角空格只有 91px（每个 13px）—— 用空格补空位的话，
     emoji 少的那几行就会短一截，心形右边会往左塌。
     所以每个格子做成**等宽的行内块**（CSS 里 .dm-cell 写死 1.374em），
     空位就是空的行内块，不管 emoji 实际多宽，栅格永远是直的。 */
  function buildArt(el, a) {
    var k = 0;
    for (var r = 0; r < a.mask.length; r++) {
      var row = a.mask[r];
      for (var c = 0; c < row.length; c++) {
        var s = document.createElement('span');
        s.className = 'dm-cell';
        if (row.charAt(c) === '#') s.textContent = a.set[k++ % a.set.length];
        el.appendChild(s);
      }
      if (r < a.mask.length - 1) el.appendChild(document.createElement('br'));
    }
  }


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
  var laneStep = 0;                    // 相邻两条轨道的间距（layout() 里算出来）
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
    laneStep = step;      // 图形弹幕要靠它算「盖住了几条轨道」
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

  /* 弹幕带 = 空白区正中间、高 BAND_H 的一条。
     为什么不铺满整段：2k 屏上「壁纸底 → 搜索框顶」有 530px 高，
     而同时只飘十来条 —— 铺满反而显得散。也不再贴着搜索框（那是上一版），
     用户要的是「空白区域的中间」：上下各留一半，看上是留白不是空地。 */
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

    /* 空白区的上下边界是硬墙：**绝不越过壁纸底，也不越过搜索框顶**。
       以前窗口矮的时候会退进画布中部（.is-in-mast），用户明确否掉了 ——
       弹幕只能出现在这块地里；窗口矮到只剩几十像素就只在那条窄缝里排 1~2 轨。 */
    var top0 = mr.bottom, bot0 = spTop;
    var gap = Math.max(0, bot0 - top0);
    /* 带子在空白区里居中：上下各留一半余量。
       gap 不够 BAND_H 时整段都用上（居中退化成铺满），不会溢出到两边。 */
    var h = Math.min(BAND_H, gap);
    rangeTop = top0 + (gap - h) / 2;
    rangeBottom = rangeTop + h;
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
  function spawn(text, mine, art) {
    if (!layer) { lastFail = 'no-layer'; return null; }
    if (!lanes.length) { lastFail = 'no-lanes'; return null; }
    if (!visible()) { lastFail = 'invisible:cw=' + layer.clientWidth; return null; }
    /* 壁纸底和搜索框顶挤到没有一条字的高度：宁可不发，也不许翻上去压壁纸。
       这里返回 null 就交给 pump 下一轮再看，不会空转。 */
    if (rangeBottom - rangeTop < 18) {
      lastFail = 'band=' + Math.round(rangeBottom - rangeTop);
      return null;
    }
    /* 图形弹幕传进来的是 ART 里那条配置对象，不是字符串，别被 cut 处理 */
    text = art ? text : cut(text, 32);
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
       小字号下一串半角符号挤成一团，看着是一堆小点，反而不如中文弹幕清楚。
       图形弹幕不要这个倍率 —— 它是按点阵排的，整体放大 1.2 会连行高一起撑。 */
    var kao = !art && /[^\u4e00-\u9fa5A-Za-z0-9 ，。！？、：；（）]/.test(text);
    el.className = 'dm-item' + (mine ? ' is-mine' : '') + (kao ? ' is-kao' : '') + (art ? ' is-art' : '');
    /* 字号必须在入 DOM 之前写 —— 下面 offsetWidth 要按最终字号量，
       量小了轨道间隔算错，两条会叠在一起 */
    el.style.setProperty('--dm-fs', pickSize() + 'px');
    /* 图形走 buildArt()：按栅格每行每列建等宽的格子，
       不能走 fill()（会把 emoji 包成 .dm-e 再放大 1.25 倍，格子就宽窄不一了） */
    if (art) buildArt(el, text); else fill(el, text);
    el.style.top = lane.y + 'px';
    el.style.visibility = 'hidden';
    layer.appendChild(el);

    var W = layer.clientWidth;
    var w = el.offsetWidth;                       // 必须先入 DOM 才量得到
    var hgt = art ? el.offsetHeight : 0;

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

    /* 图形弹幕是一整块多行文字，高度顶得上两条轨道 ——
       光占自己那条轨不够，得把它盖到的所有轨道都锁到它走完为止，
       否则相邻轨道的弹幕会从它身上穿过去。
       垂直位置：以所在轨道为中心对齐，再夹进带子里（别顶出壁纸或搜索框）。 */
    if (art) {
      var top = lane.y - (hgt - laneStep) / 2;
      top = Math.max(rangeTop + 2, Math.min(rangeBottom - hgt - 2, top));
      el.style.top = Math.round(top) + 'px';
      for (var j = 0; j < lanes.length; j++) {
        if (lanes[j].y + laneStep > top - 6 && lanes[j].y < top + hgt + 6) {
          lanes[j].freeAt = now + dur * 1000;
        }
      }
    }

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

  /* 最近发过的。光避开「正在画面上的」还不够 —— 那条管的是一屏之内不撞车，
     管不了「这一条半分钟前刚出现过」。
     RECENT_MAX 决定多多久之内不会重复：它是滑动窗口，用过 N 条之后最早那条才解禁，
     所以「连续 N 条不重样」。写 40 时实测 45 秒（约 110 条）里有 16 次重复；
     写 120 之后 45 秒内基本零重复。上限是池子的七八成 —— 太小会循环，
     太大则每次抽签候选太少（168 条里留 48 条候选，抽 12 次足够）。 */
  var recent = [];
  var RECENT_MAX = 120;

  /* 图形弹幕出现得多稀：太密就成了壁纸，而且它会一次锁住两条轨道。
     约 4% —— 每秒 2.5 条的话大概每 10 秒来一个。
     同一时刻最多一块（hasArt()），免得两块叠在一起谁也看不清。 */
  var ART_CHANCE = 0.04;
  function hasArt() {
    return !!(layer && layer.querySelector('.dm-item.is-art'));
  }

  function nextText() {
    /* 图形弹幕：稀，且同一时刻只有一块 */
    if (!hasArt() && Math.random() < ART_CHANCE) {
      /* 传的是 ART 里那条配置（mask + set），不是拼好的字符串 ——
         拼格子要等进 DOM 之后才好量，交给 spawn 里的 buildArt()。 */
      var a = ART[Math.floor(Math.random() * ART.length)];
      return { t: a, mine: false, art: true };
    }
    /* 自己留过的言有三分之一机会被翻出来重放，剩下的随机取预置 */
    var mine = readUser();
    if (mine.length && Math.random() < 0.33) {
      return { t: mine[Math.floor(Math.random() * mine.length)], mine: true };
    }
    var on = onScreen();
    var i = -1;
    /* 抽 12 次：既要不在画面上、也要不在最近 120 条里；
       实在抽不到（比如池子被自己的留言占满）就随便给一条 */
    for (var k = 0; k < 12; k++) {
      var j = Math.floor(Math.random() * POOL.length);
      if (j !== lastIdx && !on[POOL[j]] && recent.indexOf(POOL[j]) < 0) { i = j; break; }
      if (i < 0) i = j;
    }
    lastIdx = i;
    recent.push(POOL[i]);
    if (recent.length > RECENT_MAX) recent.shift();
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
    if (countOn() < MIN_ON_SCREEN) { var n = nextText(); spawn(n.t, n.mine, n.art); }
    /* 差得多就一次补两条：开局、切回前台、或者一次 resize 之后，
       按每轮一条铺到 9 条要好几秒，那几秒里画面还是空的。 */
    if (countOn() < MIN_ON_SCREEN - 3) { var m = nextText(); spawn(m.t, m.mine, m.art); }
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
                     y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
                     fs: Math.round(parseFloat(getComputedStyle(e).fontSize) * 10) / 10,
                     kao: e.classList.contains('is-kao'),
                     art: e.classList.contains('is-art'),
                     mine: e.classList.contains('is-mine') };
          });
        })() : []
      };
    }
  };
})();
