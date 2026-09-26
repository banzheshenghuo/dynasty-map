# tools/sources/ — 管线静态源数据档案

本目录存放从远程权威数据集一次性提取的静态源文件，供 `build-data.mjs` 消费。
上游数据不入仓（体积/许可），此处只存提取产物；重建步骤见各节。

## chgis-v6-qin-pgn.json / chgis-v6-qin-pts.json — 秦代政区

**背景**：CHGIS 的政区多边形数字化偏东南，秦代西北诸郡（陇西、北地、九原、辽东等）
在 V5/V6 中均无界线数据，仅有时序郡治点位。因此本源分两半：

- **pgn（界线）**：前 207–前 214 年窗口有效的 9 郡数字化多边形
  （闽中、会稽、鄣、泗水、东海、长沙、南海、桂林、象），用于东南部精确界线
- **pts（点位）**：同期 26 个郡治点位（CHGIS）+ 6 个补点（CHGIS 缺失但郡治
  坐标史有明文）。`build-data.mjs` 以点位生成 Voronoi 胞元，裁去疆域外与
  东南并集后填充——治所与疆域为权威数据，界线为示意

**上游**（Harvard Dataverse，免费下载）：

| 文件 | DOI | 文件 id |
|---|---|---|
| 时序政区多边形 v6_time_pref_pgn_utf_wgs84.zip | doi:10.7910/DVN/I0Q7SM | 2966510 |
| 时序政区点位 v6_time_pref_pts_utf_wgs84.zip | doi:10.7910/DVN/WW1PD6 | 2970286 |

```bash
curl -L "https://dataverse.harvard.edu/api/access/datafile/2966510" -o pgn.zip
curl -L "https://dataverse.harvard.edu/api/access/datafile/2970286" -o pts.zip
unzip pgn.zip pts.zip
npx mapshaper v6_time_pref_pgn_utf_wgs84.shp \
  -filter 'BEG_YR <= -207 && (END_YR >= -214 || !END_YR)' \
  -filter-fields NAME_CH,BEG_YR,END_YR -o format=geojson precision=0.001 qin-src-pgn.json
npx mapshaper v6_time_pref_pts_utf_wgs84.shp \
  -filter 'BEG_YR <= -207 && (END_YR >= -214 || !END_YR)' \
  -filter-fields NAME_CH,BEG_YR,END_YR -o format=geojson precision=0.001 qin-src-pts.json
node tools/extract-chgis-qin.mjs qin-src-pgn.json qin-src-pts.json
```

**补点坐标依据**（谭其骧《中国历史地图集》标注的秦郡治所）：
九原（今包头西南）、渔阳（今北京怀柔一带，沿 CHGIS 汉渔阳治）、右北平（治平刚，
今宁城甸子一带）、辽西（治阳乐，今辽宁义县西，秦治无定说取汉治）、辽东（治襄平，
今辽阳）、薛（治鲁县，今曲阜）。

**许可**：CC BY-NC-SA 3.0（学术/教育用途免费，禁止商用与整体再分发）。
强制引用：*CHGIS Version 6.* © Fairbank Center for Chinese Studies and the
Institute for Chinese Historical Geography at Fudan University.
本仓库仅取秦代子集、坐标取整、界线经 Voronoi 改作示意并在此注明修改，符合其学术使用条款。
