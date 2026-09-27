#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""星际航行日志 · Voyage Log —— 卡片数据生成器（**只产 cards.json**）

卡片模型：**一张卡 = 一天**，数据形如

    {'item_order': 1, 'data': {'date': '2026-08-06', 'tasks': [ ... ]}}

  · date  —— ISO 日期。卡片顺序 = 日期顺序：`item_order = N` ⟺ `date = start + (N-1)`
             （线性升序，第 N 张就是第 N 天；工具按 date 排，不依赖服务端队列序）
  · tasks —— **那天生效的打卡目标快照**（label / hint / icon / action）

为什么目标写在**每张卡**里：模板与工具是跨卡组共享的，只有**卡片数据是卡组私有的**。
旧版把 TASKS 写在模板里 ⇒ 换一次目标，所有打卡卡组一起变、历史也跟着变样。现在目标随卡
片固化，改目标只影响"那个月及以后"，历史月份保留当时的快照。

改目标 / 改范围（历史条目**不要删**，它们是旧月份的快照来源）：

    GOALS = [{'from': '2026-08', 'tasks': [MOVIE]}, ...]      # from 含当月，追加式
    python3 build_data.py                                     # 重写 dragoncard/default_cards/checkin_log/cards.json
    python3 _src/build.py --start 2026-08-06 --end 2027-10-31  # 显式指定范围

默认范围 = `HISTORY_START` → **明年十月末**（"到下一年的十月份"；一次铺满，年内不用重建）。

打卡记录不在卡片里：点一下 = 往宿主写一条埋点（`t_learning_event`），月历上的星点、
「航行第 N 天」、最近 7 天航迹全部由 `/v1/observability/data` 的 heatmap 实时算出
⇒ **任何一次重建/重导卡片都不会影响历史记录**。
"""
import calendar
import json
import os
import sys
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
PY_DIR = os.path.dirname(os.path.dirname(HERE))          # .../Python
OUT = os.path.join(PY_DIR, 'dragoncard', 'default_cards', 'checkin_log')

# 打卡历史首日（旧卡组「20 分钟美剧」最早一天），新卡组从这里起铺
HISTORY_START = date(2026, 8, 6)

MOVIE = {'action': 'movie_20min', 'label': '每日 20 分钟美剧', 'hint': '看一集，20 分钟', 'icon': 'fa-tv'}
READ = {'action': 'read_10pages', 'label': '阅读 10 页', 'hint': '随手翻十页', 'icon': 'fa-book'}

GOALS = [
    {'from': '2026-08', 'tasks': [MOVIE]},           # 8 月起：只看美剧
    {'from': '2026-09', 'tasks': [MOVIE, READ]},     # 9 月起：加读书（往后覆盖）
]


def end_default(today=None):
    """默认末卡 = **明年十月末**（用户口径："到下一年的十月份"）。"""
    t = today or date.today()
    y = t.year + 1
    return date(y, 10, calendar.monthrange(y, 10)[1])


def tasks_of(d):
    """取 `from <= 该月` 的**最后一条** GOALS（追加式 ⇒ 历史月份拿到的是当时的快照）。"""
    m = d.strftime('%Y-%m')
    hit = None
    for g in GOALS:
        if g['from'] <= m:
            hit = g
    return hit['tasks'] if hit else []


def day_list(start, end):
    if end < start:
        raise SystemExit('--end 不能早于 --start（%s < %s）' % (end, start))
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def main():
    args = sys.argv[1:]
    start_str = end_str = None
    i = 0
    while i < len(args):
        if args[i] == '--start':
            start_str = args[i + 1]
            i += 2
            continue
        if args[i] == '--end':
            end_str = args[i + 1]
            i += 2
            continue
        i += 1

    start = datetime.strptime(start_str, '%Y-%m-%d').date() if start_str else HISTORY_START
    end = datetime.strptime(end_str, '%Y-%m-%d').date() if end_str else end_default()

    days = day_list(start, end)
    cards = [
        {'item_order': n + 1, 'data': {'date': d.isoformat(), 'tasks': tasks_of(d)}}
        for n, d in enumerate(days)
    ]

    path = os.path.join(OUT, 'cards.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(cards, f, ensure_ascii=False, indent=1)

    # 自检：item_order 必须是 1..N，且 date 与序号一一对应
    bad = [c['item_order'] for n, c in enumerate(cards) if c['item_order'] != n + 1]
    if bad:
        raise SystemExit('item_order 不是 1..N：%s' % bad[:10])

    months = {}
    for c in cards:
        months.setdefault(c['data']['date'][:7], 0)
        months[c['data']['date'][:7]] += 1

    print('cards.json      %d 张（%s → %s，一天一张，线性升序）' % (len(cards), days[0], days[-1]))
    print('月份分布        %s' % ' '.join('%s:%d' % (k, v) for k, v in sorted(months.items())))
    print('目标快照        %s' % '; '.join(
        '%s→%s' % (g['from'], '+'.join(t['action'] for t in g['tasks'])) for g in GOALS))
    print('已写入          %s' % path)


if __name__ == '__main__':
    main()
