# PRD：配置模板中心（plugin-config-template-hub）

| 项       | 内容                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| 产品名称 | 配置模板中心                                                                                                  |
| 插件 ID  | `plugin-config-template-hub`                                                                                  |
| 插件类型 | 通用插件（GUI.for.SingBox 与 GUI.for.Clash 双端通用）                                                         |
| 目录位置 | `plugins/generic.json`（group: `Tools`），源码 `src/plugins/Generic/plugin-config-template-hub.ts`            |
| 版本     | v1.0.0（首个版本，含导入记录与合并更新）                                                                      |
| 状态     | 已实现（待双端手动回归）                                                                                      |
| 参考资料 | 客户端 `PluginHub.vue`、`RulesetHub.vue`、`plugin-native-config-manager.ts`、`plugin-subscribe-collection.ts` |

---

## 1. 背景与目标

### 1.1 背景

GUI.for.Cores 两款客户端的「配置（Profile）」均为**应用托管配置**：应用把用户在编辑器里维护的
结构化数据（入站、出站分组、路由规则、DNS 等）在启动内核时生成最终运行时配置。用户想从一份
现成的完整配置（例如社区流传的 sing-box JSON / mihomo YAML）快速起步时，目前只能手动逐段抄进
编辑器，门槛高、易错。

同时，插件仓库（Plugin-Hub）已有「插件中心」「规则中心」两类Hub形态的聚合页，交互成熟；
缺少一个对应「配置」资源的中心。

### 1.2 目标

提供一个通用插件「配置模板中心」：

1. 在插件仓库集中维护一批**可直接运行的最终配置模板**（sing-box JSON / mihomo YAML），
   由社区共同贡献、持续更新。
2. 用户在插件 UI 中浏览、搜索、查看模板全文，可在详情页临时修改正文，一键导入为应用托管配置。
3. 导入复用宿主自身的 `Plugins.restoreProfile`，诚实告知转换损失。
4. 本地记录导入历史（模板 ID → 导入记录数组，同一模板可多次导入为多份配置），
   卡片标「已导入」，详情页逐条展示导入信息。
5. 每次打开 UI 自动更新模板清单；清单有变化时弹窗展示新增、删除、变更。
6. 模板升级（版本高于导入时版本）时提供**合并更新**：递归深合并，同名字段以已导入配置为准，
   保留用户对配置的修改；每条导入记录独立判断与更新，一份模板导入的多份配置互不影响。

### 1.3 非目标（本期不做）

- 不在插件内编辑导入后的配置（沿用客户端配置编辑器）；详情页的模板编辑仅作用于本次导入，不写回模板仓库。
- 不做已导入配置的**自动**同步/更新——更新需用户在详情页手动点击「合并更新」（§8.5）。
- 不做合并更新的字段级 diff 预览（列入后续版本，见 §13）。
- 不做模板的内核 `check` 校验（列入后续版本，见 §13）。
- 不做模板签名、审核自动化；质量靠 README 的贡献规范与人工评审。

---

## 2. 用户与核心场景

**用户**：GUI.for.Cores 两款客户端的用户，尤其是新用户或想换一套成熟分流方案的用户。

**场景 1（浏览与查看）**：用户从「配置」页头部的「模板中心」入口打开插件，搜索「TUN」，
找到感兴趣模板，点「查看」阅读模板全文与作者、版本、说明等信息。

**场景 2（导入）**：用户在查看窗口点击「导入此模板」，阅读转换损失提示并确认后，
配置列表出现一份以模板命名的新配置；用户在配置编辑器中补全节点引用后即可启用。

**场景 3（清单更新与合并升级）**：数周后用户再次打开模板中心，插件自动拉取清单并弹窗提示
「模板清单有更新」；打开已导入模板的详情页，看到「模板已有新版本，可合并更新」，
点击「合并更新」后插件把新版模板转换结果与现有配置递归深合并，用户此前的修改得以保留。

**场景 4（贡献）**：模板作者按 README 指引 fork 仓库、放置模板文件、登记清单、提交 PR。

---

## 3. 模板资源仓库布局

模板资源为**静态文件**，置于仓库 `plugins/Resources/plugin-config-template-hub/`，随仓库分发
（与 `plugin-skin-manager` 等资源目录同模式），运行时经 GitHub raw URL 拉取。

```
plugins/Resources/plugin-config-template-hub/
├── README.md          # 面向社区贡献者的说明（见 §11）
├── gfc.json           # GUI.for.Clash  模板清单（数组）
├── gfs.json           # GUI.for.SingBox 模板清单（数组）
├── gfc/               # GUI.for.Clash  模板正文（mihomo 最终运行时 YAML）
│   └── <模板ID>.yaml
└── gfs/               # GUI.for.SingBox 模板正文（sing-box 最终运行时 JSON）
    └── <模板ID>.json
```

约定：

- 两个清单相互独立：一份模板可以只服务一个客户端；若同一模板双端各有一份等价实现，
  则两清单各登记一条、使用**相同模板 ID**、正文分别放 `gfs/<ID>.json` 与 `gfc/<ID>.yaml`。
- 模板正文是**最终运行时配置**（内核直接可用的完整配置），不是应用托管配置
  （不是 `App.Profile` 结构、不是应用「配置编辑器」的导出格式）。
