#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DragonCard 小工具打包器。

扫描 tools/ 子目录下每个含 manifest.json 的工具目录，打包为 dist/<name>.zip。
压缩的是目录"内容"（进入目录再打包），保证 index.html 在 zip 根目录。

用法：
  python3 build.py            # 打包全部工具
  python3 build.py coca-cards # 只打包指定工具

去掉音频（音标 / 拼读类工具要交付"不带第三方录音"的公开版时用）：
  DC_NO_AUDIO=1 python3 build.py ipa-cards
    → 跳过 assets/phonemes/**，产物叫 dist/<name>-noaudio.zip
  工具在音频缺失时会退化成"读第一个例词 + 提示"，不会静默失败（已实测）。

卡组数据 sidecar：
  manifest.json 里加一个（可选）"cardsJson": "../dragoncard/default_cards/xxx/cards.json"
  （相对本目录），打包时就会顺手产出 dist/<name>.cards.json ——
  用户导入卡组用的那一份。**数据血缘靠它保持**：值必须是源目录里那份原始数据，
  不要在这里手改内容，改了就跟模板/商品源分叉了。
  会做四项体检/规范：
    · 数组非空、每项是对象
    · 嵌套 {item_order, data:{…}} 自动摊平成 {item_order, …}（导入器本来就解包 data，
      摊平只是让所有工具的 sidecar 形状统一；已扁平的项原样不动）
    · item_order 是 1..N 的排列（只是缺号才补，重复或非数字直接报错）
    · 以 utf-8 + indent=1 写出，末尾带换行
"""
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, 'tools')
DIST = os.path.join(HERE, 'dist')

# 不带音频的构建：这些路径整段跳过
NO_AUDIO = os.environ.get('DC_NO_AUDIO') == '1'
AUDIO_PREFIX = 'assets/phonemes/'


def flatten_item(item):
    """把嵌套的 {item_order, data:{…}} 摊平成 {item_order, …}。
    导入器本来就会解包 data（库里的 t_deck_item.data 就是扁平的），摊平只是让
    所有工具的 sidecar 形状统一。**已经扁平的项原样返回**，所以是老格式的源也安全。
    实测：japanese_gojuon 的嵌套源摊平后与既有 dist sidecar 逐字一致。"""
    inner = item.get('data')
    if not isinstance(inner, dict):
        return item
    merged = dict(inner)
    for k, v in item.items():
        if k not in ('data', 'item_order'):
            merged.setdefault(k, v)
    if 'item_order' in item:
        merged['item_order'] = item['item_order']
    return merged


def build_cards(tool_dir, safe, manifest):
    """按 manifest['cardsJson'] 产出 dist/<safe>.cards.json。
    返回 (cards_path 或 None, 错误信息 或 None)。"""
    rel = manifest.get('cardsJson')
    if not rel:
        return None, None
    src = os.path.normpath(os.path.join(HERE, rel))
    if not os.path.isfile(src):
        return None, 'cardsJson 指向的文件不存在：%s' % rel
    try:
        with open(src, encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, 'cardsJson 不是合法 JSON：%s' % rel
    if not isinstance(data, list) or not data:
        return None, 'cardsJson 必须是非空数组：%s' % rel
    if not all(isinstance(item, dict) for item in data):
        bad = next(i for i, item in enumerate(data, 1) if not isinstance(item, dict))
        return None, 'cardsJson 第 %d 项不是对象' % bad
    data = [flatten_item(item) for item in data]
    # 有些老数据把 item_order 存成字符串（stratagems_36 就是 "1"/"2"…），先归一成 int
    for i, item in enumerate(data, 1):
        o = item.setdefault('item_order', i)
        if isinstance(o, str) and o.strip().isdigit():
            item['item_order'] = int(o.strip())
    orders = [item['item_order'] for item in data]
    # item_order 必须是 1..N 的排列；只是缺号就补齐，重复/非数字则报错（别悄悄改顺序）
    if sorted(orders) != list(range(1, len(data) + 1)):
        if all(isinstance(o, int) and o >= 1 for o in orders) and len(set(orders)) == len(orders):
            for i, item in enumerate(data, 1):
                item['item_order'] = i
        else:
            return None, 'cardsJson 的 item_order 不是 1..N 的排列：%s' % rel
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, safe + '.cards.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    return out, None


def build_tool(tool_dir):
    """返回 (name, zip_path)；失败返回 (None, 原因)。"""
    name = os.path.basename(tool_dir)
    manifest_path = os.path.join(tool_dir, 'manifest.json')
    if not os.path.isfile(manifest_path):
        return None, '缺少 manifest.json'
    if not os.path.isfile(os.path.join(tool_dir, 'index.html')):
        return None, '缺少 index.html（必须在工具根目录）'
    try:
        with open(manifest_path, encoding='utf-8') as f:
            manifest = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, 'manifest.json 不是合法 JSON'
    title = (manifest.get('name') or name).strip()
    safe = ''.join(c for c in name if c.isalnum() or c in '-_') or 'tool'
    os.makedirs(DIST, exist_ok=True)
    zip_path = os.path.join(DIST, safe + ('-noaudio' if NO_AUDIO else '') + '.zip')
    skipped = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(tool_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for fn in files:
                if fn == '.DS_Store':
                    continue
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, tool_dir).replace(os.sep, '/')
                if NO_AUDIO and rel.startswith(AUDIO_PREFIX):
                    skipped += 1
                    continue
                z.write(full, rel)
    return title + ('（不含音频）' if NO_AUDIO else ''), zip_path, skipped


def main():
    targets = sys.argv[1:]
    tools = [t for t in targets if os.path.isdir(os.path.join(TOOLS, t))] if targets else None
    built = 0
    for entry in sorted(os.listdir(TOOLS)):
        d = os.path.join(TOOLS, entry)
        if not os.path.isdir(d) or entry.startswith('.') or entry.startswith('_'):
            continue
        if tools and entry not in tools:
            continue
        try:
            with open(os.path.join(d, 'manifest.json'), encoding='utf-8') as f:
                manifest = json.load(f)
        except Exception:
            manifest = {}
        res = build_tool(d)
        if res[0] is None:
            print('  ✗ %-20s %s' % (entry, res[1]))
        else:
            title, zip_path, skipped = res
            extra = '（跳过 %d 个音频文件）' % skipped if skipped else ''
            print('  ✓ %-20s -> %s %s' % (title, os.path.relpath(zip_path, HERE), extra))
            built += 1
        safe = ''.join(c for c in entry if c.isalnum() or c in '-_') or 'tool'
        cards_path, cards_err = build_cards(d, safe, manifest)
        if cards_err:
            print('    ✗ 卡组数据：%s' % cards_err)
        elif cards_path:
            with open(cards_path, encoding='utf-8') as f:
                n = len(json.load(f))
            print('    ✓ 卡组数据 -> %s（%d 张）' % (os.path.relpath(cards_path, HERE), n))
    print('\n完成，打包 %d 个工具。' % built)
    return 0 if built else 1


if __name__ == '__main__':
    sys.exit(main())
