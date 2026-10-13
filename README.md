# dsh-balance-console

> 一个给 **DeepSeek Harness（DSH）** 用的余额极简控制台风味插件：在界面浮层里以 CMD 终端风格实时显示 DeepSeek API 余额，并在本地按你导入的计价规则估算每一次对话花了多少钱。最新的版本附带**下一次最低价格预测**功能，以及整个会话每轮消费估计的柱状图表示。
> 由于价格预测功能的计算方法**不计算**当次用户输入，且输出取该会话历史输出的50或85百分位数（可选），所以它只在用户的任务规模较为稳定时拥有较高的准确性。

包括这篇readme在内的大部分内容由AI生成，文字和代码只被笔者进行过十分有限的手工校对。如果你希望了解开发过程中每轮的提示词工程与需求，你可以参阅docs文件夹中的两份总结。它们也是由AI生成的，不过它们诚实地反映了每轮提示的具体内容。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
![Platform](https://img.shields.io/badge/DSH-0.2.0--rc.2-blue)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)

**English summary** — A zero-dependency DeepSeek Harness plugin that renders a retro console-style floating window showing your DeepSeek API balance in real time, and estimates the cost of each conversation locally from your own pricing rules. Host half registers one authenticated HTTP route; Client half registers five UI slots. No third-party dependencies, no extra polling loop.

---

## 目录

- [功能特性](#功能特性)
- [界面与交互](#界面与交互)
- [安装](#安装)
- [使用](#使用)
- [工作原理](#工作原理)
- [已知限制与未验证项](#已知限制与未验证项)
- [开发](#开发)
- [仓库结构](#仓库结构)
- [开发日志](#开发日志)
- [许可证](#许可证)

---

## 功能特性

### 余额显示

| 功能 | 说明 |
| --- | --- |
| CMD 风格余额读数 | 等宽字体浮窗，标题栏为 `balance — IDLE / LIVE`，绿色方块闪动表示正在刷新（文字不闪，避免视觉噪声） |
| 三段式进度条 | 绿色 = 已用，灰色 = 剩余，青色 = 赠送余额；超预算时绿色满格 + 白色溢出贴最右 |
| 余额变化账单 | 最多保留 15 条变动记录，最新置顶；中间用 `flex:1` 字符块填充，与余额行像素级对齐 |
| 刷新指示 | 以 `balance:` 左侧 1ch 宽绿色方块显示刷新状态，不改变标题文字 |
| 余额组成 | 余额数字、CNY 单位、赠送余额恒在最右 |

### 窗口与布局

| 功能 | 说明 |
| --- | --- |
| 框架级浮窗 | 挂在 `shell.overlay`，完全脱离输入框、会话面板与当前会话 |
| 拖动 / 缩放 / 最小化 | 最小化态为 56×56 方块，方块上直接显示余额数字；再次点击还原 |
| 共享浮窗外壳 | 余额窗、设置窗、回执窗共用一套外壳（拖动 / 缩放 / 最小化 / 置顶），每个窗口独立记忆几何信息 |
| 侧边栏总开关 | 注册在 `sidebar.footer.action`，一键启停全部余额显示服务（浮窗、预测行、估价按钮一起消失，轮询同步停止） |
| provider 自动显示 | 仅当会话的模型提供商匹配 `deepseek` 时显示（Host 端读取会话投影给出权威答案） |
<img width="822" height="528" alt="image" src="https://github.com/user-attachments/assets/a4ff6a7b-76de-403b-9796-edd0eb74f66e" />
<img width="1212" height="843" alt="image" src="https://github.com/user-attachments/assets/9aea8779-8f22-47a3-969b-e978761c401d" />

### 异常状态

| 状态 | 表现 |
| --- | --- |
| 未填 API key | 方块与 CNY 变红且静止，数值 0，进度条纯灰，提示"请点击设置以登录 apikey" |
| 网络错误 | 方块红色闪烁；进度条使用单条红色渐变 `background-position` 位移（scan 动效，只用一个 CSS keyframes） |
| key 非法（401/403） | 方块、进度条、CNY 变蓝 `rgb(78, 149, 255)`；方块闪烁、其余静止 |
| 正常在线 | 绿色方块指示刷新，余额与进度条正常渲染 |

### 计价与估算

| 功能 | 说明 |
| --- | --- |
| 计价规则模型 | 每条规则 = 工作日 / 节假日各一份 48 格峰位图 + 峰 / 谷各 3 个单价（命中 / 未命中 / 输出）。峰谷互补，因此只存峰、谷是补集 |
| 计价规则编辑器 | 48 格拖拽网格：左键刷峰、右键刷谷，支持折叠面板、改名、删除、启用切换 |
| 每轮按其结束时刻计价 | 每个 Turn 用自己 `turn/end` 事件的 `time` 推出时段单独计价，各自向上取整到分；会话总额 = 各分项之和（保证"聚合 = 明细相加"） |
| 单轮估价按钮 | 挂在 `conversation.chat.turnTail`，显示该轮金额 |
| 会话估价入口 | 挂在 `conversation.session.header.actions`，文案形如 `会话估价「13.5140」￥` |
| 消费回执窗口 | 逐轮分项 + 合计；含会话级柱状图，每根柱顶部标注该轮金额，横轴为每轮首字 |
| 峰时段警示 | 在峰时段结束的会话柱使用警告色 |
| 下一次对话花费预测 | 显示在输入框上方（`conversation.input.dock`），公式见下 |
| P50 / P85 两极切换 | 预测行左侧 `[P50][P85]` 按钮即时切换，纯计算不发请求 |

**预测公式**：

```
预估费用 = (预估未命中 + 预估缓存写入) × 未命中单价
         + 预估命中 × 命中单价
         + 预估输出 × 输出单价

预估未命中   = 上一步 uncachedInputTokens + 上一步 outputTokens
预估命中     = 上一步 cacheReadTokens
预估缓存写入 = 上一步 cacheWriteTokens（按未命中单价计费）
预估输出     = 本会话历史各步 outputTokens 的 P50（切到 P85 时取 P85）
```

百分位用线性插值实现；每步输出样本最多保留最近 200 步，避免长会话把 payload 撑大。

### 时区与一致性

这个问题因笔者安装过CLOAQ插件，导致笔者自己的浏览器时区是**伪造的**。如果您的浏览器时区和Host时区一致，那么在正常使用过程中不会出现时区判定问题。

| 功能 | 说明 |
| --- | --- |
| 全链路 Host 时区 | 账单时间戳、回执时间戳、时段判定、按钮 tooltip 一律按 **Host 进程的本地时区** 渲染，绝不回落浏览器时区（时区缺失时显示 `--`，不猜一个错的时钟） |
| 历史时刻感知 | 时段判定支持传入历史时刻，因此"某轮在哪个时段结束"可以精确还原 |

---

## 界面与交互

插件一共注册 **5 个界面挂载点**：

| Slot | 内容 |
| --- | --- |
| `shell.overlay` | 余额主窗（可最小化成方形浮窗） |
| `sidebar.footer.action` | 侧边栏底部的总开关 |
| `conversation.input.dock` | 输入框上方的"下一次对话花费预测"行，与输入框卡片右对齐 |
| `conversation.session.header.actions` | 会话标题旁的会话总额估价入口 |
| `conversation.chat.turnTail` | 每轮对话尾部的单轮估价按钮 |

窗口位置、尺寸、最小化状态、开关状态、预测档位都存在 `localStorage`，刷新页面后保持。

---

## 安装

这是一个标准的 DSH bundle，`package.json` 同时声明了 Host 补丁与 Client 半部：

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

补丁只插入一行：

```yaml
- insert:
    - id: balance-console
      name: dsh-balance-console
```

### 方式一：在 Web 界面安装

哦哦，原版的web界面似乎并没有直接安装的入口，如果你已经安装插件管理插件，那么以你的管理器为准。

### 方式二：让 Agent 安装

```
plugin_manager  action: install_bundle
                target: <克隆目录>\dsh-balance-console
```

安装后 profile 的 `package.json` 会多出 `"dsh-balance-console": "link:<该目录>"`，Loader 行 `balance-console` 随即 `active`。

### 卸载

```
plugin_manager  action: remove_bundle   target: dsh-balance-console
```

### 环境要求

- DSH `0.2.0-rc.2`（本插件在此版本上开发与验证）
- 必须有 Web 界面（声明了 `dsh.client.platform = "web"`）
- 需要 DeepSeek API key（在插件自己的设置窗里登录，或复用 DSH 已保存的 `DEEPSEEK_API_KEY` 凭据）

---

## 使用

### 首次登录

点浮窗右上角的设置按钮 → 打开设置窗 → 填入 API key → 保存。key 会保存到 Host 端的配置文件中，之后免登录。若 DSH 的凭据服务里已经有 `DEEPSEEK_API_KEY`，插件会直接复用它，无需再填。

### 设置项

| 设置 | 说明 | 默认 |
| --- | --- | --- |
| 刷新间隔 | 任务运行时的刷新频率，单位秒，取值 1–3600 | 5 |
| 预期总预算 | 进度条的基准金额，0 表示不设置 | 0 |
| 高价扣款阈值 | 单次扣款超过这个金额（元）才触发警告 | 0.10 |
| 警告颜色 | 只接受 `rgb(r, g, b)` 字面量，非法值回落默认 | `rgb(34, 177, 167)` |
| 警告持续秒数 | 警告特效持续时间，上限 60 秒 | 0.5 |
| 下一次对话花费预测 | 是否在输入框上方显示预测行 | 开启 |
| 计价规则 | 规则的增删改与启用切换 | 空（需自己建一条） |

### 计价规则怎么写

一条规则包含：

- **峰位图**：工作日与节假日各 48 格（每格半小时），`1` 表示峰时段、`0` 表示谷时段。用编辑器左键刷峰、右键刷谷。
- **单价**：峰 / 谷各 3 个，单位是「元 / 百万 token」，分别是命中（cache read）、未命中（uncached input + cache write）、输出。

举例：`deepseek-v4-flash`，工作日峰价 命中 `0.04` / 未命中 `2` / 输出 `8`，谷价为峰价的一半。

> ⚠️ 所有估价都是**本地估算**，以官方账单为准。

### 刷新与轮询行为

- 界面上有活动的心跳时才轮询（心跳 TTL 15 秒）；关掉侧边栏开关后浮层整体卸载、心跳停止、Host 侧轮询随之停止。
- Host 端调度器以 1 秒为分辨率检查"是否到了下一次刷新时刻"。
- 实测官方余额约每 60 秒结算一次，因此插件**不做高频采样**
- 我根本不知道上面在说什么，但是我建议api费用轮询设定为50秒————这个时间比官方余额更新稍快。

---

## 工作原理

```
┌──────────────────────── 浏览器 ────────────────────────┐
│  client.js  window.__ModuleLoader__.load({...})         │
│    ├─ shell.overlay                      余额主窗        │
│    ├─ sidebar.footer.action              总开关          │
│    ├─ conversation.input.dock            花费预测        │
│    ├─ conversation.session.header.actions 会话估价       │
│    └─ conversation.chat.turnTail         单轮估价        │
└───────────────────────┬─────────────────────────────────┘
                        │  GET /api/balance-console/state
                        │  （复用 DSH connection 服务鉴权，未认证 401）
┌───────────────────────┴─────────────────────────────────┐
│  index.js   Host 半部（单文件，无第三方依赖）             │
│    ├─ 1s 调度器 + 客户端心跳（15s TTL）                   │
│    ├─ GET https://api.deepseek.com/user/balance          │
│    ├─ 持久化 $DSH_HOME/storages/dsh-balance-console.json │
│    ├─ 跨会话聚合：直读 sessionPersistence 并折叠日志      │
│    └─ 凭据桥：可回落到 DSH credentials 的 DEEPSEEK_API_KEY│
└──────────────────────────────────────────────────────────┘
```

### Host 半部（`index.js`）

- 单文件、零第三方依赖，只 import Node 内置模块。
- `inject: ['webServer']`，用 `ctx.inject(['webServer'], …)` 注册一条 HTTP 路由 `GET /api/balance-console/state`。

  > 为什么不用 Typert Remote namespace：插件的 `apply` 在 profile 启动极早期执行，此时 `webServer` / `connection` 服务尚不存在，Remote 绑定无法建立（实测客户端一直报 "Remote namespace 不可用"）。改用 HTTP 路由后彻底稳定。
- 鉴权复用 DSH 自身的 `connection.authorizeIndex`：未认证请求返回 401。
- 余额变化时追加账单记录（最多 15 条）并落盘。
- 跨会话估价聚合直读 `sessionPersistence.list()/open(id, 'read')`，按日志 `revision` 缓存——**不加轮询、不加定时器**。

  > 为什么不用 `ctx.agents.roots()`：空闲会话没有活动 agent（实测 `roots = 0`），拿不到别的会话数据。

### Client 半部（`client.js`）

- 单文件，通过 `window.__ModuleLoader__.load({ id: 'dsh-balance-console', factory(require) { … } })` 注册；只 require `react`，不 import 任何 Harness Client 包。
- 5 个 slot 的注册集中在文件末尾（见上表）。
- 几何信息与偏好按窗口写入 `localStorage`：
  - `dsh-balance-console:layout:<window>`
  - `dsh-balance-console:enabled`
  - `dsh-balance-console:percentile`

### 持久化文件

```
$DSH_HOME/storages/dsh-balance-console.json
```

包含 API key、刷新间隔、预算、账单记录、计价规则等。

> 🔒 **该文件包含明文 API key，任何情况下都不要让你不信任的程序访问它。**

### 兼容性与边界

- 不新增常驻轮询：轮询只在界面有心跳时进行。
- 不 import DSH 内部包：Host 只看 `webServer` / `credentials` / `sessionPersistence` 这几个公开服务，缺哪个就降级。
- Client 只用 `react` 与主题 token，不依赖 `@deepseek-ai/dsh-client-ui-primitives`。

---

## 已知限制与未验证项

为保证可信度，这里如实列出**代码已写但没有实测**或验证不充分的部分（摘自开发日志 §三）：

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 计价规则编辑器的拖拽绘制 | 代码完成，交互未实测 | 48 格网格的左键刷峰 / 右键刷谷、折叠面板、改名、删除、启用切换，未在浏览器里逐个操作验证 |
| provider 隐藏的负向分支 | 部分验证 | 验证过"provider 为 DeepSeek 时显示"，未实测"切到非 DeepSeek 时隐藏" |
| 四种异常状态的视觉 | Host 侧已验证，视觉未逐一截图 | 四种 `state` 的输出由桩件确认，浏览器中的最终配色只对正常态做过像素级核对 |
| 高价扣款预警的触发 | 代码完成，触发未实测 | 阈值 / 颜色 / 时长的输入与持久化已由 Host 状态机确认，但"真实产生一笔超阈值扣款 → 观察闪烁与整行转色"未实测 |
| 侧边栏开关的完整交互 | 部分验证 | 已验证关闭时浮层返回 null、心跳与轮询停止、按钮不再发请求；未用真实鼠标事件走完"关闭 → 三窗与预测行消失 → 再打开恢复"全过程 |
| 存款增加时的全绿表现 | 逻辑就绪，样本缺失 | 实测区间内账单没有正数条目，只验证了扣款分支 |
| 单轮回执的三行单价明细 | 逻辑就绪，未实测 | 会话回执已改为逐轮分项 + 合计，单轮回执保留三行明细但未逐一核对 |
| 预测数值的合理性 | 已实现，待评估 | 公式与输入口径已按文档实现，但结果与实际账单的直觉是否吻合需使用者判断 |

### 性能备注

`sessionEstimates` 接口会遍历所有会话日志（折叠结果按 `revision` 缓存），成本随会话数增长。客户端已加 2 秒 TTL 与并发请求合并；实测样本累积到 433 步（上限 200 步）。会话继续增多时建议改为"只查当前会话"。



---

## 开发

```bash
# 语法检查
node --check dsh-balance-console/index.js
node --check dsh-balance-console/client.js
```

本插件以 `link:` 方式装入 DSH profile，因此：

- **改 `client.js`**：刷新浏览器页面即生效（客户端热更新可用）。
- **改 `index.js`**：需要**重启 `dsh web`**。

  > 该 profile 的 HMR 监听根为 `root: []`，且插件以 `link:` 装入，Node 的 ESM 模块缓存不会被软重载清掉；用插件管理器"禁用再启用"只会重新挂载 Loader 行，新 `index.js` 仍然不生效（实测两次均返回旧字段）。

调试建议：

- 位置 / 对齐问题**不要依赖自身位置做补偿测量**（曾把 `margin-right` 算成 −1864 万 px），改为测量与目标元素无关的静态量。
- 上层包裹节点是 `display: contents`，插件元素实际是更外层 flex 容器的 item，CSS 对齐容易落到错误的容器上——需要直接测量目标元素右缘。
- `conversation.chat.turnTail` 的 props 里，`props.turn` 是 `TurnLocation` 对象而不是数字（`props.turn.turn` 才是轮号），且 props **不含** `tokenUsage`；`turn.end !== undefined` 是判断"Turn 是否结束"的稳妥方式。
- `tokenUsage` 投影的 wire view 只暴露 `totals`，`last` 读不到，需要"上一步分项"时必须在 Host 侧自行记录。

---

## 仓库结构

```
.
├── README.md                 本文件
├── LICENSE                   MIT
├── .gitignore
├── .gitattributes
├── dsh-balance-console/      ← 插件本体（安装时指向这个目录）
│   ├── package.json          包声明 + dsh.bundle.patch + dsh.client
│   ├── cordis.patch.yml      插入 Loader 行 `balance-console`
│   ├── index.js              Host 半部
│   └── client.js             Client 半部
├── docs/
│   ├── 1.md                  开发日志（第 1–6 轮）
│   └── 2.md                  开发日志（第 7–14 轮）
└── archive/
    ├── dsh-balance-console-backup-1.0.0/            第 1–6 轮交付态
    └── dsh-balance-console-backup-20261013-105557/  第 7 轮交付态
```

`archive/` 是历史快照，只作留档，不要用于安装。



---

## 许可证

[MIT](LICENSE) © 2026 wheatcat123

---

### 免责声明

本项目是非官方项目，与 DeepSeek 官方无关。插件会使用你提供的 API key 访问 DeepSeek 官方余额接口（`https://api.deepseek.com/user/balance`）与读取本地会话日志；除该余额接口外不向任何地方发送数据。所有金额均为本地估算，请以官方账单为准。

---
