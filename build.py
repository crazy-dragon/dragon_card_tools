#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DragonCard mini-tool packager.

Scans each tool dir under tools/ that contains a manifest.json and packs it into
dist/<name>.zip. It zips the *contents* of the directory (walks into it first) so
index.html ends up at the zip root.

Non-deliverable files are excluded automatically (build scripts / OS junk / caches)
to keep the package clean:
  · extensions `.py .pyc .pyo .sh .map`
  · files and dirs whose name starts with `.` or `_`, plus dirs
    `__pycache__ / node_modules / .git …`
  ⇒ a tool is pure H5: unzip and run; a zip should never contain anything you must
    "run first". Excluded files are printed (`· excluded N non-deliverable file(s): …`),
    never dropped silently.

Usage:
  python3 build.py            # build every tool
  python3 build.py coca-cards # build only the named tool
  python3 build.py --lang zh  # console output language: en (default) | zh
                              # also honored: DC_LANG / LC_ALL / LANG

Build without audio (to ship a public ipa/phonics tool that must not carry the
third-party recordings):
  DC_NO_AUDIO=1 python3 build.py english-phonetics
    → skips assets/phonemes/**, output is dist/<name>-noaudio.zip
  When audio is missing the tool degrades to "read the first example word + hint"
  instead of failing silently (verified).

Cards-data sidecar:
  add an optional "cardsJson": "../memory_market_goods/xxx/cards.json" to
  manifest.json (relative to this directory) and the build also emits
  dist/<name>.cards.json — the file users import as the deck.
  **Data lineage depends on it**: the value must point at the original data in the
  source tree; never hand-edit the content here or it forks from the template/source.
  Four sanity checks / normalizations:
    · array is non-empty, every item is an object
    · nested {item_order, data:{…}} is flattened to {item_order, …} (the importer
      already unwraps data; flattening just makes every sidecar the same shape;
      already-flat items are left untouched)
    · item_order is a permutation of 1..N (only gaps are filled; duplicates or
      non-numbers are an error — never silently reorder)
    · written as utf-8 + indent=1 with a trailing newline
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

# ---------- i18n ----------
# Console messages. English is primary/default; Chinese is the counterpart.
# Select with --lang/-L en|zh, else DC_LANG, else LANG/LC_ALL, else en.
# Only human-facing output is translated; manifest/tool names are data and stay as-is.
MSG = {
    'en': {
        'zip_ok': '  \u2713 %-20s -> %s %s',
        'zip_err': '  \u2717 %-20s %s',
        'skipped_audio': ' (skipped %d audio file(s))',
        'excluded_junk': '    \u00b7 excluded %d non-deliverable file(s): %s',
        'cards_err': '    \u2717 cards data: %s',
        'cards_ok': '    \u2713 cards data -> %s (%d item(s))',
        'done': '\nDone, packaged %d tool(s).',
        'noaudio_suffix': ' (no audio)',
        'err_no_manifest': 'missing manifest.json',
        'err_no_index': 'missing index.html (must be at the tool root)',
        'err_bad_manifest': 'manifest.json is not valid JSON',
        'err_cards_missing': 'cardsJson target not found: %s',
        'err_cards_badjson': 'cardsJson is not valid JSON: %s',
        'err_cards_empty': 'cardsJson must be a non-empty array: %s',
        'err_cards_notobj': 'cardsJson item %d is not an object',
        'err_cards_order': 'cardsJson item_order is not a permutation of 1..N: %s',
    },
    'zh': {
        'zip_ok': '  \u2713 %-20s -> %s %s',
        'zip_err': '  \u2717 %-20s %s',
        'skipped_audio': '（跳过 %d 个音频文件）',
        'excluded_junk': '    \u00b7 已排除 %d 个非交付文件：%s',
        'cards_err': '    \u2717 卡组数据：%s',
        'cards_ok': '    \u2713 卡组数据 -> %s（%d 张）',
        'done': '\n完成，打包 %d 个工具。',
        'noaudio_suffix': '（不含音频）',
        'err_no_manifest': '缺少 manifest.json',
        'err_no_index': '缺少 index.html（必须在工具根目录）',
        'err_bad_manifest': 'manifest.json 不是合法 JSON',
        'err_cards_missing': 'cardsJson 指向的文件不存在：%s',
        'err_cards_badjson': 'cardsJson 不是合法 JSON：%s',
        'err_cards_empty': 'cardsJson 必须是非空数组：%s',
        'err_cards_notobj': 'cardsJson 第 %d 项不是对象',
        'err_cards_order': 'cardsJson 的 item_order 不是 1..N 的排列：%s',
    },
}

_lang = 'en'


def t(key):
    """Look up a console message in the active language (English fallback)."""
    return MSG.get(_lang, MSG['en']).get(key, MSG['en'].get(key, key))


def parse_lang(argv):
    """Split argv into (lang, remaining_args); language from --lang/-L > DC_LANG >
    LANG/LC_ALL > 'en'. `zh_CN.UTF-8` → 'zh', `en_US` → 'en'; unknown → 'en'."""
    lang, rest, i = None, [], 0
    while i < len(argv):
        a = argv[i]
        if a in ('--lang', '-L') and i + 1 < len(argv):
            lang, i = argv[i + 1], i + 2
            continue
        if a.startswith('--lang='):
            lang, i = a.split('=', 1)[1], i + 1
            continue
        rest.append(a)
        i += 1
    if not lang:
        lang = (os.environ.get('DC_LANG') or os.environ.get('LC_ALL')
                or os.environ.get('LANG') or '')
    code = lang.split('.')[0].split('_')[0].lower()
    return (code if code in MSG else 'en'), rest


# ---------- 交付包卫生 ----------
# 工具是**纯 H5**：用户拿到 zip 解压即用，不需要跑任何脚本。
# 构建脚本（build_data.py 之类）、系统垃圾（.DS_Store）、编辑器目录都不该进包 ——
# 它们既增加体积，又让人以为"还要先执行点什么"。
SKIP_DIRS = {'__pycache__', 'node_modules', '.git', '.vscode', '.idea', '.pytest_cache'}
SKIP_EXT = {'.py', '.pyc', '.pyo', '.sh', '.map'}
SKIP_NAMES = {'Thumbs.db', 'desktop.ini'}


def should_skip(rel, name):
    """rel 是以 / 分隔的相对路径。True = 不打包。
    约定：`.` 或 `_` 开头的文件/目录一律视为"非交付"（预览脚本、源素材、缓存）。"""
    if name.startswith('.') or name in SKIP_NAMES:
        return True
    if os.path.splitext(name)[1].lower() in SKIP_EXT:
        return True
    return any(p.startswith('_') or p in SKIP_DIRS for p in rel.split('/')[:-1])


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
        return None, t('err_cards_missing') % rel
    try:
        with open(src, encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, t('err_cards_badjson') % rel
    if not isinstance(data, list) or not data:
        return None, t('err_cards_empty') % rel
    if not all(isinstance(item, dict) for item in data):
        bad = next(i for i, item in enumerate(data, 1) if not isinstance(item, dict))
        return None, t('err_cards_notobj') % bad
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
            return None, t('err_cards_order') % rel
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
        return None, t('err_no_manifest')
    if not os.path.isfile(os.path.join(tool_dir, 'index.html')):
        return None, t('err_no_index')
    try:
        with open(manifest_path, encoding='utf-8') as f:
            manifest = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, t('err_bad_manifest')
    title = (manifest.get('name') or name).strip()
    safe = ''.join(c for c in name if c.isalnum() or c in '-_') or 'tool'
    os.makedirs(DIST, exist_ok=True)
    zip_path = os.path.join(DIST, safe + ('-noaudio' if NO_AUDIO else '') + '.zip')
    skipped = 0          # NO_AUDIO 下跳过多少音频
    junk = []            # 被"卫生规则"挡在包外的文件（构建脚本 / .DS_Store / 缓存）
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(tool_dir):
            dirs[:] = [d for d in dirs
                       if not d.startswith(('.', '_')) and d not in SKIP_DIRS]
            for fn in files:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, tool_dir).replace(os.sep, '/')
                if should_skip(rel, fn):
                    junk.append(rel)
                    continue
                if NO_AUDIO and rel.startswith(AUDIO_PREFIX):
                    skipped += 1
                    continue
                z.write(full, rel)
    return title + (t('noaudio_suffix') if NO_AUDIO else ''), zip_path, skipped, sorted(junk)


def main():
    global _lang
    _lang, targets = parse_lang(sys.argv[1:])
    tools = [x for x in targets if os.path.isdir(os.path.join(TOOLS, x))] if targets else None
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
            print(t('zip_err') % (entry, res[1]))
        else:
            title, zip_path, skipped, junk = res
            extra = t('skipped_audio') % skipped if skipped else ''
            print(t('zip_ok') % (title, os.path.relpath(zip_path, HERE), extra))
            if junk:
                print(t('excluded_junk') % (len(junk), ', '.join(junk[:5])
                                            + ('…' if len(junk) > 5 else '')))
            built += 1
        safe = ''.join(c for c in entry if c.isalnum() or c in '-_') or 'tool'
        cards_path, cards_err = build_cards(d, safe, manifest)
        if cards_err:
            print(t('cards_err') % cards_err)
            cards_path = None
        elif cards_path:
            with open(cards_path, encoding='utf-8') as f:
                n = len(json.load(f))
            print(t('cards_ok') % (os.path.relpath(cards_path, HERE), n))
    print(t('done') % built)
    return 0 if built else 1


if __name__ == '__main__':
    sys.exit(main())
