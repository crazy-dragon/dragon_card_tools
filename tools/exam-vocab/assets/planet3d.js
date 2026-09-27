/* ==========================================================================
   exam-vocab · 太空站的 3D 行星（three.js，本地 /static/vendor 提供，不打包进 zip）
   --------------------------------------------------------------------------
   为什么要这么写 —— 两个硬约束决定了架构：

   1. **一个页面只能有极少数 WebGL 上下文**（Chrome 约 16 个，超了就把最老的丢掉并
      报 "Too many active WebGL contexts"）。而词卡列表一页 100 张，如果每张卡
      建一个 renderer，页面直接崩。
      ⇒ 所以全局**只建 1 个 renderer**，它的 <canvas> 由「当前最该显示 3D 的那张卡」
        认领（appendChild 搬运），其余卡位继续用 CSS 画的行星兜底。

   2. **宿主不会给小工具注入 import map**。本体 SPA 的 templates/index.html 里有
      `{"three": "/static/vendor/three/three.module.js"}` 的 import map，但
      /v1/tools/<id>/run 只注入 cardAPI 桥接脚本 —— 所以工具里不能写
      `import 'three'`，只能按**绝对路径**动态 import 真实文件。
      ⇒ 也就不能放 import map 依赖，这里用 import('/static/vendor/three/three.module.js')。
        动态 import 在 classic script 里合法，因此本文件仍是普通 <script>。

   认领规则：IntersectionObserver 收集所有 [data-planet3d] 卡位的可见比例，
   取比例最高且 ≥ 0.55 的那一个。单卡模式下只有一张可见 → 它就是 3D；
   列表模式滚动时，canvas 会被搬到最居中的那张卡上。

   失败降级：three 加载不了 / WebGL 建不出来 → 什么都不做，卡面保留 CSS 行星。
   ========================================================================== */
