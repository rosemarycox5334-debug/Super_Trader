# 改造计划书：把 Super Trader 做成 DeepSeek Harness 插件（dsh-super-trader）

> 执行者：DeepSeek Harness（dsh）自身。
> 目标：在 `D:\cl\Super_Trader` 仓库内新建一个 dsh 插件包 `dsh-super-trader`，
> 让 dsh 启动时**自动用子进程拉起**已有的 Python 后端，并在**右侧栏**注入一个完整的
> Super Trader 投研面板（量化概率 / 专家团队 / 自选股 / 操盘记录四个页面全搬进来）。
> 不重写 Python 量化逻辑，插件只做「子进程托管 + 工具注册 + 右侧栏 UI」。

---

## 0. 环境事实（已在本机核实，照此实现，勿臆测）

- 操作系统：Windows，shell 为 PowerShell / cmd。
- dsh 桌面版：`0.2.1-rc.5`（`~/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json`）。
- Node：`24.21.0`；pnpm：`11.28.5`（dsh 运行时自带）。
- profile：`desktop`（被 Electron 桌面应用独占；**CLI 拒绝操作 desktop profile**，装插件必须走
  DSH Desktop → Settings → Plugins 图形界面，用 `add link:<本地绝对路径>`）。
- 已有 Python 后端：`D:\cl\Super_Trader\backend`，入口 `python -m backend.serve`
  （FastAPI + uvicorn），默认监听 `127.0.0.1:8000`，可用环境变量 `ST_HOST/ST_PORT/ST_STATE_DB`
  覆盖。依赖 `fastapi/uvicorn/httpx`（见 `requirements.txt`）。
- 模型密钥：后端自动从 `D:\cl\commandcode_key.txt` 读 Command Code key（OpenAI 兼容网关），
  插件无需处理密钥。
- 前端现成页面：`D:\cl\Super_Trader\web\app`（`index.html` + `assets/app.js` + `assets/styles.css`），
  一个无依赖的原生 SPA，已实现四个页面 + Super Agent 流式对话 + 记忆。可整体搬进右侧栏。

### dsh 插件机制（已从本机官方插件 dsh-drawai / dsh-windows-mcp / dsh-whale-widget 实证）

一个插件 = 一个 npm 包，包含：
1. `package.json`：
   - `main` → `lib/index.js`（宿主侧入口）
   - `dsh.bundle.patch` → `./cordis.patch.yml`
   - 可选 `dsh.client`：`{ "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-sidebar-right"] }`
     用于往右侧栏注入前端。
   - `peerDependencies`：`@deepseek-ai/dsh-tools` 版本范围需覆盖 `>=0.2.0-rc.1 <0.3.0-0`。
2. `cordis.patch.yml`：把插件挂到 Cordis 服务树：
   ```yaml
   - insert:
       - id: super-trader
         name: dsh-super-trader
   ```
   （文件不能为空或只有注释，否则 loader 启动失败；留空写 `[]`。）
3. `lib/index.js`：宿主侧 Cordis 插件，apply(ctx) 里注册工具、起子进程、挂路由。
4. `lib/client.js`：前端（web 端注入），渲染右侧栏面板。

**约束（务必遵守）：**
- `apply()` 必须 throw-proof：任何初始化失败都不能让 dsh 启动卡死或崩溃（参考 windows-mcp
  "a plugin must never be able to hang the host"）。子进程拉起要异步、超时、失败降级。
- 不要 import 宿主的 `@deepseek-ai/*` 闭源包；只能在 `package.json`/`cordis.patch.yml`
  里按名声明，由 loader 解析。第三方代码 import 它们会失败。
- 子进程、端口、临时文件都要在插件卸载/退出时清理。

---

## 1. 目标与验收标准

### 1.1 用户体验目标（"怎么方便怎么来"）

- 用户在 DSH 设置里添加本插件（本地 link），**无需手动开后端、无需终端**。
- dsh 启动后，插件**自动探测**后端是否已在跑：没跑就**子进程拉起** `python -m backend.serve`；
  已在跑就直接复用。
- 右侧栏出现「Super Trader」面板，四个页面（量化概率 / 专家团队 / 自选股 / 操盘记录）全可用。
- dsh 的对话里可直接调工具（如"查 601088 第 10 个交易日概率"→ `st_quant_probability`）。
- dsh 退出时，插件拉起的后端子进程被干净地终止。

