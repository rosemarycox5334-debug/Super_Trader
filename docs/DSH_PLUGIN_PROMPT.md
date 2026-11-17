# 对接提示词（粘贴给 DeepSeek Harness 执行）

> 用法：把下面「==== 提示词开始 ====」到「==== 提示词结束 ====」之间的全部内容，
> 复制粘贴给你本机的 DeepSeek Harness（dsh）。它会读计划书并自己把插件做出来。

==== 提示词开始 ====

你是在我本机 Windows 上运行的 DeepSeek Harness。我要你把我的 A 股投研项目
`Super Trader` 改造成**你自己的一个插件**，让你启动时自动托管它的后端，并在你的右侧栏
提供一个完整的投研面板，同时把它的能力作为工具暴露给你自己调用。

## 第一步：先读，别急着写

1. 完整阅读这份改造计划书（最权威，按它做）：
   `D:\cl\Super_Trader\docs\DSH_PLUGIN_PLAN.md`
2. 读懂现有后端与前端（要复用，不要重写）：
   - 后端入口与接口：`D:\cl\Super_Trader\backend\app.py`、`backend\serve.py`、`docs\API.md`
   - 现成的四个页面前端：`D:\cl\Super_Trader\web\app\assets\app.js`、`styles.css`
   - 启动方式：`python -m backend.serve`（FastAPI，默认 127.0.0.1:8000）
3. 核对你自己的插件机制真相（不要凭记忆，以本机实测为准）：
   - 看这几个官方插件怎么写的：
     `~/.dsh/profiles/desktop/node_modules/dsh-drawai`（右侧栏注入 + 工具）、
     `dsh-windows-mcp`（工具注册 + 子进程 + 设置页）、`dsh-whale-widget`（挂件）。
   - 重点对齐三件事的**真实 API**：①工具怎么注册（ctx 上的 provider）②右侧栏 UI 怎么注入
     （`dsh.client.inject` 的真实包名，以 dsh-drawai 的 package.json 为准）③子进程/路由怎么挂。
   - 你的版本：dsh 0.2.1-rc.5，profile=`desktop`，Node 24.21。

## 第二步：按计划书实现

在 `D:\cl\Super_Trader\dsh-super-trader\` 新建插件包，严格实现计划书第 2–7 节：

- **自动托管后端（用户零操作）**：你启动时先探测 `http://127.0.0.1:8000/api/status`；
  没跑就用子进程拉起 `python -m backend.serve`（工作目录=仓库根，用相对路径推导别写死盘符）；
  已跑就复用。拉起必须异步、带超时、失败降级为状态码——**绝不能卡住或搞崩你自己的启动**。
  你退出时要干净终止自己拉起的子进程，不留孤儿。
- **工具**：注册 `st_quant_probability / st_expert_analyze / st_expert_team /
  st_watchlist_add / st_watchlist_analyze / st_journal_create / st_journal_review /
  st_memory_recall / st_doctor`，实现就是转发到后端对应的 REST 接口（见 docs/API.md）。
  工具描述要写清诚实口径：量化概率是**内样本历史频率**，不是"会涨"；`direction=0` 时概率为
  null；专家缺证据必须弃权；无模型密钥时如实报错不要伪造。
- **右侧栏面板**：把 `web/app` 的四个页面（量化概率 / 专家团队 / 自选股 / 操盘记录）**全部**
  搬进右侧栏面板，复用 `app.js` 里的渲染函数，只把 API 基址从相对 `/api` 改成
  `baseUrl + /api`（面板跑在你里面，不是后端同源）。按右侧栏窄宽（~360–420px）适配样式，
  无横向溢出，保留亮/暗自适应。SSE 跨源受限时退化为轮询（后端支持 `GET /api/jobs/{id}`）。

## 第三步：自测

- `node --check lib/index.js`、`node --check lib/client.js` 通过。
- `npm test`（node --test）覆盖：后端管理器状态机（探测/拉起/复用/超时/清理）、
  工具入参与转发、patch 可解析、apply 在残缺上下文不抛出。
- 不要对 `desktop` profile 用 CLI（会被拒绝）。

## 第四步：告诉我怎么装和验证

你没法替我点图形界面，所以做完后给我**一步步的安装与验证清单**：
1. 怎么在 DSH Desktop → Settings → Plugins 用 `add link:D:\cl\Super_Trader\dsh-super-trader` 装；
2. 重启你之后，怎么确认：右侧栏出现「Super Trader」面板、后端被自动拉起、四个页面能出数据、
   在对话里调 `st_quant_probability {code:"601088",horizon:10}` 能返回真实概率；
3. 如果后端没起来，`st_doctor` 会告诉我什么、怎么修（装 Python / 装依赖）。

## 硬约束（违反即返工）

- 不改 `super_trader` / `backend` 的量化算法与口径，只做"子进程托管 + 工具转发 + 右侧栏 UI"。
- 不 import 宿主闭源 `@deepseek-ai/*`，只在 package.json / cordis.patch.yml 按名声明。
- 不把密钥写进插件或前端（后端自己从环境/文件读）。
- 后端拉起不得阻塞/搞崩你的启动；退出不得残留子进程。
- 面板里不伪造"已连接/已分析"；后端没就绪就如实显示启动中/错误态。
- 全程诚实：没验证的别说验证过；跑不通的测试别说通过。

先读计划书和那几个官方插件源码，然后开始。读完先用三五句话复述你的实现方案和你核对到的
右侧栏注入真实包名，再动手写代码。

==== 提示词结束 ====
