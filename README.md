# dsh-liquid-glass

全局液态玻璃主题 for DeepSeek Harness。

- **材质**：`backdrop-filter` 实时模糊 + 动态径向渐变 + 1px 超细高光描边
- **透明度**：浅色模式玻璃 **60%**，深色模式玻璃 **35%**（符合需求）
- **动效**：控件点击的轻微流动形变、滚动时的光影偏移
- **可调**：所有参数实时可改，不用改代码、不用重启

---

## 2026-10-11 修复：为什么之前"运行了但没效果"

插件原本能正常加载（启动图里有它、`apply()` 也在跑），但界面上看不出任何变化。
用真实前端（DSH 0.2.0-rc.2 的 bundle）逐项核实后，根因有两个，都已修：

1. **结构选择器用的 `[data-slot=...]` 在前端根本不存在**（全量 CSS/JS 里 0 处）。
   `backdrop-filter` 模糊、1px 高光描边因此从未生效。已改为真实面板：
   - `.pI_x6G_sidebarCol` —— 侧栏（玻璃面：模糊 + 光影 + 描边）
   - `.pI_x6G_centerCol` —— 主栏（内容底色已 90%，只加光影 + 描边，省性能）
   - `[data-windows-titlebar] .pI_x6G_frame:before` —— Windows 标题栏
   - `[role="dialog"][aria-modal="true"]` / `[role="menu"]` / popper 容器 —— 浮层
   - 这些类名是构建产物，DSH 大版本更新后可能改名（届时模糊会退化为
     仅半透明，令牌层不受影响；`doctor()` 会显示命中数为 0 提示你更新选择器）。

2. **Windows 窗口不透明、DSH 默认没有壁纸**：60%/35% 的半透明叠在纯白/纯黑
   画布上，视觉差异趋近于零。现在给 `<html>` 铺了一层缓慢流动的
   径向+线性渐变当**环境壁纸**（浅色冷调 / 深色靛紫），`<body>` 压到
   30% 透明度，让壁纸透过玻璃面板显示出来。至此玻璃有底可显、有底可糊。

> 安装方式不变：profile 里是 junction 链接，改完源码**重启桌面应用**
> （或刷新 `http://127.0.0.1:19387/`）即生效。

---

## 按需求补齐：WWDC25 全量玻璃（2026-10-12）

对照你给的开发提示词逐条核对后，又补了三块：

1. **所有按钮玻璃化（全局覆盖）**
   - 透明底按钮（插件入口、搜索、模型选择等 16 个）→ 直接玻璃：
     实时模糊 + 冷调玻璃底 + 1px 高光描边（浅色 54%、深色 40%）
   - 图标按钮（收起侧栏、全屏等）→ 静止时轻玻璃，悬停/按下加深
   - 带实心底的品牌按钮（新会话、发送、添加文件）→ 保留自身色相保证
     文字清晰，只叠玻璃层（模糊 + 光影 + 描边），不强行盖底
2. **动效适配（WWDC25 丝滑手感）**
   - 点击：pointerdown 时控件走 320ms「压下去-弹回来」流动形变
     （`dlg-press-flow`，含亮度脉冲），松开即恢复
   - 滚动：光带 `--dlg-lux-y` 随滚动位置滑动、描边亮度随滚动增强，
     玻璃看起来在跟着内容折射光影（rAF 节流，滚动中不卡）
3. **第三方插件兼容（新手友好兜底）**
   - 监视名单新增 `dsh-web-ui`、`dsh-better-sidebar`（原名单保留）
   - 页面已自带壁纸（第三方铺的）→ 本插件让位，不覆盖对方背景
   - 浮层（菜单/popper）JS 探测：透明底补玻璃，已有不透明设计保持原样
   - 安全模式命中时，第三方子树内的按钮/菜单全部让位，保留对方设计

> 说明：按钮类名（`hHd-Xa_*`、`uV2eYG_*` 等）和侧栏一样是构建产物哈希，
> DSH 大版本更新后可能改名，届时 `doctor()` 的命中数会提示你更新。

