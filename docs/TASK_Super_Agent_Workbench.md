# 任务书：实现 Super Agent 投研工作台（真实可用版）

> 交给执行的智能体：这是一份完整任务书。请先通读，再按第 8 节顺序实施。
> 完成标准是**能跑、能复现、能验收**，不是再做一份静态 HTML 演示。

---

## 0. 角色与总目标

你是一名全栈 + 量化工程师。在 **D:\cl\Super_Trader**（已有 Python 项目）上实现一个真正能跑起来的投研工作台。

三件事必须真实工作：

1. **Super Agent 主页面**：基于 DeepSeek Harness（dsh）的插件化工作台。Super Agent 能通过**对话和 UI** 增删、启停、排序插件；插件是运行时真实注册的，不是写死的前端页面。
2. **量化概率页**：给定标的与「未来第 N 个交易日（或具体日期）」，返回上涨/下跌概率，并说明怎么算、多少样本、是否校准。
3. **专家团队**：蒸馏专家（巴菲特、段永平、烟蒂股、量化专家、价格行为、成长派等）**真实调用模型**，带工具与证据辅助选股；缺证据必须弃权，不许编。

两个附加需求（已确认）：

4. **自选股**：用户自己挑标的，批量跑量化信号 + 专家研判。
5. **操盘记录与复盘**：记录专家选股/买卖的当时理由与信号快照；之后用真实行情算结果做复盘。

---

## 1. 现有资产（先读懂，能用就用）

### 1.1 数据

- 日线 CSV 根目录：`D:\A股k线数据\多周期\日线\{个股|ETF|指数}`
- 共 8,228 个标的（个股 5,570 / ETF 1,658 / 指数 1,000），**未复权**，数据截止 **2026-11-05**
- 用 `super_trader.data.KlineStore` 读取，自带 parquet 缓存（`data/cache/{category}/`）

### 1.2 已有量化引擎

- 包 `super_trader`：`rules.py`（105 条规则）、`features.py`、`fullfit.py`（全历史拟合）、`evaluate.py`、`data.py`、`universe.py`
- 规则注册：`@rule(name, family, desc, direction="both")`，`Rule.key = f"{family}__{name}"`，`rule_signals(fs)` 输出 int8（-1/0/+1）
- 当前拟合口径：全历史、无留出；时间衰减 `0.10 + 0.90*0.5**(age_days/365)`；标签 `sign(close[i+h]/close[i]-1)`；中性不计入分母；覆盖率下限 10%；每标的在 1–20 根中挑胜率最高的一根

### 1.3 已产出的真实数据

| 文件 | 内容 |
|---|---|
| `reports/fullfit/fullfit.json` | 6,244 个标的的最优持有期记录（约 5.5 MB） |
| `reports/fullfit/probability_grid.json` | **6,244 标的 × 1–20 根** 紧凑概率网格（约 2.9 MB），5,630 个标的 20 档全有模型 |
| `reports/fullfit/ranking_fullfit.html` | 历史排行 |
| `reports/crosssection/report_crosssection.html` | 横截面 IC 研究 |

`probability_grid.json` 结构：

```json
{
  "generated_at": "2026-11-11T18:01:07",
  "snapshot": "2026-11-05",
  "scope": "in_sample_full_history_no_split",
  "horizons": [1, 2, "…", 20],
  "symbols": 6244,
  "fields": ["prob_x1000", "predictions", "direction", "base_up_x1000", "coverage_x1000"],
  "data": [
    {
      "code": "601088", "category": "个股", "name": "中国神华",
      "rows": [[544, 453, 0, 500, 102], [561, 508, 0, 501, 115], "…共 20 档"]
    }
  ]
}
```

`rows[i]` = 第 i+1 根：`prob×1000`（历史同信号命中率）、预测次数、当前方向（1/-1/0）、单边基准×1000、覆盖率×1000。

### 1.4 生成脚本

- `scripts/build_probability_grid.py`：逐标的逐周期重算。`--workers 3`（8 会 OOM），全市场约 2 小时
- `scripts/build_workbench.py`：把前端源码合成单文件 HTML

### 1.5 已完成的前端原型（行为参考，**不要照抄架构**）

