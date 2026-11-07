export interface CostCurveRow {
  start: number
  finish: number
  estimate: number
  actual: number | null
  progress: number
}

export interface AmountPoint {
  day: number
  amount: number
}

function sampleDays(rows: CostCurveRow[], projectDays: number, dataDay?: number): number[] {
  const days = new Set<number>([0, projectDays])
  for (let day = 1; day <= Math.ceil(projectDays); day += 1) days.add(day)
  if (dataDay !== undefined) days.add(Math.min(Math.max(dataDay, 0), projectDays))
  for (const row of rows) {
    days.add(Math.min(Math.max(row.start, 0), projectDays))
    days.add(Math.min(Math.max(row.finish, 0), projectDays))
    if (row.progress > 0) days.add(Math.min(row.start + (row.finish - row.start) * row.progress / 100, projectDays))
  }
  return [...days].sort((a, b) => a - b)
}

function plannedAmount(row: CostCurveRow, day: number): number {
  if (day <= row.start) return 0
  if (day >= row.finish) return row.estimate
  const span = row.finish - row.start
  return span <= 0 ? row.estimate : row.estimate * (day - row.start) / span
}

/** 預估成本依各 WBS 排程區間線性展開。 */
export function plannedCostCurve(rows: CostCurveRow[], projectDays: number): AmountPoint[] {
  return sampleDays(rows, projectDays).map((day) => ({
    day,
    amount: rows.reduce((sum, row) => sum + plannedAmount(row, day), 0),
  }))
}

/**
 * 實際成本是截至資料日期的 WBS 累計值。沒有逐日憑證時，依完成度把金額
 * 線性分配至已執行區間；完成度為 0 但已有成本時，於資料日期一次認列。
 */
export function actualCostCurve(rows: CostCurveRow[], projectDays: number, dataDay: number): AmountPoint[] {
  const supplied = rows.filter((row) => row.actual !== null)
  if (!supplied.length) return []
  const clampedDataDay = Math.min(Math.max(dataDay, 0), projectDays)
  return sampleDays(supplied, projectDays, clampedDataDay).map((day) => ({
    day,
    amount: supplied.reduce((sum, row) => {
      const actual = row.actual ?? 0
      if (row.progress <= 0) return sum + (day >= clampedDataDay ? actual : 0)
      const reportedFinish = Math.min(clampedDataDay, row.start + (row.finish - row.start) * row.progress / 100)
      if (reportedFinish <= row.start) return sum + (day >= clampedDataDay ? actual : 0)
      if (day <= row.start) return sum
      if (day >= reportedFinish) return sum + actual
      return sum + actual * (day - row.start) / (reportedFinish - row.start)
    }, 0),
  }))
}

export function amountAt(curve: AmountPoint[], day: number): number {
  if (!curve.length) return 0
  if (day <= curve[0].day) return curve[0].amount
  const last = curve[curve.length - 1]
  if (day >= last.day) return last.amount
  for (let index = 1; index < curve.length; index += 1) {
    const a = curve[index - 1]
    const b = curve[index]
    if (day <= b.day) {
      const span = b.day - a.day
      return span <= 0 ? b.amount : a.amount + (b.amount - a.amount) * (day - a.day) / span
    }
  }
  return last.amount
}
