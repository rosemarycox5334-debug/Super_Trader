# 插件契约

插件是**运行时真实注册**的记录，不是写死的前端页面。记录落在 SQLite `plugins` 表，
导航由后端 `GET /api/plugins` 下发。Super Agent 可通过对话或 UI 增删、启停、排序。

## Manifest（插件记录）

```json
{
  "id": "longhu",
  "name": "龙虎榜",
  "icon": "puzzle",
  "kind": "custom",
  "entry": "declarative:longhu",
  "enabled": true,
  "order": 4,
  "builtin": false,
  "permissions": ["read:snapshot"],
  "config": {}
}
```

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识，自定义插件由名字 slug 生成，冲突时追加随机后缀 |
| `kind` | `quant` / `experts` / `watchlist` / `journal` / `memory`（内置）或 `custom`（自定义） |
| `entry` | `builtin:<kind>` 或 `declarative:<id>`（或受限脚本，见下） |
| `enabled` | 停用后从导航隐藏；系统保证至少一个启用 |
| `order` | 导航顺序，`reorder` / `move_first` 维护 |
| `builtin` | 内置插件，不可删除 |
| `permissions` | 声明式权限标签（如 `read:snapshot`、`call:model`），用于审计与未来的沙箱控制 |

## 权限

| 权限 | 含义 |
|---|---|
| `read:snapshot` | 读取量化快照/概率网格（只读） |
| `call:model` | 允许触发模型调用（专家类） |
| `read:memory` / `write:memory` | 读取 / 写入 Super Agent 记忆（记忆插件） |

权限是声明式标签：记录在 manifest 里、写进审计，便于审查「这个插件被授予了什么」。
自定义插件默认无权限，需要时显式声明。

## 两种自定义插件契约

### 1）声明式渲染（推荐）

在 `config` 里声明渲染方式与数据源，前端按声明拉取并渲染，不执行任意代码：

```json
{
  "name": "我的排行",
  "config": {
    "render": "table",
    "data_source": "/api/analyses?limit=50"
  }
}
```

- `render`：`table` | `list` | `cards` | `markdown`
- `data_source`：一个返回 JSON 的后端 URL（数组、`{items:[...]}` 或 `{data:[...]}`）
- 前端把返回的行渲染成表格/列表；`markdown` 模式直接展示文本

创建：
```bash
curl -X POST http://127.0.0.1:8000/api/plugins \
  -H "Content-Type: application/json" \
  -d '{"name":"我的排行","config":{"render":"table","data_source":"/api/analyses?limit=50"}}'
```

校验：`render` 必须是允许值之一，否则 400。

### 2）受限脚本（预留，默认关闭）

如需逻辑处理，走后端沙箱：提供**只读上下文**（量化快照、概率网格），
禁止网络与文件写。脚本以声明式 manifest 注册，后端执行并把结果作为声明式数据源回灌前端。
当前实现以声明式渲染为主路径；受限脚本接口保留给后续扩展，未启用时不暴露任意执行入口。

## 保护与审计

- 至少保留一个启用插件（尝试停用最后一个 → 409）。
- 内置插件不可删除（→ 409）。
- 所有增删改排序写入 `audit` 表：`GET /api/audit` 可查。

## Super Agent 驱动

自然语言会被翻译成上述 API：

| 说法 | 实际操作 |
|---|---|
| 「添加插件 龙虎榜」 | `POST /api/plugins {"name":"龙虎榜"}` |
| 「隐藏插件 专家团队」 | `PATCH /api/plugins/experts {"enabled":false}` |
| 「把自选股排到最前」 | 重排，`watchlist` 置顶 |
| 「删除插件 龙虎榜」 | `DELETE /api/plugins/<id>`（内置会被拒绝） |
