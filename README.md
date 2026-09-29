# 华夏疆域 · 历代演变

中国历代疆域交互地图：连续拖动底部时间轴（前 221 → 1911），查看任意时期的政权疆域与政区划分，叠加现代国界与省界作古今对照；大事以圆点打在时间轴上，点击即跳转定位。年份写入 URL，可直达任意断面。

![tech](https://img.shields.io/badge/Vite-6-646CFF) ![echarts](https://img.shields.io/badge/ECharts-5-AA344D)

## 功能

- **连续时间轴**：38 个预建断面（前 221 – 1911），点击精确锚定、拖动实时读数，松手吸附最近断面；停顿约 250ms 即提前换图，滚轮可微调年份（桌面悬浮另有年份预览）。时代分段底色 + 年份标尺 + 事件打点（可点击跳转），键盘 ←→ 步进
- **多政权并立**：三国魏蜀吴、宋辽夏、金南宋蒙古等同框分色显示（一政权一色，跨断面稳定）；侧栏政权图例，游牧/藩属等边缘政权淡显
- **断面政区界**（郡/州/路/府，地图直接标注政区名，重叠自动避让；悬浮/点按显示政区名详情）与现代国界、省界叠加（均默认开、可关），古今层级一目了然
- **大事年表**：按时代归组，侧栏 ↔ 地图点位 ↔ 时间轴圆点三方联动，点击飞行定位 + 涟漪高亮；URL `?y=年份` 直达断面
- 地图支持滚轮缩放 / 拖拽漫游；桌面优先，移动端侧栏收成底部抽屉、触屏点选高亮

## 数据来源与许可

| 数据 | 来源 | 许可 |
|---|---|---|
| 历代疆域轮廓（锚点断面） | [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps) 各年份断面中的中国政权多边形（27 个锚点） | GPL-3（本仓库 `data/geo/` 为其衍生，故整体以 GPL-3 发布） |
| 手绘疆域轮廓 | 秦、西汉末、唐、元与三国魏蜀吴为手绘示意多边形（参照谭其骧《中国历史地图集》），`tools/sources/hand-*.json` / `outline-*.json` | 本仓库原创 |
| 历代政区界 | [CHGIS V6](https://doi.org/10.7910/DVN/I0Q7SM) 时序数据按断面年份切片：有数字化界线者用原界线，其余以治所点位 Voronoi 胞元示意（提取与许可见 [tools/sources/README.md](tools/sources/README.md)） | CC BY-NC-SA 3.0（学术/教育用途，强制引用 CHGIS） |
| 现代中国轮廓 | [阿里 DataV GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector) | 按其使用条款 |
| 省级政区界 | [阿里 DataV GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector)（100000_full） | 按其使用条款 |
| 周边国家国界 | [Natural Earth](https://www.naturalearthdata.com/)（50m，公有领域） | 公有领域，无限制 |
| 历史事件 | 筛选整理自 [pessimistcamellia/china-history-map](https://github.com/pessimistcamellia/china-history-map) 的开源时间线（史实取自公版史料） | 事实性内容 |

**口径说明**：38 个断面按时代密疏不一（剧变期约 20–40 年一断，稳定期 80–120 年）。疆域边界为开源数据集的简化示意，与谭其骧《中国历史地图集》等学术口径存在差异，仅供历史学习参考。政区覆盖不完整属上游数字化进度所致（前 221 – 1350 年间尤甚）：有数字化界线者用 CHGIS 原界线，其余以治所 Voronoi 胞元示意（详见 `tools/sources/README.md`）。数据管线见 `tools/build-data.mjs`，可复现。

**数据契约**：`data/` 全部为自描述的静态 JSON/GeoJSON（无数据库、无服务端），入口为 `data/timeline.json`（断面 + 时代分段 + 事件），字段结构与图层识别约定见 [data/SCHEMA.md](data/SCHEMA.md)，可整体迁移到其他技术栈。

## 开发

```bash
npm install
npm run fetch    # 下载上游源到 tools/sources/raw/（CHGIS 全量 + 锚点断面）
npm run data     # 生成 data/（可选，仓库已含生成结果）
npm run dev      # 本地开发
npm run check    # 数据自检 + 构建
```

## 部署

推送到 `main` 后 GitHub Actions 自动构建并发布到 Pages。

## 路线图

- [ ] 二期：上古断面（夏商西周春秋战国，参照谭图手绘，页脚标注「学界推定示意」）+ 上古事件
- [ ] 数据精修（盛唐 748 断面、秦精确边界、辽金界线核对）
- [ ] 疆域切换形变过渡动画、事件标签筛选
