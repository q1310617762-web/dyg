/* 东芽果 DYG · Service Worker
 *
 * 作用：第一次访问时把站点资源写进浏览器 Cache Storage（落在本机硬盘上），
 *       第二次访问起直接从硬盘读，不再等网络。
 *
 * 版本怎么更新：下面 const V 由根目录的 bump.mjs 自动改写（和 HTML 里的 ?v= 同一个号）。
 *   - CODE 缓存名带 V，V 一变就是一套新缓存，activate 里把旧的整个删掉；
 *   - ASSET 缓存名**不带 V**（看 ASSET 那行的注释）—— 这个区别很关键；
 *   - sw.js 本身用 updateViaCache:'none' 注册，不被 HTTP 缓存挡住。
 *
 * ───────────────────────────────────────────────────────────────
 * 【改过三次才走向正路的地方，改动前先读完，别当成可以随便调的参数】
 *
 * 第一版：install 里 Promise.all 并发预取 22 个资源，每个都带 cache:'reload'。
 *   后果：冷启动（1.2Mbps）首屏 24.6s、图片全出来 73s、音乐出声 80s。
 *   两个错叠在一起：① install 和首屏在同一条管道上抢带宽；
 *                   ② cache:'reload' 绕过 HTTP 缓存，把页面刚刚下载过的
 *                      theme.css / ui.js 再完整下一次（明明 Local Cache 里有）。
 *
 * 第二版（还是错的）：把 22 个改成串行。慢一点点，但仍然重复下载。
 *
 * 现在：install 什么都不下载。资源全部由 fetch 拦截器在「页面本来就要请求它」
 *   的时候顺手写进缓存 —— 一次下载，两边都得。页面没请求过的（别的页面、
 *   博客形态的大图）等页面 idle 时发 WARM 再慢慢补，那时候首屏早就画完了。
 *
 * ASSET 为什么不带版本号：
 *   上一版 CODE / RUNTIME 两个缓存名字都带 V，结果是「我改一行 CSS，用户本地
 *   已经下好的 2.24MB 图片整批作废」—— 版本号一变 activate 就把它们删了，
 *   用户下一次访问要整站重下，表现就是「图片又加载不出来了」。
 *   图片 / 字体 / 音频内容本身并不跟着代码变，它们应该有自己的生命周期：
 *   只在「这个文件确实换了内容」的时候，手动把 ASSET 的 -vN 加一。
 *
 * 还有一个隐蔽的日常损耗：SWR（命中缓存后后台换新）原来是无条件触发的。
 *   GitHub Pages 的 HTTP 缓存头固定 max-age=600，10 分钟内再验一遍纯属浪费，
 *   而且每次访问都把全部图片后台重下一次，正好和音频抢带宽。
 *   现在用响应里的 Date 头判断新鲜度，还在 600s 窗口里就不 revalidate。
 *
 * 不接手的东西：
 *   - 跨域请求（CDN、百度搜索跳转）—— 交给浏览器；
 *   - POST 等非 GET。
 */

const V = '20261025192149';
const CODE = 'dyg-code-' + V;   /* HTML / CSS / JS：随代码版本走 */
/* v2 → v3：图片重新压过一遍（见下方 WARM 注释里那条吞吐数据）。
   v3 → v4：音乐重编码成 Opus 立体声 40k，并换了一首（删《晚祷的钟声》、
   加《乐园漫记》）。内容变了必须手动加一，否则老访客的 Cache Storage 里
   一直是旧音频 —— 那个缓存是按文件名存的，同名换内容它根本不知道。 */
const ASSET = 'dyg-asset-v5';   /* 图片 / 字体 / 音频：不随代码版本走，
                                   只有这些文件真的换内容了才手动把 -vN 加一 */

/* GitHub Pages 的 HTTP 缓存头改不了，固定 max-age=600。
   在这窗口里 SWR 没有意义：拉回来的一定是同一份字节。 */
const FRESH_MS = 10 * 60 * 1000;

/* 页面 idle 后慢慢补的资源。
 *
 * 为什么这份名单故意很短：凡是在使用过程中会被请求的资源（别的页面、
 * 别的皮肤的背景图、博客形态的大图），fetch 拦截器在它们第一次流经时
 * 就已经写进缓存了 —— 根本不需要提前下载。
 * 提前下载的代价是实打实的：这条线路上 GitHub Pages 的有效吞吐只有
 * 几十 KB/s，一张 cover-anime（92K，只有 dark 皮肤用得到）就要传 3 秒，
 * 白白占着别人的带宽。所以名单里只留「当前这一屏就要用的核心件」，
 * 而且它们此刻大多还躺在浏览器的 HTTP 缓存里，补一下几乎是免费的。 */
