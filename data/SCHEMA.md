# 数据契约（Data Contract）

`data/` 是纯静态 JSON / GeoJSON：无数据库、无服务端、无运行时远程依赖。任何技术栈
只需实现本契约即可替换前端（当前消费方：MapLibre 图层，见文末）。

坐标系一律 WGS84 经纬度 `[lng, lat]`。字段变更须同步 `tools/validate.mjs` 与本文档。

## 目录

```
data/
├── timeline.json          时间轴索引（唯一入口：断面 + 事件）
├── geo/s{id}.json         断面疆域面（多政权并立时多个 feature）
├── geo/s{id}-div.json     断面政区界
├── geo/s{id}-places.json  断面据点层（都邑/方国/遗址点位）
├── geo/modern.json        现代国界（对照底图）
├── geo/provinces.json     现代省界
├── geo/neighbors.json     周边现代国界
└── geo/places-modern.json 现代行政地名点位（省/市/县驻地）
```

断面 id 形如 `sbc221` / `s780` / `s1911`：`s` + 可选 `bc`（公元前）+ 公元年份数值。
时间轴在断面间连续拖动，前端吸附最近断面；`range` 之外无数据。

## timeline.json — 时间轴索引

顶层 `{ range, eras, snapshots, events }`：

- `range`：`{ from, to }` 断面年份范围（负数即公元前，下同）
- `eras[]`：时代分段（时间轴底色/聚合/侧栏简介），按 `from` 升序、相邻段
  `from == 前段 to`，首尾恰覆盖 `range`
- `snapshots[]`：按 `year` 严格升序，不许重复年份
- `events[]`：跨断面按上游朝代标签合并、按标题去重，按 `year` 升序

### eras[] 每条

- `name`：时代名，与 `snapshots[].era` 取值一致
- `from` / `to`：起止年份（分段边界，非断面对齐）
- `color`：**表现层元数据**（`#RRGGBB`，取该时代首个断面主政权色）
- `summary`：时代一句话简介（侧栏展示）

### snapshots[] 每条

- `id` / `year` / `era` / `label` / `note`：内容元数据；`era` 供时间轴分段聚合展示
- `regimes[]`：该断面的政权列表（多政权并立时 >1）
  - `name`：政权名，全局唯一拼写——跨断面同名即同政权（着色稳定的前提）
  - `color`：**表现层元数据**（`#RRGGBB`，跨断面稳定），迁移时可按需取舍
  - `weak`：边缘政权（游牧/藩属等，渲染更淡、不参与政区归属）
- `geoFile`：相对 `data/` 的疆域文件指针
- `divisionsFile`：相对 `data/` 的政区文件指针，**可选**——上古断面（夏商西周，
  谭图本就不画政区）省略此字段即无政区层
- `placesFile`：相对 `data/` 的据点文件指针，**可选**——断面据点层（都城/都邑/
  方国/遗址点位）；上古断面为主，任何断面可用

### events[] 每条

- `year` / `yearLabel`（如 `前214年`）/ `era` / `title` / `description`
- `location`：`{ name, lng, lat }`，校验范围 lng∈[70,140]、lat∈[15,58]；
  `year` 须落在 `range` 内
- `tag`：事件类型，当前前端未消费，保留待扩展
- `sig`：显著度，**仅供构建期筛选**，前端不消费

## geo/s{id}.json — 断面疆域面

FeatureCollection，每政权恰 1 个 feature（≥1），与 `regimes[]` 一一对应：

- `properties.name = "__regime_{政权名}"`（哨兵前缀 + 政权名）
- `properties.layer = "dynasty"`；`properties.regime` 与哨兵后缀一致
- `properties.source` 为来源注记
- `geometry`：MultiPolygon，坐标 **2 位小数**（≈1km 精度）

## geo/s{id}-div.json — 断面政区界

FeatureCollection，多个 feature：

- `properties.name`：真实政区名（悬浮提示与标注用，非哨兵值）
- `properties.layer = "division"`；`properties.type` ∈ 郡/州/路/府（可为空串）
- `properties.regime`：归属政权名，取值对齐同断面 `regimes[].name`；
  空串 = 未归属（极少数无法判定者）
- `geometry`：Polygon | MultiPolygon，2 位小数
- 覆盖不完整是已知现状（早期朝代受上游数字化进度限制），非契约要求；
  治所 Voronoi 胞元仅为示意性兜底

## geo/s{id}-places.json — 断面据点层

FeatureCollection，**Point** 几何（懒加载，加载失败静默降级，同政区层）：

- `properties.name`：据点名（如 殷 / 亳 / 盘龙城），断面内唯一
- `properties.kind`：枚举 `都城 | 都邑 | 方国 | 部族 | 遗址`（渲染符号分级；
  部族=疆域之外的邻邦部族，更淡更小）
- `properties.today`：今地名（如 河南安阳），tooltip 古今对照用
- `properties.note`：一句话依据/说明
- `properties.layer = "place"`；坐标 2 位小数

## 对照底图三件

| 文件 | name 哨兵值 | layer | 专有属性 | 精度 |
|---|---|---|---|---|
| modern.json | `__modern__` | `modern` | — | 3 位小数（DataV 原始精度） |
| provinces.json | `__provinces__` | `provinces` | `province`（省名） | 2 位 |
| neighbors.json | `__neighbors__` | `neighbors` | `country`（国名，不含 China） | 2 位 |

## geo/places-modern.json — 现代行政地名点位

FeatureCollection，**Point** 几何（省/市/县三级行政区驻地，随「现代地名」开关
懒加载，与 timeline 无指针关系）：

- `properties.name`：行政区名
- `properties.adcode`：行政区划代码（数字）
- `properties.level`：枚举 `province | city | district`
- `properties.province` / `properties.city`：父级名（省名尽量齐；直辖市区县
  city 与省同名；省直辖县级市 city 与省同名）
- `properties.layer = "modern-place"`；坐标 2 位小数
- 来源：阿里 DataV GeoAtlas 递归提取驻地点（几何即弃），约 3200 点

## 图层识别约定

前端把多个 FeatureCollection 按 source 分层渲染（MapLibre，2026-10 由 ECharts geo 迁移）：

- 每类图层一个 GeoJSON source：`regime`（疆域）/ `divisions`（政区，`promoteId: "name"`）/
  `modern` / `provinces` / `neighbors`（对照底图），点位层 `places` / `modern-places` / `events`
- 政权配色注入要素 `properties.color`（源自 timeline.json regimes，渲染层 paint 表达式读取）

## 渲染资源目录（非数据契约）

`data/fonts/` 为渲染层资源（楷体 woff2 分片 + fontFaces 声明），由
`tools/gen-fonts.mjs` 从 npm 包 `lxgw-wenkai-webfont`（OFL）生成，validate 豁免；
与 `data/geo/` 的数据契约无关，替换前端时可不迁移。

## 消费方

- `src/main.js`：timeline 索引 + 事件；`src/map.js`：断面疆域 + 政区
  （按需懒加载断面文件，政区加载失败静默降级为无政区层并 `console.warn`）
- `node tools/validate.mjs`：结构 / 字段 / 坐标范围 / 文件引用完整性自检
- `node tools/build-data.mjs`：远程源 → 本目录的生成管线，产物已提交，可复现
