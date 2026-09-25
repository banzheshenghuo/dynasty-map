# 华夏疆域 · 历代演变

中国历代疆域交互地图：拖动底部时间轴切换朝代，查看对应时期的疆域轮廓、叠加现代国界与省界作古今对照，并浏览每朝疆域相关大事年表——点击事件在地图上定位。

![tech](https://img.shields.io/badge/Vite-6-646CFF) ![echarts](https://img.shields.io/badge/ECharts-5-AA344D)

## 功能

- 六大朝代疆域快照：秦、西汉、唐、元、明、清（固定取景框，切换时视口不跳动）
- 本朝政区界（郡/州/路/府，悬浮显示政区名）与现代国界、省界叠加（均默认开、可关），古今层级一目了然
- 每朝 4~12 条疆域相关大事：侧栏年表 ↔ 地图点位双向联动，点击飞行定位 + 涟漪高亮
- 地图支持滚轮缩放 / 拖拽漫游；键盘 ←→ 切换朝代
- 桌面优先，移动端侧栏收成底部抽屉

## 数据来源与许可

| 数据 | 来源 | 许可 |
|---|---|---|
| 历代疆域轮廓 | [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps) 各年份断面中的中国政权多边形 | GPL-3（本仓库 `data/geo/` 为其衍生，故整体以 GPL-3 发布） |
| 秦疆域 | 手绘示意多边形，非精确数字化 | 本仓库原创 |
| 现代中国轮廓 | [阿里 DataV GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector) | 按其使用条款 |
| 省级政区界 | [阿里 DataV GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector)（100000_full） | 按其使用条款 |
| 周边国家国界 | [Natural Earth](https://www.naturalearthdata.com/)（50m，公有领域） | 公有领域，无限制 |
| 历史事件 | 筛选整理自 [pessimistcamellia/china-history-map](https://github.com/pessimistcamellia/china-history-map) 的开源时间线（史实取自公版史料） | 事实性内容 |

**口径说明**：疆域边界为开源数据集的简化示意，与谭其骧《中国历史地图集》等学术口径存在差异（如西汉西域都护府辖区、明代乌斯藏都司范围、唐断面取中唐等），仅供历史学习参考。数据管线见 `tools/build-data.mjs`，可复现。

## 开发

```bash
npm install
npm run data     # 重新从上游拉取并生成 data/（可选，仓库已含生成结果）
npm run dev      # 本地开发
npm run check    # 数据自检 + 构建
```

## 部署

推送到 `main` 后 GitHub Actions 自动构建并发布到 Pages。

## 路线图

- [ ] M2：数据精修（盛唐 748 断面、秦精确边界、补全元朝事件）
- [ ] M2：更多朝代（东汉、三国、南北朝、宋）
- [ ] M3：疆域切换形变过渡动画、事件标签筛选