const WARM = [
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

const OFFLINE = '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>离线 · 东芽果</title><style>' +
  'body{margin:0;min-height:100svh;display:grid;place-items:center;' +
  'background:#fdf6f9;color:#3b2a34;' +
  'font:16px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
  'div{text-align:center;padding:24px}' +
  'h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#836a78}' +
  '</style><div><h1>现在没有网络</h1><p>这一页以前没存过，联网后再来一次就好。</p></div>';

/* ---------- 小工具 ---------- */

/* 有限的并发，一个接一行。
   为什么要限：笨办法 Promise.all 会一次打出二十多个请求，
   在慢网下这些请求互相排队，谁都快不了，还把真正的首屏资源挤到最后。 */
async function parallelLimit(list, n, fn) {
  let i = 0;
  const workers = new Array(Math.min(n, list.length)).fill(0).map(async () => {
    while (i < list.length) {
      const cur = i++;
      try { await fn(list[cur]); } catch (e) {}
    }
  });
  await Promise.all(workers);
}

const isAsset = p => /\.(webp|avif|png|jpe?g|gif|svg|ico|woff2?|ttf)$/i.test(p);
const isMedia = p => /\.(webm|mp3|ogg|m4a|flac|wav)$/i.test(p);

/* 还在 HTTP 缓存有效期内？拿 Date 头比本地时钟。 */
function looksFresh(res) {
  const d = res.headers.get('date');
  if (!d) return false;
  const t = Date.parse(d);
  return !isNaN(t) && Date.now() - t < FRESH_MS;
}

const put = (c, req, res) => {
  if (res && res.ok && res.type === 'basic') return c.put(req, res).catch(() => {});
};
const putByUrl = (c, url, res) => {
  if (res && res.ok && res.type === 'basic') return c.put(url, res).catch(() => {});
};

/* ---------- 装：什么都不下载 ----------
   见文件头注释。install 阶段任何一次网络请求都是在和首屏抢带宽。 */
self.addEventListener('install', () => self.skipWaiting());

/* ---------- 激活：只清掉「应该跟着版本走」的旧缓存 ---------- */
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => {
      /* ASSET 是跨版本复用的，只有 -vN 变才换 ⇒ 前缀对得上就留着 */
      if (n !== CODE && n !== ASSET) return caches.delete(n);
    }));
    await self.clients.claim();
  })());
});

/* ---------- 音频：Range 请求 ----------
   <audio> 一定会发 Range。而 Cache API 里存的是完整响应，
   直接原样返回会被浏览器当成 200 全量，播放行为不稳定。
   这里按请求头把缓存里的字节切一段出来，按 206 回。 */
function sliceForRange(ab, range) {
  const m = /bytes=(\d*)-(\d*)/.exec(range || '');
  let start = 0, end = ab.byteLength - 1, wants = false;
  if (m) {
    wants = true;
    if (m[1] !== '') start = parseInt(m[1], 10);
    if (m[2] !== '') end = parseInt(m[2], 10);
    /* Safari/Chromium 偶尔发 bytes=0- 表示「全部」，和没有 Range 等效 */
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= ab.byteLength) end = ab.byteLength - 1;
  }
  if (!wants) return null;
  const body = ab.slice(start, end + 1);
  return new Response(body, {
    status: 206,
    headers: {
      'Content-Range': `bytes ${start}-${end}/${ab.byteLength}`,
      'Accept-Ranges': 'bytes',
      'Content-Type': 'audio/webm',
      'Content-Length': String(body.byteLength)
    }
  });
}