- `web/workbench/`：`index.html`、`workbench.css`、`superagent.css`、`review.css`、`conversation_helpers.js`、`app.js`
- 产出 `reports/chat_main.html`（单文件，2.9 MB）
- 交互已跑通：插件增删改排序、量化概率页、专家团队、自选股、操盘记录与复盘
- 但**全部在浏览器内存/localStorage，专家意见是脚本化固定值，没有后端、没有模型调用**。可复用 UI 结构、状态模型与文案口径，后端与数据链路必须重做
- 现有测试：`tests/test_workbench.py`（构建校验）、`tests/workbench_state.test.cjs`（状态层 17 项）

### 1.6 环境

- Windows，Python 3.13（numpy / pandas / scipy / pyarrow / pytest 已装）
- Node 不在 PATH，实际路径：`C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
- Git remote 已配置；**不要提交 `data/cache`、大 parquet、密钥**

---

## 2. 架构要求

```
┌──────────────────────────────────────────────────────────┐
│ 前端 SPA（可在现有 web/workbench 上改造）                  │
│ Super Agent 对话 / 插件容器 / 插件管理                     │
└───────────────▲──────────────────────────────────────────┘
                │ REST + SSE
┌───────────────┴──────────────────────────────────────────┐
│ 后端 FastAPI（新增 backend/）                             │
│ ├─ plugin_runtime：注册/启停/排序/持久化                   │
│ ├─ agent_service：Super Agent（dsh 模型网关 + 工具调用）    │
│ ├─ quant_service：概率查询（网格 + 按需重算）              │
│ ├─ expert_service：专家研判（模型 + 证据工具 + 弃权）       │
│ ├─ watchlist_service / journal_service                    │
│ └─ job_queue：批量研判（进度 / 取消）                      │
└───────────────▲──────────────────────────────────────────┘
                │
   SQLite（state.db）+ 现有 CSV/parquet + 规则引擎
