/* 东芽果 DYG · Service Worker
 *
 * 作用：第一次访问时把站点资源写进浏览器 Cache Storage（落在本机硬盘上），
 *       第二次访问起直接从硬盘读，不再等网络 —— 冷启动从「十几二十个请求」
 *       变成「0 个网络请求」。
 *
 * 版本怎么更新：下面 const V 由根目录的 bump.mjs 自动改写（和 HTML 里的 ?v= 同一个号）。
 *   - 缓存名带 V，V 一变就是一套新缓存；
 *   - activate 里把名字不匹配的旧缓存整个删掉 —— 这就是「git 更新自动覆盖缓存」；
 *   - sw.js 本身用 updateViaCache:'none' 注册，不被 HTTP 缓存挡住。
 * 所以流程是：改代码 → node bump.mjs → 提交 → 用户下次打开拿到新 sw.js →
 *            新版本装好 → 旧缓存清空 → 以后都读新的。
 *
 * 不接手的东西：
 *   - 跨域请求（CDN、百度搜索跳转）—— 交给浏览器；
 *   - 音频 —— <audio> 走 Range 请求，跟 Cache API 组合是经典坑，直接放行；
 *   - POST 等非 GET。
 */

const V = '20261024162426';
const CORE = 'dyg-core-' + V;      /* 预缓存：首屏就要用的 */
const RUNTIME = 'dyg-rt-' + V;     /* 运行时：图片等按需攒下来的 */

/* 首屏必需。URL 写法和 HTML 里的相对路径一致；带 ?v= 的必须写全，
   否则缓存里是老版本，页面却要新版本，会多一次网络往返。 */
const PRECACHE = [
  './', './index.html',
  './blog.html', './archive.html', './tags.html', './about.html',
  './friends.html', './gallery.html', './post.html', './post-control.html',
  './404.html',
  './theme.css?v=' + V,
  './ui.js?v=' + V,
  './home.js?v=' + V,
  './fx.js?v=' + V,
  './cursor.js?v=' + V,
  './assets/petals.js?v=' + V,
  './assets/starfield.js?v=' + V,
  './assets/miko-talk.js?v=' + V,
  './assets/fonts/playfair-display.woff2',
  './assets/fonts/mast-cherry-bomb-one.woff2',
  './assets/favicon.svg',
  './assets/img/miko.webp',
];

/* 切到博客形态才用到的图。不在 install 阶段抢带宽，
   等页面上空闲了发 WARM 消息再慢慢攒。 */
const WARM = [
  './assets/img/wall-seaside.webp',
  './assets/img/wall-seaside-blur.webp',
  './assets/img/cover-control.webp',
  './assets/img/cover-seitokai.webp',
  './assets/img/cover-anime.webp',
  './assets/img/avatar.webp',
];

const OFFLINE = '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>离线 · 东芽果</title><style>' +
  'body{margin:0;min-height:100svh;display:grid;place-items:center;' +
  'background:#fdf6f9;color:#3b2a34;' +
  'font:16px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
  'div{text-align:center;padding:24px}' +
  'h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#836a78}' +
  '</style><div><h1>现在没有网络</h1><p>这一页以前没存过，联网后再来一次就好。</p></div>';

/* ---------- 装 ---------- */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CORE);
    /* 一个一个加，单个 404 不至于让整次安装失败 */
    await Promise.all(PRECACHE.map(u =>
      c.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

/* ---------- 激活：清掉旧版本留下的缓存 ---------- */
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => {
      if (n !== CORE && n !== RUNTIME) return caches.delete(n);
    }));
    await self.clients.claim();
  })());
});

/* ---------- 小工具 ---------- */
const put = (c, req, res) => {
  if (res && res.ok && res.type === 'basic') return c.put(req, res).catch(() => {});
};
/* 后台换新鲜：先把新响应写进缓存，下次访问就是新的 */
const revalidate = (c, req) => {
  fetch(req).then(res => put(c, req, res)).catch(() => {});
};

/* ---------- 拦请求 ---------- */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      /* 跨域不管 */
  const p = url.pathname;

  /* 音频：Range 请求别碰 */
  if (/\.(webm|mp3|ogg|m4a|flac|wav)$/i.test(p)) return;

  const wantsHtml = req.mode === 'navigate' ||
                    (req.headers.get('accept') || '').indexOf('text/html') >= 0;

  /* HTML：网络优先。这样每次打开拿到的都是最新的一页（它带着新的 ?v=），
     断网时才回落到缓存。 */
  if (wantsHtml) {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        put(await caches.open(RUNTIME), req, net.clone());
        return net;
      } catch (err) {
        const c = await caches.open(CORE);
        const hit = (await c.match(req)) ||
                    (await c.match('./index.html')) ||
                    (await c.match('index.html'));
        if (hit) return hit;
        const rt = await caches.open(RUNTIME);
        const hit2 = await rt.match(req);
        if (hit2) return hit2;
        return new Response(OFFLINE, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    })());
    return;
  }

  /* 带 ?v= 的 CSS/JS：缓存优先。
     **不能 ignoreSearch** —— 忽略查询串的话，新版本的 theme.css?v=新号
     会命中缓存里 ?v=旧号 的那条，表现就是「改了 CSS 但用户看到的还是旧的」，
     要刷新两次才对。这里用精确匹配：版本号一变就 miss，走网络拿新的。 */
  if (/\.(css|js)$/i.test(p)) {
    e.respondWith((async () => {
      const c = await caches.open(CORE);
      const hit = await c.match(req);
      if (hit) { revalidate(c, req); return hit; }
      const net = await fetch(req);
      put(c, req, net.clone());
      return net;
    })());
    return;
  }

  /* 图片 / 字体 / svg：先给缓存里的，同时后台换新（SWR） */
  if (/\.(webp|avif|png|jpe?g|gif|svg|ico|woff2?|ttf)$/i.test(p)) {
    e.respondWith((async () => {
      const c = await caches.open(RUNTIME);
      const hit = await c.match(req);
      if (hit) { revalidate(c, req); return hit; }
      const net = await fetch(req);
      put(c, req, net.clone());
      return net;
    })());
  }
});

/* ---------- 页面发来的消息 ---------- */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'WARM') {
    e.waitUntil((async () => {
      const c = await caches.open(RUNTIME);
      /* 慢慢来，别和首屏抢带宽 */
      for (const u of WARM) {
        const has = await c.match(u);
        if (!has) {
          try { await c.add(new Request(u, { cache: 'reload' })); } catch (err) {}
          await new Promise(r => setTimeout(r, 120));
        }
      }
    })());
  }
  if (d.type === 'CLEAR') {
    e.waitUntil(caches.keys().then(ns => Promise.all(ns.map(n => caches.delete(n)))));
  }
});
