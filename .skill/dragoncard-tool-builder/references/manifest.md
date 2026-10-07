# manifest.json 规范

工具 zip 根目录必须含 `manifest.json`。

```json
{
  "name": "COCA20000 词卡",
  "description": "复刻 coca20000 学习界面…",
  "lang": "zh",
  "icon": "assets/icon.png",
  "fields": ["word", "phonetic_us", "paraphrase_en", "paraphrase_zh", "examples"],
  "trackedActions": ["audio_play", "definition_view", "word_mark", "favorite_toggle", "example_view"]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 工具名（管理页卡片标题、首页卡组工具名） |
| `description` | | 描述（管理页作为"卡组简介"展示，最多 3 行） |
| `lang` | | 界面语言（zh/en），默认 zh |
| `icon` | | 图标（zip 内相对路径，如 `assets/icon.png`）；无则管理页默认龙 `fa-dragon` |
| `fields` | | **工具期望的数据字段**——管理页/打开时校验卡组数据是否匹配（缺失会提示） |
| `trackedActions` | | 你会用 `track()` 记录的动作名，**≤5 个** |

### 构建期字段（宿主忽略，`build.py` 读）

| 字段 | 说明 |
|---|---|
| `cardsJson` | 卡组数据源（相对 `dragoncard_tools/` 的路径）⇒ 打包时产出 `dist/<name>.cards.json`，即用户导入的那份 |
| `freeDeck` | `true` ⇒ 打包后把 `tool.zip` + `cards.json` 同步进 `free_decks/<name>/`（**免费卡组的交付包**） |

> **免费卡组只住 `dragoncard_tools/free_decks/<name>/`，不进主工程 `dragoncard/default_cards/`** ——
> 主工程是主程序，往里加卡组意味着每个卡组都要改动它，而多数用户并不需要这些卡组。
> 交付包五件套：`tool.zip` + `cards.json`（build 同步，内容没变就不碰时间戳）+ `meta.json` /
> `readme.txt` / `LICENSE`（人工撰写，**build 永不覆盖**，缺了只告警）。`DC_NO_AUDIO=1` 的降级包不同步。
> 完整约定见 `TOOL_PACK.md` 的「免费卡组交付包」节。

## 要点

- `fields` 必须与卡组数据实际字段对齐（如 COCA 卡组有 `word/phonetic_us/paraphrase_zh` 等）
- `trackedActions` 超 5 个会被拒绝
- `icon` 相对路径会拼成 `/v1/tools/<id>/assets/<icon>` 展示
- 构建期字段会随 manifest 一起进交付 zip，**无害**：宿主只做 `manifest.get(...)` 取值，没有严格 schema
