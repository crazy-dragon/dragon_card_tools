/* ==========================================================================
   化学元素周期表 · 小工具
   --------------------------------------------------------------------------
   128 张（118 个元素 + 10 张「从大爆炸到元素生成」科普卡），一份数据两种视图：

     table 周期表   真·元素周期表：7 周期 × 18 族的主栅格 + 镧系/锕系两行 ——
                    这是模板做不到的那个东西。按类别上色（同色 = 同族性质），
                    点格子切到卡片视图并定位到该元素。
                    ⚠️ 数据里 15 个镧系 + 15 个锕系的 group 全是 3（真实教材的
                    f 区惯例），所以必须按 category 把它们抽出来、按原子序数排成
                    下方两行；主表 (6,3)/(7,3) 两格放「57–71 / 89–103」占位格。
     card  卡片     118 张元素翻面卡（正面巨符号 / 背面四段详情）+ 10 张科普卡。

   ★ **没有眼睛按钮**：中英文名都是学习内容，始终显示；背面靠翻面揭示。
   ★ 周期表字号只吃工具字号滑杆（--card-font-scale），**不吃 --k**（--k=1.15 是
     "巨符号当主角"的卡片放大倍数，套到 18 列表格上会排不下）。

   ⚠️ 质量字段的显示规则（**原模板的产品决策，必须逐字保留**）：
      · 一律四舍五入取整；Cl 是唯一特例，取 35.5
      · 整数与精确值不同时，括号里附精确值（.cp-exact）
   ⚠️ 动作按钮放在**头部行的右侧**（不是其它工具那种绝对定位右轨）——
     元素卡正面是居中的大符号，右轨会给它挤掉 200px 宽的留白。放进头部行
     既保证「所有卡按钮同一个 x」，也不牺牲内容宽度；科普卡少一个「翻面」，
     用 visibility:hidden 的空槽占位，轨道宽度才不会变。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '元素周期表';
  var VOICE_LANG = TOOL.voiceLang || 'zh';
  var VIEWS = (TOOL.views && TOOL.views.length) ? TOOL.views : [
    { id: 'table', label: '周期表' },
    { id: 'card',  label: '卡片' }
  ];
  var PAGE_SIZE = 500;                    /* 128 张，一次读完（宿主 page_size 没有上限） */

  var SKINS = [
    { id: 'cream', name: '奶油', icon: 'fa-sun' },
    { id: 'glass', name: '墨玻璃', icon: 'fa-moon' },
    { id: 'category', name: '分类彩', icon: 'fa-gem' }
  ];

  /* ===== 周期表的几何常数 ===== */
  var GROUPS = 18, PERIODS = 7;
  var SERIES_LAN = '镧系', SERIES_ACT = '锕系';
  var SERIES_ORDER = [SERIES_LAN, SERIES_ACT];
  /* 栅格行号：1 = 族号表头，2..8 = 周期 1..7，9 = 空隙，10/11 = 镧系/锕系 */
  var ROW_HEAD = 1, ROW_OFFSET = 1, ROW_GAP = 9, ROW_SERIES = 10;
  /* 栅格列号：1 = 周期名，2..19 = 族 1..18；镧系/锕系从族 3 起 → 列 4 起 */
  var COL_OFFSET = 1, COL_SERIES = 4;

  /* 类别 -> 颜色类。颜色写在 cards.css 的 .cp-c-* 上（**不是内联 style**），
     这样各皮肤能整类换色；「（推测）」与基类同色，所以先剥掉后缀再查表。 */
  var CAT_CLASS = {
    '非金属': 'cp-c-nonmetal',
    '稀有气体': 'cp-c-noble',
    '碱金属': 'cp-c-alkali',
    '碱土金属': 'cp-c-alkaline',
    '类金属': 'cp-c-metalloid',
    '后过渡金属': 'cp-c-post',
    '过渡金属': 'cp-c-transition',
    '镧系': 'cp-c-lanthanide',
    '锕系': 'cp-c-actinide',
    '未知': 'cp-c-unknown'
  };
  /* 图例的顺序与中文名（按族分组讲，和学生记周期表的顺序一致） */
  var LEGEND = ['碱金属', '碱土金属', '过渡金属', '后过渡金属', '类金属',
                '非金属', '稀有气体', '镧系', '锕系', '未知'];

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    view: 'table',
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    _voiceWarned: false
  };
  try {
    var savedView = localStorage.getItem('dc-cp-view');
    if (savedView && VIEWS.some(function (v) { return v.id === savedView; })) state.view = savedView;
  } catch (e) {}
  try {
    var savedSkin = localStorage.getItem('dc-cp-skin');
    if (savedSkin) state.skin = savedSkin;
  } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem('dc-cp-font')) || 1; } catch (e) {}

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

  /* ===== 音色（中文朗读；音色键沿用 dc-voice-<lang>，与其它工具/本体一致） ===== */
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
    sampleText: function () { return '氢氦锂铍硼'; },
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

  /* 没有中文 voice 时别静默：默认音色读中文会很怪 */
  function warnIfNoChineseVoice() {
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

  /* ===== 皮肤 ===== */
  function applySkin() {
    var h = document.documentElement;
    SKINS.forEach(function (s) { h.classList.remove('skin-' + s.id); });
    h.classList.add('skin-' + state.skin);
    try { localStorage.setItem('dc-cp-skin', state.skin); } catch (e) {}
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

  /* ===== 字号：只动卡内/格内文字（--card-font-scale），不动卡盒 ===== */
  function applyCardFont() {
    document.documentElement.style.setProperty('--card-font-scale', String(state.fontSize));
    var v = $id('font-size-value');
    if (v) v.textContent = Math.round(state.fontSize * 100) + '%';
    try { localStorage.setItem('dc-cp-font', state.fontSize); } catch (e) {}
  }

  /* ==========================================================================
     数据
     ========================================================================== */
  function catKey(category) {
    return String(category == null ? '' : category).replace(/[（(]推测[）)]/g, '').trim();
  }
  function catClass(category) {
    return CAT_CLASS[catKey(category)] || 'cp-c-unknown';
  }
  function isScience(card) { return (card.data || {}).type === 'science'; }
  function isSeriesCat(cat) { return catKey(cat) === SERIES_LAN || catKey(cat) === SERIES_ACT; }

  /* 相对原子质量：整取 + 括号精确值；Cl 是唯一特例（考试里的 35.5）。
     ⚠️ 这是原模板的产品决策，逐字照搬，别简化。 */
  var MASS_EXCEPTIONS = { Cl: '35.5' };
  function massText(v, symbol) {
    if (v == null || v === '') return '';
    var num = parseFloat(v);
    if (isNaN(num)) return esc(String(v));
    var approx = MASS_EXCEPTIONS[symbol] ? MASS_EXCEPTIONS[symbol] : String(Math.round(num));
    var precise = String(parseFloat(num.toFixed(3)));
    if (parseFloat(precise) === parseFloat(approx)) return esc(approx);
    return esc(approx) + ' <span class="cp-exact">(' + esc(precise) + ')</span>';
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
    var marked = state.all.filter(function (c) { return c.is_unknown === 1; }).length;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + state.all.length;
  }

  /* ==========================================================================
     卡面
     ========================================================================== */
  /* 动作槽位。mode 决定「翻面」那一格长什么样：
       'flip' —— 列表里的元素卡：朗读 / 翻面 / 标记 / 收藏（4 个）
       'void' —— 列表里的科普卡：同上，但翻面格是隐形的。用 visibility 而不是
                 display:none —— 宽度和间距都还在，两种卡的轨道等宽、按钮的 x 一模一样
       'none' —— 弹窗里：正反两面已经铺开，不存在"翻面"这个动作，只留朗读 / 标记 / 收藏 */
  function actsHtml(card, mode) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    var h = '<div class="cp-acts">';
    h += '<button type="button" data-action="play" data-tooltip="朗读"><i class="fa-solid fa-volume-high"></i></button>';
    if (mode === 'flip') {
      h += '<button type="button" data-action="flip" data-tooltip="翻面看详情"><i class="fa-solid fa-rotate"></i></button>';
    } else if (mode === 'void') {
      h += '<button type="button" class="is-void" tabindex="-1" aria-hidden="true"><i class="fa-solid fa-rotate"></i></button>';
    }
    h += '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
      (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>';
    h += '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
      (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>';
    h += '</div>';
    return h;
  }

  /* 正面 / 背面各写成一块，好让「列表卡（套 .cp-flip，3D 翻）」和
     「弹窗卡（摊平，正反同屏）」共用同一份标记 —— 弹窗不是另一套卡面，
     就是不用翻的那张卡。flipClick=true 时整面可点翻面（弹窗里传 false）。 */
  function frontHtml(d, flipClick) {
    var h = '';
    h += '<div class="cp-face cp-front"' + (flipClick ? ' data-act="flipface"' : '') + '>';
    h += '  <div class="cp-top">';
    h += '    <div class="cp-symbol">' + esc(d.symbol) + '</div>';
    h += '    <div>';
    h += '      <div class="cp-name">' + esc(d.name_zh) + '</div>';
    h += '      <div class="cp-name-en">' + esc(d.name_en) + '</div>';
    h += '    </div>';
    h += '  </div>';
    h += '  <div class="cp-meta">';
    if (d.atomic_mass != null && d.atomic_mass !== '') {
      h += '    <div class="cp-mass">相对原子质量 ' + massText(d.atomic_mass, d.symbol) + '</div>';
    }
    if (d.category) h += '    <div class="cp-cat">' + esc(d.category) + '</div>';
    h += '  </div>';
    h += '</div>';
    return h;
  }

  function backHtml(d, flipClick) {
    var h = '';
    h += '<div class="cp-face cp-back"' + (flipClick ? ' data-act="flipface"' : '') + '>';
    h += '  <div class="cp-grp">';
    if (d.phase) h += '    <div class="cp-row"><span class="cp-k">常温状态</span><span>' + esc(d.phase) + '</span></div>';
    if (d.group != null || d.period != null) {
      h += '    <div class="cp-pair">';
      if (d.group != null) h += '<span><span class="pk">族</span><span class="pv">' + esc(d.group) + '</span></span>';
      if (d.period != null) h += '<span><span class="pk">周期</span><span class="pv">' + esc(d.period) + '</span></span>';
      h += '    </div>';
    }
    h += '  </div>';
    h += '  <div class="cp-grp">';
    if (d.discovery) h += '    <div class="cp-row"><span class="cp-k">发现</span><span>' + esc(d.discovery) + '</span></div>';
    if (d.origin) {
      h += '    <div class="cp-origin"><span class="cp-k">宇宙来源</span><span>' + esc(d.origin) + '</span></div>';
    }
    h += '  </div>';
    if (d.fun_fact) h += '  <div class="cp-fun">' + esc(d.fun_fact) + '</div>';
    h += '</div>';
    return h;
  }

  function renderElementCard(card) {
    var d = card.data || {};
    var h = '';
    h += '<div class="cp-root ' + catClass(d.category) + '" data-card-id="' + card.id + '">';
    h += '  <div class="cp-head">';
    h += '    <div class="cp-num">原子序数 ' + esc(d.atomic_number) + '</div>';
    h +=      actsHtml(card, 'flip');
    h += '  </div>';
    h += '  <div class="cp-flip"><div class="cp-inner">';
    h +=      frontHtml(d, true);
    h +=      backHtml(d, true);
    h += '  </div></div>';
    h += '</div>';
    return h;
  }

  /* 弹窗里的元素卡：同一个 .cp-root / .cp-front / .cp-back，差别只有三处 ——
     · 不套 .cp-flip（CSS 在 .cp-modal-root 下把两面 position:static 摊平，正反同屏）
     · 动作是 3 个（没有翻面）
     · 头部多一个关闭按钮 */
  function renderElementModal(card) {
    var d = card.data || {};
    var h = '';
    h += '<div class="cp-root cp-modal-root ' + catClass(d.category) + '" data-card-id="' + card.id + '">';
    h += '  <div class="cp-head">';
    h += '    <div class="cp-num">原子序数 ' + esc(d.atomic_number) + '</div>';
    h +=      actsHtml(card, 'none');
    h += '    <button type="button" class="cp-modal-close" data-act="modal-close" data-tooltip="关闭">' +
      '<i class="fa-solid fa-xmark"></i></button>';
    h += '  </div>';
    h +=      frontHtml(d, false);
    h +=      backHtml(d, false);
    h += '  <div class="cp-modal-foot">';
    h += '    <button type="button" class="cp-modal-jump" data-act="modal-jump">' +
      '<i class="fa-solid fa-list-ul"></i><span class="cp-modal-jump-t">在卡组中查看</span></button>';
    h += '  </div>';
    h += '</div>';
    return h;
  }

  function renderScienceCard(card) {
    var d = card.data || {};
    var h = '';
    h += '<div class="cp-root cp-sci" data-card-id="' + card.id + '">';
    h += '  <div class="cp-head">';
    h += '    <div class="cp-num"><div class="cp-sci-era">' + esc(d.era) + '</div></div>';
    h +=      actsHtml(card, 'void');
    h += '  </div>';
    h += '  <div class="cp-sci-title">' + esc(d.title) + '</div>';
    if (d.body) h += '  <div class="cp-sci-body">' + esc(d.body) + '</div>';
    var foot = [];
    if (d.related) foot.push('相关元素：' + esc(d.related));
    if (d.science_order) foot.push('第 ' + esc(d.science_order) + ' / 共 10 张');
    if (foot.length) h += '  <div class="cp-sci-foot">' + foot.join(' · ') + '</div>';
    h += '</div>';
    return h;
  }

  function renderCard(card) { return isScience(card) ? renderScienceCard(card) : renderElementCard(card); }

  /* ==========================================================================
     周期表视图
     主栅格 = 非镧系/锕系的 88 个元素；镧系(15)/锕系(15) 按原子序数排在下方两行。
     ========================================================================== */
  function buildTable() {
    var elements = state.all.filter(function (c) { return !isScience(c); });
    var main = [], series = {};
    SERIES_ORDER.forEach(function (k) { series[k] = []; });
    elements.forEach(function (c) {
      var d = c.data || {};
      var k = catKey(d.category);
      if (series[k]) series[k].push(c);
      else main.push(c);
    });
    SERIES_ORDER.forEach(function (k) {
      series[k].sort(function (a, b) { return (a.data.atomic_number || 0) - (b.data.atomic_number || 0); });
    });
    return { elements: elements, main: main, series: series };
  }

  function cellHtml(card) {
    var d = card.data || {};
    var cls = 'pt-cell ' + catClass(d.category) + (card.is_unknown === 1 ? ' is-marked' : '');
    var tip = [d.name_zh, d.name_en, d.category].filter(Boolean).join(' · ');
    return '<button type="button" class="' + cls + '" data-card-id="' + card.id + '" data-act="elem"' +
      ' data-tooltip="' + esc(tip) + '" aria-label="' + esc(tip) + '">' +
      (card.is_favorite === 1 ? '<span class="mk"><i class="fa-solid fa-star"></i></span>' : '') +
      '<span class="z">' + esc(d.atomic_number) + '</span>' +
      '<span class="sym">' + esc(d.symbol) + '</span>' +
      '</button>';
  }

  function seriesCellHtml(label, range) {
    return '<button type="button" class="pt-cell is-series" data-act="series" data-series="' + esc(label) + '"' +
      ' data-tooltip="' + esc(label + ' ' + range + '，共 15 个，见下方一行') + '">' +
      '<span class="sym">' + esc(range) + '</span>' +
      '</button>';
  }

  function catCounts(elements) {
    var m = {};
    elements.forEach(function (c) {
      var k = catKey((c.data || {}).category);
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }

  function renderTable() {
    var box = $id('study-list');
    var t = buildTable();
    if (!t.elements.length) {
      box.innerHTML = '<div class="empty-state">还没有卡片。</div>';
      return;
    }
    var h = '<div class="pt-wrap"><div class="pt-grid">';
    /* 表头：族号 1..18 */
    h += '<div class="pt-head" style="grid-row:' + ROW_HEAD + ';grid-column:1"></div>';
    for (var g = 1; g <= GROUPS; g++) {
      h += '<div class="pt-head" style="grid-row:' + ROW_HEAD + ';grid-column:' + (g + COL_OFFSET) + '">' + g + '</div>';
    }
    /* 周期名 1..7 */
    for (var p = 1; p <= PERIODS; p++) {
      h += '<div class="pt-plabel" style="grid-row:' + (p + ROW_OFFSET) + ';grid-column:1">' + p + '</div>';
    }
    /* 主栅格元素（镧系/锕系已被抽走，所以 (6,3)/(7,3) 是空的，由下面的占位格补上） */
    t.main.forEach(function (c) {
      var d = c.data || {};
      if (d.period == null || d.group == null) return;
      h += cellHtml(c).replace('<button ', '<button style="grid-row:' + (d.period + ROW_OFFSET) +
        ';grid-column:' + (d.group + COL_OFFSET) + '" ');
    });
    var rangeOf = { '镧系': '57–71', '锕系': '89–103' };
    SERIES_ORDER.forEach(function (k, i) {
      var row = ROW_SERIES + i;
      h += '<div class="pt-plabel" style="grid-row:' + row + ';grid-column:1">' +
        esc(k === SERIES_LAN ? '镧' : '锕') + '</div>';
      /* 主表族 3 那一格的占位（和下方 15 格同列，竖着对齐） */
      h += seriesCellHtml(k, rangeOf[k]).replace('<button ', '<button style="grid-row:' + (6 + i + ROW_OFFSET) +
        ';grid-column:' + COL_SERIES + '" ');
      t.series[k].forEach(function (c, j) {
        h += cellHtml(c).replace('<button ', '<button style="grid-row:' + row +
          ';grid-column:' + (COL_SERIES + j) + '" ');
      });
    });
    h += '</div></div>';
    /* 图例 */
    var counts = catCounts(t.elements);
    var present = LEGEND.filter(function (k) { return counts[k]; });
    var extra = Object.keys(counts).filter(function (k) { return LEGEND.indexOf(k) < 0; });
    h += '<div class="pt-legend">';
    present.concat(extra).forEach(function (k) {
      h += '<span class="pt-legend-item ' + (CAT_CLASS[k] || 'cp-c-unknown') + '">' +
        '<span class="sw"></span>' + esc(k) + '<span class="n">' + counts[k] + '</span></span>';
    });
    h += '</div>';
    h += '<div class="pt-note">共 ' + t.elements.length + ' 个元素（标「（推测）」的是 104 号以后超重元素的预测性质）' +
      ' · 点任意格子看元素详情 · 镧系/锕系在主表里只有一格占位，完整 15 个在下方两行。</div>';
    box.innerHTML = h;
  }

  /* ==========================================================================
     渲染
     ========================================================================== */
  function renderList() {
    var box = $id('study-list');
    if (!box) return;
    var content = $('.study-content');
    var isTable = (state.view === 'table' && !state.singleCardMode);
    if (content) {
      content.classList.toggle('wide', state.singleCardMode);
      content.classList.toggle('chart-wide', isTable);
    }
    if (state.singleCardMode) { renderSingleCardStage(); return; }
    if (isTable) { renderTable(); return; }

    var cards = state.all;
    if (!cards.length) {
      box.innerHTML = '<div class="empty-state">还没有卡片。</div>';
      return;
    }
    box.innerHTML = cards.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 12, 240) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }

  /* 只重画一张卡（标记/收藏后）：别整列表重渲染，否则整屏动画重放、滚动也会抖 */
  /* 标记 / 收藏之后，把所有显示这张卡的地方都刷一遍：
     周期表格子的小圆点、弹窗里的按钮态、列表卡 / 单卡模式。
     只重画这一张 —— 整列表重渲染会让动画重放、滚动发抖。 */
  function patchCard(card) {
    patchCell(card);
    if (modalCardId === String(card.id)) patchModal(card);
    if (state.view === 'table' && !state.singleCardMode) return;
    if (state.singleCardMode) { renderSingleCardContent(state.singleCardIndex, false); return; }
    var el = document.querySelector('#study-list .cp-root[data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
  }
  /* 周期表里的同一个元素也要跟着变（标记环 / 星标） */
  function patchCell(card) {
    var el = document.querySelector('#study-list .pt-cell[data-card-id="' + card.id + '"]');
    if (el) el.outerHTML = cellHtml(card);
  }

  /* ===== 单卡模式（只在卡片视图里可用） ===== */
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
    var cards = state.all;
    if (!cards.length) return;
    renderSingleCardContent(state.singleCardIndex + delta, true);
  }

  /* ==========================================================================
     交互
     ========================================================================== */
  function flipCard(card, el) {
    var inner = el ? el.querySelector('.cp-inner') : null;
    if (!inner) return;
    inner.classList.toggle('flipped');
    cardAPI.track('flip', card.id);
  }
  function playCard(card) {
    var d = card.data || {};
    cardAPI.track('audio_play', card.id);
    var txt = isScience(card) ? (d.title || '') : (d.name_zh || '');
    if (!txt) { showToast('这张卡没有可朗读的内容', true); return; }
    warnIfNoChineseVoice();
    voiceMgr.speak(txt, VOICE_LANG);
  }
  function handleMark(card) {
    var want = card.is_unknown === 1 ? 0 : 1;
    cardAPI.mark(card.id, want).then(function (d) {
      card.is_unknown = (d && typeof d.is_unknown !== 'undefined') ? d.is_unknown : want;
      cardAPI.track('word_mark', card.id);
      patchCard(card);
      updateStatsText();
    });
  }
  function handleFavorite(card) {
    var want = card.is_favorite === 1 ? 0 : 1;
    cardAPI.favorite(card.id, want).then(function (d) {
      card.is_favorite = (d && typeof d.is_favorite !== 'undefined') ? d.is_favorite : want;
      cardAPI.track('favorite_toggle', card.id);
      patchCard(card);
    });
  }

  /* 切到卡片视图并定位到那张卡（闪一下让人知道跳到哪了）。
     点周期表格子已经不走这条路了（改成弹窗），现在只有弹窗底部的
     「在卡组中查看」会用到它。 */
  function jumpToCard(id) {
    state.view = 'card';
    state.singleCardMode = false;
    try { localStorage.setItem('dc-cp-view', 'card'); } catch (e) {}
    syncViewSeg();
    syncCardViewBtn();
    var s = $id('study-scroll');
    renderList();
    if (s) s.scrollTop = 0;
    window.requestAnimationFrame(function () {
      var el = document.querySelector('#study-list .cp-root[data-card-id="' + id + '"]');
      if (!el) return;
      /* 自己算 scrollTop，别用 el.scrollIntoView()：
         .study-scroll 是 display:flex 的滚动容器、.study-content 又有 24px 上内边距，
         scrollIntoView({block:'start'}) 在这里会对齐到内边距之外，实测目标卡顶部落到
         滚动口上方 10px（探针抓到 top=-10）。用矩形差算就完全确定，
         再留 12px 呼吸位，顺带让卡片不至于贴着顶栏。 */
      if (s) {
        var cr = el.getBoundingClientRect(), sr = s.getBoundingClientRect();
        var want = s.scrollTop + (cr.top - sr.top) - 12;
        s.scrollTo({ top: Math.max(0, want), behavior: 'smooth' });
      } else {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      el.classList.remove('cp-flash');
      void el.offsetWidth;
      el.classList.add('cp-flash');
    });
  }
  /* 占位格（57–71 / 89–103）-> 弹该系第一个元素（镧 / 锕） */
  function jumpToSeries(label) {
    var t = buildTable();
    var list = t.series[label];
    if (!list || !list.length) return;
    openElementModal(list[0].id);
  }

  /* ==========================================================================
     元素弹窗（点周期表格子）
     正反同屏：正面 + 背面一次铺开，不再翻面 —— 周期表是查阅面，点一格就是想看全，
     再设一道翻面闸门是多余的。表格留在遮罩后面，关掉就回到原处，
     不会像"跳卡片"那样把表里的位置感丢掉。
     代价（有意）：这条路径不再产生 flip 事件 —— 查资料不该被算成复习。
     翻面作为学习动作，在「卡片」视图里照旧。
     ========================================================================== */
  var modalCardId = null;

  function modalOpen() {
    var m = $id('element-modal');
    return !!(m && !m.hidden);
  }

  function openElementModal(id) {
    var card = findCard(id);
    if (!card || isScience(card)) return;
    var mask = $id('element-modal');
    var box = $id('element-modal-box');
    if (!mask || !box) { jumpToCard(id); return; }   /* 兜底：没有弹窗节点就还是跳卡片 */
    modalCardId = String(card.id);
    box.innerHTML = renderElementModal(card);
    mask.hidden = false;
    box.scrollTop = 0;
    document.body.classList.add('cp-modal-open');
    try { box.focus(); } catch (e) {}
  }

  function closeElementModal() {
    var mask = $id('element-modal');
    if (!mask || mask.hidden) return;
    mask.hidden = true;
    modalCardId = null;
    document.body.classList.remove('cp-modal-open');
  }

  /* 标记 / 收藏后只重画弹窗里这张，保留滚动位置（弹窗内容可能比视口高） */
  function patchModal(card) {
    var box = $id('element-modal-box');
    if (!box) return;
    var top = box.scrollTop;
    box.innerHTML = renderElementModal(card);
    box.scrollTop = top;
  }

  /* ===== 视图切换 ===== */
  function syncViewSeg() {
    var box = $id('view-seg');
    if (!box) return;
    box.innerHTML = VIEWS.map(function (v) {
      return '<button type="button" data-view="' + v.id + '"' + (state.view === v.id ? ' class="on"' : '') + '>' +
        esc(v.label) + '</button>';
    }).join('');
  }
  /* 单卡模式是"从一列卡里翻一张"，周期表视图里没有这个概念 → 藏起来 */
  function syncCardViewBtn() {
    var cv = $id('card-view-btn');
    if (!cv) return;
    cv.classList.remove('active');
    cv.style.display = (state.view === 'table') ? 'none' : '';
  }
  function setView(id) {
    if (!VIEWS.some(function (v) { return v.id === id; })) return;
    if (state.view === id && !state.singleCardMode) return;
    closeElementModal();
    state.view = id;
    state.singleCardMode = false;
    state.singleCardIndex = 0;
    try { localStorage.setItem('dc-cp-view', id); } catch (e) {}
    syncViewSeg();
    syncCardViewBtn();
    renderList();
    updateStatsText();
    var s = $id('study-scroll');
    if (s) s.scrollTop = 0;
  }

  /* ===== 事件委托（一处绑完，重渲染不用重绑） ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 周期表格子（先判：格子里还有 .z/.sym 等子节点）-> 就地弹窗 */
      var cell = target.closest('.pt-cell[data-act="elem"]');
      if (cell) { e.stopPropagation(); openElementModal(cell.dataset.cardId); return; }
      var sCell = target.closest('.pt-cell[data-act="series"]');
      if (sCell) { e.stopPropagation(); jumpToSeries(sCell.dataset.series); return; }

      /* 弹窗：关闭 / 回到卡片视图 / 点遮罩空白处关闭 */
      if (target.closest('[data-act="modal-close"]')) { e.stopPropagation(); closeElementModal(); return; }
      if (target.closest('[data-act="modal-jump"]')) {
        e.stopPropagation();
        var jumpId = modalCardId;
        closeElementModal();
        if (jumpId) jumpToCard(jumpId);
        return;
      }
      if (target.id === 'element-modal') { closeElementModal(); return; }

      /* 卡片上的动作按钮 */
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl = actionBtn.closest('[data-card-id]');
        var card = cardEl ? findCard(cardEl.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          if (action === 'play') playCard(card);
          else if (action === 'flip') flipCard(card, cardEl);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }
      /* 点任意一面 = 翻面（正面→背面、背面→正面都要能翻；
         按钮在 .cp-head 里，不在 .cp-face 内，所以不会误触） */
      var face = target.closest('.cp-face[data-act="flipface"]');
      if (face) {
        e.stopPropagation();
        var fEl = face.closest('[data-card-id]');
        var fCard = fEl ? findCard(fEl.dataset.cardId) : null;
        if (fCard) flipCard(fCard, fEl);
        return;
      }
      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

      /* 周期表 / 卡片 */
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

    /* 键盘：弹窗开着时 Esc 关弹窗（别的键都不管）；
       单卡模式下 ←/→/空格 翻卡，Esc 退出 */
    document.addEventListener('keydown', function (e) {
      if (modalOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); closeElementModal(); }
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

    syncCardViewBtn();
    syncViewSeg();
    renderList();

    loadAll().then(function () {
      syncViewSeg();
      syncCardViewBtn();
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
