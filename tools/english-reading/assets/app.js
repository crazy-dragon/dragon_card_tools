/* ==========================================================================
   双语阅读 · 小工具（3 章 The Wind in the Willows：原文 en + 译文 zh）
   --------------------------------------------------------------------------
   每张卡是**长文阅读卡**：
     · 卡内三段按钮切换 原文 / 对照 / 译文（rd-seg，状态按卡记、默认对照）
     · 🔊 读英文原文（en-US，audio_play）
     · 点译文块读中文（zh-CN，word_play）
   没有表格视图可切 —— 顶栏不放视图分段；保留单卡模式（900px 宽列）。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '双语阅读';
  var VOICE_ZH = TOOL.voiceLang || 'zh-CN';
  var VOICE_EN = 'en-US';
  var PAGE_SIZE = 500;
  var LS = 'dc-rd-';
  var MODES = [
    { id: 'en',   label: '原文' },
    { id: 'both', label: '对照' },
    { id: 'zh',   label: '译文' }
  ];

  var SKINS = [
    { id: 'cream', name: '书页', icon: 'fa-sun' },
    { id: 'glass', name: '墨夜', icon: 'fa-moon' },
    { id: 'category', name: '藏书票', icon: 'fa-book-bookmark' }
  ];

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    cardMode: {},        /* cardId -> 'en' | 'both' | 'zh'（默认 both） */
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

  /* ===== 音色（中英各一个槽位） ===== */
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
    sampleText: function () { return '春意萌动'; },
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
    showToast('系统里没有中文语音包，译文读音可能不准', false);
  }
  function renderVoiceDropdown() {
    var list = $('.voice-list');
    if (!list) return;
    list.innerHTML = '';
    var lang = voiceMgr._primary(VOICE_ZH);
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === lang; });
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

  /* ===== 数据 ===== */
  function loadAll() {
    if (!window.cardAPI || !cardAPI.getPage) return Promise.resolve();
    return cardAPI.getPage(1, PAGE_SIZE).then(function (d) {
      state.all = (d.cards || []).slice();
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
  function modeOf(cardId) { return state.cardMode[cardId] || 'both'; }

  /* ===== 卡面 ===== */
  function railButtons(card) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="dc-acts">' +
      '<button type="button" data-action="play" data-tooltip="读英文原文"><i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }

  function segHtml(card) {
    var mode = modeOf(card.id);
    return '<div class="rd-seg" role="tablist">' + MODES.map(function (m) {
      return '<button type="button" data-mode="' + m.id + '"' + (mode === m.id ? ' class="on"' : '') + '>' +
        esc(m.label) + '</button>';
    }).join('') + '</div>';
  }

  function renderCard(card) {
    var d = card.data || {};
    var mode = modeOf(card.id);
    var showEn = mode === 'en' || mode === 'both';
    var showZh = mode === 'zh' || mode === 'both';
    return '<div class="rd-root" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<div class="rd-head">' +
        '<div class="rd-title">' + esc(d.title) + '</div>' +
        (d.source ? '<div class="rd-author"><i class="fa-solid fa-feather-pointed"></i>' + esc(d.source) + '</div>' : '') +
      '</div>' +
      segHtml(card) +
      (showEn && d.text ? '<div class="rd-en"><span class="rd-lang">EN</span>' + esc(d.text) + '</div>' : '') +
      (showZh && d.translation ? '<div class="rd-zh" data-word="' + esc(d.translation) + '" data-tooltip="读译文">' +
        '<span class="rd-lang">译</span>' + esc(d.translation) + '</div>' : '') +
    '</div>';
  }

  /* ===== 渲染 ===== */
  function renderList() {
    var box = $id('study-list');
    if (!box) return;
    var content = $('.study-content');
    if (content) content.classList.toggle('wide', state.singleCardMode);
    if (state.singleCardMode) { renderSingleCardStage(); return; }
    if (!state.all.length) {
      box.innerHTML = '<div class="empty-state">还没有卡片。</div>';
      return;
    }
    box.innerHTML = state.all.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 60, 200) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }
  function patchCard(card) {
    var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
  }

  /* ===== 单卡模式 ===== */
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
    voiceMgr.speak(d.text, VOICE_EN);
  }
  function playWord(card, word, lang) {
    if (!word) return;
    cardAPI.track('word_play', card.id);
    warnIfNoVoice();
    voiceMgr.speak(word, lang || VOICE_ZH);
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
  function setMode(card, mode) {
    if (MODES.every(function (m) { return m.id !== mode; })) return;
    state.cardMode[card.id] = mode;
    if (state.singleCardMode) renderSingleCardContent(state.singleCardIndex, false);
    else patchCard(card);
  }

  /* ===== 事件委托 ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 译文块 = 读中文 */
      var wordEl = target.closest('[data-word]');
      if (wordEl) {
        e.stopPropagation();
        var wCardEl = wordEl.closest('[data-card-id]');
        var wCard = wCardEl ? findCard(wCardEl.dataset.cardId) : null;
        if (wCard) playWord(wCard, wordEl.dataset.word, VOICE_ZH);
        return;
      }
      /* 卡内三段：原文 / 对照 / 译文 */
      var modeBtn = target.closest('.rd-seg [data-mode]');
      if (modeBtn) {
        e.stopPropagation();
        var mCardEl = modeBtn.closest('[data-card-id]');
        var mCard = mCardEl ? findCard(mCardEl.dataset.cardId) : null;
        if (mCard) setMode(mCard, modeBtn.dataset.mode);
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
        voiceMgr.saveVoice(VOICE_ZH, picked);
        renderVoiceDropdown();
        $('.voice-dropdown').style.display = 'none';
        voiceMgr.speak(voiceMgr.sampleText(), VOICE_ZH);
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
