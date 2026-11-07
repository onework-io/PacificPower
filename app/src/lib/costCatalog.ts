import type { WbsCostInput } from './cost'

export interface RateItem {
  id: string
  name: string
  unit: string
  price: number
}

export interface CostFactors {
  labor: number
  machine: number
  material: number
}

export const DEFAULT_FACTORS: CostFactors = { labor: 1, machine: 1, material: 1 }

export const DEFAULT_LABOR_RATES: RateItem[] = [
  { id: 'survey', name: '測量放樣技師', unit: '人日', price: 3600 },
  { id: 'civil', name: '土建技工', unit: '人日', price: 3500 },
  { id: 'rigging', name: '吊裝技工', unit: '人日', price: 4500 },
  { id: 'pipe', name: '管線／焊接技工', unit: '人日', price: 4000 },
  { id: 'sheet-metal', name: '風管鈑金技工', unit: '人日', price: 3800 },
  { id: 'electric', name: '電氣技工', unit: '人日', price: 4200 },
  { id: 'commission', name: '試車工程師', unit: '人日', price: 5200 },
  { id: 'general', name: '一般技工', unit: '人日', price: 3000 },
]

export const DEFAULT_MACHINE_RATES: RateItem[] = [
  { id: 'survey-kit', name: '雷射測量儀', unit: '台日', price: 1500 },
  { id: 'concrete-pump', name: '混凝土泵送設備', unit: '台日', price: 12000 },
  { id: 'crane-25t', name: '25 噸吊車', unit: '台日', price: 18000 },
  { id: 'forklift', name: '堆高機', unit: '台日', price: 8500 },
  { id: 'boom-lift', name: '高空作業車', unit: '台日', price: 7000 },
  { id: 'welding-set', name: '焊接設備', unit: '台日', price: 1500 },
  { id: 'test-kit', name: '電氣試驗儀器', unit: '套日', price: 4000 },
]

export const DEFAULT_MATERIAL_RATES: RateItem[] = [
  { id: 'layout', name: '放樣耗材', unit: '式', price: 2500 },
  { id: 'concrete', name: '預拌混凝土', unit: 'm³', price: 3400 },
  { id: 'steel-support', name: '型鋼支架', unit: '組', price: 28000 },
  { id: 'silencer', name: '工業消音器', unit: '台', price: 280000 },
  { id: 'flue', name: '組合式排煙管', unit: 'm', price: 8500 },
  { id: 'wall-plate', name: '煙囪穿牆蓋板', unit: '組', price: 18000 },
  { id: 'insulation', name: '排煙隔熱保溫材', unit: 'm²', price: 1400 },
  { id: 'flex-joint', name: '排煙避震軟管', unit: '組', price: 45000 },
  { id: 'spring-mount', name: '彈簧式避震器', unit: '組', price: 42000 },
  { id: 'rigging-supply', name: '設備吊裝安裝耗材', unit: '式', price: 30000 },
  { id: 'fuel-pipe', name: '柴油配管與配件', unit: 'm', price: 1100 },
  { id: 'fuel-equipment', name: '燃油系統設備', unit: '台', price: 95000 },
  { id: 'vent-set', name: '通風消音組件', unit: '式', price: 120000 },
  { id: 'cable-tray', name: '鍍鋅線槽', unit: 'm', price: 950 },
  { id: 'power-cable', name: '動力電纜', unit: 'm', price: 1800 },
  { id: 'electrical-panel', name: '電氣箱盤設備', unit: '台', price: 85000 },
  { id: 'busbar', name: '匯流排與支撐配件', unit: '式', price: 180000 },
  { id: 'commission-supply', name: '試車與檢查耗材', unit: '式', price: 12000 },
]

export interface CostCatalogs {
  laborRates: RateItem[]
  machineRates: RateItem[]
  materialRates: RateItem[]
}

interface StepCostProfile {
  laborId: string
  laborPeople: number
  machineId: string
  machineUnits: number
  materialId: string
  materialQty: number
}

