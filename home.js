/* ============================================================
   home.js · 首页双形态
   起始页 ⇄ 博客。只管三件事：时间、搜索、形态。

   ── 为什么形态记在 sessionStorage ─────────────────────────
   这是「浏览器起始页」，新开标签页就该看到时间与搜索框；
   但从文章页点回首页时，人还想接着看博客，不该被踢回起始页。
   sessionStorage 的生命周期正好等于一个标签页的旅程，所以用它。
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;

  /* ============================================================
     一、时间与日期
     ============================================================ */
  var elTime, elDate, elHello;

  /* 起始页可能被路由整个搬进来，节点会换一批 —— 引用要能重新取 */
  function grabTime() {
    elTime  = document.querySelector('[data-time]');
    elDate  = document.querySelector('[data-date]');
    elHello = document.querySelector('[data-hello]');
  }
  grabTime();

  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function greet(h) {
    if (h < 5)  return '还没睡？';
    if (h < 9)  return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }

  function tick() {
    var d = new Date();

    /* 三卡片时钟：时 / 分 / 秒各自一个数字。元素每次现查，
       因为起始页节点会被路由整体换掉。 */
    var eh = document.querySelector('[data-hour]');
    var em = document.querySelector('[data-minute]');
    var es = document.querySelector('[data-second]');
    if (eh) eh.textContent = pad(d.getHours());
    if (em) em.textContent = pad(d.getMinutes());
    if (es) es.textContent = pad(d.getSeconds());

    /* 日期用短式：10 月 22 日 周四 */
    if (elDate)  elDate.textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' +
                                      WEEK[d.getDay()].replace('星期', '周');
    if (elHello) elHello.textContent = greet(d.getHours());

    /* 旧圆环的进度弧（结构已换掉，这里留着兼容，匹配不到就跳过） */
    var arc = document.querySelector('[data-clock-arc]');
    if (arc) {
      var pct = (d.getHours() * 3600 + d.getMinutes() * 60) / 86400;
      arc.style.strokeDashoffset = (703.72 * (1 - pct)).toFixed(2);
    }

    /* 有秒位，按秒对齐刷新。只改三个 textContent，开销可以忽略。 */
    setTimeout(tick, 1000 - d.getMilliseconds());
  }
  tick();

  /* ============================================================
     二、搜索
     ============================================================ */
  var form, q, engBtn, engMenu, engName;

  function grabSearch() {
    form    = document.querySelector('[data-search]');
    q       = document.querySelector('[data-q]');
    engBtn  = document.querySelector('[data-eng-btn]');
    engMenu = document.querySelector('[data-eng-menu]');
    engName = document.querySelector('[data-eng-name]');
  }
  grabSearch();

  var ENGINES = {
    bing:   { name: 'Bing',   url: 'https://www.bing.com/search?q=' },
    baidu:  { name: '百度',   url: 'https://www.baidu.com/s?wd=' },
    google: { name: 'Google', url: 'https://www.google.com/search?q=' }
  };

  var engine = 'bing';
  try { engine = localStorage.getItem('dyg-engine') || 'bing'; } catch (e) {}
  if (!ENGINES[engine]) engine = 'bing';

  function paintEngine() {
    if (engName) engName.textContent = ENGINES[engine].name;
    if (!engMenu) return;
    [].slice.call(engMenu.querySelectorAll('button[data-e]')).forEach(function (b) {
      b.setAttribute('aria-checked', b.dataset.e === engine ? 'true' : 'false');
    });
  }

  var menuOpen = false;
  function setMenu(open) {
    menuOpen = !!open;
    grabSearch();
    if (!engMenu || !engBtn) return;
    engMenu.hidden = !open;
    engBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* 委托而不是直接绑元素：起始页被路由换掉后，直接绑的监听会跟着旧节点一起失效 */
  document.addEventListener('click', function (e) {
    var t = e.target;

    if (t.closest && t.closest('[data-eng-btn]')) {
      e.stopPropagation();                 // 别让「点外面关闭」立刻把它关掉
      setMenu(!menuOpen);
      return;
    }

    var item = t.closest && t.closest('[data-eng-menu] [data-e]');
    if (item) {
      engine = item.dataset.e;
      try { localStorage.setItem('dyg-engine', engine); } catch (e2) {}
      grabSearch();
      paintEngine();
      setMenu(false);
      if (q) q.focus();                    // 选完直接接着打字
      return;
    }

    if (menuOpen && !(t.closest && t.closest('[data-search]'))) setMenu(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !menuOpen) return;
    setMenu(false);
    grabSearch();
    if (q) q.focus();
  });

  paintEngine();

  /* 看起来像域名就直接跳过去，否则丢给搜索引擎 */
  function looksLikeUrl(s) {
    if (/\s/.test(s)) return false;
    if (/^https?:\/\//i.test(s)) return true;
    return /^([\w-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s);
  }

  document.addEventListener('submit', function (e) {
    if (!e.target.matches || !e.target.matches('[data-search]')) return;
    e.preventDefault();
    grabSearch();
    if (!q) return;
    var v = q.value.trim();
    if (!v) { q.focus(); return; }
    if (looksLikeUrl(v)) {
      location.href = /^https?:\/\//i.test(v) ? v : 'https://' + v;
    } else {
      location.href = ENGINES[engine].url + encodeURIComponent(v);
    }
  });

  /* ============================================================
     三、形态切换
     ============================================================ */
  var switchTimer = 0;

  function paintSwitches(m) {
    [].slice.call(document.querySelectorAll('.modesw')).forEach(function (w) {
      w.setAttribute('data-at', m);
      [].slice.call(w.querySelectorAll('[data-goto]')).forEach(function (b) {
        var on = b.getAttribute('data-goto') === m;
        b.classList.toggle('on', on);
        if (on) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
    });
  }

  function urlFor(m) {
    var base = (location.pathname.split('/').pop() || 'index.html');
    return m === 'blog' ? base + '?m=blog' : base;
  }

  /* 只同步「哪一块可见 / 可否交互 / 开关停在哪」，不做动画也不加锁。
     站内路由换页时用它：既保证 inert 被复位，也不会每次跳页锁 0.7 秒点击。 */
  function syncChrome(m) {
    paintSwitches(m);

    var st = document.querySelector('[data-start]');
    var bl = document.querySelector('[data-blog]');
    if (st) st.setAttribute('aria-hidden', m === 'blog' ? 'true' : 'false');
    if (bl) {
      bl.setAttribute('aria-hidden', m === 'blog' ? 'false' : 'true');
      // 光靠「推到画面外」不够：Tab 和读屏照样能进去
      if ('inert' in bl) bl.inert = (m !== 'blog');
    }
  }

  /* 博客形态里的大图（hero 横幅、文章封面、相册条）一开始只写了 data-src，
     所以起始页冷启动不会去拉它们 —— 实测那 15 张图合计 1.8MB，
     而起始页一张都不显示。切到博客形态时在这里补一次，只补一次。 */
  var blogImagesLoaded = false;
  function hydrateBlogImages() {
    if (blogImagesLoaded) return;
    blogImagesLoaded = true;
    var n = document.querySelectorAll('.blog [data-src]');
    for (var i = 0; i < n.length; i++) {
      var d = n[i].getAttribute('data-src');
      if (d) { n[i].setAttribute('src', d); n[i].removeAttribute('data-src'); }
    }
    if (window.__dygGallery) window.__dygGallery();
  }

  function setMode(m, push) {
    if (m !== 'blog') m = 'start';
    var was = root.getAttribute('data-mode');
    root.setAttribute('data-mode', m);

    try { sessionStorage.setItem('dyg-mode', m); } catch (e) {}

    syncChrome(m);

    document.title = m === 'blog'
      ? '东芽果 DYG · 记录游戏、动画和音乐'
      : '东芽果 DYG';

    // 切换途中锁住点击，避免连点把状态点乱
    root.setAttribute('data-switching', '');
    clearTimeout(switchTimer);
    switchTimer = setTimeout(function () { root.removeAttribute('data-switching'); }, 1600);

    if (m === 'blog') {
      hydrateBlogImages();
      if (was !== 'blog') window.scrollTo(0, 0);
    }

    if (push) {
      try { history.pushState({ m: m }, '', urlFor(m)); } catch (e) {}
    }
    document.dispatchEvent(new CustomEvent('modechange', { detail: { mode: m } }));
  }

  /* ============================================================
     三·五、波纹切换
     从按钮中心放一个圆，圆的边缘就是「旧页面 / 新页面」的分界。
     用 View Transition 拿两张快照：旧的在下面不动，新的被 clip-path 慢慢揭开。
     这样被盖到的区域当场就是目标页面，不是先盖一块颜色再换。
     ============================================================ */
  function motionOff() {
    /* 必须用 ui.js 那一份：它尊重「强制开启动画」的开关。
       各写一份的后果是——用户在页面里点开了动画，换页有波纹，
       形态切换却还按系统 reduce 走淡入，看起来就是「反复切换没有特效」。 */
    if (window.__dygUi && window.__dygUi.motionOff) return window.__dygUi.motionOff();
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function makeCircle(cls, cx, cy, radius) {
    var el = document.createElement('div');
    el.className = cls;
    var d = radius * 2;
    el.style.width = d + 'px';
    el.style.height = d + 'px';
    el.style.left = (cx - radius) + 'px';
    el.style.top = (cy - radius) + 'px';
    document.body.appendChild(el);
    return el;
  }

  /* 不支持 View Transition 时：实心圆盖满 → 换页 → 淡出 */
  function fallbackRipple(m, cx, cy, radius) {
    var cover = makeCircle('rip-cover', cx, cy, radius);
    var grow = cover.animate(
      [{ transform: 'scale(0)' }, { transform: 'scale(1)' }],
      { duration: 320, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }
    );
    grow.finished.then(function () {
      setMode(m, true);
      return cover.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: 220, easing: 'ease-out', fill: 'forwards' }).finished;
    }).then(function () { cover.remove(); }, function () { cover.remove(); });
  }

  var switching = false;

  /* 把「这次用哪条路径」写在 <html data-switch-mode> 上：
     vt = 波纹揭示 / soft = 减弱动效下的淡入 / fallback = 无 VT 的实心圆 / cut = 直接切。
     用户说「没特效」时，看一眼这个属性就知道卡在哪一段。 */
  function markSwitch(how) { root.setAttribute('data-switch-mode', how); }

  /* 把圆心写死进关键帧。
     自定义属性能不能继承到 ::view-transition-* 伪元素，各浏览器不一样；
     一旦继承失败就会静默退化成默认的 50% 50% —— 波纹从屏幕中间炸开。
     与其赌继承，不如每次切换时生成一条带具体坐标的 @keyframes。 */
  var ripSeq = 0;
  function setRippleFrames(cx, cy, radius, dur, ease) {
    /* 换页和形态切换必须长得一样，所以真正的实现只有一份，在 ui.js 里 */
    if (window.__dygUi && window.__dygUi.ripple) {
      window.__dygUi.ripple.inject(cx, cy, radius, dur, ease);
      return;
    }
    var st = document.getElementById('rip-kf');
    if (!st) {
      st = document.createElement('style');
      st.id = 'rip-kf';
      document.head.appendChild(st);
    }
    var name = 'ripKf' + (++ripSeq);        // 每次换名字，避免同名关键帧不刷新
    /* 波纹从按钮出发时，圆里露出的内容和旧页面几乎一样（都是那条导航栏），
       没有色差就完全看不出「从哪儿开始」——肉眼会以为它从画面中间冒出来。
       试过 drop-shadow：CSS 是「先滤镜后裁剪」，光晕正好被圆裁掉，没用。
       所以改成让旧页面在揭示过程中逐渐变暗：
       圆内是正常亮度的新页面，圆外越来越暗，边界永远有色差。 */
    st.textContent =
      'html[data-vt="ripple"]::view-transition-new(root){animation:' + name + ' ' + dur + 'ms ' + ease + ' both;}' +
      '@keyframes ' + name + '{' +
        'from{clip-path:circle(0px at ' + cx + 'px ' + cy + 'px);}' +
        'to{clip-path:circle(' + radius + 'px at ' + cx + 'px ' + cy + 'px);}' +
      '}' +
      'html[data-vt="ripple"]::view-transition-old(root){animation:' + name + 'Dim ' + dur + 'ms linear both;}' +
      '@keyframes ' + name + 'Dim{from{filter:brightness(1)}to{filter:brightness(.55)}}';
  }

  var LEAD = 280;          // 指示器滑动的时间
  var RIP_DUR = 1100;      // 波纹扩散的时长
  var RIP_EASE = 'linear';                        // 匀速扩散，最像水面

  function switchMode(origin, m) {
    if (m !== 'blog') m = 'start';
    if (m === root.getAttribute('data-mode')) return;
    if (switching) return;                 // 连点直接忽略，避免叠两次快照

    var soft = motionOff();                // 系统关了「动画效果」
    var canVT = typeof document.startViewTransition === 'function';

    if (!canVT && !soft) {                 // 旧浏览器：实心圆盖满再换
      if (!origin) { setMode(m, true); markSwitch('cut'); return; }
      var r0 = origin.getBoundingClientRect();
      var cx0 = r0.left + r0.width / 2;
      var cy0 = r0.top + r0.height / 2;
      var rad0 = Math.hypot(Math.max(cx0, window.innerWidth - cx0),
                            Math.max(cy0, window.innerHeight - cy0));
      switching = true;
      markSwitch('fallback');
      fallbackRipple(m, cx0, cy0, rad0);
      setTimeout(function () { switching = false; }, 560);
      return;
    }

    if (soft) {
      // 减弱动效不等于没有：位移和扩散取消，但留一个 160ms 的淡入，别硬切
      if (!canVT) { setMode(m, true); markSwitch('cut'); return; }
      switching = true;
      root.setAttribute('data-switching', '');
      root.setAttribute('data-soft-switch', '');
      markSwitch('soft');
      var vt0 = document.startViewTransition(function () { setMode(m, true); });
      vt0.finished.catch(function () {}).then(function () {
        switching = false;
        root.removeAttribute('data-switching');
        root.removeAttribute('data-soft-switch');
      });
      return;
    }

    var r = origin.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    // 半径取到最远的那个角，保证圆一定能盖满整屏
    var radius = Math.hypot(
      Math.max(cx, window.innerWidth - cx),
      Math.max(cy, window.innerHeight - cy)
    );

    // 变量仍然保留一份（给不支持注入回退的极端情况兜底）
    root.style.setProperty('--rip-x', cx + 'px');
    root.style.setProperty('--rip-y', cy + 'px');
    root.style.setProperty('--rip-r', radius + 'px');
    setRippleFrames(cx, cy, radius, RIP_DUR, RIP_EASE);

    switching = true;
    root.setAttribute('data-switching', '');
    markSwitch('vt');

    // 第一步：先只动按钮 —— 让指示器滑到另一段。
    // 不能直接切页面：View Transition 一开，看到的就是快照，
    // 按钮的滑动会被冻结在终态，等于没动画。
    paintSwitches(m);

    setTimeout(function () {
      // 第二步：从按钮中心掀起波纹，波纹扫过的地方直接换成目标页面
      root.setAttribute('data-vt', 'ripple');   // 让波纹的关键帧只在这段时间生效
      var vt = document.startViewTransition(function () { setMode(m, true); });
      vt.finished.catch(function () {}).then(function () {
        switching = false;
        root.removeAttribute('data-switching');
        root.removeAttribute('data-vt');
      });
    }, LEAD);
  }

  /* B 键没有指针位置，就借用当前形态下可见的那个按钮当圆心 */
  function findOrigin(m) {
    var inStart = document.querySelector('.start [data-goto="' + m + '"]');
    var inNav = document.querySelector('.nav-right [data-goto="' + m + '"]');
    var cur = root.getAttribute('data-mode');
    return (cur === 'blog' ? inNav : inStart) || inStart || inNav || null;
  }

  // 任何带 data-goto 的元素：首页就地切，其他页走链接
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-goto]');
    if (!t) return;
    // 只在「同一个文档里两种形态都在」时就地切；
    // 子页面没有起始页标记，交给路由去搬（不能让它整页跳，否则音乐断）
    if (!root.hasAttribute('data-dual')) return;
    e.preventDefault();
    switchMode(t, t.getAttribute('data-goto'));
  });

  var dualReady = false;
  function enableDual() {
    if (dualReady || !root.hasAttribute('data-dual')) return;
    dualReady = true;

    paintSwitches(root.getAttribute('data-mode') || 'start');

    // 首屏就要把初始形态的 inert 摆正，不能等第一次点击
    var bl0 = document.querySelector('[data-blog]');
    if (bl0 && 'inert' in bl0) bl0.inert = (root.getAttribute('data-mode') !== 'blog');

    // 带 ?m= 进来时，把当前形态写回会话，别让下次裸访问回到旧形态
    try { sessionStorage.setItem('dyg-mode', root.getAttribute('data-mode') || 'start'); } catch (e) {}

    window.addEventListener('popstate', function (e) {
      if (!root.hasAttribute('data-dual')) return;      // 子页面交给 ui.js 的路由
      var f = location.pathname.split('/').pop();
      if (f !== 'index.html' && f !== '') return;
      var m = (e.state && e.state.m) ||
              (location.search.match(/[?&]m=(start|blog)/) || [])[1] || 'start';
      setMode(m, false);
    });
  }
  enableDual();

  /* ============================================================
     四、键盘
     ============================================================ */
  function inField(t) {
    if (!t) return false;
    if (t.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  }

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;

    // / 聚焦搜索
    if (e.key === '/' && q && !inField(t)) {
      e.preventDefault();
      q.focus();
      q.select();
      return;
    }

    // Esc 离开输入框
    if (e.key === 'Escape' && inField(t)) { t.blur(); return; }

    // B 切换形态（首页才管）
    if ((e.key === 'b' || e.key === 'B') && root.hasAttribute('data-dual') && !inField(t)) {
      e.preventDefault();
      var next = root.getAttribute('data-mode') === 'blog' ? 'start' : 'blog';
      switchMode(findOrigin(next), next);
    }
  });

  /* 起始页点击空白处收回焦点，键盘操作更顺（委托，节点换了也不用重挂） */
  document.addEventListener('click', function (e) {
    var s2 = e.target.closest && e.target.closest('[data-start]');
    if (!s2) return;
    if (e.target === s2 || e.target.classList.contains('start-core')) {
      grabSearch();
      if (q && document.activeElement === q) q.blur();
    }
  });

  /* 路由把起始页搬进来之后调用：重新取节点、重绘、把形态初始化补上 */
  function init() {
    grabTime();
    grabSearch();
    paintEngine();
    enableDual();
    paintSwitches(root.getAttribute('data-mode') || 'start');
    tick();
  }

  window.DYG_HOME = {
    setMode: setMode,
    getMode: function () { return root.getAttribute('data-mode'); },
    syncChrome: syncChrome,
    init: init
  };
})();
