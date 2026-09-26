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

## chgis-v6-han_w-pgn.json / chgis-v6-han_w-pts.json — 西汉政区

与秦代同源（同两个 shapefile），窗口换为「前 1 年有效」
（`BEG_YR <= -1 && (END_YR >= -1 || !END_YR)`），提取命令同上替换过滤值与输出名。

- **pgn（界线）**：17 郡国（南郡、会稽、豫章、长沙国、朱崖洲等，多在东南）
- **pts（点位）**：63 个 CHGIS 郡治 + 24 个补点，加界线共 104 郡国
  （《汉书·地理志》元始年间口径 103 郡国；关中三辅由 CHGIS「京兆尹」通贯代表）
- 已剔除并州（刺史部监察区，非郡国）

**补点依据**（谭其骧《中国历史地图集》标注的西汉郡国治所）：

- 北方边郡 10 郡在 CHGIS 时序库无西汉记录（多自东汉或更晚始有）：朔方（治朔方，
  今磴口北）、五原（治九原，今包头西南）、云中（治云中，今托克托东北）、
  定襄（治成乐，今和林格尔西北）、西河（治平定，今鄂尔多斯东部，一说富昌，
  治所无定说取示意）、右北平（治平刚）、辽西（治阳乐）、辽东（治襄平）、
  玄菟（治高句骊，今新宾西南）、乐浪（治朝鲜，今平壤）
- 交趾三郡全库缺位：交趾（治羸𨻻，今河内西北）、九真（治胥浦，今清化西北）、
  日南（治西捲，今广治附近）
- 中原时段断档 11 郡国：鲁国（治鲁县）、沛郡（治相）、梁国（治睢阳）、
  六安国（治六）、九江（治寿春）、庐江（治舒）、江夏（治西陵）、千乘（治千乘）、
  高密国（治高密）、城阳国（治莒）、甾川国（治剧）

## 许可（秦/西汉同源）

CC BY-NC-SA 3.0（学术/教育用途免费，禁止商用与整体再分发）。
强制引用：*CHGIS Version 6.* © Fairbank Center for Chinese Studies and the
Institute for Chinese Historical Geography at Fudan University.
本仓库仅取断面子集、坐标取整、界线经 Voronoi 改作示意并在此注明修改，符合其学术使用条款。