### 1.2 验收标准（逐条可测）

**插件加载**
- `node --check lib/index.js` 和 `lib/client.js` 通过。
- `npm test`（见第 6 节）通过：patch 组合、子进程管理器状态机、工具注册、客户端面板。
- 在 DSH Desktop 添加 `link:D:\cl\Super_Trader\dsh-super-trader` 后，Plugins 页显示已启用，
  dsh 正常启动（不卡在 "Loading plugins…"）。

**后端自动托管**
- 后端未运行时，启动 dsh 后 ~数秒内 `http://127.0.0.1:8000/api/status` 可访问（由插件子进程拉起）。
- 后端已运行时（用户自己开了 start.bat），插件探测到后复用，不重复拉起、不抢占端口。
- 拉起失败（缺 Python/缺依赖）时，面板显示明确错误与修复指引，dsh 本身不受影响。

**工具**
- dsh 工具列表出现：`st_quant_probability`、`st_expert_analyze`、`st_expert_team`、
  `st_watchlist_add`、`st_watchlist_analyze`、`st_journal_create`、`st_journal_review`、
  `st_memory_recall`、`st_doctor`。
- 在对话中调用 `st_quant_probability {code:"601088", horizon:10}` 返回真实概率 JSON，
  口径字段齐全（`evaluation.type=in_sample`、`direction=0` 时 `probability=null`）。
- 无模型密钥时 `st_expert_analyze` 返回明确错误（不伪造），与后端行为一致。

**右侧栏 UI**
- 右侧栏「Super Trader」面板四个标签页可切换，数据来自真实后端。
- 量化页：搜索、1–20 根切换、日期换算、无信号态、样本量展示。
- 专家页：6 位专家可研判，结论含理由与证据，缺证据显示弃权。
- 自选页：批量研判进度（SSE）+ 逐位意见展开。
- 记录页：新建冻结、复盘真实收益或"待填价格"提示、导出。
- 390px 窄栏无横向溢出（右侧栏通常较窄，样式要适配）。

**退出清理**
- 关闭 dsh 后，`python -m backend.serve` 子进程不残留（检查进程表无孤儿）。

---

## 2. 目录结构（在仓库内新建）

```
D:\cl\Super_Trader\
└─ dsh-super-trader\                 ← 新建插件包（与 backend/ web/ 同级）
   ├─ package.json
   ├─ cordis.patch.yml
   ├─ README.md
   ├─ lib\
   │  ├─ index.js                    宿主侧：子进程管理 + 工具注册 + 诊断
   │  ├─ backend-manager.js          拉起/探测/终止 Python 后端的状态机
   │  ├─ client.js                   前端：右侧栏面板外壳 + 路由
   │  └─ pages\                       四个页面（从 web/app/assets/app.js 迁移/复用）
   │     ├─ quant.js
   │     ├─ experts.js
   │     ├─ watchlist.js
   │     └─ journal.js
   ├─ assets\
   │  └─ styles.css                  从 web/app/assets/styles.css 迁移，适配窄栏
   └─ test\
      ├─ plugin.test.mjs
      ├─ backend-manager.test.mjs
      └─ tools.test.mjs
```

> 复用策略：`web/app/assets/app.js` 已含四个页面的全部渲染逻辑与 API 客户端。
> 优先**迁移/改造**它，而不是从零重写；拆成 pages/*.js 便于在右侧栏外壳里挂载。

---

## 3. package.json（宿主 + 客户端声明）

```json
{
  "name": "dsh-super-trader",
  "version": "0.1.0",
  "type": "module",
  "description": "A股投研工作台：在 DSH 右侧栏提供量化概率/专家团队/自选股/操盘复盘，并把这些能力作为工具暴露给 agent。自动托管本地 Python 后端。",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "assets", "cordis.patch.yml", "README.md"],
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "a-share", "quant", "investing"],
  "engines": { "node": ">=22" },
  "peerDependencies": {
    "@deepseek-ai/dsh-tools": ">=0.2.0-rc.1 <0.3.0-0"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-sidebar-right"
      ]
    }
  },
  "scripts": {
    "check": "node --check lib/index.js && node --check lib/client.js",
    "test": "node --test \"test/**/*.test.mjs\""
  },
  "license": "MIT"
}
```

> 注意：`inject` 里的两个 `@deepseek-ai/dsh-client-ui-*` 名称来自本机官方插件 dsh-drawai 的实证；
> 若当前 dsh 版本的右侧栏注入入口包名不同，执行时应先在
> `~/.dsh/profiles/desktop/node_modules/@deepseek-ai/` 与 dsh-drawai 的 `package.json`
> `dsh.client.inject` 字段核对真实包名，以实测为准。

---

## 4. cordis.patch.yml

```yaml
# dsh-super-trader bundle patch —— 把插件挂到 Cordis 树。
# 本地开发：DSH Desktop → Settings → Plugins → add link:D:\cl\Super_Trader\dsh-super-trader
- insert:
    - id: super-trader
      name: dsh-super-trader
