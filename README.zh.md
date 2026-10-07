# dragoncard_tools

**DragonCard 小工具**的源码 + 打包工程：小工具是全屏运行的独立 H5 应用，打包成
`.zip` 上传绑定到卡组。

**卡组 = 数据源 + 一个工具。** 宿主（`dragoncard/`）通过 `window.cardAPI` 提供数据
（分页）、排序、学习进度与埋点；工具负责全部展示与交互。工具运行在**同源新标签页**
（`/v1/tools/<id>/run`），与主应用零 CSS/JS 污染。

本工程是**独立仓库** —— 工具源码不放主工程 `dragoncard/`，主程序因此保持干净，
只引入用户真正需要的卡组/工具。

> 英文对照版见 [README.md](README.md)（以英文为主）。

## 目录结构

```
dragoncard_tools/
├── build.py                 # 打包器：遍历 tools/ → dist/<name>.zip（并产出 cards.json）
├── tools/<name>/            # 工具源码（每工具一目录：index.html + manifest.json + assets/）
├── dist/                    # 打包产物（上传安装用，可再生、已忽略）
├── TOOL_PACK.zh.md          # 打包规范（中文；英文主版 TOOL_PACK.md）
└── .skill/dragoncard-tool-builder/   # AI/开发者指南（references：manifest、cardAPI、skins、vendor…）
```

## 快速开始

```bash
cd dragoncard_tools
python3 build.py              # 打包全部 → dist/
python3 build.py coca-cards   # 只打包指定工具
python3 build.py --lang zh    # 控制台语言（默认 en；也认 DC_LANG/LANG）
DC_NO_AUDIO=1 python3 build.py english-phonetics   # 不带第三方音频的公开版
```

绑定：管理页 → 卡组详情 → 小工具卡片 → 「上传 zip 绑定」。完整流程见
[TOOL_PACK.zh.md](TOOL_PACK.zh.md)。

## 关键约定

- **manifest.json** —— `name` / `description` / `lang` / `icon` / `fields` / `trackedActions`
  （≤5）。可选构建字段：`cardsJson`。详见 `.skill/.../references/manifest.md`。
- **埋点** —— 卡项操作必须 `cardAPI.track(action, itemId)`；缺 `itemId` 服务端会丢弃。
- **纯净** —— 工具是纯 H5：解压即用。`build.py` 会把脚本、缓存、系统垃圾挡在包外。
- **i18n** —— 控制台输出默认英文，可切中文。

## 文档

| 文档 | 内容 |
|---|---|
| [TOOL_PACK.zh.md](TOOL_PACK.zh.md)（中文）· [TOOL_PACK.md](TOOL_PACK.md)（English 主版） | 打包规范：manifest、`window.cardAPI`、存储、预置库 |
| [.skill/dragoncard-tool-builder/SKILL.md](.skill/dragoncard-tool-builder/SKILL.md) | 分步开发指南（AI/开发者） |

## 说明

- 第三方音素录音**不入库**（CC BY-NC-ND 4.0）：只存在于本地 zip，从不进本仓库。见 `.gitignore`。
- `dist/`、`_preview/`、`_reports/` 为可再生/临时工作材料，已忽略。
