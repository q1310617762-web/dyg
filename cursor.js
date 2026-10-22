/* ============================================================
   cursor.js · 可莉指针（v6）
   ── 这一版只留指针，粒子、拖尾、彩蛋全部去掉了。
      上一版的手感问题不在指针，在「到处都是火花」太吵。
      指针本身保留 —— 那是用户自己挑的素材。

   ── 两条踩坑换来的铁律（别改）──────────────────────────────
   1. 样式由本文件注入 <style>，绝不写进 theme.css。
      写进 theme.css 会跟着样式表的 URL 缓存走，改了内容浏览器仍跑旧缓存，
      表现就是「系统光标没被隐藏、光标元素退化成普通 div」。
   2. 「有没有鼠标」用真实 pointermove(pointerType==='mouse') 判定，
      不用 matchMedia('(hover:hover) and (pointer:fine)')。媒体查询会误报，
      指针事件是地面真相。

   ── 开关 ────────────────────────────────────────────────────
     ?fx=off   完全关掉（回退系统光标）
     默认       跟随 prefers-reduced-motion：
                  关 → 指针跟手 + 逐帧摆动
                  开 → 仍换指针，但停在静止首帧（不做自主播放的动效）
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  var mode = (location.search.match(/[?&]fx=(full|off)/) || [])[1] || 'auto';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var wantMotion = mode === 'full' ? true : mode === 'off' ? false : !reduced;

  function mark(state, why) {
    root.setAttribute('data-cursor', state);
    window.__dygCursor = { state: state, why: why, reduced: reduced, motion: wantMotion };
  }

  if (mode === 'off') { mark('off', 'fx=off'); return; }

  var BASE = 'assets/cursor/';
  var SIZE = 48;                 // 显示尺寸；精灵图原生 96px = 2× 密度

  var CUR = {
    pointer:     { src: BASE + 'klee-pointer.webp',     hx: 3,    hy: 15.5, f: 6, dur: 1.00 },
    link:        { src: BASE + 'klee-link.webp',        hx: 17,   hy: 7.5,  f: 3, dur: 0.90 },
    text:        { src: BASE + 'klee-text.webp',        hx: 23,   hy: 19,   f: 4, dur: 1.33 },
    unavailable: { src: BASE + 'klee-unavailable.webp', hx: 23.5, hy: 17,   f: 8, dur: 1.07 }
  };

  /* ---------- 注入样式 ---------- */
  var STYLE_ID = 'dyg-cursor-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    var anims = '', rules = '';
    Object.keys(CUR).forEach(function (k, i) {
      var c = CUR[k];
      var name = 'dygStep' + i;
      rules += '.dyg-cur[data-state="' + k + '"]{background-image:url("' + c.src + '");' +
               'animation:' + name + ' ' + c.dur + 's steps(' + c.f + ') infinite}';
      anims += '@keyframes ' + name + '{from{background-position:0 0}' +
               'to{background-position:' + (-c.f * SIZE) + 'px 0}}';
    });

    var css =
      '.dyg-cur{position:fixed;left:0;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;' +
        'z-index:100000;pointer-events:none;background-repeat:no-repeat;' +
        'background-size:auto ' + SIZE + 'px;will-change:transform;opacity:0;' +
        'transition:opacity .16s ease}' +
      '.dyg-cur.on{opacity:1}' +
      '.dyg-cur.still,.dyg-cur.still[data-state]{animation:none !important}' +
      /* 接管系统光标；表单控件有自己的默认光标，必须用 * 一并覆盖 */
      'html.has-klee-cur,html.has-klee-cur *{cursor:none !important}' +
      rules + anims;

    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || root).appendChild(s);
  }

  injectStyle();

  /* ---------- 状态 ---------- */
  var el = null, state = '', ready = false, on = false, seen = false;
  var target = { x: -200, y: -200 }, pos = { x: -200, y: -200 };
  var down = false, raf = 0;

  var SEL_TEXT = 'input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range]),' +
                 'textarea,[contenteditable=""],[contenteditable="true"]';
  var SEL_OFF  = '[disabled],[aria-disabled="true"],.is-disabled,.is-off';
  var SEL_LINK = 'a[href],button,[role="button"],summary,label,select,.g-item,.chip,.trk';

  /* 4 张精灵图全部就绪才接管；任一失败就放弃，
     避免「系统光标藏了、自定义光标又没出来」的空档 */
  function preload() {
    var keys = Object.keys(CUR), left = keys.length, ok = true, settled = false;

    function done() {
      if (settled) return;
      if (!ok) { settled = true; mark('off-preload', 'sprite-missing'); return; }
      if (left > 0) return;
      settled = true;
      ready = true;
      enable();
    }

    keys.forEach(function (k) {
      var im = new Image();
      im.onload = function () { left--; done(); };
      im.onerror = function () { ok = false; done(); };
      im.src = CUR[k].src;
    });
  }

  function enable() {
    if (on || !ready || !seen) return;
    on = true;

    el = document.createElement('div');
    el.className = 'dyg-cur on' + (wantMotion ? '' : ' still');
    el.setAttribute('aria-hidden', 'true');
    setState('pointer');
    document.body.appendChild(el);
    root.classList.add('has-klee-cur');

    pos.x = target.x;
    pos.y = target.y;
    draw();
    mark(wantMotion ? 'on' : 'still', wantMotion ? 'on' : 'reduced-motion');
  }

  function setState(s) {
    if (!el || s === state) return;
    state = s;
    el.setAttribute('data-state', s);
    el.style.transformOrigin = CUR[s].hx + 'px ' + CUR[s].hy + 'px';
  }

  function draw() {
    if (!el) return;
    var h = CUR[state] || CUR.pointer;
    var sc = down ? .9 : 1;
    el.style.transform =
      'translate3d(' + (pos.x - h.hx) + 'px,' + (pos.y - h.hy) + 'px,0) scale(' + sc + ')';
  }

  /* 缓动跟随：追上了就停掉 rAF，不空转 */
  function kick() { if (!raf) raf = requestAnimationFrame(step); }

  function step() {
    raf = 0;
    if (!el) return;
    var dx = target.x - pos.x, dy = target.y - pos.y;

    pos.x += dx * 0.3;
    pos.y += dy * 0.3;

    if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) {
      pos.x = target.x;
      pos.y = target.y;
      draw();
      return;                       // 停手了就别再占着 rAF
    }
    draw();
    raf = requestAnimationFrame(step);
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('pointerover', function (e) {
    if (!on) return;
    var t = e.target;
    if (!t || !t.closest) return;

    var s = 'pointer';
    if (t.closest(SEL_TEXT)) s = 'text';
    else if (t.closest(SEL_OFF)) s = 'unavailable';
    else if (t.closest(SEL_LINK)) s = 'link';
    setState(s);
  }, { passive: true });

  document.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;   // 触屏 / 笔一律放过

    if (!seen) {
      seen = true;
      pos.x = e.clientX;      // 首次出现直接就位，别从屏幕外飞进来
      pos.y = e.clientY;
    }
    target.x = e.clientX;
    target.y = e.clientY;

    if (!on) { enable(); return; }
    kick();
  }, { passive: true });

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    down = true;
    kick();
  }, true);

  document.addEventListener('pointerup', function () {
    down = false;
    kick();
  }, true);

  window.addEventListener('blur', function () { down = false; kick(); });

  /* 指针移出窗口就藏起来，别停在边缘 */
  document.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget && el) el.style.opacity = '0';
  }, { passive: true });

  document.addEventListener('mouseover', function () {
    if (el) el.style.opacity = '';
  }, { passive: true });

  mark('waiting', 'preload');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preload);
  } else {
    preload();
  }
})();
