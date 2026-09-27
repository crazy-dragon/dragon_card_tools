/* ==========================================================================
   exam-vocab · 皮肤 1 / Standard（通用词汇卡）· 渲染
   --------------------------------------------------------------------------
   契约（三个皮肤共用，由 assets/app.js 调用）：
     render(card, env) -> string
       card = { id, current_order, is_unknown, is_favorite, data, _showDef }
              data = { word, phonetic_us, paraphrase_en, paraphrase_zh,
                       examples:[{en,zh,_show}], coca_rank, source, form_note }
       env  = { badge:{text, theme}, marked, fav, peek, showEn, showZh,
                esc(s), senses(raw) -> string[], hl(sentence, word) -> html,
                cocaText(rank) -> string, icon(cls) -> html }
     返回值必须以 <div class="word-card skin-standard" data-card-id="ID"> 作根：
       · data-card-id 是外壳定位卡片的唯一依据，缺了按钮就全哑
       · 按钮一律 data-action="play|toggle-def|mark|favorite|toggle-ex"
         （toggle-ex 还要 data-ex-idx），外壳用事件委托统一处理，
         皮肤自己**不要**绑点击 —— 否则会双重触发（双份音频 + 双份埋点）
       · 按钮的**类名三套皮肤统一**：act-play / eye-btn act-eye / act-mark /
         act-fav / eye-btn example-toggle-btn，外观差异全部靠 .skin-x 作用域下的
         CSS 表达。这样探针与目检脚本用一套选择器就能跑三套皮肤。
   序号徽章：current_order 可能到 4 位（5000+ 词的卡组），padStart(2) 够了。
   ========================================================================== */
(function () {
  'use strict';

  /* exIdx 只有例句那颗眼睛才用得上 —— 外壳靠 data-ex-idx 找是第几条例句。
     忘了带它的话点击会静默失效（parseInt(undefined)=NaN ⇒ examples[NaN]=undefined）。 */
  function btn(action, cls, icon, tip, active, exIdx) {
    return '<button class="action-btn ' + cls + (active ? ' is-active' : '') +
      '" data-action="' + action + '" data-tooltip="' + tip + '"' +
      (exIdx == null ? '' : ' data-ex-idx="' + exIdx + '"') + '>' +
      '<i class="' + icon + '"></i></button>';
  }

  window.EXAM_SKINS = window.EXAM_SKINS || {};
  window.EXAM_SKINS.standard = {
    id: 'standard',
    name: 'Standard',
    icon: 'fa-rectangle-list',

    render: function (card, env) {
      var d = card.data || {};
      var t = env.badge.theme;

      /* 配色写成内联变量 → 一套 CSS 覆盖五个卡组 */
      var vars = '--acc:' + t.acc + ';--acc2:' + t.acc2 + ';--acc-soft:' + t.soft +
        ';--acc-deep:' + t.deep + ';--acc-ink:' + t.ink +
        ';--acc-line:' + t.line + ';--acc-sh:' + t.sh;

      /* ---- 释义：数组释义每条一行 ---- */
      function def(list, cls, hidden) {
        var arr = env.senses(list);
        if (!arr.length) return '';
        var body = arr.map(function (s) { return '<div class="sense">' + env.esc(s) + '</div>'; }).join('');
        return '<div class="' + cls + (hidden ? ' hide' : '') + '">' + body + '</div>';
      }
      var defHtml = '<div class="definition">' +
        def(d.paraphrase_en, 'def-en', !env.showEn) +
        def(d.paraphrase_zh, 'def-cn', !env.showZh) +
        '</div>';

      /* ---- 徽章行：考试徽章 + COCA 排名 + 词形说明 ---- */
      var chips = '<span class="exam-badge">' + env.esc(env.badge.text) + '</span>';
      /* cocaText 走原版 t43 的口径（TOP n / #n），三套皮肤同一句文案 */
      if (d.coca_rank) chips += '<span class="rank-chip">' + env.esc(env.cocaText(d.coca_rank)) + '</span>';
      if (d.form_note) chips += '<span class="form-note">' + env.esc(d.form_note) + '</span>';

      /* ---- 例句：每句自带一个偷看按钮 ---- */
      var exHtml = '';
      if (d.examples && d.examples.length) {
        var items = d.examples.map(function (ex, idx) {
          var on = ex._show === true;
          return '<div class="example-item">' +
            '<div class="ex-row">' +
              '<div class="ex-en">' + env.hl(ex.en, d.word) + '</div>' +
              btn('toggle-ex', 'eye-btn example-toggle-btn', 'fa-solid fa-eye', 'Show Translation', on, idx) +
              '</div>' +
            '<div class="ex-cn' + (on ? '' : ' hide') + '">' + env.esc(ex.zh) + '</div>' +
            '</div>';
        }).join('');
        exHtml = '<div class="divider"></div><div class="examples">' + items + '</div>';
      }

      var idx = card.current_order == null ? '' : String(card.current_order).padStart(2, '0');

      return '<div class="word-card skin-standard' + (env.marked ? ' highlighted' : '') +
          '" data-card-id="' + card.id + '" style="' + vars + '">' +
        '<div class="card-header">' +
          '<div class="word-basic">' +
            '<span class="word-index">' + env.esc(idx) + '</span>' +
            '<span class="word-title">' + env.esc(d.word) + '</span>' +
            (d.phonetic_us ? '<span class="word-phonetic">' + env.esc(d.phonetic_us) + '</span>' : '') +
            '<span class="word-chips">' + chips + '</span>' +
          '</div>' +
          '<div class="actions">' +
            btn('play', 'act-play', 'fa-solid fa-volume-high', 'Play Pronunciation', false) +
            btn('toggle-def', 'eye-btn act-eye', (env.peek ? 'fa-solid' : 'fa-regular') + ' fa-eye', 'Toggle Chinese', env.peek) +
            btn('mark', 'act-mark', (env.marked ? 'fa-solid' : 'fa-regular') + ' fa-star', 'Mark as Unknown', env.marked) +
            btn('favorite', 'act-fav', (env.fav ? 'fa-solid' : 'fa-regular') + ' fa-bookmark', 'Favorite', env.fav) +
          '</div>' +
        '</div>' +
        defHtml +
        exHtml +
        '</div>';
    }
  };
})();
