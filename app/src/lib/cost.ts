export interface WbsCostInput {
  laborCategoryId: string
  laborPeople: number
  laborDailyRate: number
  machineCategoryId: string
  machineUnits: number
  machineDailyRate: number
  materialCategoryId: string
  materialQty: number
  materialUnitRate: number
  materialUnit: string
}

export interface WbsCostBreakdown {
  labor: number
  machine: number
  material: number
  total: number
}

export const EMPTY_WBS_COST: WbsCostInput = {
  laborCategoryId: '',
  laborPeople: 0,
  laborDailyRate: 0,
  machineCategoryId: '',
  machineUnits: 0,
  machineDailyRate: 0,
  materialCategoryId: '',
  materialQty: 0,
  materialUnitRate: 0,
  materialUnit: '式',
}

const positive = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0)

/** 將施工人數與工作天換算為人工時，預設每日 8 小時。 */
export function calculateLaborHours(laborPeople: number, workDays: number, hoursPerDay = 8): number {
  return positive(laborPeople) * positive(workDays) * positive(hoursPerDay)
}

/** 人工與機具沿用 WBS 工作天；物料以數量 × 單價計算。 */
export function calculateWbsCost(
  input: WbsCostInput,
  workDays: number,
  factors: { labor: number; machine: number; material: number } = { labor: 1, machine: 1, material: 1 },
): WbsCostBreakdown {
  const days = positive(workDays)
  const labor = positive(input.laborPeople) * days * positive(input.laborDailyRate) * positive(factors.labor)
  const machine = positive(input.machineUnits) * days * positive(input.machineDailyRate) * positive(factors.machine)
  const material = positive(input.materialQty) * positive(input.materialUnitRate) * positive(factors.material)
  return { labor, machine, material, total: labor + machine + material }
}
