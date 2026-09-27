# 多皮肤 / 一 zip 多卡组（皮肤插件架构）

**何时用**：需要 ① 同一份代码适配**多个卡组**（各自独立数据），或 ② 同一卡组提供**多套视觉**（用户可切换）。
已在 `voyage-log`（素白/星夜）与 `exam-vocab`（通用/手帐/太空，一 zip 通吃 25–28 四个考试词表）两处验证。

核心思想：**交互归外壳，视觉归皮肤**。外壳（`app.js`）独占全部事件与状态；皮肤只做「把一张卡渲染成 HTML」。

## 目录约定

```
<tool>/
  index.html
  manifest.json
  assets/
    app.css          # 外壳样式（布局、页签、目录、弹窗）
    app.js           # 外壳逻辑：状态、事件、分页、埋点
    skins/
      standard.css   # 一个皮肤一对文件
      standard.js
      journal.css
      journal.js
      space.css
      space.js
```

`index.html` 的**加载顺序是硬约束**：

```html
<!-- 三个皮肤 CSS 必须排在 app.css 之前：同特异度下后者胜，外壳的 .sc-card-wrap>[data-card-id]:hover{transform:none}
     才能盖住皮肤的 :hover（单卡模式不该有 hover 位移）。 -->
<link rel="stylesheet" href="assets/skins/standard.css">
<link rel="stylesheet" href="assets/skins/journal.css">
<link rel="stylesheet" href="assets/skins/space.css">
<link rel="stylesheet" href="assets/app.css">

<!-- 皮肤 JS 必须排在 app.js 之前：app.js 的 init() 会读 window.EXAM_SKINS，晚到就是 undefined。 -->
<script src="assets/skins/standard.js"></script>
<script src="assets/skins/journal.js"></script>
<script src="assets/skins/space.js"></script>
<script src="assets/app.js"></script>
```

宿主按 `/v1/tools/<id>/assets/<path>` 伺服，`_safe_zip_name` 允许**嵌套路径**（`assets/skins/x.js` 没问题，只要不含 `..`），
`TOOL_EXT_WHITELIST` 已含 `.css/.js` ⇒ **无需改 `app.py`**。

## 皮肤契约

每个皮肤文件导出一个对象到全局表：

```js
window.EXAM_SKINS = window.EXAM_SKINS || {};
window.EXAM_SKINS.journal = {
  id: 'journal', name: '手帐', icon: '📖',
  render(card, env) { return '<div class="word-card skin-journal" data-card-id="' + card.id + '">…</div>'; },
};
```

**`render` 返回的根节点必须带 `data-card-id="<卡片id>"`** —— 外壳靠它定位、`init` 靠它跑；漏了整个皮肤静默失活、按钮全死。

`env` 由外壳组装（皮肤不得自己去 fetch）：

```js
{ badge: { text, theme }, marked, fav, peek, showEn, showZh,
  esc, senses, hl, cocaText, icon }
```

- `badge.theme` 是一个对象（`{acc, acc2, soft, deep, ink, line, sh}`）——**踩过**：外壳传了 `badge: state.badge`，
  皮肤读 `env.badge.theme.acc` 直接 `Cannot read properties of undefined`，整页一张卡都不出。
  正确写法：`badge: { text: state.badge.text, theme: state.badge }`。
- `esc()` 转义、`senses()` 把「JSON 字符串 or 数组」规整成 `string[]`、`icon()` 出图标 —— 一律用外壳给的，别在皮肤里重复实现。
- `hl(sentence, word)` 把例句里的目标词包成 `<span class="hl">`（**先转义再包**，反过来会把 span 转义掉）；
  词形变化一并命中（`\b(word\w*)`，所以 abandon 能标出 abandonment）。
- `cocaText(rank)` 出 COCA 文案：`COCA TOP n`（n≤1000）/ `COCA #n`。**别把 `#` 省掉**，裸数字会被读成词频。

## 铁律：皮肤绝不绑事件

外壳用**一个委托 click** 监听整页，按 `closest('[data-*]')` 分派；皮肤 `render` 只出 HTML。

> 皮肤若自己 `addEventListener`，同一个点击会被处理两次 ⇒ **音频播两遍、埋点记两条**。
> 这是架构红线，不是风格偏好。

## 铁律：按钮类名跨皮肤统一

```html
<button class="act-play"        data-play="<id>">      <!-- 朗读 -->
<button class="eye-btn act-eye" data-eye="<id>">       <!-- 偷看释义 -->
<button class="act-mark"        data-mark="<id>">      <!-- 标记 -->
<button class="act-fav"         data-fav="<id>">       <!-- 收藏 -->
<button class="eye-btn example-toggle-btn" data-ex-idx="<n>">  <!-- 单条例句 -->
```

外壳一套选择器管所有皮肤（探针/截图脚本也不必按皮肤写分支）。
**踩过两次**：手帐/太空皮肤各用了自己的前缀（`jr-mark` / `sp-…`），导致 `.act-mark` 定位超时、探针大面积失败。
皮肤差异只许体现在 **CSS**，DOM 结构与类名必须一致。

⚠️ 例句开关**必须输出 `data-ex-idx`**：漏了 ⇒ 外壳 `parseInt(undefined)=NaN` ⇒ **静默失效**（不报错，只在埋点里少一条 `example_view`）。