```

强制约束：

- **状态在服务端**（SQLite 或 JSON 文件均可，但必须落盘、可备份、可迁移）；前端不存业务真相
- **不把 API Key 写进前端或 localStorage**；密钥只从环境变量读
- 前端只做展示与交互，所有计算走后端

---

## 3. 功能规格

### 3.1 插件系统（核心，必须真）

插件记录：

```json
{
  "id": "quant",
  "name": "量化概率",
  "icon": "chart",
  "kind": "quant",
  "entry": "builtin:quant",
  "enabled": true,
  "order": 0,
  "permissions": ["read:snapshot"],
  "config": {}
}
```

要求：

- 内置插件 4 个：`quant`、`experts`、`watchlist`、`journal`
- 支持 `POST /api/plugins`、`PATCH /api/plugins/{id}`（改名/启停/排序）、`DELETE /api/plugins/{id}`（仅自定义）
- **Super Agent 能用自然语言触发这些 API**：如「添加插件 龙虎榜」→ 真的创建并在导航出现；「隐藏插件 专家团队」→ 停用；「把自选股排到最前」→ 改 order
- 自定义插件必须有明确契约，二选一：
  - 声明式：`{"render":"table","data_source":"/api/..."}`，前端按声明渲染
  - 受限脚本：后端沙箱执行，提供只读上下文，禁止网络与文件写
- 保护：至少保留一个启用插件；内置插件不可删除
- 所有变更写审计日志（谁、何时、改了什么）

### 3.2 量化概率（真实计算）

```
GET /api/quant/probability?code=601088&category=个股&horizon=10
GET /api/quant/probability?code=601088&category=个股&date=2026-11-20
```

响应：

```json
{
  "symbol": {"code": "601088", "category": "个股", "name": "中国神华"},
  "target": {"horizon": 10, "target_date": "2026-11-19", "trading_days": 10},
  "direction": 1,
  "direction_label": "上涨",
  "probability": 0.544,
  "sample": {"predictions": 453, "coverage": 0.102, "period": ["2005-01-04", "2026-11-05"]},
  "baseline_up": 0.5,
  "rules": ["波动率__squeeze_break"],
  "method": "fullfit_recency_weighted_v1",
  "evaluation": {"type": "in_sample", "calibrated": false},
  "warnings": ["内样本频率，不是校准概率", "中性期不发出预测"]
}
```

规则：

- 优先查 `probability_grid.json`；缺失或要求重算时用 `fullfit.py` 现算（加缓存）
- 日期 → 交易日必须用**真实交易日历**（所有标的日期序列的并集），不要「数工作日」近似
- `direction = 0` 时 `probability` 返回 `null`，前端显示「当前无方向信号」并单独给 `baseline_up`
- 必须返回 `evaluation.type`；禁止把内样本写成「预测准确率」
- 加分项：提供 walk-forward / 留出口径，字段 `evaluation.type = "out_of_sample"`，并如实给出样本数与表现

### 3.3 专家团队（真实模型调用）

专家定义：

```json
{
  "id": "duan",
  "name": "段永平",
  "tag": "本分 · 看懂生意",
  "system_prompt": "…决策函数，不是角色扮演…",
  "criteria": ["能看懂十年后的生意", "现金流与用户价值真实", "管理层本分"],
  "tools": ["quant_snapshot", "filings_search", "news_search"],
  "model": "…",
  "temperature": 0.3,
  "abstain_policy": "missing_evidence",
  "version": 1
}
```

```
POST /api/experts                新建/更新
POST /api/experts/{id}/analyze   {"code":"601088","horizon":10}
→ {"vote":1,"confidence":"medium","reason":"…","evidence":[{"source":"quant_snapshot","ref":"…"}],"abstained":false}
```

要求：

- 真实调用模型（dsh 模型网关或兼容 OpenAI 的 endpoint），带工具调用
- **每条结论必须带 evidence 引用**（数据来源 + 具体字段/日期）；无证据 → `vote=0, abstained=true`，理由写明缺什么
- 量化专家只读 `probability_grid` / fullfit 结果
- 价值类专家缺财报/公告时必须弃权；**禁止**用「品牌力强」这类空话替代证据
- 输出结构化 JSON（schema 校验），解析失败要重试并记录
- 团队共识 = 支持权重占比；门槛可配（默认 60%）；可选「全体一致」
- 批量研判走 job_queue，SSE 推送进度，可取消

### 3.4 自选股

```
GET/POST/DELETE /api/watchlist
POST /api/watchlist/analyze  {"horizon":10}   → job
```

- 最多 200 只；批量结果含：量化方向/概率/覆盖率 + 每位专家投票 + 共识
- 支持从量化页/专家页一键加入

### 3.5 操盘记录与复盘

```json
{
  "id": "J-…",
  "created_at": "2026-11-11T18:03:35+08:00",
  "symbol": {"code": "601088", "category": "个股", "name": "中国神华"},
  "action": "buy",
  "expert": "团队",
  "horizon": 10,
  "signal": {"direction": 1, "probability": 0.544, "rules": ["…"], "snapshot": "2026-11-05"},
  "reasons": {"summary": "…", "votes": [{"expert": "巴菲特", "vote": 1, "why": "…", "evidence": []}]},
  "price": 38.5,
  "closed": false,
  "note": ""
}
```

- 创建时**冻结**理由与信号快照，之后不可改写
- 复盘用真实收盘价计算：
  - `entry_price` = 记录日或手动填写的成交价
  - `forward_return` = 第 N 根后的实际收益（做多/做空按方向取号）
  - `hit` = 方向是否与实现收益一致
  - 同时给「信号漂移」：现在的方向 vs 记录时的方向
- 没有成交价时只做方向复盘，不编造收益
- 支持按专家/状态筛选，导出 JSON/CSV

---

## 4. 数据契约与持久化

```sql
CREATE TABLE plugins(id TEXT PRIMARY KEY, name TEXT, kind TEXT, entry TEXT,
                     enabled INTEGER, ord INTEGER, config JSON, updated_at TEXT);
CREATE TABLE experts(id TEXT PRIMARY KEY, name TEXT, tag TEXT, system_prompt TEXT,
                     criteria JSON, tools JSON, model TEXT, version INTEGER, enabled INTEGER);
CREATE TABLE analyses(id TEXT PRIMARY KEY, expert_id TEXT, symbol_code TEXT, symbol_category TEXT,
                      horizon INTEGER, vote INTEGER, reason TEXT, evidence JSON,
                      abstained INTEGER, created_at TEXT);
