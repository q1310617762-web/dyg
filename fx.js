/* ============================================================
   fx.js · v7 的「手感层」
   三件事：图片淡入、滚动进入、鼠标跟随的 3D 倾斜。

   ── 参考站的倾斜是怎么做的 ────────────────────────────────
   抓过 haowallpaper 的卡片：悬停时卡片上出现一个极小的 matrix3d，
   带透视、旋转不到 0.01 度。也就是说它不是「放大」，是让卡片
   跟着指针微微侧一下。这里是同一件事，幅度 5–6 度，够看但不晕。

   ── 三条约束 ──────────────────────────────────────────────
   1. 只在 (hover: hover) and (pointer: fine) 下启用 —— 触摸端没有指针位置，
      开了只会得到一堆歪掉的卡片。
   2. 减弱动效时全部关掉，也不加 .reveal 类，内容直接可见。
   3. 全部是渐进增强：写 class 到 <html> 才生效，脚本挂了页面依然完整。
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
     一、图片淡入
     ============================================================ */
  function initImgFade() {
    var imgs = [].slice.call(document.querySelectorAll('.g-item img, .row-cover, .hero-fig img'));
    if (!imgs.length) return;

    root.classList.add('imgfade');

    imgs.forEach(function (im) {
      if (im.complete && im.naturalWidth) { im.classList.add('loaded'); return; }
      var done = function () { im.classList.add('loaded'); };
      im.addEventListener('load', done, { once: true });
      im.addEventListener('error', done, { once: true });
    });
  }

  /* ============================================================
     二、滚动进入
     只给块级元素做，瓦片不做 —— 瓦片有自己的淡入和倾斜，
     两套 transform 打架会互相覆盖。
     ============================================================ */
  function initReveal() {
    if (reduced || !('IntersectionObserver' in window)) return;

    var els = [].slice.call(document.querySelectorAll('.row, .link-card, .block, .hero-fig, .year'));
    if (!els.length) return;

    root.classList.add('reveal');
    els.forEach(function (el) { el.classList.add('rv'); });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });

    els.forEach(function (el) { io.observe(el); });
  }

  /* ============================================================
     三、鼠标跟随倾斜
     ============================================================ */
  function initTilt() {
    if (!fine || reduced) return;

    var SEL = '.g-item, .link-card';
    var cur = null, raf = 0, lastX = 0, lastY = 0;

    function apply() {
      raf = 0;
      if (!cur) return;
      var r = cur.getBoundingClientRect();
      if (!r.width || !r.height) return;

      var px = (lastX - r.left) / r.width - 0.5;   // -0.5 .. 0.5
      var py = (lastY - r.top) / r.height - 0.5;

      var ry = (px * 7).toFixed(2);                // 左右转
      var rx = (-py * 5).toFixed(2);               // 上下俯仰

      cur.style.transform =
        'perspective(900px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) translateZ(0)';
    }

    document.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;

      var el = e.target && e.target.closest ? e.target.closest(SEL) : null;
      if (!el) return;

      lastX = e.clientX;
      lastY = e.clientY;

      if (el !== cur) {
        if (cur) cur.classList.remove('tilting');
        cur = el;
        cur.classList.add('tilting');   // 去掉 transform 过渡，跟手
      }
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });

    function reset(el) {
      if (!el) return;
      el.classList.remove('tilting');
      el.style.transform = '';
      if (el === cur) cur = null;
    }

    document.addEventListener('pointerout', function (e) {
      var el = e.target && e.target.closest ? e.target.closest(SEL) : null;
      if (!el) return;
      if (el.contains(e.relatedTarget)) return;   // 还在卡片内部移动，别复位
      reset(el);
    }, { passive: true });

    // 指针离开窗口时把所有倾斜收回去
    window.addEventListener('blur', function () { reset(cur); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) reset(cur);
    });
  }

  /* ============================================================ */
  function boot() {
    initImgFade();
    initReveal();
    initTilt();
  }

  /* 站内路由换完内容后由 ui.js 调用：新节点要重新接上淡入和进入动画 */
  window.__dygFx = {
    refresh: function () {
      initImgFade();
      initReveal();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
