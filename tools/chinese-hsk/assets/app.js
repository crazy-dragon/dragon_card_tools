/* ==========================================================================
   HSK 分级词表 · 小工具（HSK 3.0，11105 词：1–6 级 + 7–9 级）
   --------------------------------------------------------------------------
   chart 分级词表  等级 chips + 搜索框 + 词格网格（100/页 + 翻页），
                   点格子 = 读词（zh）+ 跳到那张词卡。
   card  词卡      汉字大字（点读 zh）/ 拼音 / 繁体 / 词性 / 英文释义（点读 en）
                   / Source 署名。

   ⚠️ 大卡组纪律：数据一次拉全（2000/块），但 DOM 任何时刻只渲染一页。
   搜索：word / 拼音（NFD 去声调）/ 繁体，大小写无关。
   宿主 getPage 按 current_order（队列序）返回 → 按 item_order 排回原始序。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || 'HSK 分级词表';
  var VOICE_ZH = 'zh-CN';
  var VOICE_EN = 'en-US';
  var CHUNK = 2000;          /* 拉数据的块大小 */
  var PAGE_CHART = 100;      /* 词表每页格数 */
  var PAGE_CARD = 50;        /* 词卡每页张数 */
  var LS = 'dc-hk-';

  var SKINS = [
    { id: 'cream', name: '素绢', icon: 'fa-sun' },
    { id: 'glass', name: '墨夜', icon: 'fa-moon' },
    { id: 'category', name: '等级彩', icon: 'fa-layer-group' }
  ];

  /* 等级（HSK 3.0：1–6 各一级，7/8/9 合并一档） */
  var LEVELS = ['1', '2', '3', '4', '5', '6', '7-9'];
  var LEVEL_NAME = { '1': 'HSK 1', '2': 'HSK 2', '3': 'HSK 3', '4': 'HSK 4', '5': 'HSK 5', '6': 'HSK 6', '7-9': 'HSK 7–9' };
  function levelOf(d) {
    var lv = String((d || {}).level == null ? '' : d.level).trim();
    if (lv === '7' || lv === '8' || lv === '9') return '7-9';
    return LEVELS.indexOf(lv) >= 0 ? lv : '';
  }
  function lvClass(d) {
    var lv = levelOf(d);
    return lv ? 'lv-' + lv.replace('-', '') : '';
  }

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    loaded: false,
    view: 'chart',
    singleCardMode: false,
    singleCardIndex: 0,
    level: '',
    q: '',
    chartPage: 1,
    cardPage: 1,
    skin: 'cream',
    fontSize: 1,
    _voiceWarned: false,
    _refreshLock: false,
    _searchTimer: null
  };
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
  /* 搜索归一化：小写 + NFD 去声调（"ài" → "ai"） */
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
    sampleText: function () { return '你好'; },
    speak: function (text, lang) {
      if (!('speechSynthesis' in window)) { showToast('这个浏览器不支持朗读', true); return; }
      var u = new SpeechSynthesisUtterance(text || '');
      var voice = this.pickVoice(lang || VOICE_ZH);
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
    if (voiceMgr.pickVoice(VOICE_ZH)) return;
    state._voiceWarned = true;
    showToast('系统里没有中文语音包，读音可能不准', false);
  }
  function renderVoiceDropdown() {
    var list = $('.voice-list');
    if (!list) return;
    list.innerHTML = '';
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === 'zh'; });
    var pick = voiceMgr.pickVoice(VOICE_ZH);
    var activeUri = pick ? pick.voiceURI : null;
    if (!voices.length) {
      var empty = document.createElement('div');
      empty.className = 'voice-option muted';
      empty.textContent = '系统里没有中文语音包，点一下用默认的试听。';
      empty.addEventListener('click', function () {
        voiceMgr.saveVoice(VOICE_ZH, null);
        voiceMgr.speak(voiceMgr.sampleText(), VOICE_ZH);
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

  /* ===== 数据（分块拉全） ===== */
  function loadAll() {
    if (!window.cardAPI || !cardAPI.getPage) {
      state.loaded = true;
      return Promise.resolve();
    }
    state.all = [];
    var page = 1;
    function step() {
      return cardAPI.getPage(page, CHUNK).then(function (d) {
        var cards = d.cards || [];
        state.all = state.all.concat(cards);
        updateStatsText();
        if (d.has_next && page < 40) { page += 1; return step(); }
      });
    }
    return step().then(function () {
      /* 宿主按 current_order（队列序）返回 → 按原始 item_order 排回 */
      state.all.sort(function (a, b) { return (a.item_order || 0) - (b.item_order || 0); });
      state.loaded = true;
    });
  }
  function findCard(id) {
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) return state.all[i];
    return null;
  }
  function updateStatsText() {
    var marked = 0;
    for (var i = 0; i < state.all.length; i++) if (state.all[i].is_unknown === 1) marked++;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + state.all.length;
  }

  /* ===== 筛选 / 搜索 ===== */
  function filtered() {
    var q = norm(state.q);
    var out = [];
    for (var i = 0; i < state.all.length; i++) {
      var c = state.all[i];
      var d = c.data || {};
      if (state.level && levelOf(d) !== state.level) continue;
      if (q) {
        var hay = norm(d.word) + '\n' + norm(d.pinyin) + '\n' + norm(d.traditional);
        if (hay.indexOf(q) < 0) continue;
      }
      out.push(c);
    }
    return out;
  }
  function pageSize() { return state.view === 'chart' ? PAGE_CHART : PAGE_CARD; }
  function pageOf(list) {
    var size = pageSize();
    var pages = Math.max(1, Math.ceil(list.length / size));
    var p = (state.view === 'chart') ? state.chartPage : state.cardPage;
    if (p > pages) p = pages;
    if (p < 1) p = 1;
    return { page: p, pages: pages, size: size };
  }
  function pagerHtml(info, list) {
    if (list.length === 0) return '';
    return '<div class="hk-pager">' +
      '<button type="button" data-page="prev"' + (info.page <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>' +
      '<span class="hk-pg">' + info.page + ' / ' + info.pages + ' 页 · ' + list.length + ' 词</span>' +
      '<button type="button" data-page="next"' + (info.page >= info.pages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>' +
      '</div>';
  }

  /* ===== 卡面 ===== */
  function railButtons(card) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="dc-acts">' +
      '<button type="button" data-action="play" data-tooltip="读词语"><i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }

  function renderCard(card) {
    var d = card.data || {};
    var lv = levelOf(d);
    return '<div class="hk-root ' + lvClass(d) + '" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<div class="hk-top">' +
        (lv ? '<span class="hk-lv">' + esc(LEVEL_NAME[lv] || lv) + '</span>' : '') +
        (d.part_of_speech ? '<span class="hk-pos">' + esc(d.part_of_speech) + '</span>' : '') +
      '</div>' +
      '<div class="hk-mid">' +
        '<div class="hk-word" data-say="' + esc(d.word) + '" data-say-lang="zh" data-tooltip="读词语">' + esc(d.word) + '</div>' +
        '<div class="hk-side">' +
          (d.pinyin ? '<div class="hk-py">' + esc(d.pinyin) + '</div>' : '') +
          (d.traditional && d.traditional !== d.word
            ? '<div class="hk-trad">繁 <span>' + esc(d.traditional) + '</span></div>' : '') +
        '</div>' +
      '</div>' +
      (d.definition
        ? '<div class="hk-def" data-say="' + esc(d.definition) + '" data-say-lang="en" data-tooltip="读英文释义">' +
          '<span class="hk-def-tag">EN</span>' + esc(d.definition) + '</div>' : '') +
      (d.definition_source ? '<div class="hk-src">Source: ' + esc(d.definition_source) + '</div>' : '') +
    '</div>';
  }

  /* ===== 分级词表 ===== */
  function chartCell(card) {
    var d = card.data || {};
    var lv = levelOf(d);
    return '<div class="c-cell ' + lvClass(d) + '" data-card-id="' + card.id + '" data-act="jump"' +
      ' data-tooltip="' + esc(d.word) + (d.pinyin ? ' · ' + esc(d.pinyin) : '') + ' · 点一下看词卡"' +
      (lv ? ' data-lv="' + lv + '"' : '') + '>' +
      (card.is_unknown === 1 ? '<span class="c-star"><i class="fa-solid fa-star"></i></span>' : '') +
      (card.is_favorite === 1 ? '<span class="c-fav"><i class="fa-solid fa-bookmark"></i></span>' : '') +
      '<span class="c-word">' + esc(d.word) + '</span>' +
      '<span class="c-py">' + esc(d.pinyin) + '</span>' +
      '</div>';
  }
  function toolbarHtml(list) {
    var chips = '<button type="button" class="hk-lvchip' + (state.level === '' ? ' on' : '') + '" data-level="">全部</button>';
    LEVELS.forEach(function (lv) {
      chips += '<button type="button" class="hk-lvchip lv-' + lv.replace('-', '') +
        (state.level === lv ? ' on' : '') + '" data-level="' + lv + '">' + esc(LEVEL_NAME[lv]) + '</button>';
    });
    return '<div class="hk-toolbar">' +
      '<div class="hk-chips">' + chips + '</div>' +
      '<div class="hk-search">' +
        '<i class="fa-solid fa-magnifying-glass"></i>' +
        '<input id="hk-search-input" type="text" placeholder="搜词语 / 拼音（不用声调）/ 繁体…" value="' + esc(state.q) + '">' +
        (state.q ? '<button type="button" id="hk-search-clear" data-tooltip="清空"><i class="fa-solid fa-xmark"></i></button>' : '') +
      '</div>' +
      '<div class="hk-count">' + list.length + ' 词</div>' +
    '</div>';
  }
  function renderChart() {
    var box = $id('study-list');
    var list = filtered();
    if (!state.loaded) { box.innerHTML = '<div class="empty-state">正在加载词库…</div>'; return; }
    if (!list.length) {
      box.innerHTML = toolbarHtml(list) + '<div class="empty-state">没有匹配的词。</div>';
      return;
    }
    var info = pageOf(list);
    var start = (info.page - 1) * info.size;
    var slice = list.slice(start, start + info.size);
    box.innerHTML = toolbarHtml(list) +
      '<div class="hk-chart">' + slice.map(chartCell).join('') + '</div>' +
      pagerHtml(info, list);
    focusSearch();
  }

  /* ===== 词卡视图 ===== */
  function renderCards() {
    var box = $id('study-list');
    var list = filtered();
    if (!state.loaded) { box.innerHTML = '<div class="empty-state">正在加载词库…</div>'; return; }
    if (!list.length) { box.innerHTML = '<div class="empty-state">没有匹配的词。</div>'; return; }
    var info = pageOf(list);
    var start = (info.page - 1) * info.size;
    var slice = list.slice(start, start + info.size);
    box.innerHTML = '<div class="hk-cards">' + slice.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 8, 200) + 'ms">' + renderCard(c) + '</div>';
    }).join('') + '</div>' + pagerHtml(info, list);
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
    renderCards();
  }
  function patchCard(card) {
    if (state.view === 'chart' && !state.singleCardMode) { patchCell(card); return; }
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
  function focusSearch() {
    var input = $id('hk-search-input');
    if (!input) return;
    input.addEventListener('input', function () {
      clearTimeout(state._searchTimer);
      state._searchTimer = setTimeout(function () {
        var v = input.value.trim();
        if (v === state.q) return;
        state.q = v;
        state.chartPage = 1;
        renderChart();
      }, 250);
    });
    /* 不抢焦点：只有用户点过搜索框才保持，避免翻页时跳动 */
  }

  /* ===== 单卡模式 ===== */
  function toggleSingleCardMode() {
    if (state.view === 'chart') return;
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
    var list = filtered();
    if (!state.loaded) { box.innerHTML = '<div class="empty-state">正在加载词库…</div>'; return; }
    if (!list.length) { box.innerHTML = '<div class="empty-state">没有匹配的词。</div>'; return; }
    var prevSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
    var nextSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    box.innerHTML =
      '<div class="single-card-stage">' +
        '<div class="sc-main"><div class="sc-card-wrap" id="sc-card-wrap"></div></div>' +
        '<div class="sc-nav-col">' +
          '<button class="sc-nav sc-prev" data-sc="prev" data-tooltip="上一张" aria-label="上一张">' + prevSvg + '</button>' +
          '<div class="sc-progress"><span id="sc-idx">1</span> / ' + list.length + '</div>' +
          '<button class="sc-nav sc-next" data-sc="next" data-tooltip="下一张" aria-label="下一张">' + nextSvg + '</button>' +
        '</div>' +
      '</div>';
    renderSingleCardContent(state.singleCardIndex, false, list);
  }
  function renderSingleCardContent(idx, animate, listRef) {
    var list = listRef || filtered();
    if (!list.length) return;
    if (idx < 0) idx = list.length - 1;
    if (idx >= list.length) idx = 0;
    state.singleCardIndex = idx;
    var wrap = $id('sc-card-wrap');
    if (!wrap) return;
    wrap.innerHTML = renderCard(list[idx]);
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
  function playWord(card) {
    var d = card.data || {};
    cardAPI.track('audio_play', card.id);
    if (!d.word) { showToast('这张卡没有可朗读的内容', true); return; }
    warnIfNoVoice();
    voiceMgr.speak(d.word, VOICE_ZH);
  }
  function playText(card, text, lang) {
    if (!text) return;
    cardAPI.track('word_play', card.id);
    warnIfNoVoice();
    voiceMgr.speak(text, lang === 'en' ? VOICE_EN : VOICE_ZH);
  }
  function handleMark(card) {
    var want = card.is_unknown === 1 ? 0 : 1;
    cardAPI.mark(card.id, want).then(function (d) {
      card.is_unknown = (d && typeof d.is_unknown !== 'undefined') ? d.is_unknown : want;
      cardAPI.track('word_mark', card.id);
      if (state.view === 'chart' && !state.singleCardMode) patchCell(card);
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
      if (state.view === 'chart' && !state.singleCardMode) patchCell(card);
      else if (state.singleCardMode) renderSingleCardContent(state.singleCardIndex, false);
      else patchCard(card);
    });
  }

  /* 从词表跳到词卡：保证目标在当前筛选里，定位到页再滚动 */
  function jumpToCard(id) {
    var card = findCard(id);
    if (!card) return;
    playWord(card);
    var list = filtered();
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) { idx = i; break; }
    if (idx < 0) {
      /* 目标被当前筛选挡住了 → 清掉筛选再试 */
      state.q = '';
      state.level = '';
      list = filtered();
      for (var j = 0; j < list.length; j++) if (String(list[j].id) === String(id)) { idx = j; break; }
      if (idx < 0) return;
    }
    if (state.view !== 'card' || state.singleCardMode) setView('card');
    state.cardPage = Math.floor(idx / PAGE_CARD) + 1;
    renderList();
    requestAnimationFrame(function () {
      var el = document.querySelector('#study-list [data-card-id="' + id + '"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('hk-flash');
      void el.offsetWidth;
      el.classList.add('hk-flash');
      setTimeout(function () { el.classList.remove('hk-flash'); }, 1400);
    });
  }

  /* ===== 视图切换 ===== */
  function renderViewSeg() {
    var box = $id('view-seg');
    if (!box) return;
    box.innerHTML = '<button type="button" data-view="chart"' + (state.view === 'chart' ? ' class="on"' : '') + '>分级词表</button>' +
      '<button type="button" data-view="card"' + (state.view === 'card' ? ' class="on"' : '') + '>词卡</button>';
  }
  function setView(id) {
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

      /* 点读（词语 / 英文释义） */
      var sayEl = target.closest('[data-say]');
      if (sayEl) {
        e.stopPropagation();
        var sCardEl = sayEl.closest('[data-card-id]');
        var sCard = sCardEl ? findCard(sCardEl.dataset.cardId) : null;
        if (sCard) playText(sCard, sayEl.dataset.say, sayEl.dataset.sayLang);
        return;
      }
      /* 词表格子 */
      var cell = target.closest('.c-cell[data-act="jump"]');
      if (cell) { e.stopPropagation(); jumpToCard(cell.dataset.cardId); return; }
      /* 等级 chips */
      var lvChip = target.closest('.hk-lvchip');
      if (lvChip) {
        state.level = lvChip.dataset.level || '';
        state.chartPage = 1;
        state.cardPage = 1;
        renderList();
        return;
      }
      /* 清空搜索 */
      if (target.closest('#hk-search-clear')) {
        state.q = '';
        state.chartPage = 1;
        renderList();
        return;
      }
      /* 翻页 */
      var pg = target.closest('[data-page]');
      if (pg && !pg.disabled) {
        var info = pageOf(filtered());
        var delta = pg.dataset.page === 'next' ? 1 : -1;
        var np = Math.min(Math.max(1, info.page + delta), info.pages);
        if (state.view === 'chart') state.chartPage = np; else state.cardPage = np;
        renderList();
        var s = $id('study-scroll');
        if (s) s.scrollTo({ top: 0, behavior: 'smooth' });
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
          if (action === 'play') playWord(card);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }
      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

      var viewBtn = target.closest('#view-seg button');
      if (viewBtn) { setView(viewBtn.dataset.view); return; }

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
        voiceMgr.saveVoice(VOICE_ZH, picked);
        renderVoiceDropdown();
        $('.voice-dropdown').style.display = 'none';
        voiceMgr.speak(voiceMgr.sampleText(), VOICE_ZH);
        return;
      }

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

      if (target.closest('#refresh-stats')) {
        if (!state._refreshLock) {
          state._refreshLock = true;
          state.loaded = false;
          loadAll().then(function () { renderViewSeg(); renderList(); updateStatsText(); });
          showToast('已刷新');
          setTimeout(function () { state._refreshLock = false; }, 1000);
        }
        return;
      }

      if (target.closest('#card-view-btn')) { toggleSingleCardMode(); return; }
      if (target.closest('#scroll-top-btn')) { $id('study-scroll').scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (target.closest('#scroll-bottom-btn')) {
        var sc = $id('study-scroll');
        sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
        return;
      }

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

    /* 搜索框在重渲染后由 focusSearch() 重新挂 input 监听；这里只兜底 Enter */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'hk-search-input') {
        e.target.blur();
        return;
      }
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

    renderViewSeg();
    renderList();

    loadAll().then(function () {
      var cv = $id('card-view-btn');
      if (cv) cv.style.display = (state.view === 'chart') ? 'none' : '';
      try {
        var sv = localStorage.getItem(LS + 'view');
        if (sv && ['chart', 'card'].indexOf(sv) >= 0) state.view = sv;
      } catch (e) {}
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
