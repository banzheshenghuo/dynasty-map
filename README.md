# 华夏疆域 · 历代演变

中国历代疆域交互地图：从商·前1200 到清·1911 共 39 个断面，底部胶片条时间轴滚动浏览历代、点击节点切换疆域；多政权分色并立，叠加现代国界省界作古今对照，大事年表与地图联动。年份写入 URL，可直达任意断面。

![tech](https://img.shields.io/badge/Vite-6-646CFF) ![echarts](https://img.shields.io/badge/ECharts-5-AA344D)

线上地址：<https://banzheshenghuo.github.io/dynasty-map/>

## 项目背景

以交互地图讲述华夏疆域两千余年的演变。定位是**个人兴趣 + 低调公开**（见 [doc/archive/DESIGN.md](doc/archive/DESIGN.md) 立项方案）：部署在 GitHub Pages 谁都能看，但不推广、不商用。

疆域与政区数据没有权威的开放全集，本项目把多个开源数据源按断面年份组装起来：有数字化界线者用原界线，无者以治所 Voronoi 示意或参照谭其骧《中国历史地图集》手绘推定，并在页脚如实标注口径。上古部分（夏商西周）谭图本就不画疆域色块，故采用「据点群推定示意」并在界面注明。

## 技术架构

纯静态、无服务端、无数据库的三层结构：

```
tools/sources/          静态源（手绘轮廓 hand-*.json、CHGIS 提取物、生成器）
        │  npm run fetch   下载上游（CHGIS V6、锚点断面）
        ▼  npm run data    tools/build-data.mjs 断面表驱动组装
data/                   技术栈中立的静态 JSON/GeoJSON（唯一数据入口）
        │                tools/validate.mjs 契约校验（与 data/SCHEMA.md 同步）
        ▼  vite（publicDir=data）
src/                    ECharts 渲染与交互（main / map / timeline / sidebar）
        ▼  push main → GitHub Actions
GitHub Pages（/dynasty-map/）
```

- **数据层 `data/` 是第一原则**：全部为自描述静态文件，入口 `data/timeline.json`（range + 时代分段 + 断面 + 事件），断面指向 `geo/s{id}.json`（疆域，`__regime_{名}` 哨兵）与可选的 `geo/s{id}-div.json`（政区，带 regime 归属）。字段契约见 [data/SCHEMA.md](data/SCHEMA.md)，可整体迁移到其他技术栈（含小程序端）。表现层参数只放 regimes[].color。
- **管线 `tools/`**：`build-data.mjs` 由 SNAPSHOTS 断面表驱动，产出全部 `data/`；`validate.mjs` 保证「数据 · 契约文档 · 校验器」三者一致；`sources/` 放手绘源与提取器，`sources/raw/`（gitignore）放下游扫描件。
- **前端 `src/`**：ECharts geo 单图多图层（邻国底色 → 各政权疆域 → 现代省界 → 断面政区界 → 现代轮廓），政区注记形心定位 + 重叠避让自实现；时间轴为自研「胶片条」组件（无第三方滑杆库）。
- **部署**：推 `main` 即触发 Actions 构建发布 Pages。

## 项目基线（2026-09-30）

后续变更以此为准，重大演进时更新本节。

- **数据基线**：39 断面（商·前1200 → 清·1911）、16 时代、104 事件（前221 起）；38 断面含政区层共 11,821 个政区要素；现代底图三件套（国界/省界/邻国）；`data/` 约 19MB。
- **功能基线**：胶片条时间轴（等距节点横向滚动带——滚动只浏览、点击节点才切图，‹▶›步进/播放/空格/←→键盘，自动回中）；多政权分色（weak 淡显）；政区界开关 + 悬浮详情 + 字号设置；大事年表三方联动（侧栏↔地图↔URL）；`?y=` 直达；移动端抽屉式侧栏。
- **上古二期（在途）**：商·前1200 已上线（谭图第一册网格配准读图 + 据点群推定包络，[在途方案](doc/active/2026-09-30-二期上古断面.md)），夏/西周/春秋/战国等 8 断面与上古事件待补——过渡期时代条「商」段会拉伸至前221，属已知现象。

## 数据来源与许可

| 数据 | 来源 | 许可 |
|---|---|---|
| 历代疆域轮廓（锚点断面） | [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps) 各年份断面中的中国政权多边形（27 个锚点） | GPL-3（本仓库 `data/geo/` 为其衍生，故整体以 GPL-3 发布） |
| 手绘疆域轮廓 | 秦、西汉末、唐、元、三国魏蜀吴与上古断面（商·前1200 等）为手绘/推定示意多边形（参照谭其骧《中国历史地图集》，上古部分经图幅网格配准读图），`tools/sources/hand-*.json` / `outline-*.json` | 本仓库原创 |
| 历代政区界 | [CHGIS V6](https://doi.org/10.7910/DVN/I0Q7SM) 时序数据按断面年份切片：有数字化界线者用原界线，其余以治所点位 Voronoi 胞元示意（提取与许可见 [tools/sources/README.md](tools/sources/README.md)） | CC BY-NC-SA 3.0（学术/教育用途，强制引用 CHGIS） |
| 现代中国轮廓 / 省级政区界 | [阿里 DataV GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector) | 按其使用条款 |
| 周边国家国界 | [Natural Earth](https://www.naturalearthdata.com/)（50m） | 公有领域，无限制 |
| 历史事件 | 筛选整理自 [pessimistcamellia/china-history-map](https://github.com/pessimistcamellia/china-history-map) 的开源时间线（史实取自公版史料） | 事实性内容 |

**口径说明**：断面按时代密疏不一（剧变期约 20–40 年一断，稳定期 80–120 年）。疆域边界为开源数据集的简化示意，与谭其骧《中国历史地图集》等学术口径存在差异；上古（夏商西周）为据点群推定示意。仅供历史学习参考。政区覆盖不完整属上游数字化进度所致（前 221 – 1350 年间尤甚）。数据管线见 `tools/build-data.mjs`，可复现。

## 开发

```bash
npm install
npm run fetch    # 下载上游源到 tools/sources/raw/（CHGIS 全量 + 锚点断面）
npm run data     # 生成 data/（可选，仓库已含生成结果）
npm run dev      # 本地开发
npm run check    # 数据自检 + 构建
```

## 文档与协作流程

需求开发与问题修复走「**先方案、后编码、同步文档**」流程，详见 [doc/README.md](doc/README.md)：技术方案先在 `doc/active/` 立项对齐，执行中同步变更，完结后归档至 `doc/archive/` 并将重点合并回本 README 的「项目基线」。

## 路线图

- [ ] 二期：上古 8 断面（夏1、商前1600、西周2、春秋2、战国2）+ 上古事件（[在途方案](doc/active/2026-09-30-二期上古断面.md)）
- [ ] 数据精修（盛唐 748 断面、秦精确边界、辽金界线核对）
- [ ] 疆域切换形变过渡动画、事件标签筛选
- [ ] 多端评估（uni-app 小程序端，数据层可原样复用）