/* ---------- 拦请求 ---------- */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      /* 跨域不管 */
  const p = url.pathname;

  /* ---- 音频：命中缓存就直接给，不命中就放行让流式下载照常 ----
     缓存由页面在播完元数据之后通知补（CACHE_MEDIA），
     这里不去帮它下载 —— 那样会让首次点击多等一次完整下载。 */
  if (isMedia(p)) {
    e.respondWith((async () => {
      const c = await caches.open(ASSET);
      const hit = await c.match(url.href, { ignoreSearch: true });
      if (hit) {
        try {
          const ab = await hit.arrayBuffer();
          const sliced = sliceForRange(ab, req.headers.get('range'));
          if (sliced) return sliced;
          return new Response(ab, {
            status: 200,
            headers: {
              'Accept-Ranges': 'bytes',
              'Content-Type': hit.headers.get('Content-Type') || 'audio/webm',
              'Content-Length': String(ab.byteLength)
            }
          });
        } catch (err) { /* 缓存坏了就当没命中 */ }
      }
      return fetch(req);
    })());
    return;
  }

  const wantsHtml = req.mode === 'navigate' ||
                    (req.headers.get('accept') || '').indexOf('text/html') >= 0;

  /* ---- HTML：网络优先。每次打开拿到的都是最新的一页（它带着新的 ?v=），
         断网时才回落到缓存。流过的那份顺手存进 CODE。 ---- */
  if (wantsHtml) {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        put(await caches.open(CODE), req, net.clone());
        return net;
      } catch (err) {
        const c = await caches.open(CODE);
        const hit = (await c.match(req)) ||
                    (await c.match('./index.html')) ||
                    (await c.match('index.html'));
        if (hit) return hit;
        const a = await caches.open(ASSET);
        const hit2 = await a.match(req);
        if (hit2) return hit2;
        return new Response(OFFLINE, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    })());
    return;
  }

  /* ---- 带 ?v= 的 CSS/JS：缓存优先。
         **不能 ignoreSearch** —— 忽略查询串的话，新版本的 theme.css?v=新号
         会命中缓存里 ?v=旧号 的那条，表现就是「改了 CSS 但用户看到的还是旧的」。
         版本号本身就保证了新鲜度，命中后不需要再 revalidate。 ---- */
  if (/\.(css|js)$/i.test(p)) {
    e.respondWith((async () => {
      const c = await caches.open(CODE);
      const hit = await c.match(req);
      if (hit) return hit;
      const net = await fetch(req);
      put(c, req, net.clone());
      return net;
    })());
    return;
  }

  /* ---- 图片 / 字体 / svg：缓存优先 + 有条件的 SWR ----
         命中且还在 Pages 的 600s 新鲜窗口里，就直接给，不后台重下。
         超了窗口才顺带换一次新 —— 这也是它和上一版最大的区别。 */
  if (isAsset(p)) {
    e.respondWith((async () => {
      const c = await caches.open(ASSET);
      const hit = await c.match(req);
      if (hit) {
        if (!looksFresh(hit)) {
          /* 后台换新：先把新响应写进缓存，下次访问就是新的 */
          fetch(req).then(res => put(c, req, res)).catch(() => {});
        }
        return hit;
      }
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

  /* 页面空闲后补缓存。限 3 个并发，慢条斯理，别打扰用户正在做的事。
     这里用默认 cache 模式（不是 'reload'）—— 页面刚下载过的文件还躺在
     浏览器的 HTTP 缓存里，走默认模式命中了就是免费的，不用真的联网。 */
  if (d.type === 'WARM') {
    e.waitUntil((async () => {
      const code = [], asset = [];
      for (const u of WARM) (isAsset(u) ? asset : code).push(u);
      const cc = await caches.open(CODE);
      const ca = await caches.open(ASSET);
      await parallelLimit(code, 3, async u => {
        const has = await cc.match(u);
        if (!has) await cc.add(u);
      });
      await parallelLimit(asset, 2, async u => {
        const has = await ca.match(u);
        if (!has) await ca.add(u);
      });
    })());
  }

  /* 把正在放的这一首整首存起来。
     由 ui.js 在 loadedmetadata 之后发，时机是「用户已经在听」——
     这时候占的带宽用户感知不到，而第二次听这首就是从硬盘读，秒出。 */
  if (d.type === 'CACHE_MEDIA' && d.url) {
    e.waitUntil((async () => {
      try {
        const c = await caches.open(ASSET);
        const u = new URL(d.url, self.location.href).href;
        const has = await c.match(u, { ignoreSearch: true });
        if (has) return;
        /* 不带 Range 的完整下载：浏览器那个带 Range 的请求结果没法直接存 */
        const res = await fetch(u, { credentials: 'same-origin' });
        await putByUrl(c, u, res);
      } catch (err) {}
    })());
  }

  if (d.type === 'CLEAR') {
    e.waitUntil(caches.keys().then(ns => Promise.all(ns.map(n => caches.delete(n)))));
  }
});
