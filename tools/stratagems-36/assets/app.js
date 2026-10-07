/* ==========================================================================
   三十六计 · 小工具
   ==========================================================================
   42 张 = 36 条计 + 6 张套别总览（胜战计 / 敌战计 / 攻战计 / 混战计 / 并战计 / 败战计），
   一次读完。顶栏分段控件切两个视图（2026-09-29 改版）：

     chart 概览   6 套 × 6 计 = 6×6 方图。行首 = 套别（读总览卡），格子 = 计。
                  点格 / 点行首 → **就地弹窗**看那张卡的完整卡面（可翻面、可标记收藏），
                  关掉还在原位 —— 方图是查阅面，位置感不丢。点格**不朗读**，
                  朗读交给弹窗里的 🔊（旧版每点一格就读一次，看方图时太吵）。
     card  列表   一张一张的完整卡。**顺序不是卡组原序**：套别总览是章节导语，
                  所以排成「总览 → 6 计」× 6 组（卡组里它们本来在最后，读完全部
                  36 计才知道每套什么意思 —— 那是错的）。

   ✂️ 旧版的「单卡模式」已删（用户 2026-09-29 拍板）：它只是把列表切一张出来，
      概览 + 弹窗覆盖了同样的需求，还少一个顶栏按钮、少一套 .sc-* 版式。

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

  /* 视图：概览方图 / 卡片列表。标签跟着语言走，所以不放进 DC_TOOL。 */
  var VIEWS = [
    { id: 'chart', label: { zh: '概览', en: 'Overview' } },
    { id: 'card',  label: { zh: '列表', en: 'List' } }
  ];

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
      noPlay: '这张卡没有可朗读的内容',
      overviewTip: '总览', close: '关闭（Esc）', jump: '在列表中查看',
      chartTip: '点开看这一计', empty: '还没有卡片。'
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
      noPlay: 'Nothing to read on this card',
      overviewTip: 'Overview', close: 'Close (Esc)', jump: 'View in list',
      chartTip: 'Open this stratagem', empty: 'No cards yet.'
    }
  };

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    view: 'chart',
    skin: 'cream',
    fontSize: 1,
    lang: DEFAULT_LANG,
    flipped: {},                 /* cardId -> true，切语言/换视图都要留住 */
    trackLang: {}
  };
  try {
    var savedView = localStorage.getItem('dc-st-view');
    if (savedView && VIEWS.some(function (v) { return v.id === savedView; })) state.view = savedView;
  } catch (e) {}
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
    pickVoice: function (tag) {
      if (!tag) return null;
      var primary = this._primary(tag);
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
    /* 隐藏「变声玩具」音色；若该语言下全是玩具（理论上不会）就退回完整列表，免得下拉空掉 */
    var realVoices = voices.filter(function (v) { return !voiceMgr.isToy(v); });
    if (realVoices.length) voices = realVoices;
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
    renderViewSeg();
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
    /* 弹窗开着的话里面那张也要换语言（原地替换，不关窗） */
    if (stModalOpen() && modalCardId) {
      var c = findCard(modalCardId);
      if (c) patchStModal(c);
    }
  }

  /* ===== 视图 ===== */
  function renderViewSeg() {
    var box = $id('view-seg');
    if (!box) return;
    box.innerHTML = VIEWS.map(function (v) {
      return '<button type="button" data-view="' + v.id + '"' + (state.view === v.id ? ' class="on"' : '') + '>' +
        esc(v.label[state.lang] || v.label.zh) + '</button>';
    }).join('');
  }
  function setView(id) {
    if (!VIEWS.some(function (v) { return v.id === id; })) return;
    closeStModal();
    if (state.view === id) return;
    state.view = id;
    try { localStorage.setItem('dc-st-view', id); } catch (e) {}
    renderViewSeg();
    renderList();
    updateStatsText();
    var s = $id('study-scroll');
    if (s) s.scrollTop = 0;
  }

  /* ==========================================================================
     数据
     ========================================================================== */
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

  /* 按套分组：{setIndex, setCard, overview, items[]}。setCard = 拿来取套名的卡
     （优先总览卡，没有总览卡就退回该套第一张计卡 —— 套名两张卡上都有）。 */
  function groups() {
    var bySet = {};
    state.all.forEach(function (c) {
      var si = setIndexOf(c);
      if (!bySet[si]) bySet[si] = { setIndex: si, overview: null, items: [] };
      if (isOverview(c)) bySet[si].overview = c;
      else bySet[si].items.push(c);
    });
    return Object.keys(bySet).map(Number).sort(function (a, b) { return a - b; })
      .map(function (k) {
        var g = bySet[k];
        g.items.sort(function (a, b) { return ((a.data || {}).order || 0) - ((b.data || {}).order || 0); });
        g.setCard = g.overview || g.items[0] || null;
        return g;
      });
  }

  /* 列表顺序：每套的导语在前，然后 6 张计。卡组原序是「36 计在前、6 张总览在最后」，
     读完全部 36 计才知道每套什么意思 —— 导语就该在章节开头。 */
  function orderedCards() {
    var out = [];
    groups().forEach(function (g) {
      if (g.overview) out.push(g.overview);
      out = out.concat(g.items);
    });
    return out;
  }

  /* ==========================================================================
     卡面
     ========================================================================== */
  /* 动作槽位：计卡 4 个（朗读/翻面/标记/收藏），总览卡 3 个（没有翻面），
     弹窗里再多 1 个关闭。**不留空槽** —— 动作栏是右对齐的，右边缘钉死，
     少一个按钮只会让左边缘回缩，标记/收藏的位置不受影响。 */
  function actsHtml(card, hasFlip, withClose) {
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
      /* 弹窗里多一个关闭钮（继承 .st-acts button 的尺寸与 hover，只加一条左分隔线） */
      (withClose ? '<button type="button" class="st-modal-close" data-action="close" data-tooltip="' + esc(t.close) +
        '"><i class="fa-solid fa-xmark"></i></button>' : '') +
      '</div>';
  }

  /* 弹窗右下角留一条走回列表的老路（概览默认不跳列表，但产品上这条路还要有） */
  function modalFootHtml() {
    return '<div class="st-modal-foot"><button type="button" class="st-modal-jump" data-act="modal-jump">' +
      '<i class="fa-solid fa-list-ul"></i><span class="st-modal-jump-t">' + esc(tt().jump) + '</span></button></div>';
  }

  function renderOverview(card, d, inModal) {
    /* 印章：中文套名是三个字（「胜战计」），44px 印章放得下，直接用。
       英文套名最长 26 字符（"Enemy-Deception Stratagems"），塞进印章会溢成一团乱麻
       —— 原模板（deck 14）就是硬塞的，这里不照抄这个毛病：
       英文印章只写 SET + 套序号，完整套名交给下面的 .st-ov-title。 */
    var seal = isZh()
      ? '<div class="st-seal">' + esc(pick(d, 'set')) + '</div>'
      : '<div class="st-seal">SET<div class="st-seal-sub">' + esc(String(setIndexOf(card))) + '</div></div>';
    return '<div class="st-root st-overview ' + SET_CLASS[setIndexOf(card) - 1] +
        (inModal ? ' st-modal-root' : '') + '" data-card-id="' + card.id + '">' +
      seal +
      '<div class="st-ov-title">' + esc(pick(d, 'title')) + '</div>' +
      '<div class="st-ov-theme">' + esc(pick(d, 'theme')) + '</div>' +
      '<div class="st-ov-body">' + esc(pick(d, 'body')) + '</div>' +
      actsHtml(card, false, inModal) +
      (inModal ? modalFootHtml() : '') +
    '</div>';
  }

  function renderStratagem(card, d, inModal) {
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
        (flipped ? ' flipped' : '') + (inModal ? ' st-modal-root' : '') +
        '" data-card-id="' + card.id + '">' +
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
      actsHtml(card, true, inModal) +
      (inModal ? modalFootHtml() : '') +
    '</div>';
  }

  function renderCard(card, inModal) {
    var d = card.data || {};
    return isOverview(card) ? renderOverview(card, d, inModal) : renderStratagem(card, d, inModal);
  }

  /* ==========================================================================
     概览方图：6 套 × 6 计
     ==========================================================================
     · 行 = 套（数据里的 setIndex），列 = 该套的第 1..6 计（数据里的 order）。
     · 行首可点 ⇒ 弹该套的总览卡；格子可点 ⇒ 弹这张计卡。都是**就地弹窗**，
       不是下钻（方图是查阅面，位置感不能丢）。
     · 窄屏不硬挤：.st-c-wrap 横向滚动，格子保底 84px，4 个汉字放得下。
     配色：--cat 由 .st-setN 给（6 套色），格子底/线走 .st-chart 上的 --st-* 皮肤 token。
     ========================================================================== */
  function chartCell(card) {
    var d = card.data || {};
    var t = tt();
    return '<button type="button" class="st-c-cell" data-act="open" data-card-id="' + card.id +
        '" data-tooltip="' + esc(t.chartTip) + '">' +
      (card.is_unknown === 1 ? '<span class="st-c-star"><i class="fa-solid fa-star"></i></span>' : '') +
      (card.is_favorite === 1 ? '<span class="st-c-fav"><i class="fa-solid fa-bookmark"></i></span>' : '') +
      '<span class="st-c-no">' + esc(String(d.order == null ? '' : d.order)) + '</span>' +
      '<span class="st-c-nm">' + esc(pick(d, 'name')) + '</span>' +
    '</button>';
  }

  function renderChart() {
    var box = $id('study-list');
    var gs = groups();
    if (!gs.length) { box.innerHTML = '<div class="empty-state">' + esc(tt().empty) + '</div>'; return; }
    var t = tt();
    var html = '<div class="st-c-wrap"><div class="st-chart">';
    gs.forEach(function (g) {
      var sd = (g.setCard && g.setCard.data) || {};
      var od = (g.overview && g.overview.data) || {};
      var theme = g.overview ? pick(od, 'theme') : '';
      html += '<div class="st-c-row ' + SET_CLASS[g.setIndex - 1] + '">';
      html += '<div class="st-c-rh"' + (g.overview
          ? ' data-act="open" data-card-id="' + g.overview.id + '" data-tooltip="' + esc(t.overviewTip) + '"'
          : '') + '>' +
        '<span class="st-c-set">' + esc(pick(sd, 'set')) + '</span>' +
        (theme ? '<span class="st-c-theme">' + esc(theme) + '</span>' : '') +
      '</div>';
      g.items.forEach(function (c) { html += chartCell(c); });
      /* 该套不足 6 张也用空位占住列宽，否则整行的列宽会被 .st-c-rh 吃掉 */
      for (var i = g.items.length; i < 6; i++) html += '<div class="st-c-cell empty"></div>';
      html += '</div>';
    });
    html += '</div></div>';
    box.innerHTML = html;
  }

  /* ==========================================================================
     渲染
     ========================================================================== */
  function renderList() {
    var box = $id('study-list');
    if (!box) return;
    var content = $('.study-content');
    var isChart = state.view === 'chart';
    if (content) content.classList.toggle('chart-wide', isChart);
    if (isChart) { renderChart(); return; }

    var cards = orderedCards();
    if (!cards.length) { box.innerHTML = '<div class="empty-state">' + esc(tt().empty) + '</div>'; return; }
    box.innerHTML = cards.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 14, 260) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }

  /* 只重画一张卡（标记/收藏/翻面后）：别整列表重渲染，否则整屏动画重放、滚动也会抖 */
  function patchCard(card) {
    if (state.view !== 'card') return;
    var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
  }
  /* 方图里的同一张卡也要跟着变（星标 / 收藏角标） */
  function patchChartCell(card) {
    if (state.view !== 'chart') return;
    var el = document.querySelector('#study-list .st-c-cell[data-card-id="' + card.id + '"]');
    if (!el) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = chartCell(card);
    el.replaceWith(tmp.firstElementChild);
  }
  /* 一处改、三处跟：列表卡、方图格、弹窗里那张 */
  function refreshCard(card) {
    patchCard(card);
    patchChartCell(card);
    if (stModalOpen()) patchStModal(card);
  }

  /* ==========================================================================
     卡面弹窗（点方图的格子 / 行首）
     ==========================================================================
     遮罩 + 居中一张卡，卡面就是列表里那张（同一个 renderCard），只多 .st-modal-root、
     轨道末尾的关闭钮、右下角「在列表中查看」。
     滚动放在**遮罩**上（overflow:auto）而不是弹窗盒上，配合 box 的 margin:auto：
     内容不高时居中、超高时从顶部开始滚。
     ========================================================================== */
  var modalCardId = null;

  function stModalOpen() {
    var m = $id('st-modal');
    return !!(m && !m.hidden);
  }
  function openStModal(id) {
    var card = findCard(id);
    if (!card) return;
    var mask = $id('st-modal');
    var box = $id('st-modal-box');
    if (!mask || !box) return;
    modalCardId = String(card.id);
    box.innerHTML = renderCard(card, true);
    mask.hidden = false;
    box.scrollTop = 0;
    document.body.classList.add('st-modal-open');
    try { box.focus(); } catch (e) {}
  }
  function closeStModal() {
    var mask = $id('st-modal');
    if (!mask || mask.hidden) return;
    mask.hidden = true;
    /* 顺手清掉卡面：留着的话弹窗里那张会一直挂在 DOM 上，
       外部按 [data-card-id] 计数/取样式时就会多出一份 */
    var box = $id('st-modal-box');
    if (box) box.innerHTML = '';
    modalCardId = null;
    document.body.classList.remove('st-modal-open');
  }
  /* 标记/收藏/翻面后只重画弹窗里这一张，保留滚动位置（内容可能比视口高） */
  function patchStModal(card) {
    var box = $id('st-modal-box');
    if (!box) return;
    var top = box.scrollTop;
    box.innerHTML = renderCard(card, true);
    box.scrollTop = top;
  }

  /* 「在列表中查看」：切到列表、滚到那张卡、闪一下。 */
  function jumpToList(id) {
    closeStModal();
    if (state.view !== 'card') {
      state.view = 'card';
      try { localStorage.setItem('dc-st-view', 'card'); } catch (e) {}
      renderViewSeg();
      renderList();
      updateStatsText();
    }
    var el = document.querySelector('#study-list [data-card-id="' + id + '"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    var target = el.classList.contains('enter') ? el : el;
    target.classList.remove('st-flash');
    void target.offsetWidth;
    target.classList.add('st-flash');
    setTimeout(function () { target.classList.remove('st-flash'); }, 1400);
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
      refreshCard(card);
      updateStatsText();
    });
  }
  function handleFavorite(card) {
    var want = card.is_favorite === 1 ? 0 : 1;
    cardAPI.favorite(card.id, want).then(function (d) {
      card.is_favorite = (d && typeof d.is_favorite !== 'undefined') ? d.is_favorite : want;
      cardAPI.track('favorite_toggle', card.id);
      refreshCard(card);
    });
  }

  /* ===== 事件委托（一处绑完，重渲染不用重绑） ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 动作按钮（先判：它在卡里，点它不能顺带翻面/关窗） */
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
          else if (action === 'close') closeStModal();
        }
        return;
      }
      /* 弹窗：点遮罩空白处关闭 / 「在列表中查看」
         （必须先判：格子就在遮罩下面，顺序反了会点穿） */
      if (target.closest('[data-act="modal-jump"]')) {
        e.stopPropagation();
        var jumpId = modalCardId;
        if (jumpId) jumpToList(jumpId);
        return;
      }
      if (target.id === 'st-modal') { closeStModal(); return; }
      /* 方图格子 / 行首 = 就地弹窗（不下钻） */
      var cell = target.closest('.st-c-cell[data-act="open"], .st-c-rh[data-act="open"]');
      if (cell) {
        e.stopPropagation();
        openStModal(cell.dataset.cardId);
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

      /* 视图分段控件 */
      var viewBtn = target.closest('#view-seg button[data-view]');
      if (viewBtn) { e.stopPropagation(); setView(viewBtn.dataset.view); return; }

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

    /* 键盘：弹窗开着时 Esc 关窗（没有单卡模式了，不需要 ←/→ 翻卡） */
    document.addEventListener('keydown', function (e) {
      if (!stModalOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); closeStModal(); }
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
