# PacificPower — 250 MW 資料中心施工數位孿生原型

以 [onework-io/Ampower](https://github.com/onework-io/Ampower) 的 Vue 3 / Three.js 施工管理程式為基礎，來源版本 `89d902e8e247cf29eb2d6b3eb0b4ca0b014f6062`。此 repo 獨立開發；不會推送到 Ampower，也不使用其部署目的地或資料庫設定。

## 啟動

```sh
cd app
npm ci
npm run dev
```

首頁選擇「250 MW 資料中心建設」，進入 3D／排程工作區。可旋轉縮放、顯示／隔離施工分組、切換外牆、以 WBS 工項聚焦模型、播放甘特施工順序及建立現場標記。保留原有日報、成本、S 曲線及版本管理介面。

## 本版資料

- **250 MW 是園區總用電容量**。採用 1.25 的概念規劃比率，拆成 200 MW IT 與 50 MW 非 IT 用電預算；不是經驗證的尖峰容量計算。
- 8 個機房區 × 250 個機櫃位置 × 假設平均 100 kW = 200 MW IT。
- 17 個 GLB 施工分組，來源為本專案建立的 `Campus_250MW.blend`，公尺、Y-up 共用座標。
- 21 項資料中心 WBS 草案；工期、相依關係與 2026-11-07 開工日均為未核定範例。初始進度與預算為 0，基地與人員待指定。
- 網頁為效能將機櫃按機房區與材質合併。`models/assets.json` 保留 2,000 個機櫃 ID、分組及 Blender Z-up 原始座標；轉成網頁 Y-up 為 `[x,z,-y]`。目前點選／排程連動粒度為施工分組，尚非逐機櫃 BIM 查驗。
- `app/public/downloads/` 提供園區與機櫃／CDU 細節 `.blend`、容量假設及機櫃 CSV。
- `app/public/models` 是指向 `../../3D-datacenter` 的相對 symlink。

模型中的機電設備群為概念佔位，並非經核定的 250 MW 設備選型。尚未整合 IFC／Revit、真實軸網、碰撞檢查、現場掃描、工程查驗紀錄或即時感測資料；不能用作施工放樣或加工圖。照片助手不會從來源專案的示範照片捏造資料中心進度。

## 驗證

```sh
cd app
npm test
npm run build
```

GitHub Actions 僅執行測試與建置，**不會部署到 Ampower 的 Cloudflare / GitHub Pages**。PacificPower 的網站託管需另行設定。

## 後端與資料隔離

預設採本機 JSON / localStorage，storage keys 使用 PacificPower 命名。`server/` 保留來源 API 架構；如需多使用者、權限與資料持久化，請建立獨立 PacificPower Supabase／API 環境，再設定 `.env.example` 中的空白／占位參數。本次未連線或修改任何資料庫。

新模板 ID 為 `pacificpower-dc250-v1`，模板初始化腳本為 `server/scripts/seed-pacificpower-template.ts`。僅在自己的後端資料庫設定完成後手動執行。既有 `docs/` 的 Ampower 設計文件保留作來源架構參考，不能視為本資料中心的工程規格。

## 3D 來源與重建

`source-models/` 放置 Blender 建模與 GLB 匯出腳本。先執行園區建模腳本產生 `output/250MW/Campus_250MW.blend`，再執行 `scripts/export-datacenter.py` 匯出 GLB。修改模型後需同步 `app/src/data/parts.ts` 的 bytes 與 WBS 對應；自動測試會檢查資產及關聯。

## 已驗證

- 前端：273 項單元測試、TypeScript 與 Vite production build 通過。
- 後端：23 項單元測試及 TypeScript build 通過（未連接正式資料庫）。
- 瀏覽器：17 個模型載入、施工分組查詢／聚焦、17/17 WBS 對應及進度模擬切換。
- 本機「3D 對應」提供檢視與定位；修改保存需設定獨立後端。

![施工工作區](docs/pacificpower-preview.png)

## PISG 評估工作範圍（2026-11-07 更新）

工作區預設使用 `app/src/data/assessmentPlan.json`：依使用者提供的
《PISG_資料中心評估工作計畫_HPE工作範圍討論版_Rev1.3-H4_20261012.pdf》
第 3–6 頁轉錄 50 項末階工作／審查／節點，第 8 頁整理 25 份交付要求。
原文件是 50 MW 前期策略與技術方向評估草案；目前 250 MW 園區模型依先前需求保留，容量差異待確認。

- P1–30 與 P31–35 協商緩衝獨立於正式評估 WD；不假設 T0 或換算日期。
- WD1–12 階段 A；階段 B 須 G0 核定及主約／分包生效；WD75 驗收，WD76–80 獨立緩衝。G2 基準 WD76–78 隨實際驗收順延。
- 甘特圖直接顯示來源工作日，並保留原表明示 FS／SS 跨項標註；不宣稱為完整 CPM 網圖。
- COMM-01～05、DOC-01～16 為基本清冊；DOC-17～20 另行委任，不納基本時程與驗收。清冊不代表文件已完成。
- 3D 對應為本專案新增的評估參照，不是文件中的施工構件對應；文件進度不驅動設備安裝進度。
- 原 21 項施工排程保留在明確標記的舊假設沙盒中，並非本次 PDF 範圍。舊沙盒的工期、日期、成本與進度不可作為正式計畫。
- 未將原 PDF 上傳至 GitHub；來源版本、UUID 與頁碼保存在清冊。原文件保持不變。
