# Super Agent 工作台 · 接口文档

基址：`http://127.0.0.1:8000`。所有业务接口在 `/api` 下，返回 JSON。错误统一为
`{"error": "..."}`，HTTP 状态码表达语义（400 参数错、404 不存在、409 冲突、
422 样本不足、429 限流、503 未配置模型、504 超时）。

诚实性约定（全局）：
- 所有量化概率都是**内样本历史频率**（`evaluation.type = in_sample`），不是校准的未来概率。
- `direction = 0`（无方向信号）时 `probability` 返回 `null`，只给 `baseline_up`。
- 专家结论必须带 `evidence`；无证据时 `vote=0, abstained=true`。
- 未配置模型密钥时专家接口返回 503 明确错误，**不伪造**结论。

---

## 0.5 专家自主选股与投研主流程

- `GET /api/market/search?q=股票名称&limit=20`：真实A股目录，独立于本地日线。
- `GET /api/market/sectors?tag=industry&q=&offset=0&limit=30`：真实行业/概念目录。
- `POST /api/research/select`：`{scope?:"market"|"watchlist"|"sector",sector?:完整指数代码,expert_ids?:string[],brief?:string,limit_per_expert?:number}`。默认真实全A股，专家1..6位、brief最多1000字符、每位候选上限1..10(默认5)。真实模型各自发现候选、按理念读取证据并选股，返回`{job:{id,status,...}}`；不接收统一财务阈值、量化style或预置股票名单。完整scope只界定可探索成员，不声称逐股完整比较。
- `GET /api/research/screen`：410迁移提示，不再用量化候选冒充主选股。原只读网格筛选保留为`GET /api/research/quant-screen`高级统计，不由主选股页面或st_screen_stocks调用。
- `GET /api/research/stock?code=601088`：真实行情/日K、观测趋势、5/10/20网格信号、默认最近5期季报合并财务数据和估值；分源available/error；方向0概率null，保留历史统计口径，不重拟合全市场。
- `GET /api/research/sector?thscode=881101.TI`：指数无复权日K、观测趋势、当前成分与首50个成分的行情广度；无完整身份匹配的本地指数量化时明确缺失，不用同号股票代替。
- `POST /api/research/team`：`{kind:"stock"|"sector",code,expert_ids?:string[]}`，返回`{job:{id,status,...}}`。明确调用真实模型、可能计费；不接收horizon字段。有效专家1..6，同一活跃对象/团队请求复用任务。
- `GET /api/jobs/{id}` / `POST /api/jobs/{id}/cancel`：查询/取消研究，不发证券订单。

自主选股job.result.kind=`expert_selection`，保留scope/sector/brief/limit_per_expert、真实universe、各expert_results、common_picks、differences、errors及activity。每专家自行调用candidate_directory/sector_directory/sector_members/read_stock；取证股票必须由该专家在本次scope目录实际发现；read_stock可按需选择quote/history/trend/fundamentals/valuation/quant，财报可选annual或quarterly的1..8期。各专家证据账本独立，picks.evidence为`{source_id,ref}`，ref针对返回的完整source记录，必须为该股真实非null事实叶；目录名字、他股数据、不可用来源不能作选股事实。量化not_requested/unavailable不淘汰有其它证据的候选。自主探索与最终汇总有界，仅保留真实返回，不无限重试或强制凑数。

报告源各有独立日期，created_at不是源数据截止日。专家读取同一冻结bundle（末5根真实日K、首5成分及省略计数），输出reason/evidence/outlook/risks/abstained；outlook包含short_term、medium_term、bull_case、bear_case、invalidation。evidence.ref须是冻结报告中真实存在的非null事实叶节点RFC6901路径；无效引用强制弃权。团队有效票支持比例不是上涨概率。取消在专家之间检查，不承诺中断已在途HTTP。

