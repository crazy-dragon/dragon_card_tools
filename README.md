# dragoncard_tools

Source and packaging project for **DragonCard mini-tools**: standalone, full-screen
H5 apps that are zipped, uploaded and bound to a deck.

**Deck = data source + one tool.** The host app (`dragoncard/`) provides the data
(paging), sorting, learning progress and analytics through `window.cardAPI`; the tool
owns all rendering and interaction. Tools run in a same-origin new tab
(`/v1/tools/<id>/run`) with zero CSS/JS bleed from the main app.

This is an **independent repo** — tool sources do not live in the main `dragoncard/`
project, so the host stays clean and only pulls in the decks/tools a user actually wants.

> Chinese counterpart: [README.zh.md](README.zh.md).

## Layout

```
dragoncard_tools/
├── build.py                 # packager: walk tools/ → dist/<name>.zip (+ cards.json)
├── tools/<name>/            # tool sources (one dir per tool: index.html + manifest.json + assets/)
├── dist/                    # build output for upload/install (generated, git-ignored)
├── TOOL_PACK.md             # packaging spec (English; 中文版 TOOL_PACK.zh.md)
└── .skill/dragoncard-tool-builder/   # AI/developer guide (references: manifest, cardAPI, skins, vendor…)
```

## Quick start

```bash
cd dragoncard_tools
python3 build.py              # build every tool → dist/
python3 build.py coca-cards   # build one tool
python3 build.py --lang zh    # console language (en default; DC_LANG/LANG also honored)
DC_NO_AUDIO=1 python3 build.py english-phonetics   # public build without third-party audio
```

Then bind it: management page → deck detail → mini-tool card → "Upload zip & bind".
See [TOOL_PACK.md](TOOL_PACK.md) for the full flow.

## Key conventions

- **manifest.json** — `name` / `description` / `lang` / `icon` / `fields` / `trackedActions`
  (≤5). Optional build field: `cardsJson`. See `.skill/.../references/manifest.md`.
- **Analytics** — item actions must call `cardAPI.track(action, itemId)`; without
  `itemId` the server drops the event.
- **Purity** — a tool is pure H5: unzip and run. `build.py` excludes scripts, caches
  and OS junk from the zip.
- **i18n** — console output is English by default; Chinese is available.

## Docs

| Doc | What |
|---|---|
| [TOOL_PACK.md](TOOL_PACK.md) (English) · [TOOL_PACK.zh.md](TOOL_PACK.zh.md) (中文) | Packaging spec: manifest, `window.cardAPI`, storage, vendor libs |
| [.skill/dragoncard-tool-builder/SKILL.md](.skill/dragoncard-tool-builder/SKILL.md) | Step-by-step build guide for AI/developers |

## Notes

- Third-party phoneme recordings are **not** committed (CC BY-NC-ND 4.0): they live
  only inside local zips, never in this repo. See `.gitignore`.
- `dist/`, `_preview/`, `_reports/` are generated or working material and are ignored.
