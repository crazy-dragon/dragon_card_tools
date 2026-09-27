/* ==========================================================================
   汉字部首 214 · 小工具
   --------------------------------------------------------------------------
   康煕部首 214 个（+ 1 张封面卡），一份数据两种视图，顶栏分段控件切换：

     chart 部首表   按**笔画数分 5 档**（1-2 / 3-4 / 5-6 / 7-9 / 10+）分段，
                    每段内按康煕序号排成网格 —— 这就是真实「部首检字表」的排法，
                    是模板做不到的那个东西。点格子 = 读部首名 + 跳到那张卡。
     card  卡片     字形 / 变形 / 名称 / 中英义类 / 3 个例字（例词带 HSK 等级）
                    / 中英口诀。

   三条发音通道（与音标拼读同构）：
     部首名 -> 卡片上的 🔊，读 nameZh（"单人旁"）
     例字   -> 点例字格，读那个字
     例词   -> 点例词，读那个词
   都走浏览器 speechSynthesis（顶栏可选中文 voice），宿主的 playAudio 不用。

   笔顺（stroke_play）走 Hanzi Writer 懒加载 CDN —— 宿主没有内置这个库，
   离线时加载失败 ⇒ 按钮自动隐藏并 toast 说明（和原模板同样的降级，但不静默）。

   ★ 数据顺序本身是「核心部首在前」（core=true 的 95 个先出场），卡片视图
     保持这个学习顺序；部首表才按笔画分档重排（检字表的逻辑，跟学习顺序无关）。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '汉字部首 · 214';
  var VOICE_LANG = TOOL.voiceLang || 'zh-CN';
  var VIEWS = (TOOL.views && TOOL.views.length) ? TOOL.views : [
    { id: 'chart', label: '部首表' },
    { id: 'card',  label: '卡片' }
  ];
  var PAGE_SIZE = 500;                    /* 215 张，一次读完 */
  var LS = 'dc-rad-';                     /* localStorage 前缀 */

  var SKINS = [
    { id: 'cream', name: '奶油', icon: 'fa-sun' },
    { id: 'glass', name: '墨玻璃', icon: 'fa-moon' },
    { id: 'category', name: '分类彩', icon: 'fa-gem' }
  ];

  /* ==========================================================================
     笔画分档：数据里的 _col 就是按这个分的（1-2 蓝 / 3-4 青 / 5-6 紫 / 7-9 橙 / 10+ 灰）
     这里只给类名，色值写在 cards.css 的 .bd-* 上（各皮肤一套）。
     ========================================================================== */
  var BANDS = [
    { cls: 'bd-12', label: '1–2 画', en: '1–2 strokes', min: 1, max: 2 },
    { cls: 'bd-34', label: '3–4 画', en: '3–4 strokes', min: 3, max: 4 },
    { cls: 'bd-56', label: '5–6 画', en: '5–6 strokes', min: 5, max: 6 },
    { cls: 'bd-79', label: '7–9 画', en: '7–9 strokes', min: 7, max: 9 },
    { cls: 'bd-10', label: '10 画以上', en: '10+ strokes', min: 10, max: 999 }
  ];
  function bandOf(st) {
    var n = Number(st) || 1;
    for (var i = 0; i < BANDS.length; i++) if (n >= BANDS[i].min && n <= BANDS[i].max) return BANDS[i];
    return BANDS[BANDS.length - 1];
  }

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    intro: null,
    view: 'chart',
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    coreOnly: false,
    _voiceWarned: false,
    _refreshLock: false
  };
  try {
    var sv = localStorage.getItem(LS + 'view');
    if (sv && VIEWS.some(function (v) { return v.id === sv; })) state.view = sv;
  } catch (e) {}
  try {
    var ss = localStorage.getItem(LS + 'skin');
    if (ss) state.skin = ss;
  } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem(LS + 'font')) || 1; } catch (e) {}
  try { state.coreOnly = localStorage.getItem(LS + 'core') === '1'; } catch (e) {}

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ==========================================================================
     toast / tooltip（与其它工具逐字相同）
     ========================================================================== */
  var _toastTimer = null;
  function showToast(msg, isError) {
    var el = $id('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { el.className = 'toast' + (isError ? ' error' : ''); }, 2500);
  }

  function initTooltip() {
    var timer = null, current = null;
    function hide() {
      clearTimeout(timer); timer = null; current = null;
      var tip = $id('global-tooltip');
      if (tip) tip.classList.remove('show');
    }
    document.addEventListener('mouseover', function (e) {
      var t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      var el = t.closest('[data-tooltip]');
      if (!el || el === current) return;
      current = el;
      clearTimeout(timer);
      timer = setTimeout(function () {
        var text = el.getAttribute('data-tooltip');
        if (!text) return;
        var tip = $id('global-tooltip');
        if (!tip) return;
        tip.textContent = text;
        tip.classList.add('show');
        var r = el.getBoundingClientRect();
        var tr = tip.getBoundingClientRect();
        var left = r.left + r.width / 2 - tr.width / 2;
        var top = r.bottom + 8;
        if (left < 8) left = 8;
        if (left + tr.width > window.innerWidth - 8) left = window.innerWidth - tr.width - 8;
        if (top + tr.height > window.innerHeight - 8) top = r.top - tr.height - 8;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
      }, 300);
    });
    document.addEventListener('mouseleave', function (e) {
      var t = e.target;
      if (!t || typeof t.closest !== 'function') { hide(); return; }
      if (t.closest('[data-tooltip]')) hide();
    });
    document.addEventListener('mousedown', hide);
    window.addEventListener('scroll', hide, true);
  }

  /* ==========================================================================
     音色
     ========================================================================== */
  var voiceMgr = {
    voices: [],
    init: function () {
      var self = this;
      function load() {
        self.voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
        renderVoiceDropdown();
      }
      if (window.speechSynthesis) {
        load();
        if (window.speechSynthesis.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = load;
      }
    },
    _primary: function (tag) { return String(tag || '').split('-')[0].toLowerCase(); },
    pickVoice: function (lang) {
      if (!lang) return null;
      var primary = this._primary(lang);
      var saved = null;
      try { saved = localStorage.getItem('dc-voice-' + primary); } catch (e) {}
      var fallback = null;
      for (var i = 0; i < this.voices.length; i++) {
        var v = this.voices[i];
        if (saved && v.voiceURI === saved) return v;
        if (!fallback && this._primary(v.lang) === primary) fallback = v;
        if (v.lang && v.lang.toLowerCase() === String(lang).toLowerCase()) return v;
      }
      return fallback;
    },
    saveVoice: function (lang, voice) {
      try { localStorage.setItem('dc-voice-' + this._primary(lang), voice ? voice.voiceURI : ''); } catch (e) {}
    },
    sampleText: function () { return '单人旁'; },
    speak: function (text, lang) {
      if (!('speechSynthesis' in window)) { showToast('这个浏览器不支持朗读', true); return; }
      var u = new SpeechSynthesisUtterance(text || '');
      var voice = this.pickVoice(lang || VOICE_LANG);
      if (voice) u.voice = voice;
      else if (lang) u.lang = lang;
      try {
        window.speechSynthesis.cancel();
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        setTimeout(function () { window.speechSynthesis.speak(u); }, 80);
      } catch (e) {}
    }
  };

  function warnIfNoVoice() {
    if (state._voiceWarned) return;
    if (voiceMgr.pickVoice(VOICE_LANG)) return;
    state._voiceWarned = true;
    showToast('系统里没有中文语音包，读音可能不准', false);
  }

  function renderVoiceDropdown() {
    var list = $('.voice-list');
    if (!list) return;
    list.innerHTML = '';
    var lang = voiceMgr._primary(VOICE_LANG);
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === lang; });
    var pick = voiceMgr.pickVoice(VOICE_LANG);
    var activeUri = pick ? pick.voiceURI : null;

    if (!voices.length) {
      var empty = document.createElement('div');
      empty.className = 'voice-option muted';
      empty.textContent = '系统里没有中文语音包，点一下用默认的试听。';
      empty.addEventListener('click', function () {
        voiceMgr.saveVoice(VOICE_LANG, null);
        voiceMgr.speak(voiceMgr.sampleText(), VOICE_LANG);
        renderVoiceDropdown();
      });
      list.appendChild(empty);
      return;
    }
    voices.forEach(function (v) {
      var opt = document.createElement('div');
      opt.className = 'voice-option' + (v.voiceURI === activeUri ? ' active' : '');
      opt.dataset.voiceUri = v.voiceURI;
      opt.textContent = v.name;
      list.appendChild(opt);
    });
  }

  /* ==========================================================================
     皮肤 / 字号
     ========================================================================== */
  function applySkin() {
    var h = document.documentElement;
    SKINS.forEach(function (s) { h.classList.remove('skin-' + s.id); });
    h.classList.add('skin-' + state.skin);
    try { localStorage.setItem(LS + 'skin', state.skin); } catch (e) {}
    renderSkinList();
  }
  function renderSkinList() {
    var list = $id('style-list');
    if (!list) return;
    list.innerHTML = SKINS.map(function (s) {
      return '<div class="skin-option' + (state.skin === s.id ? ' active' : '') + '" data-style="' + s.id + '">' +
        '<i class="fa-solid ' + s.icon + '"></i><span>' + esc(s.name) + '</span></div>';
    }).join('');
  }
  function applyCardFont() {
    document.documentElement.style.setProperty('--card-font-scale', String(state.fontSize));
    var v = $id('font-size-value');
    if (v) v.textContent = Math.round(state.fontSize * 100) + '%';
    try { localStorage.setItem(LS + 'font', state.fontSize); } catch (e) {}
  }

  /* ==========================================================================
     笔顺：Hanzi Writer 懒加载 CDN（宿主没内置），失败就降级
     ========================================================================== */
  var stroke = {
    loading: false,
    fail: false,
    queue: [],
    lib: function (onOk, onFail) {
      var self = this;
      if (window.HanziWriter) { onOk(); return; }
      if (self.fail) { onFail(); return; }
      self.queue.push([onOk, onFail]);
      if (self.loading) return;
      self.loading = true;
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hanzi-writer@3/dist/hanzi-writer.min.js';
      s.onload = function () {
        self.loading = false;
        self.queue.splice(0).forEach(function (p) { p[0](); });
      };
      s.onerror = function () {
        self.fail = true; self.loading = false;
        self.queue.splice(0).forEach(function (p) { p[1](); });
        renderList();                       /* 重画一遍，把笔顺按钮去掉 */
      };
      document.head.appendChild(s);
    },
    overlay: function () {
      var ov = $id('zr-sov');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'zr-sov';
        ov.className = 'zr-sov';
        ov.innerHTML =
          '<div class="zr-sov-panel">' +
            '<div class="zr-sov-char"></div>' +
            '<div class="zr-sov-stage"></div>' +
            '<div class="zr-sov-msg"></div>' +
            '<div class="zr-sov-btns">' +
              '<button type="button" data-sov="replay"><i class="fa-solid fa-rotate-right"></i> 重播</button>' +
              '<button type="button" data-sov="close">关闭</button>' +
            '</div>' +
          '</div>';
        ov.addEventListener('click', function (ev) {
          var t = ev.target;
          if ((t.closest && t.closest('[data-sov="close"]')) || t === ov) ov.classList.remove('on');
          else if (t.closest && t.closest('[data-sov="replay"]') && ov.__writer) ov.__writer.animateCharacter();
        });
        document.body.appendChild(ov);
      }
      return ov;
    },
    open: function (ch) {
      var self = this;
      var ov = self.overlay();
      ov.classList.add('on');
      $('.zr-sov-char', ov).textContent = '「' + ch + '」 笔顺演示';
      var stage = $('.zr-sov-stage', ov);
      var msg = $('.zr-sov-msg', ov);
      stage.innerHTML = '';
      msg.textContent = '笔顺加载中…';
      self.lib(function () {
        window.HanziWriter.loadCharacterData(ch).then(function (data) {
          if (!ov.classList.contains('on')) return;
          stage.innerHTML = '';
          msg.textContent = '';
          var W = Math.min(250, Math.max(150, (window.innerWidth || 375) - 100));
          /* create(target, char, options)：target 传元素，先建容器再 create */
          var holder = document.createElement('div');
          stage.appendChild(holder);
          ov.__writer = window.HanziWriter.create(holder, ch, {
            width: W, height: W, padding: 8,
            showOutline: true,
            strokeAnimationSpeed: 1,
            delayBetweenStrokes: 220,
            charDataLoader: function () { return Promise.resolve(data); }
          });
          ov.__writer.animateCharacter();
        }).catch(function () {
          msg.textContent = '没拿到「' + ch + '」的笔顺数据';
        });
      }, function () {
        msg.textContent = '笔顺需要联网加载，当前离线';
        stage.innerHTML = '';
      });
    }
  };

  /* ==========================================================================
     数据
     ========================================================================== */
  function loadAll() {
    if (!window.cardAPI || !cardAPI.getPage) return Promise.resolve();
    return cardAPI.getPage(1, PAGE_SIZE).then(function (d) {
      var cards = (d.cards || []).slice();
      state.intro = null;
      state.all = [];
      cards.forEach(function (c) {
        var t = (c.data || {}).type;
        if (t === 'intro') { if (!state.intro) state.intro = c; }
        else state.all.push(c);
      });
    });
  }
  function findCard(id) {
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) return state.all[i];
    return null;
  }
  /* 可见集合：只看核心时过滤掉 core=false */
  function visibleCards() {
    if (!state.coreOnly) return state.all;
    return state.all.filter(function (c) { return (c.data || {}).core === true; });
  }
  function updateStatsText() {
    var marked = state.all.filter(function (c) { return c.is_unknown === 1; }).length;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + state.all.length;
  }

  /* ==========================================================================
     卡面
     ========================================================================== */
  function glyphOf(d) {
    /* 显示字形：disp（常用变形）优先，没有就用 char */
    return d.disp || d.char || '';
  }
  function variantsOf(d) {
    var out = [];
    if (d.disp && d.char && d.disp !== d.char) out.push(d.char);
    (d.var || []).forEach(function (v) { if (v && out.indexOf(v) < 0 && v !== glyphOf(d)) out.push(v); });
    return out;
  }

  function railButtons(card) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    var html = '<div class="dc-acts">' +
      '<button type="button" data-action="play" data-tooltip="读部首名"><i class="fa-solid fa-volume-high"></i></button>' +
      (!stroke.fail ? '<button type="button" data-action="stroke" data-tooltip="笔顺演示"><i class="fa-solid fa-pen-nib"></i></button>' : '') +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
    return html;
  }

  function introCard() {
    var c = state.intro;
    if (!c) return '';
    var d = c.data || {};
    return '<div class="zr-root zr-intro" data-card-id="' + c.id + '">' +
      '<div class="zr-intro-in">' +
        '<div class="zr-intro-zh">' + esc(d.nameZh || '部首') + '</div>' +
        '<div class="zr-intro-en">' + esc(d.nameEn || '') + '</div>' +
      '</div>' +
    '</div>';
  }

  function renderCard(card) {
    var d = card.data || {};
    if (d.type === 'intro') return introCard();

    var band = bandOf(d.st);
    var g = glyphOf(d);
    var vars = variantsOf(d);
    var ex = Array.isArray(d.ex) ? d.ex : [];

    var exHtml = '';
    if (ex.length) {
      exHtml = '<div class="zr-exsec">例字 · EXAMPLE CHARACTERS</div><div class="zr-ex">' +
        ex.map(function (e) {
          var ch = e[0], py = e[1], en = e[2], w = e[3] || {};
          return '<div class="zr-excell" data-exchar="' + esc(ch) + '" data-tooltip="读 ' + esc(ch) + '">' +
            (!stroke.fail ? '<button type="button" class="zr-strokebtn" data-stroke="' + esc(ch) +
              '" data-tooltip="笔顺">笔顺</button>' : '') +
            '<div class="zr-exchar">' + esc(ch) + '</div>' +
            '<div class="zr-exp">' + esc(py) + '</div>' +
            (en ? '<div class="zr-exen">' + esc(en) + '</div>' : '') +
            (w.w ? '<div class="zr-exw"><span class="zr-hlv">' + esc(w.lv || '') + '</span> ' +
              '<span class="zr-exword" data-word="' + esc(w.w) + '" data-tooltip="读 ' + esc(w.w) + '">' +
              esc(w.w) + '</span></div>' : '') +
          '</div>';
        }).join('') + '</div>';
    }

    return '<div class="zr-root ' + band.cls + (d.core === true ? ' is-core' : '') + '" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<div class="dc-top">' +
        '<span class="zr-no">#' + esc(d.no) + '</span>' +
        '<span class="zr-chip">' + esc(d.st) + ' 画</span>' +
        (d.core === true ? '<span class="zr-chip zr-core">核心</span>' : '') +
        '<span class="zr-chip zr-band">' + esc(band.label) + '</span>' +
      '</div>' +
      '<div class="zr-glyph">' +
        '<div class="zr-big" data-stroke="' + esc(d.char || g) + '">' + esc(g) + '</div>' +
        (vars.length ? '<div class="zr-varmini">' + vars.map(function (v) { return esc(v); }).join(' ') + '</div>' : '') +
        '<div class="zr-name">' + esc(d.nameZh || '') +
          (d.py ? '<span class="zr-py">' + esc(d.py) + '</span>' : '') +
          (d.en ? '<span class="zr-en">' + esc(d.en) + '</span>' : '') +
        '</div>' +
        (!stroke.fail ? '<button type="button" class="zr-strokebig" data-stroke="' + esc(d.char || g) +
          '" data-tooltip="笔顺演示"><i class="fa-solid fa-pen-nib"></i> 笔顺</button>' : '') +
      '</div>' +
      (d.sem ? '<div class="zr-mean">' + esc(d.sem) +
        (d.semEn ? '<span class="zr-men">' + esc(d.semEn) + '</span>' : '') + '</div>' : '') +
      exHtml +
      (d.tip ? '<div class="zr-tip"><i class="fa-solid fa-lightbulb"></i> ' + esc(d.tip) +
        (d.tipEn ? '<span class="zr-tipen">' + esc(d.tipEn) + '</span>' : '') + '</div>' : '') +
    '</div>';
  }

  /* ==========================================================================
     部首表视图：按笔画分 5 档，每档一个分组
     ========================================================================== */
  function chartCell(card) {
    var d = card.data || {};
    var g = glyphOf(d);
    return '<div class="c-cell ' + bandOf(d.st).cls + (d.core === true ? ' is-core' : '') +
      '" data-card-id="' + card.id + '" data-act="jump"' +
      ' data-tooltip="#' + esc(d.no) + ' ' + esc(d.nameZh || '') + ' · 点一下看卡片">' +
      (card.is_unknown === 1 ? '<span class="c-star"><i class="fa-solid fa-star"></i></span>' : '') +
      (card.is_favorite === 1 ? '<span class="c-fav"><i class="fa-solid fa-bookmark"></i></span>' : '') +
      '<span class="c-glyph">' + esc(g) + '</span>' +
      '<span class="c-no">' + esc(d.no) + '</span>' +
      '<span class="c-name">' + esc(d.nameZh || '') + '</span>' +
      '</div>';
  }

  function renderChart() {
    var box = $id('study-list');
    var cards = visibleCards();
    if (!cards.length) {
      box.innerHTML = '<div class="empty-state">' +
        (state.coreOnly ? '这组里没有核心部首。' : '还没有卡片。') + '</div>';
      return;
    }
    var html = '';
    BANDS.forEach(function (b) {
      var group = cards.filter(function (c) { return bandOf((c.data || {}).st) === b; });
      if (!group.length) return;
      group.sort(function (a, x) { return (Number(a.data.no) || 0) - (Number(x.data.no) || 0); });
      html += '<div class="zr-band ' + b.cls + '">' +
        '<div class="zr-band-head"><span class="zr-band-zh">' + esc(b.label) + '</span>' +
        '<span class="zr-band-en">' + esc(b.en) + '</span>' +
        '<span class="zr-band-n">' + group.length + '</span></div>' +
        '<div class="zr-grid">' + group.map(chartCell).join('') + '</div>' +
      '</div>';
    });
    box.innerHTML = html;
  }

  /* ==========================================================================
     渲染
     ========================================================================== */
  function renderList() {
    var box = $id('study-list');
    if (!box) return;
    var content = $('.study-content');
    var isChart = (state.view === 'chart' && !state.singleCardMode);
    if (content) {
      content.classList.toggle('wide', state.singleCardMode);
      content.classList.toggle('chart-wide', isChart);
    }
    if (state.singleCardMode) { renderSingleCardStage(); return; }
    if (isChart) { renderChart(); return; }

    var cards = visibleCards();
    if (!cards.length) {
      box.innerHTML = '<div class="empty-state">' +
        (state.coreOnly ? '这组里没有核心部首。' : '还没有卡片。') + '</div>';
      return;
    }
    var head = (state.view === 'card' && state.intro && !state.coreOnly) ? introCard() : '';
    box.innerHTML = head + cards.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 16, 280) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }

  /* 只重画一张卡（标记/收藏后）：别整列表重渲染 */
  function patchCard(card) {
    if (state.view === 'chart') { patchCell(card); return; }
    var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
  }
  function patchCell(card) {
    var el = document.querySelector('#study-list .c-cell[data-card-id="' + card.id + '"]');
    if (el) el.outerHTML = chartCell(card);
  }

  /* ===== 单卡模式（只在卡片视图里可用） ===== */
  function toggleSingleCardMode() {
    if (state.view !== 'card') return;
    state.singleCardMode = !state.singleCardMode;
    state.singleCardIndex = 0;
    var btn = $id('card-view-btn');
    if (btn) btn.classList.toggle('active', state.singleCardMode);
    renderList();
  }
  function exitSingleCardMode() {
    if (!state.singleCardMode) return;
    state.singleCardMode = false;
    var btn = $id('card-view-btn');
    if (btn) btn.classList.remove('active');
    renderList();
  }
  function renderSingleCardStage() {
    var box = $id('study-list');
    if (!box) return;
    var cards = visibleCards();
    if (!cards.length) { box.innerHTML = '<div class="empty-state">还没有卡片。</div>'; return; }
    var prevSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
    var nextSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    box.innerHTML =
      '<div class="single-card-stage">' +
        '<div class="sc-main"><div class="sc-card-wrap" id="sc-card-wrap"></div></div>' +
        '<div class="sc-nav-col">' +
          '<button class="sc-nav sc-prev" data-sc="prev" data-tooltip="上一张" aria-label="上一张">' + prevSvg + '</button>' +
          '<div class="sc-progress"><span id="sc-idx">1</span> / ' + cards.length + '</div>' +
          '<button class="sc-nav sc-next" data-sc="next" data-tooltip="下一张" aria-label="下一张">' + nextSvg + '</button>' +
        '</div>' +
      '</div>';
    renderSingleCardContent(state.singleCardIndex, false);
  }
  function renderSingleCardContent(idx, animate) {
    var cards = visibleCards();
    if (!cards.length) return;
    if (idx < 0) idx = cards.length - 1;
    if (idx >= cards.length) idx = 0;
    state.singleCardIndex = idx;
    var wrap = $id('sc-card-wrap');
    if (!wrap) return;
    wrap.innerHTML = renderCard(cards[idx]);
    var idxEl = $id('sc-idx');
    if (idxEl) idxEl.textContent = idx + 1;
    if (animate) {
      var target = wrap.firstElementChild || wrap;
      target.classList.remove('sc-anim');
      void target.offsetWidth;
      target.classList.add('sc-anim');
    }
  }
  function singleCardNav(delta) {
    renderSingleCardContent(state.singleCardIndex + delta, true);
  }

  /* ==========================================================================
     交互
     ========================================================================== */
  function playRadical(card) {
    var d = card.data || {};
    cardAPI.track('audio_play', card.id);
    var text = d.nameZh || d.char || '';
    if (!text) { showToast('这张卡没有可朗读的内容', true); return; }
    warnIfNoVoice();
    voiceMgr.speak(text, VOICE_LANG);
  }
  function playChar(card, ch) {
    if (!ch) return;
    cardAPI.track('word_play', card.id);
    warnIfNoVoice();
    voiceMgr.speak(ch, VOICE_LANG);
  }
  function handleMark(card) {
    var want = card.is_unknown === 1 ? 0 : 1;
    cardAPI.mark(card.id, want).then(function (d) {
      card.is_unknown = (d && typeof d.is_unknown !== 'undefined') ? d.is_unknown : want;
      cardAPI.track('word_mark', card.id);
      if (state.view === 'chart') patchCell(card);
      else if (state.singleCardMode) renderSingleCardContent(state.singleCardIndex, false);
      else patchCard(card);
      updateStatsText();
    });
  }
  function handleFavorite(card) {
    var want = card.is_favorite === 1 ? 0 : 1;
    cardAPI.favorite(card.id, want).then(function (d) {
      card.is_favorite = (d && typeof d.is_favorite !== 'undefined') ? d.is_favorite : want;
      cardAPI.track('favorite_toggle', card.id);
      if (state.view === 'chart') patchCell(card);
      else if (state.singleCardMode) renderSingleCardContent(state.singleCardIndex, false);
      else patchCard(card);
    });
  }

  /* 从部首表跳到卡片：切视图 → 滚到那张卡 → 闪一下 */
  function jumpToCard(id) {
    var card = findCard(id);
    if (!card) return;
    playRadical(card);
    if (state.view === 'card' && !state.singleCardMode) {
      scrollToCard(card);
      return;
    }
    setView('card');
    scrollToCard(card);
  }
  function scrollToCard(card) {
    requestAnimationFrame(function () {
      var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('zr-flash');
      void el.offsetWidth;
      el.classList.add('zr-flash');
      setTimeout(function () { el.classList.remove('zr-flash'); }, 1400);
    });
  }

  /* ===== 视图切换 ===== */
  function renderViewSeg() {
    var box = $id('view-seg');
    if (!box) return;
    box.innerHTML = VIEWS.map(function (v) {
      return '<button type="button" data-view="' + v.id + '"' + (state.view === v.id ? ' class="on"' : '') + '>' +
        esc(v.label) + '</button>';
    }).join('');
  }
  function setView(id) {
    if (!VIEWS.some(function (v) { return v.id === id; })) return;
    if (state.view === id && !state.singleCardMode) return;
    state.view = id;
    state.singleCardMode = false;
    state.singleCardIndex = 0;
    try { localStorage.setItem(LS + 'view', id); } catch (e) {}
    var cv = $id('card-view-btn');
    if (cv) {
      cv.classList.remove('active');
      cv.style.display = (id === 'chart') ? 'none' : '';
    }
    renderViewSeg();
    renderList();
    updateStatsText();
    var s = $id('study-scroll');
    if (s) s.scrollTop = 0;
  }

  function setCoreOnly(on) {
    state.coreOnly = !!on;
    try { localStorage.setItem(LS + 'core', state.coreOnly ? '1' : '0'); } catch (e) {}
    var btn = $id('core-only-btn');
    if (btn) btn.classList.toggle('active', state.coreOnly);
    renderList();
    showToast(state.coreOnly ? '只看 ' + visibleCards().length + ' 个核心部首' : '显示全部 ' + state.all.length + ' 个部首');
  }

  /* ===== 事件委托（一处绑完，重渲染不用重绑） ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 笔顺按钮（卡片上的大字 / 例字格 / 大按钮） */
      var strokeEl = target.closest('[data-stroke]');
      if (strokeEl) {
        e.stopPropagation();
        var ch = strokeEl.dataset.stroke;
        var sCardEl = strokeEl.closest('[data-card-id]');
        var sCard = sCardEl ? findCard(sCardEl.dataset.cardId) : null;
        if (sCard) cardAPI.track('stroke_play', sCard.id);
        stroke.open(ch);
        return;
      }
      /* 例词（先判：例词在例字格里，不能让点例词变成读例字） */
      var wordEl = target.closest('[data-word]');
      if (wordEl) {
        e.stopPropagation();
        var wCardEl = wordEl.closest('[data-card-id]');
        var wCard = wCardEl ? findCard(wCardEl.dataset.cardId) : null;
        if (wCard) playChar(wCard, wordEl.dataset.word);
        return;
      }
      /* 例字格 */
      var exEl = target.closest('[data-exchar]');
      if (exEl) {
        e.stopPropagation();
        var eCardEl = exEl.closest('[data-card-id]');
        var eCard = eCardEl ? findCard(eCardEl.dataset.cardId) : null;
        if (eCard) playChar(eCard, exEl.dataset.exchar);
        return;
      }
      /* 部首表格子 = 读名字 + 跳卡 */
      var cell = target.closest('.c-cell[data-act="jump"]');
      if (cell) {
        e.stopPropagation();
        jumpToCard(cell.dataset.cardId);
        return;
      }
      /* 卡片上的动作 */
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl = actionBtn.closest('[data-card-id]');
        var card = cardEl ? findCard(cardEl.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          if (action === 'play') playRadical(card);
          else if (action === 'stroke') stroke.open((card.data || {}).char || glyphOf(card.data || {}));
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }
      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

      /* 部首表 / 卡片 */
      var viewBtn = target.closest('#view-seg button');
      if (viewBtn) { setView(viewBtn.dataset.view); return; }

      /* 只看核心 */
      if (target.closest('#core-only-btn')) { setCoreOnly(!state.coreOnly); return; }

      /* 皮肤下拉 */
      if (target.closest('#style-btn')) {
        var dd = $id('style-dropdown');
        renderSkinList();
        dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        return;
      }
      var styleOpt = target.closest('[data-style]');
      if (styleOpt) {
        state.skin = styleOpt.dataset.style;
        applySkin();
        $id('style-dropdown').style.display = 'none';
        return;
      }

      /* 音色下拉 */
      if (target.closest('.voice-select-btn')) {
        var vdd = $('.voice-dropdown');
        renderVoiceDropdown();
        vdd.style.display = vdd.style.display === 'none' ? 'block' : 'none';
        return;
      }
      var vOpt = target.closest('.voice-option:not(.muted)');
      if (vOpt) {
        var uri = vOpt.dataset.voiceUri;
        var picked = null;
        for (var i = 0; i < voiceMgr.voices.length; i++) {
          if (voiceMgr.voices[i].voiceURI === uri) { picked = voiceMgr.voices[i]; break; }
        }
        voiceMgr.saveVoice(VOICE_LANG, picked);
        renderVoiceDropdown();
        $('.voice-dropdown').style.display = 'none';
        voiceMgr.speak(voiceMgr.sampleText(), VOICE_LANG);
        return;
      }

      /* 字体抽屉 */
      if (target.closest('#font-settings-btn')) {
        var drawer = $id('font-drawer');
        var fbtn = target.closest('#font-settings-btn');
        var r = fbtn.getBoundingClientRect();
        drawer.style.top = (r.bottom + 8) + 'px';
        drawer.style.left = (r.left + r.width / 2) + 'px';
        drawer.style.transform = 'translateX(-50%)';
        drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
        return;
      }
      if (target.closest('#font-size-minus')) {
        state.fontSize = Math.max(0.6, Math.round((state.fontSize - 0.1) * 10) / 10);
        applyCardFont();
        return;
      }
      if (target.closest('#font-size-plus')) {
        state.fontSize = Math.min(1.5, Math.round((state.fontSize + 0.1) * 10) / 10);
        applyCardFont();
        return;
      }
      if (target.closest('#reset-fonts')) { state.fontSize = 1; applyCardFont(); return; }

      /* 刷新 */
      if (target.closest('#refresh-stats')) {
        if (!state._refreshLock) {
          state._refreshLock = true;
          loadAll().then(function () { renderList(); updateStatsText(); });
          showToast('已刷新');
          setTimeout(function () { state._refreshLock = false; }, 1000);
        }
        return;
      }

      if (target.closest('#card-view-btn')) { toggleSingleCardMode(); return; }
      if (target.closest('#scroll-top-btn')) { $id('study-scroll').scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (target.closest('#scroll-bottom-btn')) {
        var s = $id('study-scroll');
        s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
        return;
      }

      /* 点空白处收起浮层 */
      if (!target.closest('#style-dropdown') && !target.closest('#style-btn')) {
        var sdd = $id('style-dropdown');
        if (sdd) sdd.style.display = 'none';
      }
      if (!target.closest('.voice-dropdown') && !target.closest('.voice-select-btn')) {
        var vd = $('.voice-dropdown');
        if (vd) vd.style.display = 'none';
      }
      if (!target.closest('#font-drawer') && !target.closest('#font-settings-btn')) {
        var fd = $id('font-drawer');
        if (fd) fd.style.display = 'none';
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!state.singleCardMode) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); singleCardNav(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); singleCardNav(1); }
      else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); singleCardNav(1); }
      else if (e.key === 'Escape') { e.preventDefault(); exitSingleCardMode(); }
    });
  }

  /* ===== 初始化 ===== */
  function init() {
    applySkin();
    applyCardFont();
    initTooltip();
    voiceMgr.init();
    bindEvents();

    document.title = TITLE;
    var title = $id('study-deck-title');
    if (title) title.textContent = TITLE;

    var cv = $id('card-view-btn');
    if (cv) cv.style.display = (state.view === 'chart') ? 'none' : '';
    var co = $id('core-only-btn');
    if (co) co.classList.toggle('active', state.coreOnly);

    renderViewSeg();
    renderList();

    loadAll().then(function () {
      renderViewSeg();
      renderList();
      updateStatsText();
    }).catch(function () {
      var box = $id('study-list');
      if (box) box.innerHTML = '<div class="empty-state">卡组数据加载失败。</div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
