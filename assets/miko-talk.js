/* ============================================================
   看板娘台词（从 mascot-start-demo.html 搬过来的，改成正式页可用的写法）
   ────────────────────────────────────────────────────────────
   只做一件事：让神子对输入框、提交、换引擎这些动作有反应。
   三条约定都是踩出来的：
     1. 事件全部委托到 document —— 起始页内容块会被路由整个换掉，
        直接绑在节点上第一个来回就失效了。
     2. 元素每次现查（grab），不要缓存引用。
     3. 不 preventDefault 任何东西：搜索跳转是 home.js 的事，这里只负责说话。
   ============================================================ */
(function () {
  'use strict';

  var LINES = {
    idle: ['今天想搜点什么？', '慢慢想，我不催你。', '嗯……发什么呆呢。', '难得的清闲，就这么站着？',
           '要不要我替你找点乐子？', '风不错，就这样待一会儿也好。', '我的时间可不便宜，不过对你还算宽裕。'],
    focus: ['说吧，我听着。', '嗯？想找什么。', '难得主动，说来听听。'],
    short: ['「{v}」？就这点线索。', '「{v}」……你还真是不客气。'],
    mid: ['找「{v}」？交给我。', '「{v}」啊，有点意思。', '嗯，「{v}」，我看看。'],
    long: ['「{v}……」这么长，你确定我记得住。', '「{v}……」，你这是在写报告吗。'],
    url: ['网址啊，你自己不就能去。', '这串东西，一看就不是来问我的。'],
    lore: ['又绕回提瓦特了。', '在找我？直说就好。', '神社的事，你得先预约。'],
    question: ['问题？我最喜欢有人问我问题了。', '问得不错，就是别指望我好好答。'],
    engine: ['换个地方找，也不错。', '行，就它了。', '这个我可管不着，你定。'],
    submit: ['出发！', '走吧，别让我等。', '找到了记得回来。'],
    empty: ['什么都没写，让我猜吗。', '空手而来，胆子不小。'],
    bored: ['……睡着了？', '喂，还醒着吗。', '我就这么不值得你理？'],
    poke: ['别戳。', '……手拿开。', '有事说事。', '这件衣服很贵的。']
  };

  var lastLine = '';
  function pick(a) {
    var s = a[(Math.random() * a.length) | 0];
    if (a.length > 1 && s === lastLine) s = a[(a.indexOf(s) + 1) % a.length];
    lastLine = s;
    return s;
  }
  function fill(t, v) { return t.replace('{v}', v); }

  function typingLine(v) {
    if (/^https?:\/\/|^www\.|\b\w+\.(com|cn|net|org|io|me)\b/i.test(v)) return pick(LINES.url);
    if (/原神|提瓦特|神子|八重|稻妻/.test(v)) return pick(LINES.lore);
    if (/[?？]|吗$|呢$|怎么样|为什么|是什么|多少|哪个|如何|能不能/.test(v)) return pick(LINES.question);
    if (v.length > 12) return fill(pick(LINES.long), v.slice(0, 8));
    if (v.length <= 3) return fill(pick(LINES.short), v);
    return fill(pick(LINES.mid), v);
  }

  var bubble, miko, input;
  /* 表单不缓存引用：路由会把整块换掉，缓存下来的节点第二天就不在文档里了。
     统一用「是不是这个选择器」来判断，而不是「是不是那个对象」。 */
  var FORM_SEL = '.start-core [data-search]';
  function grab() {
    bubble = document.querySelector('[data-bubble]');
    miko = document.querySelector('.mast-miko');
    input = document.querySelector('.start-core [data-q]');
  }
  grab();

  var hideTimer = 0;
  function say(text) {
    if (!bubble || !bubble.isConnected) grab();
    if (!bubble) return;
    /* 不是八重皮肤时整块是 display:none —— 这时候别说话，也别白白占着计时器。
       判据用 getClientRects()：手机上气泡是 position:fixed，
       而 fixed 元素的 offsetParent 恒为 null，用 offsetParent 会误判成「不可见」。 */
    if (!bubble.getClientRects().length) return;
    bubble.textContent = text;
    bubble.classList.add('on');
    clearTimeout(hideTimer);
  }

  /* 跳一下。不受 prefers-reduced-motion 影响 —— 用户要求默认就动；
     减弱动效只作用于换页那类大面积位移。 */
  function hop() {
    if (!miko || !miko.isConnected) grab();
    if (!miko || !miko.getClientRects().length) return;
    miko.classList.remove('hop');
    void miko.offsetWidth;
    miko.classList.add('hop');
    setTimeout(function () { miko.classList.remove('hop'); }, 470);
  }

  /* 闲置太久就不吭声了；连续太久没人理，语气会变 */
  var idleTimer = 0, boredTimer = 0, boredStage = 0, typingTimer = 0;
  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (!input || document.activeElement !== input) {
        say(pick(LINES.idle));
        scheduleIdle();
      }
    }, 9000 + Math.random() * 5000);
  }
  function scheduleBored() {
    clearTimeout(boredTimer);
    boredTimer = setTimeout(function () {
      if (!input || document.activeElement !== input) {
        say(pick(LINES.bored));
        if (++boredStage < 3) scheduleBored();
      }
    }, 55000);
  }
  function touched() { boredStage = 0; clearTimeout(boredTimer); scheduleBored(); scheduleIdle(); }

  document.addEventListener('focusin', function (e) {
    if (!input || e.target !== input) return;
    clearTimeout(idleTimer);
    say(pick(LINES.focus));
  });
  document.addEventListener('focusout', function (e) {
    if (!input || e.target !== input) return;
    if (!input.value.trim()) say(pick(LINES.idle));
    scheduleIdle();
  });
  document.addEventListener('input', function (e) {
    if (!input || e.target !== input) return;
    touched();
    var v = input.value.trim();
    clearTimeout(typingTimer);
    if (!v) { say(pick(LINES.focus)); return; }
    typingTimer = setTimeout(function () { say(typingLine(v)); }, 420);
  });
  document.addEventListener('submit', function (e) {
    if (!e.target.matches || !e.target.matches(FORM_SEL)) return;
    clearTimeout(typingTimer);
    var q = e.target.querySelector('[data-q]');
    var v = q ? q.value.trim() : '';
    if (v) { say(pick(LINES.submit)); hop(); } else say(pick(LINES.empty));
    touched();
  });
  document.addEventListener('click', function (e) {
    /* 点角色本体：它会被搜索框挡住下半身，所以只认上半截 */
    var t = e.target;
    if (!t.closest) return;
    if (miko && t.closest('.mast-miko')) { say(pick(LINES.poke)); hop(); touched(); return; }
    if (t.closest('.eng-menu [data-e]')) { say(pick(LINES.engine)); touched(); return; }
    /* 切皮肤：切回八重时她应该已经在那儿了，重新打声招呼 */
    if (t.closest('[data-theme-btn]')) {
      setTimeout(function () {
        grab();
        if (bubble && bubble.getClientRects().length) { say(pick(LINES.idle)); touched(); }
      }, 80);
    }
  });

  /* 路由换回起始页后，元素都换了一批，重新挂一次闲置计时 */
  if (window.__dygUi && window.__dygUi.afterSwap) {
    var orig = window.__dygUi.afterSwap;
    window.__dygUi.afterSwap = function () {
      orig.apply(this, arguments);
      grab();
      scheduleIdle();
    };
  }

  grab();
  if (bubble) say(pick(LINES.idle));
  scheduleIdle();
  scheduleBored();
})();