供应商契约参考：[指数与板块](https://raw.githubusercontent.com/Hithink-Tech-Org/Financial-API/main/docs/api/index/a-share-index.md)、[财务报表](https://raw.githubusercontent.com/Hithink-Tech-Org/Financial-API/main/docs/api/a-share/financials.md)、[估值](https://raw.githubusercontent.com/Hithink-Tech-Org/Financial-API/main/docs/api/a-share/valuations-snapshot.md)。HTTP200仍须检查业务信封code严格为整数0；凭据不进入前端或安装包。

## 0.6 量化因子预测（新增，日线先行）

口径：同一时间框架内，h=1..20 共用**同一条规则、一个方向**；`actual_h = sign(close[t+h]/close[t]-1)`；方向一致记正确，中性跳过、不计分母，持平计错。最终准确率 = 正确窗口/有效窗口，唯一验收指标。不同时间框架可各自使用不同规则。

- `GET /api/factors/stock?code=601088&timeframe=1d`：本地日线全历史回测，返回 `{kind,target,as_of,bars,direction,rule,metrics,rules,warnings}`。`metrics` 含 `accuracy`（无有效窗口为 null）、`coverage`、`evaluated`、`correct`、`skipped`、`not_evaluated`、`baseline:{always_up,same_set}`、`per_horizon`（20 项）、`confusion`。
- `GET /api/factors/backtest?code=&rule_id=`：同 metrics，另含 `samples.false_positive/false_negative`（各≤5条，日期/窗口/收益）。
- `GET /api/factors/rules`：种子规则清单 `{items:[{id,name}],total}`。
- 时间框架当前仅 `1d`；其它值返回 400。股票不存在/数据不足返回 404/422，不伪造结果。
- 全样本回测、未做样本外；历史频率不是未来概率。当前方向与评分使用同一neutral_band。

### 0.8 批量自主挖掘

- `GET /api/factors/universe`：全部本地CSV目录，个股/ETF/指数独立typedID，返回total/categories/timeframe，不默认抽样。
- `POST /api/factors/research`：`{scope:'all',timeframe:'1d',workers:4,max_trials:5,max_model_calls:16,minutes:30,brief:''}`；显式调用模型、可能计费，返回`{job}`。scope='targets'必须显式提供typedID数组，只用于明确子范围，不冒充全量。
- `GET /api/factors/results?job_id=&offset=0&limit=50&q=`：SQLite分页，按类别/代码，不做横截面排名；未处理/失败/不足项的rule/as_of/direction/accuracy为null，不补零。
- 任务仍用`GET /api/jobs/{id}`与`POST /api/jobs/{id}/cancel`。预算耗尽状态error、phase budget_exhausted，保留真实成果，不伪装研究已完整结束。
- `stock`/`backtest`支持category=个股|ETF|指数。已验证的LLM候选池最佳优先，未挖掘的个股种子仅seed_reference；临时代码是code_ad_hoc，不能冒称LLM批量成果。baseline.always_up是全有效窗口单边基准、same_set为该规则相同评估集；confusion.up/down均指预测方向行。
- 模型自主写规则、分片并行评测全部scope、逐标的独立择优。后续可用research_memory/rule_details读取历史代码与笔记继续；笔记口述分数不采信。旧quant网格为legacy，生产专家优先新factor，无成果不得fallback冒充。

## 状态与审计

### `GET /api/status`
```json
{
  "ok": true,
  "model": {"configured": false, "model": null, "base_url": null},
  "grid": {"snapshot": "2026-11-05", "symbols": 6244, "horizons": [1, "…", 20]},
  "plugins_enabled": 4
}
```
`model.configured=false` 表示未接入模型；密钥永远不出现在响应里。

### `GET /api/audit?limit=100`
返回最近的变更审计（谁、何时、改了什么）。

### `GET /api/symbols/search?q=神华&limit=20`
按代码或名称模糊搜索标的。

---

## 实时行情（同花顺 Financial-API）

独立于量化快照与模型密钥：行情失败不影响 `/api/quant/probability`，历史概率也不会被实时价替换。

### `GET /api/market/status`
```json
{"configured": true, "source": "同花顺 Financial-API",
 "cache_ttl_seconds": 15, "capabilities": ["a-share-quotes"]}
```
`configured` 只表示**本地存在凭据**，不代表供应商连通或配额充足；凭据值永不返回。

### `GET /api/market/quotes?codes=601088,000001`
`codes`：1–50 个六位代码或标准 `thscode`（如 `601088.SH`），逗号分隔。

```json
{
  "source": "同花顺 Financial-API", "provider": "hithink-finance",
  "timestamp": 1794549568000, "fetched_at": "2026-11-13T13:59:28+08:00",
  "cached": false, "cache_age_seconds": 0,
  "items": [{"code": "601088", "name": "中国神华", "thscode": "601088.SH",
             "last_price": 49.94, "price_change": 0.98, "price_change_ratio_pct": 2.0016,
             "open_price": 48.77, "high_price": 50.3, "low_price": 48.66,
             "prev_price": 48.96, "volume": 28611053, "turnover": 1421608900,
             "timestamp": 1794549568000}],
  "missing": [], "warnings": ["接口快照 timestamp 为上游响应组装/数据就绪时间，不等于逐笔成交时间或交易所时间。"]
}
```

- 裸代码先经标的目录**唯一解析**为 A 股；无法唯一解析返回 422（不猜交易所后缀）。
- `timestamp` 保留上游快照毫秒值，可能为 `null`；`null` 不补 0，缺数据进 `missing` 而非编造价格。
- 15 秒进程内缓存；`cached` / `cache_age_seconds` 说明这次是否命中。
- 错误：`503` 未配置或限流、`502` 鉴权/网络/业务失败、`422` 标的不支持或无法消歧、`504` 超时。响应体 `{"error","code","provider_code"?}` 均脱敏。
- 本接口仅供只读研究，不构成交易指令。

---

### `GET /api/market/history?code=601088&limit=120&adjust=forward`

返回最多最近 `5..180` 根真实日K（默认120），单只A股，`adjust` 为 `forward / none / backward`。后端仅向上游请求最近400个自然日窗口，按日期升序截取末尾；60秒进程缓存，不写入本地量化研究数据。

返回 `code/name/thscode/source/provider/interval/adjust/timestamp/fetched_at/cached/cache_age_seconds/items/warnings`；`items` 保留上游 `date_ms/open_price/high_price/low_price/close_price/volume/turnover`。无数据 `items=[]`，绝不生成走势。日期或数值结构错误明确报错。

`/api/status` 兼容原字段，并增加 `capabilities`：`backend_ready / research_data_available / grid_available / data_configured / report_configured / market_configured / model_configured`。配置存在与真实服务可用是不同事实；没有研究数据不影响后端启动或独立行情查询。

---

## 插件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/plugins?enabled_only=false` | 列出插件（按 order） |
| POST | `/api/plugins` | 新建自定义插件 `{"name":"龙虎榜"}` |
| GET | `/api/plugins/{id}` | 取单个 |
| PATCH | `/api/plugins/{id}` | 改名/启停/排序/配置 `{"name","enabled","order","config","permissions"}` |
| DELETE | `/api/plugins/{id}` | 删除（仅自定义） |
| POST | `/api/plugins/reorder` | 重排 `{"order":["id1","id2",...]}` |

保护：至少保留一个启用插件（否则 409）；内置插件（quant/experts/watchlist/journal）不可删除（409）。

插件记录：
```json
{"id":"quant","name":"量化概率","icon":"chart","kind":"quant","entry":"builtin:quant",
 "enabled":true,"order":0,"builtin":true,"permissions":["read:snapshot"],"config":{}}
```

---

## 量化概率

### `GET /api/quant/probability`
参数：`code`（必填）、`category`（可选，不填自动解析）、`horizon`（1–20）**或** `date`
（未来具体日期，二选一）、`recompute`（true 时跳过网格强制重算）。

```json
{
  "symbol": {"code":"601088","category":"个股","name":"中国神华"},
  "target": {"horizon":10,"target_date":"2026-11-19","trading_days":10},
  "direction": 1, "direction_label": "上涨",
  "probability": 0.544,
  "sample": {"predictions":453,"coverage":0.102,"period":["2005-01-04","2026-11-05"]},
  "baseline_up": 0.5,
  "rules": [{"key":"波动率__squeeze_break","desc":"…"}],
  "method": "fullfit_recency_weighted_v1",
  "evaluation": {"type":"in_sample","calibrated":false},
  "warnings": ["内样本历史频率，不是校准后的未来概率","中性期（无方向信号）不发出预测"],
  "source": "grid"
}
```
- 日期 → 交易日用标的真实日期序列；快照日之后的未来日期按工作日投影，并在 `warnings`
  里标注为投影交易日（未排除法定节假日）。
- `source`：`grid`（取自预算网格）或 `recompute`（按需用 fullfit 现算）。

---

## 专家

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/experts?enabled_only=false` | 列出专家 |
| POST | `/api/experts` | 新建/更新（带 `id` 即更新，version 自增） |
| GET | `/api/experts/{id}` | 取单个 |
| POST | `/api/experts/{id}/analyze` | 单专家研判 `{"code","category","horizon"}` |
| POST | `/api/experts/team/analyze` | 团队研判 `{"code","horizon","threshold","require_unanimous","expert_ids"}` |
| GET | `/api/analyses?code=&limit=50` | 历史研判记录 |

单专家研判响应：
```json
{"expert":{"id":"duan","name":"段永平","tag":"…"},
 "symbol":{"code":"601088","category":"个股","name":"中国神华"},
 "horizon":10,"vote":1,"confidence":"medium","reason":"…",
 "evidence":[{"source":"quant_snapshot","ref":"第10根 概率0.58 样本453"}],
 "abstained":false,"tool_trace":[...],"created_at":"…"}
```
团队共识：`consensus = {decision: up|down|no_consensus, support, voted, abstained}`；
`support` = 支持方向的有效票占比，默认门槛 0.6，可传 `require_unanimous=true` 要求全体一致。

未配置密钥：返回 `503 {"error":"未配置模型密钥…"}`。

---

## 自选股

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/watchlist` | `{items, max:200}` |
| POST | `/api/watchlist` | 加入 `{"code","category"}`（上限 200，超出 409） |
| DELETE | `/api/watchlist?code=&category=` | 移除 |
| POST | `/api/watchlist/analyze` | 批量研判 `{"horizon","threshold","with_experts"}` → 返回 job |

---

## 任务队列（批量研判）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/jobs?limit=50` | 列出任务 |
| GET | `/api/jobs/{id}` | 任务详情（status/progress/total/result） |
| POST | `/api/jobs/{id}/cancel` | 取消 |
| GET | `/api/jobs/{id}/stream` | SSE 进度流（`data: {job}`） |

status：`queued|running|done|error|cancelled|interrupted`（重启后残留任务标 interrupted）。

---

## 操盘记录与复盘

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/journal?expert=&closed=` | 列表（可筛选） |
| POST | `/api/journal` | 新建（冻结信号+理由） |
| GET | `/api/journal/{id}` | 取单个 |
| PATCH | `/api/journal/{id}` | 仅改 `note`/`closed`/补填 `price`（不改快照） |
| DELETE | `/api/journal/{id}` | 删除 |
| GET | `/api/journal/{id}/review` | 复盘（真实前向收益 + 信号漂移） |
| GET | `/api/journal/export?fmt=json\|csv&expert=` | 导出 |

新建请求可带 `entry_date`（回填历史成交日），用于对已走完的持有期做真实复盘。

复盘响应：
```json
{"id":"J-…","horizon":10,"recorded_direction":1,
 "signal_drift":{"recorded_direction":1,"current_direction":0,"drifted":true},
 "return":{"available":true,"entry_date":"2026-09-01","entry_price":35.0,
           "exit_date":"2026-09-15","exit_price":46.98,
           "forward_return":0.342,"hit":true,"mode":"full"}}
```
没有成交价且进场日晚于数据时，`return.available=false`、`mode=direction_only`，不编造收益。

---

## 记忆（跨轮/跨会话）

Super Agent 每轮对话后抽取约束/决策/进度/事实记忆，下轮自动投影进 system prompt，
让它记住你的投研偏好。规则驱动抽取，不改模型权重。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/memory?scope=agent&include_retired=false&limit=200` | 列表 + 统计 |
| POST | `/api/memory` | 手动记一条 `{"kind","text","scope","subject","importance"}` |
| GET | `/api/memory/stats?scope=agent` | 统计（活跃/退役/各类型） |
| GET | `/api/memory/recall?q=电池&scope=agent` | 全文召回 |
| DELETE | `/api/memory/{id}` | 删除一条 |
| POST | `/api/memory/clear?scope=agent` | 清空某作用域 |

记忆节点：
```json
{"id":"M-…","scope":"agent","kind":"constraint","text":"默认用第10个交易日做研判",
 "subject":"默认用第#个交易日做研","importance":1.0,"activations":2,
 "source":{"from":"user_message"},"retired":false,"superseded_by":null,
 "created_at":"…","last_used_at":"…"}
```
- `kind`：`constraint`（约束/偏好）/ `decision`（决策）/ `progress`（进度）/ `fact`（事实）
- 约束/决策按主题归一（数字归并为 `#`）判定「同一件事」：新表述会取代旧节点，旧节点
  标记 `retired` 并记 `superseded_by`，仍可召回，不直接删除。
- `POST /api/memory` 文本过短或无意义返回 400，不记录。

## Super Agent 对话

### `POST /api/agent/chat`  `{"message":"添加插件 龙虎榜"}`
```json
{"reply":"已添加插件「龙虎榜」，已在导航出现。",
 "actions":[{"tool":"add_plugin","args":{"name":"龙虎榜"},"result":{...}}],
 "mode":"deterministic"}
```
有模型密钥时走模型 + 函数调用（`mode:"model"`）；无密钥时用确定性意图解析
（`mode:"deterministic"`）。两条路径执行的都是真实后端操作。
