# DragonCard 小工具（zip 模板）打包规范

小工具（Tool）是一种**全屏运行的独立 H5 应用**，以 `.zip` 包形式上传绑定到卡组。
**卡组 = 数据源 + 一个工具**：本体提供数据（分页）、排序、进度、埋点，工具负责全部展示与交互。
工具运行在**同源新标签页**（`/v1/tools/<id>/run?deck_id=&user_id=`），与主应用零 CSS/JS 污染。

工具源码开发在独立工程 **`dragoncard_tools/`**（见文末），打包后上传绑定。

## 目录结构

```
tool.zip
├── index.html        # 必需 — 全屏应用入口，必须在 zip 根目录
├── manifest.json     # 必需 — 元数据（名称/描述/期望字段/埋点）
└── assets/           # 你自己的 js/css/图片/字体（相对路径引用）
```

打包时压缩**目录内容**本身，确保 `index.html` 在 zip 根目录（`build.py` 已处理）。

## 存储

上传后，本体把 zip **解压到文件系统 `minitools/<tool_id>/`**（`index.html` + `manifest.json` + `assets/`），
数据库 `t_tool` 只存元数据（`name/description/icon/lang/dir_path/manifest_json/tracked_actions`）。
解压后可直接往 `minitools/<id>/` 添加资源文件（代理会服务它们）。

## manifest.json

```json
{
  "name": "COCA20000 词卡",
  "description": "复刻 coca20000 学习界面：目录分页、词卡列表/单卡、播放/偷看/标记/收藏、翡翠/简化样式切换",
  "lang": "zh",
  "icon": "assets/icon.png",
  "fields": ["word", "phonetic_us", "paraphrase_en", "paraphrase_zh", "examples"],
  "trackedActions": ["audio_play", "definition_view", "word_mark", "favorite_toggle", "example_view"]
}
```

| 字段 | 说明 |
|---|---|
| `name` | 工具名（必填） |
| `description` | 描述（管理页作为"卡组简介"展示，最多 3 行） |
| `lang` | 界面语言（zh/en） |
| `icon` | 图标（zip 内相对路径，如 `assets/icon.png`；无则管理页用默认龙 `fa-dragon`） |
| `fields` | **工具期望的数据字段**——用于字段匹配校验（卡组数据缺字段会提示） |
| `trackedActions` | 你会用 `cardAPI.track()` 记录的动作名（**≤5 个**） |

## 本体桥接：window.cardAPI

`/v1/tools/<id>/run` 返回 `index.html` 时在 `<head>` 注入 `window.cardAPI`（先于工具脚本就绪）。从 URL 查询参数可获得当前卡组：

```js
window.cardAPI.deckId;   // 卡组 id
window.cardAPI.userId;   // 用户 id
```

| 方法 | 说明 |
|---|---|
| `getPage(page, pageSize)` | 分页读取卡组数据（排序+进度），返回 `{cards, total, page, ...}`；`cards[i].data` 为原始字段，`cards[i].id` 为卡项 id |
| `mark(itemId, isUnknown)` | 标记卡项不熟/掌握（回写学习进度） |
| `favorite(itemId, fav)` | 收藏/取消收藏 |
| `track(action, itemId)` | 埋点。**卡项操作必须带 `itemId`**（= `deck_item_id`），否则服务端丢弃 |
| `playAudio(text)` | 播报英文（浏览器 TTS） |
| `finish()` | 记录一次工具完成事件 |

示例（注意埋点带卡项 id）：

```js
cardAPI.getPage(1).then(function (d) {
  var c = d.cards[0];
  document.querySelector('#word').textContent = c.data.word;
});
document.querySelector('#mark').onclick = function () {
  cardAPI.mark(cards[idx].id, true);
  cardAPI.track('word_mark', cards[idx].id);   // 埋点必须带 itemId
};
```

## 数据接口（本体提供，功能与卡片模板一致）

- 分页数据：`/v1/learn/page?user_id=&deck_id=&page=&page_size=`（经 `cardAPI.getPage`）
- 标记/收藏/埋点均走本体引擎，**学习进度与观测统计完全复用**

## 预置基础库（直接引用，无需打包）

| 库 | 引用 |
|---|---|
| Three.js | `<script src="/static/vendor/three/three.module.js"></script>`（ESM 动态 `import('three')`、`import('three/addons/...')` 也可） |
| Font Awesome | `<link rel="stylesheet" href="/static/vendor/fontawesome/css/all.min.css">` |
| Tailwind | `<script src="/static/vendor/tailwind/tailwind.browser.min.js"></script>` |
| ECharts | `<script src="/static/vendor/echarts/echarts.min.js"></script>` |

> 其它库请**自行打进 zip**（`assets/` 相对路径引用）。不要引用外部 CDN——工具离线运行，外部资源加载不到。

## 环境约束

- 脚本：可内联 `<script>`，也可外置 `<script src="./assets/app.js">`；`window` 命名空间协作
- 不要 `import`/`export`（避免 module 加载问题）；可用 ES2017+
- 资源全用相对路径（zip 内）或 `/static/vendor/...`（本体预置）
- 工具与主应用同源但**完全独立文档**：看不到主应用 DOM，主应用样式不会进入工具

## 安装与使用

工具在**管理页**绑定（没有独立安装页）：
1. 卡组详情 → 管理弹窗 → 小工具卡片
2. 未绑定 → 点「上传 zip 绑定」上传打包好的工具 zip（创建工具 + 绑定到该卡组）
3. 已绑定 → 可**重新上传**（替换，保留工具 id 与绑定）、**下载**（导出 zip）、**解绑**
4. 进入卡组 → 直接打开绑定工具（新标签页）

## 开发工程：dragoncard_tools

工具源码在独立工程 `/Users/alfred/CodeBase/Python/dragoncard_tools/`：

```
dragoncard_tools/
├── build.py                 # 打包脚本：遍历 tools/ 下各工具目录 → dist/<name>.zip
├── tools/                   # 工具源码（每个工具一个目录）
│   ├── coca-cards/          # 示例工具（单词词卡）
│   │   ├── index.html
│   │   ├── manifest.json
│   │   └── assets/{app.css, app.js}
│   ├── ipa-cards/ phonics-cards/ voyage-log/   # 其它工具
│   └── ...
└── dist/                    # 打包产物（上传安装用）
```

```bash
cd dragoncard_tools
python3 build.py            # 打包全部 → dist/
python3 build.py coca-cards # 只打包指定工具
```

开发规范见 `.skill/dragoncard-tool-builder/`（AI/开发者指南）。
