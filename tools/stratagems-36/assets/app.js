/* ==========================================================================
   三十六计 · 小工具
   ==========================================================================
   42 张 = 36 条计 + 6 张套别总览（胜战计 / 敌战计 / 攻战计 / 混战计 / 并战计 / 败战计），
   一次读完，卡片顺序 = 卡组顺序（前 36 张是计，后 6 张是套别总览）。

   与"照抄宿主学习视图"那一代比（原模板 26/27 就是那一代，要目录 → 页签 → 每页 100 张）：
     · 一次 getPage(1,500) 读完，没有目录、没有页签、没有侧栏
     · **没有眼睛按钮**：计名 / 拼音 / 原文始终显示，释义那段靠翻面揭示
     · 三套皮肤（奶油 = 原模板的纸色 / 墨玻璃 / 分类彩）
     · 动作栏在**卡片底部右对齐**（原模板的位置），纯图标 + hover 悬浮标签

   ★ 这一版和原模板最大的不同：**顶栏可以切中文 / English**
     —— 中英本来就是同一条计的两个语言版本，合成**一份卡组**（每张卡同时带
        nameZh/nameEn、sourceZh/sourceEn…），工具按当前语言取字段。
        切语言 = 同一份数据换一套文案，不重新取数、不影响标记与翻面状态。

   ★ 朗读走浏览器 speechSynthesis（顶栏可选音色），宿主的 playAudio 不用
     —— 这样音色下拉才管得住它；切到 English 时音色、示例文本一起换成英语的。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '三十六计';
  var PAGE_SIZE = 500;                    /* 42 张，一次读完 */

  /* 语言：默认取 DC_TOOL.voiceLang，没配就中文 */
  var LANGS = TOOL.langs && TOOL.langs.length ? TOOL.langs : [
    { id: 'zh', label: '中文', voice: 'zh-CN', sample: '瞒天过海' },
    { id: 'en', label: 'English', voice: 'en-US', sample: 'Cross the Sea Under Camouflage' }
  ];
  var DEFAULT_LANG = TOOL.voiceLang || LANGS[0].id;

  var SKINS = [
    { id: 'cream', name: '奶油', icon: 'fa-sun' },
    { id: 'glass', name: '墨玻璃', icon: 'fa-moon' },
    { id: 'category', name: '分类彩', icon: 'fa-gem' }
  ];

  /* 6 套的配色类名（顺序 = setIndex）。套名不写死在这里，一律从数据里取。 */
  var SET_CLASS = ['st-set1', 'st-set2', 'st-set3', 'st-set4', 'st-set5', 'st-set6'];

  /* 界面文案（切语言时整卡重画） */
  var T = {
    zh: {
      order: function (n) { return '第 ' + n + ' 计'; },
      flipHint: '点击翻面看释义 ›',
      backHint: '‹ 点击翻回',
      meaning: '释义', story: '典故', modern: '现代应用',
      read: '朗读', flip: '翻面', mark: '标记', unmark: '取消标记',
      fav: '收藏', unfav: '取消收藏',
      eggStamp: '通关', eggSub: '第卅六计',
      eggNote: '—— 三十六计，走为上。你已读完最后一计，恭喜通关！',
      noPlay: '这张卡没有可朗读的内容'
    },
    en: {
      order: function (n) { return 'Stratagem ' + n; },
      flipHint: 'Click to flip for meaning ›',
      backHint: '‹ Click to flip back',
      meaning: 'Meaning', story: 'Story', modern: 'Reflection',
      read: 'Read', flip: 'Flip', mark: 'Mark', unmark: 'Unmark',
      fav: 'Favorite', unfav: 'Unfavorite',
      eggStamp: 'CLEAR', eggSub: 'No.36',
      eggNote: '— The best strategy is to retreat. You have read the 36th and final stratagem. Congratulations!',
      noPlay: 'Nothing to read on this card'
    }
  };

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    lang: DEFAULT_LANG,
    flipped: {},                 /* cardId -> true，切语言/重渲染都要留住 */
    trackLang: {}
  };
  try {
    var savedSkin = localStorage.getItem('dc-st-skin');
    if (savedSkin) state.skin = savedSkin;
  } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem('dc-st-font')) || 1; } catch (e) {}
  try {
    var savedLang = localStorage.getItem('dc-st-lang');
    if (savedLang && LANGS.some(function (l) { return l.id === savedLang; })) state.lang = savedLang;
  } catch (e) {}
  if (!LANGS.some(function (l) { return l.id === state.lang; })) state.lang = LANGS[0].id;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function cur() {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].id === state.lang) return LANGS[i];
    return LANGS[0];
  }
  function tt() { return T[state.lang] || T.zh; }
  function isZh() { return state.lang === 'zh'; }

  /* 取字段：优先当前语言，缺了就退回另一种语言（个别字段某一边可能是空的） */
  function pick(d, key) {
    var a = d[key + (isZh() ? 'Zh' : 'En')];
    var b = d[key + (isZh() ? 'En' : 'Zh')];
    return (a == null || a === '') ? (b == null ? '' : b) : a;
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

  /* ===== 音色（键沿用本体的 dc-voice-<lang>；中英各记一套） ===== */
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
    sampleText: function () { return cur().sample || ''; },
    speak: function (text, tag) {
      if (!('speechSynthesis' in window)) { showToast(isZh() ? '这个浏览器不支持朗读' : 'This browser cannot speak', true); return; }
      var u = new SpeechSynthesisUtterance(text || '');
      var voice = this.pickVoice(tag || cur().voice);
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
    var tag = cur().voice;
    var lang = voiceMgr._primary(tag);
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === lang; });
    var pick = voiceMgr.pickVoice(tag);
    var activeUri = pick ? pick.voiceURI : null;

    if (!voices.length) {
      var empty = document.createElement('div');
      empty.className = 'voice-option muted';
      empty.textContent = isZh() ? '系统里没有中文音色，点一下用默认的试听。' : 'No English voice installed — click to try the default.';
      empty.addEventListener('click', function () {
        voiceMgr.saveVoice(tag, null);
        voiceMgr.speak(voiceMgr.sampleText(), tag);
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
    try { localStorage.setItem('dc-st-skin', state.skin); } catch (e) {}
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
    try { localStorage.setItem('dc-st-font', state.fontSize); } catch (e) {}
  }

  /* ===== 语言 ===== */
  function applyLang() {
    var h = document.documentElement;
    h.classList.remove('lang-zh', 'lang-en');
    h.classList.add('lang-' + state.lang);
    h.lang = state.lang === 'en' ? 'en' : 'zh-CN';
    try { localStorage.setItem('dc-st-lang', state.lang); } catch (e) {}
    renderLangSeg();
    var lbl = $id('voice-lang-label');
    if (lbl) lbl.textContent = cur().label;
  }
  function renderLangSeg() {
    var seg = $id('lang-seg');
    if (!seg) return;
    seg.innerHTML = LANGS.map(function (l) {
      return '<button type="button" data-lang="' + l.id + '"' + (l.id === state.lang ? ' class="on"' : '') + '>' +
        esc(l.label) + '</button>';
    }).join('');
  }
  function setLang(id) {
    if (id === state.lang) return;
    if (!LANGS.some(function (l) { return l.id === id; })) return;
    state.lang = id;
    applyLang();
    /* 换文案要整列表重画；翻面状态存在 state.flipped 里，不会丢。
       重画会重建 DOM，先把滚动位置存下来再还回去，否则整页跳回顶部。 */
    var sc = $id('study-scroll');
    var top = sc ? sc.scrollTop : 0;
    renderList();
    if (sc) sc.scrollTop = top;
  }

  /* ===== 数据 ===== */
  function setIndexOf(card) {
    var d = card.data || {};
    if (d.setIndex >= 1 && d.setIndex <= 6) return d.setIndex;
    if (d.order >= 1 && d.order <= 36) return Math.floor((d.order - 1) / 6) + 1;
    return 1;
  }
  function isOverview(card) { return ((card.data || {}).type) === 'overview'; }
  function loadAll() {
    if (!window.cardAPI || !cardAPI.getPage) return Promise.resolve();
    return cardAPI.getPage(1, PAGE_SIZE).then(function (d) {
      state.all = (d.cards || []).slice();
      /* 每张卡的语言版本各用各的音色 */
      state.all.forEach(function (c) {
        if (!state.trackLang[c.id]) state.trackLang[c.id] = {};
      });
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
  /* 4 个槽位固定：总览卡没有翻面，但**不留空槽** —— 动作栏是右对齐的，
     右边缘钉死，少一个按钮只会让左边缘回缩，收藏/标记的位置不受影响。 */
  function actsHtml(card, hasFlip) {
    var t = tt();
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="st-acts">' +
      '<button type="button" data-action="play" data-tooltip="' + esc(t.read) + '"><i class="fa-solid fa-volume-high"></i></button>' +
      (hasFlip
        ? '<button type="button" data-action="flip" data-tooltip="' + esc(t.flip) + '"><i class="fa-solid fa-rotate"></i></button>'
        : '') +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        esc(markOn ? t.unmark : t.mark) + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        esc(favOn ? t.unfav : t.fav) + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }

  function renderOverview(card, d) {
    /* 印章：中文套名是三个字（「胜战计」），44px 印章放得下，直接用。
       英文套名最长 26 字符（"Enemy-Deception Stratagems"），塞进印章会溢成一团乱麻
       —— 原模板（deck 14）就是硬塞的，这里不照抄这个毛病：
       英文印章只写 SET + 套序号，完整套名交给下面的 .st-ov-title。 */
    var seal = isZh()
      ? '<div class="st-seal">' + esc(pick(d, 'set')) + '</div>'
      : '<div class="st-seal">SET<div class="st-seal-sub">' + esc(String(setIndexOf(card))) + '</div></div>';
    return '<div class="st-root st-overview ' + SET_CLASS[setIndexOf(card) - 1] + '" data-card-id="' + card.id + '">' +
      seal +
      '<div class="st-ov-title">' + esc(pick(d, 'title')) + '</div>' +
      '<div class="st-ov-theme">' + esc(pick(d, 'theme')) + '</div>' +
      '<div class="st-ov-body">' + esc(pick(d, 'body')) + '</div>' +
      actsHtml(card, false) +
    '</div>';
  }

  function renderStratagem(card, d) {
    var t = tt();
    var flipped = state.flipped[card.id] === true;
    var seg = function (key, label) {
      var v = pick(d, key);
      return v ? '<div class="st-sec"><div class="st-sec-h">' + esc(label) + '</div>' +
        '<div class="st-sec-b">' + esc(v) + '</div></div>' : '';
    };
    /* 现代应用（中）/ Reflection（英）是各自语言独有的字段，不走 pick */
    var last = isZh() ? (d.modern || '') : (d.reflection || '');
    var egg = (d.order === 36) ? (
      '<div class="st-egg">' +
        '<div class="st-egg-stamp">' + esc(t.eggStamp) +
          '<div class="st-egg-stamp-sub">' + esc(t.eggSub) + '</div></div>' +
        '<div class="st-egg-note">' + esc(t.eggNote) + '</div>' +
      '</div>') : '';
    return '<div class="st-root st-stratagem ' + SET_CLASS[setIndexOf(card) - 1] +
        (flipped ? ' flipped' : '') + '" data-card-id="' + card.id + '">' +
      '<div class="st-front" data-act="flipface">' +
        '<div class="st-head"><div class="st-order">' + esc(t.order(d.order)) + '</div>' +
          '<div class="st-pill">' + esc(pick(d, 'set')) + '</div></div>' +
        '<div class="st-name">' + esc(pick(d, 'name')) + '</div>' +
        (d.pinyin ? '<div class="st-pinyin">' + esc(d.pinyin) + '</div>' : '') +
        (pick(d, 'source') ? '<div class="st-source">' + esc(pick(d, 'source')) + '</div>' : '') +
        '<div class="st-hint">' + esc(t.flipHint) + '</div>' +
      '</div>' +
      '<div class="st-back" data-act="flipface">' +
        seg('explanation', t.meaning) +
        seg('story', t.story) +
        (last ? '<div class="st-sec"><div class="st-sec-h">' + esc(t.modern) + '</div>' +
          '<div class="st-sec-b">' + esc(last) + '</div></div>' : '') +
        '<div class="st-hint">' + esc(t.backHint) + '</div>' +
        egg +
      '</div>' +
      actsHtml(card, true) +
    '</div>';
  }

  function renderCard(card) {
    var d = card.data || {};
    return isOverview(card) ? renderOverview(card, d) : renderStratagem(card, d);
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

  /* 只重画一张卡（标记/收藏/翻面后）：别整列表重渲染，否则整屏动画重放、滚动也会抖 */
  function patchCard(card) {
    var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
  }

  /* ===== 单卡模式（作用域 = 整个卡组，42 张） ===== */
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
    var curCard = cards[state.singleCardIndex] || cards[0];
    box.innerHTML =
      '<div class="single-card-stage">' +
        '<div class="sc-main"><div class="sc-card-wrap" id="sc-card-wrap"></div></div>' +
        '<div class="sc-nav-col">' +
          '<button class="sc-nav sc-prev" data-sc="prev" data-tooltip="' + (isZh() ? '上一张' : 'Previous') + '" aria-label="prev">' + prevSvg + '</button>' +
          '<div class="sc-progress"><span id="sc-idx">1</span> / ' + cards.length + '</div>' +
          '<div class="sc-group" id="sc-group"></div>' +
          '<button class="sc-nav sc-next" data-sc="next" data-tooltip="' + (isZh() ? '下一张' : 'Next') + '" aria-label="next">' + nextSvg + '</button>' +
        '</div>' +
      '</div>';
    renderSingleCardContent(state.singleCardIndex, false);
    void curCard;
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
    if (gEl) {
      var d = cards[idx].data || {};
      gEl.textContent = pick(d, 'set') + (isOverview(cards[idx]) ? '' : ' · ' + (isZh() ? '第' + d.order + '计' : 'No.' + d.order));
    }
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
    var text = pick(d, isOverview(card) ? 'title' : 'name');
    cardAPI.track('audio_play', card.id);
    if (!text) { showToast(tt().noPlay, true); return; }
    voiceMgr.speak(text, cur().voice);
  }
  function handleFlip(card, el) {
    var d = card.data || {};
    var on = !(state.flipped[card.id] === true);
    state.flipped[card.id] = on;
    if (el) el.classList.toggle('flipped', on);
    cardAPI.track('flip', card.id);
    /* 第 36 计（走为上）翻面 = 通关彩蛋：跑一下 + 记一个 easter_egg */
    if (d.order === 36 && on && el) {
      el.classList.remove('st-run');
      void el.offsetWidth;
      el.classList.add('st-run');
      cardAPI.track('easter_egg', card.id);
    }
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

      /* 动作按钮（先判：它在卡里，点它不能顺带翻面） */
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl = actionBtn.closest('[data-card-id]');
        var card = cardEl ? findCard(cardEl.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          var flipEl = actionBtn.closest('.st-root');
          if (action === 'play') handlePlay(card);
          else if (action === 'flip') handleFlip(card, flipEl);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }
      /* 点正面/背面 = 翻面（原模板的提示语就是这么写的） */
      var face = target.closest('.st-front[data-act="flipface"], .st-back[data-act="flipface"]');
      if (face) {
        var root = face.closest('.st-root');
        var c2 = root ? findCard(root.dataset.cardId) : null;
        if (c2) handleFlip(c2, root);
        return;
      }

      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

      /* 语言分段控件 */
      var langBtn = target.closest('#lang-seg button[data-lang]');
      if (langBtn) { e.stopPropagation(); setLang(langBtn.dataset.lang); return; }

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
        voiceMgr.saveVoice(cur().voice, picked);
        renderVoiceDropdown();
        $('.voice-dropdown').style.display = 'none';
        voiceMgr.speak(voiceMgr.sampleText(), cur().voice);
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
          showToast(isZh() ? '已刷新' : 'Refreshed');
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
    applyLang();
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
