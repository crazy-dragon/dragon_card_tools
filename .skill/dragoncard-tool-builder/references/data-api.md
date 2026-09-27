# 数据接口（本体提供）

工具通过 `cardAPI` 调用，底层是以下 API。

## /v1/learn/page（分页数据）

```
GET /v1/learn/page?user_id=&deck_id=&page=&page_size=
```

返回：

```json
{
  "cards": [
    {
      "id": 123,                 // 卡项 id（埋点/mark/favorite 用）
      "data": { "word": "ability", "phonetic_us": "[əˈbɪləti]", "paraphrase_zh": "["n. 能力"]", "examples": [...] },
      "is_unknown": 1,
      "is_favorite": 0,
      "current_order": 1
    }
  ],
  "total": 20200,
  "page": 1,
  "page_size": 100,
  "total_pages": 202
}
```

- 服务端按 `current_order` 排序；自动确保每卡有 Progress
- `data` 是卡组的原始字段（与 `manifest.fields` 对应）

## /v1/learn/mark（标记）

```
POST /v1/learn/mark  { deck_item_id, user_id, deck_id, is_unknown }
```
`is_unknown: 1` 不熟 / `0` 掌握。经 `cardAPI.mark(itemId, isUnknown)`。

## /v1/learn/favorite（收藏）

```
POST /v1/learn/favorite  { deck_item_id, user_id, deck_id, is_favorite }
```
经 `cardAPI.favorite(itemId, fav)`。

## /v1/observability/events（埋点）

```
POST /v1/observability/events  { events: [{ user_id, deck_id, deck_item_id, action }] }
```
**`deck_item_id` 必须存在**，否则该事件被丢弃。经 `cardAPI.track(action, itemId)`。
观测页 `/v1/observability/actions`、`/v1/observability/data` 展示。
