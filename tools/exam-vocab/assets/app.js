/* ==========================================================================
   exam-vocab 考试词汇词卡 · 小工具
   --------------------------------------------------------------------------
   一个工具，四个卡组（高中 / 四级 / 六级 / 考研），**不合并卡组数据**：
   工具绑在哪个卡组上，就读哪个卡组的词表 —— 词表仍是各卡组自己的
   t_deck_item，工具一行数据都不碰。

   与 DragonCard 本体（static/app.js + styles.css 的学习视图）逐条对齐：
     · 侧栏页签「按需打开」：点目录页号只开一个 P001，再点页签才进入（本体就是这个两步）
     · 页签可关闭（hover 浮出 ×）、按 pageNum 排序、重新打开会恢复（本地记忆）
     · 品牌按钮 = 回目录
     · 单卡模式作用域 = 当前页（不是整个卡组），0↔末循环，支持 ←/→/空格/Esc
     · 偷看逻辑照抄本体考试词卡模板：
         未标记 → 释义全藏（自己考自己）
         已标记 → 露英文释义
         点眼睛 → 中英都露，5 秒后自动收回
     · 音色 / 字体 / 皮肤下拉、自绘 tooltip、toast、结课弹窗
   界面语言：英文（英文标签最短，卡片上不抢戏）

   宿主桥接 window.cardAPI（由 /v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   音频不走桥接 —— 桥接的 playAudio(text) 不吃音色参数，所以本工具用自带的
   voiceMgr（照抄本体）直接驱动浏览器 speechSynthesis，音色才能真正生效。
   与本体共用两个本地存储键，改一边两边都跟着变：
     dc-open-tabs-<deckId>（已开页签）· dc-voice-en（英文选中的音色）

   本工具自己的键：dc-exam-skin（皮肤）· dc-exam-font（字号）

   ---- 三个皮肤（assets/skins/<id>.{css,js}）----
   standard 通用词汇卡 · journal 手帐词签 · space 太空站
   每个皮肤导出 { id, name, icon, render(card, env) -> html }，由本文件的
   renderCard() 调度；交互（点击）全部由本文件的**事件委托**统一处理，
   皮肤自己绝不绑事件 —— 否则会和委托双重触发（双份音频 + 双份埋点）。
   皮肤契约详见 assets/skins/standard.js 顶部注释。
   ========================================================================== */