---

## 全局指针液态光效（macOS Sonoma 指针光晕，2026-10-12）

全局鼠标指针实时跟随的苹果风格液态光效，四项硬约束的实现方式：

1. **核心质感**：光晕 = 纯 CSS 径向渐变光斑（视觉上等效"高斯模糊后的柔光"），
   鼠标移动时光晕用 0.42 指数插值顺滑跟随；背后 4 个历史采样幽灵点按
   **300ms 线性消散**，形成渐变拖影。颜色按系统主题自动切换：
   - 深色 = 低饱和冷白柔光（`rgba(200,216,238,0.20)`）
   - 浅色 = 淡银白通透光（`rgba(255,255,255,0.34)` + 银白中间层）
   全程无高饱和色，`mix-blend-mode: screen` 只加光、不遮字。
2. **性能**：光晕/拖影**不跑 `filter:blur()`**（那是掉帧元凶），每帧只写
   transform + opacity，由浏览器合成器搬运（GPU 合成，无重绘无布局）。
   rAF 累加器锁 **60 帧**（120/144Hz 高刷屏也不超频）；全套动效一帧约
   10 次纯数值插值 + 6 个小图层合成，CPU 占用远低于 5% 上限。
3. **交互细节**：鼠标静止 480ms 后光晕开始呼吸——明暗 ±14%、缩放 ±5%
   正弦起伏；点击瞬间 380ms 内光晕扩散到 1.16 倍再回弹 + 亮度闪，
   用 `sin(p·π)` 弹性曲线近似苹果动效，无生硬跳变。
4. **兼容**：光效层 `position:fixed; pointer-events:none; z-index 置顶`，
   完全不挡点击与输入；叠加在既有玻璃/毛玻璃之上（screen 混合互不冲突）；
   指针落在**侧栏（`.pI_x6G_sidebarCol`）或 Windows 标题栏**上时光效自动
   隐藏（系统 UI 避让）；容器 `overflow:hidden`，光斑贴窗口边缘即裁剪，
   不会溢出界面外。

## iOS 26 液态玻璃：按钮 hover 实时渲染（2026-10-12 追加）

这是"全真液态玻璃档"：**按钮本体就是液态玻璃**，鼠标一指向按钮，
按钮表面实时渲染液态光效：

- 每个按钮叠一层液态玻璃（`::after`，`pointer-events:none` 不挡点击）：
  **跟随指针的高光斑** + 玻璃顶部高光弧 + 边缘内亮 + 底部内影（厚度感）
- 指针相对按钮的位置由 JS 实时写进按钮内联 `--dlg-glow-x / --dlg-glow-y`
  （rAF 合并，只更新当前 hover 的那个按钮，其余按钮零成本），
  高光斑就像在玻璃表面流动
- hover / 聚焦 / 按下时液态层 `opacity 0→1` 平滑"实时渲染"，
  `plus-lighter` 加亮混合只加光、按钮文字始终清晰
- 透明底按钮、品牌按钮（新会话/发送）、图标按钮全部生效；
  深色=低饱和冷白高光，浅色=淡银白通透光，无刺眼高饱和
- 与全局指针光晕叠加互不冲突；安全模式下第三方插件的按钮让位（保留对方设计）

调参：

```js
__dshLiquidGlass.set('liquid', 0.8)   // 液态玻璃强度（0 = 关闭按钮液态光效）
__dshLiquidGlass.set('glow', 0.6)     // 0 = 关闭全局指针光晕；0.5–1 调强度
__dshLiquidGlass.set('motion', 0)     // 0 = 连光效带其它交互动效全部关闭
```

系统开了"减少动态效果"（prefers-reduced-motion）时，光效自动整体关闭。
`doctor()` 里的「指针光效」「液态玻璃_hover」两组会回显当前状态与颜色。

## 光效样式三模式 + 液态层实透（设置按键）

