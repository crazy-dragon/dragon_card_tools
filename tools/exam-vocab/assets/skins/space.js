/* ==========================================================================
   exam-vocab · 皮肤 3 / Space Station（太空站词卡）· 渲染
   --------------------------------------------------------------------------
   这一版是**对原模板 43「大学英语六级词汇 · 太空站词卡」的忠实移植**，
   不是重新设计：布局 / 配色 / 间距 / 渐变 / 阴影全部沿用原版 cardHtml 里的
   Tailwind 工具类，skin CSS 只补 Tailwind 表达不了的部分（原版 cardCss 仅 2.3 KB）。
   原版标记来源：instance/dragon_card.db → t_template id = 43。

   原版结构（照搬）：左侧 230px 立柱 = 行星 + 光环 + 月亮点 + COCA 渐变胶囊；
   右侧 = 单词 + 音标 → 「LOG·EN」/「译」双语标签行 → 「VOYAGE LOG」例句舱；
   动作按钮绝对定位在右上角。

   相对原版的**增强**（用户确认"在原版上再增强"）：
     · 行星换成 **three.js 真 3D**（自转 + 光环 + 大气辉光，见 assets/planet3d.js）；
       拿不到 WebGL / three 加载失败时自动退回原版那套 CSS 行星
     · 未解读的释义显示「加密」锁条，揭开时有一段解密闪烁 —— 呼应太空站叙事
     · 例句改成一条一条的 VOYAGE LOG 舱单，**每句独立 👁** 控制译文
     · 保留原版**句中标黄目标词**（.sc-log-en .hl，原版 cardCss 里有，别丢）
     · 保留并补齐原版的考试徽章（原版只有 COCA 胶囊，没有卡组徽章）
     · 星野加极慢的明暗呼吸（纯 CSS，不影响可读性）
   ========================================================================== */
