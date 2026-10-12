/**
 * dsh-liquid-glass —— 全局液态玻璃主题（浏览器半侧）
 *
 * ── 注册外壳（踩过坑，务必保留）──────────────────────────────────────
 * bundle 必须**主动向 `window.__ModuleLoader__` 注册自己**：
 *
 *     window.__ModuleLoader__.load({ id: <包名>, factory: (require) => module.exports })
 *
 * 只写一个裸的 IIFE 是错的：loader 收不到任何模块，启动图会报
 * `web boot: 1 entry did not activate` / `<包名>: import failed`，
 * 随后 DSH 弹出「应用无法启动或已意外停止」。
 * 本机三个生态插件（dsh-context、dsh-boot-animation、ui-skin-maid-atelier）
 * 用的都是上面这个格式。文件里**不能出现 import / export**。
 *
 * ── 为什么颜色不在 CSS 里算 ──────────────────────────────────────────
 * `color-mix(..., calc(x * 100%), ...)` 与 `rgb(... / calc(x * 0.4))`
 * 属于较晚才稳定的语法，不支持的引擎会**静默丢弃整条声明** ——
 * 表现是「样式没生效但控制台零报错」。所以所有需要按参数缩放的透明度
 * 都在 JS 里换算成最终 rgba()，CSS 只做 var() 直读。
 *
 * ── 令牌覆盖走内联写入（这是"没效果"的最终解法）──────────────────────
 * 真实诊断数据（样式表方案失败时）：
 *     html   --dsw-alias-bg-base → rgba(255,255,255,0.9)  ← 我的规则生效了
 *     body   --dsw-alias-bg-base → #fff                    ← 被 app 覆盖
 *     #root  --dsw-alias-bg-base → #fff                    ← 被 app 覆盖
 * app 在 html 之下的层重新定义了同名令牌，样式表规则赢不了它，
 * 界面始终是 #fff 不透明，所以看不出任何玻璃效果。
 *
 * 现在改为用 `el.style.setProperty()` 把令牌直接写成 html / body 的
 * **内联样式** —— 内联样式天然压过任何样式表规则，app 再也盖不住。
 * 代价是会改宿主节点的内联样式，因此写入前备份原值、卸载时按备份
 * 精确还原（见 backupInline / restoreInline），不留残留。
 * 样式表里那份同名的 `!important` 声明保留作兜底，不是主路径。
 *
 * ── 可读性策略 ───────────────────────────────────────────────────────
 * 需求既要「玻璃有质感」又要「深色下文字绝对清晰」。把正文底色也压到
 * 35% 会让文字坐在可见壁纸上。所以分两层：
 *   · 玻璃层按真实参数（浅色 60% / 深色 35%）负责质感；
 *   · 内容底色与弹窗单独兜底负责对比度。
 *
 * ── 为什么之前"运行了但没效果"（本版已修）──────────────────────────
 * 1) 结构选择器用的是 [data-slot=...]，但 DSH 0.2.0-rc.2 前端实测
 *    根本不存在 data-slot 属性 → backdrop-filter 模糊/描边从未生效。
 *    已改为真实面板：.pI_x6G_sidebarCol（侧栏）、.pI_x6G_centerCol
 *    （主栏）、[role="dialog"/"menu"]、popper 容器与 Windows 标题栏。
 * 2) Windows 的 Electron 窗口不透明、DSH 默认没有壁纸：60%/35% 的
 *    半透明叠在纯白/纯黑画布上，视觉差异趋近于零。
 *    现在给 html 铺一层缓慢流动的径向+线性渐变当环境壁纸，body 压到
 *    30% 透明度，让壁纸透过玻璃面板显示出来（见 LIGHT_AMBIENT /
 *    DARK_AMBIENT 与 buildCss 的环境背景段）。
 *
 * @param {Function} loadModule - 浏览器模块表的 require（本插件不使用）。
 * @returns {{name: string, inject: string[], apply: Function}}
 */
