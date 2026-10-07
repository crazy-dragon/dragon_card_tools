/* ==========================================================================
   音标拼读 · 小工具
   --------------------------------------------------------------------------
   一个工具，两种卡（顶栏分段切换）：
     ipa  音标 48   —— 数据字段 sym / cat / spell / ex / tip
     ph   拼读 109  —— 数据字段 sec / pattern / sound / rule / ex / tip
   哪张卡属于哪一组写在**数据里**（cards.json 每张卡一个 kind 字段），工具不猜。
   老的 ipa-cards / phonics-cards 是两个工具、两份逐字节相同的 assets，这里合成一个
   —— 它们本来就共用同一套音素录音。

   跟原版（复刻宿主：侧栏 → 目录分页 → 页签 → 每页 100 张）比，这一版：
     · 一次把整组读完（getPage(1, 500)），没有目录、没有页签、没有侧栏
     · 顶栏最左两个分段控件：**视图**（总览 / 卡片）+ **这一组**（音标 / 拼读）
     · 「总览」= 大格一览面（每行 5 格、格子大、留白足），**点一下直接发音**；
       「卡片」= 逐张读（要看要领 / 例词 / 常见拼写就切过去）；单卡模式已退役
     · 右边多一个「眼睛」控制卡面英文（默认关）
     · 三套皮肤（奶油 / 墨玻璃 / 分类彩）
     · 卡面 = P4 版面：列宽 620、文字 ×1.45、按钮钉右上角、例词与音标同排

   ★ 发音分两条通道：
       音素 -> assets/phonemes/<clip>.mp3（soundsamerican.net，48 段真录音）
       单词 -> 浏览器 speechSynthesis
   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '音标拼读';
  var VIEWS = (TOOL.views && TOOL.views.length) ? TOOL.views : [
    { id: 'chart', label: '总览' },
    { id: 'card',  label: '卡片' }
  ];
  var KINDS = (TOOL.kinds && TOOL.kinds.length) ? TOOL.kinds : [
    { id: 'ipa', label: '音标', count: 48 },
    { id: 'ph', label: '拼读', count: 109 }
  ];
  var PAGE_SIZE = 500;   /* 一次读完：48+1 / 109+1 张，远小于这个数 */

  /* 皮肤：只换颜色不动版式，具体色值在 app.css 第 11 节 */
  var SKINS = [
    { id: 'cream', name: '奶油', icon: 'fa-sun' },
    { id: 'glass', name: '墨玻璃', icon: 'fa-moon' },
    { id: 'category', name: '分类彩', icon: 'fa-gem' }
  ];

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],                  /* 全部卡：[{id, data, is_unknown, is_favorite, _kind}] */
    view: 'chart',            /* chart = 总览（一览面） / card = 卡片（逐张读） */
    kind: 'ipa',
    eye: false,               /* false = 关掉英文（默认） */
    skin: 'cream',
    fontSize: 1,
    soundEnabled: true
  };
  try {
    var savedView = localStorage.getItem('dc-phonetics-view');
    if (savedView && VIEWS.some(function (v) { return v.id === savedView; })) state.view = savedView;
  } catch (e) {}
  try { if (localStorage.getItem('dc-phonetics-kind') === 'ph') state.kind = 'ph'; } catch (e) {}
  try { state.eye = localStorage.getItem('dc-phonetics-eye') === '1'; } catch (e) {}
  try {
    var savedSkin = localStorage.getItem('dc-phonetics-skin');
    if (savedSkin) state.skin = savedSkin;
  } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem('dc-phonetics-font')) || 1; } catch (e) {}
  try { state.soundEnabled = localStorage.getItem('dc-sound') !== '0'; } catch (e) {}

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function stripSlash(s) { return String(s == null ? '' : s).replace(/^\/|\/$/g, '').trim(); }

  /* ==========================================================================
     音素录音表：卡组里的符号 -> soundsamerican.net 的录音文件名
     --------------------------------------------------------------------------
     来源 https://soundsamerican.net/data-ipa-chart/phonemes.mp3（一个 51 秒 sprite）
     切出的 48 段落在 assets/phonemes/。授权 CC BY-NC-ND 4.0：自用可以，
     **不可再分发、不可商用**，所以这份音频不进 git（见 ../.gitignore）。

     clip    = assets/phonemes/<clip>.mp3
     alt     = 该音素在美音里的写法（卡组 tip 里已写明这几个）
     cluster 美音把它当连缀而不是独立音位（/ts/ /dz/ /tr/ /dr/）：播放键改为读第一个例词
     none    美音没有这个音（/ʊə/）：同上
     ========================================================================== */
  var PHONEMES = {
    /* 元音 20 */
    'iː': { clip: 'tense_i' },
    'i':  { clip: 'tense_i', alt: '/i/' },       /* 拼读卡 happy-y 用 */
    'ɪ': { clip: 'lax_i' },
    'e': { clip: 'e' },
    'æ': { clip: 'ae' },
    'ɜː': { clip: 'ur', alt: '/ɝ/' },
    'ə': { clip: 'schwa' },
    'ɑː': { clip: 'ar', alt: '/ɑr/' },           /* 用 ar 而不是 ɑ：避开与 /ɒ/ 撞同一段 */
    'ɔː': { clip: 'or', alt: '/ɔr/' },
    'ɒ':  { clip: 'a',  alt: '/ɑː/' },
    'ʊ': { clip: 'lax_u' },
    'uː': { clip: 'tense_u' },
    'ʌ': { clip: 'uh' },
    'eɪ': { clip: 'ei' },
    'aɪ': { clip: 'ai' },
    'ɔɪ': { clip: 'oi' },
    'ɪə': { clip: 'ir', alt: '/ɪr/' },
    'eə': { clip: 'er', alt: '/ɛr/' },
    'ʊə': { clip: null, none: true },
    'əʊ': { clip: 'oh', alt: '/oʊ/' },
    'aʊ': { clip: 'au' },
    /* 辅音 28 */
    'p': { clip: 'p' }, 't': { clip: 't' }, 'k': { clip: 'k' }, 'f': { clip: 'f' },
    's': { clip: 's' }, 'θ': { clip: 'voiceless_th' }, 'ʃ': { clip: 'sh' }, 'tʃ': { clip: 'ch' },
    'ts': { clip: null, cluster: true }, 'tr': { clip: null, cluster: true },
    'b': { clip: 'b' }, 'd': { clip: 'd' }, 'ɡ': { clip: 'g' }, 'g': { clip: 'g' },
    'v': { clip: 'v' }, 'z': { clip: 'z' }, 'ð': { clip: 'voiced_th' }, 'ʒ': { clip: 'zh' },
    'dʒ': { clip: 'dzh' }, 'dz': { clip: null, cluster: true }, 'dr': { clip: null, cluster: true },
    'm': { clip: 'm' }, 'n': { clip: 'n' }, 'ŋ': { clip: 'ng' }, 'h': { clip: 'h' },
    'l': { clip: 'l' }, 'r': { clip: 'r' }, 'j': { clip: 'yod' }, 'w': { clip: 'w' }
  };
  var PHONEME_DIR = 'assets/phonemes/';

  function phonemeOf(sym) { return PHONEMES[stripSlash(sym)] || null; }

  /* ===== 真录音播放（音素） =====
     与 voiceMgr.speak 是两条独立通道：这里不碰 speechSynthesis。
     同一个 Audio 实例复用，连点不会叠出好几只。
     onFail：文件不在（比如那份**故意不带音频**的构建）时回调 —— 别静默失败，
     否则点 🔊 没有任何反应，用户只会当成坏按钮。 */
  var clipPlayer = (function () {
    var el = null, btn = null, timer = null;
    function stopMark() {
      if (btn) btn.classList.remove('playing');
      btn = null;
      clearTimeout(timer);
    }
    return {
      play: function (clip, button, ms, onFail) {
        stopMark();
        if (!el) el = new Audio();
        var failed = false;
        el.onerror = function () {
          if (failed) return;
          failed = true;
          stopMark();
          if (onFail) onFail();
        };
        el.src = PHONEME_DIR + clip + '.mp3';
        btn = button || null;
        if (btn) btn.classList.add('playing');
        try { el.currentTime = 0; } catch (e) {}
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
        timer = setTimeout(stopMark, ms || 1400);
      },
      stop: stopMark
    };
  })();

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

  /* ===== 音色（只用于**单词**发音；音素走真录音） ===== */
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
    sampleText: function () { return 'Hello world'; },
    speak: function (text, lang) {
      if (!('speechSynthesis' in window)) return;
      var u = new SpeechSynthesisUtterance(text || '');
      var voice = this.pickVoice(lang || 'en');
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
    var lang = voiceMgr._currentLang;
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === lang; });
    /* 隐藏「变声玩具」音色；若该语言下全是玩具（理论上不会）就退回完整列表，免得下拉空掉 */
    var realVoices = voices.filter(function (v) { return !voiceMgr.isToy(v); });
    if (realVoices.length) voices = realVoices;
    var pick = voiceMgr.pickVoice(lang);
    var activeUri = pick ? pick.voiceURI : null;

    if (!voices.length) {
      var empty = document.createElement('div');
      empty.className = 'voice-option muted';
      empty.textContent = '系统里没找到英文音色，点一下用默认的试听。';
      empty.addEventListener('click', function () {
        voiceMgr.saveVoice(lang, null);
        voiceMgr.speak(voiceMgr.sampleText(), lang);
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
    try { localStorage.setItem('dc-phonetics-skin', state.skin); } catch (e) {}
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

  /* ===== 眼睛：控制卡面英文（默认关） =====
     关掉的是「英文解释」：类别英文名、拼读卡那句英文 rule、引导卡的英文标题。
     保留「学习内容」：音标符号、例词与例词音标、中文要领。 */
  function applyEye() {
    document.documentElement.classList.toggle('eye-off', !state.eye);
    var btn = $id('eye-btn');
    if (btn) {
      btn.classList.toggle('on', state.eye);
      var i = btn.querySelector('i');
      if (i) i.className = state.eye ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
      btn.setAttribute('data-tooltip', state.eye ? '正在显示英文 · 点击隐藏' : '英文已隐藏 · 点击显示');
    }
    try { localStorage.setItem('dc-phonetics-eye', state.eye ? '1' : '0'); } catch (e) {}
  }

  /* ===== 字号：只动卡内文字（--card-font-scale），不动卡盒 ===== */
  function applyCardFont() {
    document.documentElement.style.setProperty('--card-font-scale', String(state.fontSize));
    var v = $id('font-size-value');
    if (v) v.textContent = Math.round(state.fontSize * 100) + '%';
    try { localStorage.setItem('dc-phonetics-font', state.fontSize); } catch (e) {}
  }

  /* ===== 数据 ===== */
  function kindOf(card) {
    var d = card.data || {};
    if (d.kind === 'ipa' || d.kind === 'ph') return d.kind;
    /* 兜底：老数据没有 kind 字段，按特征认 */
    return (d.pattern != null || d.sec != null) ? 'ph' : 'ipa';
  }
  function loadAll() {
    if (!window.cardAPI || !cardAPI.getPage) return Promise.resolve();
    return cardAPI.getPage(1, PAGE_SIZE).then(function (d) {
      state.all = (d.cards || []).map(function (c) {
        c._kind = kindOf(c);
        return c;
      });
    });
  }
  function currentKind() {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].id === state.kind) return KINDS[i];
    return KINDS[0];
  }
  function currentCards() {
    return state.all.filter(function (c) { return c._kind === state.kind; });
  }
  function findCard(id) {
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) return state.all[i];
    return null;
  }
  function updateStatsText() {
    var cards = currentCards();
    var marked = cards.filter(function (c) { return c.is_unknown === 1; }).length;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + cards.length;
  }
  function renderKindSeg() {
    var box = $id('kind-seg');
    if (!box) return;
    box.innerHTML = KINDS.map(function (k) {
      return '<button type="button" data-kind="' + k.id + '"' + (state.kind === k.id ? ' class="on"' : '') + '>' +
        esc(k.label) + '<b>' + k.count + '</b></button>';
    }).join('');
  }
  function renderViewSeg() {
    var box = $id('view-seg');
    if (!box) return;
    box.innerHTML = VIEWS.map(function (v) {
      return '<button type="button" data-view="' + v.id + '"' + (state.view === v.id ? ' class="on"' : '') + '>' +
        esc(v.label) + '</button>';
    }).join('');
  }
  /* 总览视图 = 变更宽的一览面（1160px）；卡片视图仍是 620 的卡片列。 */
  function setView(id) {
    if (!VIEWS.some(function (v) { return v.id === id; })) return;
    if (state.view === id) return;
    state.view = id;
    try { localStorage.setItem('dc-phonetics-view', id); } catch (e) {}
    renderViewSeg();
    renderList();
    updateStatsText();
    var s = $id('study-scroll');
    if (s) s.scrollTop = 0;
  }

  /* ==========================================================================
     卡面
     ========================================================================== */
  var IPA_CAT = {
    '单元音': '#2f6ac0', '双元音': '#7c44b4', '清辅音': '#0e8f84',
    '浊辅音': '#c2572d', '鼻音': '#b03a48', '半辅音': '#5a8a1f'
  };
  var IPA_CAT_EN = {
    '单元音': 'monophthongs', '双元音': 'diphthongs', '清辅音': 'voiceless',
    '浊辅音': 'voiced', '鼻音': 'nasals', '半辅音': 'semi-vowels & others'
  };
  var PH_SEC = {
    '字母基础': '#2f6ac0', '字母组合': '#7c44b4', '音节重音': '#0e8f84', '人名地名': '#c2572d'
  };
  var PH_SEC_EN = {
    '字母基础': 'single letters', '字母组合': 'letter teams',
    '音节重音': 'syllables & stress', '人名地名': 'names & places'
  };

  function firstWord(card) {
    var ex = card && card.data && card.data.ex;
    return (ex && ex.length && ex[0] && ex[0][0]) || '';
  }
  /* 这颗胶囊：该音素的美音写法 / 或「美音不把它当独立音位」。
     措辞跟卡组 tip 里那几句对齐（「美音卷舌 /ɝ/」/「美音读 /ɑː/」/「美音多读 /ɪr/」）。 */
  function altPill(ph) {
    if (!ph) return '<span class="dc-alt none">组合音</span>';
    if (ph.none) return '<span class="dc-alt none">美音无此音</span>';
    if (ph.cluster) return '<span class="dc-alt none">美音作连缀</span>';
    if (ph.alt) return '<span class="dc-alt">美音 ' + esc(ph.alt) + '</span>';
    return '';
  }
  function audioButton(ph, word) {
    var tip = ph && ph.clip ? '播放音素'
      : (word ? '美音没有这个独立音 · 改读「' + word + '」' : '美音没有这个独立音');
    return '<button type="button" class="dc-audio" data-action="play-sound" data-tooltip="' + esc(tip) + '">' +
      '<i class="fa-solid fa-volume-high"></i></button>';
  }
  function markButton(card) {
    var on = card.is_unknown === 1;
    return '<button type="button" data-action="mark" data-tooltip="' + (on ? '取消标记' : '标记为不认识') + '">' +
      '<i class="' + (on ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>';
  }
  function favButton(card) {
    var on = card.is_favorite === 1;
    return '<button type="button" data-action="favorite" data-tooltip="' + (on ? '取消收藏' : '收藏') + '">' +
      '<i class="' + (on ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>';
  }
  function chips(ex) {
    return (ex || []).map(function (p) {
      return '<span class="dc-chip" data-word="' + esc(p[0]) + '" data-tooltip="读 ' + esc(p[0]) + '">' +
        '<span class="w">' + esc(p[0]) + '</span><span class="p">/' + esc(p[1]) + '/</span></span>';
    }).join('');
  }

  /* ----- 引导卡（每组一张，共 2 张）：标题 + 一句话 + 算式 + 色标 + 怎么用 ----- */
  function renderIntro(d, card) {
    var isIpa = (d.kind === 'ph') ? false : true;
    var catMap = isIpa ? IPA_CAT : PH_SEC;
    var keys = d.keys || [];
    var legend = keys.map(function (k) {
      return '<span class="lg"><i style="background:' + (catMap[k] || '#94a3b8') + '"></i>' + esc(k) + '</span>';
    }).join('');
    /* "48 音 = 20 元音 + 28 辅音" -> [48 音][=][20 元音][+][28 辅音] */
    var segs = String(d.formula || '').split(/\s*([=+])\s*/);
    var fml = segs.map(function (s) {
      if (s === '=' || s === '+') return '<span>' + s + '</span>';
      return s ? '<b>' + esc(s) + '</b>' : '';
    }).join('');
    return '<div class="dc-intro" data-card-id="' + card.id + '">' +
      '<h2>' + esc(d.nameZh || '') +
        (d.nameEn ? ' <span class="en">· ' + esc(d.nameEn) + '</span>' : '') + '</h2>' +
      '<div class="lead">' + esc(d.lead || '') + '</div>' +
      '<div class="formulas"><div class="fml">' + fml + '</div></div>' +
      '<div class="legend">' + legend + '</div>' +
      '<div class="use">' + esc(d.howto || '') + '</div>' +
    '</div>';
  }

  /* ----- 正文卡 ----- */
  function renderCard(card) {
    var d = card.data || {};
    if (d.type === 'intro') return renderIntro(d, card);

    var isIpa = card._kind === 'ipa';
    var ph = phonemeOf(isIpa ? d.sym : d.sound);
    var w = firstWord(card);
    var acts = '<div class="dc-acts">' + audioButton(ph, w) + markButton(card) + favButton(card) + '</div>';

    if (isIpa) {
      var color = IPA_CAT[d.cat] || '#64748b';
      return '<div class="ipa-root" data-card-id="' + card.id + '" style="--cat:' + color + '">' + acts +
        '<div class="dc-top"><span class="dc-tag">' + esc(d.cat) + '</span>' +
          '<span class="dc-tag-en">' + esc(IPA_CAT_EN[d.cat] || '') + '</span></div>' +
        '<div class="dc-main"><span class="ipa-sym">' + esc(d.sym) + '</span>' + altPill(ph) +
          '<div class="dc-chips">' + chips(d.ex) + '</div></div>' +
        '<div class="dc-sub"><b>常见拼写</b> · ' + esc(d.spell) + '</div>' +
        '<div class="dc-tip">' + esc(d.tip) + '</div>' +
      '</div>';
    }

    var color2 = PH_SEC[d.sec] || '#64748b';
    return '<div class="ph-root" data-card-id="' + card.id + '" style="--cat:' + color2 + '">' + acts +
      '<div class="dc-top"><span class="dc-tag">' + esc(d.sec) + '</span>' +
        '<span class="dc-tag-en">' + esc(PH_SEC_EN[d.sec] || '') + '</span></div>' +
      '<div class="dc-main"><span class="ph-pat">' + esc(d.pattern) + '</span>' +
        '<span class="ph-sound">' + esc(d.sound) + '</span>' + altPill(ph) +
        '<div class="dc-chips">' + chips(d.ex) + '</div></div>' +
      '<div class="dc-sub en">' + esc(d.rule) + '</div>' +
      '<div class="dc-tip">' + esc(d.tip) + '</div>' +
    '</div>';
  }

  /* ==========================================================================
     总览（一览面）
     --------------------------------------------------------------------------
     这一版是给**入门**的人看的：每行 5 格、格子大、留白足，一眼看得清。
     **点一下就发音**，不弹窗 —— 想看这张卡的要领 / 例词 / 常见拼写，
     切到「卡片」视图慢慢看。

     音标 48 —— 元音 20（单元音 / 双元音）在前，辅音 28 在后。
       辅音按 **清浊成对** 相邻排：p b / t d / k ɡ / f v / s z / θ ð / ʃ ʒ /
       tʃ dʒ / ts dz / tr dr —— 一对两格，口型一样、只差声带振不振动；
       格子里直接写着类别名（清辅音 / 浊辅音 / 鼻音 / 半辅音），不必记颜色。
     拼读 109 —— 按数据里的 sec 分四段，格子里写「拼写 → 读音」。
     ========================================================================== */
  /* 辅音的排列：清浊成对的按 塞音 → 摩擦音 → 破擦音 排，**每两对后面跟一个
     不成对的音**（m n ŋ h l r j w）。为什么这么绕着排：一行 5 格是奇数，
     10 对（每对 2 格）直着排总有一对会被行断开；2 对 + 1 单音刚好 5 格，
     每一对清浊就永远挨在一起。两串都没收的音按原顺序接到队尾，不会凭空消失。 */
  var CONS_PAIRS = [
    ['p', 'b'], ['t', 'd'], ['k', 'ɡ'],
    ['f', 'v'], ['s', 'z'], ['θ', 'ð'], ['ʃ', 'ʒ'],
    ['tʃ', 'dʒ'], ['ts', 'dz'], ['tr', 'dr']
  ];
  var CONS_OTHER = ['m', 'n', 'ŋ', 'h', 'l', 'r', 'j', 'w'];
  var VOWEL_CATS = ['单元音', '双元音'];

  function chartMarks(card) {
    var h = '';
    if (card.is_favorite === 1) h += '<span class="mk fav"><i class="fa-solid fa-bookmark"></i></span>';
    if (card.is_unknown === 1) h += '<span class="mk star"><i class="fa-solid fa-star"></i></span>';
    return h;
  }
  /* 子块小标题（单元音 / 双元音 / 清浊成对 / 鼻音·半辅音） */
  function subHead(label, n, hint) {
    return '<div class="ep-sub">' + esc(label) +
      '<span class="n">' + n + '</span>' +
      (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
  }
  /* 音标格：符号（大）+ 类别名（小）；分类色仍走行内 --cat。
     悬停给出前 3 个例词 —— 想细看切「卡片」视图。 */
  function ipaCellHtml(card) {
    var d = card.data || {};
    var color = IPA_CAT[d.cat] || '#64748b';
    var ex = (d.ex || []).slice(0, 3).map(function (p) { return p[0]; }).filter(Boolean).join(' / ');
    return '<button type="button" class="ep-cell ep-ipa' + (card.is_unknown === 1 ? ' is-marked' : '') + '"' +
      ' style="--cat:' + color + '" data-card-id="' + card.id + '" data-act="cell"' +
      (ex ? ' data-tooltip="例词 ' + esc(ex) + '"' : '') + '>' +
      chartMarks(card) + '<span class="s">' + esc(d.sym) + '</span>' +
      '<span class="c">' + esc(d.cat) + '</span></button>';
  }
  /* 拼读格：拼写（大）+ 读音（小）。 */
  function phCellHtml(card) {
    var d = card.data || {};
    var color = PH_SEC[d.sec] || '#64748b';
    return '<button type="button" class="ep-cell ep-ph' + (card.is_unknown === 1 ? ' is-marked' : '') + '"' +
      ' style="--cat:' + color + '" data-card-id="' + card.id + '" data-act="cell"' +
      ' data-tooltip="' + esc('读 ' + stripSlash(d.sound)) + '">' +
      chartMarks(card) + '<span class="p">' + esc(d.pattern) + '</span>' +
      '<span class="s">' + esc(d.sound) + '</span></button>';
  }

  function ipaChartHtml(cards) {
    var all = cards.filter(function (c) {
      var d = c.data || {};
      return d.type !== 'intro' && d.sym != null;
    });
    var bySym = {};
    all.forEach(function (c) { bySym[stripSlash(c.data.sym)] = c; });
    var used = {};
    function take(sym) { var c = bySym[sym]; if (c) used[sym] = 1; return c; }

    var h = '';
    /* --- 元音：单元音 / 双元音 各一块 --- */
    var vn = all.filter(function (c) { return VOWEL_CATS.indexOf(c.data.cat) >= 0; }).length;
    h += '<div class="ep-sect">';
    h += '<div class="ep-sect-h">元音<span class="n">' + vn + '</span>' +
      '<span class="hint">单元音看长短，双元音是两个音滑过去</span></div>';
    VOWEL_CATS.forEach(function (cat) {
      var list = all.filter(function (c) { return c.data.cat === cat; });
      if (!list.length) return;
      h += subHead(cat, list.length, cat === '单元音' ? '长短成对' : '前重后轻');
      h += '<div class="ep-grid">' + list.map(ipaCellHtml).join('') + '</div>';
    });
    h += '</div>';

    /* --- 辅音：清浊成对相邻（每两对 + 一个单音 = 一行 5 格） --- */
    var consAll = all.filter(function (c) { return VOWEL_CATS.indexOf(c.data.cat) < 0; });
    var seq = [], si = 0;
    CONS_PAIRS.forEach(function (pair, i) {
      pair.forEach(function (sym) { var c = take(sym); if (c) seq.push(c); });
      if (i % 2 === 1 && si < CONS_OTHER.length) {
        var solo = take(CONS_OTHER[si++]);
        if (solo) seq.push(solo);
      }
    });
    while (si < CONS_OTHER.length) {
      var rest = take(CONS_OTHER[si++]);
      if (rest) seq.push(rest);
    }
    consAll.forEach(function (c) { if (!used[stripSlash(c.data.sym)]) seq.push(c); });

    h += '<div class="ep-sect">';
    h += '<div class="ep-sect-h">辅音<span class="n">' + consAll.length + '</span>' +
      '<span class="hint">清浊成对紧挨着：左清右浊，口型一样、只差声带振不振动（不成对的鼻音 / 半辅音跟在后面）</span></div>';
    h += '<div class="ep-grid">' + seq.map(ipaCellHtml).join('') + '</div>';
    h += '</div>';
    return h;
  }

  function phChartHtml(cards) {
    var secs = [], bySec = {};
    cards.forEach(function (c) {
      var d = c.data || {};
      if (d.type === 'intro') return;
      var k = d.sec || '其它';
      if (!bySec[k]) { bySec[k] = []; secs.push(k); }
      bySec[k].push(c);
    });
    var h = '';
    secs.forEach(function (k) {
      var list = bySec[k];
      h += '<div class="ep-sect">';
      h += '<div class="ep-sect-h">' + esc(k) + '<span class="n">' + list.length + '</span>' +
        (PH_SEC_EN[k] ? '<span class="hint en">' + esc(PH_SEC_EN[k]) + '</span>' : '') + '</div>';
      h += '<div class="ep-grid">' + list.map(phCellHtml).join('') + '</div>';
      h += '</div>';
    });
    return h;
  }

  function renderChart() {
    var box = $id('study-list');
    if (!box) return;
    var cards = currentCards();
    if (!cards.length) {
      box.innerHTML = '<div class="empty-state">这一组还没有卡片。</div>';
      return;
    }
    var intro = null;
    cards.forEach(function (c) { if (!intro && (c.data || {}).type === 'intro') intro = c; });
    var h = '<div class="ep-chart enter">';
    if (intro) {
      var d = intro.data;
      h += '<div class="ep-lead"><i class="fa-solid fa-circle-info"></i><span>' + esc(d.lead || '') + '</span>' +
        (d.formula ? '<b>' + esc(d.formula) + '</b>' : '') + '</div>';
    }
    h += (state.kind === 'ipa') ? ipaChartHtml(cards) : phChartHtml(cards);
    h += '<div class="ep-note">点一下直接发音 · 想看要领 / 例词 / 常见拼写，切到「卡片」视图</div>';
    h += '</div>';
    box.innerHTML = h;
  }

  /* ==========================================================================
     渲染
     ========================================================================== */
  function renderList() {
    var box = $id('study-list');
    if (!box) return;
    var content = $('.study-content');
    /* 一览面要宽（1160px），卡片视图仍是 620 的卡片列 */
    if (content) content.classList.toggle('chart-wide', state.view === 'chart');
    if (state.view === 'chart') { renderChart(); return; }
    var cards = currentCards();
    if (!cards.length) {
      box.innerHTML = '<div class="empty-state">这一组还没有卡片。</div>';
      return;
    }
    box.innerHTML = cards.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 18, 300) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }
  /* 标记 / 收藏之后，把一览面的格子和列表里的卡都刷一遍（只重画这一张 ——
     整列表重渲染会让动画重放、滚动发抖）。 */
  function patchCard(card) {
    patchCell(card);
    if (state.view !== 'card') return;
    var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
  }
  /* 格子只更新标记态，不重建 DOM */
  function patchCell(card) {
    var el = document.querySelector('#study-list .ep-cell[data-card-id="' + card.id + '"]');
    if (!el) return;
    el.classList.toggle('is-marked', card.is_unknown === 1);
    var old = el.querySelectorAll('.mk');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    el.insertAdjacentHTML('afterbegin', chartMarks(card));
  }

  /* ==========================================================================
     卡片交互
     ========================================================================== */
  /* 播放一个音素：
       有录音          -> 放录音
       美音没有这个音   -> 读第一个例词
       录音文件不在     -> 同样退化读例词 + 提示（「不带音频」的那份构建走这条） */
  function handlePlaySound(card, button) {
    var d = card.data || {};
    var ph = phonemeOf(card._kind === 'ipa' ? d.sym : d.sound);
    var word = firstWord(card);
    cardAPI.track('audio_play', card.id);
    if (ph && ph.clip) {
      clipPlayer.play(ph.clip, button, 1400, function () {
        if (!word) { showToast('音频文件缺失', true); return; }
        voiceMgr.speak(word, 'en');
        showToast('没装音频文件 —— 改读「' + word + '」', false);
      });
      return;
    }
    if (word) {
      voiceMgr.speak(word, 'en');
      showToast('美音没有 /' + stripSlash(card._kind === 'ipa' ? d.sym : d.sound) + '/ 这个独立音 —— 改读「' + word + '」', false);
    } else {
      showToast('这张卡没有可播放的音频', true);
    }
  }
  function handlePlayWord(card, word) {
    cardAPI.track('word_play', card.id);
    voiceMgr.speak(word, 'en');
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

  /* ===== 事件委托（一处绑完，重渲染不用重绑） ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 一览面的格子（先判：格子里面还有 .s / .mk 等子节点）-> **直接发音**。
         想看这张卡的完整内容（要领 / 例词 / 常见拼写）请切到「卡片」视图。 */
      var cell = target.closest('.ep-cell[data-act="cell"]');
      if (cell) {
        e.stopPropagation();
        var cellCard = findCard(cell.dataset.cardId);
        if (cellCard) handlePlaySound(cellCard, cell);
        return;
      }

      /* 例词胶囊（先于 data-action 判，胶囊上没有 data-action） */
      var chip = target.closest('[data-word]');
      if (chip) {
        e.stopPropagation();
        var chipCardEl = chip.closest('[data-card-id]');
        var chipCard = chipCardEl ? findCard(chipCardEl.dataset.cardId) : null;
        if (chipCard) handlePlayWord(chipCard, chip.dataset.word);
        return;
      }

      /* 卡片动作按钮（play-sound / mark / favorite） */
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl = actionBtn.closest('[data-card-id]');
        var card = cardEl ? findCard(cardEl.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          if (action === 'play-sound') handlePlaySound(card, actionBtn);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }

      /* 总览 / 卡片 */
      var viewBtn = target.closest('#view-seg button');
      if (viewBtn) { setView(viewBtn.dataset.view); return; }

      /* 音标 / 拼读 切换 */
      var kindBtn = target.closest('#kind-seg button');
      if (kindBtn) { selectKind(kindBtn.dataset.kind); return; }

      /* 眼睛 */
      if (target.closest('#eye-btn')) {
        state.eye = !state.eye;
        applyEye();
        return;
      }

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
        voiceMgr.saveVoice('en', picked);
        renderVoiceDropdown();
        $('.voice-dropdown').style.display = 'none';
        voiceMgr.speak(voiceMgr.sampleText(), 'en');
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

      /* 刷新：重新拉一次整组（标记状态可能被别处改过） */
      if (target.closest('#refresh-stats')) {
        if (!state._refreshLock) {
          state._refreshLock = true;
          loadAll().then(function () { renderList(); updateStatsText(); });
          showToast('已刷新');
          setTimeout(function () { state._refreshLock = false; }, 1000);
        }
        return;
      }

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
  }

  function selectKind(id) {
    if (!KINDS.some(function (k) { return k.id === id; })) return;
    if (state.kind === id) return;
    state.kind = id;
    try { localStorage.setItem('dc-phonetics-kind', id); } catch (e) {}
    renderKindSeg();
    renderList();
    updateStatsText();
    var s = $id('study-scroll');
    if (s) s.scrollTop = 0;
  }

  /* ===== 初始化 ===== */
  function init() {
    applySkin();
    applyEye();
    applyCardFont();
    initTooltip();
    voiceMgr.init();
    bindEvents();

    document.title = TITLE;
    var title = $id('study-deck-title');
    if (title) title.textContent = TITLE;

    renderViewSeg();
    renderKindSeg();
    renderList();

    loadAll().then(function () {
      renderViewSeg();
      renderKindSeg();
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