CREATE TABLE watchlist(symbol_code TEXT, symbol_category TEXT, added_at TEXT,
                       PRIMARY KEY(symbol_code, symbol_category));
CREATE TABLE journal(id TEXT PRIMARY KEY, symbol_code TEXT, symbol_category TEXT, action TEXT,
                     expert TEXT, horizon INTEGER, signal JSON, reasons JSON, price REAL,
                     closed INTEGER, note TEXT, created_at TEXT);
CREATE TABLE jobs(id TEXT PRIMARY KEY, type TEXT, status TEXT, progress INTEGER,
                  payload JSON, result JSON, created_at TEXT, finished_at TEXT);
CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT, action TEXT, detail JSON);
```

迁移：提供 `init_db()` 或 `migrations/`，可重复执行不报错。

---

## 5. 诚实性红线（违反即失败）

1. 任何量化数字必须可追溯到规则、样本数、时间区间；**内样本就说内样本**
2. 不许把「历史命中率」写成「78% 会涨」；前端必须同时展示样本量与口径
3. 专家无证据必须弃权；**禁止**固定文案冒充模型输出
4. 6,244 个标的里没有财报数据的，不许标成「已完成基本面分析」
5. 不接实盘、不下单；不存密钥到前端；不伪造「已连接」
6. 空状态、错误、超时、限流都要明确提示，不静默失败

---

## 6. 验收标准（逐条跑通）

**后端**

- `pytest` 全绿；新增测试至少覆盖：
  插件增删改排序与保护、概率接口（含 direction=0 / 日期越界 / 未知代码）、
  专家结构化解码与弃权路径、自选上限、journal 冻结与复盘计算、job 取消
- `curl` 可复现：
  - `GET /api/quant/probability?code=601088&horizon=10` 返回概率与 `evaluation.type`
  - `POST /api/experts/duan/analyze` 返回带 evidence 的结构化结论（无 key 时返回明确错误，不伪造）
  - `POST /api/plugins {"name":"龙虎榜"}` 后 `GET /api/plugins` 能看到
- 重启服务后状态保持

**前端**

- 首页 = Super Agent 对话；说「添加插件 龙虎榜」后导航出现，刷新仍在
- 量化页：搜索、1–20 根切换、日期换算、无信号态、样本量展示
- 专家页：6 位专家可配；结论含理由与证据；缺证据显示弃权
- 自选股：批量结果表 + 展开逐位意见
- 操盘记录：创建后刷新不丢；复盘能算收益或明确提示「待填价格」
- 390px 窄屏无横向溢出；键盘可达；错误态可读

**可复现**

- README 写清：安装、启动、初始化数据、环境变量、如何重跑概率网格
- 一条命令起服务：`python -m backend.serve` 或 `uvicorn backend.app:app`

---

## 7. 交付物

```
backend/                  FastAPI 应用、服务层、DB、迁移
backend/tests/            新增后端测试
web/                      前端（可基于现有 web/workbench 改造）
scripts/                  概率网格、插件脚手架等运维脚本
docs/API.md               接口文档
docs/PLUGIN.md            插件契约（manifest、权限、渲染/脚本两种模式）
docs/VERIFY.md            逐条验收命令与预期输出
README.md                 启动与验收步骤
```

---

## 8. 实施顺序

1. 读 `super_trader`、`probability_grid.json`、`web/workbench`，跑通现有测试
2. 起 FastAPI 骨架 + SQLite + 插件 CRUD + 静态托管现有前端
3. 接概率接口（先查网格，后按需重算）
4. 接模型网关与专家服务（先 1 位专家 + 1 个工具，再扩到 6 位）
5. 自选股批量研判 + job/SSE
6. 操盘记录与复盘（真实前向收益）
7. 插件自定义契约（声明式优先）
8. 补测试、写文档、逐条验收

---

## 9. 不要做的事

- 不要只改 HTML/CSS 就交付
- 不要把专家意见写成固定 JSON 当模型输出
- 不要新增未要求的功能（K 线画图、资讯流、组合优化等）；先把手上的做真
- 不要提交缓存、大文件、密钥
- 不要在没有接入数据时声称「已分析」
