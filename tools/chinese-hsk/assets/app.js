/* ==========================================================================
   HSK 分级词表 · 小工具（HSK 3.0；全量 11105 词 / 免费示例 1011 词）
   --------------------------------------------------------------------------
   首页 = 目录 + 列表（与 COCA 词卡、与本体学习视图同一套骨架）：
     · 侧栏页签「按需打开」：点目录页号只开一个 P001，再点页签才进入（本体两步）
     · 页签可关闭（hover 浮出 ×，先弹结课确认框）、按页号排序、重新打开会恢复
     · 品牌按钮 = 回目录
     · 目录页号：左脊 = 该页主等级（HSK 1–6 / 7–9），底色 = 学习状态
       （这页有未掌握 = 黄，其余 = 青）；112 页（11105 词 ÷ 100）
     · 单卡模式作用域 = 当前页（不是整个卡组），0↔末循环，←/→/空格/Esc
     · 搜索 = 顶栏搜索框，去声调的拼音也能搜（"ai" 命中 "ài"）；
       有搜索词时目录区换成结果列表（50 张/页）
     · 音色 / 字号 / 皮肤下拉、自绘 tooltip、toast

   ⚠️ 大卡组纪律：数据一次分块拉全（2000/块），但 DOM 任何时刻只渲染一页
     （目录只画页号、列表 100 张卡），绝不把 11105 张卡塞进 DOM。
   宿主 getPage 按 current_order（队列序）返回，工具按 item_order 排回原始序。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || 'HSK 分级词表';
  var VOICE_ZH = 'zh-CN';
  var VOICE_EN = 'en-US';
  var PAGE_SIZE = 100;       /* 一页 = 目录上的一个页号（与宿主 Config.PAGE_SIZE 一致） */
  var CHUNK = 2000;          /* 拉数据的块大小 */
  var RESULT_PAGE = 50;      /* 搜索结果每页张数 */
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
    q: '',
    resultPage: 1,
    tabs: [],                 /* [{id:'s1', type:'study', title:'P001', pageNum:1}] */
    activeTab: 'catalogue',
    enteredPages: {},
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    _pageLv: {},              /* pageNum -> 主等级（惰性算，翻目录时才用） */
    _pageMarked: {},          /* pageNum -> 这页有没有未掌握 */
    _voiceWarned: false,
    _refreshLock: false,
    _searchTimer: null
  };
  try { var ss = localStorage.getItem(LS + 'skin'); if (ss) state.skin = ss; } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem(LS + 'font')) || 1; } catch (e) {}

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
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
  /* 页号标签：目录页号与页签名共用这一个格式（P001）。
     ⚠️ 'P' 前缀与 COCA 工具保持一致（本体目录页号是 001，无 P）。 */
  function pageLabel(n) { return 'P' + String(n).padStart(3, '0'); }

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
    /* 隐藏「变声玩具」音色；若该语言下全是玩具（理论上不会）就退回完整列表，免得下拉空掉 */
    var realVoices = voices.filter(function (v) { return !voiceMgr.isToy(v); });
    if (realVoices.length) voices = realVoices;
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
    try { localStorage.setItem(LS + 'font', String(state.fontSize)); } catch (e) {}
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
        if (d.has_next && page < 80) { page += 1; return step(); }
      });
    }
    return step().then(function () {
      /* 宿主按 current_order（队列序）返回 → 按原始 item_order 排回。
         ⚠️ 只做**相对**排序：库里 item_order 未必从 1 起（HSK 是 6..11110），
         任何「(item_order-1)/页大小」的算术都会错位，分页一律按排序位置算。 */
      state.all.sort(function (a, b) { return (a.item_order || 0) - (b.item_order || 0); });
      state._pageLv = {};
      state._pageMarked = {};
      state.loaded = true;
    });
  }
  function findCard(id) {
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) return state.all[i];
    return null;
  }
  function totalPages() { return Math.max(1, Math.ceil(state.all.length / PAGE_SIZE)); }
  function pageSlice(n) {
    var start = (n - 1) * PAGE_SIZE;
    return state.all.slice(start, start + PAGE_SIZE);
  }
  /* 这一页的主等级（少数越级词不影响：取多数派，平票按 LEVELS 顺序） */
  function pageLevel(n) {
    if (state._pageLv[n] !== undefined) return state._pageLv[n];
    var cards = pageSlice(n), tally = {}, best = '', bestN = 0;
    for (var i = 0; i < cards.length; i++) {
      var lv = levelOf(cards[i].data);
      if (!lv) continue;
      tally[lv] = (tally[lv] || 0) + 1;
      if (tally[lv] > bestN || (tally[lv] === bestN && LEVELS.indexOf(lv) < LEVELS.indexOf(best))) {
        bestN = tally[lv]; best = lv;
      }
    }
    state._pageLv[n] = best;
    return best;
  }
  /* 这一页有没有未掌握的词（目录底色 / 页签颜色都看它） */
  function pageMarked(n) {
    if (state._pageMarked[n] !== undefined) return state._pageMarked[n];
    var cards = pageSlice(n), has = false;
    for (var i = 0; i < cards.length; i++) if (cards[i].is_unknown === 1) { has = true; break; }
    state._pageMarked[n] = has;
    return has;
  }
  function pageUnknownCount(n) {
    var cards = pageSlice(n), n2 = 0;
    for (var i = 0; i < cards.length; i++) if (cards[i].is_unknown === 1) n2++;
    return n2;
  }
  function updateStatsText() {
    var marked = 0;
    for (var i = 0; i < state.all.length; i++) if (state.all[i].is_unknown === 1) marked++;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + state.all.length;
  }
  function filtered() {
    var q = norm(state.q);
    if (!q) return state.all;
    var out = [];
    for (var i = 0; i < state.all.length; i++) {
      var d = state.all[i].data || {};
      var hay = norm(d.word) + '\n' + norm(d.pinyin) + '\n' + norm(d.traditional);
      if (hay.indexOf(q) < 0) continue;
      out.push(state.all[i]);
    }
    return out;
  }

  /* ===== 目录 ===== */
  function renderLegend() {
    var box = $id('cat-legend');
    if (!box) return;
    box.innerHTML = LEVELS.map(function (lv) {
      return '<span class="lg-item"><i class="lg-dot lv-' + lv.replace('-', '') + '"></i>' + esc(LEVEL_NAME[lv]) + '</span>';
    }).join('');
  }
  function renderCatalogue() {
    var grid = $id('catalogue-grid');
    if (!grid) return;
    var searching = !!state.q;
    var results = $id('catalogue-results');
    var bar = $('.cat-bar');
    grid.style.display = searching ? 'none' : '';
    if (results) results.style.display = searching ? '' : 'none';
    if (bar) bar.classList.toggle('searching', searching);

    if (searching) { renderSearchResults(); return; }
    if (!state.loaded) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">正在加载词库…</div>';
      return;
    }
    if (!state.all.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">这个卡组还没有词。</div>';
      return;
    }
    var n = totalPages(), html = '';
    for (var i = 1; i <= n; i++) {
      var lv = pageLevel(i);
      var cls = 'page-btn ' + (lv ? 'lv-' + lv.replace('-', '') + ' ' : '') + (pageMarked(i) ? 'marked' : 'mastered');
      html += '<button class="' + cls + '" data-page="' + i + '" data-tooltip="' +
        pageLabel(i) + ' · ' + (lv ? LEVEL_NAME[lv] : '等级未知') + ' · 未掌握 ' + pageUnknownCount(i) + ' / ' + pageSlice(i).length +
        '">' + pageLabel(i) + '</button>';
    }
    grid.innerHTML = html;
  }
  function renderSearchResults() {
    var box = $id('catalogue-results');
    if (!box) return;
    var list = filtered();
    if (!state.loaded) { box.innerHTML = '<div class="empty-state">正在加载词库…</div>'; return; }
    if (!list.length) { box.innerHTML = '<div class="empty-state">没有匹配的词。</div>'; return; }
    var pages = Math.max(1, Math.ceil(list.length / RESULT_PAGE));
    var p = Math.min(Math.max(1, state.resultPage), pages);
    state.resultPage = p;
    var slice = list.slice((p - 1) * RESULT_PAGE, p * RESULT_PAGE);
    box.innerHTML =
      '<div class="cat-count">命中 <b>' + list.length + '</b> 个词' +
        (pages > 1 ? ' · 第 ' + p + ' / ' + pages + ' 页' : '') + '</div>' +
      '<div class="cat-rows">' + slice.map(function (c) {
        var d = c.data || {};
        return '<button class="rw-row" type="button" data-jump-card="' + c.id + '" data-tooltip="进到它所在的页">' +
          '<span class="rw-word">' + esc(d.word || '') + '</span>' +
          '<span class="rw-py">' + esc(d.pinyin || '') + '</span>' +
          '<span class="rw-lv lv-' + (levelOf(d) || '').replace('-', '') + '">' + esc(LEVEL_NAME[levelOf(d)] || '') + '</span>' +
          '<span class="rw-mark">' + (c.is_unknown === 1 ? '<i class="fa-solid fa-star"></i>' : '') +
            (c.is_favorite === 1 ? '<i class="fa-solid fa-bookmark"></i>' : '') + '</span>' +
          '</button>';
      }).join('') + '</div>' +
      (pages > 1
        ? '<div class="cat-pager">' +
            '<button type="button" data-rpage="prev"' + (p <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>' +
            '<span class="cat-pg">' + p + ' / ' + pages + ' 页</span>' +
            '<button type="button" data-rpage="next"' + (p >= pages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>' +
          '</div>'
        : '');
  }

  /* ===== 页签 ===== */
  function renderTabs() {
    var container = $id('study-tabs-container');
    if (!container) return;
    container.innerHTML = state.tabs.filter(function (t) { return t.type === 'study'; }).map(function (t) {
      var isActive = state.activeTab === t.id;
      var tabClass = pageMarked(t.pageNum) ? 'study-tab' : 'review-tab';
      return '<div class="tab-item ' + tabClass + ' ' + (isActive ? 'active' : '') + '" data-tab="' + t.id + '">' +
        '<span>' + t.title + '</span>' +
        '<button class="tab-close-btn" data-tab-id="' + t.id + '" data-tooltip="结束这一页">&times;</button>' +
        '</div>';
    }).join('');
    var brandBtn = $id('sidebar-home-btn');
    if (brandBtn) brandBtn.classList.toggle('active', state.activeTab === 'catalogue');
  }
  function shakeTab(id) {
    var el = document.querySelector('[data-tab="' + id + '"]');
    if (!el) return;
    el.classList.add('shake');
    setTimeout(function () { el.classList.remove('shake'); }, 300);
  }
  /* ⚠️ 与 COCA 的**有意差异**：那边点目录页号只「开页签」、要再点左侧页签才进入
     （本体是两步）。HSK 有 112 页、目录就是首页，两步会显得「点了没反应」，
     所以这里改成**一下到位**：点页号 = 开页签 + 直接进入；页签留在左侧方便来回切。 */
  function openPage(n) {
    var existing = state.tabs.find(function (t) { return t.type === 'study' && t.pageNum === n; });
    if (existing) {
      if (state.activeTab !== existing.id) setActiveTab(existing.id);
      else shakeTab(existing.id);
      return;
    }
    state.tabs.push({ id: 's' + n, type: 'study', title: pageLabel(n), pageNum: n });
    state.tabs.sort(function (a, b) { return a.pageNum - b.pageNum; });
    saveOpenTabs();
    renderTabs();
    renderStudyPages();
    setActiveTab('s' + n);
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
      /* 走 renderStudyPages 而不是直接 renderStudyPage：前者会补齐缺失的页容器 */
      renderStudyPages();
      var s = $id('study-scroll');
      if (s) s.scrollTop = 0;
    }
  }
  function currentStudyPageNum() {
    if (state.activeTab && state.activeTab.charAt(0) === 's') {
      var n = parseInt(state.activeTab.slice(1), 10);
      return isNaN(n) ? null : n;
    }
    return null;
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
        if (!(n >= 1 && n <= totalPages())) return;
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
        html += '<div class="study-page" data-tab-id="' + t.id + '" style="display:' +
          (state.activeTab === t.id ? 'block' : 'none') + '"><div id="study-' + t.pageNum + '"></div></div>';
      }
    });
    Object.keys(existing).forEach(function (id) {
      if (!tabs.find(function (t) { return t.id === id; })) existing[id].remove();
    });
    if (html) container.insertAdjacentHTML('beforeend', html);
    var pn = currentStudyPageNum();
    if (pn != null) renderStudyPage(pn);
  }
  function renderContent() {
    var catalogue = $id('catalogue-view');
    var pages = $all('.study-page');
    var content = $id('study-content');
    var isCat = state.activeTab === 'catalogue';
    if (catalogue) catalogue.style.display = isCat ? 'block' : 'none';
    pages.forEach(function (el) {
      var on = el.dataset.tabId === state.activeTab;
      el.style.display = on ? 'block' : 'none';
      /* ⚠️ 大卡组纪律：离开的页**卸掉卡片的 DOM**（数据还在 state.all 里，切回来重渲染）。
         不卸的话同时开 10 个页签就是 1000 张卡在 DOM 里。
         ⚠️ 只清内层容器（#study-N）的 html —— 连 .study-page 一起清会把 #study-N 本身
         删掉，切回来时 renderStudyPage 找不到容器就**什么都不渲染**（踩过）。 */
      if (!on && el.firstElementChild) el.firstElementChild.innerHTML = '';
    });
    /* 目录要宽（8 列页号），列表按卡片设计的 620 列宽 */
    if (content) {
      content.classList.toggle('narrow', !isCat && !state.singleCardMode);
      content.classList.toggle('wide', !isCat && state.singleCardMode);
    }
  }
  function renderStudyPage(pageNum) {
    var container = $id('study-' + pageNum);
    if (!container) return;
    var cards = pageSlice(pageNum);
    var content = $id('study-content');
    if (content) {
      content.classList.toggle('narrow', !state.singleCardMode);
      content.classList.toggle('wide', state.singleCardMode);
    }
    if (!cards.length) {
      container.innerHTML = '<div class="empty-state">这一页没有词。</div>';
      return;
    }
    if (state.singleCardMode && pageNum === currentStudyPageNum()) { renderSingleCardStage(pageNum); return; }
    var firstEnter = !state.enteredPages[pageNum];
    if (firstEnter) state.enteredPages[pageNum] = true;
    container.innerHTML = '<div class="hk-cards">' + cards.map(function (card, idx) {
      return renderCard(card, firstEnter ? Math.min(idx * 10, 400) : null);
    }).join('') + '</div>';
  }

  /* ===== 单卡模式（作用域 = 当前页） ===== */
  function toggleSingleCardMode() {
    var pn = currentStudyPageNum();
    if (pn == null) { showToast('先开一页再看单卡', true); return; }
    state.singleCardMode = !state.singleCardMode;
    var btn = $id('card-view-btn');
    if (btn) btn.classList.toggle('active', state.singleCardMode);
    state.singleCardIndex = 0;
    if (state.singleCardMode) renderSingleCardStage(pn);
    else renderStudyPage(pn);
    var content = $id('study-content');
    if (content) {
      content.classList.toggle('narrow', !state.singleCardMode);
      content.classList.toggle('wide', state.singleCardMode);
    }
  }
  function exitSingleCardMode() {
    if (!state.singleCardMode) return;
    state.singleCardMode = false;
    var btn = $id('card-view-btn');
    if (btn) btn.classList.remove('active');
    var pn = currentStudyPageNum();
    if (pn != null) renderStudyPage(pn);
    var content = $id('study-content');
    if (content) { content.classList.add('narrow'); content.classList.remove('wide'); }
  }
  function renderSingleCardStage(pageNum) {
    var container = $id('study-' + pageNum);
    if (!container) return;
    var cards = pageSlice(pageNum);
    if (!cards.length) { container.innerHTML = '<div class="empty-state">这一页没有词。</div>'; return; }
    var prevSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
    var nextSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    container.innerHTML =
      '<div class="single-card-stage">' +
        '<div class="sc-main"><div class="sc-card-wrap" id="sc-card-wrap"></div></div>' +
        '<div class="sc-nav-col">' +
          '<button class="sc-nav sc-prev" data-sc="prev" data-tooltip="上一张" aria-label="上一张">' + prevSvg + '</button>' +
          '<div class="sc-progress"><span id="sc-idx">1</span> / ' + cards.length + '</div>' +
          '<button class="sc-nav sc-next" data-sc="next" data-tooltip="下一张" aria-label="下一张">' + nextSvg + '</button>' +
        '</div>' +
      '</div>';
    renderSingleCardContent(pageNum, state.singleCardIndex, false);
  }
  function renderSingleCardContent(pageNum, idx, animate) {
    var cards = pageSlice(pageNum);
    if (!cards.length) return;
    if (idx < 0) idx = cards.length - 1;
    if (idx >= cards.length) idx = 0;
    state.singleCardIndex = idx;
    var wrap = $id('sc-card-wrap');
    if (!wrap) return;
    wrap.innerHTML = renderCard(cards[idx], null);
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
    renderSingleCardContent(pn, state.singleCardIndex + delta, true);
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
  /* enterDelay 为 null 时不套入场动画 */
  function renderCard(card, enterDelay) {
    var d = card.data || {};
    var lv = levelOf(d);
    var enter = enterDelay == null ? '' : ' enter';
    var style = enterDelay == null ? '' : ' style="animation-delay:' + enterDelay + 'ms"';
    return '<div class="hk-root ' + lvClass(d) + enter + '"' + style + ' data-card-id="' + card.id + '">' +
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

  /* ===== 卡片交互 ===== */
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
  function refreshAfterMark(card) {
    var pn = card._pageNum || null;
    if (pn != null) { delete state._pageMarked[pn]; }
    updateStatsText();
    renderTabs();
    renderCatalogue();
    if (state.singleCardMode) renderSingleCardContent(currentStudyPageNum(), state.singleCardIndex, false);
    else {
      var host = document.querySelector('.study-page[data-tab-id="' + state.activeTab + '"] [data-card-id="' + card.id + '"]');
      if (host) host.outerHTML = renderCard(card, null);
    }
  }
  function handleMark(card) {
    var want = card.is_unknown === 1 ? 0 : 1;
    cardAPI.mark(card.id, want).then(function (d) {
      card.is_unknown = (d && typeof d.is_unknown !== 'undefined') ? d.is_unknown : want;
      cardAPI.track('word_mark', card.id);
      refreshAfterMark(card);
    });
  }
  function handleFavorite(card) {
    var want = card.is_favorite === 1 ? 0 : 1;
    cardAPI.favorite(card.id, want).then(function (d) {
      card.is_favorite = (d && typeof d.is_favorite !== 'undefined') ? d.is_favorite : want;
      cardAPI.track('favorite_toggle', card.id);
      refreshAfterMark(card);
    });
  }

  /* ===== 结课弹窗 ===== */
  function showModal(id) { var el = $id(id + '-modal'); if (el) el.style.display = 'flex'; }
  function hideModal(id) { var el = $id(id + '-modal'); if (el) el.style.display = 'none'; }
  function showFinishModal(tabId) {
    state._closingTabId = tabId;
    var pageNum = parseInt(tabId.slice(1), 10);
    var cards = pageSlice(pageNum);
    var totalEl = $id('finish-total'), markedEl = $id('finish-marked');
    if (totalEl) totalEl.textContent = cards.length;
    if (markedEl) markedEl.textContent = pageUnknownCount(pageNum);
    var sub = $id('finish-subtitle');
    if (sub) sub.textContent = pageLabel(pageNum) + ' · 看看这一页的进度';
    showModal('finish');
  }

  /* ===== 搜索 ===== */
  function applyQuery(v) {
    v = String(v == null ? '' : v).trim();
    if (v === state.q) return;
    state.q = v;
    state.resultPage = 1;
    var clr = $id('hk-search-clear');
    if (clr) clr.style.display = state.q ? '' : 'none';
    renderCatalogue();
    var s = $id('study-scroll');
    if (s) s.scrollTop = 0;
  }
  function onSearchInput(e) {
    var input = e.target;
    clearTimeout(state._searchTimer);
    state._searchTimer = setTimeout(function () { applyQuery(input.value); }, 220);
  }
  /* 从搜索结果跳到它所在的页号（并闪一下那张卡） */
  function jumpToCard(id) {
    var idx = -1;
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) { idx = i; break; }
    if (idx < 0) return;
    if (state.singleCardMode) exitSingleCardMode();
    var pageNum = Math.floor(idx / PAGE_SIZE) + 1;
    openPage(pageNum);
    setActiveTab('s' + pageNum);
    var card = state.all[idx];
    var d = card.data || {};
    warnIfNoVoice();
    /* 跳过去顺带读一遍词 —— 也算一次 audio_play（与词卡上的 🔊 同一口径） */
    cardAPI.track('audio_play', card.id);
    voiceMgr.speak(d.word, VOICE_ZH);
    requestAnimationFrame(function () {
      var el = document.querySelector('.study-page[data-tab-id="s' + pageNum + '"] [data-card-id="' + id + '"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('hk-flash');
      void el.offsetWidth;
      el.classList.add('hk-flash');
      setTimeout(function () { el.classList.remove('hk-flash'); }, 1400);
    });
  }

  /* ===== 事件委托（一处绑完，重渲染不用重绑） ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 搜索结果行 → 跳到它所在的页号 */
      var row = target.closest('[data-jump-card]');
      if (row) { jumpToCard(row.dataset.jumpCard); return; }

      /* 点读（词语 / 英文释义） */
      var sayEl = target.closest('[data-say]');
      if (sayEl) {
        e.stopPropagation();
        var sCardEl = sayEl.closest('[data-card-id]');
        var sCard = sCardEl ? findCard(sCardEl.dataset.cardId) : null;
        if (sCard) playText(sCard, sayEl.dataset.say, sayEl.dataset.sayLang);
        return;
      }
      /* 卡片动作按钮 */
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

      /* 搜索结果翻页 */
      var rp = target.closest('[data-rpage]');
      if (rp && !rp.disabled) {
        state.resultPage += (rp.dataset.rpage === 'next' ? 1 : -1);
        renderCatalogue();
        var sc0 = $id('study-scroll');
        if (sc0) sc0.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      /* 目录页号 → 开一个页签并进入 */
      var pageBtn = target.closest('.page-btn');
      if (pageBtn) { openPage(parseInt(pageBtn.dataset.page, 10)); return; }
      /* 页签点击 */
      if (target.closest('.tab-item') && !target.closest('.tab-close-btn')) {
        var tabId = target.closest('.tab-item').dataset.tab;
        if (state.activeTab === tabId) shakeTab(tabId);
        else setActiveTab(tabId);
        return;
      }
      /* 页签 × → 先弹结课确认框，确认了才真关 */
      var closeBtn = target.closest('.tab-close-btn');
      if (closeBtn) { showFinishModal(closeBtn.dataset.tabId); return; }
      if (target.closest('#modal-finish-cancel')) { hideModal('finish'); return; }
      if (target.closest('#modal-finish-confirm')) {
        hideModal('finish');
        closeTab(state._closingTabId);
        return;
      }
      /* 回目录 */
      if (target.closest('#sidebar-home-btn')) { setActiveTab('catalogue'); return; }
      /* 清空搜索 */
      if (target.closest('#hk-search-clear')) {
        var input = $id('hk-search-input');
        if (input) input.value = '';
        applyQuery('');
        if (input) input.focus();
        return;
      }
      /* 皮肤 */
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
      /* 音色 */
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

      /* 刷新：重拉数据 + 重画目录/列表/统计 */
      if (target.closest('#refresh-stats')) {
        if (!state._refreshLock) {
          state._refreshLock = true;
          state.loaded = false;
          state.enteredPages = {};
          renderCatalogue();
          loadAll().then(function () {
            renderCatalogue(); renderTabs(); renderStudyPages(); renderContent(); updateStatsText();
          });
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
      if (e.target && e.target.id === 'hk-search-input') {
        if (e.key === 'Escape') { e.target.value = ''; applyQuery(''); e.target.blur(); }
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
    var searchInput = $id('hk-search-input');
    if (searchInput) searchInput.addEventListener('input', onSearchInput);

    renderLegend();
    renderCatalogue();
    renderTabs();

    loadAll().then(function () {
      /* 给每张卡记住它属于哪一页（标记后要清那一页的缓存） */
      state.all.forEach(function (c, i) { c._pageNum = Math.floor(i / PAGE_SIZE) + 1; });
      restoreOpenTabs();
      renderCatalogue();
      renderTabs();
      renderStudyPages();
      renderContent();
      updateStatsText();
    }).catch(function () {
      var grid = $id('catalogue-grid');
      if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">卡组数据加载失败。</div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