**设置里有一个光效按键**（侧栏底部"设置"图标旁，打开 DSH 设置面板时也会
自动注入一个；按键本身是 `button`，自带同样的液态 hover 光效与全局光晕）：

1. **点击按键** → 弹出玻璃浮层（自身也是液态玻璃质感）
2. **光效样式**三选一（点按即时生效，光晕与按钮液态层同步变化）：
   - **默认样式**：深色=低饱和冷白柔光，浅色=淡银白通透光
   - **彩色折射**：七彩彩虹——光晕与液态层叠上红橙黄绿蓝靛紫的低饱和
     conic 光谱环（screen 混合只加光、不刺眼）
   - **自定义颜色**：选任意颜色，光晕与液态层换成该色的柔光渐变；
     **渐变开关**开启后可用"颜色 A + 颜色 B"双色线性渐变
3. **液态层实/透滑块**：更透（0.35，几乎透明的纯光）↔ 更实（1，实心玻璃感）
4. 关闭按钮 / 点击浮层外均可收起

> 选色已做流畅化：拖动取色器只走轻量颜色更新路径（不触发全量重算），即时响应。

对应的控制台 / URL 参数（与面板走同一条链路）：

```js
__dshLiquidGlass.set('glowStyle', 'prism')      // default | prism | custom
__dshLiquidGlass.set('glowColor', '#88ccff')    // 自定义模式的颜色 A
__dshLiquidGlass.set('glowColorEnd', '#6a5cff') // 自定义模式渐变颜色 B
__dshLiquidGlass.set('glowGradient', true)      // custom 模式启用双色渐变
__dshLiquidGlass.set('liquidFill', 0.65)        // 0.35 更透 ↔ 1 更实
```
`?lg-glowStyle=prism&lg-glowColor=%2388ccff&lg-liquidFill=0.42`
（URL 参数在应用启动时生效；控制台/面板改动立即生效）

---

## 装在哪、怎么装

本包位于工作区：`D:\deepseekHS插件\dsh-liquid-glass`

已经安装到 `desktop` profile，安装方式（与官方一致）：

```
dsh plugin --profile desktop add D:\deepseekHS插件\dsh-liquid-glass
```

Profile 里是 **junction 链接**，所以直接改本目录的源码即可，不用重新安装。

---

## 为什么必须用内联写入

这是本项目踩了两轮才定下来的方案，值得记下来。

**失败路径（样式表规则）**：插件把 `--dsw-alias-*` 令牌写在样式表规则里，
理论上能级联到全部界面元素。但真实诊断显示：

```
html   --dsw-alias-bg-base → rgba(255,255,255,0.9)   ← 插件的值，生效了
body   --dsw-alias-bg-base → #fff                     ← 被 app 覆盖回实心白
#root  --dsw-alias-bg-base → #fff                     ← 同样被覆盖
```

app 在 `html` **之下**的层重新定义了同名令牌，把界面拉回不透明。
配合 `body{background:transparent}` 这类规则，结果是**界面看起来毫无变化**。

**可行路径（内联写入）**：内联样式天然压过任何样式表规则，
所以把令牌写进 `<html>` / `<body>` 的 `style` 上，app 再也盖不住。

```js
el.style.setProperty('--dsw-alias-bg-base', 'var(--dlg-base-L)')
```

CSS 里仍保留一份 `!important` 的同名声明作为兜底（万一内联写入被环境拦下）。
两者叠加之后，**半透明（令牌层）不再依赖任何 DOM 结构猜测**；模糊与描边
（材质层）则依赖真实面板选择器，见文件头的"2026-10-11 修复"。

**取舍**：代价是改动了宿主节点的内联样式。为此插件写入前会备份原值，
卸载时精确还原；`check-generated-css.mjs` 里有专门的断言守着这条
（`dispose 后内联令牌已还原`）。

---

## 三条最常用的调参入口

打开开发者工具控制台（在页面上按 `F12`，或 `Ctrl+Shift+I`），然后：

### 1. 改玻璃透明度（最常调的一个）

