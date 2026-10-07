/* ==========================================================================
   道德经 · 小工具
   ==========================================================================
   86 张 = 八十一章原文 + 5 张篇首导语（1 张总览 + 章句四篇各 1），一次读完。
   顶栏一个分段控件切两个视图：

     chart 概览   9 × 9 章图。81 = 9 × 9 是白送的；值钱的是每格能带出
                  河上公《老子道德经章句》给每章冠的**二字章题**（体道 / 象元 /
                  玄德…），所以格子里是「25 象元」而不是光秃秃的「25」——
                  每格自带语义，一屏之内八十一章的骨架全在眼前。
                  点格 / 点篇首胶囊 → **就地弹窗**看那张卡，关掉还在原位。
     card  列表   一张一张的完整卡。四篇导语排在各篇开头（数据里就按显示序排好）。

   ★ 卡片是**单面**的：没有翻面，也没有翻面按钮。原文就是学习内容本身，
     始终显示 —— 与 japanese-gojuon（罗马字始终显示）、exam-vocab（用
     definition_view / example_view 代替 flip）同一路。用户 2026-09-30 拍板。
     因此动作栏恒为 3 个按钮：朗读 / 标记 / 收藏。

   ★ 辅助层三级，**没有第四级**：
       L1 原文（含每章 1 句加粗锚点）  L2 生僻字内联 ruby  L3 卡底折叠注（≈30 章）
     白话、英译、赏析、逐字释义一律不做 —— 那是教材的活。
     track 的动作因此是 audio_play / word_mark / favorite_toggle / note_view，
     没有 flip、没有 auto_play。宿主对 action 没有白名单（app.py 只校验非空），
     所以删掉 flip、新增 note_view 都不用动宿主。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '道德经';
  var PAGE_SIZE = 500;                    /* 86 张，一次读完 */

  var VIEWS = [
    { id: 'chart', label: '概览' },
    { id: 'card',  label: '列表' }
  ];

  var SKINS = [
    { id: 'cream', name: '宣纸', icon: 'fa-scroll' },
    { id: 'glass', name: '墨玻璃', icon: 'fa-moon' },
    { id: 'category', name: '篇章彩', icon: 'fa-layer-group' }
  ];

  /* 章句四篇 + 总览的配色类名。篇名不写死在这里，一律从数据里取。 */
  var PART_CLASS = {
    '总览': 'lj-p0',
    '章句第一': 'lj-p1',
    '章句第二': 'lj-p2',
    '章句第三': 'lj-p3',
    '章句第四': 'lj-p4'
  };
  var PART_ORDER = ['总览', '章句第一', '章句第二', '章句第三', '章句第四'];

  var T = {
    read: '朗读', mark: '标记', unmark: '取消标记',
    fav: '收藏', unfav: '取消收藏',
    noteTag: '注',
    close: '关闭（Esc）', jump: '在列表中查看',
    chartTip: '点开读这一章', ovTip: '点开看这一篇导语',
    empty: '还没有卡片。',
    noPlay: '这一章没有可朗读的内容'
  };

  var state = {
    deckId: (window.cardAPI || {}).deckId,
    userId: (window.cardAPI || {}).userId,
    all: [],
    view: 'chart',
    skin: 'cream',
    fontSize: 1,
    noteOpen: {}                 /* cardId -> true，折叠注展开状态 */
  };
  try {
    var sv = localStorage.getItem('dc-lj-view');
    if (sv && VIEWS.some(function (v) { return v.id === sv; })) state.view = sv;
  } catch (e) {}
  try {
    var ss = localStorage.getItem('dc-lj-skin');
    if (ss) state.skin = ss;
  } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem('dc-lj-font')) || 1; } catch (e) {}

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function plain(s) { return String(s == null ? '' : s).replace(/\*\*/g, ''); }

  /* 数字转汉字（朗读用：「第一章，体道」比「第 1 章」顺耳） */
  var CN_D = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function cnNum(n) {
    n = Number(n) || 0;
    if (n <= 10) return n === 10 ? '十' : CN_D[n];
    if (n < 20) return '十' + CN_D[n % 10];
    var t = Math.floor(n / 10), o = n % 10;
    return CN_D[t] + '十' + (o ? CN_D[o] : '');
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

  /* ===== 音色（键沿用本体的 dc-voice-<lang>） ===== */
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
    speak: function (text, tag) {
      if (!('speechSynthesis' in window)) { showToast('这个浏览器不支持朗读', true); return; }
      var u = new SpeechSynthesisUtterance(text || '');
      var voice = this.pickVoice(tag || 'zh-CN');
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
    var voices = voiceMgr.voices.filter(function (v) { return voiceMgr._primary(v.lang) === 'zh'; });
    /* 隐藏「变声玩具」音色；若该语言下全是玩具（理论上不会）就退回完整列表，免得下拉空掉 */
    var realVoices = voices.filter(function (v) { return !voiceMgr.isToy(v); });
    if (realVoices.length) voices = realVoices;
    var pick = voiceMgr.pickVoice('zh-CN');
    var activeUri = pick ? pick.voiceURI : null;
    if (!voices.length) {
      var empty = document.createElement('div');
      empty.className = 'voice-option muted';
      empty.textContent = '系统里没有中文音色，点一下用默认的试听。';
      empty.addEventListener('click', function () {
        voiceMgr.saveVoice('zh-CN', null);
        voiceMgr.speak('道可道，非常道。', 'zh-CN');
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
    try { localStorage.setItem('dc-lj-skin', state.skin); } catch (e) {}
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
    try { localStorage.setItem('dc-lj-font', state.fontSize); } catch (e) {}
  }

  /* ===== 视图 ===== */
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
    closeLjModal();
    if (state.view === id) return;
    state.view = id;
    try { localStorage.setItem('dc-lj-view', id); } catch (e) {}
    renderViewSeg();
    renderList();
    updateStatsText();
    var s = $id('study-scroll');
    if (s) s.scrollTop = 0;
  }

  /* ==========================================================================
     数据
     ========================================================================== */
  function isOverview(card) { return ((card.data || {}).type) === 'overview'; }
  function partOf(card) { return (card.data || {}).part || '总览'; }
  function partClass(card) { return PART_CLASS[partOf(card)] || 'lj-p0'; }
  function orderOf(card) {
    var d = card.data || {};
    return Number(d.chapter) || (d.item_order || 0);
  }

  function loadAll() {
    if (!window.cardAPI || !cardAPI.getPage) return Promise.resolve();
    return cardAPI.getPage(1, PAGE_SIZE).then(function (d) {
      state.all = (d.cards || []).slice();
      /* getPage 给的是**队列序**（current_order），必须按 item_order 排才是原始序 */
      state.all.sort(function (a, b) {
        return ((a.data || {}).item_order || 0) - ((b.data || {}).item_order || 0);
      });
    });
  }
  function findCard(id) {
    for (var i = 0; i < state.all.length; i++) if (String(state.all[i].id) === String(id)) return state.all[i];
    return null;
  }
  function chapters() {
    return state.all.filter(function (c) { return !isOverview(c); })
      .sort(function (a, b) { return orderOf(a) - orderOf(b); });
  }
  function overviews() {
    var list = state.all.filter(isOverview);
    list.sort(function (a, b) {
      var ia = PART_ORDER.indexOf(partOf(a)), ib = PART_ORDER.indexOf(partOf(b));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return list;
  }
  function updateStatsText() {
    var cards = state.all;
    var marked = cards.filter(function (c) { return c.is_unknown === 1; }).length;
    var el = $('#refresh-stats span');
    if (el) el.textContent = marked + ' / ' + cards.length;
  }

  /* ==========================================================================
     卡面文字：加粗锚点 + 内联 ruby + 按句读断行
     ==========================================================================
     ⚠️ 顺序不能反：**先 esc 再解析标记** —— esc 只转 & < > "，不动 `*`，
        所以 esc 后标记还在。反过来写会开 XSS 口子。
     断行：在句末标点后插 \n，配合 CSS 的 white-space: pre-wrap，
        整章自然排成「一句一行」（古籍的排法）。锚点不跨句末标点（数据侧已校验），
        所以断行不会切进 <b> 的中间。
     字号：ruby 的 rt 也吃 --kt —— 滑杆拉到 150% 时拼音必须跟着长。
     ========================================================================== */
  function renderText(raw, hints) {
    var segs = [];
    var rest = String(raw || '');
    while (true) {
      var a = rest.indexOf('**');
      if (a < 0) { if (rest) segs.push({ b: 0, s: rest }); break; }
      var b = rest.indexOf('**', a + 2);
      if (b < 0) { segs.push({ b: 0, s: rest }); break; }
      if (a > 0) segs.push({ b: 0, s: rest.slice(0, a) });
      segs.push({ b: 1, s: rest.slice(a + 2, b) });
      rest = rest.slice(b + 2);
    }
    /* 注音字定位：先拼出**去标记的字符流**，再按「第 n 次出现」找到下标 */
    var flat = segs.map(function (x) { return x.s; }).join('');
    var marks = {};
    (hints || []).forEach(function (h) {
      var want = h.pos || 1, n = 0;
      for (var k = 0; k < flat.length; k++) {
        if (flat.charAt(k) === h.ch) {
          n++;
          if (n === want) { if (marks[k] == null) marks[k] = h; break; }
        }
      }
    });
    var out = '', k = 0;
    segs.forEach(function (seg) {
      var inner = '';
      for (var j = 0; j < seg.s.length; j++, k++) {
        var ch = seg.s.charAt(j);
        if (ch === '。' || ch === '！' || ch === '？') {
          inner += esc(ch) + '\n';
        } else {
          var m = marks[k];
          inner += m ? '<ruby>' + esc(ch) + '<rt>' + esc(m.p) + '</rt></ruby>' : esc(ch);
        }
      }
      inner = inner.replace(/\n$/, '');
      out += seg.b ? '<b class="lj-key">' + inner + '</b>' : inner;
    });
    return out;
  }

  /* ==========================================================================
     卡面
     ========================================================================== */
  /* 动作栏恒为 3 个（没有翻面，所以不用像三十六计那样按卡型增减）。
     **不留空槽** —— 动作栏右对齐，右边缘钉死，少一个按钮只会让左边缘回缩。 */
  function actsHtml(card, withClose) {
    var markOn = card.is_unknown === 1;
    var favOn = card.is_favorite === 1;
    return '<div class="lj-acts">' +
      '<button type="button" data-action="play" data-tooltip="' + esc(T.read) + '">' +
        '<i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        esc(markOn ? T.unmark : T.mark) + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        esc(favOn ? T.unfav : T.fav) + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      (withClose ? '<button type="button" class="lj-modal-close" data-action="close" data-tooltip="' + esc(T.close) +
        '"><i class="fa-solid fa-xmark"></i></button>' : '') +
      '</div>';
  }

  /* 弹窗右下角留一条走回列表的老路（概览默认不跳列表，但产品上这条路还要有） */
  function modalFootHtml() {
    return '<div class="lj-modal-foot"><button type="button" class="lj-modal-jump" data-act="modal-jump">' +
      '<i class="fa-solid fa-list-ul"></i><span class="lj-modal-jump-t">' + esc(T.jump) + '</span></button></div>';
  }

  /* 富文本：只解析 **加粗**。
     给篇首导语的正文用 —— 那里是说明文字，按自然段排，**不做**按句读断行
     （renderText 是给经文用的）。顺序同样是先 esc 再 replace。 */
  function renderRich(s) {
    var parts = String(s == null ? '' : s).split('**');
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      out += (i % 2) ? '<b class="lj-key">' + esc(parts[i]) + '</b>' : esc(parts[i]);
    }
    return out;
  }

  function renderChapter(card, d, inModal) {
    var open = state.noteOpen[card.id] === true;
    var note = d.note ? (
      '<div class="lj-note' + (open ? ' open' : '') + '">' +
        '<button type="button" class="lj-note-btn" data-action="toggle-note">' +
          '<span class="lj-note-tri">▸</span>' +
          '<span class="lj-note-title">' + esc(T.noteTag) + '｜' + esc(d.noteTitle || '') + '</span>' +
        '</button>' +
        '<div class="lj-note-body">' + esc(d.note) + '</div>' +
      '</div>') : '';
    return '<div class="lj-root lj-chapter ' + partClass(card) +
        (inModal ? ' lj-modal-root' : '') + '" data-card-id="' + card.id + '">' +
      '<div class="lj-head">' +
        '<div class="lj-pos">' + esc(d.part || '') + ' · 第 ' + esc(String(d.chapter)) + ' 章</div>' +
        '<div class="lj-river">' + esc(d.riverTitle || '') + '</div>' +
      '</div>' +
      '<div class="lj-body">' + renderText(d.text, d.hints) + '</div>' +
      note +
      actsHtml(card, inModal) +
      (inModal ? modalFootHtml() : '') +
    '</div>';
  }

  function renderOverviewCard(card, d, inModal) {
    var body = String(d.body || '').split('\n').filter(function (x) { return x.trim(); })
      .map(function (p) { return '<p>' + renderRich(p) + '</p>'; }).join('');
    return '<div class="lj-root lj-overview ' + partClass(card) +
        (inModal ? ' lj-modal-root' : '') + '" data-card-id="' + card.id + '">' +
      '<div class="lj-ov-seal">' + esc((d.part || '').replace('章句第', '').replace('总览', '') || '道') + '</div>' +
      '<div class="lj-ov-title">' + esc(d.title || '') + '</div>' +
      '<div class="lj-ov-theme">' + esc(d.theme || '') + '</div>' +
      '<div class="lj-ov-body">' + body + '</div>' +
      actsHtml(card, inModal) +
      (inModal ? modalFootHtml() : '') +
    '</div>';
  }

  function renderCard(card, inModal) {
    var d = card.data || {};
    return isOverview(card) ? renderOverviewCard(card, d, inModal) : renderChapter(card, d, inModal);
  }

  /* ==========================================================================
     概览章图：9 × 9
     ==========================================================================
     · 行 = 章号的九个一组（1–9 / 10–18 / … / 73–81），行首标区间。
       与三十六计那张 6×6 不同：**行首没有分组语义** —— 章句四篇在 9 行里
       切不整齐（16→17 / 37→38 / 59→60 三处篇界都落在行中间），所以分组靠颜色表达：
       格子顶部 3px 篇色条，颜色一变就是一篇。
     · 篇首导语单独排一行胶囊在章图上方，点开就地弹窗 —— 否则 5 张导语卡
       在概览里没有落脚点。
     · 点格**不朗读**，朗读交给弹窗里的 🔊（看章图时太吵）。
     · 窄屏不硬挤：外层横向滚动，格子保底 82px。
     ========================================================================== */
  function overviewBarHtml() {
    var ovs = overviews();
    if (!ovs.length) return '';
    return '<div class="lj-ov-bar">' + ovs.map(function (c) {
      var d = c.data || {};
      return '<button type="button" class="lj-ov-chip ' + partClass(c) + '" data-act="open" data-card-id="' + c.id +
          '" data-tooltip="' + esc(T.ovTip) + '">' +
        '<span class="lj-ov-chip-t">' + esc(d.title || '') + '</span>' +
        (d.theme ? '<span class="lj-ov-chip-s">' + esc(d.theme) + '</span>' : '') +
      '</button>';
    }).join('') + '</div>';
  }

  /* ⚠️ 每个格子必须带**自己那一章**的篇色类（partClass）——不能靠从 .lj-c-row 继承：
     一行里可能跨篇（第二行 10–18 就横跨 16→17 这道篇界），继承的话整行只有一个色，
     「颜色表达分组」这件事就白做了。行首的类管行首文字，格子的类管格子。 */
  function chartCell(card) {
    var d = card.data || {};
    return '<button type="button" class="lj-c-cell ' + partClass(card) + '" data-act="open" data-card-id="' + card.id +
        '" data-tooltip="' + esc(T.chartTip) + '">' +
      (card.is_unknown === 1 ? '<span class="lj-c-star"><i class="fa-solid fa-star"></i></span>' : '') +
      (card.is_favorite === 1 ? '<span class="lj-c-fav"><i class="fa-solid fa-bookmark"></i></span>' : '') +
      '<span class="lj-c-no">' + esc(String(d.chapter == null ? '' : d.chapter)) + '</span>' +
      '<span class="lj-c-nm">' + esc(d.riverTitle || '') + '</span>' +
    '</button>';
  }

  function renderChart() {
    var box = $id('study-list');
    var cs = chapters();
    if (!cs.length) { box.innerHTML = '<div class="empty-state">' + esc(T.empty) + '</div>'; return; }
    var html = overviewBarHtml();
    html += '<div class="lj-c-wrap"><div class="lj-chart">';
    for (var i = 0; i < cs.length; i += 9) {
      var row = cs.slice(i, i + 9);
      var lo = orderOf(row[0]), hi = orderOf(row[row.length - 1]);
      html += '<div class="lj-c-row ' + partClass(row[0]) + '">';
      html += '<div class="lj-c-rh">' + esc(lo + '–' + hi) + '</div>';
      row.forEach(function (c) { html += chartCell(c); });
      /* 该行不足 9 章也补空位占住列宽（末行正好 9 张，留个保险） */
      for (var j = row.length; j < 9; j++) html += '<div class="lj-c-cell" style="visibility:hidden"></div>';
      html += '</div>';
    }
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

    var cards = state.all;
    if (!cards.length) { box.innerHTML = '<div class="empty-state">' + esc(T.empty) + '</div>'; return; }
    box.innerHTML = cards.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 12, 240) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
  }

  /* 只重画一张卡（标记/收藏/展开注后）：别整列表重渲染，否则动画重放、滚动也会抖 */
  function patchCard(card) {
    if (state.view !== 'card') return;
    var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
  }
  /* 章图里的同一张卡也要跟着变（星标 / 收藏角标） */
  function patchChartCell(card) {
    if (state.view !== 'chart') return;
    if (isOverview(card)) return;         /* 章图里没有导语卡（它们在胶囊条里） */
    var el = document.querySelector('#study-list .lj-c-cell[data-card-id="' + card.id + '"]');
    if (!el) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = chartCell(card);
    el.replaceWith(tmp.firstElementChild);
  }
  /* 一处改、三处跟：列表卡、章图格、弹窗里那张 */
  function refreshCard(card) {
    patchCard(card);
    patchChartCell(card);
    if (ljModalOpen()) patchLjModal(card);
  }

  /* ==========================================================================
     卡面弹窗（点章图的格子 / 篇首胶囊 / 行首）
     ==========================================================================
     遮罩 + 居中一张卡，卡面就是列表里那张（同一个 renderCard），只多 .lj-modal-root、
     轨道末尾的关闭钮、右下角「在列表中查看」。
     ========================================================================== */
  var modalCardId = null;

  function ljModalOpen() {
    var m = $id('lj-modal');
    return !!(m && !m.hidden);
  }
  function openLjModal(id) {
    var card = findCard(id);
    if (!card) return;
    var mask = $id('lj-modal');
    var box = $id('lj-modal-box');
    if (!mask || !box) return;
    modalCardId = String(card.id);
    box.innerHTML = renderCard(card, true);
    mask.hidden = false;
    box.scrollTop = 0;
    document.body.classList.add('lj-modal-open');
    try { box.focus(); } catch (e) {}
  }
  function closeLjModal() {
    var mask = $id('lj-modal');
    if (!mask || mask.hidden) return;
    mask.hidden = true;
    /* 顺手清掉卡面：留着的话弹窗里那张会一直挂在 DOM 上，
       外部按 [data-card-id] 计数/取样式时就会多出一份 */
    var box = $id('lj-modal-box');
    if (box) box.innerHTML = '';
    modalCardId = null;
    document.body.classList.remove('lj-modal-open');
  }
  /* 标记/收藏/展开注后只重画弹窗里这一张，保留滚动位置（长章可能比视口高） */
  function patchLjModal(card) {
    var box = $id('lj-modal-box');
    if (!box) return;
    var top = box.scrollTop;
    box.innerHTML = renderCard(card, true);
    box.scrollTop = top;
  }

  /* 「在列表中查看」：切到列表、滚到那张卡、闪一下。 */
  function jumpToList(id) {
    closeLjModal();
    if (state.view !== 'card') {
      state.view = 'card';
      try { localStorage.setItem('dc-lj-view', 'card'); } catch (e) {}
      renderViewSeg();
      renderList();
      updateStatsText();
    }
    var el = document.querySelector('#study-list [data-card-id="' + id + '"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('lj-flash');
    void el.offsetWidth;
    el.classList.add('lj-flash');
    setTimeout(function () { el.classList.remove('lj-flash'); }, 1400);
  }

  /* ==========================================================================
     卡片交互
     ========================================================================== */
  function speakText(card) {
    var d = card.data || {};
    if (isOverview(card)) {
      return [d.title, d.theme, plain(d.body)].filter(Boolean).join('。');
    }
    /* 章号 + 章题一起读（「第一章，体道」）便于盲听定位 */
    var head = '第' + cnNum(d.chapter) + '章，' + (d.riverTitle || '') + '。';
    return head + plain(d.text);
  }
  function handlePlay(card) {
    var text = speakText(card);
    cardAPI.track('audio_play', card.id);
    if (!text) { showToast(T.noPlay, true); return; }
    voiceMgr.speak(text, 'zh-CN');
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
  /* 折叠注：点开就留着，再点收起（**不自动收起** —— 注是要停下来读的，
     exam-vocab 那边 5 秒自动收，这里有意不同）。展开状态挂 state，不挂 card 对象，
     这样标记/收藏触发的局部重渲染不会把展开状态抖掉。 */
  function handleToggleNote(card, root) {
    var open = !(state.noteOpen[card.id] === true);
    state.noteOpen[card.id] = open;
    cardAPI.track('note_view', card.id);
    if (root) {
      var noteEl = root.querySelector('.lj-note');
      if (noteEl) noteEl.classList.toggle('open', open);
    }
  }

  /* ===== 事件委托（一处绑完，重渲染不用重绑） ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* 动作按钮（先判：它在卡里，点它不能顺带弹窗） */
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
          else if (action === 'toggle-note') handleToggleNote(card, actionBtn.closest('.lj-root'));
          else if (action === 'close') closeLjModal();
        }
        return;
      }
      /* 弹窗：「在列表中查看」/ 点遮罩空白关闭
         （必须先判：格子就在遮罩下面，顺序反了会点穿） */
      if (target.closest('[data-act="modal-jump"]')) {
        e.stopPropagation();
        var jumpId = modalCardId;
        if (jumpId) jumpToList(jumpId);
        return;
      }
      if (target.id === 'lj-modal') { closeLjModal(); return; }
      /* 章图格子 / 篇首胶囊 = 就地弹窗（不下钻） */
      var cell = target.closest('[data-act="open"]');
      if (cell) {
        e.stopPropagation();
        openLjModal(cell.dataset.cardId);
        return;
      }

      /* 视图分段控件 */
      var viewBtn = target.closest('#view-seg button[data-view]');
      if (viewBtn) { e.stopPropagation(); setView(viewBtn.dataset.view); return; }

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
        voiceMgr.saveVoice('zh-CN', picked);
        renderVoiceDropdown();
        $('.voice-dropdown').style.display = 'none';
        voiceMgr.speak('道可道，非常道。', 'zh-CN');
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

    /* 键盘：弹窗开着时 Esc 关窗 */
    document.addEventListener('keydown', function (e) {
      if (!ljModalOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); closeLjModal(); }
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
