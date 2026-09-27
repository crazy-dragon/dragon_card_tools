# 示例：coca-cards（单词词卡）

`dragoncard_tools/coca-cards/` 是一个完整示例工具。

## 目录结构

```
coca-cards/
├── index.html        # 入口：左栏分页 + 主区 + 词卡容器
├── manifest.json     # name/fields/trackedActions
└── assets/
    ├── app.css       # 界面样式 + 词卡样式（翡翠/简化两套）
    └── app.js        # cardAPI 分页 + 渲染 + 交互 + 埋点
```

## 关键代码模式

### 1. 读数据（分页）

```js
cardAPI.getPage(page, 100).then(function (d) {
  var cards = d.cards || [];
  // cards[i].data.word / .phonetic_us / .paraphrase_zh / .examples
  // cards[i].id = 卡项 id
});
```

### 2. 交互 + 埋点（带 itemId）

```js
// 播放
cardAPI.playAudio(card.data.word);
cardAPI.track('audio_play', card.id);

// 标记
cardAPI.mark(card.id, isUnknown).then(function (d) {
  card.is_unknown = d.is_unknown;
  cardAPI.track('word_mark', card.id);
});
```

### 3. 数据字段（COCA 卡组）

```json
{ "word": "ability", "phonetic_us": "[əˈbɪləti]",
  "paraphrase_en": "["..."]", "paraphrase_zh": "["n. 能力"]",
  "examples": [{"en": "...", "zh": "..."}] }
```

## 打包与绑定

```bash
cd dragoncard_tools
python3 build.py coca-cards        # → dist/coca-cards.zip
```

管理页 → 卡组详情 → 小工具卡片 →「上传 zip 绑定」。
