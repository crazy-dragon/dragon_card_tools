/* ==========================================================================
   exam-vocab · 皮肤 2 / Journal（手帐词签）· 渲染
   --------------------------------------------------------------------------
   这一版是**对原模板 42「大学英语六级词汇 · 手帐词签」的忠实移植**，
   不是重新设计：布局 / 配色 / 间距 / 倾斜 / 阴影全部沿用原版写在
   cardHtml 里的 Tailwind 工具类（任意值），skin CSS 只补 Tailwind
   表达不了的部分 —— 和原版的思路完全一致（原版 cardCss 只有 2.2 KB）。
   原版标记来源：instance/dragon_card.db → t_template id = 42。

   与外壳的契约见 standard.js 顶部注释。本皮肤额外遵守两条：
     1. 字号必须能缩放 —— 原版写死 px，这里统一写成
        text-[length:calc(<px>*var(--card-font-scale,1))]（见 FS()），
        按钮盒子尺寸同步乘 --ew-scale（见 journal.css）。
     2. 皮肤**不绑事件**、**不做自己的 tooltip**：按钮一律 data-action，
        提示交给外壳的 #global-tooltip（原版那套 ::after tooltip 会与外壳
        的双重显示，已去掉）。

   相对原版的**增强**（用户确认"在原版上再增强"）：
     · 补第 4 颗贴纸按钮 👁（原版只有发音/标记/收藏，没有偷看释义）
     · 例句做成带胶带的贴纸便签，每句独立 👁（原版手帐没有例句区）；
       句中标黄目标词（原版 t43 有这个细节，手帐也一起给上）
     · 原来那三个装饰标签（记忆/复习/应用）换成**真实元数据**：
       COCA 排名 / 词形说明 / 数据来源
     · 释义支持"遮住"态：未揭开时用纹理遮挡条占位，保住行高、不跳版
     · 极淡纸纹；标记后小猫贴纸点亮
     · 复现原版最抓眼的那道**满宽荧光笔划**（见 journal.css 里 .hl-p 的说明）
   ========================================================================== */