window.__ModuleLoader__.load({
  id: 'dsh-liquid-glass',
  factory: (loadModule) => {
    var module = { exports: {} };
    'use strict';

    var PKG = 'dsh-liquid-glass';
    var VERSION = '1.0.0';
    var STYLE_ID = PKG + '/liquid-glass.css';
    var ROOT_ATTR = 'data-dsh-liquid-glass';
    var MOTION_ATTR = 'data-dsh-liquid-glass-motion';

    /** 已安装、且已知会改动同一批挂点的第三方插件。命中即自动降级。 */
    var WATCHED_PEERS = [
      ['dsh-web-ui', '[data-dsh-web-ui], [class*="dsh-web-ui"], style[data-plugin*="dsh-web-ui"]'],
      [
        'dsh-better-sidebar',
        '[data-dsh-better-sidebar], [class*="better-sidebar"], style[data-plugin*="better-sidebar"]'
      ],
      [
        '@smalltailqwq/dsh-client-ui-skin-maid-atelier',
        'body[data-dsh-maid-atelier], style[data-plugin="@smalltailqwq/dsh-client-ui-skin-maid-atelier"]'
      ],
      ['dsh-whale-widget', 'style[data-plugin="dsh-whale-widget"], [data-dsh-whale-widget]']
    ];

    /** 默认参数。全部实时可调。 */
    var DEFAULTS = {
      blur: 20,          // px   背景模糊半径
      saturate: 1.6,     // 倍   背景饱和度增强（玻璃折射感）
      glassLight: 0.60,  // 0-1  浅色模式玻璃不透明度（需求：60%）
      glassDark: 0.35,   // 0-1  深色模式玻璃不透明度（需求：35%）
      baseLight: 0.90,   // 0-1  浅色内容底色兜底（保证文字清晰）
      baseDark: 0.86,    // 0-1  深色内容底色兜底（保证文字清晰）
      highlight: 1,      // 0-2  1px 高光描边强度
      refract: 1,        // 0-2  动态径向渐变（折射光影）强度
      press: 1,          // 0-1  点击流动形变强度（WWDC25 手感）
      liquid: 1,         // 0-1  液态玻璃强度：hover 按钮时实时渲染液态光效
      liquidFill: 0.65,  // 0.35-1 液态层实/透：1=更实（不透明感强），0.35=更透
      glowStyle: 'default', // default | prism | custom：光效/光晕样式
      glowColor: '',     // 自定义样式时的颜色（#rrggbb，空=未设置）
      glowColorEnd: '',  // 自定义样式+渐变时的第二颜色（#rrggbb，空=未设置）
      glowGradient: false, // custom 模式下是否启用双色渐变（true=线性渐变 a→b）
      glow: 1,           // 0-1  全局指针液态光效总强度（0 关闭）
      motion: 1          // 0-1  交互动效开关
    };

    /** 每个参数的可调范围，超出即钳制。 */
    var LIMITS = {
      blur: [0, 60],
      saturate: [1, 2.5],
      glassLight: [0.1, 1],
      glassDark: [0.1, 1],
      baseLight: [0, 1],
      baseDark: [0, 1],
      highlight: [0, 2],
      refract: [0, 2],
      press: [0, 1],
      liquid: [0, 1],
      liquidFill: [0.35, 1],
      glow: [0, 1],
      motion: [0, 1]
    };

    /**
     * 环境背景（"壁纸"）—— 玻璃要有东西可折射。
     *
     * Windows 的 Electron 窗口不透明、DSH 默认也没有壁纸：半透明面板
     * 叠在纯白/纯黑画布上，透明度的视觉差异趋近于零，这就是此前
     * 「运行了但看不出效果」的根因。给 html 铺一层缓慢流动的
     * 径向+线性渐变，让侧栏/弹窗等玻璃面有底可显、有底可糊。
     *
     * 浅色是样式表兜底；深色靠 JS 内联写入（深色标记设在 body 上，
     * CSS 选择器够不到 html）。
     */
    var LIGHT_AMBIENT = [
      'radial-gradient(120% 120% at 12% 8%, rgba(140,170,255,0.75) 0%, rgba(140,170,255,0) 46%)',
      'radial-gradient(130% 130% at 88% 92%, rgba(218,160,255,0.55) 0%, rgba(218,160,255,0) 52%)',
      'radial-gradient(100% 100% at 82% 12%, rgba(120,205,255,0.62) 0%, rgba(120,205,255,0) 42%)',
      'linear-gradient(135deg, #d2deef 0%, #e6ecf8 34%, #d9e2f2 62%, #c8d6ea 100%)'
    ].join(',');

    var DARK_AMBIENT = [
      'radial-gradient(120% 120% at 12% 8%, rgba(110,140,255,0.40) 0%, rgba(110,140,255,0) 46%)',
      'radial-gradient(130% 130% at 88% 92%, rgba(170,100,240,0.34) 0%, rgba(170,100,240,0) 52%)',
      'radial-gradient(100% 100% at 82% 12%, rgba(80,170,235,0.32) 0%, rgba(80,170,235,0) 42%)',
      'linear-gradient(135deg, #131b33 0%, #1d2547 36%, #161d34 62%, #1c1736 100%)'
    ].join(',');

    /** 卸载时需要从 html/body 上摘掉的自定义属性。 */
    var VAR_NAMES = [
      '--dlg-glass-light', '--dlg-glass-dark',
      '--dlg-base-light', '--dlg-base-dark',
      '--dlg-mask-light', '--dlg-mask-dark',
      '--dlg-body-light', '--dlg-body-dark',
      '--dlg-blur', '--dlg-saturate',
      '--dlg-rim-light', '--dlg-rim-top-light',
      '--dlg-rim-dark', '--dlg-rim-top-dark',
      '--dlg-rim-scroll-light', '--dlg-rim-scroll-top-light',
      '--dlg-sheen-light', '--dlg-sheen-light-mid',
      '--dlg-sheen-dark', '--dlg-sheen-dark-mid',
      '--dlg-border-light', '--dlg-border-strong',
      '--dlg-light-ink', '--dlg-light-ink-2', '--dlg-light-ink-3',
      '--dlg-base-L', '--dlg-glass-L', '--dlg-mask-L',
      '--dlg-btn-glass-light', '--dlg-btn-glass-dark',
      '--dlg-btn-glass-icon-light', '--dlg-btn-glass-icon-dark',
      '--dlg-glass-accent-light', '--dlg-glass-accent-dark',
      '--dlg-btn-glass-L', '--dlg-btn-glass-icon-L', '--dlg-glass-accent-L',
      '--dlg-lux-y', '--dlg-rim-lux', '--dlg-scroll-y',
      '--dlg-glow-core', '--dlg-glow-mid',
      '--dlg-glow-rainbow', '--dlg-glow-grad',
      '--dlg-liquid-sheen', '--dlg-liquid-spot', '--dlg-liquid-rim', '--dlg-liquid-rim-top',
      '--dlg-px', '--dlg-py'
    ];

    // ─────────────────────────────────────────────────────────────────
    // 小工具
    // ─────────────────────────────────────────────────────────────────

    /**
     * 逗号分隔的 rgba()，alpha 自动钳到 0-1。
     * 所有按参数缩放的透明度都在这里算好，绝不把 calc() 写进 CSS 颜色分量。
     */
    function rgba(r, g, b, alpha) {
      var a = Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    /**
     * 液态玻璃材质色（与主题深浅无关，html/body 两侧可安全同写）：
     * 液态层实透 --dlg-liquid-fill、prism 七彩彩虹层 --dlg-glow-rainbow、
     * custom 渐变层 --dlg-glow-grad、高光斑/高光弧/内影。
     * custom 模式用用户色，default/prism 用低饱和白系。
     */
    function writeLiquidColors(style, state) {
      // 回退：只保留默认样式（用户要求移除彩色折射/自定义颜色/面板按钮）。
      // 无论 store / URL 里 glowStyle 是什么，渲染一律走默认冷白光晕。
      var mode = 'default';
      var cR = null, cG = null, cB = null;
      if (mode === 'custom') {
        var hex = String(state.glowColor || '').replace(/^#/, '').trim();
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
          cR = parseInt(hex.slice(0, 2), 16);
          cG = parseInt(hex.slice(2, 4), 16);
          cB = parseInt(hex.slice(4, 6), 16);
        } else {
          mode = 'default';
        }
      }
      var liquidK = Math.max(0, Math.min(1, state.liquid || 1));
      var fill = Math.max(0.35, Math.min(1, state.liquidFill || 0.65));

      style.setProperty('--dlg-liquid-fill', String(fill));
      style.setProperty('--dlg-glow-prism-a', 'transparent');
      style.setProperty('--dlg-glow-prism-b', 'transparent');
      // 注意：这两个变量直接作为 background-image 图层使用，
      // 只能写合法的图片值（conic/linear/radial 渐变或 none）。
      // 写成 transparent 会使整条 background 声明失效，光晕/液态层会整个消失。
      style.setProperty('--dlg-glow-rainbow', 'none');
      style.setProperty('--dlg-glow-grad', 'none');

      if (mode === 'custom' && cR !== null) {
        style.setProperty('--dlg-liquid-spot', rgba(cR, cG, cB, 0.40 * liquidK));
        style.setProperty('--dlg-liquid-sheen', rgba(
          Math.min(255, cR + 60), Math.min(255, cG + 60), Math.min(255, cB + 60), 0.16 * liquidK
        ));
        style.setProperty('--dlg-liquid-rim', rgba(255, 255, 255, 0.55));
        style.setProperty('--dlg-liquid-rim-top', rgba(255, 255, 255, 0.80));
        // 自定义渐变：开启且第二色有效 → 135° 双色线性渐变；否则单色柔光径向。
        // 透明度提高（0.8 级），保证自定义颜色肉眼清晰可见。
        var endHex = String(state.glowColorEnd || '').replace(/^#/, '').trim();
        if (state.glowGradient && /^[0-9a-fA-F]{6}$/.test(endHex)) {
          var eR = parseInt(endHex.slice(0, 2), 16);
          var eG = parseInt(endHex.slice(2, 4), 16);
          var eB = parseInt(endHex.slice(4, 6), 16);
          style.setProperty('--dlg-glow-grad', 'linear-gradient(135deg, ' +
            rgba(cR, cG, cB, 0.80) + ' 0%, ' + rgba(eR, eG, eB, 0.80) + ' 100%)');
        } else {
          style.setProperty('--dlg-glow-grad', 'radial-gradient(circle at 50% 50%, ' +
            rgba(cR, cG, cB, 0.85) + ' 0%, ' + rgba(cR, cG, cB, 0.28) + ' 72%)');
        }
        return;
      }
      if (mode === 'prism') {
        style.setProperty('--dlg-glow-prism-a', rgba(140, 190, 255, 0.26));
        style.setProperty('--dlg-glow-prism-b', rgba(208, 150, 255, 0.22));
        // 七彩彩虹：饱和的 conic 光谱环（红橙黄绿蓝靛紫），高透明度 +
        // screen 混合只加光、不刺眼；中心透出柔白 core。
        style.setProperty('--dlg-glow-rainbow', 'conic-gradient(from 0deg at 50% 50%, ' +
          rgba(255, 110, 120, 0.92) + ' 0deg, ' +
          rgba(255, 160, 70, 0.92) + ' 51deg, ' +
          rgba(255, 220, 90, 0.92) + ' 102deg, ' +
          rgba(120, 225, 140, 0.92) + ' 153deg, ' +
          rgba(90, 185, 255, 0.92) + ' 204deg, ' +
          rgba(150, 135, 255, 0.92) + ' 255deg, ' +
          rgba(215, 120, 255, 0.92) + ' 306deg, ' +
          rgba(255, 110, 120, 0.92) + ' 360deg)');
      }
      style.setProperty('--dlg-liquid-spot', rgba(255, 255, 255, 0.30 + 0.05 * liquidK));
      style.setProperty('--dlg-liquid-sheen', rgba(255, 255, 255, 0.10 + 0.05 * liquidK));
      style.setProperty('--dlg-liquid-rim', rgba(255, 255, 255, 0.55));
      style.setProperty('--dlg-liquid-rim-top', rgba(255, 255, 255, 0.80));
    }

    /**
     * 光晕主色（--dlg-glow-core/mid）：与主题深浅相关（深色=冷白，浅色=银白）。
     * prism 模式同样走主题分支（色散靠副光斑 --dlg-glow-prism-a/b，此处不动）。
     * 只应在 applyVars（知道真实 dark 状态）里调用，避免 html/body 双写冲突。
     */
    function writeGlowColors(style, state, dark) {
      var mode = state.glowStyle === 'prism' ? 'prism' : (state.glowStyle === 'custom' ? 'custom' : 'default');
      var glowI = Math.max(0, Math.min(1, state.glow || 1));

      if (mode === 'custom' && /^[0-9a-fA-F]{6}$/.test(String(state.glowColor || '').replace(/^#/, '').trim())) {
        var hex = String(state.glowColor || '').replace(/^#/, '').trim();
        var cR = parseInt(hex.slice(0, 2), 16);
        var cG = parseInt(hex.slice(2, 4), 16);
        var cB = parseInt(hex.slice(4, 6), 16);
        style.setProperty('--dlg-glow-core', rgba(cR, cG, cB, 0.55 * glowI + 0.02));
        style.setProperty('--dlg-glow-mid', rgba(cR, cG, cB, 0.32 * glowI + 0.01));
        return;
      }

      if (mode === 'prism' && dark) {
        // 彩色折射模式：冷白核心稍微提亮，配合彩虹更清晰
        style.setProperty('--dlg-glow-core', rgba(210, 226, 248, 0.30 * glowI + 0.01));
        style.setProperty('--dlg-glow-mid', rgba(160, 182, 215, 0.12 * glowI + 0.005));
        return;
      }

      if (dark) {
        style.setProperty('--dlg-glow-core', rgba(200, 216, 238, 0.20 * glowI + 0.01));
        style.setProperty('--dlg-glow-mid', rgba(150, 172, 205, 0.085 * glowI + 0.005));
      } else {
        style.setProperty('--dlg-glow-core', rgba(255, 255, 255, 0.34 * glowI + 0.02));
        style.setProperty('--dlg-glow-mid', rgba(214, 224, 242, 0.16 * glowI + 0.01));
      }
    }

    /**
     * 确认应用后显示一个固定预览圆（屏幕右下角）：用和光晕点完全相同的
     * 颜色层渲染。作用是①立刻看到颜色是否生效，②区分"颜色没写入"与
     * "跟随光晕没显示"。点它可隐藏。
     */
    function previewGlow(html, state, dark) {
      try {
        var probe = document.getElementById('dlg-glow-preview');
        if (!probe) {
          probe = document.createElement('div');
          probe.id = 'dlg-glow-preview';
          probe.title = '液态光效预览（点击可隐藏）';
          probe.style.cssText = 'position:fixed;right:24px;bottom:120px;width:180px;height:180px;' +
            'border-radius:50%;pointer-events:auto;mix-blend-mode:screen;z-index:2147483000;' +
            'opacity:0.95;cursor:pointer;box-shadow:0 0 40px rgba(0,0,0,0.3);';
          probe.addEventListener('click', function () { probe.style.display = 'none'; });
          (document.body || html).appendChild(probe);
        }
        var hs = html.style;
        var grad = hs.getPropertyValue('--dlg-glow-grad') || 'none';
        var pA = hs.getPropertyValue('--dlg-glow-prism-a') || 'transparent';
        var pB = hs.getPropertyValue('--dlg-glow-prism-b') || 'transparent';
        var rb = hs.getPropertyValue('--dlg-glow-rainbow') || 'none';
        var core = hs.getPropertyValue('--dlg-glow-core') || 'rgba(200,216,238,0.20)';
        var mid = hs.getPropertyValue('--dlg-glow-mid') || 'rgba(150,172,205,0.085)';
        var edge = hs.getPropertyValue('--dlg-glow-edge') || 'rgba(255,255,255,0)';
        probe.style.background = rb + ',' + grad + ',' +
          'radial-gradient(circle at 32% 30%, ' + pA + ' 0%, transparent 55%),' +
          'radial-gradient(circle at 68% 72%, ' + pB + ' 0%, transparent 55%),' +
          'radial-gradient(circle,' + core + ' 0%,' + mid + ' 55%,' + edge + ' 100%)';
        probe.style.display = 'block';
      } catch (_) { /* 忽略 */ }
    }

    /**
     * 把多图层 background 以"具体颜色值"直接内联写到每个光晕点上。
     * 先读 html.style 上刚写入的 CSS 变量值，拼成实际 background 字符串
     * 内联到 dot —— 内联具体值优先级最高，且不依赖 CSS 变量继承，
     * 只要光晕点存在就一定渲染（彩虹/渐变/自定义色铁定可见）。
     * 仅在模式/颜色确认与切换时调用，不进动画循环。
     */
    function paintDotsConcrete(html, state, dark) {
      try {
        var dots = document.querySelectorAll('.dlg-glow-dot');
        if (!dots || !dots.length) return;
        var hs = html.style;
        var grad = hs.getPropertyValue('--dlg-glow-grad') || 'none';
        var pA = hs.getPropertyValue('--dlg-glow-prism-a') || 'transparent';
        var pB = hs.getPropertyValue('--dlg-glow-prism-b') || 'transparent';
        var rb = hs.getPropertyValue('--dlg-glow-rainbow') || 'none';
        var core = hs.getPropertyValue('--dlg-glow-core') || 'rgba(200,216,238,0.20)';
        var mid = hs.getPropertyValue('--dlg-glow-mid') || 'rgba(150,172,205,0.085)';
        var edge = hs.getPropertyValue('--dlg-glow-edge') || 'rgba(255,255,255,0)';
        var bg = rb + ',' +
          grad + ',' +
          'radial-gradient(circle at 32% 30%, ' + pA + ' 0%, transparent 55%),' +
          'radial-gradient(circle at 68% 72%, ' + pB + ' 0%, transparent 55%),' +
          'radial-gradient(circle,' + core + ' 0%,' + mid + ' 55%,' + edge + ' 100%)';
        for (var i = 0; i < dots.length; i += 1) {
          // 用 setProperty(..., 'important') 强制内联 background-image，
          // 压过宿主任何全局 CSS 对光晕点的 background 覆盖；
          // 同时清掉简写 background，避免两者打架。
          dots[i].style.setProperty('background-image', bg, 'important');
          dots[i].style.setProperty('background', 'none', 'important');
          dots[i].style.setProperty('background-image', bg, 'important');
        }
      } catch (_) { /* 沙箱/无 DOM 时忽略 */ }
    }

    /**
     * 选色/样式切换的轻量路径：只重算光效颜色相关变量（光晕主色、
     * 七彩/渐变层、液态材质），不跑全量 applyVars —— 避开
     * writeVars/writeInlineTokens/getComputedStyle 等重操作。
     * 拖取色器、切模式、调实透都走这里，即时且流畅。
     */
    function updateGlowColors(html, body, state) {
      // 回退：固定默认模式，不再写 prism/custom 标记（避免 halo 放大规则生效）。
      try { html.setAttribute('data-dlg-mode', 'default'); } catch (_) { /* 忽略 */ }
      var dark = html.hasAttribute('data-ds-dark-theme') || body.hasAttribute('data-ds-dark-theme');
      writeLiquidColors(html.style, state);
      writeGlowColors(html.style, state, dark);
      paintDotsConcrete(html, state, dark);
    }

    function readUrlOverrides() {
      var out = {};
      try {
        if (typeof location === 'undefined' || !location.search) return out;
        var params = new URLSearchParams(location.search);
        for (var key in DEFAULTS) {
          if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) continue;
          var raw = params.get('lg-' + key);
          if (raw === null) continue;
          var num = Number(raw);
          if (isFinite(num)) {
            out[key] = num;
          } else if (!LIMITS[key]) {
            // 字符串参数（lg-glowStyle=prism、lg-glowColor=%2388ccff）直通
            out[key] = raw;
          }
        }
      } catch (_) { /* 没有 location / URLSearchParams 就当没有覆盖 */ }
      return out;
    }

    function clamp(key, value) {
      var limit = LIMITS[key];
      // 字符串参数（glowStyle / glowColor / glowColorEnd）没有数值区间，直通不做数字钳制。
      if (typeof value === 'string' && !limit) return value;
      // 布尔参数（glowGradient）直接布尔化。
      if (typeof DEFAULTS[key] === 'boolean') return !!value;
      var num = Number(value);
      if (!isFinite(num)) return DEFAULTS[key];
      if (!limit) return num;
      if (num < limit[0]) return limit[0];
      if (num > limit[1]) return limit[1];
      return num;
    }

    function createStore() {
      var state = {};
      var key;
      for (key in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) state[key] = DEFAULTS[key];
      }
      var overrides = readUrlOverrides();
      for (key in overrides) {
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
          state[key] = clamp(key, overrides[key]);
        }
      }

      var listeners = [];
      return {
        get: function () {
          var copy = {};
          for (var k in state) {
            if (Object.prototype.hasOwnProperty.call(state, k)) copy[k] = state[k];
          }
          return copy;
        },
        set: function (name, value) {
          if (!Object.prototype.hasOwnProperty.call(DEFAULTS, name)) return;
          var next = clamp(name, value);
          if (state[name] === next) return;
          state[name] = next;
          for (var i = 0; i < listeners.length; i += 1) {
            try { listeners[i](name, next); } catch (_) { /* 单个监听器失败不影响其它 */ }
          }
        },
        patch: function (values) {
          if (!values) return;
          for (var k in values) {
            if (Object.prototype.hasOwnProperty.call(values, k)) this.set(k, values[k]);
          }
        },
        reset: function () {
          for (var k in DEFAULTS) {
            if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) this.set(k, DEFAULTS[k]);
          }
        },
        subscribe: function (fn) {
          listeners.push(fn);
          return function () {
            var at = listeners.indexOf(fn);
            if (at >= 0) listeners.splice(at, 1);
          };
        }
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // 样式表
    // ─────────────────────────────────────────────────────────────────

    function buildCss() {
      var root = 'body[' + ROOT_ATTR + ']';
      var motion = root + '[' + MOTION_ATTR + '="on"]';

      // 玻璃要贴在哪几个面。
      var surfaceHead = 'html[' + ROOT_ATTR + '] ';
      var surfaceBody = root + ' ';

      // 令牌覆盖的目标。
      //
      // 主战场是 JS 内联写入（见 inlineTokens），因为内联样式天然压过任何
      // 样式表规则，app 再怎么写都盖不住。这里样式表里的令牌声明保留作兜底：
      // 万一内联写入失败（受限环境等），至少还有一层 !important 规则顶着。
      //
      // 每个目标都单独带 :not() / [data-ds-dark-theme] —— 不能只写在整串
      // 选择器的末尾，那样只有最后一个目标会生效（曾经踩过这个坑）。
      function lightScope(sel) { return sel + ':not([data-ds-dark-theme])'; }
      function darkScope(sel) { return sel + '[data-ds-dark-theme]'; }
      var tokenTargets = [
        'html[' + ROOT_ATTR + ']',
        root
      ];

      /** 令牌声明，统一带 !important（必须压过 app 在更内层的定义）。 */
      function token(name, value) {
        return '  ' + name + ':' + value + ' !important;';
      }

      var tokenRules = [
        token('--dsw-alias-bg-base', 'var(--dlg-base-L)'),
        token('--dsw-alias-bg-layer-1', 'var(--dlg-base-L)'),
        token('--dsw-alias-bg-layer-2', 'var(--dlg-glass-L)'),
        token('--dsw-alias-bg-layer-3', 'var(--dlg-glass-L)'),
        token('--dsw-alias-bg-overlay', 'var(--dlg-glass-L)'),
        token('--dsw-specific-sidebar-fill', 'var(--dlg-glass-L)'),
        token('--dsw-alias-border-l1', 'var(--dlg-border-light)'),
        token('--dsw-alias-border-l2', 'var(--dlg-border-strong)')
      ];

      return [
        '/* ── 参数层：数值由 JS 写进 html/body 的内联自定义属性 ─────────── */',
        'html[' + ROOT_ATTR + '], ' + root + '{',
        '  --dlg-blur:20px;',
        '  --dlg-saturate:1.6;',
        '  --dlg-glass-light:rgba(243,248,255,0.6);',
        '  --dlg-glass-dark:rgba(14,18,28,0.35);',
        '  --dlg-base-light:rgba(255,255,255,0.9);',
        '  --dlg-base-dark:rgba(9,12,20,0.86);',
        '  --dlg-mask-light:rgba(246,248,252,0.94);',
        '  --dlg-mask-dark:rgba(4,6,12,0.94);',
        '  --dlg-body-light:rgba(255,255,255,0.30);',
        '  --dlg-body-dark:rgba(9,12,20,0.42);',
        '  --dlg-glass-accent-light:rgba(140,170,255,0.50);',
        '  --dlg-glass-accent-dark:rgba(110,140,255,0.42);',
        '  --dlg-btn-glass-light:rgba(243,248,255,0.54);',
        '  --dlg-btn-glass-dark:rgba(20,26,40,0.40);',
        '  --dlg-btn-glass-icon-light:rgba(243,248,255,0.26);',
        '  --dlg-btn-glass-icon-dark:rgba(20,26,40,0.18);',
        '  --dlg-lux-y:20%;',
        '  --dlg-rim-lux:rgba(255,255,255,0);',
        '  --dlg-scroll-y:0;',
        '  --dlg-glow-core:rgba(200,216,238,0.15);',
        '  --dlg-glow-mid:rgba(150,172,205,0.06);',
        '  --dlg-glow-edge:rgba(255,255,255,0);',
        '  --dlg-liquid-sheen:rgba(255,255,255,0.10);',
        '  --dlg-liquid-spot:rgba(255,255,255,0.30);',
        '  --dlg-liquid-rim:rgba(255,255,255,0.55);',
        '  --dlg-liquid-rim-top:rgba(255,255,255,0.80);',
        '  --dlg-liquid-fill:0.65;',
        '  --dlg-glow-prism-a:transparent;',
        '  --dlg-glow-prism-b:transparent;',
        '  --dlg-glow-rainbow:none;',
        '  --dlg-glow-grad:none;',
        '  --dlg-border-light:rgba(0,0,0,0.09);',
        '  --dlg-border-strong:rgba(0,0,0,0.15);',
        '  --dlg-rim-light:rgba(255,255,255,0.42);',
        '  --dlg-rim-top-light:rgba(255,255,255,0.55);',
        '  --dlg-rim-dark:rgba(255,255,255,0.18);',
        '  --dlg-rim-top-dark:rgba(255,255,255,0.12);',
        '  --dlg-rim-scroll-light:rgba(255,255,255,0.34);',
        '  --dlg-rim-scroll-top-light:rgba(255,255,255,0.44);',
        '  --dlg-sheen-light:rgba(255,255,255,0.16);',
        '  --dlg-sheen-light-mid:rgba(255,255,255,0.05);',
        '  --dlg-sheen-dark:rgba(150,190,255,0.14);',
        '  --dlg-sheen-dark-mid:rgba(150,190,255,0.04);',
        '  --dlg-light-ink:#ffffff;',
        '  --dlg-light-ink-2:rgba(255,255,255,0.84);',
        '  --dlg-light-ink-3:rgba(255,255,255,0.68);',
        '  --dlg-px:18%;',
        '  --dlg-py:0%;',
        '}',
        '',

        '/* ── 环境背景：玻璃要有东西可折射 ─────────────────────────────────',
        '   Windows 窗口不透明、DSH 默认无壁纸：半透明面板叠在纯白/纯黑',
        '   画布上等于没效果（这就是此前「运行了但看不见」的根因）。',
        '   壁纸本体（渐变 + 流动动画）由 JS 内联写入 html —— 写之前先检查',
        '   页面是否已有别的壁纸（dsh-web-ui 等第三方可能自带），有就让位、',
        '   没有才铺我们的。body 压到低透明度，让壁纸透过玻璃面板显示出来。*/',
        'html[' + ROOT_ATTR + ']{',
        '  background-color:#e8ecf6;',
        '}',
        'html[' + ROOT_ATTR + '][data-dlg-wallpaper-own]{',
        '  background-attachment:fixed;',
        '  background-size:200% 200%;',
        '}',
        '@keyframes dlg-ambient-drift{from{background-position:0% 0%}to{background-position:100% 100%}}',
        'body[' + ROOT_ATTR + ']{background-color:var(--dlg-body-light);}',
        'body[' + ROOT_ATTR + '][data-ds-dark-theme]{background-color:var(--dlg-body-dark);}',
        '@media (prefers-reduced-motion: reduce){html[' + ROOT_ATTR + ']{animation:none !important;}}',
        '',

        '/* ── 浅色：玻璃 60% ───────────────────────────────────────────── */',
        tokenTargets.map(lightScope).join(','),
        '{',
        '  --dlg-base-L:var(--dlg-base-light);',
        '  --dlg-glass-L:var(--dlg-glass-light);',
        '  --dlg-mask-L:var(--dlg-mask-light);',
        '  --dlg-btn-glass-L:var(--dlg-btn-glass-light);',
        '  --dlg-btn-glass-icon-L:var(--dlg-btn-glass-icon-light);',
        '  --dlg-glass-accent-L:var(--dlg-glass-accent-light);'
      ]
        .concat(tokenRules)
        .concat([
          '}',
          '',

          '/* ── 深色：玻璃 35% + 正文提亮，保证文字清晰 ──────────────────── */',
          tokenTargets.map(darkScope).join(','),
          '{',
          '  --dlg-base-L:var(--dlg-base-dark);',
          '  --dlg-glass-L:var(--dlg-glass-dark);',
          '  --dlg-mask-L:var(--dlg-mask-dark);',
          '  --dlg-btn-glass-L:var(--dlg-btn-glass-dark);',
          '  --dlg-btn-glass-icon-L:var(--dlg-btn-glass-icon-dark);',
          '  --dlg-glass-accent-L:var(--dlg-glass-accent-dark);',
          '  --dlg-border-light:rgba(255,255,255,0.14);',
          '  --dlg-border-strong:rgba(255,255,255,0.22);'
        ])
        .concat([
          token('--dsw-alias-label-primary', 'var(--dlg-light-ink)'),
          token('--dsw-alias-label-secondary', 'var(--dlg-light-ink-2)'),
          token('--dsw-alias-label-tertiary', 'var(--dlg-light-ink-3)')
        ])
        .concat(tokenRules)
        .concat([
          '}',
          '',

          '/* ── 玻璃材质：实时模糊 + 1px 超细高光描边 + 指针跟随的径向折射 ──',
          '   真实面板选择器（DSH 0.2.0-rc.2 实测，前端不存在 data-slot，',
          '   旧选择器全军覆没）：.pI_x6G_sidebarCol=侧栏、.pI_x6G_centerCol=',
          '   主栏、[role="dialog"/"menu"] 与 popper 容器=浮层。           */',
          '@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) ){',
          '  ' + surfaceHead + ':is(.pI_x6G_sidebarCol,[role="dialog"][aria-modal="true"],[role="menu"],[data-menu-material],[data-radix-popper-content-wrapper] > *),',
          '  ' + surfaceBody + ':is(.pI_x6G_sidebarCol,[role="dialog"][aria-modal="true"],[role="menu"],[data-menu-material],[data-radix-popper-content-wrapper] > *){',
          '    -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '    backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '    background-image:',
          '      radial-gradient(150% 100% at 50% var(--dlg-lux-y), var(--dlg-sheen-light) 0%, transparent 55%),',
          '      radial-gradient(',
          '        120% 90% at var(--dlg-px) var(--dlg-py),',
          '        var(--dlg-sheen-light) 0%,',
          '        var(--dlg-sheen-light-mid) 38%,',
          '        transparent 72%',
          '      );',
          '    background-repeat:no-repeat;',
          '    box-shadow:',
          '      inset 0 0 0 1px var(--dlg-rim-light),',
          '      inset 0 1px 0 var(--dlg-rim-top-light),',
          '      inset 0 0 0 1px var(--dlg-rim-lux);',
          '  }',
          '  html[' + ROOT_ATTR + '][data-ds-dark-theme] :is(.pI_x6G_sidebarCol,[role="dialog"][aria-modal="true"],[role="menu"],[data-menu-material]),',
          '  ' + root + '[data-ds-dark-theme] :is(.pI_x6G_sidebarCol,[role="dialog"][aria-modal="true"],[role="menu"],[data-menu-material]){',
          '    background-image:',
          '      radial-gradient(150% 100% at 50% var(--dlg-lux-y), var(--dlg-sheen-dark) 0%, transparent 55%),',
          '      radial-gradient(',
          '        120% 90% at var(--dlg-px) var(--dlg-py),',
          '        var(--dlg-sheen-dark) 0%,',
          '        var(--dlg-sheen-dark-mid) 40%,',
          '        transparent 74%',
          '      );',
          '    box-shadow:',
          '      inset 0 0 0 1px var(--dlg-rim-dark),',
          '      inset 0 1px 0 var(--dlg-rim-top-dark),',
          '      inset 0 0 0 1px var(--dlg-rim-lux);',
          '  }',
          '}',
          '',

          '/* ── 主栏：内容底色 90% 已够清晰，再上模糊只费性能没观感；',
          '   只给滚动/指针跟随的光影与 1px 描边 ───────────────────────── */',
          surfaceHead + ':is(.pI_x6G_centerCol),',
          surfaceBody + ':is(.pI_x6G_centerCol){',
          '  background-image:',
          '    radial-gradient(150% 100% at 50% var(--dlg-lux-y), var(--dlg-sheen-light) 0%, transparent 55%),',
          '    radial-gradient(',
          '      120% 90% at var(--dlg-px) var(--dlg-py),',
          '      var(--dlg-sheen-light) 0%,',
          '      var(--dlg-sheen-light-mid) 38%,',
          '      transparent 72%',
          '    );',
          '  background-repeat:no-repeat;',
          '  box-shadow:',
          '    inset 0 0 0 1px var(--dlg-rim-light),',
          '    inset 0 1px 0 var(--dlg-rim-top-light),',
          '    inset 0 0 0 1px var(--dlg-rim-lux);',
          '}',
          'html[' + ROOT_ATTR + '][data-ds-dark-theme] :is(.pI_x6G_centerCol),',
          root + '[data-ds-dark-theme] :is(.pI_x6G_centerCol){',
          '  background-image:',
          '    radial-gradient(150% 100% at 50% var(--dlg-lux-y), var(--dlg-sheen-dark) 0%, transparent 55%),',
          '    radial-gradient(',
          '      120% 90% at var(--dlg-px) var(--dlg-py),',
          '      var(--dlg-sheen-dark) 0%,',
          '      var(--dlg-sheen-dark-mid) 40%,',
          '      transparent 74%',
          '    );',
          '  box-shadow:',
          '    inset 0 0 0 1px var(--dlg-rim-dark),',
          '    inset 0 1px 0 var(--dlg-rim-top-dark),',
          '    inset 0 0 0 1px var(--dlg-rim-lux);',
          '}',
          '',

          '/* ── 所有按钮：WWDC25 液态玻璃（类名经真实 DOM 探测）────────────',
          '   透明底按钮 → 直接玻璃化；带实心底的品牌按钮（新会话/发送/添加文件）',
          '   保留自身色相保证可读、只叠玻璃层；图标按钮静止时轻玻璃、',
          '   悬停/按下加深。检测到第三方插件时（data-dlg-safe）对它们的',
          '   子树按钮让位，见安全模式段。                                    */',
          '@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) ){',
          '  ' + surfaceHead + 'button:not([class*="iconButton"]):not([class*="newSession"]):not([class*="uV2eYG"]),',
          '  ' + surfaceBody + 'button:not([class*="iconButton"]):not([class*="newSession"]):not([class*="uV2eYG"]){',
          '    -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '    backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '    background-color:var(--dlg-btn-glass-L);',
          '    box-shadow:',
          '      inset 0 0 0 1px var(--dlg-rim-light),',
          '      inset 0 1px 0 var(--dlg-rim-top-light);',
          '  }',
          '  ' + surfaceHead + 'button[class*="newSession"], ' + surfaceHead + 'button[class*="uV2eYG"],',
          '  ' + surfaceBody + 'button[class*="newSession"], ' + surfaceBody + 'button[class*="uV2eYG"]{',
          '    -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '    backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '    background-image:',
          '      radial-gradient(150% 100% at 50% var(--dlg-lux-y), var(--dlg-sheen-light) 0%, transparent 55%),',
          '      radial-gradient(120% 90% at var(--dlg-px) var(--dlg-py), var(--dlg-sheen-light) 0%, transparent 70%);',
          '    background-repeat:no-repeat;',
          '    box-shadow:',
          '      inset 0 0 0 1px var(--dlg-rim-light),',
          '      inset 0 1px 0 var(--dlg-rim-top-light);',
          '  }',
          '  ' + surfaceHead + 'button[class*="iconButton"],',
          '  ' + surfaceBody + 'button[class*="iconButton"]{',
          '    -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '    backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '    background-color:var(--dlg-btn-glass-icon-L);',
          '    box-shadow:inset 0 0 0 1px var(--dlg-rim-light);',
          '  }',
          '  ' + surfaceHead + 'button[class*="iconButton"]:hover, ' + surfaceHead + 'button[class*="iconButton"]:focus-visible, ' + surfaceHead + 'button[class*="iconButton"].dlg-press,',
          '  ' + surfaceBody + 'button[class*="iconButton"]:hover, ' + surfaceBody + 'button[class*="iconButton"]:focus-visible, ' + surfaceBody + 'button[class*="iconButton"].dlg-press{',
          '    background-color:var(--dlg-btn-glass-L);',
          '    box-shadow:',
          '      inset 0 0 0 1px var(--dlg-rim-light),',
          '      inset 0 1px 0 var(--dlg-rim-top-light);',
          '  }',
          '  html[' + ROOT_ATTR + '][data-ds-dark-theme] button:not([class*="iconButton"]):not([class*="newSession"]):not([class*="uV2eYG"]),',
          '  ' + root + '[data-ds-dark-theme] button:not([class*="iconButton"]):not([class*="newSession"]):not([class*="uV2eYG"]),',
          '  html[' + ROOT_ATTR + '][data-ds-dark-theme] button[class*="newSession"], ' + root + '[data-ds-dark-theme] button[class*="newSession"],',
          '  html[' + ROOT_ATTR + '][data-ds-dark-theme] button[class*="uV2eYG"], ' + root + '[data-ds-dark-theme] button[class*="uV2eYG"],',
          '  html[' + ROOT_ATTR + '][data-ds-dark-theme] button[class*="iconButton"], ' + root + '[data-ds-dark-theme] button[class*="iconButton"]{',
          '    background-image:',
          '      radial-gradient(150% 100% at 50% var(--dlg-lux-y), var(--dlg-sheen-dark) 0%, transparent 55%),',
          '      radial-gradient(120% 90% at var(--dlg-px) var(--dlg-py), var(--dlg-sheen-dark) 0%, transparent 70%);',
          '    box-shadow:',
          '      inset 0 0 0 1px var(--dlg-rim-dark),',
          '      inset 0 1px 0 var(--dlg-rim-top-dark);',
          '  }',
          '}',

          '/* ── iOS 26 Liquid Glass：按钮 hover 实时液态玻璃 ────────────────',
          '   每个按钮叠一层液态玻璃（::after，pointer-events:none 不挡点击）：',
          '   跟随指针的高光斑（--dlg-glow-x / --dlg-glow-y 由 JS 按指针实时',
          '   写入按钮内联样式）+ 玻璃顶部高光弧 + 边缘内亮 + 底部内影（厚度），',
          '   hover/聚焦时 opacity 0→1 平滑"实时渲染"，plus-lighter 混合只加光、',
          '   文字始终清晰。这是"全真液态玻璃档"：按钮本体即玻璃，指针一到',
          '   光效即现。                                    */',
          '  ' + surfaceHead + 'button::after,',
          '  ' + surfaceBody + 'button::after{',
          '    content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;',
          '    opacity:0;transition:opacity .3s cubic-bezier(.22,1,.36,1);',
          '    background:',
          '      var(--dlg-glow-rainbow, none),',
          '      var(--dlg-glow-grad, none),',
          '      radial-gradient(85% 85% at calc(var(--dlg-glow-x,50%) + 7%) calc(var(--dlg-glow-y,0%) - 7%), var(--dlg-glow-prism-b, transparent) 0%, transparent 58%),',
          '      radial-gradient(85% 85% at calc(var(--dlg-glow-x,50%) - 7%) calc(var(--dlg-glow-y,0%) + 7%), var(--dlg-glow-prism-a, transparent) 0%, transparent 58%),',
          '      radial-gradient(130% 120% at var(--dlg-glow-x,50%) var(--dlg-glow-y,0%), var(--dlg-liquid-spot) 0%, rgba(255,255,255,0.05) 42%, transparent 74%),',
          '      linear-gradient(180deg, var(--dlg-liquid-rim-top) 0%, var(--dlg-liquid-sheen) 38%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.14) 100%),',
          '      radial-gradient(150% 70% at 50% -12%, var(--dlg-liquid-sheen) 0%, transparent 62%);',
          '    mix-blend-mode:plus-lighter;',
          '  }',
          '  ' + surfaceHead + 'button:hover::after, ' + surfaceHead + 'button:focus-visible::after, ' + surfaceHead + 'button.dlg-press::after,',
          '  ' + surfaceBody + 'button:hover::after, ' + surfaceBody + 'button:focus-visible::after, ' + surfaceBody + 'button.dlg-press::after{',
          '    opacity:var(--dlg-liquid-fill);',
          '  }',
          '  html[' + ROOT_ATTR + '][data-dlg-safe="on"] [class*="dsh-web-ui"] button::after,',
          '  ' + root + '[data-dlg-safe="on"] [class*="dsh-web-ui"] button::after,',
          '  html[' + ROOT_ATTR + '][data-dlg-safe="on"] [class*="better-sidebar"] button::after,',
          '  ' + root + '[data-dlg-safe="on"] [class*="better-sidebar"] button::after{',
          '    opacity:0 !important;',
          '  }',

          '/* ── Windows 标题栏：伪元素不能进 :is()，独立一条模糊规则 ─────── */',
          '@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) ){',
          '  ' + surfaceHead + '[data-windows-titlebar] .pI_x6G_frame:before,',
          '  ' + root + ' [data-windows-titlebar] .pI_x6G_frame:before{',
          '    -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '    backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  }',
          '}',
          '',

          '/* ── 弹窗内容：压到能看清文字（0.94 遮罩），同时保留玻璃观感 ────── */',
          surfaceHead + ':is([role="dialog"][aria-modal="true"]) > *,',
          surfaceBody + ':is([role="dialog"][aria-modal="true"]) > *{',
          '  background-color:var(--dlg-mask-L);',
          '}',
          '',

          '/* ── 交互动效：点击流动形变 + 滚动光影偏移（WWDC25 丝滑手感）─────',
          '   .dlg-press 由 JS 在 pointerdown 时加到命中的控件上，走一段',
          '   320ms 的「压下去-弹回来」流动形变；滚动时 --dlg-lux-y 随',
          '   滚动位置滑动，玻璃上的光带跟着内容一起偏移。                  */',
          motion + ' :is(button,[role="button"],[role="menuitem"],[role="tab"],[role="treeitem"]){',
          '  transition:transform 160ms cubic-bezier(.22,.78,.2,1),',
          '             box-shadow 160ms cubic-bezier(.22,.78,.2,1),',
          '             background-color 160ms cubic-bezier(.22,.78,.2,1);',
          '}',
          motion + ' :is(button,[role="button"],[role="menuitem"],[role="tab"],[role="treeitem"]):active{',
          '  transform:scale(.978) translateY(.5px);',
          '}',
          motion + ' :is(button,[role="button"],[role="menuitem"],[role="tab"],[role="treeitem"]).dlg-press{',
          '  animation:dlg-press-flow 320ms cubic-bezier(.22,.78,.2,1);',
          '}',
          '@keyframes dlg-press-flow{',
          '  0%{transform:scale(1);filter:brightness(1)}',
          '  35%{transform:scale(.976) translateY(.5px);filter:brightness(1.07)}',
          '  100%{transform:scale(1);filter:brightness(1)}',
          '}',
          motion + '[data-dlg-scrolling] :is(.pI_x6G_sidebarCol,[role="menu"],[role="dialog"]){',
          '  box-shadow:',
          '    inset 0 0 0 1px var(--dlg-rim-scroll-light),',
          '    inset 0 1px 0 var(--dlg-rim-scroll-top-light),',
          '    0 10px 30px rgba(0,0,0,0.12);',
          '}',
          '',

          '/* ── 无障碍：系统要求减少动态效果时全部关掉 ───────────────────── */',
          '@media (prefers-reduced-motion: reduce){',
          '  ' + root + ' :is(button,[role="button"],[role="menuitem"],[role="tab"],[role="treeitem"]),',
          '  ' + root + ' .pI_x6G_sidebarCol,',
          '  ' + root + ' .pI_x6G_centerCol{',
          '    transition:none !important;',
          '    transform:none !important;',
          '    animation:none !important;',
          '  }',
          '}',

          '/* ── Q弹过渡：鼠标指向时弹性放大，离开/失焦时弹性回弹 ─────────── */',
          '/* 用苹果 overshoot 曲线 cubic-bezier(.34,1.56,.64,1)：进入与离开都带回弹感。*/',
          motion + ' :is(button,[role="button"],[role="menuitem"],[role="tab"],[role="switch"],[role="treeitem"]),',
          motion + ' input[type="button"],input[type="submit"],input[type="reset"],select{',
          '  transform:scale(1);',
          '  transition:transform .35s cubic-bezier(.34,1.56,.64,1);',
          '  will-change:transform;',
          '}',
          motion + ' :is(button,[role="button"],[role="menuitem"],[role="tab"],[role="switch"],[role="treeitem"]):hover,',
          motion + ' input[type="button"]:hover,input[type="submit"]:hover,input[type="reset"]:hover,select:hover{',
          '  transform:scale(1.04);',
          '}',
          motion + ' :is(button,[role="button"],[role="menuitem"],[role="tab"],[role="switch"],[role="treeitem"]):active,',
          motion + ' input[type="button"]:active,input[type="submit"]:active,input[type="reset"]:active,select:active{',
          '  transform:scale(.97);',
          '}',
          '',

          '/* ── 全局指针液态光效（macOS Sonoma 风格指针光晕）────────────────',
          '   光晕 = 纯 CSS 径向渐变（视觉上等效高斯模糊的柔和光斑），只用',
          '   transform/opacity 由合成器搬运 —— 全程不跑 filter:blur()，这是',
          '   60 帧锁 + CPU ≤5% 的关键。拖影是 0.3s 的历史采样幽灵点；',
          '   静止呼吸、点击脉冲都在 rAF 里算。叠在侧栏/标题栏上时自动隐藏。',
          '   颜色走 --dlg-glow-core/mid/edge，由 JS 按主题写成低饱和冷白/',
          '   淡银白，绝不出现高饱和色。容器 fixed + overflow:hidden，',
          '   光斑贴窗口边缘即被裁剪，不会溢出界面。                      */',
          '.dlg-glow-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;}',
          '.dlg-glow-layer .dlg-glow-dot{',
          '  position:absolute;left:0;top:0;border-radius:50%;pointer-events:none;',
          '  will-change:transform,opacity;mix-blend-mode:screen;',
          '  background:',
          '    var(--dlg-glow-rainbow, none),',
          '    var(--dlg-glow-grad, none),',
          '    radial-gradient(circle at 32% 30%, var(--dlg-glow-prism-a, transparent) 0%, transparent 55%),',
          '    radial-gradient(circle at 68% 72%, var(--dlg-glow-prism-b, transparent) 0%, transparent 55%),',
          '    radial-gradient(circle,var(--dlg-glow-core) 0%,var(--dlg-glow-mid) 55%,var(--dlg-glow-edge) 100%);',
          '  opacity:0;transform:translate3d(-1000px,-1000px,0);',
          '}',
          // 彩色折射/自定义模式：主光晕放大 30%，让七彩/自定义色更醒目
          //（拖影保持原尺寸，避免视觉混乱）。由 JS 写 html[data-dlg-mode]。
          'html[data-dlg-mode="prism"] .dlg-glow-layer .dlg-glow-halo,',
          'html[data-dlg-mode="custom"] .dlg-glow-layer .dlg-glow-halo{',
          '  width:442px !important;height:442px !important;',
          '}',

          '/* ── JS 装饰的浮层玻璃：透明底浮层（菜单/popper）补玻璃，',
          '   已有不透明设计的浮层保持原样（尊重第三方插件）────────────── */',
          '.dlg-js-glass{',
          '  background-color:var(--dlg-glass-L) !important;',
          '  -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  box-shadow:',
          '    inset 0 0 0 1px var(--dlg-rim-light),',
          '    inset 0 1px 0 var(--dlg-rim-top-light);',
          '}',

          '/* ── 光效样式设置按键 + 面板（插件自绘 UI，同样走玻璃/液态光效）─',
          '   侧栏底部"设置"旁常驻一个光效按键（.dlg-style-fab），打开 DSH',
          '   设置面板时也会在面板内注入同名按键；点按弹出玻璃面板，可切换',
          '   光效样式（当前/彩色折射/自定义色）+ 液态层实透滑块。按键本身是',
          '   button，自动获得液态 hover 光效与全局光晕。                     */',
          'html[' + ROOT_ATTR + '] .dlg-style-fab,',
          '  ' + root + ' .dlg-style-fab{',
          '  position:relative;display:flex;align-items:center;justify-content:center;',
          '  width:32px;height:32px;margin:4px auto;padding:0;border-radius:10px;cursor:pointer;flex:none;',
          '  border:1px solid var(--dlg-rim-light);background:var(--dlg-btn-glass-L);color:var(--dlg-light-ink);',
          '  -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  box-shadow:inset 0 0 0 1px var(--dlg-rim-light), inset 0 1px 0 var(--dlg-rim-top-light);',
          '}',
          'html[' + ROOT_ATTR + '][data-ds-dark-theme] .dlg-style-fab,',
          '  ' + root + '[data-ds-dark-theme] .dlg-style-fab{',
          '  border-color:var(--dlg-rim-dark);color:#fff;',
          '  box-shadow:inset 0 0 0 1px var(--dlg-rim-dark), inset 0 1px 0 var(--dlg-rim-top-dark);',
          '}',
          '.dlg-style-fab svg{width:16px;height:16px;display:block;pointer-events:none;}',
          'html[' + ROOT_ATTR + '] #dsh-liquid-glass/style-panel,',
          '  ' + root + ' #dsh-liquid-glass/style-panel{',
          '  position:fixed;z-index:2147482900;min-width:252px;padding:14px 16px;border-radius:18px;',
          '  background:var(--dlg-glass-L);color:var(--dlg-light-ink);font-size:13px;line-height:1.5;',
          '  -webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);',
          '  box-shadow:inset 0 0 0 1px var(--dlg-rim-light), inset 0 1px 0 var(--dlg-rim-top-light), 0 12px 40px rgba(0,0,0,0.35);',
          '}',
          'html[' + ROOT_ATTR + '][data-ds-dark-theme] #dsh-liquid-glass/style-panel,',
          '  ' + root + '[data-ds-dark-theme] #dsh-liquid-glass/style-panel{',
          '  color:#fff;box-shadow:inset 0 0 0 1px var(--dlg-rim-dark), inset 0 1px 0 var(--dlg-rim-top-dark), 0 12px 40px rgba(0,0,0,0.6);',
          '}',
          '.dlg-style-panel-title{font-weight:600;margin-bottom:10px;}',
          '.dlg-style-row{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;}',
          'html[' + ROOT_ATTR + '] .dlg-style-row button,',
          '  ' + root + ' .dlg-style-row button{',
          '  flex:1;min-width:70px;padding:6px 8px;border-radius:10px;cursor:pointer;font-size:12px;color:inherit;',
          '  border:1px solid var(--dlg-rim-light);background:var(--dlg-btn-glass-L);',
          '  -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '}',
          'html[' + ROOT_ATTR + '][data-ds-dark-theme] .dlg-style-row button,',
          '  ' + root + '[data-ds-dark-theme] .dlg-style-row button{',
          '  border-color:var(--dlg-rim-dark);',
          '}',
          'html[' + ROOT_ATTR + '] .dlg-style-row button.dlg-active,',
          '  ' + root + ' .dlg-style-row button.dlg-active{',
          '  border-color:var(--dlg-glass-accent-L);background:var(--dlg-glass-accent-L);color:#fff;',
          '}',
          '.dlg-style-custom{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;}',
          '.dlg-style-custom input[type="color"]{width:34px;height:26px;padding:0;border:1px solid var(--dlg-rim-light);border-radius:8px;background:transparent;cursor:pointer;}',
          'html[' + ROOT_ATTR + '] .dlg-style-custom .dlg-style-grad-toggle,',
          '  ' + root + ' .dlg-style-custom .dlg-style-grad-toggle{',
          '  padding:5px 10px;border-radius:10px;cursor:pointer;font-size:12px;color:inherit;',
          '  border:1px solid var(--dlg-rim-light);background:var(--dlg-btn-glass-L);',
          '  -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '}',
          'html[' + ROOT_ATTR + '][data-ds-dark-theme] .dlg-style-custom .dlg-style-grad-toggle,',
          '  ' + root + '[data-ds-dark-theme] .dlg-style-custom .dlg-style-grad-toggle{',
          '  border-color:var(--dlg-rim-dark);',
          '}',
          'html[' + ROOT_ATTR + '] .dlg-style-custom .dlg-style-grad-toggle.dlg-active,',
          '  ' + root + ' .dlg-style-custom .dlg-style-grad-toggle.dlg-active{',
          '  border-color:var(--dlg-glass-accent-L);background:var(--dlg-glass-accent-L);color:#fff;',
          '}',
          '.dlg-style-custom .dlg-style-color-end{display:none;align-items:center;gap:6px;}',
          '.dlg-style-custom .dlg-style-color-end input[type="color"]{width:34px;height:26px;padding:0;border:1px solid var(--dlg-rim-light);border-radius:8px;background:transparent;cursor:pointer;}',
          '.dlg-style-slider{display:flex;align-items:center;gap:8px;margin-bottom:10px;}',
          '.dlg-style-slider input[type="range"]{flex:1;accent-color:#3b82f6;}',
          '.dlg-style-slider .dlg-style-val{min-width:44px;text-align:right;opacity:0.85;}',
          'html[' + ROOT_ATTR + '] .dlg-style-close,',
          '  ' + root + ' .dlg-style-close{',
          '  width:100%;padding:6px 10px;border-radius:10px;cursor:pointer;font-size:12px;color:inherit;',
          '  border:1px solid var(--dlg-rim-light);background:var(--dlg-btn-glass-L);',
          '  -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '}',
          'html[' + ROOT_ATTR + '][data-ds-dark-theme] .dlg-style-close,',
          '  ' + root + '[data-ds-dark-theme] .dlg-style-close{',
          '  border-color:var(--dlg-rim-dark);',
          '}',
          // 确认应用按钮（同款玻璃液态光效，强调色）
          'html[' + ROOT_ATTR + '] .dlg-style-confirm,',
          '  ' + root + ' .dlg-style-confirm{',
          '  width:100%;padding:9px 12px;margin-top:6px;border-radius:12px;cursor:pointer;font-size:13px;',
          '  font-weight:600;color:#fff;border:1px solid var(--dlg-rim-light);',
          '  background:linear-gradient(135deg,rgba(59,130,246,0.55),rgba(139,92,246,0.55));',
          '  -webkit-backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  backdrop-filter:blur(var(--dlg-blur)) saturate(var(--dlg-saturate));',
          '  box-shadow:0 4px 14px rgba(59,130,246,0.28);',
          '}',
          'html[' + ROOT_ATTR + '][data-ds-dark-theme] .dlg-style-confirm,',
          '  ' + root + '[data-ds-dark-theme] .dlg-style-confirm{',
          '  border-color:var(--dlg-rim-dark);',
          '}',
          // 应用结果状态文本
          '.dlg-style-status{min-height:16px;margin:8px 0 2px;font-size:12px;opacity:0.9;text-align:center;}',
          '.dlg-style-status.dlg-status-ok{color:#34d399;}',
          '.dlg-style-status.dlg-status-bad{color:#f87171;}',

          '/* ── 安全模式：与已知同挂点插件共存时放弃会改几何的规则 ───────── */',
          root + '[data-dlg-safe="on"] :is(button,[role="button"],[role="menuitem"],[role="tab"]){',
          '  transform:none !important;',
          '}',
          root + '[data-dlg-safe="on"] :is([role="menu"],[data-menu-material]){',
          '  background-image:none;',
          '}',
          // 第三方插件子树内的按钮让位：不再叠加玻璃，保留对方自己的设计。
          root + '[data-dlg-safe="on"] [class*="dsh-web-ui"] button,',
          root + '[data-dlg-safe="on"] [class*="better-sidebar"] button,',
          root + '[data-dlg-safe="on"] [class*="dsh-web-ui"] [role="button"],',
          root + '[data-dlg-safe="on"] [class*="better-sidebar"] [role="button"],',
          root + '[data-dlg-safe="on"] [class*="dsh-web-ui"] [role="menuitem"],',
          root + '[data-dlg-safe="on"] [class*="better-sidebar"] [role="menuitem"]{',
          '  background-color:transparent !important;',
          '  background-image:none !important;',
          '  -webkit-backdrop-filter:none !important;',
          '  backdrop-filter:none !important;',
          '  box-shadow:none !important;',
          '}',
          ''
        ])
        .join('\n');
    }

    // ─────────────────────────────────────────────────────────────────
    // 插件主体
    // ─────────────────────────────────────────────────────────────────

    /** 把一份参数写进单个元素的自定义属性。 */
    function writeVars(el, state) {
      if (!el || !el.style) return;
      var style = el.style;
      // 玻璃带一点冷调（浅蓝白），更像真实玻璃的折射色；内容底色保持纯净白/深蓝黑。
      style.setProperty('--dlg-glass-light', rgba(243, 248, 255, state.glassLight));
      style.setProperty('--dlg-glass-dark', rgba(20, 26, 40, state.glassDark));
      style.setProperty('--dlg-base-light', rgba(255, 255, 255, state.baseLight));
      style.setProperty('--dlg-base-dark', rgba(9, 12, 20, state.baseDark));
      style.setProperty('--dlg-mask-light', rgba(246, 248, 252, Math.min(1, state.baseLight + 0.04)));
      style.setProperty('--dlg-mask-dark', rgba(4, 6, 12, Math.min(1, state.baseDark + 0.08)));
      style.setProperty('--dlg-body-light', rgba(255, 255, 255, 0.30));
      style.setProperty('--dlg-body-dark', rgba(9, 12, 20, 0.42));
      style.setProperty('--dlg-blur', state.blur + 'px');
      style.setProperty('--dlg-saturate', String(state.saturate));

      // 高光描边：把强度换算成最终 alpha，避免在 CSS 里写 calc()。
      style.setProperty('--dlg-rim-light', rgba(255, 255, 255, 0.42 * state.highlight));
      style.setProperty('--dlg-rim-top-light', rgba(255, 255, 255, 0.55 * state.highlight));
      style.setProperty('--dlg-rim-dark', rgba(255, 255, 255, 0.18 * state.highlight));
      style.setProperty('--dlg-rim-top-dark', rgba(255, 255, 255, 0.12 * state.highlight));
      style.setProperty('--dlg-rim-scroll-light', rgba(255, 255, 255, 0.34 * state.highlight));
      style.setProperty('--dlg-rim-scroll-top-light', rgba(255, 255, 255, 0.44 * state.highlight));

      // 径向折射光影：同样在 JS 里算好。
      style.setProperty('--dlg-sheen-light', rgba(255, 255, 255, 0.16 * state.refract));
      style.setProperty('--dlg-sheen-light-mid', rgba(255, 255, 255, 0.05 * state.refract));
      style.setProperty('--dlg-sheen-dark', rgba(150, 190, 255, 0.14 * state.refract));
      style.setProperty('--dlg-sheen-dark-mid', rgba(150, 190, 255, 0.04 * state.refract));

      // 按钮玻璃（WWDC25）：普通按钮比面板略实，图标按钮静止时更轻。
      style.setProperty('--dlg-glass-accent-light', rgba(140, 170, 255, 0.50 * state.refract));
      style.setProperty('--dlg-glass-accent-dark', rgba(110, 140, 255, 0.42 * state.refract));
      style.setProperty('--dlg-btn-glass-light', rgba(243, 248, 255, Math.min(1, state.glassLight * 0.9)));
      style.setProperty('--dlg-btn-glass-dark', rgba(20, 26, 40, Math.min(1, state.glassDark * 1.15)));
      style.setProperty('--dlg-btn-glass-icon-light', rgba(243, 248, 255, state.glassLight * 0.45));
      style.setProperty('--dlg-btn-glass-icon-dark', rgba(20, 26, 40, state.glassDark * 0.55));

      // 液态玻璃（iOS 26 Liquid Glass）材质 + 光效样式三模式颜色。
      // 订阅参数变化时也会重写（模式/实透即时生效）。
      // 只写与主题深浅无关的部分（html/body 两侧可安全同写）；
      // 光晕主色（--dlg-glow-core/mid）由 applyVars 按真实 dark 单独写。
      writeLiquidColors(style, state);

      style.setProperty('--dlg-border-light', rgba(0, 0, 0, 0.09));
      style.setProperty('--dlg-border-strong', rgba(0, 0, 0, 0.15));
    }

    /**
     * 内联写入的令牌名单。
     *
     * 这是本插件的**主战场**：把这些 `--dsw-alias-*` 令牌直接写成
     * html / body 的内联样式。内联样式天然压过任何样式表规则，
     * 所以 app 无论在哪一层重新定义令牌都盖不住它 —— 这是"必然生效"的
     * 一环，也是之前失败的根本原因（样式表规则被 app 在更内层的定义赢掉）。
     *
     * 代价：会改宿主节点的内联样式，因此写入前先备份原值，
     * 卸载时按备份精确还原（见 backupInline / restoreInline）。
     */
    var TOKEN_NAMES = [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-bg-layer-2',
      '--dsw-alias-bg-layer-3',
      '--dsw-alias-bg-overlay',
      '--dsw-specific-sidebar-fill',
      '--dsw-alias-border-l1',
      '--dsw-alias-border-l2'
    ];

    /** 深色模式下额外要提亮的正文颜色（保证低不透明度下文字仍清晰）。 */
    var DARK_INK_TOKENS = [
      ['--dsw-alias-label-primary', '#ffffff'],
      ['--dsw-alias-label-secondary', 'rgba(255,255,255,0.84)'],
      ['--dsw-alias-label-tertiary', 'rgba(255,255,255,0.68)']
    ];

    /** 需要在卸载时摘掉的「本插件自建」变量（不是宿主原有令牌）。 */
    var OWN_VAR_NAMES = VAR_NAMES.concat([]);

    /**
     * 备份元素上若干自定义属性的内联原值。
     * @returns {{el: HTMLElement, values: Object<string,string>}}
     */
    function backupInline(el, names) {
      var values = {};
      for (var i = 0; i < names.length; i += 1) {
        values[names[i]] = el.style.getPropertyValue(names[i]);
      }
      return { el: el, values: values };
    }

    /** 按备份还原：原值非空就恢复，原来为空就移除。 */
    function restoreInline(backup) {
      var el = backup.el;
      for (var name in backup.values) {
        if (!Object.prototype.hasOwnProperty.call(backup.values, name)) continue;
        var previous = backup.values[name];
        if (previous) el.style.setProperty(name, previous);
        else el.style.removeProperty(name);
      }
    }

    /** 令牌覆盖的集合（把宿主令牌指向本插件的中间变量）。 */
    function inlineTokens() {
      return [
        ['--dsw-alias-bg-base', 'var(--dlg-base-L)'],
        ['--dsw-alias-bg-layer-1', 'var(--dlg-base-L)'],
        ['--dsw-alias-bg-layer-2', 'var(--dlg-glass-L)'],
        ['--dsw-alias-bg-layer-3', 'var(--dlg-glass-L)'],
        ['--dsw-alias-bg-overlay', 'var(--dlg-glass-L)'],
        ['--dsw-specific-sidebar-fill', 'var(--dlg-glass-L)'],
        ['--dsw-alias-border-l1', 'var(--dlg-border-light)'],
        ['--dsw-alias-border-l2', 'var(--dlg-border-strong)']
      ];
    }

    /**
     * 把令牌与中间变量内联写到单个元素上。
     * @param {HTMLElement} el - html 或 body。
     * @param {boolean} dark - 当前是否深色模式。
     */
    function writeInlineTokens(el, dark) {
      if (!el || !el.style) return;
      var pairs = inlineTokens();
      var i;
      for (i = 0; i < pairs.length; i += 1) {
        el.style.setProperty(pairs[i][0], pairs[i][1]);
      }
      // 中间变量也要内联，否则令牌指向的目标在别的层解析不到值
      el.style.setProperty('--dlg-base-L', dark ? 'var(--dlg-base-dark)' : 'var(--dlg-base-light)');
      el.style.setProperty('--dlg-glass-L', dark ? 'var(--dlg-glass-dark)' : 'var(--dlg-glass-light)');
      el.style.setProperty('--dlg-mask-L', dark ? 'var(--dlg-mask-dark)' : 'var(--dlg-mask-light)');
      el.style.setProperty('--dlg-btn-glass-L', dark ? 'var(--dlg-btn-glass-dark)' : 'var(--dlg-btn-glass-light)');
      el.style.setProperty('--dlg-btn-glass-icon-L', dark ? 'var(--dlg-btn-glass-icon-dark)' : 'var(--dlg-btn-glass-icon-light)');
      el.style.setProperty('--dlg-glass-accent-L', dark ? 'var(--dlg-glass-accent-dark)' : 'var(--dlg-glass-accent-light)');

      if (dark) {
        for (i = 0; i < DARK_INK_TOKENS.length; i += 1) {
          el.style.setProperty(DARK_INK_TOKENS[i][0], DARK_INK_TOKENS[i][1]);
        }
      } else {
        // 浅色下不覆盖正文色，恢复宿主自己的值（由还原阶段处理）；
        // 这里只需移除本插件可能写过的深色值，让宿主令牌重新接管。
        for (i = 0; i < DARK_INK_TOKENS.length; i += 1) {
          el.style.removeProperty(DARK_INK_TOKENS[i][0]);
        }
      }
    }

    /**
     * 把参数写进 <html> 与 <body>：既写本插件的 `--dlg-*` 参数，
     * 也把宿主令牌内联覆盖掉。
     *
     * 写两处是有意的：DSH 的主题令牌注入目标会随版本变化，两边都写，
     * `var()` 无论从哪一层解析都能拿到值。
     */
    function applyVars(html, body, state) {
      writeVars(html, state);
      writeVars(body, state);

      // 深色下正文提亮，保证对比度
      var dark = html.hasAttribute('data-ds-dark-theme') || body.hasAttribute('data-ds-dark-theme');
      var targets = [html, body];
      for (var i = 0; i < targets.length; i += 1) {
        if (dark) {
          targets[i].style.setProperty('--dlg-border-light', rgba(255, 255, 255, 0.14));
          targets[i].style.setProperty('--dlg-border-strong', rgba(255, 255, 255, 0.22));
        }
      }

      // 主战场：内联覆盖宿主令牌
      writeInlineTokens(html, dark);
      writeInlineTokens(body, dark);

      // 环境背景（壁纸）：先看页面是否已有别的壁纸（dsh-web-ui 等第三方
      // 插件可能自带），有就让位、只负责让 body 保持半透明；没有才铺我们
      // 的渐变并挂上流动动画。深色标记在 body 上，CSS 选择器够不到 html，
      // 所以深色壁纸必须由 JS 内联写入。
      //
      // 用 data-dlg-wallpaper-own 标记「这张壁纸是我铺的」：主题切换会重跑
      // 本函数，没有标记时 computed background-image 会读到我上一轮铺的
      // 渐变、被误判成第三方壁纸而把自己的壁纸删掉（踩过这个坑）。
      var wallpaperOwned = html.hasAttribute('data-dlg-wallpaper-own');
      var inlineBg = '';
      try { inlineBg = html.style.getPropertyValue('background-image') || ''; } catch (_) { inlineBg = ''; }
      var existingBg = 'none';
      if (!wallpaperOwned && inlineBg === '') {
        try {
          if (typeof getComputedStyle === 'function') {
            existingBg = getComputedStyle(html).backgroundImage || 'none';
          }
        } catch (_) { existingBg = 'none'; }
      }
      var takeWallpaper = wallpaperOwned || inlineBg !== '' ||
        existingBg === 'none' || existingBg === 'initial' || existingBg === '';
      if (takeWallpaper) {
        html.setAttribute('data-dlg-wallpaper-own', '');
        html.style.setProperty('background-color', dark ? '#131b33' : '#e8ecf6');
        html.style.setProperty('background-image', dark ? DARK_AMBIENT : LIGHT_AMBIENT);
        html.style.setProperty('animation', 'dlg-ambient-drift 34s ease-in-out infinite alternate');
      } else {
        html.removeAttribute('data-dlg-wallpaper-own');
        html.style.removeProperty('background-image');
        html.style.removeProperty('background-color');
        html.style.removeProperty('animation');
      }
      // body 压到低透明度，让壁纸透过玻璃面板显示出来（无论壁纸是谁铺的）。
      body.style.setProperty('background-color', dark ? 'rgba(9,12,20,0.42)' : 'rgba(255,255,255,0.30)');

      // 滚动光影/点击流动的初始值。
      html.style.setProperty('--dlg-lux-y', '20%');
      html.style.setProperty('--dlg-rim-lux', 'rgba(255,255,255,0)');
      html.style.setProperty('--dlg-scroll-y', '0');

      // 指针光效 + 液态玻璃颜色：光晕主色按样式模式（default/prism/custom）
      // 与主题写入（applyVars 知道真实 dark）；液态/实透/色散与主题无关。
      writeLiquidColors(html.style, state);
      writeGlowColors(html.style, state, dark);
      paintDotsConcrete(html, state, dark);

      body.setAttribute(MOTION_ATTR, state.motion > 0 ? 'on' : 'off');
    }

    /**
     * 指针 → 光影偏移。把指针位置换算成百分比写进 --dlg-px / --dlg-py，
     * 让径向高光跟着指针走。用 rAF 合并写入，避免每帧多次样式重算。
     */
    function installPointerLight(onPointer) {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return function () {};
      }
      var frame = 0;
      var lastX = 0;
      var lastY = 0;
      function onMove(event) {
        var x = event.clientX;
        var y = event.clientY;
        // 节流：位移 < 3px 不更新。--dlg-px/py 被所有玻璃高光渐变引用，
        // 每帧更新会让全界面玻璃每帧重绘（卡顿源）。位移小（慢速/静止）
        // 时几乎不更新，视觉无感知，开销骤降。
        if (Math.abs(x - lastX) < 3 && Math.abs(y - lastY) < 3) {
          lastX = x; lastY = y;
          return;
        }
        lastX = x; lastY = y;
        if (frame) return;
        frame = window.requestAnimationFrame(function () {
          frame = 0;
          var w = window.innerWidth || 1;
          var h = window.innerHeight || 1;
          onPointer((lastX / w) * 100, (lastY / h) * 100);
        });
      }
      window.addEventListener('pointermove', onMove, { passive: true });
      return function () {
        window.removeEventListener('pointermove', onMove);
        if (frame) window.cancelAnimationFrame(frame);
      };
    }

    /**
     * 滚动 → 玻璃光影随内容偏移。
     *
     * 用 capture 监听 window 的 scroll：scroll 事件不冒泡，但 capture 阶段
     * 能收到任意可滚动后代的滚动（侧栏/主栏/弹窗内部都算）。rAF 合并写入，
     * 每帧最多一次。滚动位置归一化后写进 --dlg-scroll-y / --dlg-lux-y /
     * --dlg-rim-lux，让玻璃上的光带与描边跟着内容滑动（WWDC25 光影偏移）。
     */
    function installScrollSheen(body) {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return function () {};
      }
      var frame = 0;
      var timer = 0;
      var html = (typeof document !== 'undefined' && document.documentElement) || null;
      function compute() {
        frame = 0;
        var y = 0;
        var max = 1;
        try {
          if (typeof window.scrollY === 'number' && window.scrollY > 0) y = window.scrollY;
          var center = document.querySelector('.pI_x6G_centerCol');
          if (center && center.scrollTop > y) y = center.scrollTop;
          if (center) max = Math.max(1, (center.scrollHeight || 0) - (center.clientHeight || 0));
        } catch (_) { /* 读不到就当 0 */ }
        var ny = Math.max(0, Math.min(1, y / max));
        if (html) {
          html.style.setProperty('--dlg-scroll-y', ny.toFixed(3));
          html.style.setProperty('--dlg-lux-y', (18 + ny * 62).toFixed(2) + '%');
          html.style.setProperty('--dlg-rim-lux', rgba(255, 255, 255, 0.10 + ny * 0.30));
        }
        body.setAttribute('data-dlg-scrolling', '');
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(function () {
          timer = 0;
          body.removeAttribute('data-dlg-scrolling');
        }, 140);
      }
      function onScroll() {
        if (frame) return;
        frame = window.requestAnimationFrame(compute);
      }
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      return function () {
        window.removeEventListener('scroll', onScroll, { capture: true });
        if (frame) window.cancelAnimationFrame(frame);
        if (timer) window.clearTimeout(timer);
        body.removeAttribute('data-dlg-scrolling');
      };
    }

    /**
     * 点击 → 玻璃流动形变（WWDC25 手感）。
     *
     * pointerdown 时在命中的控件上加 .dlg-press，CSS 里的 dlg-press-flow
     * 会走一段 320ms 的「压下去-弹回来」；pointerup / 动画结束即摘掉。
     * 事件委托挂在 document，对动态生成的按钮同样生效。
     */
    function installPressDynamics(body) {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
        return function () {};
      }
      var HIT = 'button,[role="button"],[role="menuitem"],[role="tab"],[role="treeitem"]';
      function closestHit(node) {
        try { return node && node.closest ? node.closest(HIT) : null; } catch (_) { return null; }
      }
      function onDown(event) {
        var hit = closestHit(event.target);
        if (!hit || !hit.classList) return;
        hit.classList.add('dlg-press');
        var ended = 0;
        var end = function () {
          if (ended) return;
          ended = 1;
          hit.classList.remove('dlg-press');
        };
        hit.addEventListener('pointerup', end, { once: true });
        hit.addEventListener('pointercancel', end, { once: true });
        hit.addEventListener('animationend', end, { once: true });
      }
      document.addEventListener('pointerdown', onDown, { passive: true, capture: true });
      return function () {
        document.removeEventListener('pointerdown', onDown, { capture: true });
      };
    }

    /**
     * 浮层兼容：菜单 / popper 内容如果本身是透明底（没有第三方插件给的
     * 不透明设计），补一层玻璃；如果已经有不透明背景，说明是别人设计好的
     * 面板，保持原样（尊重第三方，避免样式冲突把界面搞崩）。
     */
    function installOverlayGlass() {
      if (
        typeof document === 'undefined' ||
        typeof document.body === 'undefined' ||
        typeof MutationObserver !== 'function'
      ) {
        return function () {};
      }
      var SEL = '[role="menu"],[data-radix-popper-content-wrapper] > *,[data-menu-material],[role="listbox"]';
      var seen = [];
      function alphaOf(el) {
        try {
          var bg = getComputedStyle(el).backgroundColor;
          var m = /rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)/.exec(bg);
          if (!m) return 1;
          return m[4] === undefined ? 1 : Number(m[4]);
        } catch (_) { return 1; }
      }
      function decorate(el) {
        if (!el || el.nodeType !== 1) return;
        if (seen.indexOf(el) >= 0) return;
        seen.push(el);
        if (el.classList && alphaOf(el) < 0.85) el.classList.add('dlg-js-glass');
      }
      function scan() {
        var nodes;
        try { nodes = document.querySelectorAll(SEL); } catch (_) { return; }
        for (var i = 0; i < nodes.length; i += 1) decorate(nodes[i]);
      }
      scan();
      var observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i += 1) {
          var added = records[i].addedNodes;
          if (!added) continue;
          for (var j = 0; j < added.length; j += 1) {
            var node = added[j];
            if (!node || node.nodeType !== 1) continue;
            if (node.matches && node.matches(SEL)) decorate(node);
            if (node.querySelectorAll) {
              var inner = node.querySelectorAll(SEL);
              for (var k = 0; k < inner.length; k += 1) decorate(inner[k]);
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return function () {
        observer.disconnect();
        var glassed = [];
        try { glassed = document.querySelectorAll('.dlg-js-glass'); } catch (_) { glassed = []; }
        for (var i = 0; i < glassed.length; i += 1) {
          if (glassed[i].classList) glassed[i].classList.remove('dlg-js-glass');
        }
      };
    }

    /**
     * 全局指针液态光效（macOS Sonoma 风格指针光晕）。
     *
     * 性能设计（这是本功能的命根子）：
     *   · 光晕/拖影 = 纯 CSS 径向渐变圆点，视觉上等效"高斯模糊后的光斑"，
     *     全程不跑 filter:blur() —— 模糊滤镜每帧重算是掉帧元凶。
     *   · 每一帧只写 transform + opacity（合成器搬运，不触发布局/重绘）。
     *   · rAF 里按 1000/60 ≈ 16.6ms 累加器锁帧：高刷屏(120/144Hz)也不会超频。
     *   · 不读 offsetWidth/getBoundingClientRect 等布局属性，只做纯数值插值。
     *   · elementFromPoint 只在 pointermove 事件里查一次（事件级，不是帧级）。
     *
     * 行为：
     *   · 跟随：halo 用 0.42 系数指数插值追指针，天然顺滑。
     *   · 拖影：历史采样 300ms 窗口，4 个幽灵点按年龄线性消散（0.3s 拖影）。
     *   · 静止呼吸：480ms 无移动后，明暗 ±14%、缩放 ±5% 的正弦呼吸。
     *   · 点击脉冲：pointerdown 起 380ms 内 scale 1→1.16→1 回弹 + 亮度闪。
     *   · 避开系统 UI：指针落在侧栏(.pI_x6G_sidebarCol)或 Windows 标题栏
     *     ([data-windows-titlebar]) 时整体隐藏光效。
     *   · 颜色：--dlg-glow-core/mid 由 applyVars 按主题写成低饱和冷白/淡银白。
     */
    function installPointerGlow(html, body, store) {
      if (
        typeof window === 'undefined' || typeof document === 'undefined' ||
        typeof document.createElement !== 'function' ||
        typeof document.body === 'undefined' ||
        typeof window.requestAnimationFrame !== 'function' ||
        typeof document.addEventListener !== 'function'
      ) {
        return function () {};
      }
      var GLOW_ID = PKG + '/glow';
      var HALO = 340;       // 光晕直径 px
      var GHOSTS = 4;       // 拖影幽灵点数
      var TRAIL_MS = 300;   // 拖影消散时长（需求：0.3s）
      var FRAME_MS = 1000 / 60; // 60 帧锁
      var BREATH_MS = 480;  // 静止多久开始呼吸
      var PULSE_MS = 380;   // 点击脉冲时长

      var container = document.getElementById(GLOW_ID);
      if (!container) {
        container = document.createElement('div');
        container.id = GLOW_ID;
        container.className = 'dlg-glow-layer';
        container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;';
        (document.body || html).appendChild(container);
      }

      function makeDot(className, size) {
        var dot = document.createElement('div');
        dot.className = className;
        // 注意：background 必须交给 CSS 类规则（.dlg-glow-dot 的多图层
        // background: grad/prism/rainbow/core 栈）。这里不再写内联 background，
        // 否则内联样式会覆盖类规则，彩虹/渐变/副光斑全部不显示
        //（表现为"只有默认光晕、彩色折射和自定义颜色都没有"）。
        dot.style.cssText =
          'position:absolute;left:0;top:0;width:' + size + 'px;height:' + size + 'px;' +
          'border-radius:50%;pointer-events:none;will-change:transform,opacity;mix-blend-mode:screen;' +
          'opacity:0;transform:translate3d(-1000px,-1000px,0);';
        container.appendChild(dot);
        return dot;
      }

      var halo = makeDot('dlg-glow-dot dlg-glow-halo', HALO);
      var ghosts = [];
      var g, i;
      for (g = 0; g < GHOSTS; g += 1) {
        ghosts.push({
          el: makeDot('dlg-glow-dot dlg-glow-trail', Math.round(HALO * 0.8)),
          x: -1000, y: -1000
        });
      }

      var hist = [];          // {x,y,t} 历史采样
      var px = -1000, py = -1000;   // 指针最新位置
      var hx = -1000, hy = -1000;   // 光晕当前位置（插值）
      var havePointer = false;
      var lastMove = 0;       // 最后一次移动时间
      var pulseAt = -9999;    // 最近一次点击时间
      var breathT = 0;
      var lastRender = 0;
      var suppressed = false;
      var reduceMotion = false;
      try { reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { reduceMotion = false; }

      function now() {
        return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      }

      /** 指针是否落在需要避开的系统 UI 上（侧栏 / Windows 标题栏）。 */
      function isSystemUi(x, y) {
        try {
          var el = document.elementFromPoint(x, y);
          while (el && el.nodeType === 1) {
            var cls = '';
            try { cls = el.className && el.className.toString ? el.className.toString() : ''; } catch (_) { cls = ''; }
            if (cls.indexOf('sidebarCol') >= 0 || (el.hasAttribute && el.hasAttribute('data-windows-titlebar'))) {
              return true;
            }
            el = el.parentNode;
          }
        } catch (_) { /* 读不到就当作不需要避开 */ }
        return false;
      }

      function onMove(event) {
        px = event.clientX;
        py = event.clientY;
        havePointer = true;
        lastMove = now();
        suppressed = isSystemUi(px, py);
      }

      function onDown() { pulseAt = now(); }

      var frame = 0;
      // store 状态缓存：subscribe 更新，tick 里直接读缓存，
      // 避免每帧 store.get() 全量拷贝（60fps 下是纯开销）。
      var stCache = store.get();
      var unsubStore = store.subscribe(function () { stCache = store.get(); });
      function tick() {
        // 先调度下一帧（链式驱动，任何提前 return 都不会停摆）。
        frame = window.requestAnimationFrame(tick);
        var t = now();
        // 60 帧锁：不到一个帧间隔不渲染（高刷屏也不会超频）。
        if (t - lastRender < FRAME_MS) return;
        lastRender = t;

        var st = stCache;
        // 光效层显示只由参数控制：系统"减少动画"（prefers-reduced-motion）
        // 只减弱呼吸/脉冲，不再整体隐藏光效层 —— 否则用户完全看不到
        // 光晕（默认/彩色都看不到，表现为"颜色没更改"）。
        var active = st.glow > 0 && st.motion > 0;
        container.style.display = active ? '' : 'none';
        if (!active || !havePointer) return;

        if (suppressed) {
          halo.style.opacity = '0';
          for (i = 0; i < ghosts.length; i += 1) ghosts[i].el.style.opacity = '0';
          return;
        }

        // 光晕快速跟随（0.42 指数插值 → 顺滑无跳变）。
        hx += (px - hx) * 0.42;
        hy += (py - hy) * 0.42;

        // 静止呼吸：明暗 ±14%、缩放 ±5%（系统"减少动画"时跳过，光晕保持稳定可见）。
        var scale = 1;
        var glowO = 1;
        if (!reduceMotion) {
          if (t - lastMove > BREATH_MS) {
            breathT += 1;
            var wave = Math.sin(breathT * 0.055);
            scale = 1 + 0.05 * wave;
            glowO = 0.84 + 0.13 * (0.5 + 0.5 * wave);
          }

          // 点击脉冲：380ms 内 scale 1→1.16→1 回弹 + 亮度闪（苹果弹性曲线近似）。
          if (t - pulseAt < PULSE_MS) {
            var p = Math.max(0, Math.min(1, (t - pulseAt) / PULSE_MS));
            scale *= 1 + 0.16 * Math.sin(p * Math.PI) * (1 - p * 0.35);
            glowO = Math.min(1.18, glowO + 0.26 * Math.sin(p * Math.PI));
          }
        }

        halo.style.opacity = String(Math.min(1, glowO));
        halo.style.transform = 'translate3d(' +
          (hx - HALO / 2).toFixed(1) + 'px,' +
          (hy - HALO / 2).toFixed(1) + 'px,0) scale(' + scale.toFixed(3) + ')';

        // 拖影：把指针轨迹采样进 300ms 窗口，幽灵点按年龄线性消散。
        hist.push({ x: px, y: py, t: t });
        while (hist.length > 0 && t - hist[0].t > TRAIL_MS) hist.shift();
        var n = hist.length;
        for (i = 0; i < ghosts.length; i += 1) {
          var idx = n > 1 ? Math.min(n - 1, Math.floor(((i + 1) / (GHOSTS + 1)) * n)) : 0;
          var sample = hist[idx];
          if (!sample) { ghosts[i].el.style.opacity = '0'; continue; }
          var age = t - sample.t;
          var fade = age >= TRAIL_MS ? 0 : 1 - age / TRAIL_MS;
          ghosts[i].el.style.opacity = (fade * 0.30 * glowO).toFixed(3);
          ghosts[i].el.style.transform = 'translate3d(' +
            (sample.x - HALO * 0.4).toFixed(1) + 'px,' +
            (sample.y - HALO * 0.4).toFixed(1) + 'px,0) scale(' + (0.9 + fade * 0.28).toFixed(3) + ')';
        }
      }

      window.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerdown', onDown, { passive: true });
      frame = window.requestAnimationFrame(tick);

      return function () {
        window.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerdown', onDown);
        if (unsubStore) unsubStore();
        if (frame) window.cancelAnimationFrame(frame);
        if (container && container.parentNode) container.parentNode.removeChild(container);
      };
    }

    /**
     * 液态玻璃实时 hover（iOS 26 Liquid Glass 交互核心）。
     *
     * 鼠标指向按钮/可点控件时，把指针相对该控件的百分比实时写进控件
     * 内联样式 --dlg-glow-x / --dlg-glow-y，按钮 ::after 液态层上的高光斑
     * 便跟着指针在玻璃表面流动（CSS 里 opacity 0→1 平滑出现）。
     *
     * 性能：mouseover 委托只记录"当前 hover 的控件"，pointermove 只更新
     * 这一个控件（rAF 合并，每帧最多一次 getBoundingClientRect + 2 个变量），
     * 其余按钮零成本。pointer-events:none 的液态层不挡任何点击。
     */
    function installLiquidHover(html, body, store) {
      if (
        typeof window === 'undefined' || typeof document === 'undefined' ||
        typeof document.addEventListener !== 'function' ||
        typeof window.requestAnimationFrame !== 'function'
      ) {
        return function () {};
      }
      var hoverEl = null;
      var frame = 0;
      var px = 0;
      var py = 0;
      var lastX = null;
      var lastY = null;

      function findControl(target) {
        var el = target;
        while (el && el.nodeType === 1 && el !== body && el !== html) {
          var tag = '';
          try { tag = el.tagName ? el.tagName.toLowerCase() : ''; } catch (_) { tag = ''; }
          var role = '';
          try { role = el.getAttribute && el.getAttribute('role') ? String(el.getAttribute('role')) : ''; } catch (_) { role = ''; }
          if (
            tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' ||
            role === 'button' || role === 'menuitem' || role === 'tab' ||
            role === 'switch' || role === 'checkbox' || role === 'radio' || role === 'option'
          ) {
            return el;
          }
          el = el.parentNode;
        }
        return null;
      }

      function apply() {
        frame = 0;
        var el = hoverEl;
        if (!el || !el.isConnected) { hoverEl = null; return; }
        if (lastX === null || lastY === null) return;
        var rect = null;
        try { rect = el.getBoundingClientRect(); } catch (_) { rect = null; }
        if (!rect || rect.width < 1 || rect.height < 1) return;
        var cx = ((lastX - rect.left) / rect.width) * 100;
        var cy = ((lastY - rect.top) / rect.height) * 100;
        el.style.setProperty('--dlg-glow-x', cx.toFixed(1) + '%');
        el.style.setProperty('--dlg-glow-y', cy.toFixed(1) + '%');
      }

      function schedule() {
        if (frame) return;
        frame = window.requestAnimationFrame(apply);
      }

      function onMove(event) {
        var x = event.clientX;
        var y = event.clientY;
        // 节流：位移 < 2px 不重算。--dlg-glow-x/y 只影响当前 hover 的
        // 一个按钮的液态高光斑，位移小（慢速/静止）时跳过，
        // 减少 getBoundingClientRect 与样式写入频率。
        if (hoverEl && lastX !== null && lastY !== null &&
            Math.abs(x - lastX) < 2 && Math.abs(y - lastY) < 2) {
          px = x; py = y;
          return;
        }
        px = x;
        py = y;
        lastX = px;
        lastY = py;
        if (hoverEl) schedule();
      }

      function onOver(event) {
        var next = findControl(event.target);
        if (next !== hoverEl) {
          hoverEl = next;
          if (next) schedule();
        }
      }

      document.addEventListener('mouseover', onOver, { passive: true });
      window.addEventListener('pointermove', onMove, { passive: true });

      return function () {
        document.removeEventListener('mouseover', onOver);
        window.removeEventListener('pointermove', onMove);
        if (frame) window.cancelAnimationFrame(frame);
        var el = hoverEl;
        if (el) {
          try {
            el.style.removeProperty('--dlg-glow-x');
            el.style.removeProperty('--dlg-glow-y');
          } catch (_) { /* 忽略 */ }
          hoverEl = null;
        }
      };
    }

    /**
     * 光效样式设置按键 + 玻璃面板（用户需求：按键放进"设置里"）。
     *
     * 两处入口：
     *   1) 侧栏底部常驻光效按键（.dlg-style-fab，紧挨"设置"图标区域）；
     *   2) MutationObserver 检测到 DSH 设置面板（[role=dialog] 且含
     *      settings/setting/配置 等关键词）时，自动在面板内注入同名按键。
     * 按键本身是 button → 自动获得液态 hover 光效 + 全局光晕（与其它按钮
     * 完全同款）。点击弹出玻璃浮层，可切换：
     *   光效样式：当前样式 / 彩色折射（prism）/ 自定义颜色（custom）
     *   液态层实透：滑块 0.35（更透）↔ 1（更实）
     * 所有改动走 store.set()，与 URL 参数、控制台入口完全同一条链路。
     */
    function installStylePanel(html, body, store) {
      if (
        typeof document === 'undefined' || typeof document.createElement !== 'function' ||
        typeof document.body === 'undefined' || typeof document.addEventListener !== 'function' ||
        typeof window === 'undefined'
      ) {
        return function () {};
      }
      var PANEL_ID = PKG + '/style-panel';
      var FAB_CLASS = 'dlg-style-fab';
      var MODES = [
        ['default', '默认样式'],
        ['prism', '彩色折射'],
        ['custom', '自定义颜色']
      ];

      var panel = null;
      var dialogFab = null;
      var open = false;
      // 面板内待确认的样式选择（选好点"确认应用"才写入光效）
      var pending = null;

      function makeIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="12" cy="12" r="5.5" fill="#dbe7ff"/>' +
          '<circle cx="12" cy="12" r="8.5" stroke="#9cc0ff" stroke-opacity="0.65" stroke-width="1.6"/>' +
          '<circle cx="12" cy="12" r="11" stroke="#9cc0ff" stroke-opacity="0.28" stroke-width="1"/>' +
          '</svg>';
      }

      function makeFab() {
        var b = document.createElement('button');
        b.className = FAB_CLASS;
        b.type = 'button';
        b.title = '液态光效样式';
        b.setAttribute('aria-label', '液态光效样式');
        b.innerHTML = makeIcon();
        b.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          toggle(b);
        });
        return b;
      }

      function buildPanel() {
        var p = document.createElement('div');
        p.id = PANEL_ID;
        p.style.display = 'none';

        var title = document.createElement('div');
        title.className = 'dlg-style-panel-title';
        title.textContent = '液态光效';
        p.appendChild(title);

        // 样式三模式：点击只切换 UI 高亮（pending），确认后才生效
        var row = document.createElement('div');
        row.className = 'dlg-style-row';
        var modeBtns = {};
        var m;
        for (m = 0; m < MODES.length; m += 1) {
          (function (mode, label) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.addEventListener('click', function () {
              pending.glowStyle = mode;
              refreshPanel(ui);
            });
            modeBtns[mode] = b;
            row.appendChild(b);
          })(MODES[m][0], MODES[m][1]);
        }
        p.appendChild(row);

        // 自定义颜色：单色 + 渐变开关 + 第二取色器（渐变开启时显示）
        var customRow = document.createElement('div');
        customRow.className = 'dlg-style-custom';
        var colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = '#88c0ff';
        var colorLabel = document.createElement('span');
        colorLabel.textContent = '颜色 A';
        var gradToggle = document.createElement('button');
        gradToggle.type = 'button';
        gradToggle.className = 'dlg-style-grad-toggle';
        gradToggle.textContent = '渐变: 关';
        gradToggle.addEventListener('click', function () {
          pending.glowGradient = !pending.glowGradient;
          refreshPanel(ui);
        });
        var endWrap = document.createElement('span');
        endWrap.className = 'dlg-style-color-end';
        var colorInputEnd = document.createElement('input');
        colorInputEnd.type = 'color';
        colorInputEnd.value = '#6a5cff';
        var colorEndLabel = document.createElement('span');
        colorEndLabel.textContent = '颜色 B';
        endWrap.appendChild(colorInputEnd);
        endWrap.appendChild(colorEndLabel);
        colorInput.addEventListener('input', function () {
          pending.glowColor = colorInput.value;
        });
        colorInputEnd.addEventListener('input', function () {
          pending.glowColorEnd = colorInputEnd.value;
        });
        customRow.appendChild(colorInput);
        customRow.appendChild(colorLabel);
        customRow.appendChild(gradToggle);
        customRow.appendChild(endWrap);
        p.appendChild(customRow);

        // 实透滑块
        var sliderRow = document.createElement('div');
        sliderRow.className = 'dlg-style-slider';
        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0.35';
        slider.max = '1';
        slider.step = '0.01';
        slider.value = '0.65';
        var sliderVal = document.createElement('span');
        sliderVal.className = 'dlg-style-val';
        slider.addEventListener('input', function () {
          pending.liquidFill = Number(slider.value);
          ui.sliderVal.textContent = String(Math.round(pending.liquidFill * 100)) + '%';
        });
        var less = document.createElement('span');
        less.textContent = '更透';
        var more = document.createElement('span');
        more.textContent = '更实';
        sliderRow.appendChild(less);
        sliderRow.appendChild(slider);
        sliderRow.appendChild(sliderVal);
        sliderRow.appendChild(more);
        p.appendChild(sliderRow);

        // 确认应用：点击后才真正写入光效样式，并当场自检反馈结果
        var confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'dlg-style-confirm';
        confirmBtn.textContent = '确认应用';
        confirmBtn.addEventListener('click', function () {
          applyStyleChoice(ui);
        });
        p.appendChild(confirmBtn);

        var statusEl = document.createElement('div');
        statusEl.className = 'dlg-style-status';
        p.appendChild(statusEl);

        // 关闭
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'dlg-style-close';
        close.textContent = '关闭';
        close.addEventListener('click', function () { hide(); });
        p.appendChild(close);

        return {
          panel: p,
          modeBtns: modeBtns,
          colorInput: colorInput,
          colorInputEnd: colorInputEnd,
          gradToggle: gradToggle,
          endWrap: endWrap,
          slider: slider,
          sliderVal: sliderVal,
          customRow: customRow,
          confirmBtn: confirmBtn,
          statusEl: statusEl
        };
      }

      function refreshPanel(ui) {
        if (!pending) return;
        var st = pending;
        var activeMode = st.glowStyle === 'prism' ? 'prism' : (st.glowStyle === 'custom' ? 'custom' : 'default');
        for (var mode in ui.modeBtns) {
          if (Object.prototype.hasOwnProperty.call(ui.modeBtns, mode)) {
            ui.modeBtns[mode].classList.toggle('dlg-active', mode === activeMode);
          }
        }
        ui.customRow.style.display = activeMode === 'custom' ? 'flex' : 'none';
        // 正在拖动取色器时不回写 value（input 事件中设置 value 会中断拖动/
        // 重置取色面板，导致"只生效一次"）；其它来源的刷新正常回写。
        var hex = String(st.glowColor || '').replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(hex) && document.activeElement !== ui.colorInput) {
          ui.colorInput.value = '#' + hex.toLowerCase();
        }
        var hex2 = String(st.glowColorEnd || '').replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(hex2) && document.activeElement !== ui.colorInputEnd) {
          ui.colorInputEnd.value = '#' + hex2.toLowerCase();
        }
        ui.gradToggle.textContent = st.glowGradient ? '渐变: 开' : '渐变: 关';
        ui.gradToggle.classList.toggle('dlg-active', !!st.glowGradient);
        ui.endWrap.style.display = st.glowGradient ? 'flex' : 'none';
        ui.slider.value = String(Math.max(0.35, Math.min(1, st.liquidFill || 0.65)));
        ui.sliderVal.textContent = String(Math.round((st.liquidFill || 0.65) * 100)) + '%';
      }

      /**
       * 确认应用：把 pending（用户在面板里选好的模式/颜色/实透）真正写入
       * 光效 —— 同步 store、强制重算颜色变量、把具体颜色值内联到光晕点，
       * 然后当场自检写入结果并显示在面板里（已应用 ✓ / 应用失败：原因）。
       * 不依赖 store.subscribe 链路，直接调用写入函数，确保生效。
       */
      function applyStyleChoice(ui) {
        if (!pending || !ui.statusEl) return;
        ui.statusEl.textContent = '应用中…';
        ui.statusEl.className = 'dlg-style-status';
        try {
          var st = store.get();
          // 构造完整目标状态：pending（面板选择）优先，store 兜底。
          // 颜色兜底：没拖取色器时取取色器当前显示值，确保 custom 永远有颜色。
          var colorVal = String(pending.glowColor || ui.colorInput.value || '#88c0ff');
          var endVal = String(pending.glowColorEnd || ui.colorInputEnd.value || '#6a5cff');
          var target = {
            glowStyle: pending.glowStyle,
            glowColor: colorVal,
            glowColorEnd: endVal,
            glowGradient: !!pending.glowGradient,
            liquidFill: Number(pending.liquidFill) || Number(st.liquidFill) || 0.65,
            glow: st.glow, liquid: st.liquid, motion: st.motion,
            blur: st.blur, saturate: st.saturate,
            glassLight: st.glassLight, glassDark: st.glassDark,
            baseLight: st.baseLight, baseDark: st.baseDark,
            highlight: st.highlight, refract: st.refract, press: st.press
          };

          // 1) 同步 store（保持 URL/其它面板一致；其订阅刷新幂等无害）
          store.set('glowStyle', target.glowStyle);
          store.set('glowColor', target.glowColor);
          store.set('glowColorEnd', target.glowColorEnd);
          store.set('glowGradient', target.glowGradient);
          store.set('liquidFill', target.liquidFill);

          // 2) 强制写入：直接以 target 重算颜色变量 + 具体值内联到光晕点，
          //    完全不依赖 store.subscribe 链路 —— 确认后铁定写入。
          var dark = html.hasAttribute('data-ds-dark-theme') || body.hasAttribute('data-ds-dark-theme');
          writeLiquidColors(html.style, target);
          writeGlowColors(html.style, target, dark);
          paintDotsConcrete(html, target, dark);
          previewGlow(html, target, dark);

          // 3) 自检：读回实际写入的变量（用 target 判断预期）
          var hs = html.style;
          var checks = [];
          var rVal = '', gVal = '', coreVal = '';
          if (target.glowStyle === 'prism') {
            rVal = hs.getPropertyValue('--dlg-glow-rainbow') || '';
            if (rVal.indexOf('conic-gradient') !== 0) checks.push('彩虹层未写入');
          } else if (target.glowStyle === 'custom') {
            gVal = hs.getPropertyValue('--dlg-glow-grad') || '';
            // 注意：radial-gradient 以 "radial-" 开头，不能用 indexOf('gradient') !== 0，
            // 必须用"不包含 gradient"判定写入失败（否则 grad 已写入也误报失败）。
            if (gVal.indexOf('gradient') < 0) checks.push('颜色层未写入');
          } else {
            coreVal = hs.getPropertyValue('--dlg-glow-core') || '';
            if (!coreVal) checks.push('光晕核心未写入');
          }
          var dotCount = 0;
          try { dotCount = document.querySelectorAll('.dlg-glow-dot').length; } catch (_) { dotCount = -1; }
          if (dotCount === 0) checks.push('光晕点未创建（光效层缺失）');

          // 3b) 光晕渲染诊断：读光效容器 + 首个光晕点的计算样式，
          //     让"已应用但看不见颜色"能一眼定位（容器是否显示 / 点是否有色 / 透明度）。
          var diag = '';
          try {
            var cEl = document.querySelector('.dlg-glow-layer');
            var dEl = document.querySelector('.dlg-glow-dot');
            var csC = cEl ? window.getComputedStyle(cEl) : null;
            var csD = dEl ? window.getComputedStyle(dEl) : null;
            diag = ' [容器=' + (csC ? (csC.display + '/' + csC.opacity) : '∅') +
                   ' 首点=' + (csD ? ((csD.backgroundImage || '∅').slice(0, 26) + '/op' + csD.opacity) : '∅') + ']';
          } catch (_) { diag = ' [诊断失败]'; }

          pending = {
            glowStyle: target.glowStyle,
            glowColor: target.glowColor,
            glowColorEnd: target.glowColorEnd,
            glowGradient: target.glowGradient,
            liquidFill: target.liquidFill
          };

          if (checks.length) {
            var debug = ' [rainbow=' + (rVal || '∅').slice(0, 32) + ' grad=' + (gVal || '∅').slice(0, 32) + ' core=' + (coreVal || '∅').slice(0, 24) + ']';
            ui.statusEl.textContent = '应用失败：' + checks.join('；') + debug + diag;
            ui.statusEl.className = 'dlg-style-status dlg-status-bad';
          } else {
            var modeLabel = target.glowStyle === 'prism' ? '彩色折射' : (target.glowStyle === 'custom' ? '自定义颜色' : '默认样式');
            ui.statusEl.textContent = '已应用 ✓ 当前：' + modeLabel + '（光晕点 ' + dotCount + ' 个）' + diag;
            ui.statusEl.className = 'dlg-style-status dlg-status-ok';
          }
        } catch (err) {
          ui.statusEl.textContent = '应用异常：' + (err && err.message ? err.message : String(err));
          ui.statusEl.className = 'dlg-style-status dlg-status-bad';
        }
      }

      function positionPanel(anchor) {
        if (!panel) return;
        var w = Math.max(280, panel.offsetWidth || 280);
        var h = panel.offsetHeight || 240;
        var left = Math.max(8, Math.round((window.innerWidth - w) / 2));
        var top = Math.max(8, Math.round((window.innerHeight - h) / 2));
        if (anchor) {
          try {
            var r = anchor.getBoundingClientRect();
            left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right + 10));
            top = Math.max(8, r.top);
          } catch (_) { /* 定位失败就居中 */ }
        }
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
      }

      function show(anchor) {
        if (!panel) return;
        // 打开面板时把 pending 重置为当前已生效的样式（未确认的改动丢弃）
        var st = store.get();
        pending = {
          glowStyle: st.glowStyle || 'default',
          glowColor: st.glowColor || '',
          glowColorEnd: st.glowColorEnd || '',
          glowGradient: !!st.glowGradient,
          liquidFill: Number(st.liquidFill) || 0.65
        };
        refreshPanel(ui);
        panel.style.display = 'block';
        open = true;
        positionPanel(anchor || dialogFab || null);
      }

      function hide() {
        if (!panel) return;
        panel.style.display = 'none';
        open = false;
      }

      function toggle(anchor) {
        if (open) hide();
        else show(anchor);
      }

      function onDocClick(event) {
        if (!open) return;
        var target = event.target;
        var inPanel = panel && (target === panel || (panel.contains && panel.contains(target)));
        var inFab = dialogFab && (target === dialogFab || (dialogFab.contains && dialogFab.contains(target)));
        if (!inPanel && !inFab) hide();
      }

      // ── 构建并挂载 ──
      var ui = buildPanel();
      panel = ui.panel;
      (document.body || html).appendChild(panel);

      // 订阅参数变化：模式/颜色/实透即时回显（控制台或 URL 改动同样刷新）。
      var unsubscribe = store.subscribe(function () { refreshPanel(ui); });
      refreshPanel(ui);

      // 点击面板外关闭。
      document.addEventListener('click', onDocClick, { passive: true });

      // ── 设置类弹层注入：检测 DSH 的用户菜单 / 设置面板（[role=dialog]/
      //    [role=menu] 且含 设置/配置 等关键词），注入同名按键。注入位置
      //    放在弹层最后一个元素之前（如用户菜单的"退出登录"正下方），
      //    同屏只有这一个光效按键，不再有侧栏常驻 FAB。
      var observer = null;
      function maybeInject(rootNode) {
        if (!rootNode || rootNode.nodeType !== 1) return;
        var dlg = null;
        try {
          dlg = rootNode.matches && rootNode.matches('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper] > *')
            ? rootNode : rootNode.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper] > *');
        } catch (_) { dlg = null; }
        if (!dlg) return;
        // 只往"用户菜单"注入（含 退出登录/意见反馈 —— 即点头像弹出的那个
        // 菜单），按钮出现在"退出登录"正下方。设置面板/普通弹窗一律不注入，
        // 避免出现多个按钮（用户要求全界面只保留一个）。
        var text = '';
        try { text = (dlg.getAttribute('aria-label') || '') + ' ' + (dlg.className && dlg.className.toString ? dlg.className.toString() : '') + ' ' + (dlg.textContent || '').slice(0, 400); } catch (_) { text = ''; }
        var isUserMenu = /退出登录|意见反馈|sign\s?out|log\s?out|logout|feedback/i.test(text);
        if (!isUserMenu) return;
        try {
          if (dlg.querySelector('.' + FAB_CLASS)) return; // 已注入
        } catch (_) { /* 忽略 */ }
        dialogFab = makeFab();
        try {
          // 插到弹层最后一个子元素之前（用户菜单里就是"退出登录"正下方），
          // 弹层只有一个子元素/无子元素时退化为末尾追加。
          var lastChild = dlg.lastElementChild;
          if (lastChild && lastChild !== dialogFab) dlg.insertBefore(dialogFab, lastChild);
          else dlg.appendChild(dialogFab);
        } catch (_) { /* 忽略 */ }
      }
      try {
        observer = new MutationObserver(function (mutations) {
          var i, j, added;
          for (i = 0; i < mutations.length; i += 1) {
            added = mutations[i].addedNodes;
            for (j = 0; j < added.length; j += 1) maybeInject(added[j]);
          }
        });
        observer.observe(document.body || html, { childList: true, subtree: true });
      } catch (_) { observer = null; }

      return function () {
        unsubscribe();
        document.removeEventListener('click', onDocClick);
        if (observer) {
          try { observer.disconnect(); } catch (_) { /* 忽略 */ }
        }
        if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
        if (dialogFab && dialogFab.parentNode) dialogFab.parentNode.removeChild(dialogFab);
        panel = null; dialogFab = null;
      };
    }

    /**
     * 监听浅色/深色切换。
     *
     * 内联写入的令牌不会随主题自动变化，而 app 切换主题改的是
     * `html[data-ds-dark-theme]`，所以监听这两个根元素的属性变化，
     * 一变就重算内联令牌。用 rAF 合并，避免同一次切换触发多次重算。
     *
     * @param {HTMLElement} html - 文档根元素。
     * @param {HTMLElement} body - body 元素。
     * @param {Function} onThemeChange - 主题变化后的回调。
     * @returns {Function} 停止监听的函数。
     */
    function installThemeWatch(html, body, onThemeChange) {
      if (typeof MutationObserver !== 'function') return function () {};
      var scheduled = 0;
      var observer = new MutationObserver(function (records) {
        var relevant = false;
        for (var i = 0; i < records.length; i += 1) {
          if (records[i].attributeName === 'data-ds-dark-theme') { relevant = true; break; }
        }
        if (!relevant) return;
        if (scheduled) return;
        scheduled = window.requestAnimationFrame(function () {
          scheduled = 0;
          onThemeChange();
        });
      });
      observer.observe(html, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
      observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
      return function () {
        observer.disconnect();
        if (scheduled) window.cancelAnimationFrame(scheduled);
      };
    }

    /**
     * 兼容护栏：只在 DOM 上做「存在性」判断，不读别人的内部状态。
     * 命中已知同挂点插件就进入安全模式，避免互相覆盖把界面顶坏。
     */
    function detectPeers() {
      var hits = [];
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return hits;
      for (var i = 0; i < WATCHED_PEERS.length; i += 1) {
        var found = false;
        try {
          found = document.querySelector(WATCHED_PEERS[i][1]) !== null;
        } catch (_) { found = false; }
        if (found) hits.push(WATCHED_PEERS[i][0]);
      }
      return hits;
    }

    /**
     * 插件入口。
     * @param {object} ctx - 浏览器侧受限 Cordis 上下文。
     */
    function apply(ctx) {
      if (typeof document === 'undefined' || !document.body) return;
      // 幂等守卫：DSH 的 HMR / 重复加载可能多次调用 apply。多实例会让多个
      // store、面板、监听互相覆盖（症状：模式按钮点不动、选色只生效一次、
      // 按键重复出现）。只让第一个实例生效，dispose 时清除标记。
      if (typeof window !== 'undefined' && window.__dlgLiquidActive) return;
      if (typeof window !== 'undefined') window.__dlgLiquidActive = true;
      var body = document.body;
      var html = document.documentElement;

      // 1) 样式表（幂等：同 id 已存在就复用，避免重复注入）
      if (document.getElementById(STYLE_ID) === null) {
        var tag = document.createElement('style');
        tag.id = STYLE_ID;
        tag.dataset.plugin = PKG;
        tag.dataset.pluginCss = PKG + '/liquid-glass.css';
        tag.textContent = buildCss();
        (document.head || html).appendChild(tag);
      }

      // 2) 参数与根标记（html 与 body 都写，降低对注入点的假设）
      var api = null;
      var store = createStore();
      html.setAttribute(ROOT_ATTR, '');
      body.setAttribute(ROOT_ATTR, '');

      // 2b) 内联写入主战场前，先备份这两个宿主节点上被本插件触碰过的内联原值，
      //     卸载时按备份精确还原，不留残留。
      var backupNames = TOKEN_NAMES.concat(OWN_VAR_NAMES).concat([
        '--dlg-base-L', '--dlg-glass-L', '--dlg-mask-L',
        '--dlg-btn-glass-L', '--dlg-btn-glass-icon-L', '--dlg-glass-accent-L'
      ]).concat(['background-color', 'background-image', 'animation']);
      for (var d = 0; d < DARK_INK_TOKENS.length; d += 1) backupNames.push(DARK_INK_TOKENS[d][0]);
      var backups = [
        backupInline(html, backupNames),
        backupInline(body, backupNames)
      ];

      applyVars(html, body, store.get());

      // 3) 兼容护栏
      var peers = detectPeers();
      if (peers.length > 0) {
        body.setAttribute('data-dlg-safe', 'on');
        body.setAttribute('data-dlg-peers', peers.join(' '));
      }

      // 4) 动效：指针光影 / 滚动光影 / 点击流动 / 浮层玻璃装饰 / 指针光效
      var detachPointer = installPointerLight(function (xPercent, yPercent) {
        if (body.getAttribute(MOTION_ATTR) !== 'on') return;
        html.style.setProperty('--dlg-px', xPercent.toFixed(2) + '%');
        html.style.setProperty('--dlg-py', yPercent.toFixed(2) + '%');
      });
      var detachScroll = installScrollSheen(body);
      var detachPress = installPressDynamics(body);
      var detachOverlay = installOverlayGlass();
      var detachGlow = installPointerGlow(html, body, store);
      var detachLiquid = installLiquidHover(html, body, store);
      // 回退：不再安装样式面板/按钮/FAB（用户要求只保留默认样式，删除其它面板和按钮）。
      var detachStylePanel = null;

      // 4b) 主题切换要重算内联令牌。
      //     app 切浅色/深色时改的是 html[data-ds-dark-theme]，内联写入的内容
      //     不会自己更新，所以监听属性变化后重跑 applyVars。
      var detachTheme = installThemeWatch(html, body, function () {
        applyVars(html, body, store.get());
      });

      // 5) 参数变化 → 立刻重算变量。颜色类参数（选色/切模式/实透）走
      //    轻量路径：只写光效颜色变量，不跑全量 applyVars（避开
      //    getComputedStyle 等重操作），拖取色器才即时流畅；
      //    其余参数（模糊/饱和度/玻璃浓度等）仍全量重算。
      var COLOR_ONLY = {
        glowStyle: 1, glowColor: 1, glowColorEnd: 1, glowGradient: 1,
        glow: 1, liquid: 1, liquidFill: 1
      };
      var unsubscribe = store.subscribe(function (name) {
        if (COLOR_ONLY[name]) updateGlowColors(html, body, store.get());
        else applyVars(html, body, store.get());
      });

      // 6) 调参/诊断入口
      try {
        api = {
          version: VERSION,
          packageName: PKG,
          defaults: (function () {
            var copy = {};
            for (var k in DEFAULTS) {
              if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) copy[k] = DEFAULTS[k];
            }
            return copy;
          })(),
          limits: LIMITS,
          get: function () { return store.get(); },
          set: function (name, value) { store.set(name, value); return store.get(); },
          patch: function (values) { store.patch(values); return store.get(); },
          reset: function () { store.reset(); return store.get(); },
          safeMode: function (on) {
            if (on) body.setAttribute('data-dlg-safe', 'on');
            else body.removeAttribute('data-dlg-safe');
            return body.getAttribute('data-dlg-safe') === 'on';
          },
          detectedPeers: function () { return peers.slice(); },
          theme: function () {
            return (html.hasAttribute('data-ds-dark-theme') || body.hasAttribute('data-ds-dark-theme'))
              ? 'dark'
              : 'light';
          },
          /**
           * 一键自检：控制台敲 __dshLiquidGlass.doctor() 打印报告。
           * 回答「到底哪一环没生效」。
           */
          doctor: function () {
            var read = function (el, name) {
              try { return getComputedStyle(el).getPropertyValue(name).trim() || '(空)'; }
              catch (e) { return '(读不到)'; }
            };
            var count = function (sel) {
              try { return document.querySelectorAll(sel).length; }
              catch (e) { return 'ERR'; }
            };
            var report = {
              激活: {
                根标记_HTML: html.hasAttribute(ROOT_ATTR),
                根标记_BODY: body.hasAttribute(ROOT_ATTR),
                样式表: document.getElementById(STYLE_ID) !== null,
                当前主题: api.theme(),
                安全模式: body.getAttribute('data-dlg-safe') === 'on',
                命中的同挂点插件: peers
              },
              内联令牌_本插件写入: {
                // 内联样式是主战场：这几项会原样回显本插件写进去的引用
                'html --dsw-alias-bg-base': html.style.getPropertyValue('--dsw-alias-bg-base') || '(空)',
                'body --dsw-alias-bg-base': body.style.getPropertyValue('--dsw-alias-bg-base') || '(空)',
                'html --dlg-base-L': html.style.getPropertyValue('--dlg-base-L') || '(空)',
                'html --dlg-glass-L': html.style.getPropertyValue('--dlg-glass-L') || '(空)'
              },
              主题令牌解析值: {
                '--dsw-alias-bg-base': read(html, '--dsw-alias-bg-base'),
                '--dsw-alias-bg-layer-1': read(html, '--dsw-alias-bg-layer-1'),
                '--dsw-specific-sidebar-fill': read(html, '--dsw-specific-sidebar-fill'),
                '#root_bg-base': (function () {
                  var r = document.getElementById('root');
                  return r ? read(r, '--dsw-alias-bg-base') : '(没有 #root)';
                })()
              },
              本插件参数: {
                '--dlg-glass-light': read(html, '--dlg-glass-light'),
                '--dlg-glass-dark': read(html, '--dlg-glass-dark'),
                '--dlg-base-L': read(html, '--dlg-base-L'),
                '--dlg-glass-L': read(html, '--dlg-glass-L')
              },
              结构选择器命中数: {
                '.pI_x6G_sidebarCol(侧栏)': count('.pI_x6G_sidebarCol'),
                '.pI_x6G_centerCol(主栏)': count('.pI_x6G_centerCol'),
                'button(按钮总数)': count('button'),
                'button[class*="iconButton"](图标按钮)': count('button[class*="iconButton"]'),
                '[role="menu"]': count('[role="menu"]'),
                '[role="dialog"]': count('[role="dialog"]'),
                '[data-windows-titlebar]': count('[data-windows-titlebar]'),
                '.dlg-js-glass(JS装饰浮层)': count('.dlg-js-glass')
              },
              兼容与动效: {
                安全模式: body.getAttribute('data-dlg-safe') === 'on',
                命中的同挂点插件: peers,
                壁纸归属: (function () {
                  try {
                    return getComputedStyle(html).backgroundImage === 'none'
                      ? '页面原本无壁纸 → 本插件已铺环境渐变'
                      : '页面已有其它壁纸 → 本插件让位（第三方兼容）';
                  } catch (e) { return '(读不到)'; }
                })(),
                '--dlg-scroll-y': read(html, '--dlg-scroll-y'),
                '--dlg-lux-y': read(html, '--dlg-lux-y'),
                '--dlg-btn-glass-L': read(html, '--dlg-btn-glass-L')
              },
              指针光效: {
                光效层: document.getElementById(PKG + '/glow') !== null,
                光晕元素: count('.dlg-glow-layer .dlg-glow-halo'),
                拖影元素: count('.dlg-glow-layer .dlg-glow-trail'),
                '光效开关 glow': store.get().glow,
                '交互动效 motion': store.get().motion,
                '光效颜色 --dlg-glow-core': read(html, '--dlg-glow-core'),
                '光效颜色 --dlg-glow-mid': read(html, '--dlg-glow-mid'),
                状态判读: (function () {
                  var glowOn = store.get().glow > 0 && store.get().motion > 0;
                  return glowOn && document.getElementById(PKG + '/glow') !== null
                    ? '光效已启用：光晕在 --dlg-px/--dlg-py 处跟随指针，静止呼吸、点击脉冲、300ms 拖影均激活；侧栏/标题栏上自动隐藏'
                    : '光效未启用：把 glow 和 motion 都设为 1 后刷新页面';
                })()
              },
              液态玻璃_hover: {
                '液态开关 liquid': store.get().liquid,
                '液态材质 --dlg-liquid-spot': read(html, '--dlg-liquid-spot'),
                '液态材质 --dlg-liquid-sheen': read(html, '--dlg-liquid-sheen'),
                'hover 按钮 --dlg-glow-x': (function () {
                  var el = document.querySelector('button:hover, button:focus-visible');
                  return el ? el.style.getPropertyValue('--dlg-glow-x') || '(未写入，指针不在按钮上?)' : '(当前无 hover 按钮)';
                })(),
                'hover 按钮 --dlg-glow-y': (function () {
                  var el = document.querySelector('button:hover, button:focus-visible');
                  return el ? el.style.getPropertyValue('--dlg-glow-y') || '(未写入)' : '(当前无 hover 按钮)';
                })(),
                状态判读: '鼠标指向任意按钮时，该按钮 ::after 液态层 opacity 0→1 实时出现，高光斑跟随指针（--dlg-glow-x/y 持续更新）；liquid=0 或 motion=0 时关闭'
              },
              光效样式设置: {
                '当前模式 glowStyle': store.get().glowStyle,
                '自定义颜色 glowColor': store.get().glowColor || '(未设置)',
                '液态实透 liquidFill': store.get().liquidFill,
                '色散副光斑 --dlg-glow-prism-a': read(html, '--dlg-glow-prism-a'),
                '色散副光斑 --dlg-glow-prism-b': read(html, '--dlg-glow-prism-b'),
                '液态层实透 --dlg-liquid-fill': read(html, '--dlg-liquid-fill'),
                '侧栏设置按键': count('.dlg-style-fab'),
                '设置面板内按键': count('[role="dialog"] .dlg-style-fab'),
                '玻璃面板': document.getElementById(PKG + '/style-panel') !== null,
                状态判读: '按键本身是 button，自带液态 hover 光效与全局光晕；面板内改模式/颜色/实透即时生效'
              },
              环境背景: {
                'html background-image': (function () {
                  try { return getComputedStyle(html).backgroundImage.slice(0, 64) + '…'; }
                  catch (e) { return '(读不到)'; }
                })(),
                'html background-color': (function () {
                  try { return getComputedStyle(html).backgroundColor; }
                  catch (e) { return '(读不到)'; }
                })(),
                'body background-color': (function () {
                  try { return getComputedStyle(body).backgroundColor; }
                  catch (e) { return '(读不到)'; }
                })()
              },
              判读: {
                一切正常: '内联令牌里 html/body 的 --dsw-alias-bg-base 应显示 var(--dlg-base-L)，主题令牌解析值应解析成 rgba(...)，且 html background-image 应是一组 radial/linear 渐变（环境壁纸）、body background-color 应带 alpha',
                内联没写进去: '内联令牌三项都是「(空)」→ 内联写入失败，看控制台报错',
                令牌没生效: '主题令牌解析值仍是 #fff → 有别的插件也在内联覆盖同一令牌，是最后的竞争关系',
                环境背景缺失: 'html background-image 是 none → 壁纸没铺上，玻璃没有可折射的底，视觉效果会趋近于零'
              }
            };
            console.log('%c dsh-liquid-glass 自检 ', 'background:#3b82f6;color:#fff;padding:2px 6px;border-radius:3px');
            console.log(JSON.stringify(report, null, 2));
            return report;
          }
        };
        window.__dshLiquidGlass = api;
      } catch (_) { /* 无 window 环境忽略 */ }

      // 7) 清理：Cordis 撤销本插件运行时把一切还原
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function dispose() {
            try {
              unsubscribe();
              detachPointer();
              detachScroll();
              detachPress();
              detachOverlay();
              detachGlow();
              detachLiquid();
              if (detachStylePanel) detachStylePanel();
              detachTheme();

              // 7a) 属性类标记与临时类
              var targets = [html, body];
              for (var t = 0; t < targets.length; t += 1) {
                var el = targets[t];
                el.removeAttribute(ROOT_ATTR);
                el.removeAttribute('data-dlg-safe');
                el.removeAttribute('data-dlg-peers');
                el.removeAttribute('data-dlg-scrolling');
                el.removeAttribute('data-dlg-wallpaper-own');
                el.removeAttribute(MOTION_ATTR);
              }
              var pressed = [];
              try { pressed = document.querySelectorAll('.dlg-press'); } catch (_) { pressed = []; }
              for (var p = 0; p < pressed.length; p += 1) {
                if (pressed[p].classList) pressed[p].classList.remove('dlg-press');
              }

              // 7b) 先按备份精确还原被内联覆盖的宿主令牌，
              //     再兜底摘掉本插件自建的变量（备份里为空的那些）。
              for (var b = 0; b < backups.length; b += 1) restoreInline(backups[b]);
              for (var i2 = 0; i2 < targets.length; i2 += 1) {
                for (var j = 0; j < OWN_VAR_NAMES.length; j += 1) {
                  targets[i2].style.removeProperty(OWN_VAR_NAMES[j]);
                }
              }

              var node = document.getElementById(STYLE_ID);
              if (node && node.parentNode) node.parentNode.removeChild(node);
              if (window.__dshLiquidGlass === api) delete window.__dshLiquidGlass;
              if (window.__dlgLiquidActive) delete window.__dlgLiquidActive;
            } catch (_) { /* 清理失败不应抛到宿主 */ }
          };
        }, PKG + ': liquid glass surfaces');
      }
    }

    module.exports = {
      name: PKG,
      inject: [],
      apply: apply
    };
    return module.exports;
  }
});
