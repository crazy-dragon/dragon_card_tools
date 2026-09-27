/* ==========================================================================
   英语五种基本句型 · 小工具
   ==========================================================================
   29 张 = 1 张总览 + 15 张句型卡 + 8 张句子成分卡 + 3 张卡型辨析 + 2 张 be 检验法，
   一次读完，卡片顺序 = 卡组顺序。

   与"照抄宿主学习视图"那一代比（原模板 34 就是那一代，要目录 → 页签 → 每页 100 张）：
     · 一次 getPage(1,500) 读完，没有目录、没有页签、没有侧栏
     · 卡面 100% 承袭模板 34 的五种版式（总览 / 句型 / 成分 / 辨析 / 检验），
       由数据里的 type 分流 —— 工具不猜字段、不改内容，只换壳
     · 三套皮肤（奶油 = 原模板的浅色 / 墨玻璃 / 分类彩）
     · 动作栏在**卡头右侧**（原模板的位置），纯图标 + hover 悬浮标签

   ★ 与原模板的两处实现差异（都不影响卡上内容）：
     1. 成分色从内联 style 改成 .r-S/.r-V 这类类名 —— 内联会把皮肤挡死。
     2. 朗读沿用原模板的读法：读卡名（中文标签）；音色走浏览器 speechSynthesis，
        顶栏可选，不用宿主的 playAudio（这样音色下拉才管得住它）。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '英语五种基本句型';
  var PAGE_SIZE = 500;                    /* 29 张，一次读完 */
  var VOICE_TAG = 'zh-CN';

  var SKINS = [
    { id: 'cream', name: '奶油', icon: 'fa-sun' },
    { id: 'glass', name: '墨玻璃', icon: 'fa-moon' },
    { id: 'category', name: '分类彩', icon: 'fa-gem' }
  ];

  /* 五种卡型：颜色与徽章字在这里，规则在 cards.css 的 .sp-t-* 里 */
  var TYPE = {
    overview:  { cls: 'sp-t-overview',  t: '总览' },
    pattern:   { cls: 'sp-t-pattern',   t: '句型' },
    component: { cls: 'sp-t-component', t: '成分' },
    contrast:  { cls: 'sp-t-contrast',  t: '辨析' },
    check:     { cls: 'sp-t-check',     t: '检验' }
  };

  /* 九个句子成分：名字给拆解行用，颜色在 cards.css 的 --r-* 里 */
  var ROLE = {
    'S': '主语', 'V': '谓语', 'P': '表语',
    'O': '宾语', 'IO': '间接宾语', 'DO': '直接宾语',
    'OC': '宾补', 'A': '状语', 'Attr': '定语'
  };

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1
  };
  try {
    var savedSkin = localStorage.getItem('dc-sp-skin');
    if (savedSkin) state.skin = savedSkin;
  } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem('dc-sp-font')) || 1; } catch (e) {}

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ===== toast ===== */
  var _toastTimer = null;
  function showToast(msg, isError) {
    var el = $id('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { el.className = 'toast' + (isError ? ' error' : ''); }, 2500);
  }

  /* ===== 自绘 tooltip ===== */
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

  /* ===== 音色（键沿用本体的 dc-voice-zh） ===== */
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
    pickVoice: function (tag) {
      if (!tag) return null;
      var primary = this._primary(tag);
      var saved = null;
      try { saved = localStorage.getItem('dc-voice-' + primary); } catch (e) {}
      var fallback = null;
      for (var i = 0; i < this.voices.length; i++) {
        var v = this.voices[i];
        if (saved && v.voiceURI === saved) return v;
        if (!fallback && this._primary(v.lang) === primary) fallback = v;
        if (v.lang && v.lang.toLowerCase() === String(tag).toLowerCase()) return v;
      }
      return fallback;
    },
    saveVoice: function (tag, voice) {
      try { localStorage.setItem('dc-voice-' + this._primary(tag), voice ? voice.voiceURI : ''); } catch (e) {}
    },
    sampleText: function () { return '主谓结构'; },
    speak: function (text, tag) {
      if (!('speechSynthesis' in window)) { showToast('这个浏览器不支持朗读', true); return; }
      var u = new SpeechSynthesisUtterance(text || '');
      var voice = this.pickVoice(tag || VOICE_TAG);
      if (voice) u.voice = voice;
      else if (tag) u.lang = tag;
      try {
        /* Chrome/Safari：同步 cancel() + speak() 会把这句话丢掉，先 cancel 下一拍再 speak */
        window.speechSynthesis.cancel();
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        setTimeout(function () { window.speechSynthesis.speak(u); }, 80);
      } catch (e) {}
    }
  };

  function renderVoiceDropdown() {
    var list = $('.voice-list');
    if (!list) return;
    list.innerHTML = '';
    var lang = voiceMgr._primary(VOICE_TAG);
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === lang; });
    var pick = voiceMgr.pickVoice(VOICE_TAG);
    var activeUri = pick ? pick.voiceURI : null;

    if (!voices.length) {
      var empty = document.createElement('div');
      empty.className = 'voice-option muted';
      empty.textContent = '系统里没有中文音色，点一下用默认的试听。';
      empty.addEventListener('click', function () {
        voiceMgr.saveVoice(VOICE_TAG, null);
        voiceMgr.speak(voiceMgr.sampleText(), VOICE_TAG);
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

  /* ===== 皮肤 ===== */
  function applySkin() {
    var h = document.documentElement;
    SKINS.forEach(function (s) { h.classList.remove('skin-' + s.id); });
    h.classList.add('skin-' + state.skin);
    try { localStorage.setItem('dc-sp-skin', state.skin); } catch (e) {}
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

  /* ===== 字号：只动卡内文字（--card-font-scale），不动卡盒 ===== */
  function applyCardFont() {
    document.documentElement.style.setProperty('--card-font-scale', String(state.fontSize));
    var v = $id('font-size-value');
    if (v) v.textContent = Math.round(state.fontSize * 100) + '%';
    try { localStorage.setItem('dc-sp-font', state.fontSize); } catch (e) {}
  }

  /* ===== 数据 ===== */
  function cardType(card) { return (card.data || {}).type || 'pattern'; }
  function typeMeta(card) { return TYPE[cardType(card)] || TYPE.pattern; }
  /* 顺序按 item_order（作者编排的讲义序）：总览 → 五种句型各三例 → 七种成分 → 三张辨析 → 两张检验。
     不依赖服务端的 current_order —— 那是**学习队列序**，/v1/reorder 会按"未掌握排前面"把它打乱
     （deck 21 真库里就留着一处陈旧值：总览卡被挪到了第 3 位），而这个工具从头到尾是"读一遍讲义"，
     卡片之间的先后本身就是内容。宿主的 page 接口带 item_order，所以这里排得回来。
     顺带：新导入的卡组 current_order 本来就等于 item_order（app.py 建 progress 时就是这么写的），
     所以正常情况这次排序是个恒等操作，只在队列被历史动作打乱时才起作用。 */
  function byItemOrder(a, b) {
    var x = a.item_order == null ? 0 : a.item_order;
    var y = b.item_order == null ? 0 : b.item_order;
    return x - y;
  }
  function loadAll() {
    if (!window.cardAPI || !cardAPI.getPage) return Promise.resolve();
    return cardAPI.getPage(1, PAGE_SIZE).then(function (d) {
      state.all = (d.cards || []).slice().sort(byItemOrder);
    });
  }
  function findCard(id) {
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) return state.all[i];
    return null;
  }
  function updateStatsText() {
    var cards = state.all;
    var marked = cards.filter(function (c) { return c.is_unknown === 1; }).length;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + cards.length;
  }

  /* ==========================================================================
     卡面（承袭模板 34）
     ========================================================================== */
  function roleOf(r) { return ROLE[r] ? ' r-' + r : ''; }
  function roleName(r) { return ROLE[r] || ''; }

  function tok(t) {
    if (!t) return '';
    return '<span class="sp-tok' + roleOf(t.role) + '">' + esc(t.text) + '</span>';
  }
  /* 把 breakdown 拼回一句例句（原模板就是这么做的，不用数据里的 sentence 字段） */
  function sent(bd, cls) {
    if (!bd || !bd.length) return '';
    var parts = [];
    for (var i = 0; i < bd.length; i++) parts.push(tok(bd[i]));
    return '<span class="' + (cls || 'sp-content') + '">' + parts.join(' ') + '</span>';
  }
  function formula(p) {
    if (!p) return '';
    var toks = p.split('+'), out = '';
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i].trim();
      out += ROLE[t] ? '<span class="sp-part r-' + t + '">' + esc(t) + '</span>'
                     : '<span class="sp-plus">' + esc(t) + '</span>';
    }
    return out;
  }
  function breakdown(bd) {
    if (!bd || !bd.length) return '';
    var out = '';
    for (var i = 0; i < bd.length; i++) {
      out += '<div class="sp-row"><span class="sp-dot' + roleOf(bd[i].role) + '"></span>' +
        tok(bd[i]) + '<span class="sp-role">' + esc(roleName(bd[i].role)) + '</span></div>';
    }
    return out;
  }

  /* 动作栏（卡头右侧）：朗读 / 标记 / 收藏 */
  function actsHtml(card) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="sp-acts">' +
      '<button type="button" class="sp-act" data-action="play" data-tooltip="朗读"><i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="sp-act act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="sp-act act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }

  function nameEn(d) { return d.labelEn ? '<div class="sp-name-en">' + esc(d.labelEn) + '</div>' : ''; }
  function noteZh(d) { return d.note ? '<div class="sp-note">' + esc(d.note) + '</div>' : ''; }
  function noteEn(d) { return d.noteEn ? '<div class="sp-note-en">' + esc(d.noteEn) + '</div>' : ''; }
  function trans(d) { return d.sentenceZh ? '<div class="sp-trans"><b>译：</b>' + esc(d.sentenceZh) + '</div>' : ''; }

  /* ① 总览：五种句型一览 + 一段总结 */
  function renderOverview(d) {
    var rows = d.rows || [], ov = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      ov += '<div class="sp-ov-item"><span class="sp-ov-num">' + (i + 1) + '</span>' +
        '<div class="sp-ov-body">' +
          '<div class="sp-ov-head"><span class="sp-formula">' + formula(r.pattern) + '</span>' +
            '<span class="sp-ov-name">' + esc(r.labelZh) + '</span></div>' +
          '<div class="sp-ov-sentence">' + esc(r.sentence) + '</div>' +
        '</div></div>';
    }
    return '<div class="sp-name sp-name-xl">' + esc(d.labelZh) + '</div>' + nameEn(d) +
      '<div class="sp-overview">' + ov + '</div>' + noteZh(d);
  }

  /* ② 句型：主角是例句（34px），下面是公式 + 卡名 + 成分拆解 */
  function renderPattern(d) {
    return (d.breakdown && d.breakdown.length ? '<div class="sp-sentence">' + sent(d.breakdown, '') + '</div>' : '') +
      '<div class="sp-formula-row">' +
        (d.pattern ? '<div class="sp-formula">' + formula(d.pattern) + '</div>' : '') +
        '<div class="sp-name">' + esc(d.labelZh) + '</div>' +
      '</div>' +
      nameEn(d) +
      '<div class="sp-sec">成分拆解</div>' +
      (d.breakdown && d.breakdown.length ? '<div class="sp-breakdown">' + breakdown(d.breakdown) + '</div>' : '') +
      noteZh(d) + trans(d);
  }

  /* ③ 成分：讲解在前，例句在后 */
  function renderComponent(d) {
    return '<div class="sp-name sp-name-lg">' + esc(d.labelZh) + '</div>' + nameEn(d) +
      noteZh(d) + noteEn(d) +
      (d.breakdown && d.breakdown.length
        ? '<div class="sp-sec sp-sec-gap">Example</div>' +
          '<div class="sp-example">' + sent(d.breakdown, '') + '</div>' +
          '<div class="sp-breakdown">' + breakdown(d.breakdown) + '</div>'
        : '') +
      trans(d);
  }

  /* ④ 辨析：句子 A / 句子 B 两句对照 */
  function renderContrast(d) {
    return '<div class="sp-name sp-name-md">' + esc(d.labelZh) + '</div>' + nameEn(d) +
      '<div class="sp-contrast">' +
        '<div class="sp-c-item"><div class="sp-c-tag">句子 A</div>' +
          (d.breakdown && d.breakdown.length ? '<div class="sp-c-sentence">' + sent(d.breakdown, '') + '</div>' : '') +
          (d.pattern ? '<div class="sp-formula">' + formula(d.pattern) + '</div>' : '') +
          (d.breakdown && d.breakdown.length ? '<div class="sp-breakdown">' + breakdown(d.breakdown) + '</div>' : '') +
        '</div>' +
        '<div class="sp-c-item"><div class="sp-c-tag">句子 B</div>' +
          (d.breakdown2 && d.breakdown2.length ? '<div class="sp-c-sentence">' + sent(d.breakdown2, '') + '</div>' : '') +
          (d.pattern2 ? '<div class="sp-formula">' + formula(d.pattern2) + '</div>' : '') +
          (d.breakdown2 && d.breakdown2.length ? '<div class="sp-breakdown">' + breakdown(d.breakdown2) + '</div>' : '') +
        '</div>' +
      '</div>' +
      (d.note ? '<div class="sp-note sp-note-top">' + esc(d.note) + '</div>' : '') + trans(d);
  }

  /* ⑤ 检验：把动词换成 be 再念一遍，看通不通 */
  function renderCheck(d) {
    var checks = d.checks || [], chk = '';
    for (var i = 0; i < checks.length; i++) {
      var ck = checks[i] || {};
      chk += '<div class="sp-check">' +
        '<div class="sp-chk-top"><span class="sp-chk-before">' + esc(ck.before) + '</span>' +
          '<span class="sp-chk-arrow">换成 be</span>' +
          '<span class="sp-chk-after">' + esc(ck.after) + '</span>' +
          '<span class="sp-chk-mark' + (ck.ok ? '' : ' no') + '">' + (ck.ok ? '&#10003; 说得通' : '&#10007; 说不通') + '</span>' +
        '</div>' +
        '<div class="sp-chk-verdict"><span class="sp-formula">' + formula(ck.pattern) + '</span>' +
          '<span class="sp-chk-name">' + esc(ck.name) + '</span>' +
          (ck.why ? '<span class="sp-chk-why">' + esc(ck.why) + '</span>' : '') +
        '</div></div>';
    }
    return '<div class="sp-name sp-name-sm">' + esc(d.labelZh) + '</div>' + nameEn(d) +
      (d.rule ? '<div class="sp-rule">' + esc(d.rule) + '</div>' : '') +
      (chk ? '<div class="sp-checks">' + chk + '</div>' : '') +
      noteZh(d);
  }

  function renderBody(d) {
    var t = d.type;
    if (t === 'overview') return renderOverview(d);
    if (t === 'component') return renderComponent(d);
    if (t === 'contrast') return renderContrast(d);
    if (t === 'check') return renderCheck(d);
    return renderPattern(d);
  }

  function renderCard(card) {
    var d = card.data || {};
    var m = typeMeta(card);
    return '<div class="sp-root ' + m.cls + '" data-card-id="' + card.id + '">' +
      '<div class="sp-bar">' +
        '<span class="sp-bar-left">' +
          '<span class="sp-badge">' + esc(m.t) + '</span>' +
          '<span class="sp-label">' + esc(d.labelZh || '') + '</span>' +
        '</span>' +
        actsHtml(card) +
      '</div>' +
      '<div class="sp-body">' + renderBody(d) + '</div>' +
    '</div>';
  }

  /* ==========================================================================
     渲染
     ========================================================================== */
  function renderList() {
    var box = $id('study-list');
    if (!box) return;
    var content = $('.study-content');
    if (content) content.classList.toggle('wide', state.singleCardMode);
    if (state.singleCardMode) { renderSingleCardStage(); return; }

    var cards = state.all;
    if (!cards.length) {
      box.innerHTML = '<div class="empty-state">还没有卡片。</div>';
      return;
    }
    var html = '';
    cards.forEach(function (c, i) {
      html += '<div class="enter" style="animation-delay:' + Math.min(i * 14, 260) + 'ms">' +
        renderCard(c) + '</div>';
    });
    box.innerHTML = html;
  }

  /* 只重画一张卡（标记/收藏后）：别整列表重渲染，否则整屏动画重放、滚动也会抖 */
  function patchCard(card) {
    var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
  }

  /* ===== 单卡模式（作用域 = 整个卡组，29 张） ===== */
  function toggleSingleCardMode() {
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
    var cards = state.all;
    if (!cards.length) {
      box.innerHTML = '<div class="empty-state">还没有卡片。</div>';
      return;
    }
    var prevSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
    var nextSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    box.innerHTML =
      '<div class="single-card-stage">' +
        '<div class="sc-main"><div class="sc-card-wrap" id="sc-card-wrap"></div></div>' +
        '<div class="sc-nav-col">' +
          '<button class="sc-nav sc-prev" data-sc="prev" data-tooltip="上一张" aria-label="prev">' + prevSvg + '</button>' +
          '<div class="sc-progress"><span id="sc-idx">1</span> / ' + cards.length + '</div>' +
          '<div class="sc-group" id="sc-group"></div>' +
          '<button class="sc-nav sc-next" data-sc="next" data-tooltip="下一张" aria-label="next">' + nextSvg + '</button>' +
        '</div>' +
      '</div>';
    renderSingleCardContent(state.singleCardIndex, false);
  }
  /* 右侧那一行小字：「句型 · 3 / 15」 */
  function groupText(card, idx) {
    var t = cardType(card);
    var pos = 0, total = 0;
    state.all.forEach(function (c, i) {
      if (cardType(c) !== t) return;
      total++;
      if (i <= idx) pos++;
    });
    return typeMeta(card).t + ' · ' + pos + ' / ' + total;
  }
  function renderSingleCardContent(idx, animate) {
    var cards = state.all;
    if (!cards.length) return;
    if (idx < 0) idx = cards.length - 1;
    if (idx >= cards.length) idx = 0;
    state.singleCardIndex = idx;
    var wrap = $id('sc-card-wrap');
    if (!wrap) return;
    wrap.innerHTML = renderCard(cards[idx]);
    var idxEl = $id('sc-idx');
    if (idxEl) idxEl.textContent = idx + 1;
    var gEl = $id('sc-group');
    if (gEl) gEl.textContent = groupText(cards[idx], idx);
    if (animate) {
      var target = wrap.firstElementChild || wrap;
      target.classList.remove('sc-anim');
      void target.offsetWidth;
      target.classList.add('sc-anim');
    }
  }
  function singleCardNav(delta) {
    var cards = state.all;
    if (!cards.length) return;
    renderSingleCardContent(state.singleCardIndex + delta, true);
  }

  /* ==========================================================================
     卡片交互
     ========================================================================== */
  function handlePlay(card) {
    var d = card.data || {};
    var text = d.labelZh || '';
    cardAPI.track('audio_play', card.id);
    if (!text) { showToast('这张卡没有可朗读的内容', true); return; }
    voiceMgr.speak(text, VOICE_TAG);
  }
  function handleMark(card) {
    var want = card.is_unknown === 1 ? 0 : 1;
    cardAPI.mark(card.id, want).then(function (d) {
      card.is_unknown = (d && typeof d.is_unknown !== 'undefined') ? d.is_unknown : want;
      cardAPI.track('word_mark', card.id);
      if (state.singleCardMode) renderSingleCardContent(state.singleCardIndex, false);
      else patchCard(card);
      updateStatsText();
    });
  }
  function handleFavorite(card) {
    var want = card.is_favorite === 1 ? 0 : 1;
    cardAPI.favorite(card.id, want).then(function (d) {
      card.is_favorite = (d && typeof d.is_favorite !== 'undefined') ? d.is_favorite : want;
      cardAPI.track('favorite_toggle', card.id);
      if (state.singleCardMode) renderSingleCardContent(state.singleCardIndex, false);
      else patchCard(card);
    });
  }

  /* ===== 事件委托（一处绑完，重渲染不用重绑） ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 动作按钮 */
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl = actionBtn.closest('[data-card-id]');
        var card = cardEl ? findCard(cardEl.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          if (action === 'play') handlePlay(card);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }

      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

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
        voiceMgr.saveVoice(VOICE_TAG, picked);
        renderVoiceDropdown();
        $('.voice-dropdown').style.display = 'none';
        voiceMgr.speak(voiceMgr.sampleText(), VOICE_TAG);
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

      /* 刷新：重新拉一次（标记状态可能被别处改过） */
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

    /* 键盘：单卡模式下 ←/→/空格 翻下一张，Esc 退出 */
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

    renderList();

    loadAll().then(function () {
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