## 状态与持久化

- 皮肤 id 存 `localStorage`（如 `dc-exam-skin`），切换时 `document.body.dataset.skin = id`，CSS 用 `body[data-skin="journal"] …` 分支。
- 切换后要 **`rerenderAllPages()`**（已渲染的卡不会自己变），并把默认值写进 `index.html` 的 `<body data-skin="…">`，避免首屏闪一下。
- 字号仍走 `--card-font-scale`：**凡字号乘倍率，盒子尺寸必须同倍率**；按钮 `--ew-scale: clamp(1, var(--card-font-scale,1), 1.8)`。
- 皮肤不要用 Tailwind 的 preflight 假设（**v4 没有 `button{cursor:pointer}`**；`border:0` 要写 `border:0 solid`）；
  新皮肤建议自带 CSS 变量与 reset，不引框架。

## 一 zip 多卡组：动态取组名

数据是**按 deck_id 现取**的（`window.cardAPI.getPage`），所以一份 zip 天然能服务多个卡组。
想按卡组换标题 / 徽章 / 主色，读只读接口：

```js
const r = await fetch('/v1/decks/' + cardAPI.deckId).then(x => x.json());
// → { success:true, deck:{ id, name, … } }
```

再按名字映射主题（中考/高考/CDE-4…），把 `theme` 塞进 `env.badge.theme`。
**卡组私有数据不要写进工具**（目标、月份、任务清单都放卡片 `data`）——工具是共享的，卡片数据才是私有的。

## 把「原版模板」移植成皮肤（忠实移植 + 增强）

任务形态：用户说「做的手帐/星球风格不如原来好看」「可以在原版上再增强吗」。
做法不是重新设计，而是**先把原模板逐条搬过来，再叠增强**。

1. **拿真源码**：从应用库读模板（`select card_html, card_css, card_js from t_template where id=?`）。
   两个原版模板（t42 手帐 / t43 太空站）的 `render()` 都是**在 JS 里拼整段 HTML**，`card_html` 基本是死的 ——
   真正要搬的是 `card_js` 里的 Tailwind 工具类 + `card_css` 里那 2 KB。
2. **分工照抄原版**：布局/间距/配色/倾斜/阴影留在 markup 的 Tailwind 工具类里，
   皮肤 CSS 只写 Tailwind 表达不了的部分（字体栈、荧光划线、胶带阴影、按钮态）。原版就是这个分工。
3. **能缩放的才是能用的**：原版写死 px，移植时统一换成
   `text-[length:calc(<px>*var(--card-font-scale,1))]`（`length:` 类型提示必需），盒子尺寸同步乘 `--ew-scale`。
4. **别丢招牌细节**。手帐最抓眼的是释义标题那条**满宽荧光笔划**——它其实是"意外"：
   `.jc-label` 是 `inline-block`，但父级是 `flex flex-col`（`align-items` 默认 `stretch`）⇒ 被拉满整栏，
   `.hl-p` 的渐变就成了贯穿整行的高亮。移植时按原样复现（`journal.css` 里有注释）；少了它整栏后半段空着，观感立刻变差。
5. **别丢例句目标词高亮**（`.sc-log-en .hl`，原版 cardCss 里就有）—— 用 `env.hl()`。
6. **别丢胶囊的 `#`**（`COCA #10172`）—— 用 `env.cocaText()`。
7. **验收**：`_preview/zoom_ab.js` 逐卡特写 + `shot_ab_clean.js` 原版对照 + `probe_exam.js` 回归。

⚠️ **原版不能拿宿主页面截图当基准**：宿主 `static/styles.css` 里 `.sc-card` 是**统计卡**
（白底 + `flex-direction:column`，未分层），和模板 t43 卡根类名撞车 ⇒ 原版太空站在宿主页里是**白底竖排**的。
必须用干净页渲染原版：`python3 _preview/gen_ab_orig.py` → `/tmp/abweb` + `python3 -m http.server 8981`
（只加载 vendor + 模板 cardCss）。详见 `vendor.md`。

## 验证矩阵

新增/修改皮肤后至少跑一遍：

1. **每个卡组 × 每个皮肤**都能出满一页卡，根节点带 `data-card-id`，按钮类名齐全。
2. **每个交互各产生恰好 1 条埋点**（`audio_play` / `definition_view` / `word_mark` / `favorite_toggle` / `example_view`）。
3. **字号 80% / 100% / 180%** 无横向溢出、按钮与文字同步缩放。
4. **皮肤选择跨刷新保留**；单卡模式（wrap / 方向键 / Esc）在三皮肤下都正常。
5. 控制台 **0 报错**（皮肤 selector 写错、变量未定义，光看截图看不出来）。

⚠️ 探针/截图脚本**开头必须 `POST /__preview/reset` 再 reload**：预览服务的 mark/favorite 存在**进程内存且跨运行累积**，
不复位会出现「按钮点了没反应」的假故障（其实是第二次点击取消了标记）。
⚠️ 卡组里可能本来就有用户真实标记过的词 ⇒ 断言 `unknown_count` 要**从 API 读**，别硬编码 0。