(function () {
  'use strict';

  var SLOT = '[data-planet3d]';
  var SIZE = 120;                 // 与 CSS 行星同尺寸，认领前后不跳版
  var MIN_RATIO = 0.55;

  var THREE = null, loading = null;
  var renderer = null, scene = null, camera = null, pivot = null, ring = null;
  var host = null, raf = 0, io = null, mo = null, scanPending = false;
  var ratios = new Map();
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var failed = false;

  /* ---------- three 懒加载 ---------- */
  function load() {
    if (THREE) return Promise.resolve(THREE);
    if (!loading) {
      loading = import('/static/vendor/three/three.module.js')
        .then(function (m) { THREE = m; return m; })
        .catch(function (e) { loading = null; failed = true; throw e; });
    }
    return loading;
  }

  /* ---------- 程序化贴图：随机云带，免得球面平得像塑料球 ---------- */
  function planetTexture(m) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#3d55b8';
    g.fillRect(0, 0, 256, 128);
    for (var i = 0; i < 96; i++) {
      var x = Math.random() * 256, y = Math.random() * 128;
      var rx = 8 + Math.random() * 34, ry = rx * (0.28 + Math.random() * 0.3);
      g.globalAlpha = 0.05 + Math.random() * 0.13;
      g.fillStyle = Math.random() < 0.5 ? '#8ceaff' : '#1b1f5c';
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    }
    /* 两极压暗一点，增加体积感 */
    g.globalAlpha = 0.32;
    g.fillStyle = '#0a1030';
    g.fillRect(0, 0, 256, 14);
    g.fillRect(0, 114, 256, 14);
    g.globalAlpha = 1;

    var t = new m.CanvasTexture(c);
    if (m.SRGBColorSpace) t.colorSpace = m.SRGBColorSpace;
    t.wrapS = m.RepeatWrapping;
    return t;
  }

  function build(m) {
    renderer = new m.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(SIZE, SIZE, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    scene = new m.Scene();
    camera = new m.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 3.4);

    pivot = new m.Group();
    pivot.rotation.z = 0.18;
    scene.add(pivot);

    pivot.add(new m.Mesh(
      new m.SphereGeometry(1, 48, 32),
      new m.MeshStandardMaterial({
        map: planetTexture(m),
        roughness: 0.92, metalness: 0.06,
        emissive: new m.Color(0x0a1230)
      })
    ));

    /* 大气辉光：略大的加色球，只发光不遮挡 */
    pivot.add(new m.Mesh(
      new m.SphereGeometry(1.08, 32, 24),
      new m.MeshBasicMaterial({
        color: 0x5eead4, transparent: true, opacity: 0.10,
        blending: m.AdditiveBlending, depthWrite: false
      })
    ));

    /* 光环：和 CSS 版同样是「椭圆环 + 倾斜」的观感 */
    ring = new m.Mesh(
      new m.TorusGeometry(1.62, 0.032, 10, 72),
      new m.MeshBasicMaterial({ color: 0x8ce0ff, transparent: true, opacity: 0.55 })
    );
    ring.rotation.set(1.25, 0, 0.28);
    scene.add(ring);

    scene.add(new m.AmbientLight(0x4a5580, 1.6));
    var key = new m.DirectionalLight(0xbfd4ff, 2.2);
    key.position.set(2.4, 1.6, 2.2);
    scene.add(key);
    var rim = new m.PointLight(0x5eead4, 1.8, 8);
    rim.position.set(-2.2, -0.8, 1.4);
    scene.add(rim);
  }

  /* ---------- 渲染循环 ---------- */
  function frame() {
    raf = 0;
    if (!renderer) return;
    if (pivot) pivot.rotation.y += 0.0055;
    if (ring) ring.rotation.z += 0.0012;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (reduced) { renderer.render(scene, camera); return; }  /* 尊重「减少动态效果」：只画一帧 */
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  /* ---------- 认领：挑可见比例最高、且够显眼的那个卡位 ---------- */
  function pick() {
    var best = null, bestR = 0;
    ratios.forEach(function (r, el) {
      if (!el.isConnected) { ratios.delete(el); if (io) io.unobserve(el); return; }
      if (r > bestR) { bestR = r; best = el; }
    });
    return bestR >= MIN_RATIO ? best : null;
  }

  function detach() {
    if (!host) return;
    host.classList.remove('sp-planet-live');
    if (renderer && renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    host = null;
  }

  function sync() {
    if (failed) return;
    var el = pick();
    if (el === host) return;
    detach();
    if (!el) { stop(); return; }
    load().then(function (m) {
      if (failed || !el.isConnected || pick() !== el) return;   /* 等待期间又变了，下次回调再说 */
      if (!renderer) build(m);
      host = el;
      host.appendChild(renderer.domElement);
      host.classList.add('sp-planet-live');
      start();
    }).catch(function () { /* 静默降级到 CSS 行星 */ });
  }

  /* ---------- 观察：卡位是重渲染出来的，必须反复扫描 ---------- */
  function scan() {
    if (!io) return;
    var slots = document.querySelectorAll(SLOT);
    for (var i = 0; i < slots.length; i++) {
      var el = slots[i];
      if (el.__spObserved) continue;
      el.__spObserved = true;
      io.observe(el);
    }
    sync();
  }

  function init() {
    if (io || failed) return;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) ratios.set(en.target, en.intersectionRatio);
        else ratios.delete(en.target);
      });
      sync();
    }, { threshold: [0, 0.25, 0.5, MIN_RATIO, 0.75, 1] });

    /* 外壳每次换页/开关皮肤都会整块重建 DOM ⇒ 用 MutationObserver 兜住新卡位，
       rAF 合帧，避免 100 张卡的重渲染把回调打爆。 */
    mo = new MutationObserver(function () {
      if (scanPending) return;
      scanPending = true;
      requestAnimationFrame(function () { scanPending = false; scan(); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    scan();

    /* 切到后台就停，回来再起 —— 100 张卡时这点电费值得省 */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else if (host) start();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 探针用的自检口：上下文数必须恒为 0 或 1 */
  window.ExamPlanet = {
    get slots() { return document.querySelectorAll(SLOT).length; },
    get contexts() { return renderer ? 1 : 0; },
    get live() { return !!host; },
    get failed() { return failed; }
  };
})();