- 正文编码 UTF-8；GFS 为不带注释的标准 JSON；GFC 为标准 YAML。

---

## 4. 清单数据结构（gfc.json / gfs.json）

清单为**模板条目数组**，数组顺序即展示顺序（作者手工编排，插件不重排）。

### 4.1 字段定义

| 字段          | 必填 | 类型       | 说明                                                                                                                 |
| ------------- | ---- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`          | ✅   | `string`   | 模板 ID，同时是模板文件名（不含扩展名），kebab-case，建议 `config-` 前缀，如 `config-sing-box-example`。清单内唯一。 |
| `name`        | ✅   | `string`   | 在插件 UI 显示的名称。                                                                                               |
| `description` | ✅   | `string`   | 模板用途、特点的简要描述。卡片上单行截断，悬停显示全文。                                                             |
| `author`      | ✅   | `string`   | 模板发布者（ID 或昵称）。                                                                                            |
| `version`     | 建议 | `string`   | 模板自身版本，`v x.y.z`。内容变更时递增，便于使用者判断新旧。**版本递增是用户端「可合并更新」提示的依据（§8.3）。**  |
| `tags`        | 建议 | `string[]` | 标签，用于搜索与详情页展示，如 `["TUN", "流媒体", "入门"]`。                                                         |
| `group`       | 建议 | `string`   | 分组名，卡片列表按其分节展示（缺省归入「通用」）。                                                                   |
| `homepage`    | 建议 | `string`   | 模板来源主页 / 仓库链接，详情页提供跳转。                                                                            |
| `updatedAt`   | 建议 | `string`   | 最后更新日期，`YYYY-MM-DD`。                                                                                         |
| `notes`       | 可选 | `string`   | 导入注意事项（纯文本，支持 `\n` 换行），展示在详情页信息区。                                                         |

- 未知字段插件忽略，向前兼容。
- 缺失必填字段（`id`、`name`、`description`、`author`）的条目跳过不展示，
  并 `Plugins.LogWarning` 记录被跳过的 `id`。

### 4.2 示例（gfs.json）

```json
[
  {
    "id": "config-sing-box-example",
    "name": "SingBox 示例模板",
    "description": "由 LLM 生成的 sing-box 示例条目：仅演示模板格式与导入流程，未经生产环境验证，请勿直接用于生产。",
    "author": "LLM",
    "version": "v1.0.0",
    "tags": ["示例", "LLM 生成"],
    "group": "示例",
    "homepage": "https://github.com/GUI-for-Cores/Plugin-Hub/tree/main/plugins/Resources/plugin-config-template-hub",
    "updatedAt": "2026-11-10",
    "notes": "分组按标签匹配订阅节点；未匹配到的分组会在导入后为空，请在配置编辑器中调整。"
  }
]
```

### 4.3 模板正文编写要求

1. **必须是完整、可直接运行的最终配置**：GFS 能通过 `sing-box check -c`；GFC 能通过
   `mihomo -t`。提交前请自测。
2. **省略会与应用冲突的字段**：
   - GFS：省略 `experimental.clash_api.external_controller` / `secret`（导入后由应用默认值接管，
     避免面板端口/密钥与用户设置冲突）。
   - GFC：省略 `external-controller` 与 `secret`（同理）。
3. **节点引用方式**：模板一般**不内嵌真实节点**（含隐私信息且无法通用），
   出站分组通过 `tag` 引用节点，导入时由插件按 §7.3 规则解析；也可以内嵌演示节点，
   但须为虚构占位数据。
4. **不含隐私信息**：不得包含真实订阅链接、Token、服务器地址、个人域名等。
5. 文件命名与清单 `id` 严格一致。

---

## 5. 插件设计

### 5.1 基本信息与目录项

```json
{
  "id": "plugin-config-template-hub",
  "name": "配置模板中心",
  "version": "v1.0.0",
  "group": "Tools",
  "description": "浏览并预览运行时配置模板，一键导入为托管配置；自动跟踪清单更新，记录导入历史并支持合并升级已导入配置。",
  "tags": ["实用工具", "功能扩展"],
  "type": "Http",
  "url": "https://raw.githubusercontent.com/GUI-for-Cores/Plugin-Hub/main/plugins/Generic/plugin-config-template-hub.js",
  "path": "data/plugins/plugin-config-template-hub.js",
  "triggers": ["on::manual", "on::ready"],
  "hasUI": true,
  "menus": { "打开模板中心": "OpenHub" },
  "context": { "profiles": {}, "subscriptions": {}, "rulesets": {}, "plugins": {}, "scheduledtasks": {} },
  "status": 0,
  "configuration": [ ... 见 §5.4 ]
}
```

### 5.2 客户端识别

```ts
const IS_GFS = Plugins.APP_TITLE.includes('SingBox') // 'GUI.for.SingBox' | 'GUI.for.Clash'
```

由其决定：清单文件（`gfs.json` / `gfc.json`）、模板目录与扩展名（`gfs/<id>.json` /
`gfc/<id>.yaml`）、解析方式（`JSON.parse` / `Plugins.YAML.parse`）、`restoreProfile` 调用形态、
CodeEditor 语言（`json` / `yaml`）。

### 5.3 资源地址

- 默认基址（常量）：
  `https://raw.githubusercontent.com/GUI-for-Cores/Plugin-Hub/main/plugins/Resources/plugin-config-template-hub/`
