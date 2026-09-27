/* ==========================================================================
   西方典故 · 小工具
   --------------------------------------------------------------------------
   37 张双语阅读卡（希腊神话 13 / 罗马与历史 4 / 圣经 8 / 文学与童话 12），
   一次读完，卡片之间按 group 插一条吸顶的分组小标题。

   跟"照抄宿主学习视图"那一代（目录 → 页签 → 每页 100 张）比：
     · 一次 getPage(1,500) 读完，没有目录、没有页签、没有侧栏、没有分段控件
     · **没有眼睛按钮**：English Corner 与英文典故名始终显示（用户 2026-09-25 拍板）
     · 三套皮肤（奶油 / 墨玻璃 / 分类彩），分组色在 4 个 .wa-<group> 类上
     · 卡面 = 阅读卡版面：列宽 620、正文 ×1.10、按钮钉右上角右轨

   ★ 朗读走浏览器 speechSynthesis（顶栏可选音色），宿主的 playAudio 不用
     —— 这样音色下拉才管得住它。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '西方典故';
  var VOICE_LANG = TOOL.voiceLang || 'zh';
  var PAGE_SIZE = 500;                    /* 37 张，一次读完 */

  var SKINS = [
    { id: 'cream', name: '奶油', icon: 'fa-sun' },
    { id: 'glass', name: '墨玻璃', icon: 'fa-moon' },
    { id: 'category', name: '分类彩', icon: 'fa-gem' }
  ];

  /* 分组：4 个组的 id / 类名 / 图标。顺序由数据决定，这里只做合法性与兜底。 */
  var GROUPS = {
    greek:      { cls: 'wa-greek',      icon: 'fa-bolt' },
    history:    { cls: 'wa-history',    icon: 'fa-landmark' },
    bible:      { cls: 'wa-bible',      icon: 'fa-book-bible' },
    literature: { cls: 'wa-literature', icon: 'fa-feather' }
  };
  var FALLBACK_GROUP = 'greek';

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    soundEnabled: true
  };
  try {
    var savedSkin = localStorage.getItem('dc-wa-skin');
    if (savedSkin) state.skin = savedSkin;
  } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem('dc-wa-font')) || 1; } catch (e) {}
  try { state.soundEnabled = localStorage.getItem('dc-sound') !== '0'; } catch (e) {}

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

  /* ===== 音色（朗读中文典故名；音色键沿用本体/别的工具那一套 dc-voice-<lang>） ===== */
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
    sampleText: function () { return '阿喀琉斯之踵'; },
    speak: function (text, lang) {
      if (!('speechSynthesis' in window)) { showToast('这个浏览器不支持朗读', true); return; }
      var u = new SpeechSynthesisUtterance(text || '');
      var voice = this.pickVoice(lang || VOICE_LANG);
      if (voice) u.voice = voice;
      else if (lang) u.lang = lang;
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
    var lang = voiceMgr._primary(VOICE_LANG);
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === lang; });
    var pick = voiceMgr.pickVoice(VOICE_LANG);
    var activeUri = pick ? pick.voiceURI : null;

    if (!voices.length) {
      var empty = document.createElement('div');
      empty.className = 'voice-option muted';
      empty.textContent = '系统里没有中文音色，点一下用默认的试听。';
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

  /* ===== 皮肤 ===== */
  function applySkin() {
    var h = document.documentElement;
    SKINS.forEach(function (s) { h.classList.remove('skin-' + s.id); });
    h.classList.add('skin-' + state.skin);
    try { localStorage.setItem('dc-wa-skin', state.skin); } catch (e) {}
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
    try { localStorage.setItem('dc-wa-font', state.fontSize); } catch (e) {}
  }

  /* ===== 数据 ===== */
  function groupOf(card) {
    var g = (card.data || {}).group;
    return GROUPS[g] ? g : FALLBACK_GROUP;
  }
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
    var cards = state.all;
    var marked = cards.filter(function (c) { return c.is_unknown === 1; }).length;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + cards.length;
  }

  /* ==========================================================================
     卡面
     ========================================================================== */
  function railButtons(card) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="dc-acts">' +
      '<button type="button" data-action="play" data-tooltip="朗读典故名"><i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }

  function renderCard(card) {
    var d = card.data || {};
    var g = groupOf(card);
    var gdef = GROUPS[g];
    return '<div class="wa-root ' + gdef.cls + '" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<span class="wa-badge"><i class="fa-solid ' + gdef.icon + '"></i>' + esc(d.groupZh || '') + '</span>' +
      '<div class="wa-title">' +
        '<div class="wa-name">' + esc(d.nameZh) + '</div>' +
        (d.nameEn ? '<div class="wa-name-en">' + esc(d.nameEn) + '</div>' : '') +
      '</div>' +
      (d.tagline ? '<div class="wa-tag">' + esc(d.tagline) + '</div>' : '') +
      '<div class="wa-body">' +
        (d.story ? '<div class="wa-sec"><div class="wa-sec-label">故事 Story</div>' +
          '<div class="wa-para">' + esc(d.story) + '</div></div>' : '') +
        (d.usageZh ? '<div class="wa-sec"><div class="wa-sec-label">现代用法 Today</div>' +
          '<div class="wa-para">' + esc(d.usageZh) + '</div></div>' : '') +
        '<div class="wa-sec"><div class="wa-sec-label">English Corner</div>' +
          '<div class="wa-ec">' +
            (d.ecText ? '<div class="wa-ec-text">' + esc(d.ecText) + '</div>' : '') +
            (d.ecExample ? '<div class="wa-ec-ex">' + esc(d.ecExample) + '</div>' : '') +
            (d.ecZh ? '<div class="wa-ec-zh">' + esc(d.ecZh) + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      (d.sourceZh ? '<div class="wa-source"><b>出处 Source</b> · ' + esc(d.sourceZh) + '</div>' : '') +
    '</div>';
  }

  /* 分组小标题：每换一个 group 插一条（吸顶），右边挂该组张数 */
  function groupHead(g, groupZh, count) {
    return '<div class="dc-group-head ' + GROUPS[g].cls + '">' +
      '<i class="dot"></i>' + esc(groupZh) +
      '<span class="n">' + count + ' 张</span></div>';
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
    var counts = {};
    cards.forEach(function (c) { var g = groupOf(c); counts[g] = (counts[g] || 0) + 1; });

    var html = '', last = null;
    cards.forEach(function (c, i) {
      var g = groupOf(c);
      if (g !== last) {
        html += groupHead(g, (c.data || {}).groupZh || '', counts[g]);
        last = g;
      }
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

  /* ===== 单卡模式（作用域 = 整个卡组，37 张） ===== */
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
    var cur = cards[state.singleCardIndex] || cards[0];
    var gz = (cur.data || {}).groupZh || '';
    box.innerHTML =
      '<div class="single-card-stage">' +
        '<div class="sc-main"><div class="sc-card-wrap" id="sc-card-wrap"></div></div>' +
        '<div class="sc-nav-col">' +
          '<button class="sc-nav sc-prev" data-sc="prev" data-tooltip="上一张" aria-label="上一张">' + prevSvg + '</button>' +
          '<div class="sc-progress"><span id="sc-idx">1</span> / ' + cards.length + '</div>' +
          '<div class="sc-group" id="sc-group">' + esc(gz) + '</div>' +
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
    var gEl = $id('sc-group');
    if (gEl) gEl.textContent = (cards[idx].data || {}).groupZh || '';
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
    cardAPI.track('audio_play', card.id);
    if (!d.nameZh) { showToast('这张卡没有可朗读的内容', true); return; }
    voiceMgr.speak(d.nameZh, VOICE_LANG);
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

    /* 键盘：单卡模式下 ←/→/空格 翻卡，Esc 退出 */
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