(function () {
  'use strict';

  /* 字号统一入口：px → 带 --card-font-scale 的 Tailwind 任意值（length: 类型提示必需） */
  function FS(px) {
    return 'text-[length:calc(' + px + 'px*var(--card-font-scale,1))]';
  }

  function sbtn(action, cls, icon, tip, active, exIdx) {
    return '<button class="sc-btn ' + cls + (active ? ' is-active' : '') +
      '" data-action="' + action + '" data-tooltip="' + tip + '"' +
      (exIdx == null ? '' : ' data-ex-idx="' + exIdx + '"') + '>' +
      '<i class="' + icon + '"></i></button>';
  }

  /* 未解读：锁住的加密条（图标化，不写多余文案 —— 项目规范：标签保持极简英文） */
  var LOCKED = '<span class="sp-redact" aria-hidden="true">' +
    '<i class="fa-solid fa-lock"></i></span>';

  window.EXAM_SKINS = window.EXAM_SKINS || {};
  window.EXAM_SKINS.space = {
    id: 'space',
    name: '太空站',
    icon: 'fa-rocket',

    render: function (card, env) {
      var d = card.data || {};

      function senses(list) {
        return env.senses(list).map(function (s) {
          return '<div class="break-words">' + env.esc(s) + '</div>';
        }).join('');
      }
      var enBody = env.showEn ? senses(d.paraphrase_en) : LOCKED;
      var zhBody = env.showZh ? senses(d.paraphrase_zh) : LOCKED;

      /* 例句：一条一条的 VOYAGE LOG 舱单（原版只有单条写死 01） */
      var exHtml = '';
      (d.examples || []).forEach(function (ex, i) {
        var on = ex._show === true;
        var no = String(i + 1).padStart(2, '0');
        exHtml += '<div class="relative rounded-lg border border-[rgba(90,120,220,0.35)]' +
            ' border-l-[3px] border-l-[#5eead4] bg-[rgba(20,32,74,0.55)] px-3 py-[9px]">' +
          '<div class="flex items-center justify-between gap-2 mb-1">' +
            '<div class="' + FS(10) + ' tracking-[2px] text-[#5eead4] font-bold">VOYAGE LOG · ' + no + '</div>' +
            sbtn('toggle-ex', 'eye-btn example-toggle-btn', 'fa-solid fa-eye', 'Show Translation', on, i) +
          '</div>' +
          '<div class="sc-log-en ' + FS(13.5) + ' leading-relaxed text-[#dbe4ff] break-words">' +
            env.hl(ex.en, d.word) + '</div>' +
          '<div class="sc-log-zh' + (on ? ' sp-decrypted' : ' hide') + ' ' + FS(12.5) +
            ' leading-normal text-[#93a0c8] mt-[3px] break-words">' + env.esc(ex.zh) + '</div>' +
          '</div>';
      });
      /* 舱单区留出底部 22px：右下角的 STATION 读数就在这条空档里，
         不留的话最后一张舱单会把它压住（截图里抓到过）。 */
      if (exHtml) exHtml = '<div class="mt-auto flex flex-col gap-2 pb-[22px]">' + exHtml + '</div>';

      var idx = card.current_order == null ? '' : String(card.current_order).padStart(2, '0');

      return '<div class="sc-card word-card skin-space' + (env.marked ? ' highlighted' : '') +
          ' relative overflow-hidden flex min-h-[250px] mb-4 rounded-[18px] border border-[#26335f]' +
          ' text-[#dbe2ff]' +
          ' bg-[image:linear-gradient(160deg,#0c1230_0%,#101a3e_55%,#0d1430_100%)]"' +
          ' data-card-id="' + card.id + '">' +

        /* ---------- 左：行星立柱 ---------- */
        '<div class="relative z-[1] shrink-0 basis-[230px] flex flex-col items-center justify-center py-6 px-2.5">' +
          /* data-planet3d 是 planet3d.js 认领卡位的钩子；认领成功后加 .sp-planet-live */
          '<div class="sp-planet relative w-[120px] h-[120px] rounded-full flex items-center justify-center"' +
            ' data-planet3d><span class="sp-ring"></span></div>' +
          '<span class="absolute right-1.5 bottom-[34px] w-[22px] h-[22px] rounded-full' +
            ' bg-[image:radial-gradient(circle_at_35%_32%,#f4f6ff,#b9c2e0_70%)]' +
            ' shadow-[0_0_8px_rgba(220,230,255,0.5)]"></span>' +
          (d.coca_rank
            ? '<span class="sp-coca absolute top-2 -left-1.5 px-2.5 py-[3px] rounded-full ' + FS(11) +
              ' font-extrabold tracking-wide -rotate-[14deg] whitespace-nowrap' +
              ' bg-[image:linear-gradient(90deg,#f7b733,#fc4a1a)] text-[#1a1030]' +
              ' shadow-[0_0_12px_rgba(250,180,60,0.5)]">' + env.esc(env.cocaText(d.coca_rank)) + '</span>'
            : '') +
        '</div>' +

        /* ---------- 右：读数舱 ---------- */
        '<div class="relative z-[1] flex-1 min-w-0 flex flex-col pt-5 pr-[22px] pb-4 pl-1.5">' +
          /* 右边距给右上角那排按钮留位 —— 原版没留，长单词会钻到按钮底下 */
          '<div class="flex items-baseline gap-3 flex-wrap mb-2 pr-[152px]">' +
            '<span class="sc-word font-bold ' + FS(33) + ' break-words text-[#f2f5ff]">' +
              env.esc(d.word) + '</span>' +
            (d.phonetic_us ? '<span class="' + FS(14) + ' text-[#8fa0d8] font-mono">' +
              env.esc(d.phonetic_us) + '</span>' : '') +
            /* 卡组徽章：原版没有这一项，补上才能一 zip 通吃四个卡组。
               ml-auto 把它顶到词组行右端（紧挨动作按钮那一侧）—— 否则它会被
               flex-wrap 甩到第二行左对齐，看着像一颗被落下的孤儿胶囊。 */
            '<span class="sp-badge ml-auto ' + FS(10) + '">' + env.esc(env.badge.text) + '</span>' +
          '</div>' +

          '<div class="flex flex-col gap-1.5 mb-2.5">' +
            '<div class="flex gap-2 items-start">' +
              '<span class="sp-chip sp-chip-en shrink-0 mt-0.5 ' + FS(10) + '">LOG·EN</span>' +
              '<span class="flex-1 min-w-0 ' + FS(14) + ' leading-relaxed break-words text-[#c7d2f5]">' +
                enBody + '</span>' +
            '</div>' +
            '<div class="flex gap-2 items-start">' +
              '<span class="sp-chip sp-chip-zh shrink-0 mt-0.5 ' + FS(10) + '">译</span>' +
              '<span class="flex-1 min-w-0 ' + FS(14) + ' leading-relaxed break-words text-[#eee8d8] font-medium">' +
                zhBody + '</span>' +
            '</div>' +
          '</div>' +

          exHtml +

          /* 动作：原版就是绝对定位在右上角 */
          '<div class="sp-actions absolute top-4 right-4 flex gap-1.5 z-[5]">' +
            sbtn('play', 'act-play', 'fa-solid fa-volume-high', 'Play Pronunciation', false) +
            sbtn('toggle-def', 'act-eye', (env.peek ? 'fa-solid' : 'fa-regular') + ' fa-eye', 'Toggle Chinese', env.peek) +
            sbtn('mark', 'act-mark', (env.marked ? 'fa-solid' : 'fa-regular') + ' fa-star', 'Mark as Unknown', env.marked) +
            sbtn('favorite', 'act-fav', (env.fav ? 'fa-solid' : 'fa-regular') + ' fa-bookmark', 'Favorite', env.fav) +
          '</div>' +

          /* 站位读数：纯装饰的 HUD 角标（增强） */
          '<div class="sp-station absolute left-1.5 bottom-3 ' + FS(10) + '">' +
            '<i class="fa-solid fa-satellite-dish"></i> STATION ' + env.esc(idx || '—') +
          '</div>' +
        '</div>' +
        '</div>';
    }
  };
})();
