/* ==========================================================================
   日语五十音图 · 小工具
   --------------------------------------------------------------------------
   46 个假名（46 清音 + 拨音ん），一份数据两种视图，顶栏分段控件切换：

     chart 五十音图   5 段（あいうえお）× 11 行的真表格 —— 这是模板做不到的那个东西。
                      列 = 段（元音），行 = 行（辅音），空格子留白，点格子读假名。
                      配色按**段**（5 色）⇒ 表格上就是 5 条竖向色带，
                      一眼看出"同一列 = 同一个元音"，而这正是五十音排列的依据。
     card  卡片       平假名 / 片假名 / 罗马字 / 例词，与其他语言类工具同版面。

   ★ **没有眼睛按钮**：罗马字是学习内容本身，始终显示（用户 2026-09-25 拍板）。
   ★ 表格的字号只吃工具字号滑杆（--card-font-scale），**不吃 --k**（--k=1.30 是
     "假名当主角"的卡片放大倍数，套到 5 列表格上会撑爆）。

   两条发音通道（与音标拼读同构）：
     假名  -> 点格子/点卡片上的 🔊，读 hiragana
     例词  -> 点格子里的例词、或卡片里的例词，读整个词
   两条都走浏览器 speechSynthesis（顶栏可选日语 voice），宿主的 playAudio 不用
   —— 这样音色下拉才管得住它。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '日语五十音图';
  var VOICE_LANG = TOOL.voiceLang || 'ja';
  var VIEWS = (TOOL.views && TOOL.views.length) ? TOOL.views : [
    { id: 'chart', label: '五十音图' },
    { id: 'card',  label: '卡片' }
  ];
  var PAGE_SIZE = 500;                    /* 46 张，一次读完 */

  var SKINS = [
    { id: 'cream', name: '奶油', icon: 'fa-sun' },
    { id: 'glass', name: '墨玻璃', icon: 'fa-moon' },
    { id: 'category', name: '分类彩', icon: 'fa-gem' }
  ];

  /* 段 = 元音列。段色写在 cards.css 的 .dan-a/.dan-i/.dan-u/.dan-e/.dan-o/.dan-n 上，
     各皮肤一套（墨玻璃要更亮的版本）—— 所以这里只给类名，不给色值。 */
  var VOWELS = ['a', 'i', 'u', 'e', 'o'];
  var VOWEL_KANA = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' };
  var DAN_NEUTRAL = 'dan-n';

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    view: 'chart',
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    soundEnabled: true,
    _voiceWarned: false
  };
  try {
    var savedView = localStorage.getItem('dc-jgo-view');
    if (savedView && VIEWS.some(function (v) { return v.id === savedView; })) state.view = savedView;
  } catch (e) {}
  try {
    var savedSkin = localStorage.getItem('dc-jgo-skin');
    if (savedSkin) state.skin = savedSkin;
  } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem('dc-jgo-font')) || 1; } catch (e) {}
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

  /* ===== 音色（日语朗读；音色键沿用 dc-voice-<lang>，与其它工具/本体一致） ===== */
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
    sampleText: function () { return 'あいうえお'; },
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

  /* 没有日语 voice 时**别静默**：说出来是默认音色在读日文，只会读得很怪 */
  function warnIfNoJapaneseVoice() {
    if (state._voiceWarned) return;
    if (voiceMgr.pickVoice(VOICE_LANG)) return;
    state._voiceWarned = true;
    showToast('系统里没有日语语音包，读音可能不准', false);
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
      empty.textContent = '系统里没有日语语音包，点一下用默认的试听。';
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
    try { localStorage.setItem('dc-jgo-skin', state.skin); } catch (e) {}
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
    try { localStorage.setItem('dc-jgo-font', state.fontSize); } catch (e) {}
  }

  /* ==========================================================================
     数据：段 / 行 都是从 romaji 与 row 推出来的
     ========================================================================== */
  /* 段 = romaji 的尾字母（あ→a / し→shi→i / つ→tsu→u / を→wo→o）；ん 没有元音 */
  function vowelOf(romaji) {
    var s = String(romaji == null ? '' : romaji).toLowerCase();
    var last = s.slice(-1);
    return VOWELS.indexOf(last) >= 0 ? last : null;
  }
  function danClass(romaji) {
    var v = vowelOf(romaji);
    return v ? 'dan-' + v : DAN_NEUTRAL;
  }
  function danLabel(romaji) {
    var v = vowelOf(romaji);
    return v ? VOWEL_KANA[v] + '段' : '';
  }
  /* 行名：数据里的 row（あ/か/さ…/撥）。拨音那行的 row 是繁体「撥」，显示成「ん」且不加「行」 */
  function rowLabelOf(row) {
    var t = String(row == null ? '' : row);
    if (t === '撥' || t === '拨' || t === 'ん' || t === 'ン' || t === 'n') return { text: 'ん', suffix: '' };
    return { text: t, suffix: '行' };
  }
  /* 例词 "あか（红色）" -> {word:'あか', mean:'红色'} */
  function splitExample(s) {
    var m = String(s == null ? '' : s).match(/^(.*?)[（(](.*)[）)]$/);
    if (m) return { word: m[1], mean: m[2] };
    return { word: String(s == null ? '' : s), mean: '' };
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
  function railButtons(card) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="dc-acts">' +
      '<button type="button" data-action="play" data-tooltip="读假名"><i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }

  function renderCard(card) {
    var d = card.data || {};
    var rl = rowLabelOf(d.row);
    var dan = danLabel(d.romaji);
    var ex = splitExample(d.example);
    return '<div class="jgo-root ' + danClass(d.romaji) + '" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<div class="dc-top">' +
        '<span class="jgo-row">' + esc(rl.text) + esc(rl.suffix) + '</span>' +
        (dan ? '<span class="jgo-dan">' + esc(dan) + '</span>' : '') +
      '</div>' +
      '<div class="jgo-kana">' +
        '<div class="jgo-kana-block"><div class="jgo-hira">' + esc(d.hiragana) + '</div>' +
          '<div class="jgo-kana-label">平假名</div></div>' +
        '<div class="jgo-kana-block"><div class="jgo-kata">' + esc(d.katakana) + '</div>' +
          '<div class="jgo-kana-label">片假名</div></div>' +
      '</div>' +
      '<div class="jgo-romaji">' + esc(d.romaji) + '</div>' +
      (ex.word ? '<div class="jgo-example">例：<span class="jgo-ex-word" data-word="' + esc(ex.word) +
        '" data-tooltip="读 ' + esc(ex.word) + '">' + esc(ex.word) + '</span>' +
        (ex.mean ? '（' + esc(ex.mean) + '）' : '') + '</div>' : '') +
    '</div>';
  }

  /* ==========================================================================
     五十音图视图
     行 = 数据里的 row（保持数据顺序），列 = 段（由 romaji 尾元音定位）。
     空位（や行的い/え、わ行的う/え 等）渲染成 .empty，占位但不可见。
     ========================================================================== */
  function buildChart() {
    var rows = [], byRow = {};
    state.all.forEach(function (c) {
      var d = c.data || {};
      var key = String(d.row == null ? '' : d.row);
      if (!byRow[key]) { byRow[key] = { row: key, cells: [null, null, null, null, null] }; rows.push(byRow[key]); }
      var v = vowelOf(d.romaji);
      if (v) byRow[key].cells[VOWELS.indexOf(v)] = c;
      else if (!byRow[key].cells[0]) byRow[key].cells[0] = c;   /* ん：坐在第一列 */
    });
    return rows;
  }

  function chartCell(card) {
    if (!card) return '<div class="c-cell empty"></div>';
    var d = card.data || {};
    var ex = splitExample(d.example);
    return '<div class="c-cell ' + danClass(d.romaji) + '" data-card-id="' + card.id + '" data-act="kana"' +
      ' data-tooltip="读 ' + esc(d.hiragana) + '">' +
      (card.is_unknown === 1 ? '<span class="c-star"><i class="fa-solid fa-star"></i></span>' : '') +
      (card.is_favorite === 1 ? '<span class="c-fav"><i class="fa-solid fa-bookmark"></i></span>' : '') +
      '<span class="c-hira">' + esc(d.hiragana) + '</span>' +
      '<span class="c-side"><span class="c-kata">' + esc(d.katakana) + '</span>' +
        '<span class="c-romaji">' + esc(d.romaji) + '</span></span>' +
      (ex.word ? '<span class="c-ex" data-word="' + esc(ex.word) + '" data-tooltip="读 ' + esc(ex.word) + '">' +
        esc(ex.word) + (ex.mean ? '（' + esc(ex.mean) + '）' : '') + '</span>' : '') +
    '</div>';
  }

  function renderChart() {
    var box = $id('study-list');
    var rows = buildChart();
    if (!rows.length) {
      box.innerHTML = '<div class="empty-state">还没有卡片。</div>';
      return;
    }
    var html = '<div class="jgo-chart">';
    html += '<div class="c-head c-rowlabel">·</div>';
    VOWELS.forEach(function (v) {
      html += '<div class="c-head">' + VOWEL_KANA[v] + '<b>' + v + '</b></div>';
    });
    rows.forEach(function (r) {
      var rl = rowLabelOf(r.row);
      html += '<div class="c-rowlabel">' + esc(rl.text) +
        (rl.suffix ? '<b>' + esc(rl.suffix) + '</b>' : '') + '</div>';
      r.cells.forEach(function (c) { html += chartCell(c); });
    });
    html += '</div>';
    box.innerHTML = html;
  }

  /* ==========================================================================
     渲染
     ========================================================================== */
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

    var cards = state.all;
    if (!cards.length) {
      box.innerHTML = '<div class="empty-state">还没有卡片。</div>';
      return;
    }
    box.innerHTML = cards.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 16, 280) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }

  /* 只重画一张卡（标记/收藏后）：别整列表重渲染，否则整屏动画重放、滚动也会抖 */
  function patchCard(card) {
    if (state.view === 'chart') { renderList(); return; }
    var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
  }
  /* 表格里的同一张卡也要跟着变（星标） */
  function patchCell(card) {
    var el = document.querySelector('#study-list .c-cell[data-card-id="' + card.id + '"]');
    if (el) el.outerHTML = chartCell(card);
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
     卡片 / 格子交互
     ========================================================================== */
  function playKana(card) {
    var d = card.data || {};
    cardAPI.track('audio_play', card.id);
    if (!d.hiragana) { showToast('这张卡没有可朗读的内容', true); return; }
    warnIfNoJapaneseVoice();
    voiceMgr.speak(d.hiragana, VOICE_LANG);
  }
  function playWord(card, word) {
    if (!word) return;
    cardAPI.track('word_play', card.id);
    warnIfNoJapaneseVoice();
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
    try { localStorage.setItem('dc-jgo-view', id); } catch (e) {}
    var cv = $id('card-view-btn');
    if (cv) {
      cv.classList.remove('active');
      /* 单卡模式是"从一列卡里翻一张"，表格视图里没有这个概念 → 藏起来 */
      cv.style.display = (id === 'chart') ? 'none' : '';
    }
    renderViewSeg();
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

      /* 例词（先判：例词就在格子里，不能让点例词变成读假名） */
      var wordEl = target.closest('[data-word]');
      if (wordEl) {
        e.stopPropagation();
        var wCardEl = wordEl.closest('[data-card-id]');
        var wCard = wCardEl ? findCard(wCardEl.dataset.cardId) : null;
        if (wCard) playWord(wCard, wordEl.dataset.word);
        return;
      }
      /* 表格格子 = 读假名 */
      var cell = target.closest('.c-cell[data-act="kana"]');
      if (cell) {
        e.stopPropagation();
        var cCard = findCard(cell.dataset.cardId);
        if (cCard) playKana(cCard);
        return;
      }
      /* 卡片上的三个动作 */
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl = actionBtn.closest('[data-card-id]');
        var card = cardEl ? findCard(cardEl.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          if (action === 'play') playKana(card);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }
      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

      /* 五十音图 / 卡片 */
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
