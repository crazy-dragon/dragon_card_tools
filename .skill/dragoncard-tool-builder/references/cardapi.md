# cardAPI 桥接

本体在工具页 `<head>` 注入 `window.cardAPI`（先于工具脚本执行）。工具脚本直接使用。

## 属性

```js
window.cardAPI.deckId;   // 卡组 id（从 URL ?deck_id= 注入）
window.cardAPI.userId;   // 用户 id
```

## 方法

| 方法 | 说明 | 返回 |
|---|---|---|
| `getPage(page, pageSize)` | 分页读卡组数据（排序+进度），pageSize 默认 100 | `{cards, total, page, page_size, total_pages, has_next, has_prev}` |
| `mark(itemId, isUnknown)` | 标记卡项不熟/掌握（回写进度） | `{success, is_unknown}` |
| `favorite(itemId, fav)` | 收藏/取消收藏 | `{success, is_favorite}` |
| `track(action, itemId)` | 埋点。**卡项操作必须带 itemId**（= deck_item_id），否则服务端丢弃 | `{success}` |
| `playAudio(text)` | 播报英文（浏览器 TTS，en-US） | - |
| `finish()` | 记录工具完成事件 | `{success}` |

## 埋点要求（重要）

`track(action, itemId)` 的 `itemId` 是**卡项 id**（`getPage` 返回的 `cards[i].id`）。
服务端 `record_events_batch` 要求 `deck_item_id` 必须存在，否则事件被丢弃。

- 卡项操作（播放/标记/收藏/偷看/例句）：`cardAPI.track('audio_play', card.id)`
- 不要只发 `track('xxx')` 不带 itemId（工具级埋点当前不受支持）

## 示例

```js
cardAPI.getPage(1, 100).then(function (d) {
  var c = d.cards[0];
  render(c);                    // 用 c.data.word / c.data.paraphrase_zh ...
});
document.querySelector('#mark').onclick = function () {
  cardAPI.mark(cards[idx].id, true).then(function () {
    cardAPI.track('word_mark', cards[idx].id);
  });
};
```
