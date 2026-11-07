// 概念施工 WBS：工期、相依關係及開工日皆待專案團隊核定。
export interface InstallStep {
  /** 穩定識別碼 */
  id: string
  /** xlsx 的項次，介面上仍以此顯示 */
  seq: number
  /** 後端保存的 WBS 代號；本機資料未指定時由階段順序產生 */
  wbsCode?: string
  name: string
  /** 對應 parts.ts 的構件 id；null 表示這個步驟沒有 3D 模型 */
  partId: string | null
  phase: string
  /** 工作天；來源工作表尚未填值，目前為可在介面覆寫的排程草案 */
  durationDays: number
  /** 前置步驟 id */
  deps: string[]
  /**
   * 本步驟完成後，後續步驟還需等待的天數（混凝土養護）。
   * 放在前置步驟上而非每條相依邊上，對這個規模的排程已足夠。
   */
  lagDays?: number
}


export const PHASES = ["前期與土建", "供配電", "冷卻系統", "機櫃工程", "通訊系統", "測試與交付"] as const
export const PHASE_WBS = new Map(PHASES.map((p, i) => [p as string, String(i + 1)]))
export const INSTALL_STEPS: InstallStep[] = [
  {
    "id": "dc-survey",
    "seq": 1,
    "name": "基地測量與施工準備",
    "partId": null,
    "phase": "前期與土建",
    "durationDays": 10,
    "deps": []
  },
  {
    "id": "dc-site",
    "seq": 2,
    "name": "基地整備、道路與設備基礎",
    "partId": "site",
    "phase": "前期與土建",
    "durationDays": 60,
    "deps": [
      "dc-survey"
    ]
  },
  {
    "id": "dc-shell",
    "seq": 3,
    "name": "機房結構與圍護工程",
    "partId": "shell",
    "phase": "前期與土建",
    "durationDays": 90,
    "deps": [
      "dc-site"
    ]
  },
  {
    "id": "dc-power",
    "seq": 4,
    "name": "變壓器、備援電源與 UPS 設備群就位",
    "partId": "power",
    "phase": "供配電",
    "durationDays": 45,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-power-routes",
    "seq": 5,
    "name": "A/B 配電路徑與母線施工",
    "partId": "power-routes",
    "phase": "供配電",
    "durationDays": 40,
    "deps": [
      "dc-power"
    ]
  },
  {
    "id": "dc-cooling",
    "seq": 6,
    "name": "室外散熱設備與 CDU 就位",
    "partId": "cooling",
    "phase": "冷卻系統",
    "durationDays": 45,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-fws",
    "seq": 7,
    "name": "設施側 FWS 供回水配管",
    "partId": "fws",
    "phase": "冷卻系統",
    "durationDays": 40,
    "deps": [
      "dc-cooling"
    ]
  },
  {
    "id": "dc-tcs",
    "seq": 8,
    "name": "IT 側 TCS 供回液配管",
    "partId": "tcs",
    "phase": "冷卻系統",
    "durationDays": 35,
    "deps": [
      "dc-fws"
    ]
  },
  {
    "id": "dc-racks-01",
    "seq": 9,
    "name": "DC01 機櫃安裝與定位（250 座）",
    "partId": "dc01-racks",
    "phase": "機櫃工程",
    "durationDays": 25,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-racks-02",
    "seq": 10,
    "name": "DC02 機櫃安裝與定位（250 座）",
    "partId": "dc02-racks",
    "phase": "機櫃工程",
    "durationDays": 25,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-racks-03",
    "seq": 11,
    "name": "DC03 機櫃安裝與定位（250 座）",
    "partId": "dc03-racks",
    "phase": "機櫃工程",
    "durationDays": 25,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-racks-04",
    "seq": 12,
    "name": "DC04 機櫃安裝與定位（250 座）",
    "partId": "dc04-racks",
    "phase": "機櫃工程",
    "durationDays": 25,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-racks-05",
    "seq": 13,
    "name": "DC05 機櫃安裝與定位（250 座）",
    "partId": "dc05-racks",
    "phase": "機櫃工程",
    "durationDays": 25,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-racks-06",
    "seq": 14,
    "name": "DC06 機櫃安裝與定位（250 座）",
    "partId": "dc06-racks",
    "phase": "機櫃工程",
    "durationDays": 25,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-racks-07",
    "seq": 15,
    "name": "DC07 機櫃安裝與定位（250 座）",
    "partId": "dc07-racks",
    "phase": "機櫃工程",
    "durationDays": 25,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-racks-08",
    "seq": 16,
    "name": "DC08 機櫃安裝與定位（250 座）",
    "partId": "dc08-racks",
    "phase": "機櫃工程",
    "durationDays": 25,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-network",
    "seq": 17,
    "name": "MMR 與網路設備就位",
    "partId": "network",
    "phase": "通訊系統",
    "durationDays": 20,
    "deps": [
      "dc-shell"
    ]
  },
  {
    "id": "dc-fiber",
    "seq": 18,
    "name": "光纖路徑與端接施工",
    "partId": "fiber",
    "phase": "通訊系統",
    "durationDays": 25,
    "deps": [
      "dc-network"
    ]
  },
  {
    "id": "dc-check",
    "seq": 19,
    "name": "機電查驗、清洗與測試",
    "partId": null,
    "phase": "測試與交付",
    "durationDays": 30,
    "deps": [
      "dc-power-routes",
      "dc-tcs",
      "dc-fiber",
      "dc-racks-01",
      "dc-racks-02",
      "dc-racks-03",
      "dc-racks-04",
      "dc-racks-05",
      "dc-racks-06",
      "dc-racks-07",
      "dc-racks-08"
    ]
  },
  {
    "id": "dc-commission",
    "seq": 20,
    "name": "整合測試與分區試運轉",
    "partId": null,
    "phase": "測試與交付",
    "durationDays": 30,
    "deps": [
      "dc-check"
    ]
  },
  {
    "id": "dc-handover",
    "seq": 21,
    "name": "缺失結案與竣工資料移交",
    "partId": null,
    "phase": "測試與交付",
    "durationDays": 15,
    "deps": [
      "dc-commission"
    ]
  }
]
export const STEP_BY_ID = new Map(INSTALL_STEPS.map((s) => [s.id, s]))
