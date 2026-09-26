# 数据契约（Data Contract）

`data/` 是纯静态 JSON / GeoJSON：无数据库、无服务端、无运行时远程依赖。任何技术栈
只需实现本契约即可替换前端（当前消费方：ECharts 图层，见文末）。

坐标系一律 WGS84 经纬度 `[lng, lat]`。字段变更须同步 `tools/validate.mjs` 与本文档。

## 目录

```
data/
├── dynasties.json      朝代索引（入口）
├── geo/{id}.json       历史疆域面（id ∈ qin han_w tang yuan ming qing）
├── geo/{id}-div.json   本朝政区界
├── geo/modern.json     现代国界（对照底图）
├── geo/provinces.json  现代省界
├── geo/neighbors.json  周边现代国界
└── events/{id}.json    历史事件
```

## dynasties.json — 朝代索引

数组，每代一条：

- `id` / `name` / `en` / `period` / `snapshotLabel` / `summary`：内容元数据
- `color`：**表现层元数据**（疆域填充与强调色，`#RRGGBB`），迁移时可按需取舍
- `geoFile` / `eventsFile`：相对 `data/` 的文件指针
- `divisionsFile`：同上，但**可缺省**（无政区图层的朝代）

## geo/{id}.json — 历史疆域面

FeatureCollection，恰 1 个 feature：

- `properties.name = "__dynasty__"`（哨兵值，图层识别用）
- `properties.layer = "dynasty"`；`properties.source` 为来源注记
- `geometry`: MultiPolygon，坐标 **2 位小数**（≈1km 精度）

## geo/{id}-div.json — 本朝政区界

FeatureCollection，多个 feature：

- `properties.name`：真实政区名（悬浮提示与标注用，非哨兵值）
- `properties.layer = "division"`；`properties.type` ∈ 郡/州/路/府（可为空串）
- `geometry`: Polygon | MultiPolygon，2 位小数
- 覆盖不完整是已知现状（早期朝代受上游数字化进度限制），非契约要求

## 对照底图三件

| 文件 | name 哨兵值 | layer | 专有属性 | 精度 |
|---|---|---|---|---|
| modern.json | `__modern__` | `modern` | — | 3 位小数（DataV 原始精度） |
| provinces.json | `__provinces__` | `provinces` | `province`（省名） | 2 位 |
| neighbors.json | `__neighbors__` | `neighbors` | `country`（国名，不含 China） | 2 位 |

## events/{id}.json — 历史事件

数组，按 `year` 升序：

- `year`：数值，负数即公元前
- `yearLabel`：展示串（如 `前214年`）；`title` / `description`：文案
- `location`：`{ name, lng, lat }`，校验范围 lng∈[70,140]、lat∈[15,58]
- `tag`：事件类型，当前前端未消费，保留待扩展
- `sig`：显著度，**仅供构建期筛选**（`build-data.mjs` 取每代前 12 条），前端不消费

## 图层识别约定

前端把多个 FeatureCollection 合并后按 `properties` 判别图层：

- 4 个哨兵名（`__` 前缀）：`__dynasty__` / `__modern__` / `__provinces__` / `__neighbors__`
- 政区要素无哨兵名，以 `layer = "division"` 判别

## 消费方

- `src/main.js`：索引 + 事件；`src/map.js`：疆域 + 政区（Map 缓存，政区加载失败
  静默降级为无政区层并 `console.warn`）
- `node tools/validate.mjs`：结构 / 字段 / 坐标范围 / 文件引用完整性自检
- `node tools/build-data.mjs`：远程源 → 本目录的生成管线，产物已提交，可复现