```js
__dshLiquidGlass.set('glassDark', 0.45)   // 深色模式玻璃不透明度 → 45%
__dshLiquidGlass.set('glassLight', 0.75)  // 浅色模式玻璃不透明度 → 75%
```

`baseDark` / `baseLight` 是**内容底色兜底**（默认 0.86 / 0.90）。它决定正文
所在那层的实心程度：

```js
__dshLiquidGlass.set('baseDark', 1)      // 深色模式正文底完全不透明 → 文字最清晰
__dshLiquidGlass.set('baseDark', 0.6)    // 更透，但长文阅读会开始变吃力
```

> 为什么分两层：玻璃层负责"质感"，内容底色负责"文字对比度"。把内容底色也压到
> 35% 会让正文坐在可见壁纸上，无论怎么调都会糊。所以默认值是"玻璃有质感 +
> 文字清晰"的平衡点，你可以按自己的显示器再微调。

### 2. 改高光与模糊

```js
__dshLiquidGlass.set('highlight', 1.6)   // 1px 高光描边强度（0–2）
__dshLiquidGlass.set('blur', 32)         // 模糊半径 px（0–60）
__dshLiquidGlass.set('refract', 1.5)     // 径向折射光影强度（0–2）
__dshLiquidGlass.set('saturate', 1.9)    // 背景饱和增强（1–2.5）
__dshLiquidGlass.set('glow', 0.8)        // 全局指针液态光效强度（0 关闭）
__dshLiquidGlass.set('liquid', 0.8)      // 按钮 hover 液态玻璃强度（0 关闭）
__dshLiquidGlass.set('press', 0)         // 0 = 关掉点击流动形变（保留滚动光影）
__dshLiquidGlass.set('motion', 0)        // 0 = 关掉全部交互动效
```

### 3. 一键还原 / 看当前状态

```js
__dshLiquidGlass.get()        // 打印当前全部参数
__dshLiquidGlass.reset()      // 恢复到默认值
__dshLiquidGlass.theme()      // 当前是 'light' 还是 'dark'
```

---

## 用 URL 参数直接带一套参数（适合分享 / 换机）

网页地址后面直接加，刷新即生效：

```
http://127.0.0.1:19387/?lg-glassDark=0.45&lg-blur=28&lg-highlight=1.5
```

支持的键就是 `DEFAULTS` 里的名字：`blur` `saturate` `glassLight` `glassDark`
`baseLight` `baseDark` `highlight` `refract` `glow` `liquid` `press` `motion`。

---

## 界面没变化时怎么排查

按顺序看这三件事：

**① 页面刷新了吗？**
client 端 bundle 是在页面加载时拉取的。装完插件后必须**刷新页面**（`F5`）。
刷新后没效果，再往下看。

**② 根标记在不在？**

```js
document.body.hasAttribute('data-dsh-liquid-glass')   // 期望 true
document.getElementById('dsh-liquid-glass/liquid-glass.css')  // 期望不是 null
```

`false` / `null` 说明插件没被激活，检查：Settings → Plugins 里 `dsh-liquid-glass`
是否是启用状态。

**③ 是否进了安全模式？**

```js
document.body.getAttribute('data-dlg-peers')   // 命中哪些同挂点插件
__dshLiquidGlass.detectedPeers()               // 同上，返回数组
```

如果返回了插件名（例如本机已装 `dsh-better-sidebar`、
`@smalltailqwq/dsh-client-ui-skin-maid-atelier`、`dsh-whale-widget`），说明检测到
有插件在改同一批挂点，本主题已自动降级：保留颜色/模糊/描边，关掉会改变几何的
动效，避免互相覆盖把界面顶坏。想强制开启：

```js
__dshLiquidGlass.safeMode(false)
```

**④ 环境背景铺上了吗？**

```js
getComputedStyle(document.documentElement).backgroundImage   // 期望是一组 radial/linear 渐变，不是 none
getComputedStyle(document.body).backgroundColor              // 期望带 alpha（如 rgba(255,255,255,0.3)）
```

