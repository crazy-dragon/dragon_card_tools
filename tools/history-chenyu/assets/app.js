/* ==========================================================================
   中国古代谶语录 · 小工具（24 条：凡例 1 + 秦 2 + 汉 5 + 晋 1 + 隋 2 + 唐 3 +
   五代 1 + 宋 2 + 元 2 + 明 3 + 清 2）
   --------------------------------------------------------------------------
   两种视图（顶栏分段切换）：
     chart 朝代时间轴   一代一段，段内网格排谶语原文 + 出处；
                        点格子 = 读谶语 + 跳到那张卡。想找「亡秦者胡也」
                        在哪一代时，这就是一张真速查表。
     card  卡片        朝代胶囊 / 谶语原文（大字，可点读）/ 出处 /
                       白话疏解（可点读）。

   ★ 分组与顺序**不硬编码年表**：按数据里 dynasty 的首次出现顺序分band。
     用户往卡组里加一条「战国」，工具自动多出一段，不会漏、不会排错位。
     朝代英文（DYN_EN）与配色（hc-N）是**工具层装饰**，缺了就退回默认色、
     不显示英文 —— 数据本身才是唯一事实。

   ★ 卷首「凡例」那条（dynasty === '凡例'）是取材说明、不是谶语：
     两种视图里都置顶并换一套样式，不计入统计的「谚语条数」。

   朗读通道（浏览器 TTS，zh-CN）：
     🔊        -> 读谶语原文（audio_play）
     点原文/疏解 -> 读那一段（word_play）

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '中国古代谶语录';
  var VOICE_LANG = TOOL.voiceLang || 'zh-CN';
  var VIEWS = (TOOL.views && TOOL.views.length) ? TOOL.views : [
    { id: 'chart', label: '朝代时间轴' },
    { id: 'card',  label: '卡片' }
  ];
  var PAGE_SIZE = 500;
  var LS = 'dc-hc-';
  var PREFACE_KEY = '凡例';   /* 卷首说明：数据里 dynasty 等于这个值的那条 */

  var SKINS = [
    { id: 'cream', name: '素绢', icon: 'fa-sun' },
    { id: 'glass', name: '墨夜', icon: 'fa-moon' },
    { id: 'category', name: '朝代彩', icon: 'fa-landmark' }
  ];

  /* 朝代英文：纯装饰，查不到就不显示（绝不因为缺英文而漏一段） */
  var DYN_EN = {
    '凡例': 'Introductory note',
    '商': 'Shang', '西周': 'Western Zhou', '东周': 'Eastern Zhou',
    '春秋': 'Spring & Autumn', '战国': 'Warring States',
    '秦': 'Qin', '汉': 'Han', '三国': 'Three Kingdoms', '晋': 'Jin',
    '南北朝': 'Northern & Southern', '隋': 'Sui', '唐': 'Tang',
    '五代': 'Five Dynasties', '宋': 'Song', '元': 'Yuan',
    '明': 'Ming', '清': 'Qing', '民国': 'Republic'
  };

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    preface: null,
    view: 'chart',
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    _voiceWarned: false,
    _refreshLock: false
  };
  try {
    var sv = localStorage.getItem(LS + 'view');
    if (sv && VIEWS.some(function (v) { return v.id === sv; })) state.view = sv;
  } catch (e) {}
  try { var ss = localStorage.getItem(LS + 'skin'); if (ss) state.skin = ss; } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem(LS + 'font')) || 1; } catch (e) {}

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ===== toast / tooltip ===== */
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

  /* ===== 音色 ===== */
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
    sampleText: function () { return '亡秦者胡也'; },
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

  /* ===== 皮肤 / 字号 ===== */
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

  /* ===== 数据 ===== */
  function loadAll() {
    if (!window.cardAPI || !cardAPI.getPage) return Promise.resolve();
    return cardAPI.getPage(1, PAGE_SIZE).then(function (d) {
      var cards = (d.cards || []).slice();
      state.preface = null;
      state.all = [];
      cards.forEach(function (c) {
        /* 「凡例」= 卷首取材说明，不是谶语，单独放 */
        if ((c.data || {}).dynasty === PREFACE_KEY && !state.preface) { state.preface = c; return; }
        state.all.push(c);
      });
    });
  }
  function findCard(id) {
    if (state.preface && String(state.preface.id) === String(id)) return state.preface;
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) return state.all[i];
    return null;
  }
  /* 分组：按 dynasty 首次出现顺序（凡例不参与） */
  function dynGroups() {
    var order = [], map = {};
    state.all.forEach(function (c) {
      var k = (c.data || {}).dynasty || '其他';
      if (!map[k]) { map[k] = []; order.push(k); }
      map[k].push(c);
    });
    return order.map(function (k, i) { return { key: k, cards: map[k], idx: i }; });
  }
  function dynClass(idx) { return 'hc-' + (idx % 8); }
  function dynIndexOf(dynasty) {
    var g = dynGroups();
    for (var i = 0; i < g.length; i++) if (g[i].key === dynasty) return i;
    return -1;
  }
  function updateStatsText() {
    var marked = state.all.filter(function (c) { return c.is_unknown === 1; }).length;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + state.all.length;
  }

  /* ===== 卡面 ===== */
  function railButtons(card) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="dc-acts">' +
      '<button type="button" data-action="play" data-tooltip="读谶语"><i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }

  /* 卷首凡例：说明这张卡组是考据素材、不是宣扬迷信 */
  function prefaceCard() {
    var c = state.preface;
    if (!c) return '';
    var d = c.data || {};
    return '<div class="hc-root hc-preface" data-card-id="' + c.id + '">' +
      railButtons(c) +
      '<div class="hc-pre-head"><i class="fa-solid fa-scroll"></i><span>凡例 · 请先读这一段</span></div>' +
      '<div class="hc-pre-text">' + esc(d.text) + '</div>' +
      (d.source ? '<div class="hc-src">' + esc(d.source) + '</div>' : '') +
      (d.gloss ? '<div class="hc-gloss" data-word="' + esc(d.gloss) + '" data-tooltip="读说明">' + esc(d.gloss) + '</div>' : '') +
    '</div>';
  }

  function renderCard(card) {
    if (state.preface && String(card.id) === String(state.preface.id)) return prefaceCard();
    var d = card.data || {};
    var idx = dynIndexOf(d.dynasty);
    var cls = idx >= 0 ? dynClass(idx) : 'hc-0';
    var en = DYN_EN[d.dynasty] || '';
    return '<div class="hc-root ' + cls + '" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<div class="hc-top">' +
        '<span class="hc-dyn">' + esc(d.dynasty) + (en ? '<i>' + esc(en) + '</i>' : '') + '</span>' +
      '</div>' +
      '<div class="hc-text" data-word="' + esc(d.text) + '" data-tooltip="读谶语">' + esc(d.text) + '</div>' +
      (d.source ? '<div class="hc-src"><i class="fa-solid fa-book"></i>' + esc(d.source) + '</div>' : '') +
      (d.gloss ? '<div class="hc-gloss" data-word="' + esc(d.gloss) + '" data-tooltip="读疏解"><span class="hc-gloss-tag">疏</span>' + esc(d.gloss) + '</div>' : '') +
    '</div>';
  }

  /* ===== 朝代时间轴 ===== */
  function chartCell(card, idx) {
    var d = card.data || {};
    return '<div class="c-cell ' + dynClass(idx) + '" data-card-id="' + card.id + '" data-act="jump"' +
      ' data-tooltip="' + esc(d.dynasty) + ' · 点一下看卡片">' +
      (card.is_unknown === 1 ? '<span class="c-star"><i class="fa-solid fa-star"></i></span>' : '') +
      (card.is_favorite === 1 ? '<span class="c-fav"><i class="fa-solid fa-bookmark"></i></span>' : '') +
      '<span class="c-text">' + esc(d.text) + '</span>' +
      '<span class="c-src">' + esc(d.source || '') + '</span>' +
      '</div>';
  }

  function renderChart() {
    var box = $id('study-list');
    var groups = dynGroups();
    if (!groups.length && !state.preface) {
      box.innerHTML = '<div class="empty-state">还没有卡片。</div>';
      return;
    }
    var html = state.preface ? prefaceCard() : '';
    groups.forEach(function (g) {
      var en = DYN_EN[g.key] || '';
      html += '<div class="hc-band ' + dynClass(g.idx) + '">' +
        '<div class="hc-band-head"><span class="hc-band-zh">' + esc(g.key) + '</span>' +
        (en ? '<span class="hc-band-en">' + esc(en) + '</span>' : '') +
        '<span class="hc-band-n">' + g.cards.length + '</span></div>' +
        '<div class="hc-grid">' + g.cards.map(function (c) { return chartCell(c, g.idx); }).join('') + '</div>' +
      '</div>';
    });
    box.innerHTML = html;
  }

  /* ===== 渲染 ===== */
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
    if (!state.all.length && !state.preface) {
      box.innerHTML = '<div class="empty-state">还没有卡片。</div>';
      return;
    }
    var head = state.preface ? prefaceCard() : '';
    box.innerHTML = head + state.all.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 40, 400) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }
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
    if (!el) return;
    var idx = dynIndexOf((card.data || {}).dynasty);
    el.outerHTML = chartCell(card, idx >= 0 ? idx : 0);
  }

  /* ===== 单卡模式 ===== */
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
    var cards = state.all;
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

  /* ===== 交互 ===== */
  function playCard(card) {
    var d = card.data || {};
    cardAPI.track('audio_play', card.id);
    if (!d.text) { showToast('这张卡没有可朗读的内容', true); return; }
    warnIfNoVoice();
    voiceMgr.speak(d.text, VOICE_LANG);
  }
  function playWord(card, word) {
    if (!word) return;
    cardAPI.track('word_play', card.id);
    warnIfNoVoice();
    voiceMgr.speak(word, VOICE_LANG);
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

  /* 从时间轴跳到卡片 */
  function jumpToCard(id) {
    var card = findCard(id);
    if (!card) return;
    playCard(card);
    if (state.view === 'card' && !state.singleCardMode) { scrollToCard(card); return; }
    setView('card');
    scrollToCard(card);
  }
  function scrollToCard(card) {
    requestAnimationFrame(function () {
      var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('hc-flash');
      void el.offsetWidth;
      el.classList.add('hc-flash');
      setTimeout(function () { el.classList.remove('hc-flash'); }, 1400);
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

  /* ===== 事件委托 ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 原文 / 疏解 = 读那一段 */
      var wordEl = target.closest('[data-word]');
      if (wordEl) {
        e.stopPropagation();
        var wCardEl = wordEl.closest('[data-card-id]');
        var wCard = wCardEl ? findCard(wCardEl.dataset.cardId) : null;
        if (wCard) playWord(wCard, wordEl.dataset.word);
        return;
      }
      /* 时间轴格子 = 读谶语 + 跳卡 */
      var cell = target.closest('.c-cell[data-act="jump"]');
      if (cell) {
        e.stopPropagation();
        jumpToCard(cell.dataset.cardId);
        return;
      }
      /* 卡片动作 */
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl = actionBtn.closest('[data-card-id]');
        var card = cardEl ? findCard(cardEl.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          if (action === 'play') playCard(card);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }
      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

      var viewBtn = target.closest('#view-seg button');
      if (viewBtn) { setView(viewBtn.dataset.view); return; }

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
