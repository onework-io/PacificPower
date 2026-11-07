export type AccountRole = 'admin' | 'planner' | 'manager' | 'worker'
export type AccountStatus = 'invited' | 'active' | 'suspended' | 'locked' | 'disabled'
export type PermissionEffect = 'inherit' | 'allow' | 'deny'

export interface PermissionDefinition {
  code: string
  module: string
  name: string
  sensitive?: boolean
  roles: AccountRole[]
}

export interface AccountSummary {
  id: string
  email: string
  displayName: string
  role: AccountRole
  status: AccountStatus
  department: string
  crewName: string
  phone?: string
  mfaEnabled: boolean
  lastLoginAt?: string
  version?: number
  overrides: Record<string, Exclude<PermissionEffect, 'inherit'>>
}

const allRoles: AccountRole[] = ['admin', 'planner', 'manager', 'worker']
const admin: AccountRole[] = ['admin']
const planning: AccountRole[] = ['admin', 'planner']
const management: AccountRole[] = ['admin', 'manager']
const field: AccountRole[] = ['admin', 'manager', 'worker']

export const PERMISSIONS: PermissionDefinition[] = [
  { code: 'account.view', module: '帳號管理', name: '查看帳號', sensitive: true, roles: admin },
  { code: 'account.create', module: '帳號管理', name: '建立及邀請帳號', sensitive: true, roles: admin },
  { code: 'account.edit', module: '帳號管理', name: '編輯帳號', sensitive: true, roles: admin },
  { code: 'account.disable', module: '帳號管理', name: '停用帳號', sensitive: true, roles: admin },
  { code: 'account.permission.manage', module: '帳號管理', name: '設定個別權限', sensitive: true, roles: admin },
  { code: 'audit.view', module: '帳號管理', name: '查看操作紀錄', sensitive: true, roles: admin },
  { code: 'project.view', module: '專案', name: '查看專案', roles: allRoles },
  { code: 'project.create', module: '專案', name: '建立專案', sensitive: true, roles: admin },
  { code: 'project.edit', module: '專案', name: '編輯專案', roles: management },
  { code: 'project.archive', module: '專案', name: '封存專案', sensitive: true, roles: admin },
  { code: 'project.member.manage', module: '專案', name: '管理專案成員', sensitive: true, roles: management },
  { code: 'wbs.view', module: 'WBS 與排程', name: '查看 WBS', roles: allRoles },
  { code: 'wbs.edit', module: 'WBS 與排程', name: '編輯 WBS', roles: planning },
  { code: 'wbs.import', module: 'WBS 與排程', name: '匯入 WBS', roles: planning },
  { code: 'wbs.submit', module: 'WBS 與排程', name: '送審 WBS', roles: planning },
  { code: 'wbs.approve', module: 'WBS 與排程', name: '核准 WBS', sensitive: true, roles: management },
  { code: 'wbs.publish', module: 'WBS 與排程', name: '發布 WBS', sensitive: true, roles: management },
  { code: 'model.view', module: '3D 模型', name: '查看 3D 模型', roles: allRoles },
  { code: 'model.upload', module: '3D 模型', name: '上傳模型', roles: planning },
  { code: 'model.mapping.edit', module: '3D 模型', name: '編輯 WBS 對應', roles: planning },
  { code: 'model.publish', module: '3D 模型', name: '發布模型', sensitive: true, roles: management },
  { code: 'progress.view', module: '現場進度', name: '查看進度', roles: allRoles },
  { code: 'progress.report', module: '現場進度', name: '回報進度', roles: field },
  { code: 'progress.verify', module: '現場進度', name: '確認進度', sensitive: true, roles: management },
  { code: 'photo.upload', module: '現場進度', name: '上傳現場照片', roles: field },
  { code: 'ai.assistant.use', module: '現場進度', name: '使用 AI 問答', roles: field },
  { code: 'ai.progress.confirm', module: '現場進度', name: '確認 AI 進度', sensitive: true, roles: management },
  { code: 'labor.view', module: '工班與人工時', name: '查看人工時', roles: ['admin', 'planner', 'manager'] },
  { code: 'labor.dispatch', module: '工班與人工時', name: '調度工班', sensitive: true, roles: management },
  { code: 'labor.report', module: '工班與人工時', name: '回報人工時', roles: field },
  { code: 'labor.verify', module: '工班與人工時', name: '確認人工時', sensitive: true, roles: management },
  { code: 'report.project.view', module: '報表', name: '查看專案報表', roles: ['admin', 'planner', 'manager'] },
  { code: 'report.portfolio.view', module: '報表', name: '查看跨專案報表', sensitive: true, roles: management },
  { code: 'report.export', module: '報表', name: '匯出報表', sensitive: true, roles: management },
  { code: 'report.contract_amount.view', module: '報表', name: '查看承攬金額', sensitive: true, roles: management },
]

export const ROLE_LABELS: Record<AccountRole, string> = {
  admin: 'Admin 系統管理員', planner: 'Planner 進度規劃員',
  manager: 'Manager 專案管理者', worker: 'Worker 現場人員',
}

export const ROLE_DESCRIPTIONS: Record<AccountRole, string> = {
  admin: '管理帳號、權限、專案及系統設定',
  planner: '規劃 WBS、排程、PERT 與版本送審',
  manager: '核准計畫、查看報表並調度工班',
  worker: '回報被指派工項的進度、人工時與照片',
}

export const DEFAULT_ACCOUNTS: AccountSummary[] = [
  { id: 'demo-admin', email: 'admin@pacificpower.com.tw', displayName: '林志宏', role: 'admin', status: 'active', department: '專案管理部', crewName: '', mfaEnabled: true, lastLoginAt: '今天 08:42', overrides: {} },
  { id: 'demo-planner', email: 'planner@pacificpower.com.tw', displayName: '陳怡君', role: 'planner', status: 'active', department: '工程規劃部', crewName: '', mfaEnabled: true, lastLoginAt: '昨天 17:20', overrides: { 'report.export': 'allow' } },
  { id: 'demo-manager', email: 'manager@pacificpower.com.tw', displayName: '張家維', role: 'manager', status: 'active', department: '專案管理部', crewName: '', mfaEnabled: false, lastLoginAt: '今天 09:15', overrides: {} },
  { id: 'demo-worker', email: 'worker@pacificpower.com.tw', displayName: '王大明', role: 'worker', status: 'active', department: '現場工程部', crewName: 'PacificPower機電一班', mfaEnabled: false, lastLoginAt: '今天 07:58', overrides: { 'ai.assistant.use': 'deny' } },
]