`none` / 实心色说明环境壁纸没铺上 —— 玻璃没有可折射的底，界面会"透明了
但看不出变化"。深色下 html 的背景渐变由 JS 内联写入，若切换主题后变回
实心色，多半是主题监听没触发，刷新页面即可。

**⑤ 按钮玻璃化了吗？**

```js
// 任意透明底按钮（如"插件"入口）应显示带 alpha 的玻璃底色 + backdrop-filter
getComputedStyle(document.querySelector('button[class*="panelRow"]')).backgroundColor
getComputedStyle(document.querySelector('button[class*="panelRow"]')).backdropFilter
```

期望：`rgba(243,248,255,0.54)`（浅色）/ `rgba(20,26,40,0.40)`（深色）+ `blur(20px) saturate(1.6)`。
带实心底的品牌按钮（新会话/发送）底色不变但会叠玻璃层；图标按钮静止时底色
很轻，悬停才加深 —— 这些是设计使然，不是坏了。

**⑥ 点击/滚动动效在不在？**

```js
// 点击：按下按钮瞬间应有 .dlg-press 类一闪而过
// 滚动：主栏滚动后 document.documentElement.style 里 --dlg-scroll-y 应变大
```

深色下若想一眼看出"流动"，把鼠标移到玻璃面上左右移动，指针跟随的
径向高光（--dlg-px / --dlg-py）会跟着走；滚动侧栏/对话时 --dlg-lux-y
光带会上下滑动。

**⑦ 第三方插件兼容状态？**

```js
document.body.getAttribute('data-dlg-safe')   // "on" = 检测到同挂点插件，已自动降级
```

检测到 `dsh-web-ui` / `dsh-better-sidebar` 等时，本插件会：壁纸让位（不覆盖
对方的背景）、第三方子树内的按钮/菜单保持对方设计、关掉改变几何的动效。
想强制开启完整效果：`__dshLiquidGlass.safeMode(false)`。

**换了主题（浅色↔深色）没跟上？** 不需要额外操作，深色适配走的是
`body[data-ds-dark-theme]` 属性选择器，主题切换时 CSS 自动跟随。

---

## 已知限制（诚实说明）

- **"绝对清晰"是目标不是证明。** 默认值按 WCAG 对比度思路取的
  （深色下正文颜色提到纯白、底色兜底 0.86）。但最终观感取决于你的显示器、
  亮度和系统主题，请按上面第 1 条自行微调。
- **与第三方插件的兼容是"自动降级"而不是"绝不冲突"。**
  本插件不认识任意第三方插件，只对已安装且已知会改同挂点的插件做保守降级。
  它只使用官方主题令牌 `--dsw-alias-*`、标准 `role` 属性，以及
  **实测命中的构建类名**（`.pI_x6G_sidebarCol` / `.pI_x6G_centerCol`，
  随 DSH 版本可能改名，`doctor()` 可复查命中数）。不写任何宿主节点的
  内联样式（除令牌与背景本身），不猜未知的 class —— 这能避免绝大多数
  冲突，但不能构成数学意义上的保证。
- **没有"WWDC25 官方 CSS 标准"可依。** 苹果没有发布可对照的 CSS 规范。
  本实现是按其视觉规律做的近似：背景实时模糊、饱和度提升、1px 高光描边、
  指针跟随的径向折射。
- **没有内置图形化设置面板。** 调参走控制台与 URL 参数两条路。若要图形面板，
  官方挂点是 Client slot `plugins.detail.section` 或 `settings.general.item`，
  可以后续加。

---

## 文件说明

