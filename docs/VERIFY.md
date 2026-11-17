# 逐条验收

下面每条都可复现。Windows PowerShell 下建议用 `curl.exe`；含中文的请求体请用 UTF-8
文件或 Python `requests` 发送（Windows 控制台直接内联中文可能被转成 `?`，这是终端编码
问题，不是后端问题——后端 UTF-8 收发已由测试与 Python requests 验证）。

## 0. 环境与启动

```powershell
pip install -r requirements.txt
python -m backend.serve          # 或 uvicorn backend.app:app
# 打印：状态库路径、模型是否配置、监听地址
```
打开 http://127.0.0.1:8000 即为前端首页（Super Agent 对话）。

## 1. 后端测试全绿

```powershell
python -m pytest
# 预期：150 passed（113 现有 + 37 新增）
```
新增测试覆盖：插件增删改排序与保护、概率接口（direction=0 / 日期越界 / 未知代码 /
缺参数）、专家结构化解码与弃权路径、自选上限、journal 冻结与复盘计算、job 取消。

## 2. curl 可复现

### 2.1 概率接口（含 evaluation.type）
```powershell
curl.exe -s "http://127.0.0.1:8000/api/quant/probability?code=601088&category=%E4%B8%AA%E8%82%A1&horizon=10"
```
中国神华当前为中性（direction=0），所以 `probability:null`，并给出 `baseline_up`：
```json
{"symbol":{"code":"601088","name":"中国神华"},"direction":0,"probability":null,
 "baseline_up":0.514,"evaluation":{"type":"in_sample","calibrated":false},
 "warnings":["内样本历史频率，不是校准后的未来概率","中性期（无方向信号）不发出预测",...]}
```

有方向的例子（159603 第 1 根为下跌，概率 0.595，规则由按需重算补齐）：
```powershell
curl.exe -s "http://127.0.0.1:8000/api/quant/probability?code=159603&category=ETF&horizon=1"
```
```json
{"direction":-1,"direction_label":"下跌","probability":0.595,
 "sample":{"predictions":218,"coverage":0.231,"period":["2022-12-01","2026-11-04"]},
 "rules":[{"key":"波动率__trend_lowvol","desc":"仅在低波动…顺势"}],
 "evaluation":{"type":"in_sample","calibrated":false}}
```

边界：
```powershell
curl.exe -s "http://127.0.0.1:8000/api/quant/probability?code=999999&horizon=10"      # 404 未知标的
curl.exe -s "http://127.0.0.1:8000/api/quant/probability?code=601088&date=2026-11-03"  # 400 不晚于快照日
```

### 2.2 专家研判（无 key 返回明确错误，不伪造）
```powershell
curl.exe -s -X POST -H "Content-Type: application/json" `
  -d "{\"code\":\"601088\",\"horizon\":10}" `
  "http://127.0.0.1:8000/api/experts/duan/analyze"
# 503 {"error":"未配置模型密钥，无法调用专家模型。请设置环境变量 ST_MODEL_API_KEY。"}
```
配置 `ST_MODEL_API_KEY` 后重启，返回带 evidence 的结构化结论：
```json
{"expert":{"id":"duan","name":"段永平"},"vote":0,"confidence":"low",
 "reason":"缺财报证据，按本分理念弃权","evidence":[{"source":"quant_snapshot","ref":"…"}],
 "abstained":true}
```

### 2.3 新增插件后能看到
用 UTF-8 文件发送中文：
```powershell
Set-Content body.json '{"name":"龙虎榜"}' -Encoding utf8
curl.exe -s -X POST -H "Content-Type: application/json" --data-binary "@body.json" `
  "http://127.0.0.1:8000/api/plugins"
curl.exe -s "http://127.0.0.1:8000/api/plugins"   # 列表中出现「龙虎榜」
```
（或 `python -c "import requests;requests.post('http://127.0.0.1:8000/api/plugins',json={'name':'龙虎榜'})"`）

### 2.4 自选批量研判（job + 结果）
```powershell
Set-Content w.json '{"code":"159603","category":"ETF"}' -Encoding utf8
curl.exe -s -X POST -H "Content-Type: application/json" --data-binary "@w.json" "http://127.0.0.1:8000/api/watchlist"
Set-Content a.json '{"horizon":1,"with_experts":false}' -Encoding utf8
curl.exe -s -X POST -H "Content-Type: application/json" --data-binary "@a.json" "http://127.0.0.1:8000/api/watchlist/analyze"
# 取返回的 job.id 轮询
curl.exe -s "http://127.0.0.1:8000/api/jobs/<job-id>"
# status=done，result.items[0].quant = {direction:-1, probability:0.595, predictions:218}
```

### 2.5 操盘记录冻结 + 真实复盘
```powershell
# 回填历史进场日，使持有期已走完，可算真实收益
Set-Content j.json '{"code":"601088","category":"个股","action":"buy","horizon":10,"price":35.0,"entry_date":"2026-09-01"}' -Encoding utf8
curl.exe -s -X POST -H "Content-Type: application/json" --data-binary "@j.json" "http://127.0.0.1:8000/api/journal"
curl.exe -s "http://127.0.0.1:8000/api/journal/<J-id>/review"
```
复盘用真实收盘价：进场 35.0 → 第 10 根 46.98，`forward_return≈0.342`、`hit=true`、
`mode=full`，并给出信号漂移（记录时方向 vs 现在方向）。
无成交价且进场日晚于数据时 `return.available=false, mode=direction_only`，不编造收益。

## 3. 重启后状态保持

```powershell
# 停止服务再用同一个状态库重启
python -m backend.serve
curl.exe -s "http://127.0.0.1:8000/api/plugins"            # 「龙虎榜」仍在
curl.exe -s "http://127.0.0.1:8000/api/journal/<J-id>"      # 记录与冻结的 price/signal 仍在
```

## 4. 前端逐条

- 首页 = Super Agent 对话；输入「添加插件 龙虎榜」→ 导航出现；刷新仍在。
- 量化页：搜索标的、1–20 根切换、勾选「用日期」做换算、无信号态显示「无方向」、
  展示样本量与口径。
- 专家页：6 位专家可配；结论含理由与证据；缺证据显示弃权；未配密钥有明确提示。
- 自选股：批量结果表（方向/概率/样本/共识），点行展开逐位意见；进度条 + 取消。
- 操盘记录：新建后刷新不丢；「复盘」按钮算收益或提示「待填价格」；导出 CSV/JSON。
- 窄屏 390px 无横向溢出（侧栏折叠为抽屉）；skip-link、`aria-live` 可达；错误态 toast 可读。

## 5. 诚实性红线自查

- 概率字段永远带 `evaluation.type=in_sample`、`calibrated=false` 与 `warnings`。
- `direction=0` 一律 `probability=null`。
- 专家无证据强制 `vote=0, abstained=true`（见 `backend/experts.py::_validate`）。
- 未接入财报/新闻：`filings_search`/`news_search` 工具返回 `available=false`，专家据此弃权。
- 无模型密钥：专家接口 503，绝不伪造。
- 密钥只从环境变量读，`/api/status` 只暴露 `configured` 布尔与模型名，绝不回传密钥。

## 6. 重跑概率网格（可选，约 2 小时）

```powershell
python scripts/build_probability_grid.py --workers 3
# 输出 reports/fullfit/probability_grid.json
```
