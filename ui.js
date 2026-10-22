/* ============================================================
   ui.js · v8
   注入导航（含播放器）/ 抽屉 / 页脚 / 目录，并接管站内跳转。

   ── 这一版最重要的两件事 ──────────────────────────────────
   1. 播放器搬进导航栏：进度条横贯整条胶囊，播放键和曲名在右侧。
   2. 站内跳转不再重载页面：只换内容区，导航栏和 <audio> 原地不动。
      所以切页面时整条栏不会闪、歌也不会断——这是用户点名要的，
      以前每跳一页就重载，音乐必断，属于老问题。

   ── 边界（别越界）────────────────────────────────────────
   路由处理所有站内页面，包括 index.html：回起始页时把 .start 搬进当前文档，
   导航栏和 <audio> 始终是同一份，所以换页不闪、歌不断。
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;

  var NAV = [
    { href: 'blog.html',    text: '文章' },
    { href: 'gallery.html', text: '图集' },
    { href: 'archive.html', text: '归档' },
    { href: 'tags.html',    text: '标签' },
    { href: 'friends.html', text: '友链' },
    { href: 'about.html',   text: '关于' }
  ];

  var TRACKS = [
    { title: '夜诞的花冠',     artist: 'HOYO-MiX · 挪德卡莱', src: 'assets/music/nights-crown.mp3' },
    { title: '晚祷的钟声',     artist: 'HOYO-MiX · 晨昏之庭', src: 'assets/music/vespers-bells.mp3' },
    { title: '渡鸦与温柔月色', artist: 'HOYO-MiX · 夜之组曲', src: 'assets/music/raven-tender-moon.mp3' },
    { title: '雪国主题',       artist: 'HOYO-MiX · 至冬印象', src: 'assets/music/snezhnaya-theme.m4a' },
    { title: '自由之颂',       artist: 'HOYO-MiX · 蒙德纪念', src: 'assets/music/ode-to-liberty.m4a' }
  ];

  function pageFile() {
    return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 图标 ---------- */
  var ICON_SEARCH = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7.1" cy="7.1" r="4.3" stroke="currentColor" stroke-width="1.6"/><path d="M10.4 10.4L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var ICON_GRID = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.3" y="2.3" width="4.9" height="4.9" rx="1.4" stroke="currentColor" stroke-width="1.5"/><rect x="8.8" y="2.3" width="4.9" height="4.9" rx="1.4" stroke="currentColor" stroke-width="1.5"/><rect x="2.3" y="8.8" width="4.9" height="4.9" rx="1.4" stroke="currentColor" stroke-width="1.5"/><rect x="8.8" y="8.8" width="4.9" height="4.9" rx="1.4" stroke="currentColor" stroke-width="1.5"/></svg>';
  var ICON_PLAY = '<svg class="np-i-play" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M4.2 2.6l7 4.4-7 4.4z" fill="currentColor"/></svg>';
  var ICON_PAUSE = '<svg class="np-i-pause" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3.4" y="2.6" width="2.6" height="8.8" rx="1" fill="currentColor"/><rect x="8" y="2.6" width="2.6" height="8.8" rx="1" fill="currentColor"/></svg>';

  /* 皮肤图标显示的是「当前这套」，不是「点一下会变成什么」 */
  var ICON_MOON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.6 9.8A5.9 5.9 0 0 1 6.2 2.4a5.9 5.9 0 1 0 7.4 7.4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  var ICON_SUN  = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3.1" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.1v1.7M8 13.2v1.7M1.1 8h1.7M13.2 8h1.7M3.1 3.1l1.2 1.2M11.7 11.7l1.2 1.2M12.9 3.1l-1.2 1.2M4.3 11.7l-1.2 1.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var ICON_PAPER = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.1" y="2.8" width="11.8" height="10.4" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M4.7 5.9h6.6M4.7 8.2h6.6M4.7 10.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

  /* 顺序决定循环顺序；第 0 个是默认皮肤。
     报纸是默认，夜幕（原来的暗色）退成可切换的一套。 */
  var THEMES = [
    { id: 'paper', name: '报纸',   icon: ICON_PAPER, color: '#faf9f5' },
    { id: 'dark',  name: '夜幕',   icon: ICON_MOON,  color: '#0b0b0d' },
    { id: 'neu',   name: '新拟物', icon: ICON_SUN,   color: '#e0e5ec' }
  ];

  function themeIndex(id) {
    for (var i = 0; i < THEMES.length; i++) { if (THEMES[i].id === id) return i; }
    return 0;
  }

  function themeOf(id) {
    return THEMES[themeIndex(id)];
  }

  /* 两个图标都放在 DOM 里，由 CSS 决定显示哪个 ——
     这样首屏脚本一设好 data-theme，图标就是对的，不会先闪一下月亮 */
  function themeBtn() {
    return '<button class="th-btn" type="button" data-theme-btn' +
           ' aria-label="切换皮肤" title="切换皮肤">' +
           '<span class="th-i th-paper">' + ICON_PAPER + '</span>' +
           '<span class="th-i th-moon">' + ICON_MOON + '</span>' +
           '<span class="th-i th-sun">' + ICON_SUN + '</span>' +
           '</button>';
  }

  /* 换肤：改属性 + 记住 + 同步按钮和浏览器状态栏颜色 */
  function applyTheme(id, save) {
    if (themeIndex(id) === 0 && id !== THEMES[0].id) id = THEMES[0].id;
    root.setAttribute('data-theme', id);
    if (save) { try { localStorage.setItem('dyg-theme', id); } catch (e) {} }

    var t = themeOf(id);
    /* 起始页和博客各有一颗按钮，两处都要同步 */
    var bs = document.querySelectorAll('[data-theme-btn]');
    for (var i = 0; i < bs.length; i++) {
      bs[i].title = '皮肤：' + t.name;
      bs[i].setAttribute('aria-label', '切换皮肤（当前：' + t.name + '）');
    }
    var mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute('content', t.color);
  }

  function initTheme() {
    applyTheme(root.getAttribute('data-theme'), false);

    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-theme-btn]') : null;
      if (!b) return;
      e.preventDefault();

      var cur = root.getAttribute('data-theme') || THEMES[0].id;
      var next = THEMES[(themeIndex(cur) + 1) % THEMES.length].id;
      var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      if (typeof document.startViewTransition === 'function' && !reduced) {
        var vt = document.startViewTransition(function () { applyTheme(next, true); });
        vt.finished.catch(function () {});
      } else {
        applyTheme(next, true);
      }
    });
  }

  function modeSw() {
    return '' +
      '<div class="modesw" data-at="blog" role="group" aria-label="切换形态">' +
        '<span class="modesw-thumb" aria-hidden="true"></span>' +
        '<a href="index.html?m=start" data-goto="start" aria-label="起始页" title="起始页">' + ICON_SEARCH + '</a>' +
        '<a href="index.html?m=blog" data-goto="blog" class="on" aria-current="page" aria-label="博客" title="博客">' + ICON_GRID + '</a>' +
      '</div>';
  }

  /* ---------- 播放器（长在导航栏里） ---------- */
  function playerHTML() {
    return '' +
      '<div class="np" data-np>' +
        '<button class="np-btn" type="button" data-np-toggle aria-label="播放">' +
          ICON_PLAY + ICON_PAUSE +
        '</button>' +
        '<button class="np-meta" type="button" data-np-list aria-haspopup="true" aria-expanded="false" aria-label="歌单">' +
          '<span class="np-t" data-np-title>播放</span>' +
          '<span class="np-a" data-np-artist>5 首</span>' +
        '</button>' +
      '</div>';
  }

  /* ---------- 导航 ---------- */
  function navHTML() {
    var file = pageFile();
    var links = NAV.map(function (n) {
      var cur = n.href === file ? ' aria-current="page"' : '';
      return '<a href="' + n.href + '"' + cur + '>' + n.text + '</a>';
    }).join('');

    return '' +
      '<div class="wrap nav-inner">' +
        '<a class="brand" href="index.html?m=start">东芽果<small>DYG</small></a>' +
        '<nav class="nav-links">' + links + '</nav>' +
        '<div class="nav-right">' +
          playerHTML() +
          themeBtn() +
          modeSw() +
          '<button class="burger" type="button" aria-label="打开菜单" aria-expanded="false">' +
            '<i></i><i></i><i></i>' +
          '</button>' +
        '</div>' +
      '</div>' +
      /* 进度条与歌单弹层挂在 .nav 上，不放进 .nav-inner ——
         胶囊的圆角会裁掉溢出的部分 */
      '<span class="nav-prog" aria-hidden="true"><i data-np-bar></i></span>' +
      '<div class="np-menu" data-np-menu hidden role="menu" aria-label="歌单"></div>';
  }

  function menuHTML() {
    var file = pageFile();
    var links = NAV.map(function (n) {
      var cur = n.href === file ? ' aria-current="page"' : '';
      return '<a class="menu-link" href="' + n.href + '"' + cur + '>' + n.text + '</a>';
    }).join('');

    return '' +
      '<div class="menu-panel" role="dialog" aria-label="站内导航">' +
        '<div class="menu-head">导航<button class="menu-close" type="button" aria-label="关闭">×</button></div>' +
        links +
        '<a class="menu-link" href="index.html?m=start">起始页</a>' +
        '<div class="menu-foot">东芽果 DYG<br>手写 HTML / CSS，没有框架。</div>' +
      '</div>';
  }

  function footHTML() {
    var col = function (title, items) {
      return '<div class="foot-col"><h4>' + title + '</h4>' +
        items.map(function (i) { return '<a href="' + i[0] + '">' + i[1] + '</a>'; }).join('') +
        '</div>';
    };

    return '' +
      '<div class="wrap">' +
        '<div class="foot-grid">' +
          '<div class="foot-brand">' +
            '<a class="brand" href="index.html?m=start">东芽果<small>DYG</small></a>' +
            '<p>把喜欢的游戏、原声和日常，一点一点记下来。更新很慢，但每篇都认真写。</p>' +
          '</div>' +
          col('到处看看', [
            ['blog.html', '文章'], ['gallery.html', '图集'],
            ['archive.html', '归档'], ['tags.html', '标签']
          ]) +
          col('找我玩', [
            ['friends.html', '友链'], ['about.html', '关于'],
            ['mailto:1310617762@qq.com', '写邮件'], ['https://www.bilibili.com', 'Bilibili']
          ]) +
        '</div>' +
        '<div class="foot-bottom">' +
          '<span>© 2026 东芽果DYG</span>' +
          '<span>纯静态站点 · 手写 HTML / CSS</span>' +
        '</div>' +
      '</div>';
  }

  /* ============================================================
     播放器
     audio 在闭包里只建一次，导航栏也只建一次 —— 后面的路由只换内容区，
     所以切页面时这首曲子始终是同一个 <audio> 在放，不会断。
     ============================================================ */
  var audio = null;
  var cur = -1;

  function initPlayer() {
    var np = document.querySelector('[data-np]');
    var menu = document.querySelector('[data-np-menu]');
    var bar = document.querySelector('[data-np-bar]');
    if (!np) return;

    var titleEl = np.querySelector('[data-np-title]');
    var artistEl = np.querySelector('[data-np-artist]');
    var btn = np.querySelector('[data-np-toggle]');
    var metaBtn = np.querySelector('[data-np-list]');

    audio = new Audio();
    audio.preload = 'none';
    audio.volume = 0.9;

    if (menu) {
      menu.innerHTML = TRACKS.map(function (t, i) {
        return '<button class="np-trk" type="button" role="menuitem" data-i="' + i + '">' +
          '<span class="np-trk-i">' + (i + 1) + '</span>' +
          '<span class="np-trk-n"><b>' + esc(t.title) + '</b><i>' + esc(t.artist) + '</i></span>' +
        '</button>';
      }).join('');
    }

    function paint() {
      var playing = audio && !audio.paused && cur >= 0;
      np.classList.toggle('playing', !!playing);
      btn.setAttribute('aria-label', playing ? '暂停' : '播放');
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');

      if (cur >= 0) {
        titleEl.textContent = TRACKS[cur].title;
        artistEl.textContent = TRACKS[cur].artist;
      } else {
        titleEl.textContent = '播放';
        artistEl.textContent = TRACKS.length + ' 首';
      }

      if (menu) {
        [].slice.call(menu.querySelectorAll('.np-trk')).forEach(function (b) {
          b.classList.toggle('on', Number(b.dataset.i) === cur);
        });
      }
    }

    function setBar() {
      if (!bar) return;
      var d = audio.duration;
      bar.style.width = (cur >= 0 && d && isFinite(d)) ? (audio.currentTime / d * 100) + '%' : '0%';
    }

    function playIndex(i) {
      cur = i;
      audio.src = TRACKS[i].src;
      audio.play().catch(function () { /* 被拦就等用户再点 */ });
      paint();
    }

    function toggle() {
      if (cur < 0) { playIndex(0); return; }
      if (audio.paused) audio.play().catch(function () {});
      else audio.pause();
      paint();
    }

    btn.addEventListener('click', toggle);

    metaBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hasAttribute('hidden');
      if (open) menu.removeAttribute('hidden'); else menu.setAttribute('hidden', '');
      metaBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    if (menu) {
      menu.addEventListener('click', function (e) {
        var b = e.target.closest('.np-trk');
        if (!b) return;
        playIndex(Number(b.dataset.i));
        menu.setAttribute('hidden', '');
        metaBtn.setAttribute('aria-expanded', 'false');
      });
    }

    document.addEventListener('click', function (e) {
      if (!menu || menu.hasAttribute('hidden')) return;
      if (e.target.closest('[data-np]')) return;
      menu.setAttribute('hidden', '');
      metaBtn.setAttribute('aria-expanded', 'false');
    });

    audio.addEventListener('play', paint);
    audio.addEventListener('pause', paint);
    audio.addEventListener('timeupdate', setBar);
    audio.addEventListener('loadedmetadata', setBar);
    audio.addEventListener('ended', function () {
      if (cur >= 0 && cur < TRACKS.length - 1) playIndex(cur + 1);
      else { cur = -1; audio.removeAttribute('src'); paint(); setBar(); }
    });
    audio.addEventListener('error', function () {
      artistEl.textContent = '加载失败';
    });

    paint();
    setBar();
  }

  /* ---------- 抽屉 ---------- */
  function initMenu() {
    var box = document.querySelector('[data-menu]');
    var burger = document.querySelector('.burger');
    if (!box || !burger) return;

    box.className = 'menu';
    box.innerHTML = menuHTML();
    if (box.parentNode !== document.body) document.body.appendChild(box);

    function open() {
      box.classList.add('open');
      burger.setAttribute('aria-expanded', 'true');
      document.documentElement.style.overflow = 'hidden';
    }
    function close() {
      box.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';
    }

    burger.addEventListener('click', open);
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.closest('.menu-close') || e.target.closest('.menu-link')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 820) close();
    });
  }

  /* ---------- 文章目录 ---------- */
  /* 每次现查节点：路由换页后目录是新的，旧的已经不在文档里了 */
  function syncToc() {
    var toc = document.querySelector('[data-toc]');
    if (!toc) return;
    var links = [].slice.call(toc.querySelectorAll('a[href^="#"]'));
    var heads = links.map(function (a) {
      return document.getElementById(a.getAttribute('href').slice(1));
    }).filter(Boolean);
    if (!heads.length) return;

    var y = window.scrollY + 140, idx = 0;
    heads.forEach(function (h, i) { if (h.offsetTop <= y) idx = i; });
    links.forEach(function (a, i) { a.classList.toggle('on', i === idx); });
  }

  var tocWired = false;
  function initToc() {
    syncToc();
    if (tocWired) return;                 // 监听只挂一次，否则每跳一页多一条
    tocWired = true;
    document.addEventListener('scroll', syncToc, { passive: true });
  }

  /* ============================================================
     站内路由：只换内容区
     ============================================================ */
  var CONTENT_SKIP = '[data-nav], [data-menu], footer';

  function contentNodes(blog) {
    return [].slice.call(blog.children).filter(function (el) {
      return !el.matches(CONTENT_SKIP);
    });
  }

  function markCurrent(url) {
    var file = (url.pathname.split('/').pop() || 'index.html').toLowerCase();
    [].slice.call(document.querySelectorAll('.nav-links a, .menu-link')).forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('?')[0];
      if (href === 'index.html') return;          // 首页的「当前」由形态开关决定，别在这标
      if (href === file) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function swap(doc, url) {
    var curBlog = document.querySelector('.blog');
    var newBlog = doc.querySelector('.blog');
    if (!curBlog || !newBlog) return false;

    var foot = curBlog.querySelector('footer');

    // 清掉旧内容（导航、抽屉、页脚留着）
    contentNodes(curBlog).forEach(function (el) { el.remove(); });

    // 插入新内容
    contentNodes(newBlog).forEach(function (el) {
      curBlog.insertBefore(document.importNode(el, true), foot);
    });

    document.title = doc.title;
    markCurrent(url);

    // 页面自己的内联脚本要重跑一次（图集的数据、首页的相册条都在里面）
    [].slice.call(document.querySelectorAll('script[data-page]')).forEach(function (s) { s.remove(); });
    [].slice.call(doc.body.querySelectorAll('script:not([src])')).forEach(function (old) {
      var s = document.createElement('script');
      s.setAttribute('data-page', '');
      s.textContent = old.textContent;
      document.body.appendChild(s);
    });

    return true;
  }

  /* ---------- 起始页也要能被搬进当前文档 ---------- */
  function assetVersion() {
    var sc = document.querySelector('script[src*="ui.js"]');
    var m = sc && sc.src.match(/[?&]v=([0-9a-z]+)/);
    return m ? m[1] : '';
  }

  function ensureStart(doc) {
    if (document.querySelector('.start')) return true;      // 已经有了
    var inc = doc.querySelector('.start');
    if (!inc) return false;
    var node = document.importNode(inc, true);
    document.body.insertBefore(node, document.querySelector('.blog'));
    return true;
  }

  function ensureHome(then) {
    if (window.DYG_HOME && window.DYG_HOME.init) { then(); return; }
    var v = assetVersion();
    var sc = document.createElement('script');
    sc.src = 'home.js' + (v ? '?v=' + v : '');
    sc.onload = function () {
      if (window.DYG_HOME && window.DYG_HOME.init) window.DYG_HOME.init();
      then();
    };
    sc.onerror = then;
    document.head.appendChild(sc);
  }

  /* ============================================================
     圆形揭示 —— 形态切换（起始页 ⇄ 博客）和站内换页共用同一套。
     圆心在被点的那个链接上，圆扩散到盖满整屏。
     关键帧每次换名字，避免同名关键帧不刷新。
     ============================================================ */
  var ripSeq = 0;

  function injectRipple(cx, cy, radius, dur, ease) {
    var st = document.getElementById('rip-kf');
    if (!st) {
      st = document.createElement('style');
      st.id = 'rip-kf';
      document.head.appendChild(st);
    }
    var name = 'ripKf' + (++ripSeq);
    /* 必须带 html[data-vt="ripple"] 前缀：
       否则这条规则会一直留在 head 里，把后面每一次换页的过渡都改掉。 */
    var p = 'html[data-vt="ripple"]';
    st.textContent =
      p + '::view-transition-new(root){animation:' + name + ' ' + dur + 'ms ' + ease + ' both;}' +
      '@keyframes ' + name + '{' +
        'from{clip-path:circle(0px at ' + cx + 'px ' + cy + 'px);}' +
        'to{clip-path:circle(' + radius + 'px at ' + cx + 'px ' + cy + 'px);}' +
      '}' +
      /* 旧页在揭示过程中逐渐变暗：圆内是正常亮度的新页面，圆外越来越暗，
         边界永远有色差。否则圆里圆外都是同一条导航栏，看不出从哪儿开始。 */
      p + '::view-transition-old(root){animation:' + name + 'Dim ' + dur + 'ms linear both;}' +
      '@keyframes ' + name + 'Dim{from{filter:brightness(1)}to{filter:brightness(.55)}}';
  }

  /* 圆心与"盖满整屏"的半径。没给元素就从视口中心发起（浏览器前进后退）。 */
  function rippleGeom(el) {
    var cx, cy;
    if (el && el.getBoundingClientRect) {
      var r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    } else {
      cx = window.innerWidth / 2;
      cy = window.innerHeight / 2;
    }
    return {
      cx: cx, cy: cy,
      radius: Math.hypot(
        Math.max(cx, window.innerWidth - cx),
        Math.max(cy, window.innerHeight - cy)
      )
    };
  }

  var RIP_PAGE_DUR = 900;   // 换页波纹时长；形态切换是 1100，这里稍快一点

  var navigating = false;
  var pendingNav = null;

  function navigate(url, push, origin) {
    if (navigating) { pendingNav = { url: url, push: push, origin: origin }; return; }   // 别静默丢掉
    navigating = true;

    fetch(url.href, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        if (!doc.querySelector('.blog')) throw new Error('no-shell');

        var isIndex = /\/index\.html$/.test(url.pathname);
        var mode = isIndex
          ? ((url.search.match(/[?&]m=(start|blog)/) || [])[1] || 'start')
          : 'blog';

        if (isIndex) root.setAttribute('data-dual', '');
        else root.removeAttribute('data-dual');

        /* 收尾：形态、地址栏、滚动、动画层、目录 */
        function settle() {
          if (isIndex && window.DYG_HOME) {
            window.DYG_HOME.setMode(mode, false);
            /* 换进来的 .start 是全新节点：必须重新 init，
               让时钟/搜索框/引擎菜单在新节点上重新取值并当场画好，
               否则快照里时钟停在占位符「--:--」 */
            window.DYG_HOME.init();
          } else if (!isIndex) {
            root.setAttribute('data-mode', 'blog');
            // 从首页路由走时，.blog 可能还带着 inert=true —— 不复位整条栏就点不动
            if (window.DYG_HOME && window.DYG_HOME.syncChrome) window.DYG_HOME.syncChrome('blog');
            else {
              var bl = document.querySelector('[data-blog]');
              if (bl) { if ('inert' in bl) bl.inert = false; bl.removeAttribute('aria-hidden'); }
            }
          }

          if (push) history.pushState({ dyg: 1 }, '', url.href);
          window.scrollTo(0, 0);

          if (window.__dygFx && window.__dygFx.refresh) window.__dygFx.refresh();
          afterSwap();
        }

        /* 真正的换页：所有 DOM 改动必须同步发生在同一个回调里，
           这样 View Transition 才能拍到完整的「新状态」。 */
        function commit() {
          var reduced = motionOff();

          function go() {
            if (isIndex && !ensureStart(doc)) throw new Error('no-start');
            if (!swap(doc, url)) throw new Error('no-blog');
            settle();
          }

          if (typeof document.startViewTransition === 'function') {
            if (reduced) {
              /* 系统关了「动画效果」不等于可以硬切 —— 硬切看起来就像「没有特效 / 坏了」。
                 这里去掉扩散和位移，只保留 160ms 的淡入。 */
              root.setAttribute('data-vt', 'soft');
            } else {
              var g = rippleGeom(origin);
              injectRipple(g.cx, g.cy, g.radius, RIP_PAGE_DUR, 'linear');
              root.setAttribute('data-vt', 'ripple');
            }
            var vt = document.startViewTransition(go);
            vt.finished.catch(function () {}).then(function () {
              root.removeAttribute('data-vt');
            });
          } else {
            go();
          }
        }

        // 回起始页要先确保 home.js 在场（子页面本来没有它），加载完再换
        if (isIndex) ensureHome(commit); else commit();
      })
      .catch(function (err) {
        console.error('[router] 站内跳转失败，退回整页加载：', err);
        location.href = url.href;      // 兜底，代价是音乐断
      })
      .then(function () {
        navigating = false;
        if (pendingNav) { var q = pendingNav; pendingNav = null; navigate(q.url, q.push); }
      });
  }

  function initRouter() {
    // 只有博客形态才走路由；起始页没有 .blog，直接放行
    if (!document.querySelector('.blog')) return;

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      // 起始页就地切形态是 home.js 的事；子页面没有起始页，得交给路由搬
      if (a.hasAttribute('data-goto') && root.hasAttribute('data-dual')) return;

      var url;
      try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }

      if (url.origin !== location.origin) return;
      if (!/\.html$/.test(url.pathname)) return;                       // 锚点、邮件、外链都不管
      if (url.pathname === location.pathname && url.search === location.search) {
        if (url.hash && url.hash !== location.hash) return;   // 页内锚点：交给浏览器滚
        e.preventDefault();                                    // 点当前页不该整页重载（音乐必断）
        return;
      }

      e.preventDefault();
      navigate(url, true, a);
    });

    window.addEventListener('popstate', function () {
      var url = new URL(location.href);
      if (!/\.html$/.test(url.pathname)) return;
      navigate(url, false);
    });
  }

  /* ---------- 内容换了之后要重绑的东西 ---------- */
  function afterSwap() {
    // 灯箱或抽屉开着时换页，overflow:hidden 会留在 html 上 → 新页面滚不动
    document.documentElement.style.overflow = '';
    document.querySelectorAll('.lightbox.open, .menu.open').forEach(function (el) {
      el.classList.remove('open');
    });
    initToc();
  }

  /* ============================================================
     动效总开关
     默认跟随系统（prefers-reduced-motion）。但「减弱动效」这条无障碍默认，
     在个人站上经常变成「我看不到任何过渡」——所以给一个页面内的强制开关，
     点了之后写 localStorage，后续所有过渡按完整动效走。
     ============================================================ */
  function motionForced() {
    try { return localStorage.getItem('dyg-motion') === 'force'; } catch (e) { return false; }
  }

  function motionOff() {
    if (motionForced()) return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function tipStack() {
    var st = document.querySelector('.tip-stack');
    if (!st) {
      st = document.createElement('div');
      st.className = 'tip-stack';
      document.body.appendChild(st);
    }
    return st;
  }

  function addTip(html, onAction) {
    var el = document.createElement('div');
    el.className = 'file-tip';
    el.innerHTML = html + '<button type="button" class="x" aria-label="关闭">×</button>';
    el.querySelector('.x').addEventListener('click', function () { el.remove(); });
    var act = el.querySelector('.act');
    if (act && onAction) act.addEventListener('click', function () { onAction(el); });
    tipStack().appendChild(el);
    return el;
  }

  /* file:// 下没有 SPA 路由：浏览器禁止页面之间的 fetch（origin 是 null），
     navigate() 只能退回 location.href，整页重载，过渡动画必然不出现。
     这里明说原因，别让用户以为是特效坏了。只提示一次。 */
  function fileModeTip() {
    if (location.protocol !== 'file:') return;
    console.warn('[DYG] 当前是本地文件模式（file://），浏览器禁止页面间 fetch，' +
                 '站内跳转会整页刷新，过渡动画不会出现。双击「启动网站.bat」用本地服务打开即可。');
    try { if (localStorage.getItem('dyg-file-tip') === '1') return; } catch (e) {}

    var el = addTip('<span>本地文件模式：站内跳转会整页刷新。' +
                    '双击 <b>启动网站.bat</b> 用本地服务打开，就能看到过渡动画。</span>');
    el.querySelector('.x').addEventListener('click', function () {
      try { localStorage.setItem('dyg-file-tip', '1'); } catch (e) {}
    });
  }

  /* 系统关了动画时，换页只剩 160ms 淡入，观感就是「没有动画」。
     给一个当场生效的开关，不用去改系统设置。 */
  function motionTip() {
    if (!motionOff()) return;
    addTip('<span>系统已关闭动画效果，换页只有极短淡入。' +
           '<button type="button" class="act">强制开启动画</button></span>',
      function (el) {
        try { localStorage.setItem('dyg-motion', 'force'); } catch (e) {}
        el.remove();
      });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var n = document.querySelector('[data-nav]');
    if (n) { n.className = 'nav'; n.innerHTML = navHTML(); }

    var f = document.querySelector('[data-foot]');
    if (f) { f.className = 'foot'; f.innerHTML = footHTML(); }

    initMenu();
    initPlayer();
    initTheme();
    fileModeTip();
    motionTip();
    initToc();
    initRouter();

    window.__dygUi = {
      audio: function () { return audio; },
      current: function () { return cur; },
      play: function (i) { if (audio) { audio.src = TRACKS[i].src; audio.play().catch(function(){}); } },
      theme: function (id) { applyTheme(id, true); },
      getTheme: function () { return root.getAttribute('data-theme') || 'dark'; },
      afterSwap: afterSwap,
      /* 形态切换（home.js）复用同一套波纹，两处动画才不会各写一份 */
      ripple: { inject: injectRipple, geom: rippleGeom },
      /* 动效判定也必须共用：否则「强制开启动画」只对换页生效，
         形态切换仍然按系统 reduce 走淡入，表现就是「反复切换没有波纹」 */
      motionOff: motionOff
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
