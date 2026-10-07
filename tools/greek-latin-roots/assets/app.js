/* ==========================================================================
   Greek & Latin Roots · 小工具
   --------------------------------------------------------------------------
   152 张词根卡（Latin 82 / Greek 70，共 597 个衍生词），**单视图**：一列双面卡。
   原模板是照抄本体的"目录 → 页签 → 每一页 100 张"，本工具一次 getPage(1,500)
   读完，顶栏 + 一条滚动列表就是全部导航（没有目录、没有页签、没有侧栏、
   没有分段控件、**没有眼睛按钮**）。

   卡面**照搬原模板**（t_template 28，.glr-* 那一套，见 cards.css 头注）：
     正面 = 大词根 + "What does this root mean?" + "Tap to reveal ↻"
     背面 = 词根 / 释义 / DERIVATIVES（TOP500·TOP2k·SUPP 三档色）/ 词源条
   四个动作按钮**纯图标**，标签是 hover 时的 CSS ::after（data-tip）：
     Pronounce · Flip · Mark · Favorite
   点**任意一面**也翻面（但点按钮不算）—— 原模板的行为，保留。

   ⚠️ 本工具**纯英文**（CJK = 0）：它是纯英文商品，界面与卡面都不出现中文。
   ⚠️ etymology 字段**自带 HTML**（<em>…</em> &mdash;），拼卡面时按 HTML 走，
      **不能 esc**（esc 了会把 <em> 显示成字面量）。
   ⚠️ 数据里还有 mnemonic 字段（152 张全有），原模板没用 → 这里也不用。

   朗读走浏览器 speechSynthesis（顶栏可选英语 voice），宿主的 playAudio 不用
   —— 这样音色下拉才管得住它。"spect / spic" 这种多形态词根读之前把 " / "
   换成 ", "（TTS 读斜杠很飘）。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || 'Greek & Latin Roots';
  var VOICE_LANG = TOOL.voiceLang || 'en';
  var PAGE_SIZE = 500;                    /* 152 张，一次读完 */

  /* 三套皮肤。id 沿用 cream / glass / category —— app.css 的 token 块就挂在这三个
     类名上；显示名按本卡组自己的说法来（原模板的底色是冷灰绿，叫 Cream 会名不副实）：
       Sage      原模板的本色（冷调灰绿"低疲劳阅读"底）
       Ink Glass 原模板的 body.dark-mode 那套
       Origin    按 Greek / Latin 强调色淡染 */
  var SKINS = [
    { id: 'cream', name: 'Sage', icon: 'fa-leaf' },
    { id: 'glass', name: 'Ink Glass', icon: 'fa-moon' },
    { id: 'category', name: 'Origin', icon: 'fa-gem' }
  ];

  /* 衍生词难度档 → 色块类（色值在 cards.css 的 .glr-t-* 上，皮肤可覆盖） */
  var TIER_CLASS = { TOP500: 'glr-t-top500', TOP2k: 'glr-t-top2k', SUPP: 'glr-t-supp' };
  var TIER_FALLBACK = 'glr-t-supp';

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    soundEnabled: true,
    _voiceWarned: false,
    _refreshLock: false
  };
  try {
    var savedSkin = localStorage.getItem('dc-glr-skin');
    if (savedSkin) state.skin = savedSkin;
  } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem('dc-glr-font')) || 1; } catch (e) {}
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

  /* ===== 自绘 tooltip（顶栏按钮用；卡上的 4 个按钮走 CSS ::after） ===== */
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

  /* ===== 音色（读英语；音色键沿用 dc-voice-<lang>，与其它工具/本体一致） ===== */
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
    /* 「变声玩具」判据：同一个基名被注册到 ≥2 个主语言下。
       macOS 把 Eddy / Grandma / Sandy … 这 8 个 novelty 角色铺到 10 个语言，
       实测它们在 zh / ja / ko 下共用同一段基础语音、只换变调：
         zh — 16 个音色只有 3 种字节长度，彼此包络相关 0.82–0.99，与真音色负相关 −0.26
         ja — 8 个音色字节数完全相同（185064）
         ko — 8 个音色 194538–194550
       真音色（Tingting / Meijia / Kyoko / Yuna …）只在单一语言下注册，不会误伤。
       只在 _toyHideLangs 里实测过的语系生效：英文的 novelty 是 coca20000 的现役
       音色，未实测，不动。 */
    _voiceBase: function (name) { return String(name || '').replace(/\s*\(.*\)\s*$/, '').trim(); },
    _toyHideLangs: ['zh', 'ja', 'ko'],
    toySet: function () {
      if (this._toyCache && this._toyFor === this.voices) return this._toyCache;
      var langsOf = {}, self = this;
      (this.voices || []).forEach(function (v) {
        var b = self._voiceBase(v.name);
        if (!langsOf[b]) langsOf[b] = {};
        langsOf[b][self._primary(v.lang)] = 1;
      });
      var set = {};
      Object.keys(langsOf).forEach(function (b) {
        if (Object.keys(langsOf[b]).length >= 2) set[b] = 1;
      });
      this._toyCache = set;
      this._toyFor = this.voices;
      return set;
    },
    isToy: function (v) {
      if (this._toyHideLangs.indexOf(this._primary(v.lang)) < 0) return false;
      return !!this.toySet()[this._voiceBase(v.name)];
    },
    pickVoice: function (lang) {
      if (!lang) return null;
      var primary = this._primary(lang);
      var saved = null;
      try { saved = localStorage.getItem('dc-voice-' + primary); } catch (e) {}
      /* 用户显式选过就用它（音色可能已被系统删掉 ⇒ 忽略、继续往下挑）。
         必须放在循环外：塞进循环里的话「精确 lang 命中」会先 return，
         而中文音色表第一个就是 zh-CN，用户每次改音色都会被它抢先。 */
      if (saved) {
        for (var j = 0; j < this.voices.length; j++) {
          /* 玩具音色（见 isToy）不算用户的有效选择：中文下默认要落到 Tingting，
             而不是音色表第一个 zh-CN 的 Eddy */
          if (this.voices[j].voiceURI === saved && !this.isToy(this.voices[j])) return this.voices[j];
        }
      }
      var fallback = null;
      for (var i = 0; i < this.voices.length; i++) {
        var v = this.voices[i];
        if (this.isToy(v)) continue;   /* 玩具不参与自动挑选 */
        if (!fallback && this._primary(v.lang) === primary) fallback = v;
        if (v.lang && v.lang.toLowerCase() === String(lang).toLowerCase()) return v;
      }
      return fallback;
    },
    saveVoice: function (lang, voice) {
      try { localStorage.setItem('dc-voice-' + this._primary(lang), voice ? voice.voiceURI : ''); } catch (e) {}
    },
    sampleText: function () { return 'spect, spic'; },
    speak: function (text, lang) {
      if (!('speechSynthesis' in window)) { showToast('This browser does not support speech.', true); return; }
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

  /* 没有英语 voice 时**别静默**：说出来是默认音色在读英文词根，只会读得很怪 */
  function warnIfNoEnglishVoice() {
    if (state._voiceWarned) return;
    if (voiceMgr.pickVoice(VOICE_LANG)) return;
    state._voiceWarned = true;
    showToast('No English voice found on this system — pronunciation may be off.', false);
  }

  function renderVoiceDropdown() {
    var list = $('.voice-list');
    if (!list) return;
    list.innerHTML = '';
    var lang = voiceMgr._primary(VOICE_LANG);
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === lang; });
    /* 隐藏「变声玩具」音色；若该语言下全是玩具（理论上不会）就退回完整列表，免得下拉空掉 */
    var realVoices = voices.filter(function (v) { return !voiceMgr.isToy(v); });
    if (realVoices.length) voices = realVoices;
    var pick = voiceMgr.pickVoice(VOICE_LANG);
    var activeUri = pick ? pick.voiceURI : null;

    if (!voices.length) {
      var empty = document.createElement('div');
      empty.className = 'voice-option muted';
      empty.textContent = 'No English voice found on this system. Tap to preview with the default.';
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
    try { localStorage.setItem('dc-glr-skin', state.skin); } catch (e) {}
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

  /* ===== 字号：只动卡内文字（--card-font-scale）＋ 与之等比缩放的盒子（--kt） ===== */
  function applyCardFont() {
    document.documentElement.style.setProperty('--card-font-scale', String(state.fontSize));
    var v = $id('font-size-value');
    if (v) v.textContent = Math.round(state.fontSize * 100) + '%';
    try { localStorage.setItem('dc-glr-font', state.fontSize); } catch (e) {}
  }

  /* ==========================================================================
     数据
     ========================================================================== */
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

  /* 卡面上的 DOM（列表模式与单卡模式都在 #study-list 里，一个选择器够用） */
  function cardEl(card) {
    return document.querySelector('#study-list [data-card-id="' + card.id + '"]');
  }

  /* Greek / Latin → 强调色类（色值在 cards.css，皮肤能覆盖） */
  function originClass(origin) {
    return String(origin == null ? '' : origin).toLowerCase() === 'greek' ? 'glr-greek' : 'glr-latin';
  }
  function tierClass(tier) { return TIER_CLASS[tier] || TIER_FALLBACK; }

  /* derivatives 正常是数组；万一被序列化成字符串也兜住（老数据的教训） */
  function derivsOf(v) {
    if (Object.prototype.toString.call(v) === '[object Array]') return v;
    if (typeof v === 'string' && v) {
      try { var p = JSON.parse(v); return Object.prototype.toString.call(p) === '[object Array]' ? p : []; } catch (e) { return []; }
    }
    return [];
  }

  /* "spect / spic" → "spect, spic"：TTS 读斜杠很飘，读逗号更稳 */
  function speakableRoot(s) {
    return String(s == null ? '' : s).replace(/\s*\/\s*/g, ', ').trim();
  }

  /* ==========================================================================
     卡面（照搬原模板 28）
     ========================================================================== */
  function renderCard(card) {
    var d = card.data || {};
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    var ds = derivsOf(d.derivatives);
    var h = '';

    h += '<div class="glr-root ' + originClass(d.origin) + '" data-card-id="' + card.id + '">';
    /* 顶栏：左 origin + #no，右 4 个纯图标按钮（标签在 hover 的 ::after 里） */
    h += '<div class="glr-bar">';
    h += '<span class="glr-bar-left">';
    h += '<span class="glr-origin"><span class="glr-dot"></span>' + esc(d.origin) + '</span>';
    h += '<span class="glr-idx">#' + esc(d.no) + '</span>';
    h += '</span>';
    h += '<div class="glr-actions">';
    h += '<button type="button" class="glr-act act-audio" data-action="play" data-tip="Pronounce" aria-label="Pronounce"><i class="fa-solid fa-volume-high"></i></button>';
    h += '<button type="button" class="glr-act act-flip" data-action="flip" data-tip="Flip" aria-label="Flip"><i class="fa-solid fa-rotate"></i></button>';
    h += '<button type="button" class="glr-act act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tip="' + (markOn ? 'Marked' : 'Mark') + '" aria-label="Mark"><i class="fa-solid fa-bookmark"></i></button>';
    h += '<button type="button" class="glr-act act-fav' + (favOn ? ' is-active' : '') + '" data-action="fav" data-tip="' + (favOn ? 'Favorited' : 'Favorite') + '" aria-label="Favorite"><i class="fa-solid fa-star"></i></button>';
    h += '</div>';
    h += '</div>';

    h += '<div class="glr-flip"><div class="glr-inner">';
    /* 正面：大词根 */
    h += '<div class="glr-face glr-front" data-act="flipface">';
    h += '<div class="glr-root-word">' + esc(d.root) + '</div>';
    h += '<div class="glr-prompt">What does this root mean?</div>';
    h += '<div class="glr-hint">Tap to reveal &#8635;</div>';
    h += '</div>';
    /* 背面：释义 + 衍生词 + 词源 */
    h += '<div class="glr-face glr-back" data-act="flipface">';
    h += '<div class="glr-back-head">' + esc(d.root) + '</div>';
    h += '<div class="glr-meaning">' + esc(d.meaning_en) + '</div>';
    h += '<div class="glr-sec">Derivatives</div>';
    h += '<div class="glr-derivs">';
    ds.forEach(function (dv) {
      h += '<div class="glr-deriv">' +
        '<span class="glr-d-word">' + esc(dv.word) + '</span>' +
        '<span class="glr-tier ' + tierClass(dv.tier) + '">' + esc(dv.tier || 'SUPP') + '</span>' +
        '<span class="glr-d-mean">' + esc(dv.meaning) + '</span>' +
        '</div>';
    });
    h += '</div>';
    /* ⚠️ etymology 自带 HTML —— 按 HTML 拼，不要 esc */
    if (d.etymology) h += '<div class="glr-etym">' + d.etymology + '</div>';
    h += '</div>';
    h += '</div></div>';
    h += '</div>';
    return h;
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
      box.innerHTML = '<div class="empty-state">No cards yet.</div>';
      return;
    }
    box.innerHTML = cards.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 14, 260) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }

  /* 标记/收藏后**只同步那两个按钮**，不整卡重渲染 ——
     重渲染会把 .glr-inner 的 flipped 状态丢掉（用户正看着背面，一点标记就翻回正面）。 */
  function syncActs(card) {
    var el = cardEl(card);
    if (!el) return;
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    var markBtn = el.querySelector('.act-mark');
    if (markBtn) {
      markBtn.classList.toggle('is-active', markOn);
      markBtn.setAttribute('data-tip', markOn ? 'Marked' : 'Mark');
    }
    var favBtn = el.querySelector('.act-fav');
    if (favBtn) {
      favBtn.classList.toggle('is-active', favOn);
      favBtn.setAttribute('data-tip', favOn ? 'Favorited' : 'Favorite');
    }
  }

  /* ===== 单卡模式（作用域 = 整个卡组，152 张） ===== */
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
      box.innerHTML = '<div class="empty-state">No cards yet.</div>';
      return;
    }
    var prevSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
    var nextSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    var cur = cards[state.singleCardIndex] || cards[0];
    var org = (cur.data || {}).origin || '';
    box.innerHTML =
      '<div class="single-card-stage">' +
        '<div class="sc-main"><div class="sc-card-wrap" id="sc-card-wrap"></div></div>' +
        '<div class="sc-nav-col">' +
          '<button class="sc-nav sc-prev" data-sc="prev" data-tooltip="Previous" aria-label="Previous">' + prevSvg + '</button>' +
          '<div class="sc-progress"><span id="sc-idx">1</span> / ' + cards.length + '</div>' +
          '<div class="sc-group" id="sc-group">' + esc(org) + '</div>' +
          '<button class="sc-nav sc-next" data-sc="next" data-tooltip="Next" aria-label="Next">' + nextSvg + '</button>' +
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
    if (gEl) gEl.textContent = (cards[idx].data || {}).origin || '';
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
    var text = speakableRoot(d.root);
    if (!text) { showToast('This card has nothing to read aloud.', true); return; }
    warnIfNoEnglishVoice();
    voiceMgr.speak(text, VOICE_LANG);
  }
  /* 翻面：按钮与"点任意一面"都走这里，原模板也是两处都记 flip */
  function flipCard(card, rootEl) {
    var inner = rootEl ? rootEl.querySelector('.glr-inner') : null;
    if (!inner) return;
    inner.classList.toggle('flipped');
    cardAPI.track('flip', card.id);
  }
  function handleMark(card) {
    var want = card.is_unknown === 1 ? 0 : 1;
    cardAPI.mark(card.id, want).then(function (d) {
      card.is_unknown = (d && typeof d.is_unknown !== 'undefined') ? d.is_unknown : want;
      cardAPI.track('word_mark', card.id);
      syncActs(card);
      updateStatsText();
    });
  }
  function handleFavorite(card) {
    var want = card.is_favorite === 1 ? 0 : 1;
    cardAPI.favorite(card.id, want).then(function (d) {
      card.is_favorite = (d && typeof d.is_favorite !== 'undefined') ? d.is_favorite : want;
      cardAPI.track('favorite_toggle', card.id);
      syncActs(card);
    });
  }

  /* ===== 事件委托（一处绑完，重渲染不用重绑） ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 卡上的 4 个动作按钮 */
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl2 = actionBtn.closest('[data-card-id]');
        var card = cardEl2 ? findCard(cardEl2.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          if (action === 'play') handlePlay(card);
          else if (action === 'flip') flipCard(card, cardEl2);
          else if (action === 'mark') handleMark(card);
          else if (action === 'fav') handleFavorite(card);
        }
        return;
      }
      /* 点任意一面也翻面（按钮在 bar 里，不在 face 里，不会误触） */
      var face = target.closest('[data-act="flipface"]');
      if (face) {
        e.stopPropagation();
        var faceCardEl = face.closest('[data-card-id]');
        var faceCard = faceCardEl ? findCard(faceCardEl.dataset.cardId) : null;
        if (faceCard) flipCard(faceCard, faceCardEl);
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
          showToast('Refreshed');
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
      if (box) box.innerHTML = '<div class="empty-state">Failed to load deck data.</div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
