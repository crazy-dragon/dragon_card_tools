/* ==========================================================================
   3D 恐龙 · 小工具（GLB 模型观赏，现 2 张卡：霸王龙 / 翼龙）
   --------------------------------------------------------------------------
   每张卡一个 3D 舞台。⚠️ WebGL 上下文上限 ~16 ⇒ 全局**只有一个 renderer**：
     · IntersectionObserver 挑"最可见"的舞台认领 canvas
     · 其余舞台显示占位图（拖到它成为最可见时自动换上）
     · 模型按 URL 缓存（GLTF 场景 clone 后复用）
   交互：拖拽旋转 / 滚轮缩放 / 双击复位；闲置 3 秒回到自动旋转。
   朗读：🔊 读中文名+描述（zh，audio_play）；点拉丁学名读学名（en，word_play）。

   three.js 经动态 import 加载（index.html 里已声明 import map：
   three → /static/vendor/three/three.module.js，three/addons/ → jsm/）。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track / finish
   ========================================================================== */
(function () {
  'use strict';

  var TOOL = window.DC_TOOL || {};
  var TITLE = TOOL.title || '3D 恐龙';
  var VOICE_ZH = 'zh-CN';
  var VOICE_EN = 'en-US';
  var PAGE_SIZE = 50;
  var LS = 'dc-dj-';

  var SKINS = [
    { id: 'cream', name: '奶油', icon: 'fa-sun' },
    { id: 'glass', name: '星夜', icon: 'fa-moon' },
    { id: 'category', name: '丛林', icon: 'fa-leaf' }
  ];

  var state = {
    all: [],
    singleCardMode: false,
    singleCardIndex: 0,
    skin: 'cream',
    fontSize: 1,
    _voiceWarned: false,
    _refreshLock: false
  };
  try { var ss = localStorage.getItem(LS + 'skin'); if (ss) state.skin = ss; } catch (e) {}
  if (!SKINS.some(function (s) { return s.id === state.skin; })) state.skin = 'cream';
  try { state.fontSize = parseFloat(localStorage.getItem(LS + 'font')) || 1; } catch (e) {}

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
    sampleText: function () { return '恐龙'; },
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
      '<button type="button" data-action="play" data-tooltip="读名字与描述"><i class="fa-solid fa-volume-high"></i></button>' +
      '<button type="button" class="act-mark' + (markOn ? ' is-active' : '') + '" data-action="mark" data-tooltip="' +
        (markOn ? '取消标记' : '标记为不认识') + '"><i class="' + (markOn ? 'fa-solid' : 'fa-regular') + ' fa-star"></i></button>' +
      '<button type="button" class="act-fav' + (favOn ? ' is-active' : '') + '" data-action="favorite" data-tooltip="' +
        (favOn ? '取消收藏' : '收藏') + '"><i class="' + (favOn ? 'fa-solid' : 'fa-regular') + ' fa-bookmark"></i></button>' +
      '</div>';
  }

  function renderCard(card) {
    var d = card.data || {};
    return '<div class="dj-root" data-card-id="' + card.id + '">' +
      railButtons(card) +
      '<div class="dj-head">' +
        '<div class="dj-name">' + esc(d.name) + '</div>' +
        (d.latin ? '<button type="button" class="dj-latin" data-say="' + esc(d.latin) + '" data-say-lang="en"' +
          ' data-tooltip="读拉丁学名"><i class="fa-solid fa-volume-high"></i>' + esc(d.latin) + '</button>' : '') +
      '</div>' +
      '<div class="dj-stage" data-model="' + esc(d.model || '') + '">' +
        '<div class="dj-stage-hint"><i class="fa-solid fa-cube"></i> 拖拽旋转 · 滚轮缩放 · 双击复位</div>' +
      '</div>' +
      (d.desc ? '<div class="dj-desc">' + esc(d.desc) + '</div>' : '') +
    '</div>';
  }

  /* ===== 渲染 ===== */
  function renderList() {
    var box = $id('study-list');
    if (!box) return;
    var content = $('.study-content');
    if (content) content.classList.toggle('wide', state.singleCardMode);
    if (state.singleCardMode) { renderSingleCardStage(); return; }
    if (!state.all.length) { box.innerHTML = '<div class="empty-state">还没有卡片。</div>'; return; }
    box.innerHTML = state.all.map(function (c, i) {
      return '<div class="enter" style="animation-delay:' + Math.min(i * 60, 200) + 'ms">' +
        renderCard(c) + '</div>';
    }).join('');
    viewer.scanStages();
  }
  function patchCard(card) {
    var el = document.querySelector('#study-list [data-card-id="' + card.id + '"]');
    if (!el) { renderList(); return; }
    var host = el.parentElement;
    if (host && host.classList.contains('enter')) host.innerHTML = renderCard(card);
    else el.outerHTML = renderCard(card);
    viewer.scanStages();
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
    var cards = state.all;
    if (!cards.length) { box.innerHTML = '<div class="empty-state">还没有卡片。</div>'; return; }
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
    viewer.scanStages();
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
  function playCard(card) {
    var d = card.data || {};
    cardAPI.track('audio_play', card.id);
    var text = d.name ? (d.name + '。' + (d.desc || '')) : (d.desc || '');
    if (!text.trim()) { showToast('这张卡没有可朗读的内容', true); return; }
    warnIfNoVoice();
    voiceMgr.speak(text, VOICE_ZH);
  }
  function playText(card, text, lang) {
    if (!text) return;
    cardAPI.track('word_play', card.id);
    warnIfNoVoice();
    voiceMgr.speak(text, lang === 'en' ? VOICE_EN : VOICE_ZH);
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

  /* ==========================================================================
     three.js 视图（全局单 renderer —— WebGL 上下文上限 ~16）
     ========================================================================== */
  var viewer = {
    THREE: null, GLTFLoader: null, _ready: false,
    renderer: null, scene: null, camera: null,
    _cache: {},          /* url -> { scene3 } */
    _claim: null,        /* 当前认领的 stage DOM */
    _model: null, _seq: 0,
    _autoRotate: true, _idleTimer: null,
    _rx: 0, _ry: 0, _dist: 4.2,

    ensureLibs: function () {
      var self = this;
      if (this._ready) return Promise.resolve(true);
      return Promise.all([
        import('three'),
        import('three/addons/loaders/GLTFLoader.js')
      ]).then(function (mods) {
        self.THREE = mods[0];
        self.GLTFLoader = mods[1].GLTFLoader;
        self._ready = true;
        return true;
      }).catch(function (e) {
        console.error('three load failed', e);
        return false;
      });
    },

    /* 找出所有舞台，挑最可见的认领（列表里也可能只有 0/1/2 个） */
    scanStages: function () {
      var self = this;
      var stages = Array.prototype.slice.call(document.querySelectorAll('.dj-stage'));
      if (!stages.length) { this._release(); return; }
      if (!this._observer) {
        this._observer = new IntersectionObserver(function (entries) {
          /* ⚠️ 必须先把 ratio 记到元素上，_pickBest 才有依据；
                直接调 _pickBest 会让 _djRatio 永远是 undefined */
          self._onIntersect(entries);
        }, { threshold: [0, .25, .5, .75, 1] });
      }
      stages.forEach(function (st) {
        if (st._djObserved) return;
        st._djObserved = true;
        self._observer.observe(st);
      });
      this._pickBest();
    },

    /* 几何可见度（交集比例还没上报时的兜底） */
    _visibility: function (el) {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight || 1;
      var visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      return Math.max(0, visible) / Math.max(1, r.height);
    },
    _pickBest: function () {
      var self = this;
      var stages = Array.prototype.slice.call(document.querySelectorAll('.dj-stage'));
      if (!stages.length) { this._release(); return; }
      var best = null, bestScore = -1;
      stages.forEach(function (st) {
        var score = (typeof st._djRatio === 'number') ? st._djRatio : self._visibility(st);
        if (score > bestScore) { bestScore = score; best = st; }
      });
      /* 只认领"看得见"的舞台（ratio ≥ .55）；全不可见时不换手 */
      if (best && bestScore >= 0.55 && best !== this._claim) this._claimStage(best);
    },

    _claimStage: function (stage) {
      var self = this;
      this._claim = stage;
      var url = stage.dataset.model || '';
      /* 清掉其他舞台上的 canvas（占位由 CSS ::after 提供） */
      document.querySelectorAll('.dj-stage.on').forEach(function (el) {
        if (el !== stage) {
          el.classList.remove('on');
          var cv = el.querySelector('canvas');
          if (cv && cv.parentNode === el) el.removeChild(cv);
        }
      });
      stage.classList.add('on');
      this.ensureLibs().then(function (ok) {
        if (self._claim !== stage) return;   /* 期间用户又滚走了 */
        if (!ok) {
          stage.innerHTML = '<div class="dj-err">Three.js 加载失败（需要 /static/vendor/three/）</div>';
          return;
        }
        if (!self.renderer) self._init();
        var canvas = self.renderer.domElement;
        if (canvas.parentNode !== stage) stage.appendChild(canvas);
        requestAnimationFrame(function () {
          if (self._claim !== stage) return;
          self._resize(stage);
          self._loadModel(url, stage);
        });
      });
    },

    _release: function () {
      if (this._claim) { this._claim.classList.remove('on'); this._claim = null; }
    },

    _onIntersect: function (entries) {
      var self = this;
      entries.forEach(function (en) { en.target._djRatio = en.intersectionRatio; });
      this._pickBest();
    },

    _init: function () {
      var T = this.THREE;
      this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(45, 1.5, 0.1, 1000);
      var ambient = new T.AmbientLight(0xffffff, 0.65);
      this.scene.add(ambient);
      var dir = new T.DirectionalLight(0xffffff, 0.95);
      dir.position.set(5, 10, 7);
      this.scene.add(dir);
      var dir2 = new T.DirectionalLight(0xffffff, 0.3);
      dir2.position.set(-5, -3, -5);
      this.scene.add(dir2);
      this._bindControls();
      var self = this;
      (function loop() {
        self._animId = requestAnimationFrame(loop);
        self._frame();
      })();
      window.addEventListener('resize', function () {
        if (self._claim) self._resize(self._claim);
      });
    },

    _resize: function (stage) {
      var w = stage.clientWidth || 600;
      var h = stage.clientHeight || 340;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    },

    /* 模型地址解析 —— 工具**自带**模型（assets/models/*.glb），zip 脱离宿主也能跑：
         · 页面 URL 是 /v1/tools/<id>/run ⇒ 相对地址 "assets/models/trex.glb"
           解析成 /v1/tools/<id>/assets/models/trex.glb，
           正好落在宿主的 /v1/tools/<id>/assets/<path> 路由上
           （该路由内建了 assets/ 前缀兜底，写不写前缀都行）
         · 卡片数据里旧写法 "/static/media/trex.glb" 也等价映射到自带资源，
           —— 取文件名即可，不用改卡片数据
         · http(s) 绝对地址原样使用
       ⚠️ 宿主 app.py 的 TOOL_EXT_WHITELIST 必须放行 .glb，否则这里 403。 */
    _resolve: function (url) {
      if (!url) return '';
      if (/^https?:/i.test(url)) return url;
      return 'assets/models/' + String(url).split('/').pop();
    },

    _loadModel: function (url, stage) {
      this._seq++;
      var seq = this._seq;
      if (!url) { this._showErr(stage, '这张卡没有模型地址'); return; }
      this._tryLoad(this._resolve(url), url, stage, seq);
    },

    _tryLoad: function (target, fallbackUrl, stage, seq) {
      var self = this;
      var T = this.THREE;
      var cached = this._cache[target];
      if (cached) { stage.classList.remove('loading'); this._mount(cached.scene3.clone(true)); return; }
      stage.classList.add('loading');
      new this.GLTFLoader().load(target, function (gltf) {
        if (self._seq !== seq || self._claim !== stage) return;
        stage.classList.remove('loading');
        var scene3 = gltf.scene;
        /* 归一化：包盒缩放到 ~2.4 单位并居中 */
        var box = new T.Box3().setFromObject(scene3);
        var size = box.getSize(new T.Vector3());
        var center = box.getCenter(new T.Vector3());
        var maxDim = Math.max(size.x, size.y, size.z) || 1;
        var s = 2.4 / maxDim;
        scene3.scale.setScalar(s);
        scene3.position.sub(center.multiplyScalar(s));
        self._cache[target] = { scene3: scene3 };
        self._mount(scene3.clone(true));
      }, undefined, function () {
        if (self._seq !== seq) return;
        /* 自带资源取不到 → 回退卡片数据里的原地址（宿主 /static/media/） */
        if (fallbackUrl && fallbackUrl !== target) {
          self._tryLoad(fallbackUrl, null, stage, seq);
          return;
        }
        stage.classList.remove('loading');
        self._showErr(stage, '模型加载失败：' + target);
      });
    },

    /* 错误提示叠在舞台上（不销毁 canvas —— 全局只有一个） */
    _showErr: function (stage, msg) {
      var old = stage.querySelector('.dj-err');
      if (old) old.parentNode.removeChild(old);
      var el = document.createElement('div');
      el.className = 'dj-err';
      el.textContent = msg;
      stage.appendChild(el);
    },

    _mount: function (scene3) {
      if (this._model) this.scene.remove(this._model);
      this._model = scene3;
      this.scene.add(scene3);
      this._rx = 0; this._ry = 0; this._dist = 4.2;
      this._autoRotate = true;
    },

    _frame: function () {
      if (!this.renderer || !this._claim || !this._model) return;
      if (this._autoRotate) this._ry += 0.008;
      this.camera.position.set(0, 0.7, this._dist);
      this.camera.lookAt(0, 0, 0);
      this._model.rotation.set(this._rx, this._ry, 0);
      this.renderer.render(this.scene, this.camera);
    },

    _bindControls: function () {
      var self = this;
      var dom = this.renderer.domElement;
      var dragging = false, px = 0, py = 0;
      function wake() {
        self._autoRotate = false;
        clearTimeout(self._idleTimer);
        self._idleTimer = setTimeout(function () { self._autoRotate = true; }, 3000);
      }
      dom.style.cursor = 'grab';
      dom.addEventListener('mousedown', function (e) {
        dragging = true; px = e.clientX; py = e.clientY;
        dom.style.cursor = 'grabbing';
        wake();
      });
      window.addEventListener('mouseup', function () {
        dragging = false;
        dom.style.cursor = 'grab';
      });
      dom.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        self._ry += (e.clientX - px) * 0.01;
        self._rx += (e.clientY - py) * 0.01;
        self._rx = Math.max(-1.2, Math.min(1.2, self._rx));
        px = e.clientX; py = e.clientY;
        wake();
      });
      dom.addEventListener('wheel', function (e) {
        e.preventDefault();
        self._dist = Math.max(1.6, Math.min(10, self._dist + e.deltaY * 0.004));
        wake();
      }, { passive: false });
      dom.addEventListener('dblclick', function () {
        self._rx = 0; self._ry = 0; self._dist = 4.2;
        self._autoRotate = true;
        clearTimeout(self._idleTimer);
      });
      /* 触摸（单指旋转） */
      dom.addEventListener('touchstart', function (e) {
        if (e.touches.length === 1) {
          dragging = true; px = e.touches[0].clientX; py = e.touches[0].clientY;
          wake();
        }
      }, { passive: true });
      dom.addEventListener('touchmove', function (e) {
        if (!dragging || e.touches.length !== 1) return;
        self._ry += (e.touches[0].clientX - px) * 0.01;
        self._rx += (e.touches[0].clientY - py) * 0.01;
        self._rx = Math.max(-1.2, Math.min(1.2, self._rx));
        px = e.touches[0].clientX; py = e.touches[0].clientY;
        wake();
      }, { passive: true });
      dom.addEventListener('touchend', function () { dragging = false; });
    }
  };

  /* ===== 视图切换 ===== */
  function setView() {}

  /* ===== 事件委托 ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      var sayEl = target.closest('[data-say]');
      if (sayEl) {
        e.stopPropagation();
        var sCardEl = sayEl.closest('[data-card-id]');
        var sCard = sCardEl ? findCard(sCardEl.dataset.cardId) : null;
        if (sCard) playText(sCard, sayEl.dataset.say, sayEl.dataset.sayLang);
        return;
      }
      var actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        var cardEl = actionBtn.closest('[data-card-id]');
        var card = cardEl ? findCard(cardEl.dataset.cardId) : null;
        if (card) {
          var action = actionBtn.dataset.action;
          if (action === 'play') playCard(card);
          else if (action === 'mark') handleMark(card);
          else if (action === 'favorite') handleFavorite(card);
        }
        return;
      }
      if (target.closest('[data-sc="prev"]')) { singleCardNav(-1); return; }
      if (target.closest('[data-sc="next"]')) { singleCardNav(1); return; }

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
