/* ==========================================================================
   星际航行日志 · 小工具
   --------------------------------------------------------------------------
   与原模板（default_cards/checkin_log/）的关系：
     · **卡面整套保留**：一天一张卡的那个"卡面"（大日期 / 航行第 N 天 / 黑洞 /
       任务行 / 最近 7 天航迹），三态也照旧 —— 今天深空、历史素净、未来淡紫锁定。
       规则见 assets/calendar.css 第 5 节，换皮肤时长相不变。
     · **承载方式**：卡组就是「一天一张卡」（452 张，`data = {date, tasks[]}`，目标快照
       写在**每张卡**里 = 卡组私有）。工具只做呈现：目录 = 月份列表，单卡 = 月历图 ＋
       点某一天弹出的那天的卡面。一天一张 ⇒ 452 张一页取不完，`loadAllCards()` 循环取满。

   宿主桥接 window.cardAPI（/v1/tools/<id>/run 注入）：
     deckId / userId / getPage / mark / favorite / track(action, itemId) / finish

   两条硬约束（踩过才知道）：
     1. 打卡必须带 deck_item_id，否则宿主**静默丢弃**（track 的第二个参数 =
        **那天的卡片**的 id；没有卡的日子只能看不能记）。
     2. track 只能在点击回调里调；render 期间调会变成"幻影事件"。
   ========================================================================== */
