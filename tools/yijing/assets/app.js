/* ==========================================================================
   周易 · 小工具（一 zip 双卡组）
   --------------------------------------------------------------------------
   deck 2 周易64卦（mode='gua'）：
     chart 卦序方图   上卦（行）× 下卦（列）的 8×8 真方图，行/列表头画三爻小卦，
                      点格子 = 读卦名 + 跳到那张卡。
     card  卦卡       六爻卦画 + Unicode 卦符 ䷀–䷿ + 卦名/拼音 + 上/下经 +
                      卦象结构 + 卦辞（点读）+ 白话释义。

   deck 3 周易入门（mode='intro'）：19 张概念卡，单视图；
     diagram 里的 "111"/"000" 三画码由工具画成小卦图（数据里存的不是图形）。

   ★ 卦画方向（2026-09-26 数据审计的结论，64/64 验证）：
       数据 lines 是**自上而下**编码 —— lines[0] = 顶爻，前 3 位 = 上卦，
       三画码自洽表：乾111 兑011 离101 震001 巽110 坎010 艮100 坤000（每位内部也是上爻在前）。
     ⇒ 渲染时按数组顺序**首字符画在最上**（.yj-lines 是普通 column flex，
       第一个子元素在顶）。任何"按常规自下而上"的画法都会把 64 卦全部颠倒。

   朗读通道（浏览器 TTS，zh-CN）：🔊 读卦名（audio_play）；点卦辞读整段（word_play）。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '周易';
  var VOICE_LANG = TOOL.voiceLang || 'zh-CN';
  var PAGE_SIZE = 500;
  var LS = 'dc-yj-';

  var SKINS = [
    { id: 'cream', name: '素绢', icon: 'fa-sun' },
    { id: 'glass', name: '墨夜', icon: 'fa-moon' },
    { id: 'category', name: '八宫彩', icon: 'fa-gem' }
  ];

  /* 八经卦：名 / 三画码（自上而下，与数据同口径）/ 色（八宫彩皮肤与方图行头用） */
  var TRIGRAMS = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
  var TRICODE = { '乾': '111', '兑': '011', '离': '101', '震': '001', '巽': '110', '坎': '010', '艮': '100', '坤': '000' };
  function triIdx(n) { return TRIGRAMS.indexOf(n); }

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    mode: 'gua',                  /* gua=64卦 / intro=入门，load 后按字段判定 */
    view: 'chart',
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    _voiceWarned: false,
    _refreshLock: false
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
    sampleText: function () { '乾坤'; return '乾坤'; },
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
      state.all = (d.cards || []).slice();
      var first = (state.all[0] || {}).data || {};
      state.mode = ('lines' in first) ? 'gua' : 'intro';
    });
  }
  function findCard(id) {
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) return state.all[i];
    return null;
  }
  function updateStatsText() {
    var marked = state.all.filter(function (c) { return c.is_unknown === 1; }).length;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + state.all.length;
  }

  /* ===== 卦画绘制（方向关键：lines[0]=顶爻，顺序追加即在顶） ===== */
  function hexLines(lines, cls) {
    var s = String(lines || '');
    var html = '';
    for (var i = 0; i < s.length; i++) {
      html += '<div class="' + (cls || 'hex-line') + ' ' + (s.charAt(i) === '0' ? 'yin' : 'yang') + '"></div>';
    }
    return html;
  }
  /* 卦符 ䷀–䷿ = U+4DC0 + 卦序 - 1 */
  function hexSymbol(number) {
    var n = Number(number);
    if (!n || n < 1 || n > 64) return '';
    return String.fromCodePoint(0x4DC0 + n - 1);
  }
  /* 三爻小卦（tricode 自上而下，同口径） */
  function miniTri(name) {
    var code = TRICODE[name];
    if (!code) return '';
    return '<span class="yj-mini" title="' + esc(name) + '">' + hexLines(code, 'hex-line hex-mini') + '</span>';
  }
  /* 上/下经：1–30 上经，31–64 下经 */
  function partOf(number) { return Number(number) <= 30 ? '上经' : '下经'; }

  /* ===== 卡面 ===== */
  function railButtons(card) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="dc-acts">' +
      '<button type="button" data-action="play" data-tooltip="读卦名"><i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }

  function renderGuaCard(card) {
    var d = card.data || {};
    var up = triIdx(d.upper), cls = 'tr-' + (up >= 0 ? up : 0);
    return '<div class="yj-root ' + cls + '" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<div class="yj-top">' +
        '<span class="yj-no">第 ' + esc(d.number) + ' 卦</span>' +
        '<span class="yj-chip">' + esc(partOf(d.number)) + '</span>' +
        (d.structure ? '<span class="yj-chip yj-struct-chip">' + esc(d.structure) + '</span>' : '') +
      '</div>' +
      '<div class="yj-mid">' +
        '<div class="yj-hex">' +
          '<div class="yj-lines">' + hexLines(d.lines) + '</div>' +
          (hexSymbol(d.number) ? '<div class="yj-symbol">' + hexSymbol(d.number) + '</div>' : '') +
        '</div>' +
        '<div class="yj-head">' +
          '<div class="yj-name">' + esc(d.name) +
            (d.pinyin ? '<span class="yj-py">' + esc(d.pinyin) + '</span>' : '') + '</div>' +
          '<div class="yj-tris">' +
            (d.upper ? '<span class="yj-tri">' + miniTri(d.upper) + esc(d.upper) + '（上）</span>' : '') +
            (d.lower ? '<span class="yj-tri">' + miniTri(d.lower) + esc(d.lower) + '（下）</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      (d.judgment ? '<div class="yj-judgment" data-say="' + esc(d.judgment) + '" data-tooltip="读卦辞">' +
        '<span class="yj-jl">卦辞</span>' + esc(d.judgment) + '</div>' : '') +
      (d.meaning ? '<div class="yj-meaning">' + esc(d.meaning) + '</div>' : '') +
    '</div>';
  }

  function renderIntroCard(card) {
    var d = card.data || {};
    /* diagram 存的是 "111"/"000" 三画码（8 个单卦），工具自己画；其余为空 */
    var dia = '';
    if (/^[01]{3}$/.test(String(d.diagram || ''))) {
      dia = '<div class="yj-diagram">' + hexLines(d.diagram) + '</div>';
    }
    /* diagram 与标题同一行（左卦图 / 右标题），卡根是 column flex，只能靠包一层 row */
    return '<div class="yj-root yj-intro ' + (TRICODE[d.title] ? 'tr-' + triIdx(d.title) : '') +
      '" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<div class="yj-intro-row">' +
        (dia ? '<div class="yj-intro-hex">' + dia + '</div>' : '') +
        '<div class="yj-intro-head">' +
          '<div class="yj-intro-title">' + esc(d.title) +
            (d.pinyin ? '<span class="yj-py">' + esc(d.pinyin) + '</span>' : '') + '</div>' +
        '</div>' +
      '</div>' +
      (d.body ? '<div class="yj-body">' + esc(d.body) + '</div>' : '') +
      (d.note ? '<div class="yj-note"><span class="yj-jl">注</span>' + esc(d.note).replace(/\n/g, '<br>') + '</div>' : '') +
    '</div>';
  }

  function renderCard(card) {
    return state.mode === 'gua' ? renderGuaCard(card) : renderIntroCard(card);
  }

  /* ===== 卦序方图（行=上卦，列=下卦，行/列均按先天卦序） ===== */
  function chartCell(card) {
    var d = card.data || {};
    var up = triIdx(d.upper);
    return '<div class="c-cell tr-' + (up >= 0 ? up : 0) + '" data-card-id="' + card.id + '" data-act="jump"' +
      ' data-tooltip="第' + esc(d.number) + '卦 ' + esc(d.name) + ' · 点一下看卦卡">' +
      (card.is_unknown === 1 ? '<span class="c-star"><i class="fa-solid fa-star"></i></span>' : '') +
      (card.is_favorite === 1 ? '<span class="c-fav"><i class="fa-solid fa-bookmark"></i></span>' : '') +
      '<span class="c-symbol">' + (hexSymbol(d.number) || esc(d.name)) + '</span>' +
      '<span class="c-name">' + esc(d.name) + '</span>' +
      '<span class="c-no">' + esc(d.number) + '</span>' +
      '</div>';
  }

  function renderChart() {
    var box = $id('study-list');
    if (!state.all.length) { box.innerHTML = '<div class="empty-state">还没有卡片。</div>'; return; }
    var byCell = {};
    state.all.forEach(function (c) {
      var d = c.data || {};
      byCell[d.upper + '/' + d.lower] = c;
    });
    var html = '<div class="yj-chart">';
    html += '<div class="c-corner"><span>上↗下↘</span></div>';
    TRIGRAMS.forEach(function (col) {
      html += '<div class="c-head">' + miniTri(col) + '<b>' + esc(col) + '</b></div>';
    });
    TRIGRAMS.forEach(function (row) {
      html += '<div class="c-rowlabel">' + miniTri(row) + '<b>' + esc(row) + '</b></div>';
      TRIGRAMS.forEach(function (col) {
        var card = byCell[row + '/' + col];
        html += card ? chartCell(card) : '<div class="c-cell empty"></div>';
      });
    });
    html += '</div>';
    box.innerHTML = html;
  }

  /* ===== 渲染 ===== */
  function renderList() {
    var box = $id('study-list');
    if (!box) return;
    var content = $('.study-content');
    var isChart = (state.mode === 'gua' && state.view === 'chart' && !state.singleCardMode);
    if (content) {
      content.classList.toggle('wide', state.singleCardMode);
      content.classList.toggle('chart-wide', isChart);
    }
    if (state.singleCardMode) { renderSingleCardStage(); return; }
    if (isChart) { renderChart(); return; }

    if (!state.all.length) { box.innerHTML = '<div class="empty-state">还没有卡片。</div>'; return; }
    box.innerHTML = state.all.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 14, 260) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }
  function patchCard(card) {
    if (state.mode === 'gua' && state.view === 'chart') { patchCell(card); return; }
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

  /* ===== 单卡模式 ===== */
  function toggleSingleCardMode() {
    if (state.mode === 'gua' && state.view === 'chart') return;
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
  function playName(card) {
    var d = card.data || {};
    cardAPI.track('audio_play', card.id);
    var text = d.name || d.title || '';
    if (!text) { showToast('这张卡没有可朗读的内容', true); return; }
    warnIfNoVoice();
    voiceMgr.speak(text, VOICE_LANG);
  }
  function playText(card, text) {
    if (!text) return;
    cardAPI.track('word_play', card.id);
    warnIfNoVoice();
    voiceMgr.speak(text, VOICE_LANG);
  }
  function handleMark(card) {
    var want = card.is_unknown === 1 ? 0 : 1;
    cardAPI.mark(card.id, want).then(function (d) {
      card.is_unknown = (d && typeof d.is_unknown !== 'undefined') ? d.is_unknown : want;
      cardAPI.track('word_mark', card.id);
      if (state.mode === 'gua' && state.view === 'chart') patchCell(card);
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
      if (state.mode === 'gua' && state.view === 'chart') patchCell(card);
      else if (state.singleCardMode) renderSingleCardContent(state.singleCardIndex, false);
      else patchCard(card);
    });
  }

  /* 从方图跳到卦卡 */
  function jumpToCard(id) {
    var card = findCard(id);
    if (!card) return;
    playName(card);
    if (state.view === 'card' && !state.singleCardMode) { scrollToCard(card); return; }
    setView('card');
    scrollToCard(card);
  }
  function scrollToCard(card) {
    requestAnimationFrame(function () {
      var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('yj-flash');
      void el.offsetWidth;
      el.classList.add('yj-flash');
      setTimeout(function () { el.classList.remove('yj-flash'); }, 1400);
    });
  }

  /* ===== 视图切换 ===== */
  function renderViewSeg() {
    var box = $id('view-seg');
    if (!box) return;
    if (state.mode !== 'gua') { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    box.innerHTML = '<button type="button" data-view="chart"' + (state.view === 'chart' ? ' class="on"' : '') + '>卦序方图</button>' +
      '<button type="button" data-view="card"' + (state.view === 'card' ? ' class="on"' : '') + '>卦卡</button>';
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

      /* 卦辞点读 */
      var sayEl = target.closest('[data-say]');
      if (sayEl) {
        e.stopPropagation();
        var sCardEl = sayEl.closest('[data-card-id]');
        var sCard = sCardEl ? findCard(sCardEl.dataset.cardId) : null;
        if (sCard) playText(sCard, sayEl.dataset.say);
        return;
      }
      /* 方图格子 = 读卦名 + 跳卡 */
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
          if (action === 'play') playName(card);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }
      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

      /* 方图 / 卦卡 */
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
          loadAll().then(function () { renderViewSeg(); renderList(); updateStatsText(); });
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

    renderViewSeg();
    renderList();

    loadAll().then(function () {
      /* 入门卡组只有单视图：收掉 seg 与单卡按钮（概念卡一屏一列即可） */
      var cv = $id('card-view-btn');
      if (cv) cv.style.display = (state.mode === 'gua' && state.view === 'chart') ? 'none' : '';
      try {
        var sv = localStorage.getItem(LS + 'view');
        if (state.mode === 'gua' && sv && ['chart', 'card'].indexOf(sv) >= 0) state.view = sv;
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
