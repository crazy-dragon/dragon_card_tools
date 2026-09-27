---
name: dragoncard-tool-builder
description: >-
  DragonCard 小工具构建指南：开发全屏独立 H5 小工具（zip 模板），打包并上传绑定到卡组。
  新建或改写小工具、写 manifest、用 cardAPI 桥接、打包 zip、管理页绑定时使用。
metadata:
  version: "1.0.0"
---

# DragonCard 小工具构建指南

**小工具（Tool）是全屏运行的独立 H5 应用**：`index.html` 为入口，打包成 `.zip` 上传绑定到卡组。
本体提供数据（分页/排序/进度/埋点）通过 `window.cardAPI` 桥接；工具负责全部展示与交互。
**卡组 = 数据源 + 一个工具**。运行在同源新标签页（`/v1/tools/<id>/run`），零 CSS/JS 污染。

## 何时使用

- 从零新建一个小工具（如词卡、拼写游戏、闪卡）
- 把已有纯 H5 页面改写成 DragonCard 小工具
- 打包、上传绑定、排查 cardAPI/埋点问题

## 工作流程

每一步动手前先读对应 reference：

1. **建工具目录** — 在 `dragoncard_tools/` 下建 `<tool-name>/`（含 `index.html` + `manifest.json` + `assets/`）
2. **写 manifest** — 读 [manifest.md](references/manifest.md)：`name`/`description`/`lang`/`icon`/`fields`/`trackedActions`
3. **实现页面 + cardAPI** — 读 [cardapi.md](references/cardapi.md) 与 [data-api.md](references/data-api.md)：
   - `index.html` 用 `window.cardAPI` 读数据、交互、回写进度、埋点
   - **埋点必须带 itemId**（`track(action, itemId)`，否则服务端丢弃）
4. **引用预置库** — 读 [vendor.md](references/vendor.md)：three/fontawesome/tailwind/echarts 直接 `/static/vendor/...`
5. **多皮肤 / 一 zip 多卡组**（需要时）— 读 [skins.md](references/skins.md)：交互归外壳、视觉归皮肤；皮肤只 `render` 不绑事件
6. **打包** — `cd dragoncard_tools && python3 build.py <tool-name>` → `dist/<name>.zip`
7. **上传绑定** — 管理页 → 卡组详情 → 小工具卡片「上传 zip 绑定」；已绑定可重新上传/下载/解绑

## Reference

| 文档 | 何时读 |
| --- | --- |
| [manifest.md](references/manifest.md) | 写 manifest.json 时：字段、示例、trackedActions ≤5 |
| [cardapi.md](references/cardapi.md) | 实现交互时：`window.cardAPI` 全方法、埋点要求 |
| [data-api.md](references/data-api.md) | 读数据时：`/v1/learn/page` 返回格式、mark/favorite/observability |
| [vendor.md](references/vendor.md) | 引用预置库时：three/fontawesome/tailwind/echarts 路径 |
| [skins.md](references/skins.md) | 做多皮肤或一 zip 多卡组时：皮肤插件契约、加载顺序、按钮类名统一、验证矩阵 |
| [example.md](references/example.md) | 参考 coca-cards 示例：目录结构 + 关键代码模式 |

> 完整打包规范见 `TOOL_PACK.md`（dragoncard_tools 根）。