| 文件 | 作用 |
|---|---|
| `package.json` | 包清单：`dsh.bundle.patch` 让它成为 profile 层；`dsh.client` 声明浏览器半侧 |
| `cordis.patch.yml` | Loader patch，把插件行 `insert` 进 profile（缺了它包会装上但什么都不做） |
| `lib/index.js` | Host 半侧。纯客户端主题，这里刻意不做任何事，但不抛错 |
| `lib/client.js` | 浏览器半侧。**核心**：样式表 + 参数系统 + 动效 + 兼容护栏 |
| `dsh.plugin.json` | 插件元信息（给插件管理界面读） |
| `verify.mjs` | 零依赖自检：`node verify.mjs`，29 项检查 |

### 关键约束（改代码前必读）

**① 浏览器 bundle 必须向 `window.__ModuleLoader__` 注册自己。**

这是最容易踩、后果最严重的坑：写错了不是"插件不生效"，而是 **DSH 直接无法启动**，
弹窗提示「应用无法启动或已意外停止 / web boot: 1 entry did not activate」。
正确格式（本机三个生态插件用的都是这个）：

```js
window.__ModuleLoader__.load({
  id: 'dsh-liquid-glass',
  factory: (require) => {
    var module = { exports: {} };
    // ... 你的代码 ...
    module.exports = { name: 'dsh-liquid-glass', inject: [], apply: apply };
    return module.exports;
  }
});
```

`lib/client.js` 是 DSH 的 **lazy-CJS** 模块，**不能出现 `import` / `export`**。
样式表是普通字符串拼接，避免任何构建步骤 —— 改完存盘、刷新页面即生效。

**② 令牌覆盖靠内联写入，并且必须在卸载时精确还原。**

这是[核心机制](#为什么必须用内联写入)。`--dsw-alias-*` 令牌用
`el.style.setProperty()` 直接写在 `<html>` 和 `<body>` 上 ——
内联样式天然压过任何样式表规则，所以 app 无论在哪一层重新定义令牌都盖不住。

**代价**：这确实改动了宿主节点的内联样式。所以插件在写入前会
`backupInline()` 备份这些属性的原值，`dispose()` 时 `restoreInline()` 精确还原
（原值非空则恢复、原来为空则移除）。如果你要改这块逻辑，
**务必保留备份/还原配对**，否则卸载插件会留下脏的内联样式。

**③ 不要在 CSS 颜色分量里写 `calc()`。**

`rgb(255 255 255 / calc(var(--x) * 0.42))` 以及
`color-mix(..., calc(var(--x) * 100%), ...)` 属于较晚才稳定的语法，
不支持的引擎会**静默丢弃整条声明** —— 表现是"样式没生效但控制台零报错"。

所以：所有需要按参数缩放的透明度都在 JS 里换算成最终 `rgba(...)` 再写进变量，
CSS 只做 `var()` 直读。下面两条防线由 `verify.mjs` 强制检查。

### 自检

```
node D:\deepseekHS插件\dsh-liquid-glass\verify.mjs
```

检查清单：JSON 合法性、`dsh.client` ↔ `./client` 导出契约、patch 结构与缩进、
无 ESM 语法、**`__ModuleLoader__` 注册与 id**、语法解析、在最小 DOM 沙箱里
真实跑一遍 `apply()`、参数钳制、`dispose` 清理、60% / 35% 两个需求值，
以及两条"静默失效"防线（无 `color-mix`、颜色分量内无 `calc()`）。

另有一个**加载等价性探针**，把本插件与三个已装机可用的生态 bundle 放在同一套
`__ModuleLoader__` 语义下加载并比较结果：

```
node D:\deepseekHS插件\probe-bundle-contract.mjs
```

改动客户端 bundle 后建议两个都跑一遍。

---

## 卸载

```
dsh plugin --profile desktop remove dsh-liquid-glass
```

或在 Settings → Plugins 里移除。插件被动卸载时 `ctx.effect` 的清理函数会把
样式表、body 标记、事件监听和内联变量全部还原，不留残留。

## License

MIT
## 开源与创作说明
本项目采用 MIT License 开源。
本插件代码由 AI 辅助编写，本人对全部代码进行审阅、修改、测试，拥有本项目完整发布权。
你可以自由复制、修改、分发本项目，遵守 MIT 许可证条款即可。