- 清单：`<base><gfs|gfc>.json`；模板：`<base><gfs|gfc>/<id>.<json|yaml>`。
- 用户可在插件配置中覆盖基址（镜像加速），见 §5.4。
- 拉取一律用 `Plugins.Requests({ method: 'GET', url, autoTransformBody: false })`，
  统一得到字符串后自行解析，避免 JSON 自动转换在 YAML/文本上的歧义。

### 5.4 配置项（catalog `configuration`）

| key                | 组件     | 默认   | 说明                                                             |
| ------------------ | -------- | ------ | ---------------------------------------------------------------- |
| `BaseUrl`          | `Input`  | `''`   | 模板源地址覆盖（镜像）。空则用默认基址；填写后自动补齐末尾 `/`。 |
| `ShowHeaderAction` | `Switch` | `true` | 是否在「配置」页头部显示「模板中心」入口按钮。                   |

### 5.5 生命周期

| 处理器              | 行为                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onReady`           | `ShowHeaderAction !== false` 时，`Plugins.useAppStore().addCustomActions('profiles_header', { id, component: 'Button', componentProps: { type: 'link', onClick: openHub }, componentSlots: { default: '模板中心' } })`。 |
| `onRun` / `OpenHub` | 打开模板中心主窗口（§6.2），并触发清单自动更新（§9）。                                                                                                                                                                   |
| `onConfigure`       | 配置变更后重挂头部入口（按 `ShowHeaderAction` 先 `removeCustomActions` 再按需 `addCustomActions`）。                                                                                                                     |
| `onDispose`         | `removeCustomActions('profiles_header', id)`；无定时器、无服务需清理。                                                                                                                                                   |
| `onInstall`         | 建目录 `data/third/plugin-config-template-hub/`（导入记录与清单缓存的父目录，文件在首次写入时创建）。                                                                                                                    |
| `onUninstall`       | `RemoveFile` 清理 `data/third/plugin-config-template-hub/`（经 `Plugins.ignoredError` 容错，不存在不报错）。                                                                                                             |

---

## 6. UI 规范

### 6.1 入口

1. **配置页头部**（主入口）：`profiles_header` 自定义动作，文字按钮「模板中心」。
2. **插件卡片菜单**：右键「打开模板中心」（`menus` → `OpenHub`）；手动运行插件同样打开主窗口。

### 6.2 主窗口（模板列表）

参照 `PluginHub.vue`：`Plugins.modal({ title: '配置模板中心', submit: false, cancelText: '关闭', width: '90', height: '90' })`，主体用宿主 `ModalContainer`。
顶部插槽（`toolbar`）放 **「贡献指南」** 按钮：点击打开独立窗口，内容为插件资源目录下的 `README.md`，
由宿主 `MarkdownViewer` 渲染；正文首次打开时拉取并缓存到本地 `data/third/<plugin-id>/README.md`，
之后优先读缓存，读取失败再回退远端。不再跳转浏览器。

```
┌──────────────────────────────────────────────────────────────┐
│ 配置模板中心                                                 │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 🔍 共 1 个模板                                  [刷新]    │ │  ← 顶栏：搜索框 + 刷新
│ └──────────────────────────────────────────────────────────┘ │
│ 示例                                                          │  ← 分组标题（sticky）
│ ┌────────────────────────────┐                                │
│ │ SingBox 示例模板     [👁]  │                                │  ← 名称 + 查看按钮
│ │ LLM 生成示例，仅演示…      │                                │  ← 描述（单行截断，悬停全文）
│ │ GUI-for-Cores · v1.0.0 已导入│                               │  ← 元信息行 + 已导入标签
│ └────────────────────────────┘                                │
└──────────────────────────────────────────────────────────────┘
```

- **打开行为**：先读本地数据（导入记录 `records.json` + 清单缓存 `manifest.json`）立即渲染，
  随后**每次打开都后台自动拉取最新清单**（§9）；本地无缓存清单时窗口先显示空态，
  拉取成功后原地填充。
- **搜索**：`Input` + `Icon search`，placeholder `共 {n} 个模板`；用 `Plugins.createTextMatcher`
  匹配 `name + description + author + tags.join('')`（不区分大小写），空态用 `Empty`，
  `#description` 内置「刷新」按钮。
- **刷新**：重新拉取当前客户端清单（与自动更新同一流程，§9）；按钮 `loading` 态。
- **卡片**：`grid grid-cols-2 gap-8`；`Card` 设 `min-width: 0`，保证长描述/长 URL 不撑宽列宽。
  `#title-prefix` 放名称（`text-14 font-bold line-clamp-1`），
  `#extra` 放「查看」按钮（`Button type="text" icon="preview" size="small"`）；正文两行：
  描述（`line-clamp-1 break-all` + `v-tips` 全文悬停）、元信息（`text-12 line-clamp-1`：`作者 · 版本`）。
  元信息行右侧：该模板存在导入记录时显示绿色 `Tag`「**已导入**」，多条时显示
  「**已导入 ×n**」（§8）；`Tag` 固定 `shrink-0`，不随文本挤压。
