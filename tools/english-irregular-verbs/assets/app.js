/* ==========================================================================
   英语不规则动词 200 · 小工具
   --------------------------------------------------------------------------
   1 张总览卡 + 5 张引导卡 + 200 张动词卡，按「三形关系」分五型：

     AAA  cut → cut → cut        26 词
     AAB  beat → beat → beaten    1 词
     ABA  come → came → come      4 词
     ABB  build → built → built  85 词
     ABC  begin → began → begun  84 词

   数据顺序本身就是「引导卡 → 该型动词」的天然分节，所以列表只有一个卡片
   视图 —— 总览和引导卡插在各自段落头上，读起来就是一本小讲义。

   工具比模板多两件事：
     · 自测模式（quiz）：过去式/过去分词显示成 · · ·，点格子揭开 ——
       原版靠宿主的字段抽屉藏字段，藏了就是藏了；这里是「先回忆，再对照」。
     · 五型筛选（group seg）：只刷某一型，针对性过关。

   朗读通道（浏览器 TTS，en-US，顶栏可选音色）：
     🔊      -> 读原形（audio_play）
     点例句  -> 读整句（word_play）—— 例句全是过去式语境，跟读一举两得

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '英语不规则动词';
  var VOICE_LANG = TOOL.voiceLang || 'en-US';
  var GROUPS = TOOL.groups || ['AAA', 'AAB', 'ABA', 'ABB', 'ABC'];
  var GROUP_NAMES = TOOL.groupNames || {};
  var PAGE_SIZE = 500;                    /* 206 张，一次读完 */
  var LS = 'dc-irv-';

  var SKINS = [
    { id: 'cream', name: '奶油', icon: 'fa-sun' },
    { id: 'glass', name: '墨玻璃', icon: 'fa-moon' },
    { id: 'category', name: '分组彩', icon: 'fa-gem' }
  ];

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    view: 'card',
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    quiz: false,
    group: 'all',
    revealed: {},                /* 自测模式里被手动揭开的 cardId#字段 */
    _voiceWarned: false,
    _refreshLock: false
  };
  try { var ss = localStorage.getItem(LS + 'skin'); if (ss) state.skin = ss; } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem(LS + 'font')) || 1; } catch (e) {}
  try { state.quiz = localStorage.getItem(LS + 'quiz') === '1'; } catch (e) {}
  try { var sg = localStorage.getItem(LS + 'group'); if (sg) state.group = sg; } catch (e) {}

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
    sampleText: function () { return 'begin, began, begun'; },
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
    showToast('系统里没有英语语音包，读音可能不准', false);
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
      empty.textContent = '系统里没有英语语音包，点一下用默认的试听。';
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
    });
  }
  function findCard(id) {
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) return state.all[i];
    return null;
  }
  function visibleCards() {
    if (state.group === 'all') return state.all;
    return state.all.filter(function (c) {
      var d = c.data || {};
      if (d.type === 'overview') return true;      /* 总览卡在筛选态下也留着当封面 */
      return d.group === state.group;
    });
  }
  function updateStatsText() {
    var marked = state.all.filter(function (c) { return c.is_unknown === 1; }).length;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + state.all.length;
  }

  /* ===== 卡面 ===== */
  function railButtons(card) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="dc-acts">' +
      '<button type="button" data-action="play" data-tooltip="读原形"><i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }
  function groupName(g) { return GROUP_NAMES[g] || g; }

  /* 自测模式：过去式/过去分词藏起来（· · ·），点格子揭开；原形始终显示 */
  function isHidden(card, key) {
    return state.quiz && key !== 'base0' && !state.revealed[card.id + '#' + key];
  }
  function formCell(card, tag, word, key) {
    var hidden = isHidden(card, key);
    return '<div class="iv-f' + (hidden ? ' dim' : '') + '"' +
      (state.quiz ? ' data-reveal="' + key + '" data-tooltip="' + (hidden ? '点一下对照' : '') + '"' : '') + '>' +
      '<span class="iv-f-tag">' + esc(tag) + '</span>' +
      '<span class="iv-f-w">' + (hidden ? '· · ·' : esc(word)) + '</span>' +
      '</div>';
  }
  function highlightBase(sentence, base) {
    /* 例句里的动词加粗（原版只对 guide 卡加 b，动词卡其实也能命中大多数） */
    var s = esc(sentence);
    if (!base) return s;
    var re = new RegExp('\\b' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    return s.replace(re, function (m) { return '<b>' + m + '</b>'; });
  }

  function renderCard(card) {
    var d = card.data || {};

    if (d.type === 'overview') {
      /* 每型的锚点词示例：原版总览卡就有，保留 */
      var OV_EX = { AAA: 'cut / cut / cut', AAB: 'beat / beat / beaten', ABA: 'come / came / come',
                    ABB: 'build / built / built', ABC: 'begin / began / begun' };
      var rows = GROUPS.map(function (g) {
        return '<div class="iv-ov-row"><span class="iv-ov-dot iv-' + g + '"></span>' +
          '<span class="iv-ov-type">' + g + '</span>' +
          '<span class="iv-ov-rule">' + esc(groupName(g)) + '</span>' +
          '<span class="iv-ov-ex">' + esc(OV_EX[g] || '') + '</span></div>';
      }).join('');
      return '<div class="iv-root iv-overview" data-card-id="' + card.id + '">' +
        railButtons(card) +
        '<div class="iv-badge">五型总览</div>' +
        '<div class="iv-g-title">' + esc(d.nameZh || '') + '</div>' +
        (d.intro ? '<div class="iv-intro">' + esc(d.intro) + '</div>' : '') +
        '<div class="iv-ov">' + rows + '</div>' +
        '</div>';
    }

    if (d.type === 'guide') {
      return '<div class="iv-root iv-' + esc(d.group) + '" data-card-id="' + card.id + '">' +
        railButtons(card) +
        '<div class="iv-top"><span class="iv-badge">' + esc(d.group) + ' <span class="cn">' + esc(groupName(d.group)) + '</span></span></div>' +
        '<div class="iv-g-title">' + esc(d.nameZh || '') + '</div>' +
        (d.pattern ? '<div class="iv-g-pattern">' + esc(d.pattern) + '</div>' : '') +
        (d.rule ? '<div class="iv-g-rule">' + esc(d.rule) + '</div>' : '') +
        (d.tip ? '<div class="iv-g-tip">' + esc(d.tip) + '</div>' : '') +
        (d.example ? '<div class="iv-ex"><div class="iv-ex-tag">Example · 例句</div>' +
          '<div class="iv-ex-en" data-say="' + esc(d.example) + '" data-tooltip="读整句">' +
          highlightBase(d.example, d.anchor) + '</div>' +
          (d.exampleZh ? '<div class="iv-ex-zh">' + esc(d.exampleZh) + '</div>' : '') +
          '</div>' : '') +
        '</div>';
    }

    /* 动词卡 */
    return '<div class="iv-root iv-' + esc(d.group) + '" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<div class="iv-top"><span class="iv-badge">' + esc(d.group) + ' <span class="cn">' + esc(groupName(d.group)) + '</span></span></div>' +
      '<div class="iv-base-line"><span class="iv-base">' + esc(d.base) + '</span>' +
        (d.zh ? '<span class="iv-zh">' + esc(d.zh) + '</span>' : '') + '</div>' +
      '<div class="iv-forms">' +
        formCell(card, '原形', d.base, 'base0') +
        '<span class="iv-arrow">→</span>' +
        formCell(card, '过去式', d.past, 'past') +
        '<span class="iv-arrow">→</span>' +
        formCell(card, '过去分词', d.pp, 'pp') +
      '</div>' +
      (d.example ? '<div class="iv-ex"><div class="iv-ex-tag">Example · 过去式例句</div>' +
        '<div class="iv-ex-en" data-say="' + esc(d.example) + '" data-tooltip="读整句">' +
        highlightBase(d.example, d.past) + '</div>' +
        (d.exampleZh ? '<div class="iv-ex-zh">' + esc(d.exampleZh) + '</div>' : '') +
        '</div>' : '') +
      '</div>';
  }

  /* ===== 渲染 ===== */
  function renderList() {
    var box = $id('study-list');
    if (!box) return;
    var content = $('.study-content');
    if (content) content.classList.toggle('wide', state.singleCardMode);
    if (state.singleCardMode) { renderSingleCardStage(); return; }

    var cards = visibleCards();
    if (!cards.length) {
      box.innerHTML = '<div class="empty-state">这个型下没有卡片。</div>';
      return;
    }
    box.innerHTML = cards.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 12, 260) + 'ms">' +
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
    var cards = visibleCards();
    if (!cards.length) { box.innerHTML = '<div class="empty-state">这个型下没有卡片。</div>'; return; }
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
    var cards = visibleCards();
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
  function playBase(card) {
    var d = card.data || {};
    cardAPI.track('audio_play', card.id);
    var text = d.base || d.anchor || '';
    if (!text) { showToast('这张卡没有可朗读的内容', true); return; }
    warnIfNoVoice();
    voiceMgr.speak(text, VOICE_LANG);
  }
  function playSentence(card, sentence) {
    if (!sentence) return;
    cardAPI.track('word_play', card.id);
    warnIfNoVoice();
    voiceMgr.speak(sentence, VOICE_LANG);
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

  /* ===== 顶栏 ===== */
  function renderGroupSeg() {
    var box = $id('group-seg');
    if (!box) return;
    var opts = [{ id: 'all', label: '全部' }].concat(GROUPS.map(function (g) {
      return { id: g, label: g };
    }));
    box.innerHTML = opts.map(function (o) {
      return '<button type="button" data-group="' + o.id + '"' + (state.group === o.id ? ' class="on"' : '') + '>' +
        esc(o.label) + '</button>';
    }).join('');
  }
  function setGroup(g) {
    state.group = g;
    try { localStorage.setItem(LS + 'group', g); } catch (e) {}
    state.singleCardMode = false;
    state.singleCardIndex = 0;
    var cv = $id('card-view-btn');
    if (cv) cv.classList.remove('active');
    renderGroupSeg();
    renderList();
    updateStatsText();
    var s = $id('study-scroll');
    if (s) s.scrollTop = 0;
  }
  function setQuiz(on) {
    state.quiz = !!on;
    state.revealed = {};
    try { localStorage.setItem(LS + 'quiz', state.quiz ? '1' : '0'); } catch (e) {}
    var btn = $id('quiz-btn');
    if (btn) btn.classList.toggle('active', state.quiz);
    renderList();
    showToast(state.quiz ? '自测模式：过去式/过去分词已藏起，点格子对照' : '已退出自测模式');
  }

  /* ===== 事件委托 ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 例句朗读 */
      var sayEl = target.closest('[data-say]');
      if (sayEl) {
        e.stopPropagation();
        var sCardEl = sayEl.closest('[data-card-id]');
        var sCard = sCardEl ? findCard(sCardEl.dataset.cardId) : null;
        if (sCard) playSentence(sCard, sayEl.dataset.say);
        return;
      }
      /* 自测揭开（只揭这一格，不动别的卡） */
      var revEl = target.closest('[data-reveal]');
      if (revEl) {
        e.stopPropagation();
        var rCardEl = revEl.closest('[data-card-id]');
        if (rCardEl) {
          var key = rCardEl.dataset.cardId + '#' + revEl.dataset.reveal;
          state.revealed[key] = true;
          patchCard(findCard(rCardEl.dataset.cardId));
        }
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
          if (action === 'play') playBase(card);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }
      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

      /* 五型筛选 */
      var gBtn = target.closest('#group-seg button');
      if (gBtn) { setGroup(gBtn.dataset.group); return; }

      /* 自测开关 */
      if (target.closest('#quiz-btn')) { setQuiz(!state.quiz); return; }

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

    var qb = $id('quiz-btn');
    if (qb) qb.classList.toggle('active', state.quiz);

    renderGroupSeg();
    renderList();

    loadAll().then(function () {
      renderGroupSeg();
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
