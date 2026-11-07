// 由 Campus_250MW.blend 匯出；共用公尺 Y-up 座標，依施工分組載入。
export type PartKind =
  | 'equipment' // 一般設備：參與框景、參與爆炸
  | 'shell' // 機房外殼：參與框景、不爆炸、爆炸時淡出
  | 'context' // 新版 GLB 共用的既有機電背景：參與框景、不爆炸、不隨進度隱藏
  | 'site' // 場域參考：不參與框景、不爆炸、預設隱藏

export interface PartDef {
  /** 穩定識別碼，供 store 與 registry 使用 */
  id: string
  /** public/models/ 底下的檔名（含中文與全形括號，載入時需 encodeURIComponent） */
  file: string
  /** 清單顯示名稱 */
  name: string
  /** 分組標題 */
  group: string
  kind: PartKind
  /** 檔案位元組數，用於由小到大的載入排程與進度權重 */
  bytes: number
  /** 對應安裝排程步驟；同一步驟可帶入多個 3D 構件 */
  installStepId?: string
  /**
   * 爆炸方向覆寫（世界座標，會被正規化）。
   * 未指定時由「構件包圍盒中心 − 設備群中心」推導。
   * 水平長件（煙囪、消音器吊架）用徑向推會擠在一起，故明確指定。
   */
  explodeDir?: [number, number, number]
}

export const PARTS: PartDef[] = [
  {
    "id": "network",
    "file": "network.glb",
    "bytes": 33516,
    "name": "MMR 網路設備",
    "group": "通訊系統",
    "kind": "equipment",
    "installStepId": "dc-network"
  },
  {
    "id": "shell",
    "file": "shell.glb",
    "bytes": 43468,
    "name": "機房圍護與柱體",
    "group": "基地土建",
    "kind": "shell",
    "installStepId": "dc-shell"
  },
  {
    "id": "dc03-racks",
    "file": "dc03-racks.glb",
    "bytes": 70288,
    "name": "DC03 機櫃區 · 250 座",
    "group": "機櫃分區",
    "kind": "equipment",
    "installStepId": "dc-racks-03"
  },
  {
    "id": "dc04-racks",
    "file": "dc04-racks.glb",
    "bytes": 70288,
    "name": "DC04 機櫃區 · 250 座",
    "group": "機櫃分區",
    "kind": "equipment",
    "installStepId": "dc-racks-04"
  },
  {
    "id": "dc02-racks",
    "file": "dc02-racks.glb",
    "bytes": 70288,
    "name": "DC02 機櫃區 · 250 座",
    "group": "機櫃分區",
    "kind": "equipment",
    "installStepId": "dc-racks-02"
  },
  {
    "id": "dc07-racks",
    "file": "dc07-racks.glb",
    "bytes": 70288,
    "name": "DC07 機櫃區 · 250 座",
    "group": "機櫃分區",
    "kind": "equipment",
    "installStepId": "dc-racks-07"
  },
  {
    "id": "dc08-racks",
    "file": "dc08-racks.glb",
    "bytes": 70288,
    "name": "DC08 機櫃區 · 250 座",
    "group": "機櫃分區",
    "kind": "equipment",
    "installStepId": "dc-racks-08"
  },
  {
    "id": "dc06-racks",
    "file": "dc06-racks.glb",
    "bytes": 70288,
    "name": "DC06 機櫃區 · 250 座",
    "group": "機櫃分區",
    "kind": "equipment",
    "installStepId": "dc-racks-06"
  },
  {
    "id": "dc01-racks",
    "file": "dc01-racks.glb",
    "bytes": 70292,
    "name": "DC01 機櫃區 · 250 座",
    "group": "機櫃分區",
    "kind": "equipment",
    "installStepId": "dc-racks-01"
  },
  {
    "id": "dc05-racks",
    "file": "dc05-racks.glb",
    "bytes": 70292,
    "name": "DC05 機櫃區 · 250 座",
    "group": "機櫃分區",
    "kind": "equipment",
    "installStepId": "dc-racks-05"
  },
  {
    "id": "site",
    "file": "site.glb",
    "bytes": 108436,
    "name": "基地、道路與機房地坪",
    "group": "基地土建",
    "kind": "context",
    "installStepId": "dc-site"
  },
  {
    "id": "fiber",
    "file": "fiber.glb",
    "bytes": 122132,
    "name": "光纖路徑",
    "group": "通訊系統",
    "kind": "equipment",
    "installStepId": "dc-fiber"
  },
  {
    "id": "tcs",
    "file": "tcs.glb",
    "bytes": 1303876,
    "name": "TCS 機櫃側供回液管",
    "group": "冷卻系統",
    "kind": "equipment",
    "installStepId": "dc-tcs"
  },
  {
    "id": "power-routes",
    "file": "power-routes.glb",
    "bytes": 1515436,
    "name": "A/B 配電路徑與母線",
    "group": "供配電",
    "kind": "equipment",
    "installStepId": "dc-power-routes"
  },
  {
    "id": "fws",
    "file": "fws.glb",
    "bytes": 2770992,
    "name": "FWS 設施側供回水管",
    "group": "冷卻系統",
    "kind": "equipment",
    "installStepId": "dc-fws"
  },
  {
    "id": "power",
    "file": "power.glb",
    "bytes": 2863520,
    "name": "變壓器／備援發電／UPS 設備群",
    "group": "供配電",
    "kind": "equipment",
    "installStepId": "dc-power"
  },
  {
    "id": "cooling",
    "file": "cooling.glb",
    "bytes": 3199028,
    "name": "室外冷卻機組與 CDU",
    "group": "冷卻系統",
    "kind": "equipment",
    "installStepId": "dc-cooling"
  }
]
export const GROUP_ORDER = ['基地土建', '供配電', '冷卻系統', '機櫃分區', '通訊系統']
export const TOTAL_BYTES = PARTS.reduce((s, p) => s + p.bytes, 0)
export const SHELL_PART_ID = 'shell'
export function modelUrl(file: string): string { return `models/${encodeURIComponent(file)}?v=detail-v2` }