(function () {
  'use strict';

  var PAGE_SIZE = 100;

  /* 皮肤：只换颜色，版式不动。默认素白（浅色）——
     浅底上「今天的深空卡」才跳得出来；整页深色会让它贴底不跳（2026-09-22 用户拍板）。
     另一套星夜给「星辰大海」氛围用。 */
  var SKINS = [
    { id: 'plain', name: '素白', icon: 'fa-sun' },
    { id: 'night', name: '星夜', icon: 'fa-moon' }
  ];

  var WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var WD_COL = ['一', '二', '三', '四', '五', '六', '日'];

  var state = {
    deckId: (window.cardAPI && cardAPI.deckId) || null,
    userId: (window.cardAPI && cardAPI.userId) || null,
    months: [],              /* [{key, tasks, itemId}] 按月升序（tasks/itemId 取该月首卡） */
    days: {},                /* 'YYYY-MM-DD' -> {id, tasks} ←「一天一张」的卡片本体 */
    heat: {},                /* 'YYYY-MM-DD' -> {action: count} */
    day: {},                 /* 'YYYY-MM-DD' -> {loading, map} */
    tabs: [],                /* [{id:'s3', monthKey, idx}] */
    activeTab: 'catalogue',
    skin: 'plain',
    fontSize: 1,
    soundEnabled: true,
    modalDate: null,
    pendingTask: null        /* 小弹窗里"待确认点亮"的 action（null = 没弹） */
  };
  try { state.skin = localStorage.getItem('dc-voyage-skin') || 'plain'; } catch (e) {}
  try { state.fontSize = parseFloat(localStorage.getItem('dc-voyage-font')) || 1; } catch (e) {}
  try { state.soundEnabled = localStorage.getItem('dc-sound') !== '0'; } catch (e) {}

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ===== 日期工具 ===== */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayKey() { return keyOf(new Date()); }
  function curMonthKey() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
  function parseKey(k) { var p = String(k).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function shiftKey(k, n) { var d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function monthLabel(mk) { var p = mk.split('-'); return p[0] + ' 年 ' + (+p[1]) + ' 月'; }
  function monthShort(mk) { var p = mk.split('-'); return (+p[1]) + ' 月'; }
  function fmtDay(k) { var p = k.split('-'); return (+p[1]) + ' 月 ' + (+p[2]) + ' 日'; }
  function nowHM() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  /* ===== toast（与 coca-cards / 本体同款） ===== */
  var _toastTimer = null;
  function showToast(msg, isError) {
    var el = $id('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { el.className = 'toast' + (isError ? ' error' : ''); }, 2500);
  }

  /* ===== 成功音效（照抄本体 audioFeedback，键与本体相同：dc-sound） ===== */
  var audioFeedback = (function () {
    var ctx = null;
    function ac() {
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
      return ctx;
    }
    return {
      playSuccess: function () {
        if (state.soundEnabled === false) return;
        var c = ac(); if (!c) return;
        try {
          var o = c.createOscillator(), g = c.createGain();
          o.type = 'sine'; o.frequency.value = 660;
          g.gain.setValueAtTime(0.0001, c.currentTime);
          g.gain.exponentialRampToValueAtTime(0.15, c.currentTime + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18);
          o.connect(g); g.connect(c.destination);
          o.start(); o.stop(c.currentTime + 0.2);
        } catch (e) {}
      }
    };
  })();

  /* ===== 通用弹窗 ===== */
  function showModal(id) { var el = $id(id + '-modal'); if (el) el.style.display = 'flex'; }
  function hideModal(id) { var el = $id(id + '-modal'); if (el) el.style.display = 'none'; }

  /* ===== 自绘 tooltip（照抄本体 / coca-cards） ===== */
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

  /* ===== 皮肤 ===== */
  function applySkin() {
    document.body.dataset.skin = state.skin;
    try { localStorage.setItem('dc-voyage-skin', state.skin); } catch (e) {}
    renderSkinList();
  }
  function renderSkinList() {
    var list = $id('style-list');
    if (!list) return;
    list.innerHTML = SKINS.map(function (s) {
      return '<div class="skin-option' + (state.skin === s.id ? ' active' : '') + '" data-skin-id="' + s.id + '">' +
        '<i class="fa-solid ' + s.icon + '"></i><span>' + esc(s.name) + '</span></div>';
    }).join('');
  }

  /* ===== 字号（只缩放卡面内容，月历不动） ===== */
  function applyCardFont() {
    document.documentElement.style.setProperty('--card-font-scale', String(state.fontSize));
    var v = $id('font-size-value');
    if (v) v.textContent = Math.round(state.fontSize * 100) + '%';
    try { localStorage.setItem('dc-voyage-font', state.fontSize); } catch (e) {}
  }

  /* ===== 数据：卡片（一天一张 = date + tasks）+ 打卡记录 ===== */
  /* 452 张卡一页装不下 ⇒ 循环取满。服务端给的是"学习队列序"（会被历史动作打乱），
     所以顺序一律自己按 date 排，不依赖服务端的 current_order。 */
  function loadAllCards() {
    var out = [], page = 1;
    function step() {
      return cardAPI.getPage(page, PAGE_SIZE).then(function (d) {
        var batch = (d && d.cards) || [];
        out = out.concat(batch);
        if (batch.length < PAGE_SIZE || page >= 20) return out;
        page += 1;
        return step();
      });
    }
    return step();
  }
  function loadMonths() {
    if (!state.deckId) return Promise.resolve([]);
    return loadAllCards().then(function (cards) {
      state.days = {};
      var byMonth = {};
      cards.forEach(function (c) {
        var d = c.data || {};
        if (!d.date) return;                 /* 旧残骸 / 别的卡组的卡：跳过 */
        state.days[d.date] = { id: c.id, tasks: d.tasks || [] };
        var mk = d.date.slice(0, 7);
        /* 一个月的「目标」= 该月首卡的目标（目标只在月初变，首卡即当月口径） */
        if (!byMonth[mk] || d.date < byMonth[mk].first) {
          byMonth[mk] = { first: d.date, tasks: d.tasks || [], itemId: c.id };
        }
      });
      state.months = Object.keys(byMonth).sort().map(function (mk) {
        return { key: mk, tasks: byMonth[mk].tasks, itemId: byMonth[mk].itemId };
      });
      return state.months;
    });
  }
  function loadHeat() {
    if (!state.deckId || !state.userId) return Promise.resolve({});
    return fetch('/v1/observability/data?view=heatmap&deck_id=' + state.deckId + '&user_id=' + state.userId)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var map = {};
        ((d && d.data) || []).forEach(function (row) {
          if (row && row.date) map[row.date] = row.actions || {};
        });
        state.heat = map;
        return map;
      })
      .catch(function () { return {}; });
  }
  function loadDay(dateStr) {
    if (state.day[dateStr] && !state.day[dateStr].loading) return Promise.resolve(state.day[dateStr].map);
    if (!state.deckId || !state.userId) return Promise.resolve({});
    state.day[dateStr] = { loading: true, map: (state.day[dateStr] || {}).map || {} };
    return fetch('/v1/observability/data?view=daily&date=' + dateStr + '&deck_id=' + state.deckId + '&user_id=' + state.userId)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var map = {};
        ((d && d.data) || []).forEach(function (row) {
          if (row && row.time) map[row.time] = row.actions || {};
        });
        state.day[dateStr] = { loading: false, map: map };
        return map;
      })
      .catch(function () { state.day[dateStr] = { loading: false, map: {} }; return {}; });
  }

  function total(actions) { var n = 0, k; for (k in actions) if (actions.hasOwnProperty(k)) n += actions[k]; return n; }
  function isActive(date) { return total(state.heat[date] || {}) > 0; }
  function countOf(date, action) { return ((state.heat[date] || {})[action]) || 0; }
  function activeDaysIn(monthKey) {
    var n = 0, k;
    for (k in state.heat) if (state.heat.hasOwnProperty(k) && k.indexOf(monthKey) === 0) n++;
    return n;
  }
  function litCountIn(monthKey) {
    var n = 0, k, a;
    for (k in state.heat) {
      if (!state.heat.hasOwnProperty(k) || k.indexOf(monthKey) !== 0) continue;
      for (a in state.heat[k]) if (state.heat[k].hasOwnProperty(a)) n += state.heat[k][a];
    }
    return n;
  }
  function streakEndingAt(dateStr) {
    var n = 0, k = dateStr, guard = 0;
    while (guard++ < 400 && isActive(k)) { n++; k = shiftKey(k, -1); }
    return n;
  }
  function globalStreak() {
    var keys = Object.keys(state.heat).sort();
    if (!keys.length) return 0;
    var last = keys[keys.length - 1];
    var ref = (last === todayKey() || last === shiftKey(todayKey(), -1)) ? last : null;
    return ref ? streakEndingAt(ref) : 0;
  }
  function monthOf(dateStr) {
    var mk = dateStr.slice(0, 7), i;
    for (i = 0; i < state.months.length; i++) if (state.months[i].key === mk) return state.months[i];
    return null;
  }
  function monthIndex(mk) {
    var i;
    for (i = 0; i < state.months.length; i++) if (state.months[i].key === mk) return i;
    return -1;
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /* ===== 目录：月份列表 ===== */
  function renderCatalogue() {
    var grid = $id('catalogue-grid');
    if (!grid) return;
    if (!state.months.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">这个卡组还没有月份数据。</div>';
      return;
    }
    var cm = curMonthKey(), html = '', year = null;
    state.months.forEach(function (m) {
      if (m.key.slice(0, 4) !== year) {
        year = m.key.slice(0, 4);
        html += '<div class="vg-year-sep">' + year + ' 年</div>';
      }
      var days = activeDaysIn(m.key);
      var dots = '';
      if (days) {
        m.tasks.forEach(function (t) {
          var lit = false, k;
          for (k in state.heat) {
            if (state.heat.hasOwnProperty(k) && k.indexOf(m.key) === 0 && state.heat[k][t.action]) { lit = true; break; }
          }
          dots += '<i class="' + (lit ? 'on' : '') + '"></i>';
        });
      }
      var isOpen = state.tabs.some(function (t) { return t.monthKey === m.key; });
      html += '<button class="vg-month' + (m.key === cm ? ' is-current' : '') + (isOpen ? ' is-open' : '') +
              '" data-month="' + m.key + '">' +
                '<span class="m-main">' + monthShort(m.key) + '</span>' +
                '<span class="m-sub">' + (days ? days + ' 天有记录' : '还没有记录') + '</span>' +
                '<span class="m-dots">' + dots + '</span>' +
              '</button>';
    });
    grid.innerHTML = html;
  }

  /* ===== 单个月的月历 ===== */
  function renderMonthPage(idx) {
    var container = $id('study-' + idx);
    if (!container) return;
    var m = state.months[idx];
    if (!m) { container.innerHTML = '<div class="empty-state">没有这个月。</div>'; return; }

    var first = parseKey(m.key + '-01');
    var y = first.getFullYear(), mo = first.getMonth();
    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var lead = (first.getDay() + 6) % 7;          /* 周一 = 第 0 列 */
    var tk = todayKey();
    var html = '<div class="vg-wrap"><div class="vg-cal">';

    html += '<div class="vg-top">' +
              '<button class="vg-nav" data-vg-nav="prev"' + (idx === 0 ? ' disabled' : '') +
                ' aria-label="上个月">&#8249;</button>' +
              '<div class="vg-title">' + monthLabel(m.key) + '</div>' +
              '<button class="vg-nav" data-vg-nav="next"' + (idx === state.months.length - 1 ? ' disabled' : '') +
                ' aria-label="下个月">&#8250;</button>' +
            '</div>';

    html += '<div class="vg-grid">';
    WD_COL.forEach(function (w) { html += '<div class="vg-wd">' + w + '</div>'; });
    var i;
    for (i = 0; i < lead; i++) html += '<div class="vg-day pad"></div>';

    for (var d = 1; d <= daysInMonth; d++) {
      var key = m.key + '-' + pad2(d);
      var acts = state.heat[key] || {};
      var isToday = key === tk;
      var isFuture = key > tk;
      var cls = 'vg-day';
      if (isToday) cls += ' today';
      else if (isFuture) cls += ' future';
      var on = false, t, a;
      for (t = 0; t < m.tasks.length; t++) if (acts[m.tasks[t].action]) { on = true; break; }
      if (!on) { for (a in acts) if (acts.hasOwnProperty(a)) { on = true; break; } }
      if (on) cls += ' on';

      var pips = '';
      if (on) {
        for (t = 0; t < m.tasks.length; t++) {
          pips += '<i class="' + (acts[m.tasks[t].action] ? 'on' : '') + '"></i>';
        }
        /* 不在本月目标里、但确实有记录的动作补一颗亮星，免得看着"漏了" */
        for (a in acts) {
          if (!acts.hasOwnProperty(a)) continue;
          var known = false;
          for (t = 0; t < m.tasks.length; t++) if (m.tasks[t].action === a) known = true;
          if (!known) pips += '<i class="on"></i>';
        }
        if (!pips) pips = '<i class="on"></i>';
      }

      html += '<div class="' + cls + '" data-date="' + key + '">' +
                '<span class="vg-num">' + d + '</span>' +
                '<span class="vg-pips">' + pips + '</span>' +
              '</div>';
    }
    var tail = (7 - ((lead + daysInMonth) % 7)) % 7;
    for (i = 0; i < tail; i++) html += '<div class="vg-day pad"></div>';
    html += '</div>';

    var n = activeDaysIn(m.key);
    html += '<div class="vg-foot">' +
              '<span>' + monthShort(m.key) + ' · ' + (n ? n + ' 天有记录' : '还没有记录') + '</span>' +
              '<span>' + (globalStreak() ? '连续 ' + globalStreak() + ' 天' : '还没开始连') + '</span>' +
            '</div>';

    html += '</div></div>';
    container.innerHTML = html;
  }

  /* ===== 卡面（照搬原模板的 render / init 逻辑） ===== */
  function modeOf(dateStr) {
    var tk = todayKey();
    return dateStr === tk ? 'today' : (dateStr > tk ? 'future' : 'past');
  }
  /* 本月目标里没有、却有记录的动作，补成只读行 —— 免得历史月"看不见自己做过什么" */
  function extraActions(dateStr, tasks) {
    var acts = state.heat[dateStr] || {}, out = [], a, i, known;
    for (a in acts) {
      if (!acts.hasOwnProperty(a)) continue;
      known = false;
      for (i = 0; i < tasks.length; i++) if (tasks[i].action === a) known = true;
      if (!known) out.push({ action: a, label: a, hint: '', icon: 'fa-star', _extra: true });
    }
    return out;
  }
  function rowsOf(dateStr) {
    var day = state.days[dateStr];            /* 只认「那天的卡」里的目标快照；没有卡 = 不在范围 */
    var tasks = ((day && day.tasks) || []).slice();
    return tasks.concat(extraActions(dateStr, tasks));
  }
  function streakFor(dateStr, mode) {
    if (mode === 'today') {
      var ref = isActive(dateStr) ? dateStr : shiftKey(dateStr, -1);
      return streakEndingAt(ref);
    }
    return streakEndingAt(dateStr);
  }
  function timeOf(dateStr, action) {
    var dm = (state.day[dateStr] || {}).map || {}, hm;
    for (hm in dm) if (dm.hasOwnProperty(hm) && dm[hm] && dm[hm][action]) return hm;
    return '';
  }
  function weekHtml(dateStr) {
    var html = '', i, k, d, on, cls, tk = todayKey();
    for (i = 6; i >= 0; i--) {
      k = shiftKey(dateStr, -i);
      d = parseKey(k);
      on = isActive(k);
      cls = 'ci-wd' + (on ? ' on' : '') + (k === dateStr ? ' cur' : '') + (k === tk ? ' now' : '');
      html += '<div class="' + cls + '" title="' + k + (on ? ' · 有记录' : ' · 无记录') + '">' +
              '<span>' + WEEK_CN[d.getDay()].charAt(1) + '</span><i></i></div>';
    }
    return html;
  }
  /* 某个月有多少天（"YYYY-MM"） */
  function daysInMonth(mk) {
    var p = mk.split('-');
    return new Date(+p[0], +p[1], 0).getDate();
  }
  /* 本月一览星条：一天一格，亮 = 那天有记录，蓝框 = 今天，浅 = 还没到 */
  function monthStripHtml(dateStr) {
    var mk = dateStr.slice(0, 7);
    var tk = todayKey();
    var n = daysInMonth(mk);
    var html = '', i, k, cls;
    for (i = 1; i <= n; i++) {
      k = mk + '-' + pad2(i);
      cls = [];
      if (isActive(k)) cls.push('on');
      if (k === tk) cls.push('today');
      if (k > tk) cls.push('future');
      html += '<i class="' + cls.join(' ') + '" title="' + fmtDay(k) +
              (isActive(k) ? ' · 有记录' : ' · 无记录') + '"></i>';
    }
    return '<div class="dv-mstrip">' + html + '</div>';
  }
  function dayCardHtml(dateStr) {
    var m = monthOf(dateStr);
    var mode = modeOf(dateStr);
    var dt = parseKey(dateStr);
    var rows = rowsOf(dateStr);
    var html = '';

    var doneCount = 0;
    rows.forEach(function (t) { if (countOf(dateStr, t.action) > 0) doneCount++; });
    var allDone = rows.length > 0 && doneCount >= rows.length;
    var mkey = dateStr.slice(0, 7);
    var streak = mode === 'future' ? 0 : streakFor(dateStr, mode);

    /* 三态（今天深空 / 历史素净 / 未来淡紫）**只挂左栏那张"卡"**。
       ⚠️ 别给外层 .dv-a 也加 ci-<mode>：`.ci-today .ci-task` 这类后代选择器会
       顺着外层把右栏的浅色清单也刷成深空色（踩过，右栏整片变黑）。 */
    html += '<div class="dv-a" data-date="' + dateStr + '" data-mode="' + mode + '">';
    html +=   '<div class="dv-a-left">';
    html +=     '<div class="ci-card ci-' + mode + '">';
    html +=       '<div class="ci-bar"></div>';
    html +=       '<div class="ci-body">';

    html +=     '<div class="ci-head">';
    html +=       '<div class="ci-date">';
    html +=         '<span class="ci-day">' + dt.getDate() + '</span>';
    html +=         '<span class="ci-ym"><b>' + dt.getFullYear() + ' 年 ' + (dt.getMonth() + 1) + ' 月</b>' +
                    '<i>' + WEEK_CN[dt.getDay()] + '</i>' +
                    (mode === 'today' ? '<span class="ci-today-chip">今天</span>' : '') + '</span>';
    html +=       '</div>';
    if (mode !== 'future') {
      html +=     '<div class="ci-streak' + (streak > 0 ? '' : ' is-idle') +
                    '" data-role="streak" title="连续记录天数">' +
                    (mode === 'today'
                      ? '<i class="fa-solid fa-rocket"></i><em>航行第</em><b>' + streak + '</b><em>天</em>'
                      : '<i class="fa-solid fa-fire"></i><b>' + streak + '</b><em>天</em>') +
                  '</div>';
    }
    html +=     '</div>';          /* /ci-head —— 必须在黑洞之前闭合！
                                      它是个 flex 行，放进去的东西会变成横向项，
                                      黑洞就被挤到日期右边去了（踩过）。 */

    /* 中段：今天给黑洞，历史给"那天几颗星"，未来给锁 */
    if (mode === 'today') {
      html +=   '<div class="dv-a-bh"><span class="bh" aria-hidden="true">' +
                  '<span class="bh-halo"></span><span class="bh-disk"></span>' +
                  '<span class="bh-arc"></span><span class="bh-core"></span>' +
                '</span></div>';
    } else if (mode === 'past') {
      html +=   '<div class="dv-a-hero' + (doneCount ? '' : ' is-idle') + '">' +
                  '<b>' + doneCount + '</b><em>颗星在这天亮起</em></div>';
    } else {
      html +=   '<div class="dv-a-hero is-locked">' +
                  '<i class="fa-solid fa-lock"></i><em>还没到那一天</em></div>';
    }

    /* 7 天航迹留在左栏（今天态由 CSS 的 margin-top:auto 钉在底边） */
    if (mode !== 'future') html += '<div class="ci-week" data-role="week">' + weekHtml(dateStr) + '</div>';

    html +=       '</div>';        /* /ci-body */
    html +=     '</div>';          /* /ci-card */
    html +=   '</div>';            /* /dv-a-left */

    /* ---------- 右栏：干活的地方（清单 + 本月一览 + 状态行） ---------- */
    html +=   '<div class="dv-a-right">';

    var cap, chip = '', chipIdle = false, sub, status;
    if (mode === 'future') {
      cap = '还没到那一天';
      sub = '到那天才会解锁';
      status = '待解锁 · 到那天就能记录';
    } else if (mode === 'past') {
      cap = rows.length ? '那天的航行记录' : '这一天没有记录';
      if (rows.length) { chip = doneCount + ' / ' + rows.length; chipIdle = !doneCount; }
      sub = '历史只读 · 补记要改数据';
      status = doneCount ? '当天记录了 <b>' + doneCount + '</b> 项' : '这一天没有记录';
    } else {
      cap = rows.length ? '今天要做的 ' + rows.length + ' 件事' : '这一天没有登记目标';
      if (rows.length) { chip = doneCount + ' / ' + rows.length + ' 已完成'; chipIdle = !doneCount; }
      sub = rows.length ? '点一行 → 小弹窗选「是」就点亮一颗星' : '这一天不在卡组范围内，暂时记不了';
      status = !rows.length ? '这一天不在卡组范围内，暂时记不了'
             : (doneCount ? '今天已记录 <b>' + doneCount + '</b> 项' + (allDone ? ' · 全部完成' : '')
                          : '今天还没有记录，点一下点亮一颗星');
    }
    html +=     '<div class="dv-a-cap"><h3>' + esc(cap) + '</h3>' +
                  (chip ? '<em' + (chipIdle ? ' class="is-idle"' : '') + '>' + chip + '</em>' : '') +
                '</div>';
    html +=     '<p class="dv-a-sub">' + esc(sub) + '</p>';

    if (mode === 'future') {
      html +=   '<div class="ci-lock"><i class="fa-solid fa-lock"></i><span>到那天才会解锁</span></div>';
    } else if (!rows.length) {
      html +=   '<div class="ci-lock"><i class="fa-solid fa-circle-info"></i><span>没有登记目标</span></div>';
    } else {
      html +=   '<div class="ci-tasks">';
      rows.forEach(function (t) {
        var done = countOf(dateStr, t.action) > 0;
        var time = done ? timeOf(dateStr, t.action) : '';
        var right = done
          ? '<i class="fa-solid fa-check"></i><b>' + (time || '已记录') + '</b>'
          : (mode === 'today'
              ? '<i class="fa-solid fa-plus" data-role="plus"></i><b>点亮</b>'
              : '<b>—</b>');
        html += '<div class="ci-task' + (done ? ' done' : '') + '" data-task="' + esc(t.action) + '"' +
                  ' title="' + esc(t.label) + '">' +
                  '<span class="ci-dot">' +
                    '<i class="fa-solid ' + esc(t.icon || 'fa-circle') + '" data-role="dot-task"></i>' +
                    '<i class="fa-solid fa-check" data-role="dot-check"></i>' +
                  '</span>' +
                  '<span class="ci-info"><b>' + esc(t.label) + '</b>' +
                    (t.hint ? '<i>' + esc(t.hint) + '</i>' : '') + '</span>' +
                  '<span class="ci-right" data-role="right">' + right + '</span>' +
                '</div>';
      });
      html +=   '</div>';
    }

    /* 本月一览：一眼看出这个月哪天亮过 */
    var dim = daysInMonth(mkey);
    html +=     '<div class="dv-a-mbox">' +
                  '<div class="dv-a-mcap"><span>本月一览 · ' + monthLabel(mkey) + '</span>' +
                  '<span>' + activeDaysIn(mkey) + ' / ' + dim + ' 天有记录</span></div>' +
                  monthStripHtml(dateStr) +
                '</div>';

    html +=     '<div class="dv-a-foot">' +
                  '<span data-role="status">' + status + '</span>' +
                  (mode === 'future' ? '<span></span>' : '<span>连续 <b>' + streak + '</b> 天</span>') +
                '</div>';

    html +=   '</div>';            /* /dv-a-right */
    html += '</div>';              /* /dv-a */
    return html;
  }

  /* ===== 卡面弹窗 ===== */
  function refreshModal() {
    if (!state.modalDate) return;
    var host = $id('day-card-host');
    if (!host) return;
    host.innerHTML = dayCardHtml(state.modalDate);
  }
  function openDay(dateStr) {
    state.modalDate = dateStr;
    state.pendingTask = null;
    refreshModal();
    showModal('day');
    /* "几点记的"要单独查一次（分桶接口），到了再补上时间，不整块重画 */
    loadDay(dateStr).then(function () {
      if (state.modalDate !== dateStr) return;
      var host = $id('day-card-host');
      if (!host) return;
      rowsOf(dateStr).forEach(function (t) {
        var el = host.querySelector('.ci-task[data-task="' + cssEsc(t.action) + '"]');
        if (!el || !el.classList.contains('done')) return;
        var time = timeOf(dateStr, t.action);
        if (!time) return;
        var right = el.querySelector('[data-role="right"]');
        if (right) right.innerHTML = '<i class="fa-solid fa-check"></i><b>' + time + '</b>';
      });
    });
  }
  function closeDay() {
    hideModal('day');
    hideModal('task');          /* 卡面关了，挂在它上面的确认弹窗也要收掉 */
    state.modalDate = null;
    state.pendingTask = null;
  }
  function labelOf(dateStr, action) {
    var m = monthOf(dateStr), i;
    if (m) for (i = 0; i < m.tasks.length; i++) if (m.tasks[i].action === action) return m.tasks[i].label;
    return action;
  }

  /* ===== 点亮：点任务行 → 小弹窗（是 / 否）→「是」才写库 =====
     历史：卡面自带的「点两下」防误触（第一下只把右边小字从『点亮』改成『确认』）。
     2026-09-22 用户反馈「点亮的时候没有反馈，好像点了两次就行了，很奇怪」
     —— 确实：那个状态变化只有 12px，且 hover 也没高亮（选择器选不中右栏）。
     现在第一下就给足反馈：整行高亮 + 弹出明确的「是 / 否」弹窗。 */
  function onTaskClick(row) {
    var dateStr = state.modalDate;
    if (!dateStr || modeOf(dateStr) !== 'today') return;   /* 历史/未来只读 */
    var action = row.getAttribute('data-task');
    if (!action) return;
    if (row.classList.contains('done')) {
      showToast('「' + labelOf(dateStr, action) + '」今天已经点亮过了');
      return;
    }
    openTaskConfirm(action);
  }
  function openTaskConfirm(action) {
    var dateStr = state.modalDate;
    if (!state.days[dateStr]) { showToast('这一天不在卡组范围内', true); return; }
    state.pendingTask = action;
    var t = $id('task-modal-title'), s = $id('task-modal-sub');
    if (t) t.textContent = '点亮「' + labelOf(dateStr, action) + '」？';
    if (s) s.textContent = fmtDay(dateStr) + ' · 记一次亮一颗星';
    showModal('task');
    var yes = $id('task-modal-yes');
    if (yes) try { yes.focus(); } catch (e) {}
  }
  function closeTaskConfirm() {
    hideModal('task');
    state.pendingTask = null;
  }
  function confirmTask() {
    var dateStr = state.modalDate;
    var action = state.pendingTask;
    closeTaskConfirm();
    if (!dateStr || !action) return;
    doCheckin(dateStr, action);
  }
  /* 真正写库 + 当场把界面点亮（月历那格 / 目录 / 顶栏统计一起刷新） */
  function doCheckin(dateStr, action) {
    var day = state.days[dateStr];
    if (!day) { showToast('这一天不在卡组范围内', true); return; }
    /* ★ 打卡写库：动作名 + **那天的卡片 item id**（不带 id 宿主会静默丢弃；日卡 id 与日期一一对应） */
    cardAPI.track(action, day.id);
    if (!state.heat[dateStr]) state.heat[dateStr] = {};
    state.heat[dateStr][action] = (state.heat[dateStr][action] || 0) + 1;
    var hm = nowHM();
    if (!state.day[dateStr]) state.day[dateStr] = { loading: false, map: {} };
    if (!state.day[dateStr].map[hm]) state.day[dateStr].map[hm] = {};
    state.day[dateStr].map[hm][action] = (state.day[dateStr].map[hm][action] || 0) + 1;

    refreshModal();
    var fresh = $id('day-card-host').querySelector('.ci-task[data-task="' + cssEsc(action) + '"]');
    if (fresh) {
      fresh.classList.remove('ci-pop');
      void fresh.offsetWidth;
      fresh.classList.add('ci-pop');
    }
    renderMonthPage(currentMonthIdx());
    renderCatalogue();
    updateStats();
    audioFeedback.playSuccess();     /* 打卡给一声"叮"，和「结束这一页」同一个音 */
    showToast('已点亮「' + labelOf(dateStr, action) + '」');
  }

  /* ===== 页签 ===== */
  function renderTabs() {
    var container = $id('study-tabs-container');
    if (!container) return;
    container.innerHTML = state.tabs.map(function (t) {
      var isActive = state.activeTab === t.id;
      return '<div class="tab-item study-tab ' + (isActive ? 'active' : '') + '" data-tab="' + t.id + '">' +
        '<span>' + t.monthKey + '</span>' +
        '<button class="tab-close-btn" data-tab-id="' + t.id + '" data-tooltip="结束这一页">&times;</button>' +
        '</div>';
    }).join('');
    var brandBtn = $id('home-btn');
    if (brandBtn) brandBtn.classList.toggle('active', state.activeTab === 'catalogue');
  }
  function openMonth(idx) {
    var m = state.months[idx];
    if (!m) return;
    var exist = state.tabs.filter(function (t) { return t.monthKey === m.key; })[0];
    if (exist) {
      var el = document.querySelector('[data-tab="' + exist.id + '"]');
      if (el) { el.classList.add('shake'); setTimeout(function () { el.classList.remove('shake'); }, 300); }
      return;
    }
    state.tabs.push({ id: 's' + idx, monthKey: m.key, idx: idx });
    state.tabs.sort(function (a, b) { return a.idx - b.idx; });
    saveOpenTabs();
    renderTabs();
    renderMonthPages();
    renderCatalogue();
  }
  function closeTab(id) {
    state.tabs = state.tabs.filter(function (t) { return t.id !== id; });
    saveOpenTabs();
    if (state.activeTab === id) state.activeTab = 'catalogue';
    renderTabs();
    renderMonthPages();
    renderContent();
    renderCatalogue();
  }
  function setActiveTab(id) {
    state.activeTab = id;
    renderTabs();
    renderContent();
    if (id.charAt(0) === 's') renderMonthPage(parseInt(id.slice(1), 10));
  }
  function saveOpenTabs() {
    if (!state.deckId) return;
    try {
      localStorage.setItem('dc-voyage-tabs-' + state.deckId,
        JSON.stringify(state.tabs.map(function (t) { return t.idx; })));
    } catch (e) {}
  }
  function restoreOpenTabs() {
    if (!state.deckId) return;
    var saved = null;
    try { saved = localStorage.getItem('dc-voyage-tabs-' + state.deckId); } catch (e) {}
    if (!saved) return;
    try {
      JSON.parse(saved).forEach(function (idx) {
        var m = state.months[idx];
        if (!m) return;
        if (state.tabs.some(function (t) { return t.monthKey === m.key; })) return;
        state.tabs.push({ id: 's' + idx, monthKey: m.key, idx: idx });
      });
      state.tabs.sort(function (a, b) { return a.idx - b.idx; });
    } catch (e) {}
  }
  function currentMonthIdx() {
    if (state.activeTab && state.activeTab.charAt(0) === 's') return parseInt(state.activeTab.slice(1), 10);
    return state.modalDate ? monthIndex(state.modalDate.slice(0, 7)) : -1;
  }
  function renderMonthPages() {
    var container = $id('study-pages-container');
    if (!container) return;
    var existing = {};
    $all('.study-page', container).forEach(function (el) { existing[el.dataset.tabId] = el; });
    var html = '';
    state.tabs.forEach(function (t) {
      if (existing[t.id]) {
        existing[t.id].style.display = state.activeTab === t.id ? 'block' : 'none';
      } else {
        html += '<div class="study-page" data-tab-id="' + t.id + '" style="display:' +
                (state.activeTab === t.id ? 'block' : 'none') + '"><div id="study-' + t.idx + '"></div></div>';
      }
    });
    Object.keys(existing).forEach(function (id) {
      if (!state.tabs.some(function (t) { return t.id === id; })) existing[id].remove();
    });
    if (html) container.insertAdjacentHTML('beforeend', html);
    if (currentMonthIdx() >= 0) renderMonthPage(currentMonthIdx());
  }
  function renderContent() {
    var cat = $id('catalogue-view');
    if (state.activeTab === 'catalogue') {
      if (cat) cat.style.display = 'block';
      $all('.study-page').forEach(function (el) { el.style.display = 'none'; });
    } else {
      if (cat) cat.style.display = 'none';
      $all('.study-page').forEach(function (el) {
        el.style.display = el.dataset.tabId === state.activeTab ? 'block' : 'none';
      });
    }
  }
  function updateStats() {
    var el = $id('stats-text');
    var n = Object.keys(state.heat).length;
    if (el) el.textContent = n ? '航行 ' + n + ' 天' : '还没有记录';
  }

  /* ===== 结束这一页的确认框 ===== */
  function showFinishModal(tabId) {
    state._closingTabId = tabId;
    var tab = state.tabs.filter(function (t) { return t.id === tabId; })[0];
    var mk = tab ? tab.monthKey : '';
    var totalEl = $id('finish-total'), markedEl = $id('finish-marked');
    if (totalEl) totalEl.textContent = mk ? activeDaysIn(mk) : 0;
    if (markedEl) markedEl.textContent = mk ? litCountIn(mk) : 0;
    var sub = $id('finish-subtitle');
    if (sub) sub.textContent = mk ? monthLabel(mk) + ' · 回顾这段航行' : '回顾这段航行';
    showModal('finish');
  }

  /* ===== 月历上的浮层提示 ===== */
  var vgTip = null;
  function tipText(dateStr) {
    var m = monthOf(dateStr);
    var acts = state.heat[dateStr] || {};
    var names = [], i, a;
    if (m) for (i = 0; i < m.tasks.length; i++) if (acts[m.tasks[i].action]) names.push(m.tasks[i].label);
    for (a in acts) {
      if (!acts.hasOwnProperty(a)) continue;
      var known = false;
      if (m) for (i = 0; i < m.tasks.length; i++) if (m.tasks[i].action === a) known = true;
      if (!known) names.push(a);
    }
    return fmtDay(dateStr) + ' · ' + (names.length ? names.join('、') : '没有记录');
  }
  function moveTip(e) {
    if (!vgTip || !vgTip.classList.contains('show')) return;
    var x = e.clientX + 14, y = e.clientY - 36;
    if (x + vgTip.offsetWidth > window.innerWidth - 10) x = e.clientX - vgTip.offsetWidth - 14;
    if (y < 8) y = 8;
    vgTip.style.left = x + 'px';
    vgTip.style.top = y + 'px';
  }

  /* ===== 事件委托 ===== */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      /* --- 卡面弹窗里的任务行 --- */
      var taskRow = target.closest('#day-card-host .ci-task');
      if (taskRow) { onTaskClick(taskRow); return; }

      /* --- 点亮确认小弹窗（是 / 否）---
             ⚠️ 这三行必须排在下面 #day-modal 的"点遮罩就关"之前：小弹窗是压在大弹窗
                上面的（z-index 600 > 500），点它不能被当成"点了大弹窗的空白处"。 */
      if (target.closest('#task-modal-yes')) { confirmTask(); return; }
      if (target.closest('#task-modal-no')) { closeTaskConfirm(); return; }
      if (target.closest('#task-modal') && !target.closest('.task-modal')) { closeTaskConfirm(); return; }

      if (target.closest('#day-modal') && !target.closest('.day-modal-box')) { closeDay(); return; }

      /* --- 月历：点某一天 → 弹那天的卡面 --- */
      var dayCell = target.closest('.vg-day');
      if (dayCell && !dayCell.classList.contains('pad') && dayCell.dataset.date) {
        openDay(dayCell.dataset.date);
        return;
      }
      /* 翻月 = 切到相邻月份（开它的页签） */
      var nav = target.closest('[data-vg-nav]');
      if (nav) {
        var idx = currentMonthIdx();
        var ni = idx + (nav.dataset.vgNav === 'next' ? 1 : -1);
        if (ni >= 0 && ni < state.months.length) {
          if (state.tabs.some(function (t) { return t.id === 's' + ni; })) setActiveTab('s' + ni);
          else { openMonth(ni); setActiveTab('s' + ni); }
        }
        return;
      }

      /* --- 目录：点月份 → 开页签（只开不切，与本体一致） --- */
      var mBtn = target.closest('.vg-month');
      if (mBtn) {
        var mi = monthIndex(mBtn.dataset.month);
        if (mi >= 0) openMonth(mi);
        return;
      }
      /* --- 页签 --- */
      if (target.closest('.tab-item') && !target.closest('.tab-close-btn')) {
        var tid = target.closest('.tab-item').dataset.tab;
        if (state.activeTab === tid) {
          var el = target.closest('.tab-item');
          el.classList.add('shake');
          setTimeout(function () { el.classList.remove('shake'); }, 300);
        } else setActiveTab(tid);
        return;
      }
      var closeBtn = target.closest('.tab-close-btn');
      if (closeBtn) { showFinishModal(closeBtn.dataset.tabId); return; }

      /* --- 结束这一页 --- */
      if (target.closest('#modal-finish-cancel')) { hideModal('finish'); return; }
      if (target.closest('#modal-finish-confirm')) {
        hideModal('finish');
        audioFeedback.playSuccess();
        closeTab(state._closingTabId);
        return;
      }

      if (target.closest('#home-btn')) { setActiveTab('catalogue'); return; }

      /* --- 皮肤下拉 --- */
      if (target.closest('#style-btn')) {
        var dd = $id('style-dropdown');
        renderSkinList();
        dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        return;
      }
      var skinOpt = target.closest('[data-skin-id]');
      if (skinOpt) {
        state.skin = skinOpt.dataset.skinId;
        applySkin();
        $id('style-dropdown').style.display = 'none';
        return;
      }

      /* --- 字号抽屉 --- */
      if (target.closest('#font-settings-btn')) {
        var drawer = $id('font-drawer');
        var btn = target.closest('#font-settings-btn');
        var r = btn.getBoundingClientRect();
        drawer.style.top = (r.bottom + 8) + 'px';
        drawer.style.left = (r.left + r.width / 2) + 'px';
        drawer.style.transform = 'translateX(-50%)';
        drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
        return;
      }
      if (target.closest('#font-size-minus')) { state.fontSize = Math.max(0.8, Math.round((state.fontSize - 0.1) * 10) / 10); applyCardFont(); return; }
      if (target.closest('#font-size-plus')) { state.fontSize = Math.min(1.8, Math.round((state.fontSize + 0.1) * 10) / 10); applyCardFont(); return; }
      if (target.closest('#reset-fonts')) { state.fontSize = 1; applyCardFont(); return; }

      /* --- 刷新：按钮已删（顶栏只留必要项）。数据在打开时读一次，
             打卡当场改的是内存态，所以没有"需要手动刷新"的场景。 --- */

      /* --- 今天的卡 --- */
      if (target.closest('#card-view-btn')) { openDay(todayKey()); return; }

      /* --- 点空白收起浮层 --- */
      if (!target.closest('#style-dropdown') && !target.closest('#style-btn')) {
        var sdd = $id('style-dropdown');
        if (sdd) sdd.style.display = 'none';
      }
      if (!target.closest('#font-drawer') && !target.closest('#font-settings-btn')) {
        var fd = $id('font-drawer');
        if (fd) fd.style.display = 'none';
      }
    });

    /* Esc：先退小弹窗，再关卡面（逐层退） */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (state.pendingTask) { closeTaskConfirm(); return; }
      closeDay();
    });

    /* 月历悬停提示 */
    document.addEventListener('mouseover', function (e) {
      var cell = e.target && e.target.closest && e.target.closest('.vg-day');
      if (!cell || cell.classList.contains('pad') || !cell.dataset.date) {
        if (vgTip) vgTip.classList.remove('show');
        return;
      }
      if (!vgTip) return;
      vgTip.textContent = tipText(cell.dataset.date);
      vgTip.classList.add('show');
      moveTip(e);
    });
    document.addEventListener('mousemove', function (e) {
      if (e.target && e.target.closest && e.target.closest('.vg-day')) moveTip(e);
    });
    window.addEventListener('scroll', function () { if (vgTip) vgTip.classList.remove('show'); }, true);
  }

  /* ===== 初始化 ===== */
  function init() {
    vgTip = $id('vg-tip');
    applySkin();
    applyCardFont();
    initTooltip();
    bindEvents();

    var title = $id('study-deck-title');
    if (title) title.textContent = '星际航行日志';

    Promise.all([loadHeat(), loadMonths()]).then(function () {
      restoreOpenTabs();
      /* 一进来就把"这个月"开好，省得每次都得点一下目录 */
      var ci = monthIndex(curMonthKey());
      if (ci >= 0 && !state.tabs.some(function (t) { return t.idx === ci; })) openMonth(ci);
      if (ci >= 0) state.activeTab = 's' + ci;
      renderTabs();
      renderMonthPages();
      renderContent();
      renderCatalogue();
      updateStats();
    }).catch(function () {
      var grid = $id('catalogue-grid');
      if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">加载失败，检查卡组绑定。</div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