const PROFILES: Record<string, StepCostProfile> = {
  s01: { laborId: 'survey', laborPeople: 2, machineId: 'survey-kit', machineUnits: 1, materialId: 'layout', materialQty: 1 },
  s02: { laborId: 'survey', laborPeople: 2, machineId: 'survey-kit', machineUnits: 1, materialId: 'layout', materialQty: 1 },
  s03: { laborId: 'survey', laborPeople: 2, machineId: 'survey-kit', machineUnits: 1, materialId: 'layout', materialQty: 1 },
  s04: { laborId: 'civil', laborPeople: 4, machineId: 'concrete-pump', machineUnits: 1, materialId: 'concrete', materialQty: 18 },
  s05: { laborId: 'civil', laborPeople: 3, machineId: 'concrete-pump', machineUnits: 1, materialId: 'concrete', materialQty: 10 },
  s06: { laborId: 'survey', laborPeople: 2, machineId: 'survey-kit', machineUnits: 1, materialId: 'layout', materialQty: 1 },
  s07: { laborId: 'rigging', laborPeople: 3, machineId: 'boom-lift', machineUnits: 1, materialId: 'steel-support', materialQty: 1 },
  s08: { laborId: 'rigging', laborPeople: 4, machineId: 'crane-25t', machineUnits: 1, materialId: 'silencer', materialQty: 1 },
  s09: { laborId: 'electric', laborPeople: 3, machineId: 'boom-lift', machineUnits: 1, materialId: 'cable-tray', materialQty: 20 },
  s10: { laborId: 'pipe', laborPeople: 4, machineId: 'boom-lift', machineUnits: 1, materialId: 'flue', materialQty: 12 },
  s11: { laborId: 'pipe', laborPeople: 2, machineId: 'boom-lift', machineUnits: 1, materialId: 'wall-plate', materialQty: 1 },
  s12: { laborId: 'pipe', laborPeople: 3, machineId: 'boom-lift', machineUnits: 1, materialId: 'insulation', materialQty: 35 },
  s13: { laborId: 'rigging', laborPeople: 3, machineId: 'forklift', machineUnits: 1, materialId: 'spring-mount', materialQty: 1 },
  s14: { laborId: 'rigging', laborPeople: 6, machineId: 'crane-25t', machineUnits: 1, materialId: 'rigging-supply', materialQty: 1 },
  s15: { laborId: 'pipe', laborPeople: 3, machineId: 'boom-lift', machineUnits: 1, materialId: 'flex-joint', materialQty: 1 },
  s16: { laborId: 'pipe', laborPeople: 3, machineId: 'forklift', machineUnits: 1, materialId: 'fuel-equipment', materialQty: 1 },
  s17: { laborId: 'rigging', laborPeople: 4, machineId: 'forklift', machineUnits: 1, materialId: 'fuel-equipment', materialQty: 1 },
  s18: { laborId: 'pipe', laborPeople: 3, machineId: 'welding-set', machineUnits: 1, materialId: 'fuel-pipe', materialQty: 30 },
  s19: { laborId: 'sheet-metal', laborPeople: 3, machineId: 'boom-lift', machineUnits: 1, materialId: 'vent-set', materialQty: 0.25 },
  s20: { laborId: 'sheet-metal', laborPeople: 4, machineId: 'crane-25t', machineUnits: 1, materialId: 'vent-set', materialQty: 0.4 },
  s21: { laborId: 'sheet-metal', laborPeople: 3, machineId: 'boom-lift', machineUnits: 1, materialId: 'vent-set', materialQty: 0.2 },
  s22: { laborId: 'sheet-metal', laborPeople: 3, machineId: 'boom-lift', machineUnits: 1, materialId: 'vent-set', materialQty: 0.15 },
  s23: { laborId: 'electric', laborPeople: 3, machineId: 'forklift', machineUnits: 1, materialId: 'electrical-panel', materialQty: 1 },
  s24: { laborId: 'electric', laborPeople: 3, machineId: 'forklift', machineUnits: 1, materialId: 'electrical-panel', materialQty: 1 },
  s25: { laborId: 'electric', laborPeople: 2, machineId: 'test-kit', machineUnits: 1, materialId: 'electrical-panel', materialQty: 1 },
  s26: { laborId: 'electric', laborPeople: 2, machineId: 'test-kit', machineUnits: 1, materialId: 'electrical-panel', materialQty: 1 },
  s27: { laborId: 'rigging', laborPeople: 5, machineId: 'crane-25t', machineUnits: 1, materialId: 'rigging-supply', materialQty: 1 },
  s28: { laborId: 'electric', laborPeople: 3, machineId: 'boom-lift', machineUnits: 1, materialId: 'busbar', materialQty: 0.25 },
  s29: { laborId: 'electric', laborPeople: 4, machineId: 'boom-lift', machineUnits: 1, materialId: 'busbar', materialQty: 0.75 },
  s30: { laborId: 'rigging', laborPeople: 3, machineId: 'forklift', machineUnits: 1, materialId: 'steel-support', materialQty: 1 },
  s31: { laborId: 'electric', laborPeople: 5, machineId: 'test-kit', machineUnits: 1, materialId: 'power-cable', materialQty: 80 },
  s32: { laborId: 'general', laborPeople: 4, machineId: 'test-kit', machineUnits: 0.5, materialId: 'commission-supply', materialQty: 0.5 },
  s33: { laborId: 'commission', laborPeople: 3, machineId: 'test-kit', machineUnits: 1, materialId: 'commission-supply', materialQty: 1 },
  s34: { laborId: 'commission', laborPeople: 2, machineId: 'test-kit', machineUnits: 1, materialId: 'commission-supply', materialQty: 0.5 },
}

function findRate(items: RateItem[], id: string): RateItem | undefined {
  return items.find((item) => item.id === id)
}

export function defaultCostForStep(stepId: string, catalogs: CostCatalogs): WbsCostInput {
  const profile = PROFILES[stepId]
  if (!profile) return {
    laborCategoryId: '', laborPeople: 0, laborDailyRate: 0,
    machineCategoryId: '', machineUnits: 0, machineDailyRate: 0,
    materialCategoryId: '', materialQty: 0, materialUnitRate: 0, materialUnit: '式',
  }
  const labor = findRate(catalogs.laborRates, profile.laborId)
  const machine = findRate(catalogs.machineRates, profile.machineId)
  const material = findRate(catalogs.materialRates, profile.materialId)
  return {
    laborCategoryId: profile.laborId,
    laborPeople: profile.laborPeople,
    laborDailyRate: labor?.price ?? 0,
    machineCategoryId: profile.machineId,
    machineUnits: profile.machineUnits,
    machineDailyRate: machine?.price ?? 0,
    materialCategoryId: profile.materialId,
    materialQty: profile.materialQty,
    materialUnitRate: material?.price ?? 0,
    materialUnit: material?.unit ?? '式',
  }
}

export function cloneRates(items: RateItem[]): RateItem[] {
  return items.map((item) => ({ ...item }))
}