```

---

## 5. lib/index.js（宿主侧实现要点）

职责：子进程托管后端、注册工具（转发到后端 HTTP）、注册诊断、暴露后端地址给客户端。

### 5.1 后端管理器 backend-manager.js（状态机）

- `resolveBaseUrl()`：默认 `http://127.0.0.1:8000`，可被环境变量 `ST_BASE_URL` 覆盖。
- `probe()`：`GET /api/status`，超时 1.5s；返回 `{ok, model, grid}` 或失败。
- `ensureBackend()`：
  1. 先 `probe()`；若已就绪（外部已启动）→ 标记 `external`，直接复用，**不拉起**。
  2. 否则 spawn 子进程拉起后端：
     - 解析 Python 解释器：优先 `ST_PYTHON` 环境变量；否则在 PATH 找 `python`；
       找不到则状态置 `python_missing`，面板给指引（装 Python 3.10+），**不 throw**。
     - 工作目录 = 仓库根 `D:\cl\Super_Trader`（即插件目录的上一级）。用
       `path.resolve(__dirname, '..', '..')` 推导，不要写死盘符。
     - 命令：`<python> -m backend.serve`，环境注入 `ST_HOST=127.0.0.1`、`ST_PORT=<port>`。
     - 端口选择：默认 8000；若 8000 被占用但 `probe()` 不是本后端（status 不含我们的字段），
       则改用备用端口（如 8711）并把 base_url 记下来给客户端。
     - 启动后轮询 `probe()`，最多等 ~20s；就绪→状态 `running(spawned)`；超时→状态 `start_timeout`
       并保留子进程输出最后 N 行供诊断。
  3. 把子进程 stdout/stderr 收集进环形缓冲（诊断用）。
- `dispose()`：插件卸载 / dsh 退出时，若后端是本插件 spawn 的（非 external），
  `tree-kill` 终止子进程（Windows 用 `taskkill /pid <pid> /T /F` 兜底），确保无孤儿。
- 状态对外可读：`getState() → {phase, baseUrl, managed: bool, pid, lastError, logTail}`。

> 关键：所有拉起逻辑异步、带超时、失败降级为状态码，绝不让 `apply()` 抛出或阻塞 dsh 启动。

### 5.2 工具注册（转发到后端）

用宿主提供的工具注册接口（参照 dsh-drawai 的 `diagram_apply`/`windows_mcp_doctor` 的注册方式；
执行时以当前 dsh 版本 `ctx` 上的工具 provider 实测 API 为准）。每个工具的实现 = 校验入参 →
`ensureBackend()` → `fetch(baseUrl + 路径)` → 返回 JSON（或把后端错误如实透传）。

| 工具名 | 入参 | 转发到 |
|---|---|---|
| `st_quant_probability` | `{code, category?, horizon?, date?}` | `GET /api/quant/probability` |
| `st_expert_analyze` | `{expert_id, code, category?, horizon?}` | `POST /api/experts/{expert_id}/analyze` |
| `st_expert_team` | `{code, category?, horizon?, threshold?}` | `POST /api/experts/team/analyze` |
| `st_watchlist_add` | `{code, category?}` | `POST /api/watchlist` |
| `st_watchlist_analyze` | `{horizon?, with_experts?}` | `POST /api/watchlist/analyze`（返回 job，工具轮询 `GET /api/jobs/{id}` 到完成或超时） |
| `st_journal_create` | `{code, action, horizon?, price?, entry_date?, note?}` | `POST /api/journal` |
| `st_journal_review` | `{id}` | `GET /api/journal/{id}/review` |
| `st_memory_recall` | `{q, scope?}` | `GET /api/memory/recall` |
| `st_doctor` | `{}` | 返回 backend-manager 状态 + `GET /api/status`，解释为何工具不可用 |