(function () {
  'use strict';

  var PAGE_SIZE = 100;
  var FALLBACK_TITLE = 'Exam Vocabulary';

  /* 页号标签：目录页号与页签名共用这一个格式（P001）。
     ⚠️ 'P' 前缀是**有意偏离本体** —— 本体目录页号是 001（无 P）。
     要退回与本体完全一致，把这里的 'P' + 去掉即可，两处同时生效。 */
  function pageLabel(n) { return 'P' + String(n).padStart(3, '0'); }

  /* ===== 考试色板 =====
     本体里五个卡组各有一张写死了考试徽章颜色的模板；工具读不到模板，
     改成按**卡组名**派生（GET /v1/decks/<id> 有 name）。配色取自那五张模板。 */
  var EXAM_THEMES = {
    junior:   { text: '初中',    acc: '#ea8a1e', acc2: '#f5b348', soft: '#fff7ea', deep: '#9a5410', ink: '#8a4a0e',
                line: 'rgba(234,138,30,.34)', sh: 'rgba(234,138,30,.34)' },
    senior:   { text: '高中',    acc: '#0e8074', acc2: '#28a394', soft: '#eafaf7', deep: '#0b5d54', ink: '#0d5f57',
                line: 'rgba(14,128,116,.30)', sh: 'rgba(14,128,116,.32)' },
    cet4:     { text: 'CET-4',  acc: '#2d5bd1', acc2: '#5b7ff0', soft: '#eef3ff', deep: '#1f3f9e', ink: '#22386f',
                line: 'rgba(45,91,209,.30)', sh: 'rgba(45,91,209,.34)' },
    cet6:     { text: 'CET-6',  acc: '#7c4dbc', acc2: '#a273dc', soft: '#f6f1fd', deep: '#5b3390', ink: '#4f2e7d',
                line: 'rgba(124,77,188,.30)', sh: 'rgba(124,77,188,.34)' },
    postgrad: { text: '考研',    acc: '#a13a4e', acc2: '#c85b70', soft: '#fdf1f3', deep: '#7a2537', ink: '#7a2a3b',
                line: 'rgba(161,58,78,.30)', sh: 'rgba(161,58,78,.34)' },
    other:    { text: 'VOCAB',  acc: '#0f766e', acc2: '#14b8a6', soft: '#ecfdf5', deep: '#115e59', ink: '#115e59',
                line: 'rgba(15,118,110,.30)', sh: 'rgba(15,118,110,.32)' }
  };
  function deriveExam(name) {
    var n = String(name || '');
    if (n.indexOf('初中') >= 0) return EXAM_THEMES.junior;
    if (n.indexOf('高中') >= 0) return EXAM_THEMES.senior;
    if (/四级|CET-?4/i.test(n)) return EXAM_THEMES.cet4;
    if (/六级|CET-?6/i.test(n)) return EXAM_THEMES.cet6;
    if (/考研|研究生/.test(n)) return EXAM_THEMES.postgrad;
    return EXAM_THEMES.other;
  }

  /* 皮肤注册顺序 = 下拉里的顺序 */
  var SKIN_ORDER = ['standard', 'journal', 'space'];
  function skinList() {
    return SKIN_ORDER.map(function (id) { return window.EXAM_SKINS && window.EXAM_SKINS[id]; })
      .filter(Boolean);
  }
  function currentSkin() {
    var s = window.EXAM_SKINS || {};
    return s[state.skin] || s[SKIN_ORDER[0]] || null;
  }

  var state = {
    deckId: cardAPI.deckId,
    userId: cardAPI.userId,
    deckName: '',
    badge: EXAM_THEMES.other,
    info: { total_words: 0, unknown_count: 0 },
    totalPages: 0,
    markedPages: 0,
    cards: {},                /* pageNum -> [card] */
    tabs: [],                 /* [{id:'s1', type:'study', title:'P001', pageNum:1}] */
    activeTab: 'catalogue',
    enteredPages: {},         /* 首次进入的页才套 .enter 包装 */
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'standard',
    fontSize: 1,
    soundEnabled: true        /* 结课确认时的成功音效开关（键与本体相同：dc-sound） */
  };
  try { state.skin = localStorage.getItem('dc-exam-skin') || 'standard'; } catch (e) {}
  try { state.fontSize = parseFloat(localStorage.getItem('dc-exam-font')) || 1; } catch (e) {}
  try { state.soundEnabled = localStorage.getItem('dc-sound') !== '0'; } catch (e) {}

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function icon(cls) { return '<i class="' + cls + '"></i>'; }

  /* 释义归一化：库里可能是 JSON 字符串（'["a","b"]'）也可能是真数组。
     一律返回 string[]，由皮肤决定怎么排版（每条一行）。 */
  function senses(raw) {
    if (raw == null || raw === '') return [];
    if (Object.prototype.toString.call(raw) === '[object Array]') {
      return raw.map(function (x) { return String(x); });
    }
    var s = String(raw).trim();
    if (s.charAt(0) === '[') {
      try {
        var a = JSON.parse(s);
        if (Object.prototype.toString.call(a) === '[object Array]') {
          return a.map(function (x) { return String(x); });
        }
      } catch (e) {}
    }
    return [s];
  }

  /* 例句里把目标词标出来（原版 t43 的 `.sc-log-en .hl` 就是这个）。
     步骤很关键：**先转义，再包 span** —— 反过来会把 span 也转义掉。
     词形变化一并命中（\b(word\w*)），所以 abandon 能标出 abandonment。 */
  function hl(sentence, word) {
    var safe = esc(sentence);
    var w = esc(word).trim();
    if (!w) return safe;
    var pattern = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return safe.replace(new RegExp('\\b(' + pattern + '\\w*)', 'gi'), '<span class="hl">$1</span>');
    } catch (e) {
      return safe;
    }
  }

  /* COCA 排名文案（原版 t43 的 cocaText）：前 1000 名说 TOP，其余给 #N。
     `#` 不能丢 —— 数字裸着写读者会以为是词频而不是排名。 */
  function cocaText(rank) {
    var n = parseInt(rank, 10);
    if (!n || n <= 0) return '';
    return n <= 1000 ? 'COCA TOP ' + n : 'COCA #' + n;
  }

  /* ===== toast（本体那套） ===== */
  var _toastTimer = null;
  function showToast(msg, isError) {
    var el = $id('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(_toastTimer);
    /* 2500ms = 本体 showToast 的时长 */
    _toastTimer = setTimeout(function () { el.className = 'toast' + (isError ? ' error' : ''); }, 2500);
  }

  /* ===== 成功音效（照抄本体 static/app.js 的 audioFeedback） ===== */
  var audioFeedback = (function () {
    var ctx = null;
    function ac() {
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
      return ctx;
    }
    return {
      playSuccess: function () {
        if (state.soundEnabled === false) return;
        var c = ac(); if (!c) return;
        try {
          var o = c.createOscillator(), g = c.createGain();
          o.type = 'sine'; o.frequency.value = 660;
          g.gain.setValueAtTime(0.0001, c.currentTime);
          g.gain.exponentialRampToValueAtTime(0.15, c.currentTime + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18);
          o.connect(g); g.connect(c.destination);
          o.start(); o.stop(c.currentTime + 0.2);
        } catch (e) {}
      }
    };
  })();

  /* ===== 结课弹窗（照抄本体 showFinishModal） =====
     点侧栏页签的 × **不再直接关页签**，先弹确认框：显示本页「总计 / 未掌握」张数，
     Keep studying 什么都不做，Finish 才真的关。
     ⚠️ 别把 × 改回"直接关"——那是旧行为，用户报过「关闭 tab 页的弹窗没了」。 */
  function showModal(id) { var el = $id(id + '-modal'); if (el) el.style.display = 'flex'; }
  function hideModal(id) { var el = $id(id + '-modal'); if (el) el.style.display = 'none'; }
  function showFinishModal(tabId) {
    state._closingTabId = tabId;
    var pageNum = parseInt(tabId.slice(1), 10);
    var cards = state.cards[pageNum] || [];
    var total = cards.length;
    var marked = cards.filter(function (c) { return c.is_unknown === 1; }).length;
    var totalEl = $id('finish-total'), markedEl = $id('finish-marked');
    if (totalEl) totalEl.textContent = total;
    if (markedEl) markedEl.textContent = marked;
    var subtitle = $id('finish-subtitle');
    if (subtitle) subtitle.textContent = pageLabel(pageNum) + ' - Review your progress';
    showModal('finish');
  }

  /* ===== 自绘 tooltip（照抄本体的 [data-tooltip] 委托） ===== */
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

  /* ===== 音色（照抄本体的 voiceMgr，lang 恒为 en） ===== */
  var voiceMgr = {
    voices: [],
    _currentLang: 'en',
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
    sampleText: function (lang) {
      var samples = { en: 'Hello world', zh: '你好世界', ja: 'こんにちは世界' };
      return samples[this._primary(lang)] || 'Hello world';
    },
    speak: function (text, lang) {
      if (!('speechSynthesis' in window)) return;
      var u = new SpeechSynthesisUtterance(text || '');
      var voice = this.pickVoice(lang || 'en');
      if (voice) u.voice = voice;
      else if (lang) u.lang = lang;
      try {
        /* Chrome/Safari：同步 cancel() + speak() 会把这句话丢掉（一直 pending → 没声音）。
           先 cancel，下一拍再 speak，并 resume 一下引擎。 */
        window.speechSynthesis.cancel();
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        setTimeout(function () { window.speechSynthesis.speak(u); }, 80);
      } catch (e) {}
    },
    /* 试听时优先念当前页第一张卡的词，没有就念 Hello world */
    firstCardWord: function (cb) {
      var pn = currentStudyPageNum();
      var cards = (pn != null && state.cards[pn]) || [];
      var w = cards[0] && cards[0].data && cards[0].data.word;
      cb(w || null);
    }
  };

  function renderVoiceDropdown() {
    var list = $('.voice-list');
    if (!list) return;
    list.innerHTML = '';
    var lang = voiceMgr._currentLang;
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === lang; });
    var pick = voiceMgr.pickVoice(lang);
    var activeUri = pick ? pick.voiceURI : null;

    if (!voices.length) {
      var empty = document.createElement('div');
      empty.className = 'voice-option muted';
      empty.textContent = 'No system voices found. Click to test the default.';
      empty.style.cursor = 'pointer';
      empty.addEventListener('click', function () {
        voiceMgr.saveVoice(lang, null);
        voiceMgr.speak(voiceMgr.sampleText(lang), lang);
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

  /* ===== 皮肤切换 ===== */
  function applyStyle() {
    document.body.dataset.skin = state.skin;
    try { localStorage.setItem('dc-exam-skin', state.skin); } catch (e) {}
    renderStyleList();
    /* 已渲染过的页要按新皮肤重画（换皮肤不动数据，只换外观） */
    rerenderAllPages();
  }
  function rerenderAllPages() {
    state.tabs.filter(function (t) { return t.type === 'study'; })
      .forEach(function (t) { renderStudyPage(t.pageNum); });
  }
  function renderStyleList() {
    var list = $id('style-list');
    if (!list) return;
    list.innerHTML = skinList().map(function (s) {
      return '<div class="skin-option' + (state.skin === s.id ? ' active' : '') +
        '" data-style="' + s.id + '">' + icon('fa-solid ' + s.icon) +
        '<span>' + esc(s.name) + '</span></div>';
    }).join('');
  }

  /* ===== 字体大小（只缩放卡内容，不动卡盒） ===== */
  function applyCardFont() {
    document.documentElement.style.setProperty('--card-font-scale', String(state.fontSize));
    var v = $id('font-size-value');
    if (v) v.textContent = Math.round(state.fontSize * 100) + '%';
    try { localStorage.setItem('dc-exam-font', state.fontSize); } catch (e) {}
  }

  /* ===== 数据 ===== */
  /* 卡组名：工具读得到（GET /v1/decks/<id> → {deck:{name}}），
     标题与考试徽章都从它派生 —— 所以同一份 zip 绑到五个卡组各显各的。 */
  function loadDeck() {
    if (!state.deckId) return Promise.resolve();
    return fetch('/v1/decks/' + state.deckId)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var name = j && j.deck && j.deck.name;
        if (!name) return;
        state.deckName = name;
        state.badge = deriveExam(name);
        applyDeckTitle();
      })
      .catch(function () {});
  }
  function applyDeckTitle() {
    var title = state.deckName || FALLBACK_TITLE;
    var el = $id('study-deck-title');
    if (el) el.textContent = title;
    document.title = title;
  }
  function loadInfo() {
    if (!state.userId || !state.deckId) return Promise.resolve();
    return fetch('/v1/learn/info?user_id=' + state.userId + '&deck_id=' + state.deckId)
      .then(function (r) { return r.json(); })
      .then(function (d) { state.info = d; state.totalPages = Math.ceil(d.total_words / PAGE_SIZE) || 0; })
      .then(function () {
        return fetch('/v1/learn/page_status?user_id=' + state.userId + '&deck_id=' + state.deckId)
          .then(function (r) { return r.json(); })
          .then(function (d) { state.markedPages = d.marked_pages_count || 0; })
          .catch(function () {});
      })
      .then(function () { renderCatalogue(); updateStatsText(); });
  }
  function updateStatsText() {
    var el = $('#refresh-stats span');
    if (el) el.textContent = state.info.unknown_count + ' / ' + state.info.total_words;
  }
  function loadPage(pageNum) {
    if (state.cards[pageNum]) return Promise.resolve(state.cards[pageNum]);
    return cardAPI.getPage(pageNum, PAGE_SIZE).then(function (d) {
      state.cards[pageNum] = (d.cards || []).map(function (c) {
        c._pageNum = pageNum;
        c._showDef = false;
        if (c.data && c.data.examples) c.data.examples.forEach(function (e) { e._show = false; });
        return c;
      });
      if (d.total) state.info.total_words = d.total;
      return state.cards[pageNum];
    });
  }

  /* ===== 卡片渲染：把卡片交给当前皮肤（皮肤契约见 skins/standard.js 顶部） ===== */
  function renderCard(card) {
    var skin = currentSkin();
    if (!skin) return '';
    var marked = card.is_unknown === 1;
    var peek = card._showDef === true;
    return skin.render(card, {
      /* badge = 徽章文案 + 整套考试配色。皮肤只认 env.badge.text 与 env.badge.theme.*，
         换卡组时只换这一个对象，皮肤代码一行不用动。 */
      badge: { text: state.badge.text, theme: state.badge },
      marked: marked,
      fav: card.is_favorite === 1,
      peek: peek,
      showEn: marked || peek,   /* 未标记时中英都藏；标记后露英文释义 */
      showZh: peek,             /* 点眼睛才露中文，5 秒后收回 */
      esc: esc,
      senses: senses,
      hl: hl,
      cocaText: cocaText,
      icon: icon
    });
  }

  /* ===== 目录 ===== */
  function renderCatalogue() {
    var grid = $id('catalogue-grid');
    if (!grid) return;
    if (!state.totalPages) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No data in this deck yet.</div>';
      return;
    }
    var html = '';
    for (var i = 1; i <= state.totalPages; i++) {
      var marked = i <= state.markedPages;
      html += '<button class="page-btn ' + (marked ? 'marked' : 'mastered') + '" data-page="' + i + '">' + pageLabel(i) + '</button>';
    }
    grid.innerHTML = html;
  }

  /* ===== 页签 ===== */
  function renderTabs() {
    var container = $id('study-tabs-container');
    if (!container) return;
    var studyTabs = state.tabs.filter(function (t) { return t.type === 'study'; }).map(function (t) {
      var isActive = state.activeTab === t.id;
      var isReview = t.pageNum > state.markedPages;
      var tabClass = isReview ? 'review-tab' : 'study-tab';
      return '<div class="tab-item ' + tabClass + ' ' + (isActive ? 'active' : '') + '" data-tab="' + t.id + '">' +
        '<span>' + t.title + '</span>' +
        '<button class="tab-close-btn" data-tab-id="' + t.id + '" data-tooltip="Finish this page">&times;</button>' +
        '</div>';
    }).join('');
    container.innerHTML = studyTabs;
    var brandBtn = $id('sidebar-home-btn');
    if (brandBtn) brandBtn.classList.toggle('active', state.activeTab === 'catalogue');
  }
  function openPage(n) {
    var existing = state.tabs.find(function (t) { return t.type === 'study' && t.pageNum === n; });
    if (existing) {
      var tabEl = document.querySelector('[data-tab="' + existing.id + '"]');
      if (tabEl) {
        tabEl.classList.add('shake');
        setTimeout(function () { tabEl.classList.remove('shake'); }, 300);
      }
      return;
    }
    state.tabs.push({ id: 's' + n, type: 'study', title: pageLabel(n), pageNum: n });
    state.tabs.sort(function (a, b) { return a.pageNum - b.pageNum; });
    saveOpenTabs();
    renderTabs();
    renderStudyPages();
  }
  function closeTab(id) {
    state.tabs = state.tabs.filter(function (t) { return t.id !== id; });
    saveOpenTabs();
    if (state.activeTab === id) state.activeTab = 'catalogue';
    renderTabs();
    renderStudyPages();
    renderContent();
  }
  function setActiveTab(id) {
    state.activeTab = id;
    renderTabs();
    renderContent();
    if (id.charAt(0) === 's') {
      var pageNum = parseInt(id.slice(1));
      loadPage(pageNum).then(function () { renderStudyPage(pageNum); });
    }
  }
  function saveOpenTabs() {
    if (!state.deckId) return;
    try {
      localStorage.setItem('dc-open-tabs-' + state.deckId, JSON.stringify(
        state.tabs.filter(function (t) { return t.type === 'study'; }).map(function (t) { return t.pageNum; })
      ));
    } catch (e) {}
  }
  function restoreOpenTabs() {
    if (!state.deckId) return;
    var saved = null;
    try { saved = localStorage.getItem('dc-open-tabs-' + state.deckId); } catch (e) {}
    if (!saved) return;
    try {
      JSON.parse(saved).forEach(function (n) {
        if (!state.tabs.find(function (t) { return t.type === 'study' && t.pageNum === n; })) {
          state.tabs.push({ id: 's' + n, type: 'study', title: pageLabel(n), pageNum: n });
        }
      });
      state.tabs.sort(function (a, b) { return a.pageNum - b.pageNum; });
    } catch (e) {}
  }

  /* ===== 页容器 ===== */
  function renderStudyPages() {
    var container = $id('study-pages-container');
    if (!container) return;
    var existing = {};
    $all('.study-page', container).forEach(function (el) { existing[el.dataset.tabId] = el; });
    var tabs = state.tabs.filter(function (t) { return t.type === 'study'; });
    var html = '';
    tabs.forEach(function (t) {
      if (existing[t.id]) {
        existing[t.id].style.display = state.activeTab === t.id ? 'block' : 'none';
      } else {
        html += '<div class="study-page" data-tab-id="' + t.id + '" style="display:' + (state.activeTab === t.id ? 'block' : 'none') + '"><div id="study-' + t.pageNum + '"></div></div>';
      }
    });
    Object.keys(existing).forEach(function (id) {
      if (!tabs.find(function (t) { return t.id === id; })) existing[id].remove();
    });
    if (html) container.insertAdjacentHTML('beforeend', html);
    if (state.activeTab && state.activeTab.charAt(0) === 's') {
      var pageNum = parseInt(state.activeTab.slice(1));
      loadPage(pageNum).then(function () { renderStudyPage(pageNum); });
    }
  }
  function renderContent() {
    var catalogue = $id('catalogue-view');
    var pages = $all('.study-page');
    if (state.activeTab === 'catalogue') {
      if (catalogue) catalogue.style.display = 'block';
      pages.forEach(function (el) { el.style.display = 'none'; });
    } else {
      if (catalogue) catalogue.style.display = 'none';
      pages.forEach(function (el) { el.style.display = el.dataset.tabId === state.activeTab ? 'block' : 'none'; });
    }
  }
  function renderStudyPage(pageNum) {
    var container = $id('study-' + pageNum);
    if (!container) return;
    var cards = state.cards[pageNum] || [];
    if (!cards.length) {
      container.innerHTML = '<div class="empty-state">No cards on this page.</div>';
      return;
    }
    if (state.singleCardMode && pageNum === currentStudyPageNum()) {
      renderSingleCardStage(pageNum);
      return;
    }
    var firstEnter = !state.enteredPages[pageNum];
    if (firstEnter) state.enteredPages[pageNum] = true;
    var out = [];
    cards.forEach(function (card, idx) {
      if (firstEnter) out.push('<div class="enter" style="animation-delay:' + (idx * 28) + 'ms;">');
      out.push(renderCard(card));
      if (firstEnter) out.push('</div>');
    });
    container.innerHTML = out.join('');
  }

  /* ===== 单卡模式（作用域＝当前页，本体同款） ===== */
  function currentStudyPageNum() {
    if (state.activeTab && state.activeTab.charAt(0) === 's') {
      var n = parseInt(state.activeTab.slice(1));
      return isNaN(n) ? null : n;
    }
    return null;
  }
  function toggleSingleCardMode() {
    var pn = currentStudyPageNum();
    if (pn == null) { showToast('Open a page first', true); return; }
    state.singleCardMode = !state.singleCardMode;
    var btn = $id('card-view-btn');
    if (btn) btn.classList.toggle('active', state.singleCardMode);
    if (state.singleCardMode) {
      state.singleCardIndex = 0;
      var cards = state.cards[pn] || [];
      if (!cards.length) loadPage(pn).then(function () { renderSingleCardStage(pn); });
      else renderSingleCardStage(pn);
    } else {
      renderStudyPage(pn);
    }
  }
  function renderSingleCardStage(pageNum) {
    var container = $id('study-' + pageNum);
    if (!container) return;
    var cards = state.cards[pageNum] || [];
    if (!cards.length) {
      container.innerHTML = '<div class="empty-state">No cards on this page.</div>';
      return;
    }
    var prevSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
    var nextSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    container.innerHTML =
      '<div class="single-card-stage">' +
        '<div class="sc-main">' +
          '<div class="sc-card-wrap" id="sc-card-wrap"></div>' +
        '</div>' +
        '<div class="sc-nav-col">' +
          '<button class="sc-nav sc-prev" data-sc="prev" data-tooltip="Previous card" aria-label="Previous card">' + prevSvg + '</button>' +
          '<div class="sc-progress"><span id="sc-idx">1</span> / ' + cards.length + '</div>' +
          '<button class="sc-nav sc-next" data-sc="next" data-tooltip="Next card" aria-label="Next card">' + nextSvg + '</button>' +
        '</div>' +
      '</div>';
    renderSingleCardContent(pageNum, state.singleCardIndex, false);
  }
  function renderSingleCardContent(pageNum, idx, animate) {
    var cards = state.cards[pageNum] || [];
    if (!cards.length) return;
    if (idx < 0) idx = cards.length - 1;
    if (idx >= cards.length) idx = 0;
    state.singleCardIndex = idx;
    var wrap = $id('sc-card-wrap');
    if (!wrap) return;
    var card = cards[idx];
    wrap.innerHTML = renderCard(card);
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
    var pn = currentStudyPageNum();
    if (pn == null) return;
    var cards = state.cards[pn] || [];
    if (!cards.length) return;
    var newIdx = state.singleCardIndex + delta;
    if (newIdx < 0) newIdx = cards.length - 1;
    if (newIdx >= cards.length) newIdx = 0;
    renderSingleCardContent(pn, newIdx, true);
  }
  function exitSingleCardMode() {
    if (!state.singleCardMode) return;
    state.singleCardMode = false;
    var btn = $id('card-view-btn');
    if (btn) btn.classList.remove('active');
    var pn = currentStudyPageNum();
    if (pn != null) renderStudyPage(pn);
  }

  /* ===== 卡片交互 ===== */
  function findCardById(id) {
    var keys = Object.keys(state.cards);
    for (var i = 0; i < keys.length; i++) {
      var arr = state.cards[keys[i]];
      for (var j = 0; j < arr.length; j++) if (String(arr[j].id) === String(id)) return arr[j];
    }
    return null;
  }
  function rerenderCurrent() {
    if (state.singleCardMode) renderSingleCardContent(currentStudyPageNum(), state.singleCardIndex, false);
    else {
      var pn = currentStudyPageNum();
      if (pn != null) renderStudyPage(pn);
    }
  }
  function handleToggleDef(card) {
    cardAPI.track('definition_view', card.id);
    if (card._showDef) { clearTimeout(card._defTimer); card._showDef = false; }
    else {
      card._showDef = true;
      clearTimeout(card._defTimer);
      card._defTimer = setTimeout(function () { card._showDef = false; rerenderCurrent(); }, 5000);
    }
    rerenderCurrent();
  }
  function handleMark(card) {
    var want = card.is_unknown === 1 ? 0 : 1;
    cardAPI.mark(card.id, want).then(function (d) {
      card.is_unknown = (d && typeof d.is_unknown !== 'undefined') ? d.is_unknown : want;
      cardAPI.track('word_mark', card.id);
      loadInfo().then(renderTabs).catch(function () {});
      rerenderCurrent();
    });
  }
  function handleFavorite(card) {
    var want = card.is_favorite === 1 ? 0 : 1;
    cardAPI.favorite(card.id, want).then(function (d) {
      card.is_favorite = (d && typeof d.is_favorite !== 'undefined') ? d.is_favorite : want;
      cardAPI.track('favorite_toggle', card.id);
      rerenderCurrent();
    });
  }
  function handleExampleToggle(card, idx) {
    var ex = card.data && card.data.examples && card.data.examples[idx];
    if (!ex) return;
    cardAPI.track('example_view', card.id);
    if (ex._show) { clearTimeout(ex._timer); ex._show = false; }
    else {
      ex._show = true;
      clearTimeout(ex._timer);
      ex._timer = setTimeout(function () { ex._show = false; rerenderCurrent(); }, 5000);
    }
    rerenderCurrent();
  }

  /* ===== 事件委托（一处绑完，重渲染不用重绑） ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 卡片动作按钮（play / toggle-def / mark / favorite / toggle-ex） */
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl = actionBtn.closest('[data-card-id]');
        var card = cardEl ? findCardById(cardEl.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          if (action === 'play') {
            voiceMgr.speak(card.data && card.data.word, 'en');
            cardAPI.track('audio_play', card.id);
          } else if (action === 'toggle-def') handleToggleDef(card);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
          else if (action === 'toggle-ex') handleExampleToggle(card, parseInt(actionBtn.dataset.exIdx, 10));
        }
        return;
      }
      /* 单卡导航 */
      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

      /* 目录页号 → 开一个页签（本体就是只开、不切） */
      var pageBtn = target.closest('.page-btn');
      if (pageBtn) {
        var n = parseInt(pageBtn.dataset.page, 10);
        var already = state.tabs.find(function (t) { return t.type === 'study' && t.pageNum === n; });
        if (already) {
          var el = document.querySelector('[data-tab="' + already.id + '"]');
          if (el) { el.classList.add('shake'); setTimeout(function () { el.classList.remove('shake'); }, 300); }
        } else {
          openPage(n);
        }
        return;
      }
      /* 页签点击 */
      if (target.closest('.tab-item') && !target.closest('.tab-close-btn')) {
        var tabId = target.closest('.tab-item').dataset.tab;
        if (state.activeTab === tabId) {
          var tabEl = target.closest('.tab-item');
          tabEl.classList.add('shake');
          setTimeout(function () { tabEl.classList.remove('shake'); }, 300);
        } else {
          setActiveTab(tabId);
        }
        return;
      }
      /* 页签 ×：先弹结课确认框（本体同款），确认了才真关 */
      var closeBtn = target.closest('.tab-close-btn');
      if (closeBtn) { showFinishModal(closeBtn.dataset.tabId); return; }

      /* 结课弹窗：取消 / 确认 */
      if (target.closest('#modal-finish-cancel')) { hideModal('finish'); return; }
      if (target.closest('#modal-finish-confirm')) {
        hideModal('finish');
        audioFeedback.playSuccess();
        closeTab(state._closingTabId);
        loadInfo();
        return;
      }

      /* 回目录 */
      if (target.closest('#sidebar-home-btn')) { setActiveTab('catalogue'); return; }

      /* 皮肤下拉 */
      if (target.closest('#style-btn')) {
        var dd = $id('style-dropdown');
        renderStyleList();
        dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        return;
      }
      var styleOpt = target.closest('[data-style]');
      if (styleOpt) {
        state.skin = styleOpt.dataset.style;
        applyStyle();
        $id('style-dropdown').style.display = 'none';
        showToast('Skin: ' + (currentSkin() ? currentSkin().name : state.skin));
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
        voiceMgr.saveVoice('en', picked);
        renderVoiceDropdown();
        $('.voice-dropdown').style.display = 'none';
        voiceMgr.speak(voiceMgr.sampleText('en'), 'en');
        return;
      }

      /* 字体抽屉 */
      if (target.closest('#font-settings-btn')) {
        var drawer = $id('font-drawer');
        var btn = target.closest('#font-settings-btn');
        var r = btn.getBoundingClientRect();
        drawer.style.top = (r.bottom + 8) + 'px';
        drawer.style.left = (r.left + r.width / 2) + 'px';
        drawer.style.transform = 'translateX(-50%)';
        drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
        return;
      }
      if (target.closest('#font-size-minus')) { state.fontSize = Math.max(0.8, Math.round((state.fontSize - 0.1) * 10) / 10); applyCardFont(); return; }
      if (target.closest('#font-size-plus')) { state.fontSize = Math.min(1.8, Math.round((state.fontSize + 0.1) * 10) / 10); applyCardFont(); return; }
      if (target.closest('#reset-fonts')) { state.fontSize = 1; applyCardFont(); return; }

      /* 刷新统计（本体同款：1 秒锁 + **明确弹一句 toast**）。
         以前这里只是静默 loadInfo，数字本来就没变，用户点了完全看不出发生过什么，
         被当成「刷新按钮点击无反应」。 */
      if (target.closest('#refresh-stats')) {
        if (!state._refreshLock) {
          state._refreshLock = true;
          loadInfo().then(function () { renderTabs(); });
          showToast('Stats refreshed');
          setTimeout(function () { state._refreshLock = false; }, 1000);
        }
        return;
      }

      /* 单卡开关 */
      if (target.closest('#card-view-btn')) { toggleSingleCardMode(); return; }

      /* 滚动 */
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

    /* 键盘：单卡模式下 ←/→/空格 翻卡，Esc 退出（本体同款） */
    document.addEventListener('keydown', function (e) {
      if (!state.singleCardMode) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); singleCardNav(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); singleCardNav(1); }
      else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); singleCardNav(1); }
      else if (e.key === 'Escape') { e.preventDefault(); exitSingleCardMode(); }
    });
    /* ⚠️ 这里**不要**再挂"滚动就关掉音色下拉"的监听：本体滚动时只 hideTip()（关 tooltip），
       不关下拉。以前多挂了这一条，于是滚轮一动（哪怕只是在下拉列表内部滚）下拉立刻消失
       —— 用户报的「选择声音的下拉框，滑动鼠标就消失了」。*/
  }

  /* ===== 初始化 ===== */
  function init() {
    if (!skinList().length) {
      /* 皮肤脚本没加载出来（zip 不完整）—— 至少别白屏 */
      var grid0 = $id('catalogue-grid');
      if (grid0) grid0.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Skin files missing in this package.</div>';
      return;
    }
    if (!window.EXAM_SKINS[state.skin]) state.skin = SKIN_ORDER[0];
    applyCardFont();
    initTooltip();
    voiceMgr.init();
    bindEvents();
    applyDeckTitle();
    applyStyle();

    /* 卡组名先到就先显示；数据随后 */
    loadDeck()
      .then(loadInfo)
      .then(function () {
        restoreOpenTabs();
        renderTabs();
        renderStudyPages();
        renderContent();
      })
      .catch(function () {
        var grid = $id('catalogue-grid');
        if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Failed to load deck data.</div>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
