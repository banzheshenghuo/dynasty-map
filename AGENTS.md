# AGENTS.md — Agent 工作约定

华夏疆域历代演变图：Vite + ECharts 纯静态前端，`data/` 为自描述静态数据层。
动手前先读 [data/SCHEMA.md](data/SCHEMA.md)（数据契约）与 README.md（来源与许可）。

## 数据层（技术栈中立可迁移 = 第一原则）

- `data/` 是技术栈中立的静态 JSON/GeoJSON，字段、哨兵值、精度口径以 data/SCHEMA.md 为准
- 数据变更一律走 `tools/build-data.mjs` 管线（含为其新增静态源文件），**禁止手改生成文件**
  - 例外：`data/geo/qin.json` 同时是手绘疆域的源文件，build 读取其要素参与并集后回写
- 契约变更（增删字段 / 哨兵值 / 精度）必须同步 data/SCHEMA.md 与 tools/validate.mjs，
  「数据 · 契约文档 · 校验器」三者一致才算完成
- 表现层参数（颜色等）只放 `dynasties.json`；渲染库专用字段不得写进 geo 数据文件
- 政区/疆域覆盖不完整属已知现状（上游数字化进度所致），补数据优先接权威源
  （CHGIS 各历史断面），并保持许可表（README）同步更新

## 验证与交付

- 改 `data/` 或 `tools/` 后：`node tools/validate.mjs` 必须通过
- 改 `src/` 后：`npx vite build` 必须成功（chunk 体积警告为既有情况，可忽略）
- commit 用 conventional 风格 + 中文描述（`feat:` / `fix:` / `docs:` / `style:`）

## 环境

- 部署：push `main` → GitHub Actions 自动发布 Pages（`/dynasty-map/` 子路径，base 已配置）
- 注释与文档用中文，与现有风格保持一致
