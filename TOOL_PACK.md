# DragonCard Mini-Tools (zip template) Packaging Spec

> Chinese counterpart: [TOOL_PACK.zh.md](TOOL_PACK.zh.md). This English version is primary.

A mini-tool (Tool) is a **standalone, full-screen H5 app** uploaded and bound to a
deck as a `.zip` package. **Deck = data source + one tool**: the host provides the
data (paging), sorting, progress and analytics, while the tool owns all rendering
and interaction. The tool runs in a **same-origin new tab**
(`/v1/tools/<id>/run?deck_id=&user_id=`) with zero CSS/JS bleed from the main app.

Tool sources live in the separate project **`dragoncard_tools/`** (see the end),
and are packaged before upload/binding.

## Directory structure

```
tool.zip
├── index.html        # required — full-screen entry point, must be at the zip root
├── manifest.json     # required — metadata (name/description/expected fields/analytics)
└── assets/           # your own js/css/images/fonts (referenced by relative path)
```

Packaging zips the **contents** of the directory itself, so that `index.html` sits at
the zip root (`build.py` already handles this).

## Storage

After upload, the host **extracts the zip to the filesystem at `minitools/<tool_id>/`**
(`index.html` + `manifest.json` + `assets/`), and the `t_tool` table stores only
metadata (`name/description/icon/lang/dir_path/manifest_json/tracked_actions`).
Once extracted you may add asset files directly under `minitools/<id>/` (the proxy
serves them).

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

| Field | Description |
|---|---|
| `name` | Tool name (required) |
| `description` | Description (shown as the "deck intro" on the management page, max 3 lines) |
| `lang` | UI language (zh/en) |
| `icon` | Icon (relative path inside the zip, e.g. `assets/icon.png`). **Optional**: on upload/re-upload the host auto-detects `assets/icon.png` / `.svg` / `.jpg` / `.webp` (any one) as the deck icon — replace the file and re-upload to update it; if none exists the default dragon `fa-dragon` is used |
| `fields` | **Data fields the tool expects** — used for field-match validation (missing fields in the deck data raise a warning) |
| `trackedActions` | Action names you will record via `cardAPI.track()` (**≤5**) |

## Host bridge: window.cardAPI

When `/v1/tools/<id>/run` returns `index.html`, it injects `window.cardAPI` into
`<head>` (ready before the tool scripts). The current deck is available from the URL
query parameters:

```js
window.cardAPI.deckId;   // deck id
window.cardAPI.userId;   // user id
```

| Method | Description |
|---|---|
| `getPage(page, pageSize)` | Read deck data with paging (sorted + progress), returns `{cards, total, page, ...}`; `cards[i].data` holds the raw fields, `cards[i].id` is the deck-item id |
| `mark(itemId, isUnknown)` | Mark a deck item as unknown/mastered (writes back learning progress) |
| `favorite(itemId, fav)` | Favorite / unfavorite |
| `track(action, itemId)` | Analytics. **Item actions must pass `itemId`** (= `deck_item_id`), otherwise the server drops it |
| `playAudio(text)` | Speak English text (browser TTS) |
| `finish()` | Record one tool-completion event |

Example (note the item id on `track`):

```js
cardAPI.getPage(1).then(function (d) {
  var c = d.cards[0];
  document.querySelector('#word').textContent = c.data.word;
});
document.querySelector('#mark').onclick = function () {
  cardAPI.mark(cards[idx].id, true);
  cardAPI.track('word_mark', cards[idx].id);   // track must pass itemId
};
```

## Data API (provided by the host, same behavior as the card template)

- Paged data: `/v1/learn/page?user_id=&deck_id=&page=&page_size=` (via `cardAPI.getPage`)
- Mark/favorite/analytics all go through the host engine; **learning progress and
  observability stats are fully reused**

## Bundled base libraries (reference directly, no packaging needed)

| Library | Reference |
|---|---|
| Three.js | `<script src="/static/vendor/three/three.module.js"></script>` (ESM dynamic `import('three')` and `import('three/addons/...')` also work) |
| Font Awesome | `<link rel="stylesheet" href="/static/vendor/fontawesome/css/all.min.css">` |
| Tailwind | `<script src="/static/vendor/tailwind/tailwind.browser.min.js"></script>` |
| ECharts | `<script src="/static/vendor/echarts/echarts.min.js"></script>` |

> Bundle any other library **inside your zip** (referenced by a relative path under
> `assets/`). Do not reference external CDNs — tools run offline and external
> resources will not load.

## Environment constraints

- Scripts: may be inline `<script>` or external `<script src="./assets/app.js">`;
  collaborate via the `window` namespace
- Do not use `import`/`export` (avoids module-loading issues); ES2017+ is fine
- All resources use relative paths (inside the zip) or `/static/vendor/...` (host-provided)
- The tool and the main app are same-origin but **fully separate documents**: the
  tool cannot see the main app's DOM, and main-app styles never leak into the tool

## Install & use

Tools are bound on the **management page** (there is no standalone install page):
1. Deck detail → management dialog → mini-tool card
2. Not bound → click "Upload zip & bind" to upload the packaged tool zip (creates the tool + binds it to that deck)
3. Already bound → **Re-upload** (replace, preserving the tool id and binding), **Download** (export the zip), **Unbind**
4. Enter the deck → the bound tool opens directly (new tab)

## Development project: dragoncard_tools

Tool sources live in the separate project `/Users/alfred/CodeBase/Python/dragoncard_tools/`:

```
dragoncard_tools/
├── build.py                 # packager: walk each tool dir under tools/ → dist/<name>.zip
├── tools/                   # tool sources (one directory per tool)
│   ├── coca-cards/          # example tool (word cards)
│   │   ├── index.html
│   │   ├── manifest.json
│   │   └── assets/{app.css, app.js}
│   ├── ipa-cards/ phonics-cards/ voyage-log/   # other tools
│   └── ...
├── dist/                    # build output (for upload/install)
```

```bash
cd dragoncard_tools
python3 build.py            # build everything → dist/
python3 build.py coca-cards # build only the named tool
python3 build.py --lang zh  # console language: en (default) | zh
```

Development guide: `.skill/dragoncard-tool-builder/` (AI/developer guide).

