# 预置基础库（直接引用，无需打包）

以下库由 DragonCard 本体本地提供，工具页里直接引用（同源、离线可用）：

| 库 | 引用 |
|---|---|
| Three.js | `import('/static/vendor/three/three.module.js')` —— **必须写绝对路径**，见下方「three.js」 |
| Font Awesome | `<link rel="stylesheet" href="/static/vendor/fontawesome/css/all.min.css">` |
| Tailwind | `<script src="/static/vendor/tailwind/tailwind.browser.min.js"></script>` |
| ECharts | `<script src="/static/vendor/echarts/echarts.min.js"></script>` |

工具是独立页面（宿主只往 `</head>` 注入 cardAPI），所以**这些库不会污染宿主**——比写进模板安全。

## Tailwind（v4 browser 构建，2026-09 实测）

- **不要自己写 `<style type="text/tailwindcss">` 块。** 实测：在块里写
  `@import "tailwindcss"` 或 `@import "tailwindcss/theme" layer(theme)` 都**不会**被内联，
  浏览器会去取 `/tailwindcss`、`/tailwindcss/theme`、`/tailwindcss/utilities` ⇒ 一串 404。
  **什么都不写**（只引那个 script）时，构建会自己内联默认 `@import "tailwindcss"`：零网络请求。
- 内联进来的 preflight 落在 `@layer base`。CSS 级联里**层级成员资格先于特异性判断**，所以
  未分层的自有样式永远赢过分层的 utilities。工具自己的 reset 必须也包进 `@layer base`
  （先声明 `@layer theme, base, components, utilities;`），否则 `* { padding: 0; margin: 0 }`
  会把 Tailwind 的 padding/margin/border 工具类**全部反杀**（卡片会塌成一条）。
- 任意值可用：`p-[7px]`、`bg-[#123456]`、`bg-[image:linear-gradient(160deg,#0c1230_0%,#101a3e_100%)]`。
- **不要写 `[data-tooltip]::after` 气泡**：外壳已用 `#global-tooltip` 统一处理 `[data-tooltip]`。

## three.js

- 宿主只在 SPA 里注入 import map，**工具页没有** ⇒ `import('three')` / `import('three/addons/...')`
  一定失败。用绝对路径动态导入（classic script 里合法）：
  `import('/static/vendor/three/three.module.js')`。
- **WebGL 上下文上限 ~16（Chrome）**：100 张卡不能各建一个 renderer。
  正确做法：**全局一个 renderer + 一块 canvas**，由"最可见的卡位"认领
  （IntersectionObserver 取 ratio 最高且 ≥ 0.55 的槽位，把 canvas `appendChild` 搬过去），
  其余卡位退回 CSS 兜底方案；`MutationObserver` 在 DOM 重建后重扫，`visibilitychange` 暂停 rAF。
  探针必须断言 `contexts <= 1`。

## 其它库

- 自己打进 zip（`assets/` 相对路径引用）
- **不要引用外部 CDN**——工具离线运行，外部资源加载不到（也别引 Google Fonts）

## 环境约束

- 脚本：可内联 `<script>`，可外置 `<script src="./assets/app.js">`；`window` 命名空间协作
- 不要 `import`/`export`（避免 module 相对导入问题，three.js 那一条用**动态** import 例外）；可用 ES2017+
- 资源全用相对路径（zip 内）或 `/static/vendor/...`
- **不要加载 `/static/styles.css`**（宿主的页面样式）。它里面有 `.sc-card` 之类的类名，
  和原模板的卡根类**撞名**，一旦引入就会把卡片改成白底竖排。

## 什么时候不能用宿主页面做验收

宿主的 `static/styles.css` 里有 `.sc-card`（**统计卡**：白底 + `flex-direction: column` + `padding:16px`，
且未分层）。模板 t43「太空站词卡」的卡根类名也是 `sc-card`，于是那条规则稳赢 Tailwind 工具类 ⇒
**原版太空站在宿主页里是坏的**（白底、竖排）。
要对照"原版本来长什么样"，得在只加载 vendor + 模板 cardCss 的干净页里渲染
（参考：`dragoncard_tools/_preview/gen_ab_orig.py` → `shot_ab_clean.js`）。
工具页不加载 styles.css，所以工具端不受影响。
