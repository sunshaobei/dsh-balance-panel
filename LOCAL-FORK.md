# dsh-quota-panel — 本地分支

本目录是 [wenzetan/dsh-quota-panel](https://github.com/wenzetan/dsh-quota-panel) 的本地分支，
已按需调整为**侧边栏内嵌面板**：作为 Settings 按钮上方的一个常驻 item 面板显示余额/用量，
支持折叠态（紧凑行）与点击展开（完整卡片）。

- 上游版本：`0.9.2-rc.1`
- 本地版本：`0.9.2-rc.1-local.12`
- 安装方式：`file:` 本地 tarball（真实拷贝，非 symlink）

## 安装方式（重要）

DSH 的 `web` profile 使用 `nodeLinker: hoisted`，且 `dsh plugin add <本地路径>`
会**始终**把本地路径解析成 `link:`（symlink）。要走「真实拷贝」必须打包成 tarball：

```bash
cd /Users/sunshaobei/DeepSeek/dsh-quota-panel
pnpm pack --pack-destination dist          # 生成 dist/dsh-quota-panel-<ver>.tgz
cd ~/.dsh/profiles/web
rm -f node_modules/dsh-quota-panel         # 清掉残留 symlink（pnpm 不会自动清）
pnpm add file:/Users/sunshaobei/DeepSeek/dsh-quota-panel/dist/dsh-quota-panel-0.9.2-rc.1-local.12.tgz
```

`pnpm add` 会沿用已存在的 `link:` 解析结果，所以**必须先删掉 symlink**，
否则即使指定 tarball 也仍然装成软链。

改完源码后需要重新 `pnpm pack` 并重装（拷贝态不会自动跟随源码变化）。

## 相对上游的改动

### 1. 从「悬浮悬浮胶囊」改为「侧边栏内嵌 item 面板」（核心改动）

**上游**：把组件注册进 `shell.overlay` 插槽，渲染成一个 `position:fixed` 的可拖拽悬浮胶囊。

**本分支**：改为注册进 **`sidebar.footer.action`** 插槽，渲染成侧边栏布局里的普通块级 item，
位于 Settings 按钮（`settingsArea`）正上方，不再悬浮、不再可拖拽、不遮挡页面。

具体改动：

- 插槽：`shell.overlay` → `sidebar.footer.action`（一个 flex 子节点，位于 `settingsArea` 之上）。
- 移除所有拖动逻辑（`startDrag`/`moveDrag`/`endDrag`/`dragHandlers`/`clampPos`）和定位锚点逻辑
  （`findSettingsTrigger`/`settingsAnchor`/`ANCHOR_GAP`/`DRAG_*`）。
- 移除 `OVERLAY_LIFT_CSS`（不再需要抬高 overlay 层级）。
- 面板改为 `width:100%` 的块级卡片，折叠时是一行紧凑胶囊，展开是完整卡片。
- `sidebar.footer.action` 是 list 插槽，`id: "dsh-quota-panel", order: 20`，
  与上游 cordis 面板（order 0）共存，仍位于 Settings 上方。

> 侧边栏使用 CSS-module 哈希类名，哈希随构建变化，因此**不依赖任何类名/test-id**，
> 只通过稳定的 `sidebar.footer.action` 插槽挂载 —— 这是 DSH 提供的第一方扩展点。

### 2. 折叠态 / 展开交互

- 默认折叠态：`React.useState(false)` → 渲染紧凑行 `● ¥58.36 · ● 20%`
- 点击该行展开：`setExpanded(true)` → 展开为完整卡片（模型额度 + 各 provider 行 + 进度条）
- 卡片头部 `▴` 收起：`setExpanded(false)`
- `aria-expanded` 在折叠态为 `false`

### 3. 侧边栏收起（rail）态：显示图标

侧边栏折叠成窄轨道（约 36px 宽）时，`sidebar.footer.action` 插槽会收到 `wide: false`
（由 SidebarRoot 的 `renderSlot("sidebar.footer.action", { wide })` 传入）。此时：

- 面板渲染成一个**36px 的图标按钮**（⚡），居中对齐，与工具栏图标风格一致。
- 点击图标 → 调用 `ctx.layout.toggleSidebar()` **展开侧边栏**，同时 `setExpanded(true)`
  打开面板，于是完整卡片在展开后的宽侧边栏里显示。
- rail 态永不显示卡片（即使 `expanded` 为 true，也仍渲染图标，见 `if (!wide)` 兜底分支）。

为此在 `inject` 列表追加了 `"layout"` 服务（`ctx.layout.toggleSidebar()`，
与侧边栏插件 `dsh-client-ui-sidebar` 用法一致）。

宽侧边栏（`wide: true`）时行为不变：正常显示紧凑行 / 展开卡片。

> **排查记录（重要根因）**：之前 rail 态一直显示紧凑行而非图标，是因为插槽的
> render 函数只把 `t` 传给了 `QuotaPanel`，**把侧边栏下发的 `wide` 给丢掉了**。
> 于是 `QuotaPanel` 里 `props.wide` 永远为 `undefined` → `wide = true` → 铁路分支
> 从不触发，只渲染紧凑行。修复：render 函数改为 `QuotaPanel({ t: props.t, wide: props.wide })`，
> 并恢复 `var wide = props.wide !== false`。
>
> 期间误试过两种方案并已回退：
> - 用 `ResizeObserver` 测容器宽度 → 不可靠（rail 态 `footerActions` 是 `width:auto`，
>   边框宽被内容撑开，阈值失效）；
> - 订阅 layout store 的 `useStore` → `sidebar.footer.action` 是根作用域子插槽，
>   `storeOf` 只对声明了 `store` 的条目生效，我的条目没声明 store，拿不到 useStore。
>
> 结论：用 DSH 第一方下发的 `wide` prop（`ownerProps`），且必须把它**显式转发**进组件。

## 构建与校验

上游 npm 包只发布 `lib`、`src`、`cordis.patch.yml`，**未附带构建脚本**，
因此本分支补了一个等价的 `scripts/build.mjs`（用 TypeScript 转译，保留
`window.__ModuleLoader__.load` 包装，并做类型检查）。

```bash
node scripts/build.mjs          # src/client.ts -> lib/client.js
node scripts/verify-inline.mjs  # 校验：注册进内嵌插槽、无 fixed/拖动、折叠可展开
```

> `lib/index.js`（宿主侧）保持上游原样，未做任何改动。

## 生效方式

插件 bundle 在 DSH 启动时加载，**改动后需要重启 DSH Web**，刷新页面不够。
重启后在侧边栏 Settings 按钮上方应能看到常驻配额行。