工具描述里要写清诚实性口径（内样本历史频率、direction=0 概率为 null、缺证据弃权），
让模型正确转述，不要把历史命中率说成"会涨"。

### 5.3 暴露后端地址给客户端

客户端面板要知道 base_url（可能是 8000 或备用端口）。通过宿主的 client-host 通道
（参照 drawai/windows-mcp 的 web 路由）暴露一个只读端点，如 `GET (plugin route)/base`
返回 `{baseUrl, phase}`，客户端据此拼接 `/api/...`。

---

## 6. lib/client.js + pages/*（右侧栏 UI）

### 6.1 外壳

- 用宿主的 sidebar-right 注入点挂一个「Super Trader」面板（参照 dsh-drawai 在右侧栏挂画布的做法；
  执行时以实测的 client UI slot API 为准）。
- 顶部四个标签：量化 / 专家 / 自选 / 记录（+ 一个状态点显示后端是否就绪、模型是否接入）。
- 面板加载时先打插件的 `/base` 拿 baseUrl；后端未就绪则显示"正在启动后端…"并轮询。

### 6.2 四个页面（从 web/app 迁移）

直接复用 `web/app/assets/app.js` 里的 `PAGES.quant / PAGES.experts / PAGES.watchlist /
PAGES.journal` 与配套的 `api` 客户端、`el()`/`renderProb()`/`renderTeamResult()`/
`streamJob()` 等函数：
- 把 `api` 的基址从相对 `/api` 改成 `baseUrl + /api`（因为面板跑在 dsh 里，不是后端同源）。
- SSE：自选批量研判用 `EventSource(baseUrl + /api/jobs/{id}/stream)`；若跨源受限，
  退化为轮询 `GET /api/jobs/{id}`（后端已支持）。
- 样式 `styles.css` 迁移过来，按右侧栏窄宽（~360–420px）调整：卡片单列、表格可横向滚动、
  按钮不溢出。保留亮/暗色自适应。

> 记忆与 Super Agent 流式对话：dsh 本身就是对话入口，不必在面板里再放一个对话框。
> 面板聚焦"看数据/做操作"；对话走 dsh 原生 + 第 5.2 节的工具。

---

## 7. 测试（node --test，零网络）

- `backend-manager.test.mjs`：探测/拉起/复用/超时/清理 状态机（用假 spawn 与假 fetch）。
  - 已有外部后端 → 不 spawn、标记 external。
  - 无后端 → spawn，轮询就绪 → running。
  - python 缺失 → python_missing，不 throw。
  - dispose 终止 spawned 子进程；external 不终止。
- `tools.test.mjs`：每个工具的入参校验 + 转发 URL 正确 + 后端错误透传（假 fetch）。
- `plugin.test.mjs`：`cordis.patch.yml` 能被 YAML 解析且含 insert 行；`apply()` 在
  "后端不可用 / ctx 残缺"时不抛出（hostile-context）。

---

## 8. 实施顺序

1. 建包骨架：package.json / cordis.patch.yml / 空 lib/index.js（`apply` 空实现，先让 dsh 能加载）。
2. backend-manager.js：探测 + 子进程拉起 + 清理，配套测试。
3. lib/index.js：注册工具（转发后端）+ st_doctor，配套测试。
4. 客户端外壳 + /base 端点，右侧栏能显示"后端状态"一行，打通客户端↔宿主↔后端链路。
5. 迁移四个页面进右侧栏（quant → experts → watchlist → journal 逐个），窄栏样式适配。
6. 退出清理、hostile-context 加固、README 写安装与排错。
7. `npm run check` + `npm test` 全绿，交给用户在 DSH 设置里 `add link:` 安装验证。

---

## 9. 不要做的事

- 不改 Python 后端的量化逻辑（`super_trader` / `backend` 的算法与口径）。
- 不把密钥写进插件或前端；密钥仍由后端从环境/文件读。
- 不 import 宿主闭源 `@deepseek-ai/*`（只在声明里按名引用）。
- 不让后端拉起阻塞 dsh 启动；不残留孤儿进程。
- 不在面板里伪造"已连接/已分析"；后端没就绪就如实显示启动中/错误。
- 不对 `desktop` profile 用 CLI（会被拒绝）；安装走 GUI。
```