- **分组**：按清单 `group` 字段分节，标题 `text-16 font-bold px-4 py-12 sticky top-0 z-9`；
  组间顺序按清单首次出现顺序；无 `group` 归入「通用」。
- 模板数量暂不 pagination（清单规模小）；超过 50 条时列入 P2（RulesetHub 分页模式）。

### 6.3 查看窗口（模板详情）

点「查看」打开详情窗口：`Plugins.modal({ title: 模板名, submit: false, cancelText: '关闭', width: '80', height: '80', px: 0, py: 0 })`（比主窗口与预览窗口的 `90 × 90` 略小）。
详情仅展示**元信息与操作**，模板正文的预览与编辑独立成第二个窗口（§6.4），避免上下布局拥挤、操作区被编辑器遮挡。

```
┌──────────────────────────────────────────────────────────────┐
│ 名称  [v1.0.0] 标签…                              [来源]     │  ← 顶部插槽：操作
├──────────────────────────────────────────────────────────────┤
│ ┌ Card：基本信息 ──────────────────────────────────────────┐ │
│ │ 名称  [v1.0.0] 标签…          [已修改] [导入此模板]       │ │  ← 与名称同行，右侧贴边
│ │ 作者 · 更新于 2026-…                          [预览模板]  │ │  ← 预览按钮与作者同行
│ │ 简介：……                                                  │ │  ← 长信息另起一行
│ │ 注意事项：……                                               │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌ Card：已导入配置（n 份） ────────────────────────────────┐ │  ← 导入记录（§8.2）
│ │ 配置 xxx  [可更新]  导入于 …  模板版本 …      [合并更新] │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌ Card：转换提示 ──────────────────────────────────────────┐ │
│ │ 转换提示：……                                               │ │
│ │ 加载状态 / 辅助说明                                        │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- **区块分层**：详情内容按「基本信息」「已导入配置」「转换提示」分成三张宿主 `Card`，
  卡片间距 `gap-12`，内层再留 `p-8`，与窗口底色形成层次。
- **顶部插槽（`toolbar`）**：仅**「来源」**（`Button type="link"` 调 `Plugins.OpenURI(homepage)`，有 `homepage` 时显示）。
- **基本信息卡首行**：名称、版本 `Tag`、标签 `Tag` 组；右侧 `ml-auto` 容器内先置**「已修改」**
  橙色 `Tag`（正文与原文不一致时显示），再置**「导入此模板」**
  （`Button type="primary"`，加载中显示 loading），整体贴右。
- **基本信息卡次行**：作者、更新日期；**「预览模板」**（`Button type="normal" size="small"`，
  `icon="preview"`）置 `ml-auto` 贴右，打开 §6.4 编辑窗口。
- **已导入块**（§8.2）：存在导入记录时以纵向列表展示，**每条导入记录一行**
  （`var(--card-bg)` 底色）：配置名 + （该记录可合并更新时）橙色 `Tag`「可更新」、
  导入时间（`YYYY-MM-DD HH:mm:ss`）、导入时模板版本；可合并更新时（§8.4）行尾附
  「合并更新」按钮（`Button type="primary" size="small"`）；该记录的配置已被删除时显示
  「导入的配置已不存在，可重新导入」（下次打开 UI 会被清理，§8.2）。
- **转换提示**：常驻文本块，文案见 §7.2。
- **底部状态行**：显示正文加载状态或辅助说明「导入会新建一份配置，不影响当前配置」；
  「贡献指南」已移至主窗口顶部插槽（§6.2）。
- 正文在详情打开时即**预取**（本次会话内缓存），不依赖编辑器组件挂载；不在本地落盘。

### 6.4 预览 / 编辑窗口

从详情点「预览模板」打开独立窗口：
`Plugins.modal({ title: '预览 / 编辑 — 模板名', submit: false, cancelText: '关闭', width: '90', height: '90', px: 12, py: 12 })`。
内容为纵向布局，根容器高度 `100%`（`min-height: 0`），恰好填满模态正文区，不再额外撑出外层滚动。

```
┌──────────────────────────────────────────────────────────────┐
│ 预览 / 编辑 — 模板名                 [重置修改] [重新加载]     │  ← 顶部插槽
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ {  ← CodeEditor（可编辑，撑满正文区）                     │ │
│ │   "log": { ... },                                        │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ 已修改，导入与合并更新将使用当前内容                    [关闭] │  ← 底部左侧提示
└──────────────────────────────────────────────────────────────┘
```

- **预览区**（`flex-1`，`min-height: 0`）：`CodeEditor`（`lang` 按客户端 `json` / `yaml`，可编辑），
  撑满剩余高度；仅编辑器内部 `cm-scroller` 滚动，外层模态正文不出现第二条滚动条。
- **顶部插槽（`toolbar`）**：**「重置修改」**（仅 `contentDirty` 时显示）、**「重新加载」**（`loading` 态）。
- **底部左侧提示**（`action` 插槽 + `mr-auto`）：`contentDirty`（当前内容 ≠ 原始内容）时显示
  「已修改，导入与合并更新将使用当前内容」，否则留空。
- 编辑内容仅用于**本次导入与合并更新**：`doImport`、`doMergeUpdate` 均优先解析当前编辑器内容，
  不回写模板缓存与远端仓库。
- 「重新加载」强制跳过会话缓存重新请求远端正文并覆盖当前编辑；拉取中显示居中
  `<Icon icon="loading" class="rotation" />`；拉取失败显示 `Empty` + 错误信息 + 「重试」按钮。
- 关闭编辑窗口不丢弃临时修改；再次打开仍显示当前内容，直至「重置修改」或「重新加载」。

---

## 7. 导入逻辑（核心）

### 7.1 总则

导入复用宿主 `Plugins.restoreProfile`（`@/utils/restorer`，经 `Plugins.*` 暴露）：
**内核最终配置 → 应用托管配置（`App.Profile`）** 的转换完全交给宿主实现，
插件不做二次解释；随后 `Plugins.useProfilesStore().addProfile(profile)` 入库。
新配置 `id` 由转换器生成（`sampleID`），**重复导入同一模板会得到多份配置**（允许）；
每次导入成功后向导入记录（§8.1）**追加**一条指向新配置的记录，互不覆盖。

导入正文来源：详情窗口预取并可能被用户临时编辑的正文；用户未打开过编辑窗口时按需拉取远端模板。
「合并更新」同样优先使用当前正文（含临时修改），仅在无正文时拉取远端模板。

### 7.2 转换损失提示（必须展示）

`restoreProfile` 只解析应用支持的配置段，模板内容可能丢失。提示文案出现在两处：
查看窗口信息区常驻提示块 + 点击导入时的确认弹窗。

确认弹窗（`Plugins.confirm`，标题「导入模板」）文案：

> 该模板将被转换为应用托管配置。应用仅保留其支持的配置段（入站、出站分组、路由规则、DNS 等），
> 模板中的其余内容不会原样保留：
> · SingBox：分组内节点按 tag 与现有订阅匹配，未匹配到的节点与引用它们的规则出站会丢失或为空；
> · Clash：仅保留内置出站与分组间引用，模板内嵌节点及其规则会被丢弃；
> 导入后请打开配置编辑器检查并补全节点引用。确定要导入「{模板名}」吗？

按钮：`okText: '仍要导入'`。

### 7.3 双端调用形态

**GUI.for.SingBox（IS_GFS）**

```ts
const parsed = JSON.parse(text)                                  // 失败 → 报错中止
const subscribes = Plugins.useSubscribesStore().subscribes ?? []
const profile = Plugins.restoreProfile(parsed, template.name, {
  subscriptionIds: subscribes.map((s) => s.id),                  // 全量订阅参与 tag 匹配
})
await Plugins.useProfilesStore().addProfile(profile)
```

- 传入全部订阅 ID，让分组内叶子节点尽可能按 `tag` 命中订阅节点（命中者以订阅节点入组，
  组还可能按 include/exclude 收敛为整订阅引用）；未命中的引用丢失，规则 `outbound` 可能为空。
- 模板 `name` 作为配置名。

**GUI.for.Clash（else 分支）**

```ts
const parsed = Plugins.YAML.parse(text)                          // 失败 → 报错中止
const profile = Plugins.restoreProfile(parsed, Plugins.sampleID(), {}, {})
profile.name = template.name
await Plugins.useProfilesStore().addProfile(profile)
```

- 空的 `NameIdMap` / `IdNameMap`（无订阅上下文）：`proxies` 不入库；
  `proxy-groups` 仅保留内置出站（DIRECT/REJECT…）与组间引用成员，引用叶节点的成员被过滤，
  引用叶节点的规则被跳过（宿主 restorer 内建行为）；`general` / `advanced` / `dns` / `tun` /
  `hosts` / `sniffer` 支持段正常保留；命中 GEO 规则时 `geodata-mode` 自动开启。

### 7.4 流程与异常

1. 确认弹窗 → 取消则终止。
2. 取模板正文（详情窗口已加载则复用；否则即时拉取）→ 网络失败：`Plugins.message.error('模板获取失败：' + err)`，终止。
3. 解析（JSON / YAML）→ 失败：`Plugins.message.error('模板解析失败：' + err)`，终止。
4. `restoreProfile` → `addProfile` → 任何异常 `message.error('导入失败：' + err.message)`，终止。
5. 成功：写入导入记录（§8.1）并落盘；`Plugins.message.success('已导入「{模板名}」，请在配置列表查看')`；
   详情窗口保持打开，用户可继续浏览或再导入。
6. 不自动切换当前使用的配置；不自动启动内核。

---

## 8. 导入记录与合并更新（核心）

### 8.1 本地数据布局

```
data/third/plugin-config-template-hub/
├── records.json    # 导入记录映射表（模板 ID → 导入记录数组）
└── manifest.json   # 最近一次成功拉取的清单缓存（下次打开首屏渲染用，§9）
```

`records.json` 结构（`模板 ID → ImportRecord[]` 映射表，**同一模板可多次导入，
每份配置一条记录**）：

```json
{
  "config-sing-box-example": [
    { "profileId": "abc123", "importedAt": 1762700000000, "version": "v1.0.0" },
    { "profileId": "def456", "importedAt": 1762800000000, "version": "v1.1.0" }
  ]
}
```

| 字段         | 说明                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| `profileId`  | 该次导入生成的托管配置 ID（合并更新时为原配置 ID）。                    |
| `importedAt` | 该次导入（或合并更新）完成时间戳，详情页以 `YYYY-MM-DD HH:mm:ss` 展示。 |
| `version`    | 该次导入（或合并更新）时模板的 `version`，清单未提供时为空串。          |

- 写入时机：导入成功（§7.4）后向对应数组**追加**新记录；合并更新成功（§8.5）后仅**原地
  更新**该条记录；随后整体写盘（2 空格缩进 JSON）。
- 读取时机：每次打开主窗口时读入内存并规整（`normalizeRecords`：值统一为数组、兼容旧版
  单条格式、剔除缺 `profileId` 的非法条目）；文件缺失或解析失败按空 `{}` 处理（不报错）。

### 8.2 失效记录清理（每次打开 UI 检测）

清单拉取成功后执行 `purgeStaleRecords`，按模板逐条记录做两级检查并写盘：

1. **远程模板已不存在**：最新清单中已无该模板 ID → **删除该模板的整条数据**（全部记录）；
2. **特定导入的配置已不存在**：某条记录的 `profileId` 在 `useProfilesStore().getProfileById`
   查不到（用户在应用内手动删除了该配置）→ **仅删除该条记录**，其余记录保留；
   记录被删空时整个条目移除。

发生清理时 `Plugins.LogWarning('[plugin-config-template-hub] 已清理失效的导入记录')`。

### 8.3 版本比较

- `parseVersion` 接受 `v?x.y.z`（如 `v1.2.0`、`1.2.0`），按三段数值逐段比较；
- 任一侧缺失或格式不合法视为**不可比较** → 不提供合并更新（宁缺勿误）；
- 合并更新条件：记录版本 **严格小于** 模板当前版本。

### 8.4 触发条件与入口（详情页）

按**每条导入记录**独立判定：`canMerge(记录)` = 该记录的配置仍存在 **且**
该记录版本 < 当前模板版本。

满足时，该条记录的行尾：

- 追加 `Tag`「可更新」；
- 出现内联「**合并更新**」按钮（`Button type="primary" size="small"`，loading 态）。

同一模板的多条记录互不影响：已更新到最新版的记录不再显示按钮，
仍为旧版的记录可继续单独更新。

### 8.5 合并更新流程

1. **确认弹窗**（`Plugins.confirm`，标题「合并更新」，`okText: '合并更新'`）：

   > 模板「{模板名}」已有新版本（{记录版本} → {模板版本}）。
   > 将使用当前预览内容（含你的临时修改）转换为托管配置，再与当前已导入配置递归深合并：
   > 同名字段以已导入配置为准（保留你的修改），模板新增的字段会补入。
   > 确定要合并更新吗？

2. 取当前正文（含 §6.4 临时修改）→ 为空时拉取最新模板正文（会话缓存复用）→ 失败报错终止；
3. 解析（JSON / YAML）→ 失败报错终止；
4. **再次转换**：以该记录 `profileId` 取原配置，以最新模板重新走 §7.3 的 `restoreProfile`
   得到新托管配置 `fresh`——GFS 以旧配置名为配置名、传全量订阅 ID；
   GFC 以旧配置 `id` 作为 `subID`；记录对应配置已不存在时报错终止；
5. **递归深合并**：`merged = Plugins.deepAssign(fresh, Plugins.deepClone(oldProfile))`：

   - 合并方向：`fresh`（新模板转换结果）为目标、已导入配置的深克隆为来源——
     **同名字段以已导入配置为准（保留用户修改）**，模板新增的字段补入；
   - 宿主 `deepAssign` 语义：纯对象字段递归合并；**数组与非对象值整体赋值**
     （数组字段如规则、分组列表以已导入配置为准，模板新增的数组项**不会**逐项追加）；
   - 合并后强制 `merged.id = oldProfile.id`，经 `useProfilesStore().editProfile` **原地写回**，
     不新建配置。

6. **原地更新该条记录**（`version` = 模板当前版本、`importedAt` = 当前时间、`profileId`
   不变），同模板其他记录不变，写盘；
7. 成功提示 `已合并更新「{模板名}」`；任何异常 `message.error('合并更新失败：' + err)`，
   原配置保持不变。

---

## 9. 清单自动更新与变更弹窗

- **触发时机**：每次打开主窗口（`openHub`）在本地数据加载后**后台自动执行一次**；
  顶栏「刷新」按钮复用同一流程。`manifestLoading` 进行中忽略重复触发。
- **流程**（`updateManifest`）：
  1. `fetchManifest`：GET `<base><gfs|gfc>.json` → 校验 HTTP 200、JSON 数组、
     按必填字段过滤条目（跳过项 `LogWarning`）；
  2. 以拉取结果替换内存列表，并把清单**整体写入 `manifest.json` 缓存**（下次打开离线首屏）；
  3. 执行失效记录清理（§8.2）；
  4. 与更新前的内存列表做 **diff**（§9.1），有差异则弹窗（§9.2）。
- **失败处理**：`Plugins.message.error('模板清单更新失败：' + err)`；
  若当前列表为空（无缓存清单）则空态展示错误信息与「刷新」重试按钮；
  已有清单内容时保留缓存内容，不中断浏览。
- **首次拉取不弹窗**：本地无任何清单（首开）时只静默填充，避免误报。

### 9.1 diff 规则（`diffManifests`）

- 按模板 `id` 配对新旧清单；
- **变更**判定：对每个条目取比对字段指纹（`TRACKED_FIELDS`：`name`、`description`、`author`、
  `version`、`tags`、`group`、`homepage`、`updatedAt`、`notes`，缺省以空串参与），
  JSON 序列化后不相等即为变更；
- ID 变化等价为「删除 + 新增」；输出三类集合：`added` / `removed` / `changed`（含新旧条目）。

### 9.2 变更弹窗

`Plugins.alert('模板清单有更新', markdown, { type: 'markdown' })`（关闭无副作用），分节展示：

```markdown
### 新增（n）
- **{名称}** `{id}` {版本}

### 删除（n）
- **{名称}** `{id}`

### 变更（n）
- **{名称}** `{id}`：{旧版本} → {新版本}
```

仅展示非空分节；「变更」行侧重版本迁移信息（与「已导入用户可合并更新」的场景呼应）。

---

## 10. 工程与实现要点（仓库规约）

- 源码：`src/plugins/Generic/plugin-config-template-hub.ts`，单文件 ESM
  `export default (plugin: PluginMetadata): PluginExposed => {...}`；纯函数
  （`parseVersion` / `isVersionLower` / `manifestFingerprint` / `diffManifests` /
  `isTemplateMeta` / `normalizeRecords` / `normalizeError`）置于模块作用域，
  UI 组件与状态全部收在 entry 闭包内；处理器一律箭头函数。
- `restoreProfile` 在 GFS / GFC 两份类型中签名不同（联合类型 `PluginApisGFS | CPluginApis`），
  按 `IS_GFS` 分支后分别以各自签名调用，不做跨端联合调用。
- 涉及的宿主 API：`Requests` / `ReadFile` / `WriteFile` / `FileExists` / `MakeDir` /
  `RemoveFile` / `ignoredError` / `deepAssign` / `deepClone` / `formatDate` / `sampleID` /
  `createTextMatcher` / `YAML.parse` / `OpenURI` / `alert` / `confirm` / `message` /
  `LogWarning` 及各 store。
- 静态资源（README、清单、模板）不参与转译；改插件脚本后执行 `pnpm produce` 更新
  `plugins/Generic/plugin-config-template-hub.js`，并 `pnpm hashes` 刷新目录项 `hash`。
- 无 Node API；全部 I/O 走 `Plugins.*`；不注入外部 JS/CSS；本地仅落
  `data/third/plugin-config-template-hub/` 两个 JSON（§8.1），卸载时清理。
- 验证：`pnpm exec oxlint src/ && pnpm exec oxfmt --check src/ && pnpm exec eslint src/`
  与 `pnpm exec prettier --check plugins/` 通过；`plugins/generic.json` 可解析、`hash` 一致。

---

## 11. README.md（贡献指南）要求

文件：`plugins/Resources/plugin-config-template-hub/README.md`。要求**简单直白、通俗易懂**，
面向不熟悉本仓库的模板作者，至少包含：

1. **这是什么**：一段话说明模板中心插件与模板的用途（最终运行时配置，导入即得托管配置）。
2. **如何贡献一个模板（5 步）**：
   1. Fork 本仓库；
   2. 把模板放到 `gfs/`（sing-box JSON）或 `gfc/`（mihomo YAML），文件名即模板 ID；
   3. 在对应清单 `gfs.json` / `gfc.json` 里照抄示例登记一条（给可直接复制的 JSON 片段）；
   4. 本地自测：`sing-box check -c` / `mihomo -t` 通过，且导入 GUI 后能正常出站；
   5. 提交 PR，描述模板用途与特点。
3. **硬性要求**：完整可运行；不含任何真实隐私（订阅链接、Token、服务器地址）；
   省略 `clash_api`（sing-box）与 `external-controller`/`secret`（mihomo）。
4. **命名规范**：模板 ID kebab-case、建议 `config-` 前缀、清单内唯一。
5. **提交后会发生什么**：维护者评审合并后，用户端刷新清单即可看到；
   后续修改模板内容时**递增 `version`** 并更新 `updatedAt`——版本递增是已导入用户端
   「可合并更新」提示（§8.4）与清单「变更」弹窗（§9.2）的依据。

插件主窗口顶部插槽提供「贡献指南」按钮：优先读取本地缓存 `data/third/<plugin-id>/README.md`，
缺失时从资源基址拉取并落盘，用宿主 `MarkdownViewer` 在独立窗口展示；不跳转浏览器。

---

## 12. 验收标准

**入口与列表**

- [ ] 双端安装插件后，「配置」页头部出现「模板中心」入口；关闭 `ShowHeaderAction` 并重新配置后入口消失；卸载插件后入口不残留。
- [ ] 主窗口列出当前客户端清单全部条目，分组、顺序与清单一致；搜索按名称/描述/作者/标签过滤；「刷新」重拉清单并更新总数。
- [ ] 清单条目缺必填字段时被跳过且有日志；清单拉取失败显示错误与可重试空态。
- [ ] 每次打开主窗口后台自动拉取清单；本地有缓存清单时先渲染缓存再原地刷新。
- [ ] 清单有差异时弹窗分节展示新增/删除/变更；首次拉取（本地无清单）不弹窗；无差异不弹窗。

**查看与导入**

- [ ] 「查看」打开详情窗口：信息区纵向展示完整（短信息一行、描述与 notes 另起一行、含 tags 与来源跳转），下方 CodeEditor 以正确语言显示模板全文且可编辑；正文拉取中有 loading 态，失败有空态重试；编辑后导入使用编辑内容，可一键重置。
- [ ] 主窗口卡片在超长描述 / 无空格长串（URL）下不被撑宽，两列宽度稳定，描述单行截断且悬停显示全文。
- [ ] GFS 导入：配置列表新增以模板命名的配置；分组内节点按 tag 命中订阅（有匹配订阅时）；在配置编辑器中打开无结构错误。
- [ ] GFC 导入：配置列表新增以模板命名的配置；general/tun/dns/hosts/sniffer/分组（内置与组间引用）保留；编辑器打开无结构错误。
- [ ] 导入前展示转换损失提示（信息区常驻 + 确认弹窗），取消不产生任何变更。
- [ ] 模板拉取失败 / 解析失败 / addProfile 失败均有明确报错且不产生半成品配置。

**导入记录与合并更新**

- [ ] 导入成功后 `data/third/plugin-config-template-hub/records.json` 对应模板 ID **追加**一条 `{profileId, importedAt, version}`；重复导入同一模板产生多条记录，每条指向各自配置。
- [ ] 已导入模板的卡片显示「已导入」标签（多条时「已导入 ×n」）；详情页已导入块逐条展示（配置名、导入时间、导入时模板版本）。
- [ ] 删除已导入的其中一份配置后重新打开 UI：仅该条记录被清理、其余保留并写盘，日志有记录；远程模板被移除时整条数据删除；详情页在配置缺失时显示「导入的配置已不存在，可重新导入」。
- [ ] 清单缓存 `manifest.json` 在每次成功拉取后更新，下次打开首屏可见。
- [ ] 模板版本高于某条记录版本时：仅该条记录行尾出现「可更新」标签与「合并更新」按钮；版本相同、更高、或不可解析时不出现。
- [ ] 合并更新确认后：原配置 ID 不变、不新建配置；同名字段保留已导入配置的值；模板新增字段补入；仅该条记录的版本与导入时间回写，同模板其他记录不变。
- [ ] 合并更新流程中模板拉取/解析失败时，原配置内容保持不变。

**工程**

- [ ] `pnpm produce` 产物、目录项（含 `hash`）与资源路径全部就位；CI（hashes:check）通过。
- [ ] 两款客户端手动回归：安装、两个入口、搜索、查看、导入、重复导入、合并更新、卸载清理（`records.json` / `manifest.json` 一并删除）。

---

## 13. 后续版本（P2，暂不实现）

1. **合并更新增强**：合并前展示字段级 diff 预览；提供「以模板为准」等可选合并策略。
2. **GFC 订阅解析增强**：导入时可选一份订阅，构建 `NameIdMap` / `IdNameMap` 提升节点保留率。
3. **内核校验**：导入前用内核 `check`（GFS）/-t（GFC）预检模板（参照 `plugin-native-config-manager`
   的 `Exec` 方案）。
4. **本地模板**：支持从剪贴板/文件导入任意运行时配置（走同一转换管线）。
5. **分页**：清单超过 50 条时按 `RulesetHub` 模式分页。

## 14. 风险与对策

| 风险                                                                     | 对策                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| GitHub raw 在部分网络不可达                                              | `BaseUrl` 镜像配置项；错误信息含原始错误便于排查；清单/正文失败时保留缓存内容可继续浏览。                          |
| `restoreProfile` 随宿主版本演进，转换行为变化                            | 插件不复制宿主逻辑，仅透传；损失提示覆盖未知差异；README 要求模板自测。                                            |
| 深合并语义与用户预期不符（数组整体保留已导入配置、模板新增数组项不追加） | 确认弹窗明示合并语义；P2 提供字段级 diff 预览；`editProfile` 前原配置不变，失败可重试。                            |
| 导入记录文件损坏/被手改                                                  | 读取失败按空 `{}` 处理；读取后统一规整为记录数组并剔除非法条目，下次导入重建；仅作为 UI 提示数据，不影响配置本体。 |
| 模板内嵌敏感信息                                                         | README 硬性要求 + 人工评审；发现即下架条目。                                                                       |
| 清单/模板体积增长                                                        | 全量拉取 + 本地清单缓存；P2 分页与磁盘缓存（`data/.cache/<id>/`）。                                                |

## 15. 已决问题（原待决，均遵循本稿）

1. 插件 ID 采用 `plugin-config-template-hub`（✅ 已决，未采用更短的 `plugin-config-hub`）。
2. 卡片不展示 `tags`（Tag 组件仅详情页展示，卡片元信息行为「作者 · 版本 + 已导入标签」）。
3. GFS 导入默认传入全部订阅 ID 参与节点 tag 匹配（不提供订阅勾选步骤）。