(function () {
  'use strict';

  /* 字号统一入口：px → 带 --card-font-scale 的 Tailwind 任意值。
     length: 类型提示是必需的 —— 不带的话 Tailwind 分不清 font-size 与 color。 */
  function FS(px) {
    return 'text-[length:calc(' + px + 'px*var(--card-font-scale,1))]';
  }

  /* 贴纸按钮：类名三皮肤统一（外壳按 data-action 分派，探针按 act-* 定位），
     外观全部靠 .skin-journal 作用域下的 CSS 表达。 */
  function stbtn(action, cls, icon, tip, active, exIdx) {
    return '<button class="jc-btn ' + cls + (active ? ' is-active' : '') +
      '" data-action="' + action + '" data-tooltip="' + tip + '"' +
      (exIdx == null ? '' : ' data-ex-idx="' + exIdx + '"') + '>' +
      '<i class="' + icon + '"></i></button>';
  }

  /* 遮住态占位：不用文字（项目规范：标签保持极简英文），用纹理条表达"这里有内容"，
     同时保住一行高度，避免揭开/收回时卡片跳动。 */
  var REDACT = '<span class="jc-redact" aria-hidden="true"></span>';

  window.EXAM_SKINS = window.EXAM_SKINS || {};
  window.EXAM_SKINS.journal = {
    id: 'journal',
    name: '手帐',
    icon: 'fa-note-sticky',

    render: function (card, env) {
      var d = card.data || {};
      var idx = card.current_order == null ? '' : '#' + String(card.current_order).padStart(2, '0');

      /* ---- 释义：EN / 中文各一段，未揭开用遮挡条 ---- */
      function senses(list) {
        return env.senses(list).map(function (s) {
          return '<div class="break-words">' + env.esc(s) + '</div>';
        }).join('');
      }
      var enBody = env.showEn ? senses(d.paraphrase_en) : REDACT;
      var zhBody = env.showZh ? senses(d.paraphrase_zh) : REDACT;

      /* ---- 元信息标签：原版是装饰词（记忆/复习/应用），这里换成真实字段 ----
         署名规范要求「每套卡都保留 source attribution」，但 COCA 排名本身就是
         对 COCA 的署名 —— 两者同时出现会变成 `COCA 10172` + `coca` 两个意思
         重复的胶囊（实测很吵）。所以只在**没有排名**时才拿 source 单独顶一行。 */
      var meta = [];
      if (d.coca_rank) meta.push('<span class="jc-tag jc-tag-a">' + env.esc(env.cocaText(d.coca_rank)) + '</span>');
      if (d.form_note) meta.push('<span class="jc-tag jc-tag-b">' + env.esc(d.form_note) + '</span>');
      if (d.source && !d.coca_rank) meta.push('<span class="jc-tag jc-tag-c">SOURCE ' + env.esc(d.source) + '</span>');
      if (!meta.length) meta.push('<span class="jc-tag jc-tag-a">EXAM VOCAB</span>');

      /* ---- 例句：贴纸便签，每句一颗 👁 控制中文 ---- */
      var exHtml = '';
      (d.examples || []).forEach(function (ex, i) {
        var on = ex._show === true;
        exHtml += '<div class="jc-example relative rounded-[12px] border-2 border-[#f3e5cd]' +
            ' bg-[#fffdf8] px-3.5 pt-2.5 pb-2 shadow-[0_3px_8px_rgba(120,90,50,0.1)]">' +
          '<span class="jc-tape absolute z-[3] w-[64px] h-[18px] -top-1.5 -right-[18px]' +
            ' rotate-[38deg] bg-[rgba(247,183,113,0.7)]"></span>' +
          '<div class="flex items-start gap-2">' +
            '<span class="jc-label hl-g shrink-0 mt-0.5">EX ' + (i + 1) + '</span>' +
            '<div class="flex-1 min-w-0 ' + FS(13.5) + ' leading-[1.55] text-[#6b5540] break-words">' +
              env.hl(ex.en, d.word) + '</div>' +
            stbtn('toggle-ex', 'eye-btn example-toggle-btn', 'fa-solid fa-eye', 'Show Translation', on, i) +
          '</div>' +
          '<div class="jc-ex-zh' + (on ? '' : ' hide') + ' mt-1.5 pl-1 ' + FS(13) +
            ' leading-[1.5] text-[#8a7358] break-words">' + env.esc(ex.zh) + '</div>' +
          '</div>';
      });
      if (exHtml) exHtml = '<div class="flex flex-col gap-[10px]">' + exHtml + '</div>';

      return '<div class="jc-card word-card skin-journal' + (env.marked ? ' highlighted' : '') +
          ' relative box-border flex gap-5 min-h-[248px] px-7 py-[26px] mb-4 rounded-[20px]' +
          ' bg-[#fdf7ec] text-[#5a4632]' +
          ' shadow-[0_6px_18px_rgba(120,90,50,0.14),0_1px_3px_rgba(120,90,50,0.08)]"' +
          ' data-card-id="' + card.id + '">' +

        /* 柔光色斑（原版两枚） */
        '<span class="pointer-events-none absolute -top-[70px] -left-[50px] w-[230px] h-[190px]' +
          ' rounded-full bg-[rgba(247,196,145,0.3)]"></span>' +
        '<span class="pointer-events-none absolute -bottom-[90px] -right-10 w-[220px] h-[220px]' +
          ' rounded-full bg-[rgba(244,167,181,0.24)]"></span>' +

        /* 撒在纸上的小装饰 */
        '<i class="fa-solid fa-star pointer-events-none absolute z-[2] top-[9px] right-4 text-[17px]' +
          ' rotate-[14deg] text-[#f2b64c]"></i>' +
        '<i class="fa-regular fa-heart pointer-events-none absolute z-[2] top-8 right-10 text-xs' +
          ' -rotate-12 text-[#f2a0b5]"></i>' +
        '<i class="fa-solid fa-star pointer-events-none absolute z-[2] bottom-2.5 left-[170px]' +
          ' text-[11px] rotate-[20deg] text-[#f6c98f]"></i>' +

        /* ---------- 左：单词纸片 ---------- */
        '<div class="relative shrink-0 basis-[42%] min-w-0 -rotate-[1.2deg] rounded-[14px]' +
            ' border-2 border-[#f3e5cd] bg-[#fffdf8] px-4 pt-[22px] pb-[18px]' +
            ' shadow-[0_4px_10px_rgba(120,90,50,0.12)] flex flex-col items-center justify-center text-center">' +
          '<span class="jc-tape absolute z-[3] w-[92px] h-[22px] -top-2 -left-[26px] rotate-[-42deg]' +
            ' bg-[rgba(247,183,113,0.78)]"></span>' +
          '<span class="jc-index absolute -top-[9px] -right-[6px] font-bold text-[#b08d5f]">' +
            env.esc(idx) + '</span>' +
          '<div class="flex items-center justify-center gap-2.5 flex-wrap max-w-full">' +
            '<span class="jc-label hl-o">单词</span>' +
            '<div class="jc-word font-bold ' + FS(31) + ' leading-[1.18] text-[#4c3a28] break-words">' +
              env.esc(d.word) + '</div>' +
          '</div>' +
          (d.phonetic_us ? '<div class="mt-[9px] ' + FS(14) + ' text-[#b08d5f] font-mono">' +
            env.esc(d.phonetic_us) + '</div>' : '') +
          /* 小猫贴纸：标记后点亮（增强） */
          '<span class="jc-cat absolute -bottom-[17px] left-1/2 -translate-x-1/2 -rotate-6 w-[46px] h-[46px]' +
            ' rounded-full bg-white border-2 border-[#f6d7b8] flex items-center justify-center' +
            ' text-[22px] text-[#f0a05a] z-[4] shadow-[0_2px_6px_rgba(120,90,50,0.18)]">' +
            '<i class="fa-solid fa-cat"></i></span>' +
        '</div>' +

        /* ---------- 右：释义 / 元信息+动作 / 例句 ---------- */
        '<div class="flex-1 min-w-0 flex flex-col gap-[15px]">' +

          /* 释义纸片 */
          '<div class="relative rotate-[0.9deg] rounded-[14px] border-2 border-[#f3e5cd] bg-[#fffdf8]' +
              ' px-4 pt-[13px] pb-3 shadow-[0_3px_8px_rgba(120,90,50,0.1)]">' +
            '<span class="jc-tape absolute z-[3] w-[92px] h-[22px] -top-2 -right-[26px]' +
              ' rotate-[42deg] bg-[rgba(126,205,188,0.72)]"></span>' +
            /* 考试图章：原版写死 CET-6，这里跟卡组走 */
            '<span class="jc-stamp absolute top-[9px] right-[11px] font-bold tracking-wide' +
              ' text-[#d99a9a] border-[1.5px] border-[#f0cfcf] rounded-lg px-[7px] bg-white/60">' +
              env.esc(env.badge.text) + '</span>' +
            '<span class="jc-label hl-p">释义</span>' +
            '<div class="mt-[7px] flex flex-col gap-1.5">' +
              '<div class="jc-def-en ' + FS(14) + ' leading-[1.5] text-[#7a6248] break-words">' + enBody + '</div>' +
              '<div class="jc-zh ' + FS(16) + ' leading-[26px] font-semibold break-words">' + zhBody + '</div>' +
            '</div>' +
          '</div>' +

          /* 元信息 + 动作纸片 */
          '<div class="relative -rotate-[0.8deg] rounded-[14px] border-2 border-[#f3e5cd] bg-[#fffdf8]' +
              ' px-4 pt-[13px] pb-3 shadow-[0_3px_8px_rgba(120,90,50,0.1)]">' +
            '<span class="jc-tape absolute z-[3] w-[92px] h-[22px] -bottom-2 -left-[26px]' +
              ' rotate-[38deg] bg-[rgba(244,160,178,0.72)]"></span>' +
            '<div class="flex gap-2 items-center flex-wrap">' + meta.join('') + '</div>' +
            '<div class="mt-[9px] flex items-center justify-between gap-3">' +
              '<span class="jc-paw flex items-center gap-1.5 min-w-0 ' + FS(11.5) +
                ' text-[#c9a97e] tracking-[1.5px]">' +
                '<i class="fa-solid fa-paw text-[11px] text-[#e5b87c]"></i>MEMORY TAG</span>' +
              '<div class="jc-actions flex gap-[7px] flex-none">' +
                /* 图标沿用原版 js 的那一套：爪印 / 狗头 / 猫头（原版 html 里写的
                   star+bookmark 是占位，提交前被 js 覆盖掉了）。开关状态靠
                   .is-active 把整颗贴纸填成专属色，不再依赖 regular/solid 轮廓差。 */
                stbtn('play', 'act-play', 'fa-solid fa-paw', 'Play Pronunciation', false) +
                stbtn('toggle-def', 'act-eye', (env.peek ? 'fa-solid' : 'fa-regular') + ' fa-eye', 'Toggle Chinese', env.peek) +
                stbtn('mark', 'act-mark', 'fa-solid fa-dog', 'Mark as Unknown', env.marked) +
                stbtn('favorite', 'act-fav', 'fa-solid fa-cat', 'Favorite', env.fav) +
              '</div>' +
            '</div>' +
          '</div>' +

          exHtml +
        '</div>' +
        '</div>';
    }
  };
})();
