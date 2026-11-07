# 園區 3D 視覺細節 v2

使用者提供的新增影片：`AQNi05GQ4VRAB7ZvF6_1JKFzI1tXS9pvNPhopICIjZIuUh3IsSpST6h1CT11Q9FGPkoAEDdQU28yk9h3inN53N6P3oyGPyxrMXccNryPscqfmg.mp4`，約 60 秒。
影片保留在本機 ref video，未上傳原片。

## 視覺參考與新增幾何

- 12–22 秒：室外供電設施、進線與設備間連接。加入變壓器門架、支撐及跳線的概念外觀。
- 27–38 秒：變壓器及開關設備。加入散熱片、油枕、套管傘裙、控制箱。
- 42–48 秒：母線分段與保護盤。加入可見母排、支架、絕緣子、盤門、儀表與操作把手。
- 52–58 秒：供配電與冷卻設備群。補充冷卻器盤管、風扇葉片及護柵、泵組、膨脹桶與檢修閥。
- 機櫃與管線細節為本專案概念補充：12 層伺服器面板、把手、狀態燈、後側液體歧管、代表性落管、CDU 檢修面板及 HMI、配電梯架與管線支架。

## 範圍

維持 250 MW 園區、8 個機房、2,000 個機櫃位置及原 17 個模型群組 ID；WBS 連動保持。
影片中的 50 MW IT、PUE、電壓、變壓器容量與備援拓撲並未套用為本專案設計值。
新增幾何未經尺寸、設備選型、支撐結構、消防、維修淨距、熱流或短路計算驗證，屬可編輯概念模型。
原 PDF 前期評估清冊也沒有因本次建模而變成施工核定範圍。

## 重建與輸出

以 Blender 執行 `scripts/detail-campus.py`，載入 `app/public/downloads/Campus_250MW.blend`；先移除 v2 生成物再生成，避免重複累加。
執行 `scripts/export-datacenter.py` 匯出 GLB。機櫃使用 `EXT_mesh_gpu_instancing` 共用詳細幾何，每機房 250 個位置；單一位置的資產 ID 保留在 `assets.json`。
執行 `scripts/render-detail.py` 產生機房與機櫃近景。
