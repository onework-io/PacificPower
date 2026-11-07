<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '@/lib/apiClient'

interface CrewMember {
  id: string
  displayName: string
  email: string
  department: string
  role: 'admin' | 'planner' | 'manager' | 'worker'
}
interface CrewProject {
  id: string
  code: string
  name: string
  clientName: string
  location: string
  status: string
  riskStatus: string
  projectRole: string | null
  startDate: string | null
  endDate: string | null
}
interface CrewTask {
  id: string
  code: string
  name: string
  progressPct: number
  projectId: string
  projectCode: string
  projectName: string
  assigneeId: string
  assigneeName: string
  sequence: number
  durationDays: number
  pinnedStartDay: number | null
  assignedAt: string
  assignmentEndsAt: string | null
  projectStartDate: string | null
  projectEndDate: string | null
}
interface Crew {
  name: string
  members: CrewMember[]
  projects: CrewProject[]
  tasks: CrewTask[]
  laborHours: number
  metadata?: { id: string; code: string; trade: string; leaderUserId: string | null; status: string; dailyCapacityHours: number; notes: string } | null
}

interface ManagedCrew {
  id: string
  code: string
  name: string
  trade: string
  leaderUserId: string | null
  leaderName: string | null
  status: 'active' | 'inactive'
  dailyCapacityHours: number
  notes: string
  members: Array<{ id: string; displayName: string; email: string; department: string }>
}
interface MemberQualification {
  id?: string
  name: string
  certificateNo: string
  issuedOn: string
  expiresOn: string
  notes: string
  status?: 'valid' | 'expiring' | 'expired'
}
interface MemberUnavailability { id?: string; startDate: string; endDate: string; type: 'leave' | 'training' | 'medical' | 'other'; reason: string }
interface MemberCandidate { id: string; displayName: string; email: string; department: string; crewName: string; role: string; qualifications: MemberQualification[]; unavailability: MemberUnavailability[] }

interface CrewDispatch {
  id: string
  crewName: string
  projectId: string
  projectCode: string
  projectName: string
  taskId: string | null
  taskCode: string | null
  taskName: string | null
  startDate: string
  endDate: string
  plannedPeople: number
  dailyHours: number
  crewSize: number
  status: string
  note: string
  requiredQualifications: Array<{ name: string; count: number }>
}

interface DispatchWarning { dispatchId: string; type: string; message: string }
interface LaborEntry {
  id: string
  projectId: string
  projectCode: string
  projectName: string
  taskId: string
  taskCode: string
  taskName: string
  workDate: string
  people: number
  hours: number
  totalHours: number
  crewName: string
  note: string
  status: 'pending' | 'approved' | 'rejected'
  reporterName: string | null
  verifierName: string | null
  verifiedAt: string | null
  rejectionReason: string
  createdAt: string
}
interface CalendarBar {
  id: string
  dispatchId?: string
  projectId: string
  taskId?: string
  label: string
  sub: string
  span: string
  kind: 'dispatch' | 'task' | 'project'
  start: Date
  end: Date
}

const props = defineProps<{ permissions?: string[]; initialTarget?: 'overview' | 'calendar' | 'directory' | 'labor' }>()

const emit = defineEmits<{ back: []; openProject: [projectId: string] }>()
const crews = ref<Crew[]>([])
const query = ref('')
const loading = ref(true)
const error = ref('')
const view = ref<'overview' | 'calendar' | 'analysis' | 'labor'>('overview')
const selectedCrewName = ref<string | null>(null)
const calendarStart = ref(startOfWeek(new Date()))
const dispatches = ref<CrewDispatch[]>([])
const dispatchWarnings = ref<DispatchWarning[]>([])
const dispatchMessage = ref('')
const laborEntries = ref<LaborEntry[]>([])
const laborMessage = ref('')
const laborSaving = ref(false)
const laborDraft = ref({ projectId: '', taskId: '', crewName: '', workDate: dateKey(new Date()), people: 1, hours: 8, note: '' })
const editingDispatch = ref<{
  id?: string
  crewName: string
  projectId: string
  taskId: string
  startDate: string
  endDate: string
  plannedPeople: number
  dailyHours: number
  status: string
  note: string
  requiredQualificationsText: string
} | null>(null)
const dispatchSaving = ref(false)
const crewManagerOpen = ref(false)
const managedCrews = ref<ManagedCrew[]>([])
const memberCatalog = ref<MemberCandidate[]>([])
const crewDirectoryLoading = ref(false)
const crewDirectoryMessage = ref('')
const qualificationMemberId = ref('')
const qualificationDrafts = ref<MemberQualification[]>([])
const qualificationSaving = ref(false)
const availabilityMemberId = ref('')
const availabilityDrafts = ref<MemberUnavailability[]>([])
const availabilitySaving = ref(false)
const editingCrew = ref<{
  id?: string
  code: string
  name: string
  trade: string
  leaderUserId: string
  status: 'active' | 'inactive'
  dailyCapacityHours: number
  notes: string
  userIds: string[]
} | null>(null)
const dragging = ref<{
  crewName: string
  id: string
  kind: string
  dispatchId?: string
  projectId: string
  taskId?: string
  start: Date
  end: Date
} | null>(null)
const canDispatch = computed(() => !props.permissions || props.permissions.includes('labor.dispatch'))
const canViewLabor = computed(() => !props.permissions || props.permissions.includes('labor.view'))
const canReportLabor = computed(() => !props.permissions || props.permissions.includes('labor.report'))
const canVerifyLabor = computed(() => !props.permissions || props.permissions.includes('labor.verify'))
const laborProjects = computed(() => [...new Map(crews.value.flatMap((crew) => crew.projects).map((project) => [project.id, project])).values()])
const laborTasks = computed(() => [...new Map(crews.value.flatMap((crew) => crew.tasks)
  .filter((task) => task.projectId === laborDraft.value.projectId).map((task) => [task.id, task])).values()])
const laborSummary = computed(() => ({
  pending: laborEntries.value.filter((entry) => entry.status === 'pending').length,
  approvedHours: laborEntries.value.filter((entry) => entry.status === 'approved').reduce((sum, entry) => sum + entry.totalHours, 0),
  rejected: laborEntries.value.filter((entry) => entry.status === 'rejected').length,
  reports: laborEntries.value.length,
}))
const dispatchProjects = computed(() => {
  if (!editingDispatch.value) return []
  return crews.value.find((crew) => crew.name === editingDispatch.value?.crewName)?.projects ?? []
})
const dispatchTasks = computed(() => {
  if (!editingDispatch.value) return []
  const crew = crews.value.find((item) => item.name === editingDispatch.value?.crewName)
  return [...new Map((crew?.tasks ?? [])
    .filter((task) => task.projectId === editingDispatch.value?.projectId)
    .map((task) => [task.id, task])).values()]
})

const roleLabel: Record<CrewMember['role'], string> = {
  admin: '系統管理員', planner: '進度規劃', manager: '專案管理', worker: '現場工班',
}
const statusLabel: Record<string, string> = {
  planning: '規劃中', active: '施工中', inspection: '待驗收', completed: '已完成', archived: '已封存',
}
const riskLabel: Record<string, string> = { normal: '正常', attention: '注意', high: '高風險' }

const filteredCrews = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return crews.value
  return crews.value.filter((crew) => [
    crew.name,
    ...crew.members.flatMap((member) => [member.displayName, member.email, member.department]),
    ...crew.projects.flatMap((project) => [project.code, project.name, project.clientName, project.location]),
    ...crew.tasks.flatMap((task) => [task.code, task.name, task.assigneeName]),
  ].some((value) => value?.toLowerCase().includes(keyword)))
})

const metrics = computed(() => ({
  crews: crews.value.length,
  members: new Set(crews.value.flatMap((crew) => crew.members.map((member) => member.id))).size,
  projects: new Set(crews.value.flatMap((crew) => crew.projects.map((project) => project.id))).size,
  activeTasks: crews.value.flatMap((crew) => crew.tasks).filter((task) => task.progressPct < 100).length,
}))

const selectedCrew = computed(() => crews.value.find((crew) => crew.name === selectedCrewName.value) ?? null)
const selectedAverageProgress = computed(() => {
  if (!selectedCrew.value?.tasks.length) return 0
  return Math.round(selectedCrew.value.tasks.reduce((sum, task) => sum + task.progressPct, 0) / selectedCrew.value.tasks.length)
})

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = result.getDay() || 7
  result.setDate(result.getDate() - day + 1)
  return result
}

function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function parseDate(value: string | null) {
  if (!value) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return year && month && day ? new Date(year, month - 1, day) : null
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const calendarDays = computed(() => Array.from({ length: 14 }, (_, index) => addDays(calendarStart.value, index)))
const todayKey = dateKey(new Date())

function taskDates(task: CrewTask) {
  const projectStart = parseDate(task.projectStartDate)
  if (!projectStart) return null
  const offset = Math.max(0, Math.round((task.pinnedStartDay ?? task.sequence) - 1))
  const start = addDays(projectStart, offset)
  const end = task.assignmentEndsAt
    ? parseDate(task.assignmentEndsAt)
    : addDays(start, Math.max(1, Math.ceil(task.durationDays)) - 1)
  return end ? { start, end } : null
}

function gridSpan(start: Date, end: Date) {
  const windowStart = calendarDays.value[0]
  const windowEnd = calendarDays.value.at(-1)!
  if (end < windowStart || start > windowEnd) return null
  const clampedStart = start < windowStart ? windowStart : start
  const clampedEnd = end > windowEnd ? windowEnd : end
  const startColumn = Math.round((clampedStart.getTime() - windowStart.getTime()) / 86400000) + 1
  const endColumn = Math.round((clampedEnd.getTime() - windowStart.getTime()) / 86400000) + 2
  return `${startColumn} / ${endColumn}`
}

const calendarRows = computed(() => crews.value.map((crew) => {
  const crewDispatchBars = dispatches.value.filter((dispatch) => dispatch.crewName === crew.name).flatMap<CalendarBar>((dispatch) => {
    const start = parseDate(dispatch.startDate)
    const end = parseDate(dispatch.endDate)
    if (!start || !end) return []
    const span = gridSpan(start, end)
    return span ? [{
      id: dispatch.id, dispatchId: dispatch.id,
      projectId: dispatch.projectId, taskId: dispatch.taskId ?? undefined,
      label: dispatch.taskName || dispatch.projectName,
      sub: `${dispatch.projectCode}${dispatch.taskCode ? ` · ${dispatch.taskCode}` : ''} · ${dispatch.plannedPeople} 人`,
      span, kind: 'dispatch', start, end,
    }] : []
  })
  const uniqueTasks = [...new Map(crew.tasks.map((task) => [task.id, task])).values()]
  const taskBars = uniqueTasks.flatMap<CalendarBar>((task) => {
    const range = taskDates(task)
    if (!range) return []
    const span = gridSpan(range.start, range.end)
    return span ? [{ id: task.id, projectId: task.projectId, taskId: task.id, label: task.name, sub: `${task.projectCode} · ${task.code}`, span, kind: 'task', start: range.start, end: range.end }] : []
  })
  const projectBars = crew.projects.flatMap<CalendarBar>((project) => {
    const start = parseDate(project.startDate)
    const end = parseDate(project.endDate)
    if (!start || !end) return []
    const span = gridSpan(start, end)
    return span ? [{ id: project.id, projectId: project.id, label: project.name, sub: project.code, span, kind: 'project', start, end }] : []
  })
  const bars = crewDispatchBars.length ? crewDispatchBars : taskBars.length ? taskBars : projectBars
  const warnings = dispatchWarnings.value.filter((warning) => crewDispatchBars.some((bar) => bar.dispatchId === warning.dispatchId))
  return { crew, bars, warnings }
}))

const calendarSummary = computed(() => {
  const activeCrewNames = new Set(dispatches.value.map((dispatch) => dispatch.crewName))
  return {
    dispatchedCrews: activeCrewNames.size,
    plannedPeople: dispatches.value.reduce((sum, dispatch) => sum + dispatch.plannedPeople, 0),
    conflicts: new Set(dispatchWarnings.value.map((warning) => warning.dispatchId)).size,
    availableCrews: crews.value.filter((crew) => !activeCrewNames.has(crew.name)).length,
  }
})

function dispatchHoursInWindow(dispatch: CrewDispatch) {
  const windowStart = calendarDays.value[0]
  const windowEnd = calendarDays.value.at(-1)!
  const start = parseDate(dispatch.startDate)
  const end = parseDate(dispatch.endDate)
  if (!start || !end || end < windowStart || start > windowEnd) return 0
  const overlapStart = start < windowStart ? windowStart : start
  const overlapEnd = end > windowEnd ? windowEnd : end
  const days = Math.max(1, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1)
  return days * dispatch.plannedPeople * dispatch.dailyHours
}

const approvedLaborInWindow = computed(() => {
  const from = dateKey(calendarDays.value[0])
  const to = dateKey(calendarDays.value.at(-1)!)
  return laborEntries.value.filter((entry) => entry.status === 'approved' && entry.workDate >= from && entry.workDate <= to)
})

const crewAnalytics = computed(() => crews.value.map((crew) => {
  const crewDispatches = dispatches.value.filter((dispatch) => dispatch.crewName === crew.name)
  const scheduledHours = crewDispatches.reduce((sum, dispatch) => sum + dispatchHoursInWindow(dispatch), 0)
  const actualHours = approvedLaborInWindow.value.filter((entry) => entry.crewName === crew.name)
    .reduce((sum, entry) => sum + entry.totalHours, 0)
  const varianceHours = actualHours - scheduledHours
  const actualToPlan = scheduledHours ? Math.round(actualHours / scheduledHours * 100) : actualHours ? 100 : 0
  const dailyCapacity = crew.members.length ? (crew.metadata?.dailyCapacityHours ?? crew.members.length * 8) : 0
  const availableHours = dailyCapacity * calendarDays.value.length
  const utilization = availableHours ? Math.round(scheduledHours / availableHours * 100) : 0
  const averageProgress = crew.tasks.length
    ? Math.round(crew.tasks.reduce((sum, task) => sum + task.progressPct, 0) / crew.tasks.length)
    : 0
  const dispatchIds = new Set(crewDispatches.map((dispatch) => dispatch.id))
  const warningCount = dispatchWarnings.value.filter((warning) => dispatchIds.has(warning.dispatchId)).length
  return {
    crew, scheduledHours, actualHours, varianceHours, actualToPlan, availableHours, utilization, averageProgress, warningCount,
    status: !crew.members.length || warningCount || utilization > 100 ? 'critical' : utilization >= 80 ? 'high' : utilization < 35 ? 'low' : 'normal',
  }
}).sort((a, b) => b.warningCount - a.warningCount || b.utilization - a.utilization))

const analysisSummary = computed(() => {
  const totalScheduled = crewAnalytics.value.reduce((sum, item) => sum + item.scheduledHours, 0)
  const totalAvailable = crewAnalytics.value.reduce((sum, item) => sum + item.availableHours, 0)
  const totalActual = crewAnalytics.value.reduce((sum, item) => sum + item.actualHours, 0)
  return {
    utilization: totalAvailable ? Math.round(totalScheduled / totalAvailable * 100) : 0,
    scheduledHours: totalScheduled,
    actualHours: totalActual,
    varianceHours: totalActual - totalScheduled,
    actualToPlan: totalScheduled ? Math.round(totalActual / totalScheduled * 100) : totalActual ? 100 : 0,
    attentionCrews: crewAnalytics.value.filter((item) => item.status === 'critical' || item.status === 'high').length,
  }
})

const taskLaborAnalytics = computed(() => {
  const taskMap = new Map<string, { taskId: string; projectCode: string; taskCode: string; taskName: string; progressPct: number; plannedHours: number; actualHours: number }>()
  for (const crew of crews.value) for (const task of crew.tasks) if (!taskMap.has(task.id)) taskMap.set(task.id, {
    taskId: task.id, projectCode: task.projectCode, taskCode: task.code, taskName: task.name,
    progressPct: task.progressPct, plannedHours: 0, actualHours: 0,
  })
  for (const dispatch of dispatches.value) {
    if (!dispatch.taskId) continue
    const item = taskMap.get(dispatch.taskId)
    if (item) item.plannedHours += dispatchHoursInWindow(dispatch)
  }
  for (const entry of approvedLaborInWindow.value) {
    const item = taskMap.get(entry.taskId) ?? {
      taskId: entry.taskId, projectCode: entry.projectCode, taskCode: entry.taskCode,
      taskName: entry.taskName, progressPct: 0, plannedHours: 0, actualHours: 0,
    }
    item.actualHours += entry.totalHours
    taskMap.set(entry.taskId, item)
  }
  return [...taskMap.values()].filter((item) => item.plannedHours || item.actualHours).map((item) => ({
    ...item, varianceHours: item.actualHours - item.plannedHours,
    actualToPlan: item.plannedHours ? Math.round(item.actualHours / item.plannedHours * 100) : item.actualHours ? 100 : 0,
  })).sort((a, b) => Math.abs(b.varianceHours) - Math.abs(a.varianceHours))
})

function exportLaborPerformance() {
  const header = ['層級', '代碼', '名稱', '計畫人時', '實際人時', '差異人時', '實際/計畫', 'WBS進度']
  const rows = [
    ...crewAnalytics.value.map((item) => ['工班', item.crew.metadata?.code ?? '', item.crew.name, item.scheduledHours, item.actualHours, item.varianceHours, `${item.actualToPlan}%`, `${item.averageProgress}%`]),
    ...taskLaborAnalytics.value.map((item) => ['WBS', `${item.projectCode}-${item.taskCode}`, item.taskName, item.plannedHours, item.actualHours, item.varianceHours, `${item.actualToPlan}%`, `${item.progressPct}%`]),
  ]
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
  link.download = `PacificPower_工班績效_${dateKey(calendarDays.value[0])}_${dateKey(calendarDays.value.at(-1)!)}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

function showCrew(crew: Crew) {
  selectedCrewName.value = crew.name
  view.value = 'overview'
}

function shiftCalendar(days: number) {
  calendarStart.value = addDays(calendarStart.value, days)
}

function openNewDispatch() {
  if (!canDispatch.value || !crews.value.length) return
  const crew = crews.value[0]
  const project = crew.projects[0]
  const startDate = dateKey(new Date())
  editingDispatch.value = {
    crewName: crew.name, projectId: project?.id ?? '', taskId: '', startDate, endDate: startDate,
    plannedPeople: Math.max(1, crew.members.length), dailyHours: 8, status: 'planned', note: '', requiredQualificationsText: '',
  }
}

function openDispatch(dispatchId: string) {
  const dispatch = dispatches.value.find((item) => item.id === dispatchId)
  if (!dispatch) return
  editingDispatch.value = {
    id: dispatch.id, crewName: dispatch.crewName, projectId: dispatch.projectId,
    taskId: dispatch.taskId ?? '', startDate: dispatch.startDate, endDate: dispatch.endDate,
    plannedPeople: dispatch.plannedPeople, dailyHours: dispatch.dailyHours,
    status: dispatch.status, note: dispatch.note,
    requiredQualificationsText: dispatch.requiredQualifications.map((item) => `${item.name}:${item.count}`).join(', '),
  }
}

function parseRequiredQualifications(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean).map((item) => {
    const match = item.match(/^(.*?)(?:[:：]\s*(\d+))?$/)
    return { name: match?.[1]?.trim() ?? '', count: Number(match?.[2] ?? 1) }
  }).filter((item) => item.name)
}

function changeDispatchCrew() {
  if (!editingDispatch.value) return
  const crew = crews.value.find((item) => item.name === editingDispatch.value?.crewName)
  editingDispatch.value.projectId = crew?.projects[0]?.id ?? ''
  editingDispatch.value.taskId = ''
  editingDispatch.value.plannedPeople = Math.max(1, crew?.members.length ?? 0)
}

async function saveDispatch() {
  const draft = editingDispatch.value
  if (!draft || !draft.projectId || dispatchSaving.value) return
  dispatchSaving.value = true
  try {
    const payload = {
      crewName: draft.crewName, projectId: draft.projectId,
      taskId: draft.taskId || undefined, startDate: draft.startDate, endDate: draft.endDate,
      plannedPeople: Number(draft.plannedPeople), dailyHours: Number(draft.dailyHours),
      status: draft.status, note: draft.note,
      requiredQualifications: parseRequiredQualifications(draft.requiredQualificationsText),
    }
    if (draft.id) {
      const { crewName: _crewName, projectId: _projectId, taskId: _taskId, ...updates } = payload
      await apiRequest(`/projects/crew-dispatches/${draft.id}`, { method: 'PATCH', body: JSON.stringify(updates) })
    } else {
      const { status: _status, ...create } = payload
      await apiRequest('/projects/crew-dispatches', { method: 'POST', body: JSON.stringify(create) })
    }
    editingDispatch.value = null
    dispatchMessage.value = '派工內容已儲存'
    await load()
  } catch (cause) {
    dispatchMessage.value = cause instanceof Error ? `派工儲存失敗：${cause.message}` : '派工儲存失敗'
  } finally {
    dispatchSaving.value = false
  }
}

async function cancelDispatch() {
  const draft = editingDispatch.value
  if (!draft?.id || dispatchSaving.value || !window.confirm('確定要取消這筆派工嗎？')) return
  dispatchSaving.value = true
  try {
    await apiRequest(`/projects/crew-dispatches/${draft.id}`, { method: 'DELETE' })
    editingDispatch.value = null
    dispatchMessage.value = '派工已取消'
    await load()
  } catch (cause) {
    dispatchMessage.value = cause instanceof Error ? `取消失敗：${cause.message}` : '取消派工失敗'
  } finally {
    dispatchSaving.value = false
  }
}

async function openCrewManager() {
  if (!canDispatch.value) return
  crewManagerOpen.value = true
  crewDirectoryLoading.value = true
  crewDirectoryMessage.value = ''
  try {
    const [directory, catalog] = await Promise.all([
      apiRequest<{ crews: ManagedCrew[] }>('/projects/crews'),
      apiRequest<{ members: MemberCandidate[] }>('/projects/crews/member-catalog'),
    ])
    managedCrews.value = directory.crews
    memberCatalog.value = catalog.members
  } catch (cause) {
    crewDirectoryMessage.value = cause instanceof Error ? cause.message : '無法載入工班目錄'
  } finally {
    crewDirectoryLoading.value = false
  }
}

function newCrew() {
  editingCrew.value = {
    code: `CREW-${String(managedCrews.value.length + 1).padStart(2, '0')}`,
    name: '', trade: '', leaderUserId: '', status: 'active', dailyCapacityHours: 8, notes: '', userIds: [],
  }
}

function editCrew(crew: ManagedCrew) {
  editingCrew.value = {
    id: crew.id, code: crew.code, name: crew.name, trade: crew.trade,
    leaderUserId: crew.leaderUserId ?? '', status: crew.status,
    dailyCapacityHours: crew.dailyCapacityHours, notes: crew.notes,
    userIds: crew.members.map((member) => member.id),
  }
}

function toggleCrewMember(userId: string) {
  if (!editingCrew.value) return
  const index = editingCrew.value.userIds.indexOf(userId)
  if (index >= 0) editingCrew.value.userIds.splice(index, 1)
  else editingCrew.value.userIds.push(userId)
}

function editQualifications(member: MemberCandidate) {
  qualificationMemberId.value = member.id
  qualificationDrafts.value = member.qualifications.map((item) => ({
    ...item, certificateNo: item.certificateNo ?? '', issuedOn: item.issuedOn ?? '',
    expiresOn: item.expiresOn ?? '', notes: item.notes ?? '',
  }))
}

function addQualification() {
  qualificationDrafts.value.push({ name: '', certificateNo: '', issuedOn: '', expiresOn: '', notes: '' })
}

function removeQualification(index: number) {
  qualificationDrafts.value.splice(index, 1)
}

async function saveQualifications() {
  if (!qualificationMemberId.value || qualificationSaving.value || qualificationDrafts.value.some((item) => !item.name.trim())) return
  qualificationSaving.value = true
  crewDirectoryMessage.value = ''
  try {
    const result = await apiRequest<{ members: MemberCandidate[] }>(`/projects/crews/members/${qualificationMemberId.value}/qualifications`, {
      method: 'PUT',
      body: JSON.stringify({ qualifications: qualificationDrafts.value.map((item) => ({
        name: item.name, certificateNo: item.certificateNo,
        issuedOn: item.issuedOn || undefined, expiresOn: item.expiresOn || undefined, notes: item.notes,
      })) }),
    })
    memberCatalog.value = result.members
    const refreshed = result.members.find((member) => member.id === qualificationMemberId.value)
    if (refreshed) editQualifications(refreshed)
    crewDirectoryMessage.value = '成員技能與證照已儲存'
  } catch (cause) {
    crewDirectoryMessage.value = cause instanceof Error ? cause.message : '資格資料儲存失敗'
  } finally {
    qualificationSaving.value = false
  }
}

function editAvailability(member: MemberCandidate) {
  availabilityMemberId.value = member.id
  availabilityDrafts.value = member.unavailability.map((item) => ({ ...item, reason: item.reason ?? '' }))
}

function addUnavailability() {
  const today = dateKey(new Date())
  availabilityDrafts.value.push({ startDate: today, endDate: today, type: 'leave', reason: '' })
}

function removeUnavailability(index: number) {
  availabilityDrafts.value.splice(index, 1)
}

async function saveAvailability() {
  if (!availabilityMemberId.value || availabilitySaving.value || availabilityDrafts.value.some((item) => !item.startDate || !item.endDate || item.endDate < item.startDate)) return
  availabilitySaving.value = true
  crewDirectoryMessage.value = ''
  try {
    const result = await apiRequest<{ members: MemberCandidate[] }>(`/projects/crews/members/${availabilityMemberId.value}/unavailability`, {
      method: 'PUT', body: JSON.stringify({ periods: availabilityDrafts.value.map((item) => ({
        startDate: item.startDate, endDate: item.endDate, type: item.type, reason: item.reason,
      })) }),
    })
    memberCatalog.value = result.members
    const refreshed = result.members.find((member) => member.id === availabilityMemberId.value)
    if (refreshed) editAvailability(refreshed)
    crewDirectoryMessage.value = '人員不可派工期間已儲存，調度警示將自動更新'
    await load()
  } catch (cause) {
    crewDirectoryMessage.value = cause instanceof Error ? cause.message : '人員可用性儲存失敗'
  } finally {
    availabilitySaving.value = false
  }
}

async function saveCrew() {
  const draft = editingCrew.value
  if (!draft || !draft.name.trim() || crewDirectoryLoading.value) return
  crewDirectoryLoading.value = true
  crewDirectoryMessage.value = ''
  try {
    const payload = {
      code: draft.code, name: draft.name, trade: draft.trade,
      leaderUserId: draft.leaderUserId || undefined, dailyCapacityHours: Number(draft.dailyCapacityHours),
      notes: draft.notes, status: draft.status,
    }
    let crewId = draft.id
    if (crewId) {
      await apiRequest(`/projects/crews/${crewId}`, { method: 'PATCH', body: JSON.stringify(payload) })
    } else {
      const { status: _status, ...create } = payload
      const created = await apiRequest<{ id: string }>('/projects/crews', { method: 'POST', body: JSON.stringify(create) })
      crewId = created.id
    }
    await apiRequest(`/projects/crews/${crewId}/members`, {
      method: 'PUT', body: JSON.stringify({ userIds: draft.userIds }),
    })
    editingCrew.value = null
    await openCrewManager()
    crewDirectoryMessage.value = '工班資料與成員已儲存'
    await load()
  } catch (cause) {
    crewDirectoryMessage.value = cause instanceof Error ? cause.message : '工班儲存失敗'
  } finally {
    crewDirectoryLoading.value = false
  }
}

function startDrag(crew: Crew, bar: CalendarBar, event: DragEvent) {
  if (!canDispatch.value) return
  dragging.value = {
    crewName: crew.name, id: bar.id, kind: bar.kind, dispatchId: bar.dispatchId,
    projectId: bar.projectId, taskId: bar.taskId, start: bar.start, end: bar.end,
  }
  event.dataTransfer?.setData('text/plain', bar.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

async function dropDispatch(crew: Crew, day: Date) {
  const item = dragging.value
  dragging.value = null
  if (!item || !canDispatch.value || item.crewName !== crew.name) return
  const duration = Math.max(1, Math.round((item.end.getTime() - item.start.getTime()) / 86400000) + 1)
  const startDate = dateKey(day)
  const endDate = dateKey(addDays(day, duration - 1))
  dispatchMessage.value = '正在儲存派工…'
  try {
    if (item.dispatchId) {
      await apiRequest(`/projects/crew-dispatches/${item.dispatchId}`, {
        method: 'PATCH', body: JSON.stringify({ startDate, endDate }),
      })
    } else {
      await apiRequest('/projects/crew-dispatches', {
        method: 'POST', body: JSON.stringify({
          crewName: crew.name, projectId: item.projectId, taskId: item.taskId,
          startDate, endDate, plannedPeople: Math.max(1, crew.members.length), dailyHours: 8,
        }),
      })
    }
    dispatchMessage.value = `已將 ${crew.name} 派工調整至 ${startDate}`
    await load()
  } catch (cause) {
    dispatchMessage.value = cause instanceof Error ? `派工儲存失敗：${cause.message}` : '派工儲存失敗'
  }
}

function changeLaborProject() {
  laborDraft.value.taskId = laborTasks.value[0]?.id ?? ''
  const crew = crews.value.find((item) => item.projects.some((project) => project.id === laborDraft.value.projectId))
  laborDraft.value.crewName = crew?.name ?? ''
}

async function submitLaborEntry() {
  const draft = laborDraft.value
  if (!canReportLabor.value || !draft.projectId || !draft.taskId || laborSaving.value) return
  laborSaving.value = true
  laborMessage.value = ''
  try {
    await apiRequest('/projects/labor-entries', {
      method: 'POST', body: JSON.stringify({
        projectId: draft.projectId, taskId: draft.taskId, workDate: draft.workDate,
        people: Number(draft.people), hours: Number(draft.hours), crewName: draft.crewName, note: draft.note,
      }),
    })
    laborMessage.value = '人工時已送出，等待 manager 審核'
    laborDraft.value.note = ''
    if (canViewLabor.value) await loadLaborEntries()
  } catch (cause) {
    laborMessage.value = cause instanceof Error ? `回報失敗：${cause.message}` : '人工時回報失敗'
  } finally {
    laborSaving.value = false
  }
}

async function reviewLaborEntry(entry: LaborEntry, status: 'approved' | 'rejected') {
  if (!canVerifyLabor.value || entry.status !== 'pending' || laborSaving.value) return
  const reason = status === 'rejected' ? window.prompt('請輸入退回原因') : ''
  if (status === 'rejected' && !reason?.trim()) return
  laborSaving.value = true
  laborMessage.value = ''
  try {
    await apiRequest(`/projects/labor-entries/${entry.id}/${status === 'approved' ? 'approve' : 'reject'}`, {
      method: 'POST', body: status === 'rejected' ? JSON.stringify({ reason: reason!.trim() }) : undefined,
    })
    laborMessage.value = status === 'approved' ? '人工時已核准並計入負載分析' : '人工時已退回填報者'
    await Promise.all([loadLaborEntries(), load()])
  } catch (cause) {
    laborMessage.value = cause instanceof Error ? `審核失敗：${cause.message}` : '人工時審核失敗'
  } finally {
    laborSaving.value = false
  }
}

async function loadLaborEntries() {
  if (!canViewLabor.value) return
  const result = await apiRequest<{ entries: LaborEntry[] }>('/projects/labor-entries')
  laborEntries.value = result.entries
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [organization, dispatchData] = await Promise.all([
      apiRequest<{ crews: Crew[] }>('/projects/crew-organization'),
      apiRequest<{ dispatches: CrewDispatch[]; warnings: DispatchWarning[] }>('/projects/crew-dispatches'),
    ])
    crews.value = organization.crews
    dispatches.value = dispatchData.dispatches
    dispatchWarnings.value = dispatchData.warnings
    if (canViewLabor.value) await loadLaborEntries()
    if (!laborDraft.value.projectId && laborProjects.value.length) {
      laborDraft.value.projectId = laborProjects.value[0]!.id
      changeLaborProject()
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法載入工班資料'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (props.initialTarget === 'calendar') view.value = 'calendar'
  if (props.initialTarget === 'labor') view.value = 'labor'
  await load()
  if (props.initialTarget === 'directory') await openCrewManager()
})
</script>

<template>
  <section class="crew-page">
    <header class="crew-page__top">
      <div class="brand"><div class="brand__mark">P</div><div><strong>PACIFICPOWER</strong><small>工程數位管理平台</small></div></div>
      <button class="back-button" @click="emit('back')">‹ 返回專案總覽</button>
    </header>

    <main class="crew-page__main">
      <div class="heading-row">
        <div><p>CREW ORGANIZATION</p><h1>工班組織與案件配置</h1><span>掌握每個工班目前參與的專案、負責人員與 WBS 工項。</span></div>
        <div class="heading-tools">
          <label v-if="view === 'overview' && !selectedCrew" class="search"><span>⌕</span><input v-model="query" placeholder="搜尋工班、人員、專案或工項" /></label>
          <div class="view-tabs"><button :class="{ active: view === 'overview' }" @click="view = 'overview'">工班總覽</button><button :class="{ active: view === 'calendar' }" @click="selectedCrewName = null; view = 'calendar'">調度行事曆</button><button v-if="canViewLabor || canReportLabor" :class="{ active: view === 'labor' }" @click="selectedCrewName = null; view = 'labor'">人工時回報</button><button :class="{ active: view === 'analysis' }" @click="selectedCrewName = null; view = 'analysis'">負載分析</button></div>
          <button v-if="canDispatch" class="manage-crews-button" @click="openCrewManager">⚙ 管理工班</button>
        </div>
      </div>

      <div v-if="view === 'overview' && !selectedCrew" class="metrics">
        <article><span>工班數</span><strong>{{ metrics.crews }}</strong><small>已設定工班</small></article>
        <article><span>工班成員</span><strong>{{ metrics.members }}</strong><small>平台使用者</small></article>
        <article><span>參與專案</span><strong>{{ metrics.projects }}</strong><small>跨專案統計</small></article>
        <article><span>進行中工項</span><strong>{{ metrics.activeTasks }}</strong><small>尚未完成的 WBS</small></article>
      </div>

      <div v-if="loading" class="state">正在彙整工班與專案資料…</div>
      <div v-else-if="error" class="state state--error"><strong>資料載入失敗</strong><span>{{ error }}</span><button @click="load">重新載入</button></div>

      <section v-else-if="view === 'overview' && selectedCrew" class="crew-detail">
        <div class="detail-head">
          <button @click="selectedCrewName = null">‹ 所有工班</button>
          <div class="crew-symbol">{{ selectedCrew.name.slice(0, 1) }}</div>
          <div><span>CREW PROFILE</span><h2>{{ selectedCrew.name }}</h2><p>工班成員、案件配置、WBS 與人工時整合檢視</p></div>
        </div>
        <div class="detail-metrics">
          <article><span>工班成員</span><strong>{{ selectedCrew.members.length }}</strong><small>已啟用帳號</small></article>
          <article><span>參與專案</span><strong>{{ selectedCrew.projects.length }}</strong><small>目前可見案件</small></article>
          <article><span>工項平均進度</span><strong>{{ selectedAverageProgress }}%</strong><small>{{ selectedCrew.tasks.length }} 項 WBS</small></article>
          <article><span>已回報人工時</span><strong>{{ selectedCrew.laborHours.toLocaleString() }}</strong><small>人時</small></article>
        </div>
        <div class="detail-grid">
          <section class="detail-panel detail-panel--members">
            <div class="section-title"><span>成員與角色</span><small>{{ selectedCrew.members.length }} 人</small></div>
            <div v-if="selectedCrew.members.length" class="detail-members">
              <article v-for="member in selectedCrew.members" :key="member.id">
                <b>{{ member.displayName.slice(0, 1) }}</b><div><strong>{{ member.displayName }}</strong><small>{{ member.email }}</small></div><em>{{ roleLabel[member.role] }}</em><p>{{ member.department || '尚未設定部門／專業' }}</p>
              </article>
            </div>
            <p v-else class="empty-copy">尚未將平台帳號配置到此工班。</p>
          </section>
          <section class="detail-panel">
            <div class="section-title"><span>參與案件</span><small>點擊進入專案工作區</small></div>
            <div class="detail-projects">
              <button v-for="project in selectedCrew.projects" :key="project.id" @click="emit('openProject', project.id)">
                <i /><div><small>{{ project.code }}</small><strong>{{ project.name }}</strong><span>{{ project.clientName }} · {{ project.location }}</span></div><em>{{ statusLabel[project.status] ?? project.status }}</em><b>›</b>
              </button>
            </div>
          </section>
        </div>
        <section class="detail-panel detail-tasks">
          <div class="section-title"><span>WBS 工項與負責人</span><small>依工項指派自動彙整</small></div>
          <div v-if="selectedCrew.tasks.length" class="detail-task-table">
            <div class="detail-task-table__head"><span>專案／工項</span><span>負責人</span><span>預計投入</span><span>完成進度</span></div>
            <div v-for="task in selectedCrew.tasks" :key="`${task.id}-${task.assigneeId}`" class="detail-task-row">
              <span><small>{{ task.projectCode }} · {{ task.code }}</small><strong>{{ task.name }}</strong></span><span>{{ task.assigneeName }}</span><span>{{ Math.max(1, Math.ceil(task.durationDays)) }} 天</span><span class="detail-progress"><i><b :style="{ width: `${task.progressPct}%` }" /></i><strong>{{ task.progressPct }}%</strong></span>
            </div>
          </div>
          <p v-else class="empty-copy">尚未將正式 WBS 工項指派給此工班成員。</p>
        </section>
      </section>

      <div v-else-if="view === 'overview' && !filteredCrews.length" class="state">
        <strong>{{ crews.length ? '找不到符合條件的工班' : '目前尚未設定工班' }}</strong>
        <span v-if="!crews.length">請先在專案設定填寫負責工班，並在帳號權限中設定現場人員的工班名稱。</span>
      </div>

      <div v-else-if="view === 'overview'" class="crew-list">
        <article v-for="crew in filteredCrews" :key="crew.name" class="crew-card">
          <header class="crew-card__head">
            <div class="crew-symbol">{{ crew.name.slice(0, 1) }}</div>
            <div><span>CREW</span><h2>{{ crew.name }}</h2></div>
            <div class="crew-card__counts"><b>{{ crew.members.length }}</b> 人員 <i /> <b>{{ crew.projects.length }}</b> 專案 <i /> <b>{{ crew.tasks.filter(task => task.progressPct < 100).length }}</b> 工項</div>
            <button class="detail-button" @click="showCrew(crew)">查看工班詳情 →</button>
          </header>

          <div class="crew-card__body">
            <section class="members-panel">
              <div class="section-title"><span>工班成員</span><small>帳號與角色</small></div>
              <div v-if="crew.members.length" class="members">
                <div v-for="member in crew.members" :key="member.id" class="member">
                  <b>{{ member.displayName.slice(0, 1) }}</b>
                  <span><strong>{{ member.displayName }}</strong><small>{{ member.department || member.email }}</small></span>
                  <em>{{ roleLabel[member.role] }}</em>
                </div>
              </div>
              <p v-else class="empty-copy">專案已指定此工班，尚未配置平台成員。</p>
            </section>

            <section class="projects-panel">
              <div class="section-title"><span>目前進行案件</span><small>點擊可進入專案</small></div>
              <div v-if="crew.projects.length" class="projects">
                <button v-for="project in crew.projects" :key="project.id" class="project" @click="emit('openProject', project.id)">
                  <span class="project__marker" />
                  <span class="project__name"><small>{{ project.code }}</small><strong>{{ project.name }}</strong><em>{{ project.clientName }} · {{ project.location }}</em></span>
                  <span class="project__status" :data-status="statusLabel[project.status] ?? project.status">{{ statusLabel[project.status] ?? project.status }}</span>
                  <span class="project__risk" :data-risk="riskLabel[project.riskStatus] ?? project.riskStatus">● {{ riskLabel[project.riskStatus] ?? project.riskStatus }}</span>
                  <span class="project__arrow">›</span>
                </button>
              </div>
              <p v-else class="empty-copy">此工班尚未配置專案。</p>
            </section>
          </div>

          <section class="tasks-panel">
            <div class="section-title"><span>WBS 負責工項</span><small>依專案工項指派自動彙整</small></div>
            <div v-if="crew.tasks.length" class="tasks">
              <div v-for="task in crew.tasks" :key="`${task.id}-${task.assigneeId}`" class="task">
                <span><small>{{ task.projectCode }} · {{ task.code }}</small><strong>{{ task.name }}</strong></span>
                <em>{{ task.assigneeName }}</em>
                <div class="task__progress"><i><b :style="{ width: `${task.progressPct}%` }" /></i><strong>{{ task.progressPct }}%</strong></div>
              </div>
            </div>
            <p v-else class="empty-copy">尚未將 WBS 工項指派給此工班成員。</p>
          </section>
        </article>
      </div>

      <section v-else-if="view === 'labor'" class="labor-panel">
        <header class="labor-head">
          <div><span>LABOR TIME REPORT</span><h2>人工時回報與審核</h2><p>依日期、專案及 WBS 工項填報；核准後才會計入負載分析。</p></div>
          <button v-if="canViewLabor" type="button" @click="loadLaborEntries">↻ 重新整理</button>
        </header>
        <div v-if="canViewLabor" class="labor-metrics">
          <article><span>待審回報</span><strong>{{ laborSummary.pending }}</strong><small>需 manager 確認</small></article>
          <article><span>已核准人工時</span><strong>{{ laborSummary.approvedHours.toLocaleString() }}</strong><small>人時</small></article>
          <article><span>已退回</span><strong>{{ laborSummary.rejected }}</strong><small>可依原因修正</small></article>
          <article><span>累計回報筆數</span><strong>{{ laborSummary.reports }}</strong><small>所有狀態</small></article>
        </div>
        <p v-if="laborMessage" class="labor-message" :class="{ error: laborMessage.includes('失敗') }">{{ laborMessage }}</p>
        <form v-if="canReportLabor" class="labor-form" @submit.prevent="submitLaborEntry">
          <div class="labor-form__title"><div><small>FIELD REPORT</small><strong>新增現場人工時</strong></div><span>總人時：{{ Number(laborDraft.people || 0) * Number(laborDraft.hours || 0) }}</span></div>
          <label><span>專案</span><select v-model="laborDraft.projectId" required @change="changeLaborProject"><option disabled value="">選擇專案</option><option v-for="project in laborProjects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option></select></label>
          <label><span>WBS 工項</span><select v-model="laborDraft.taskId" required><option disabled value="">選擇工項</option><option v-for="task in laborTasks" :key="task.id" :value="task.id">{{ task.code }} · {{ task.name }}</option></select></label>
          <label><span>施工日期</span><input v-model="laborDraft.workDate" type="date" required /></label>
          <label><span>工班</span><select v-model="laborDraft.crewName" required><option v-for="crew in crews" :key="crew.name" :value="crew.name">{{ crew.name }}</option></select></label>
          <label><span>投入人數</span><input v-model.number="laborDraft.people" type="number" min="0.5" max="500" step="0.5" required /></label>
          <label><span>每人工時</span><input v-model.number="laborDraft.hours" type="number" min="0.25" max="24" step="0.25" required /></label>
          <label class="wide"><span>現場備註</span><textarea v-model="laborDraft.note" rows="2" maxlength="1000" placeholder="施工內容、異常或交接事項" /></label>
          <button type="submit" :disabled="laborSaving || !laborDraft.taskId">{{ laborSaving ? '送出中…' : '送出待審' }}</button>
        </form>
        <div v-if="canViewLabor" class="labor-table-wrap">
          <div class="labor-table labor-table--head"><span>日期／工班</span><span>專案／WBS</span><span>回報人</span><span>人數 × 工時</span><span>狀態</span><span>審核</span></div>
          <div v-for="entry in laborEntries" :key="entry.id" class="labor-table">
            <span><strong>{{ entry.workDate }}</strong><small>{{ entry.crewName || '未指定工班' }}</small></span>
            <span><strong>{{ entry.projectCode }} · {{ entry.taskCode }}</strong><small>{{ entry.taskName }}</small></span>
            <span><strong>{{ entry.reporterName || '平台使用者' }}</strong><small>{{ entry.note || '無備註' }}</small></span>
            <span><strong>{{ entry.people }} × {{ entry.hours }}</strong><small>{{ entry.totalHours }} 人時</small></span>
            <span><b class="labor-status" :data-status="entry.status">{{ entry.status === 'pending' ? '待審' : entry.status === 'approved' ? '已核准' : '已退回' }}</b><small v-if="entry.rejectionReason">{{ entry.rejectionReason }}</small><small v-else-if="entry.verifierName">{{ entry.verifierName }}</small></span>
            <span class="labor-review"><template v-if="entry.status === 'pending' && canVerifyLabor"><button type="button" :disabled="laborSaving" @click="reviewLaborEntry(entry, 'approved')">核准</button><button type="button" class="reject" :disabled="laborSaving" @click="reviewLaborEntry(entry, 'rejected')">退回</button></template><em v-else>—</em></span>
          </div>
          <div v-if="!laborEntries.length" class="state"><strong>尚無人工時回報</strong><span>現場人員送出後，待審資料會顯示在這裡。</span></div>
        </div>
      </section>

      <section v-else-if="view === 'analysis'" class="analysis-panel">
        <header class="analysis-head">
          <div><span>CREW CAPACITY ANALYTICS</span><h2>工班負載與人工時分析</h2><p>{{ dateKey(calendarDays[0]) }} ～ {{ dateKey(calendarDays.at(-1)!) }}；依正式派工計算未來 14 天負載。</p></div>
          <div><button @click="shiftCalendar(-14)">‹ 前兩週</button><button @click="calendarStart = startOfWeek(new Date())">本週</button><button @click="shiftCalendar(14)">後兩週 ›</button><button class="export-performance" @click="exportLaborPerformance">⇩ 匯出報表</button></div>
        </header>
        <div class="analysis-metrics">
          <article><span>整體負載率</span><strong>{{ analysisSummary.utilization }}%</strong><small>排程人時 ÷ 可用產能</small></article>
          <article><span>區間計畫人時</span><strong>{{ analysisSummary.scheduledHours.toLocaleString() }}</strong><small>正式派工計算</small></article>
          <article><span>已核准實際人時</span><strong>{{ analysisSummary.actualHours.toLocaleString() }}</strong><small>計畫達成 {{ analysisSummary.actualToPlan }}%</small></article>
          <article :class="{ warning: analysisSummary.varianceHours > 0 }"><span>實際－計畫差異</span><strong>{{ analysisSummary.varianceHours > 0 ? '+' : '' }}{{ analysisSummary.varianceHours.toLocaleString() }}</strong><small>{{ analysisSummary.varianceHours > 0 ? '實際投入超過計畫' : analysisSummary.varianceHours < 0 ? '尚未投入或回報不足' : '與計畫一致' }}</small></article>
        </div>
        <div v-if="crewAnalytics.length" class="analysis-table">
          <div class="analysis-row analysis-row--head"><span>工班</span><span>計畫／可用人時</span><span>負載率</span><span>WBS 進度</span><span>實際／計畫</span><span>人時差異</span><span>狀態</span></div>
          <button v-for="item in crewAnalytics" :key="item.crew.name" class="analysis-row" @click="showCrew(item.crew)">
            <span class="analysis-crew"><i>{{ item.crew.name.slice(0, 1) }}</i><span><strong>{{ item.crew.name }}</strong><small>{{ item.crew.metadata?.trade || `${item.crew.members.length} 位成員` }}</small></span></span>
            <span><strong>{{ item.scheduledHours.toLocaleString() }}</strong><small>／ {{ item.availableHours.toLocaleString() }} 人時</small></span>
            <span class="analysis-load"><span><i :style="{ width: `${Math.min(item.utilization, 100)}%` }" :data-status="item.status" /></span><strong>{{ item.utilization }}%</strong></span>
            <span><strong>{{ item.averageProgress }}%</strong><small>{{ item.crew.tasks.length }} 項 WBS</small></span>
            <span><strong>{{ item.actualHours.toLocaleString() }}</strong><small>{{ item.actualToPlan }}% of plan</small></span>
            <span class="variance-value" :data-over="item.varianceHours > 0"><strong>{{ item.varianceHours > 0 ? '+' : '' }}{{ item.varianceHours.toLocaleString() }}</strong><small>人時</small></span>
            <span class="analysis-status" :data-status="item.status"><b>{{ item.warningCount ? `${item.warningCount} 項警示` : !item.crew.members.length ? '尚未配置成員' : item.status === 'high' ? '接近滿載' : item.status === 'low' ? '可再調度' : '負載正常' }}</b><em>查看 ›</em></span>
          </button>
        </div>
        <div v-else class="state"><strong>尚無可分析的工班</strong><span>建立工班並安排正式派工後，系統會自動計算負載。</span></div>
        <section class="task-performance">
          <header><div><span>WBS PERFORMANCE</span><strong>WBS 工時落差</strong></div><small>只計入目前 14 天區間內的正式派工與已核准回報</small></header>
          <div v-if="taskLaborAnalytics.length" class="task-performance__table">
            <div class="task-performance__row task-performance__row--head"><span>專案／WBS</span><span>工項</span><span>進度</span><span>計畫人時</span><span>實際人時</span><span>差異</span></div>
            <div v-for="item in taskLaborAnalytics" :key="item.taskId" class="task-performance__row">
              <span><strong>{{ item.projectCode }}</strong><small>{{ item.taskCode }}</small></span><span><strong>{{ item.taskName }}</strong><small>實際／計畫 {{ item.actualToPlan }}%</small></span><span>{{ item.progressPct }}%</span><span>{{ item.plannedHours.toLocaleString() }}</span><span>{{ item.actualHours.toLocaleString() }}</span><span class="variance-value" :data-over="item.varianceHours > 0"><strong>{{ item.varianceHours > 0 ? '+' : '' }}{{ item.varianceHours.toLocaleString() }}</strong><small>人時</small></span>
            </div>
          </div>
          <p v-else>此區間尚無可比較的 WBS 派工或已核准人工時。</p>
        </section>
        <footer class="analysis-notes"><strong>計算說明</strong><span>計畫人時＝派工天數 × 預計人數 × 每日工時；實際人時只採計 manager 已核准的回報。正差異代表實際投入超過計畫，需確認施工難度或效率原因。</span></footer>
      </section>

      <section v-else class="calendar-panel">
        <header class="calendar-toolbar">
          <div><span>CROSS-PROJECT DISPATCH</span><h2>跨專案調度行事曆</h2><p>WBS 已指派時顯示工項；尚未指派時先顯示專案工期。</p></div>
          <div><button @click="shiftCalendar(-14)">‹ 前兩週</button><button @click="calendarStart = startOfWeek(new Date())">本週</button><button @click="shiftCalendar(14)">後兩週 ›</button><button v-if="canDispatch" class="new-dispatch" @click="openNewDispatch">＋ 新增派工</button></div>
        </header>
        <div v-if="dispatchMessage || dispatchWarnings.length" class="dispatch-alerts">
          <span v-if="dispatchMessage" :class="{ error: dispatchMessage.includes('失敗') }">{{ dispatchMessage }}</span>
          <span v-if="dispatchWarnings.length" class="warning">⚠ {{ dispatchWarnings.length }} 項人力或跨專案衝突需要確認</span>
        </div>
        <div v-if="!crews.length" class="state"><strong>目前尚無工班調度資料</strong><span>設定專案負責工班後，專案工期會先顯示在此。</span></div>
        <div v-else class="calendar-scroll">
          <div class="capacity-summary">
            <article><span>已排工班</span><strong>{{ calendarSummary.dispatchedCrews }}</strong></article>
            <article><span>排定人數</span><strong>{{ calendarSummary.plannedPeople }}</strong></article>
            <article :class="{ warning: calendarSummary.conflicts }"><span>衝突派工</span><strong>{{ calendarSummary.conflicts }}</strong></article>
            <article><span>尚未派工</span><strong>{{ calendarSummary.availableCrews }}</strong></article>
          </div>
          <div class="dispatch-calendar">
            <div class="calendar-corner">工班／期間</div>
            <div v-for="day in calendarDays" :key="dateKey(day)" class="calendar-day" :class="{ today: dateKey(day) === todayKey, weekend: day.getDay() === 0 || day.getDay() === 6 }"><small>{{ day.toLocaleDateString('zh-TW', { weekday: 'short' }) }}</small><strong>{{ day.getMonth() + 1 }}/{{ day.getDate() }}</strong></div>
            <template v-for="row in calendarRows" :key="row.crew.name">
              <button class="calendar-crew" :class="{ 'has-warning': row.warnings.length }" @click="showCrew(row.crew)"><strong>{{ row.crew.name }} <em v-if="row.warnings.length">⚠</em></strong><small>{{ row.crew.members.length }} 人 · {{ row.crew.projects.length }} 案</small></button>
              <div class="calendar-track" :style="{ '--lanes': Math.max(1, row.bars.length) }">
                <i v-for="day in calendarDays" :key="dateKey(day)" :class="{ today: dateKey(day) === todayKey, weekend: day.getDay() === 0 || day.getDay() === 6, droppable: canDispatch }" @dragover="canDispatch && $event.preventDefault()" @drop.prevent="dropDispatch(row.crew, day)" />
                <button v-for="(bar, barIndex) in row.bars" :key="`${bar.kind}-${bar.id}`" class="calendar-bar" :class="[`calendar-bar--${bar.kind}`, { 'has-warning': bar.dispatchId && dispatchWarnings.some(warning => warning.dispatchId === bar.dispatchId) }]" :style="{ gridColumn: bar.span, gridRow: barIndex + 1 }" :draggable="canDispatch" :title="bar.dispatchId ? '點擊編輯；拖曳調整日期' : canDispatch ? '拖曳建立正式派工' : '只有工班調度權限可調整'" @dragstart="startDrag(row.crew, bar, $event)" @click="bar.dispatchId ? openDispatch(bar.dispatchId) : showCrew(row.crew)"><small>{{ bar.sub }}</small><strong>{{ bar.label }}</strong></button>
                <span v-if="!row.bars.length" class="calendar-empty">這個期間沒有排定工作</span>
              </div>
            </template>
          </div>
        </div>
        <footer class="calendar-legend"><span><i class="legend-project" /> 專案工期</span><span><i class="legend-task" /> 已指派 WBS／正式派工</span><span><i class="legend-today" /> 今日</span><small>{{ canDispatch ? '拖曳排程列可建立或調整正式派工。' : '目前為唯讀模式。' }}</small></footer>
      </section>
    </main>

    <div v-if="editingDispatch" class="dispatch-modal" @click.self="editingDispatch = null">
      <form class="dispatch-editor" @submit.prevent="saveDispatch">
        <header><div><span>CREW DISPATCH</span><h2>{{ editingDispatch.id ? '編輯派工' : '新增派工' }}</h2></div><button type="button" aria-label="關閉" @click="editingDispatch = null">×</button></header>
        <div class="dispatch-form-grid">
          <label><span>工班</span><select v-model="editingDispatch.crewName" :disabled="Boolean(editingDispatch.id)" @change="changeDispatchCrew"><option v-for="crew in crews" :key="crew.name" :value="crew.name">{{ crew.name }}（{{ crew.members.length }} 人）</option></select></label>
          <label><span>專案</span><select v-model="editingDispatch.projectId" :disabled="Boolean(editingDispatch.id)" @change="editingDispatch.taskId = ''"><option v-for="project in dispatchProjects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option></select></label>
          <label class="wide"><span>WBS 工項（選填）</span><select v-model="editingDispatch.taskId" :disabled="Boolean(editingDispatch.id)"><option value="">整體專案派工</option><option v-for="task in dispatchTasks" :key="task.id" :value="task.id">{{ task.code }} · {{ task.name }}</option></select></label>
          <label><span>開始日期</span><input v-model="editingDispatch.startDate" type="date" required /></label>
          <label><span>結束日期</span><input v-model="editingDispatch.endDate" type="date" :min="editingDispatch.startDate" required /></label>
          <label><span>預計人數</span><input v-model.number="editingDispatch.plannedPeople" type="number" min="0.5" max="500" step="0.5" required /></label>
          <label><span>每日工時</span><input v-model.number="editingDispatch.dailyHours" type="number" min="0.5" max="24" step="0.5" required /></label>
          <label v-if="editingDispatch.id"><span>派工狀態</span><select v-model="editingDispatch.status"><option value="planned">已規劃</option><option value="confirmed">已確認</option><option value="completed">已完成</option></select></label>
          <label class="wide"><span>所需技能／證照與人數</span><input v-model="editingDispatch.requiredQualificationsText" placeholder="例如：甲種電匠:1, 堆高機操作:2" /><small>以逗號分隔；省略人數時預設為 1 人。系統會比對有效期限與出勤狀態。</small></label>
          <label class="wide"><span>備註</span><textarea v-model="editingDispatch.note" rows="3" placeholder="交接事項、所需技能或現場限制" /></label>
        </div>
        <p v-if="editingDispatch.plannedPeople > (crews.find(crew => crew.name === editingDispatch?.crewName)?.members.length ?? 0)" class="dispatch-form-warning">⚠ 排定人數高於目前已配置的工班成員，儲存後會列入人力警示。</p>
        <footer><button v-if="editingDispatch.id" type="button" class="cancel-dispatch" :disabled="dispatchSaving" @click="cancelDispatch">取消派工</button><span /><button type="button" @click="editingDispatch = null">返回</button><button class="save-dispatch" :disabled="dispatchSaving || !editingDispatch.projectId" type="submit">{{ dispatchSaving ? '儲存中…' : '儲存派工' }}</button></footer>
      </form>
    </div>

    <div v-if="crewManagerOpen" class="crew-manager-modal" @click.self="crewManagerOpen = false">
      <section class="crew-manager">
        <header>
          <div><span>CREW DIRECTORY</span><h2>工班與成員管理</h2><p>建立工班、設定專業與每日產能，並配置平台帳號。</p></div>
          <button type="button" aria-label="關閉" @click="crewManagerOpen = false">×</button>
        </header>
        <p v-if="crewDirectoryMessage" class="crew-manager-message">{{ crewDirectoryMessage }}</p>
        <div class="crew-manager-body">
          <aside class="crew-directory">
            <div class="crew-directory__head"><strong>工班目錄</strong><button type="button" @click="newCrew">＋ 新增</button></div>
            <div v-if="crewDirectoryLoading && !managedCrews.length" class="crew-directory__state">正在載入工班…</div>
            <button v-for="crew in managedCrews" :key="crew.id" type="button" class="crew-directory-card" :class="{ active: editingCrew?.id === crew.id, inactive: crew.status === 'inactive' }" @click="editCrew(crew)">
              <span class="crew-directory-card__symbol">{{ crew.name.slice(0, 1) }}</span>
              <span><small>{{ crew.code }} · {{ crew.trade || '未設定工種' }}</small><strong>{{ crew.name }}</strong><em>{{ crew.members.length }} 位成員 · {{ crew.dailyCapacityHours }} 人時／日</em></span>
              <b>{{ crew.status === 'active' ? '啟用' : '停用' }}</b>
            </button>
            <div v-if="!crewDirectoryLoading && !managedCrews.length" class="crew-directory__state">尚未建立正式工班。</div>
          </aside>

          <form v-if="editingCrew" class="crew-editor" @submit.prevent="saveCrew">
            <div class="crew-editor__title"><div><small>{{ editingCrew.id ? 'EDIT CREW' : 'NEW CREW' }}</small><h3>{{ editingCrew.id ? editingCrew.name : '建立新工班' }}</h3></div><button type="button" @click="editingCrew = null">取消編輯</button></div>
            <div class="crew-editor-grid">
              <label><span>工班代碼</span><input v-model="editingCrew.code" required maxlength="40" placeholder="CREW-01" /></label>
              <label><span>工班名稱</span><input v-model="editingCrew.name" required maxlength="100" placeholder="例如：發電機安裝 A 班" /></label>
              <label><span>主要工種</span><input v-model="editingCrew.trade" maxlength="100" placeholder="機電、配管、吊裝…" /></label>
              <label><span>工班長</span><select v-model="editingCrew.leaderUserId"><option value="">尚未指定</option><option v-for="member in memberCatalog" :key="member.id" :value="member.id">{{ member.displayName }} · {{ member.email }}</option></select></label>
              <label><span>每日產能（人時）</span><input v-model.number="editingCrew.dailyCapacityHours" type="number" min="0.5" max="1000" step="0.5" required /></label>
              <label v-if="editingCrew.id"><span>工班狀態</span><select v-model="editingCrew.status"><option value="active">啟用</option><option value="inactive">停用</option></select></label>
              <label class="wide"><span>備註</span><textarea v-model="editingCrew.notes" rows="3" maxlength="2000" placeholder="專長、證照、調度限制或聯絡備註" /></label>
            </div>
            <section class="member-picker">
              <header><div><strong>配置平台成員</strong><small>已選 {{ editingCrew.userIds.length }} 人；勾選其他工班成員會將其移轉至此工班。</small></div></header>
              <div v-if="memberCatalog.length" class="member-picker__grid">
                <article v-for="member in memberCatalog" :key="member.id" :class="{ selected: editingCrew.userIds.includes(member.id) }">
                  <input type="checkbox" :checked="editingCrew.userIds.includes(member.id)" :aria-label="`配置 ${member.displayName}`" @change="toggleCrewMember(member.id)" />
                  <b>{{ member.displayName.slice(0, 1) }}</b>
                  <span><strong>{{ member.displayName }}</strong><small>{{ member.email }}</small><em>{{ member.crewName ? `目前：${member.crewName}` : '目前未分組' }}</em><i v-if="member.qualifications.some(item => item.status === 'expired')" class="qualification-alert expired">有證照已到期</i><i v-else-if="member.qualifications.some(item => item.status === 'expiring')" class="qualification-alert expiring">有證照即將到期</i><i v-else>{{ member.qualifications.length }} 項資格</i></span>
                  <span class="member-actions"><button type="button" @click="editQualifications(member)">資格</button><button type="button" @click="editAvailability(member)">出勤</button></span>
                </article>
              </div>
              <p v-else>目前沒有可配置的平台帳號。</p>
              <section v-if="qualificationMemberId" class="qualification-editor">
                <header><div><strong>{{ memberCatalog.find(member => member.id === qualificationMemberId)?.displayName }}－技能與證照</strong><small>到期前 60 天會顯示提醒。</small></div><button type="button" @click="qualificationMemberId = ''; qualificationDrafts = []">關閉</button></header>
                <div v-if="qualificationDrafts.length" class="qualification-list">
                  <article v-for="(qualification, index) in qualificationDrafts" :key="qualification.id || index">
                    <label><span>技能／證照名稱</span><input v-model="qualification.name" required placeholder="例如：甲種電匠、堆高機操作" /></label>
                    <label><span>證號</span><input v-model="qualification.certificateNo" placeholder="選填" /></label>
                    <label><span>核發日期</span><input v-model="qualification.issuedOn" type="date" /></label>
                    <label><span>有效期限</span><input v-model="qualification.expiresOn" type="date" :min="qualification.issuedOn || undefined" /></label>
                    <label class="wide"><span>備註</span><input v-model="qualification.notes" placeholder="發證單位或適用範圍" /></label>
                    <button type="button" aria-label="移除資格" @click="removeQualification(index)">×</button>
                  </article>
                </div>
                <p v-else>尚未登錄技能或證照。</p>
                <footer><button type="button" @click="addQualification">＋ 新增資格</button><span /><button type="button" class="save-qualifications" :disabled="qualificationSaving || qualificationDrafts.some(item => !item.name.trim())" @click="saveQualifications">{{ qualificationSaving ? '儲存中…' : '儲存資格' }}</button></footer>
              </section>
              <section v-if="availabilityMemberId" class="qualification-editor availability-editor">
                <header><div><strong>{{ memberCatalog.find(member => member.id === availabilityMemberId)?.displayName }}－不可派工期間</strong><small>請假、訓練或其他不可出勤期間會自動納入調度產能。</small></div><button type="button" @click="availabilityMemberId = ''; availabilityDrafts = []">關閉</button></header>
                <div v-if="availabilityDrafts.length" class="availability-list">
                  <article v-for="(period, index) in availabilityDrafts" :key="period.id || index">
                    <label><span>開始日期</span><input v-model="period.startDate" type="date" required /></label>
                    <label><span>結束日期</span><input v-model="period.endDate" type="date" :min="period.startDate" required /></label>
                    <label><span>類型</span><select v-model="period.type"><option value="leave">請假</option><option value="training">教育訓練</option><option value="medical">傷病</option><option value="other">其他</option></select></label>
                    <label><span>原因／備註</span><input v-model="period.reason" maxlength="500" placeholder="選填" /></label>
                    <button type="button" aria-label="移除不可派工期間" @click="removeUnavailability(index)">×</button>
                  </article>
                </div>
                <p v-else>目前沒有不可派工期間。</p>
                <footer><button type="button" @click="addUnavailability">＋ 新增期間</button><span /><button type="button" class="save-qualifications" :disabled="availabilitySaving || availabilityDrafts.some(item => !item.startDate || !item.endDate || item.endDate < item.startDate)" @click="saveAvailability">{{ availabilitySaving ? '儲存中…' : '儲存出勤資料' }}</button></footer>
              </section>
            </section>
            <footer><span>工班名稱異動會同步更新專案、派工與使用者資料。</span><button class="save-crew" type="submit" :disabled="crewDirectoryLoading || !editingCrew.name.trim()">{{ crewDirectoryLoading ? '儲存中…' : '儲存工班' }}</button></footer>
          </form>
          <div v-else class="crew-editor-empty"><span>👥</span><strong>選擇工班開始編輯</strong><p>或按「新增」建立新的施工工班。</p></div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.crew-page{min-height:100%;overflow:auto;background:radial-gradient(circle at 84% 2%,#15324b 0,transparent 30%),#08111f;color:#e8eef7}.crew-page__top{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 38px;border-bottom:1px solid #203149;background:#0b1523dd;backdrop-filter:blur(12px);position:sticky;top:0;z-index:10}.brand{display:flex;align-items:center;gap:11px}.brand__mark{width:34px;height:34px;display:grid;place-items:center;border-radius:8px;background:#4cc2ff;color:#07121e;font-weight:900}.brand strong,.brand small{display:block}.brand strong{font-size:13px;letter-spacing:.12em}.brand small{margin-top:2px;color:#74879f;font-size:8px}.back-button{border-color:#36506c;color:#98dfff}.crew-page__main{width:min(1380px,calc(100% - 72px));margin:auto;padding:38px 0 80px}.heading-row{display:flex;align-items:flex-end;justify-content:space-between;gap:28px}.heading-row p{margin:0 0 5px;color:#4cc2ff;font-size:9px;letter-spacing:.18em}.heading-row h1{margin:0;font-size:28px}.heading-row>div>span{display:block;margin-top:8px;color:#8295ad;font-size:11px}.search{width:min(380px,40%);display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid #2d435e;border-radius:8px;background:#0d1929}.search span{color:#4cc2ff}.search input{width:100%;border:0;outline:0;background:transparent;color:#e4edf8}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.metrics article{padding:17px 19px;border:1px solid #263a54;border-radius:10px;background:linear-gradient(145deg,#122137,#0e1a2b)}.metrics span,.metrics strong,.metrics small{display:block}.metrics span{color:#8294ac;font-size:9px}.metrics strong{margin:6px 0 3px;font-size:25px}.metrics small{color:#536a85;font-size:8px}.state{min-height:240px;display:grid;place-content:center;justify-items:center;gap:10px;padding:30px;border:1px dashed #304660;border-radius:12px;color:#8194ad;text-align:center}.state strong{color:#dbe7f4;font-size:15px}.state span{max-width:540px;font-size:10px;line-height:1.7}.state--error strong{color:#fb7185}.crew-list{display:grid;gap:18px}.crew-card{border:1px solid #293e59;border-radius:13px;background:#0e192a;overflow:hidden;box-shadow:0 16px 45px #0002}.crew-card__head{display:flex;align-items:center;gap:12px;padding:17px 20px;border-bottom:1px solid #24364e;background:linear-gradient(90deg,#13233a,#101c2e)}.crew-symbol{width:38px;height:38px;display:grid;place-items:center;border:1px solid #4cc2ff66;border-radius:9px;background:#4cc2ff12;color:#68d0ff;font-weight:800}.crew-card__head span{color:#4cc2ff;font-size:7px;letter-spacing:.15em}.crew-card__head h2{margin:2px 0 0;font-size:16px}.crew-card__counts{margin-left:auto;color:#788ca5;font-size:9px}.crew-card__counts b{color:#dbe7f4;font-size:13px}.crew-card__counts i{display:inline-block;width:1px;height:14px;margin:0 10px;background:#344962;vertical-align:middle}.crew-card__body{display:grid;grid-template-columns:minmax(270px,.72fr) minmax(500px,1.6fr);border-bottom:1px solid #24364e}.members-panel,.projects-panel,.tasks-panel{padding:17px 20px}.members-panel{border-right:1px solid #24364e}.section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}.section-title span{font-size:10px;font-weight:700}.section-title small{color:#657b95;font-size:8px}.members,.projects,.tasks{display:grid;gap:7px}.member{display:grid;grid-template-columns:30px 1fr auto;align-items:center;gap:9px;padding:8px;border:1px solid #243750;border-radius:8px;background:#0a1525}.member>b{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:#203c56;color:#75d3ff;font-size:10px}.member span strong,.member span small{display:block}.member span strong{font-size:10px}.member span small{margin-top:2px;color:#6d829b;font-size:8px}.member em{padding:3px 6px;border-radius:99px;background:#233750;color:#9bb0c8;font-size:7px;font-style:normal}.project{display:grid;grid-template-columns:4px minmax(0,1fr) auto auto 18px;align-items:center;gap:11px;width:100%;padding:10px;border:1px solid #263b55;border-radius:8px;background:#0a1525;text-align:left}.project:hover{border-color:#4cc2ff77;background:#102238;color:inherit}.project__marker{height:34px;border-radius:4px;background:#4cc2ff}.project__name small,.project__name strong,.project__name em{display:block}.project__name small{color:#57c8fb;font-size:7px}.project__name strong{margin:2px 0;font-size:10px}.project__name em{color:#6f849e;font-size:8px;font-style:normal}.project__status{padding:3px 7px;border-radius:99px;background:#334155;color:#cbd5e1;font-size:8px}.project__status[data-status='施工中']{background:#075985;color:#7dd3fc}.project__status[data-status='規劃中']{background:#713f12;color:#fde68a}.project__status[data-status='已完成']{background:#14532d;color:#bbf7d0}.project__risk{color:#6ee7b7;font-size:8px}.project__risk[data-risk='注意']{color:#fbbf24}.project__risk[data-risk='高風險']{color:#fb7185}.project__arrow{color:#69d0ff;font-size:20px}.tasks-panel{background:#0b1626}.tasks{grid-template-columns:repeat(2,minmax(0,1fr))}.task{display:grid;grid-template-columns:minmax(0,1fr) auto 120px;align-items:center;gap:12px;padding:9px 11px;border:1px solid #263950;border-radius:8px;background:#101d2f}.task>span small,.task>span strong{display:block}.task>span small{color:#5e7894;font-size:7px}.task>span strong{margin-top:2px;font-size:9px}.task>em{color:#91a6bf;font-size:8px;font-style:normal}.task__progress{display:flex;align-items:center;gap:7px}.task__progress i{flex:1;height:4px;border-radius:99px;background:#273a50;overflow:hidden}.task__progress b{display:block;height:100%;border-radius:inherit;background:#4cc2ff}.task__progress strong{width:28px;font-size:8px;text-align:right}.empty-copy{margin:8px 0;color:#647991;font-size:9px}.state button{margin-top:4px}
.heading-tools{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex:1}.heading-tools .search{width:min(360px,55%)}.view-tabs{display:flex;padding:4px;border:1px solid #2d435e;border-radius:8px;background:#0d1929}.view-tabs button{border:0;padding:6px 11px}.view-tabs button.active{background:#4cc2ff;color:#07121e;font-weight:700}.detail-button{margin-left:10px;padding:7px 10px;border-color:#3c6482;color:#8bd9ff;font-size:9px}.crew-detail{display:grid;gap:16px;margin-top:28px}.detail-head{display:flex;align-items:center;gap:13px;padding:18px 20px;border:1px solid #2c425d;border-radius:12px;background:linear-gradient(110deg,#14263e,#0d192a)}.detail-head>button{align-self:flex-start;border:0;padding:0;color:#72d2ff}.detail-head>div:last-child span{color:#4cc2ff;font-size:7px;letter-spacing:.16em}.detail-head h2{margin:3px 0;font-size:21px}.detail-head p{margin:0;color:#758aa4;font-size:9px}.detail-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.detail-metrics article{padding:15px 17px;border:1px solid #293e58;border-radius:9px;background:#0e1a2b}.detail-metrics span,.detail-metrics strong,.detail-metrics small{display:block}.detail-metrics span{color:#7c90a8;font-size:8px}.detail-metrics strong{margin:5px 0 2px;font-size:21px}.detail-metrics small{color:#526a85;font-size:7px}.detail-grid{display:grid;grid-template-columns:.8fr 1.2fr;gap:16px}.detail-panel{padding:18px;border:1px solid #293e58;border-radius:11px;background:#0d192a}.detail-members{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.detail-members article{display:grid;grid-template-columns:34px 1fr auto;align-items:center;gap:9px;padding:10px;border:1px solid #263a52;border-radius:8px;background:#0a1524}.detail-members article>b{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:#203d58;color:#79d6ff}.detail-members strong,.detail-members small{display:block}.detail-members strong{font-size:9px}.detail-members small{margin-top:2px;color:#647b96;font-size:7px}.detail-members em{padding:3px 6px;border-radius:99px;background:#233750;color:#9bb0c8;font-size:7px;font-style:normal}.detail-members p{grid-column:2/-1;margin:0;color:#71869f;font-size:7px}.detail-projects{display:grid;gap:7px}.detail-projects button{display:grid;grid-template-columns:4px 1fr auto 16px;align-items:center;gap:10px;width:100%;padding:10px;border-color:#293e58;background:#0a1524;text-align:left}.detail-projects button:hover{border-color:#4cc2ff77;color:inherit}.detail-projects i{height:34px;border-radius:3px;background:#4cc2ff}.detail-projects small,.detail-projects strong,.detail-projects span{display:block}.detail-projects small{color:#4cc2ff;font-size:7px}.detail-projects strong{margin:2px 0;font-size:9px}.detail-projects span{color:#657b95;font-size:7px}.detail-projects em{color:#fcd58b;font-size:8px;font-style:normal}.detail-projects b{color:#69d0ff;font-size:18px}.detail-tasks{overflow:hidden}.detail-task-table{display:grid}.detail-task-table__head,.detail-task-row{display:grid;grid-template-columns:1.6fr .6fr .5fr .9fr;align-items:center;gap:14px;padding:9px 10px}.detail-task-table__head{color:#637a94;font-size:7px}.detail-task-row{border-top:1px solid #25384f;font-size:8px}.detail-task-row>span:first-child small,.detail-task-row>span:first-child strong{display:block}.detail-task-row>span:first-child small{color:#597592;font-size:7px}.detail-task-row>span:first-child strong{margin-top:2px}.detail-progress{display:flex;align-items:center;gap:7px}.detail-progress i{flex:1;height:4px;border-radius:99px;background:#263950;overflow:hidden}.detail-progress i b{display:block;height:100%;background:#4cc2ff}.detail-progress>strong{width:28px;text-align:right}.calendar-panel{margin-top:28px;border:1px solid #293e58;border-radius:12px;background:#0d192a;overflow:hidden}.calendar-toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:18px 20px;border-bottom:1px solid #293e58}.calendar-toolbar>div:first-child>span{color:#4cc2ff;font-size:7px;letter-spacing:.16em}.calendar-toolbar h2{margin:3px 0;font-size:18px}.calendar-toolbar p{margin:0;color:#6f839c;font-size:8px}.calendar-toolbar>div:last-child{display:flex;gap:6px}.calendar-toolbar button{padding:6px 9px;font-size:8px}.dispatch-alerts{display:flex;align-items:center;gap:14px;padding:8px 20px;border-bottom:1px solid #263950;background:#0b1727;color:#6ee7b7;font-size:8px}.dispatch-alerts .warning{color:#fbbf24}.dispatch-alerts .error{color:#fb7185}.calendar-scroll{overflow:auto}.dispatch-calendar{min-width:1180px;display:grid;grid-template-columns:180px repeat(14,minmax(68px,1fr))}.calendar-corner,.calendar-day{padding:9px 7px;border-right:1px solid #263950;border-bottom:1px solid #263950;background:#111f32}.calendar-corner{display:flex;align-items:center;color:#8296ad;font-size:8px}.calendar-day{text-align:center}.calendar-day small,.calendar-day strong{display:block}.calendar-day small{color:#657a92;font-size:7px}.calendar-day strong{margin-top:2px;font-size:9px}.calendar-day.weekend{background:#172033}.calendar-day.today{background:#12314a;color:#76d6ff}.calendar-crew{padding:12px;border:0;border-right:1px solid #263950;border-bottom:1px solid #263950;border-radius:0;background:#0b1727;text-align:left}.calendar-crew:hover{background:#12243a;color:inherit}.calendar-crew strong,.calendar-crew small{display:block}.calendar-crew strong{font-size:9px}.calendar-crew strong em{color:#fbbf24;font-style:normal}.calendar-crew.has-warning{border-left:2px solid #f59e0b}.calendar-crew small{margin-top:3px;color:#647b95;font-size:7px}.calendar-track{position:relative;grid-column:2/-1;display:grid;grid-template-columns:repeat(14,minmax(68px,1fr));grid-template-rows:repeat(var(--lanes),36px);min-height:52px;padding:8px 0;border-bottom:1px solid #263950;background:#0a1524}.calendar-track>i{grid-row:1/-1;border-right:1px solid #1f3045}.calendar-track>i.weekend{background:#ffffff03}.calendar-track>i.today{background:#4cc2ff09;border-right-color:#4cc2ff44}.calendar-track>i.droppable{transition:background .15s}.calendar-track>i.droppable:hover{background:#4cc2ff18}.calendar-bar{z-index:2;align-self:center;min-width:0;height:30px;margin:0 3px;padding:4px 7px;border:1px solid #416b89;border-radius:6px;overflow:hidden;background:#15334a;color:#bceaff;text-align:left}.calendar-bar[draggable='true']{cursor:grab}.calendar-bar[draggable='true']:active{cursor:grabbing}.calendar-bar:hover{color:#fff;filter:brightness(1.16)}.calendar-bar.has-warning{border-color:#f59e0b;box-shadow:0 0 0 1px #f59e0b55}.calendar-bar small,.calendar-bar strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.calendar-bar small{color:#66c8f3;font-size:6px}.calendar-bar strong{margin-top:1px;font-size:7px}.calendar-bar--task,.calendar-bar--dispatch{border-color:#4cc2ff88;background:#0d3e5a}.calendar-bar--project{border-color:#8b78e577;background:#2b2851;color:#ddd6fe}.calendar-bar--project small{color:#b8aaf8}.calendar-empty{position:absolute;left:14px;top:20px;color:#4f6680;font-size:8px}.calendar-legend{display:flex;align-items:center;gap:16px;padding:11px 20px;border-top:1px solid #293e58;color:#7388a0;font-size:7px}.calendar-legend span{display:flex;align-items:center;gap:5px}.calendar-legend i{width:10px;height:6px;border-radius:2px}.legend-project{background:#6558b8}.legend-task{background:#1682b2}.legend-today{background:#4cc2ff33;border:1px solid #4cc2ff}.calendar-legend small{margin-left:auto;color:#516981}
.calendar-toolbar .new-dispatch{border-color:#4cc2ff;background:#4cc2ff;color:#07121e;font-weight:700}.capacity-summary{min-width:1180px;display:grid;grid-template-columns:repeat(4,1fr);gap:1px;border-bottom:1px solid #263950;background:#263950}.capacity-summary article{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:#0b1727}.capacity-summary span{color:#6c8199;font-size:7px}.capacity-summary strong{font-size:13px}.capacity-summary article.warning strong{color:#fbbf24}.dispatch-modal{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:20px;background:#030914c7;backdrop-filter:blur(8px)}.dispatch-editor{width:min(660px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:22px;border:1px solid #385573;border-radius:14px;background:linear-gradient(145deg,#15243a,#0e1929);box-shadow:0 28px 80px #000b}.dispatch-editor>header{display:flex;align-items:flex-start;justify-content:space-between}.dispatch-editor>header span{color:#4cc2ff;font-size:8px;letter-spacing:.16em}.dispatch-editor>header h2{margin:4px 0 0;font-size:21px}.dispatch-editor>header button{width:30px;height:30px;padding:0;border:0;color:#8598af;font-size:23px}.dispatch-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-top:19px}.dispatch-form-grid label{display:block;color:#a6b6c9;font-size:9px}.dispatch-form-grid label>span{display:block;margin-bottom:6px}.dispatch-form-grid .wide{grid-column:1/-1}.dispatch-form-grid input,.dispatch-form-grid select,.dispatch-form-grid textarea{width:100%;padding:9px 10px;border:1px solid #304760;border-radius:7px;outline:0;background:#0a1524;color:#e4edf7;font:inherit}.dispatch-form-grid input:focus,.dispatch-form-grid select:focus,.dispatch-form-grid textarea:focus{border-color:#4cc2ff;box-shadow:0 0 0 3px #4cc2ff12}.dispatch-form-grid select:disabled{opacity:.65}.dispatch-form-grid textarea{resize:vertical}.dispatch-form-warning{margin:12px 0 0;padding:9px 11px;border-left:2px solid #f59e0b;background:#f59e0b0b;color:#fbbf24;font-size:8px}.dispatch-editor>footer{display:flex;align-items:center;gap:8px;margin-top:18px}.dispatch-editor>footer span{flex:1}.dispatch-editor>footer button{padding:8px 13px}.dispatch-editor .cancel-dispatch{border-color:#7f2837;color:#fda4af}.dispatch-editor .save-dispatch{border-color:#4cc2ff;background:#4cc2ff;color:#07121e;font-weight:700}.dispatch-editor button:disabled{opacity:.45;cursor:not-allowed}
.dispatch-form-grid label>small{display:block;margin-top:5px;color:#657b93;font-size:7px;line-height:1.5}
.labor-panel{margin-top:28px;border:1px solid #293e58;border-radius:12px;overflow:hidden;background:#0d192a}.labor-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:20px;border-bottom:1px solid #293e58;background:linear-gradient(115deg,#14263e,#0d192a)}.labor-head>div>span{color:#4cc2ff;font-size:7px;letter-spacing:.16em}.labor-head h2{margin:3px 0;font-size:19px}.labor-head p{margin:0;color:#72869e;font-size:8px}.labor-head button{padding:7px 10px;font-size:8px}.labor-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#293e58}.labor-metrics article{padding:14px 18px;background:#0c1727}.labor-metrics span,.labor-metrics strong,.labor-metrics small{display:block}.labor-metrics span{color:#7489a1;font-size:8px}.labor-metrics strong{margin:5px 0 2px;font-size:20px}.labor-metrics small{color:#526a84;font-size:7px}.labor-message{margin:0;padding:9px 18px;border-bottom:1px solid #24445a;background:#123047;color:#7ddcff;font-size:8px}.labor-message.error{color:#fb7185}.labor-form{display:grid;grid-template-columns:1.3fr 1.3fr 1fr 1fr .7fr .7fr auto;align-items:end;gap:10px;padding:16px 18px;border-bottom:1px solid #293e58;background:#0a1524}.labor-form__title{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between}.labor-form__title small,.labor-form__title strong{display:block}.labor-form__title small{color:#4cc2ff;font-size:6px;letter-spacing:.15em}.labor-form__title strong{margin-top:2px;font-size:11px}.labor-form__title>span{color:#8fdcff;font-size:9px}.labor-form label{color:#91a6bd;font-size:7px}.labor-form label>span{display:block;margin-bottom:5px}.labor-form input,.labor-form select,.labor-form textarea{width:100%;padding:8px;border:1px solid #304760;border-radius:6px;background:#071321;color:#e7eef8;font:inherit}.labor-form .wide{grid-column:1/-2}.labor-form textarea{resize:vertical}.labor-form>button{padding:9px 11px;border-color:#4cc2ff;background:#4cc2ff;color:#07121e;font-weight:700}.labor-form>button:disabled{opacity:.45}.labor-table-wrap{overflow:auto}.labor-table{min-width:980px;display:grid;grid-template-columns:.9fr 1.5fr 1.15fr .75fr .8fr .8fr;align-items:center;gap:12px;padding:11px 18px;border-top:1px solid #22364d;background:#0b1626}.labor-table--head{padding-top:8px;padding-bottom:8px;border-top:0;background:#101e31;color:#637b96;font-size:7px}.labor-table span strong,.labor-table span small{display:block}.labor-table span strong{font-size:8px}.labor-table span small{max-width:220px;margin-top:3px;overflow:hidden;color:#657c96;font-size:7px;text-overflow:ellipsis;white-space:nowrap}.labor-status{display:inline-block;padding:4px 7px;border-radius:99px;background:#713f12;color:#fde68a;font-size:7px}.labor-status[data-status='approved']{background:#14532d;color:#bbf7d0}.labor-status[data-status='rejected']{background:#7f1d1d;color:#fecaca}.labor-review{display:flex;gap:5px}.labor-review button{padding:5px 8px;border-color:#237d62;color:#6ee7b7;font-size:7px}.labor-review .reject{border-color:#7f2837;color:#fda4af}.labor-review em{color:#536a83;font-style:normal}
.analysis-panel{margin-top:28px;border:1px solid #293e58;border-radius:12px;overflow:hidden;background:#0d192a}.analysis-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:20px;border-bottom:1px solid #293e58;background:linear-gradient(115deg,#14263e,#0d192a)}.analysis-head>div:first-child>span{color:#4cc2ff;font-size:7px;letter-spacing:.16em}.analysis-head h2{margin:3px 0;font-size:19px}.analysis-head p{margin:0;color:#72869e;font-size:8px}.analysis-head>div:last-child{display:flex;gap:6px}.analysis-head button{padding:6px 9px;font-size:8px}.analysis-head .export-performance{border-color:#4cc2ff;background:#4cc2ff;color:#07121e;font-weight:700}.analysis-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#293e58}.analysis-metrics article{padding:15px 18px;background:#0c1727}.analysis-metrics span,.analysis-metrics strong,.analysis-metrics small{display:block}.analysis-metrics span{color:#7489a1;font-size:8px}.analysis-metrics strong{margin:5px 0 2px;font-size:21px}.analysis-metrics small{color:#526a84;font-size:7px}.analysis-metrics article.warning strong{color:#fbbf24}.analysis-table{overflow:auto}.analysis-row{min-width:1080px;display:grid;grid-template-columns:1.3fr 1fr 1.1fr .7fr .8fr .7fr 1fr;align-items:center;gap:15px;width:100%;padding:12px 18px;border:0;border-top:1px solid #24374e;border-radius:0;background:#0b1626;text-align:left}.analysis-row:not(.analysis-row--head):hover{background:#10233a;color:inherit}.analysis-row--head{padding-top:9px;padding-bottom:9px;background:#101e31;color:#637b96;font-size:7px}.analysis-row span strong,.analysis-row span small{display:block}.analysis-row span strong{font-size:9px}.analysis-row span small{margin-top:3px;color:#657c96;font-size:7px}.analysis-crew{display:flex;align-items:center;gap:9px}.analysis-crew>i{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;background:#193b56;color:#72d2ff;font-size:10px;font-style:normal;font-weight:800}.analysis-load{display:grid!important;grid-template-columns:1fr 34px;align-items:center;gap:8px}.analysis-load>span{height:6px;border-radius:99px;background:#263a51;overflow:hidden}.analysis-load>span i{display:block;height:100%;border-radius:inherit;background:#4cc2ff}.analysis-load>span i[data-status='high']{background:#f59e0b}.analysis-load>span i[data-status='critical']{background:#ef4444}.analysis-load>span i[data-status='low']{background:#64748b}.analysis-status{display:flex!important;align-items:center;justify-content:space-between;gap:7px}.analysis-status b{padding:4px 7px;border-radius:99px;background:#164e63;color:#a5f3fc;font-size:7px}.analysis-status[data-status='critical'] b{background:#7f1d1d;color:#fecaca}.analysis-status[data-status='high'] b{background:#713f12;color:#fde68a}.analysis-status[data-status='low'] b{background:#334155;color:#cbd5e1}.analysis-status em{color:#62c9f6;font-size:8px;font-style:normal}.variance-value strong{color:#6ee7b7}.variance-value[data-over='true'] strong{color:#fb7185}.task-performance{border-top:1px solid #293e58;background:#091523}.task-performance>header{display:flex;align-items:center;justify-content:space-between;padding:13px 18px}.task-performance>header span,.task-performance>header strong{display:block}.task-performance>header span{color:#4cc2ff;font-size:6px;letter-spacing:.14em}.task-performance>header strong{margin-top:3px;font-size:11px}.task-performance>header small,.task-performance>p{color:#627991;font-size:7px}.task-performance>p{margin:0;padding:18px;border-top:1px solid #22364d;text-align:center}.task-performance__table{overflow:auto}.task-performance__row{min-width:820px;display:grid;grid-template-columns:1fr 1.8fr .6fr .7fr .7fr .7fr;align-items:center;gap:12px;padding:10px 18px;border-top:1px solid #22364d;color:#c8d5e4;font-size:8px}.task-performance__row--head{background:#101e31;color:#637b96;font-size:7px}.task-performance__row span strong,.task-performance__row span small{display:block}.task-performance__row span small{margin-top:2px;color:#657c96;font-size:7px}.analysis-notes{display:flex;gap:12px;padding:12px 18px;border-top:1px solid #293e58;background:#0a1524;color:#687e97;font-size:7px;line-height:1.6}.analysis-notes strong{flex:0 0 auto;color:#8fa4ba}
.manage-crews-button{padding:8px 11px;border-color:#4cc2ff66;background:#4cc2ff12;color:#8bdcff;font-size:9px;white-space:nowrap}.crew-manager-modal{position:fixed;z-index:1100;inset:0;display:grid;place-items:center;padding:20px;background:#030914d9;backdrop-filter:blur(9px)}.crew-manager{width:min(1100px,100%);max-height:calc(100vh - 40px);display:flex;flex-direction:column;border:1px solid #385573;border-radius:15px;overflow:hidden;background:linear-gradient(145deg,#15243a,#0b1524);box-shadow:0 30px 90px #000c}.crew-manager>header{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 22px;border-bottom:1px solid #2c425c}.crew-manager>header span{color:#4cc2ff;font-size:8px;letter-spacing:.16em}.crew-manager>header h2{margin:4px 0;font-size:21px}.crew-manager>header p{margin:0;color:#7388a1;font-size:8px}.crew-manager>header>button{width:30px;height:30px;padding:0;border:0;color:#8598af;font-size:23px}.crew-manager-message{margin:0;padding:8px 22px;border-bottom:1px solid #263b54;background:#4cc2ff0c;color:#8edcff;font-size:8px}.crew-manager-body{min-height:520px;display:grid;grid-template-columns:300px minmax(0,1fr);overflow:hidden}.crew-directory{overflow:auto;padding:15px;border-right:1px solid #2b4059;background:#0a1422}.crew-directory__head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.crew-directory__head strong{font-size:10px}.crew-directory__head button{padding:6px 8px;border-color:#4cc2ff88;color:#8bdcff;font-size:8px}.crew-directory-card{width:100%;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:9px;margin-bottom:7px;padding:10px;border-color:#273b53;background:#0e1b2d;text-align:left}.crew-directory-card:hover,.crew-directory-card.active{border-color:#4cc2ff88;background:#12273c;color:inherit}.crew-directory-card.inactive{opacity:.58}.crew-directory-card__symbol{width:34px;height:34px;display:grid;place-items:center;border-radius:8px;background:#203e58;color:#76d5ff;font-weight:800}.crew-directory-card span small,.crew-directory-card span strong,.crew-directory-card span em{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.crew-directory-card span small{color:#67bfe6;font-size:6px}.crew-directory-card span strong{margin:3px 0;font-size:9px}.crew-directory-card span em{color:#687f99;font-size:7px;font-style:normal}.crew-directory-card>b{padding:3px 5px;border-radius:99px;background:#164e63;color:#a5f3fc;font-size:6px}.crew-directory__state{padding:28px 8px;color:#617790;font-size:8px;text-align:center}.crew-editor{overflow:auto;padding:20px 22px}.crew-editor__title{display:flex;align-items:center;justify-content:space-between}.crew-editor__title small{color:#4cc2ff;font-size:7px;letter-spacing:.15em}.crew-editor__title h3{margin:3px 0 0;font-size:17px}.crew-editor__title button{padding:5px 8px;border-color:#344b65;color:#8398af;font-size:7px}.crew-editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:17px}.crew-editor-grid label{color:#a7b7c9;font-size:8px}.crew-editor-grid label>span{display:block;margin-bottom:5px}.crew-editor-grid .wide{grid-column:1/-1}.crew-editor-grid input,.crew-editor-grid select,.crew-editor-grid textarea{width:100%;padding:8px 9px;border:1px solid #304760;border-radius:7px;outline:0;background:#081321;color:#e7eef8;font:inherit}.crew-editor-grid input:focus,.crew-editor-grid select:focus,.crew-editor-grid textarea:focus{border-color:#4cc2ff;box-shadow:0 0 0 3px #4cc2ff12}.crew-editor-grid textarea{resize:vertical}.member-picker{margin-top:17px;padding-top:15px;border-top:1px solid #293e57}.member-picker>header strong,.member-picker>header small{display:block}.member-picker>header strong{font-size:10px}.member-picker>header small{margin-top:3px;color:#697f98;font-size:7px}.member-picker__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}.member-picker__grid>article{display:grid;grid-template-columns:auto 30px minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px;border:1px solid #293d55;border-radius:8px;background:#091423}.member-picker__grid>article.selected{border-color:#4cc2ff88;background:#123048}.member-picker__grid>article>b{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:#203e58;color:#7dd7ff;font-size:9px}.member-picker__grid>article span strong,.member-picker__grid>article span small,.member-picker__grid>article span em,.member-picker__grid>article span i{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.member-picker__grid>article span strong{font-size:8px}.member-picker__grid>article span small{margin-top:2px;color:#71869e;font-size:6px}.member-picker__grid>article span em{margin-top:2px;color:#4fa9d0;font-size:6px;font-style:normal}.member-picker__grid>article span i{margin-top:3px;color:#748aa3;font-size:6px;font-style:normal}.member-picker__grid>article button{padding:4px 6px;border-color:#3a5874;color:#89d8ff;font-size:6px}.qualification-alert.expiring{color:#fbbf24!important}.qualification-alert.expired{color:#fb7185!important}.member-picker>p{color:#697f98;font-size:8px}.qualification-editor{margin-top:12px;padding:12px;border:1px solid #36516d;border-radius:9px;background:#081321}.qualification-editor>header{display:flex;align-items:flex-start;justify-content:space-between}.qualification-editor>header strong,.qualification-editor>header small{display:block}.qualification-editor>header small{margin-top:3px;color:#6e839b;font-size:7px}.qualification-editor>header button{padding:4px 7px;font-size:7px}.qualification-list{display:grid;gap:8px;margin-top:10px}.qualification-list>article{position:relative;display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;gap:7px;padding:10px 36px 10px 10px;border:1px solid #263c55;border-radius:8px;background:#0d1b2d}.qualification-list label{color:#8fa4ba;font-size:7px}.qualification-list label span{display:block;margin-bottom:4px}.qualification-list input{width:100%;padding:6px 7px;border:1px solid #304760;border-radius:6px;background:#07111e;color:#e7eef8;font:inherit}.qualification-list .wide{grid-column:1/-1}.qualification-list>article>button{position:absolute;right:8px;top:8px;width:22px;height:22px;padding:0;border-color:#6b2b37;color:#fb7185}.qualification-editor>p{color:#667c94;font-size:8px}.qualification-editor>footer{display:flex;align-items:center;gap:8px;margin-top:10px}.qualification-editor>footer span{flex:1}.qualification-editor>footer button{padding:6px 9px;font-size:7px}.qualification-editor>footer .save-qualifications{border-color:#4cc2ff;background:#4cc2ff;color:#07121e;font-weight:700}.qualification-editor>footer button:disabled{opacity:.45}.crew-editor>footer{display:flex;align-items:center;gap:14px;margin-top:18px;padding-top:14px;border-top:1px solid #293e57}.crew-editor>footer span{flex:1;color:#667c95;font-size:7px}.crew-editor>footer .save-crew{padding:8px 14px;border-color:#4cc2ff;background:#4cc2ff;color:#07121e;font-weight:700}.crew-editor>footer .save-crew:disabled{opacity:.45}.crew-editor-empty{display:grid;place-content:center;justify-items:center;color:#71869e;text-align:center}.crew-editor-empty>span{font-size:34px}.crew-editor-empty strong{margin-top:9px;color:#d9e5f2;font-size:13px}.crew-editor-empty p{margin:5px 0;font-size:8px}
.member-actions{display:flex!important;align-items:center;gap:4px}.availability-editor{border-color:#55734a}.availability-list{display:grid;gap:8px;margin-top:10px}.availability-list>article{position:relative;display:grid;grid-template-columns:1fr 1fr .8fr 1.4fr;gap:7px;padding:10px 36px 10px 10px;border:1px solid #2d4b3a;border-radius:8px;background:#0c1c19}.availability-list label{color:#9bb5a7;font-size:7px}.availability-list label span{display:block;margin-bottom:4px}.availability-list input,.availability-list select{width:100%;padding:6px 7px;border:1px solid #345747;border-radius:6px;background:#071511;color:#e7f4ec;font:inherit}.availability-list>article>button{position:absolute;right:8px;top:8px;width:22px;height:22px;padding:0;border-color:#6b2b37;color:#fb7185}
@media(max-width:900px){.crew-page__main{width:calc(100% - 28px)}.heading-row{align-items:stretch;flex-direction:column}.heading-tools{justify-content:space-between}.heading-tools .search{width:auto;flex:1}.metrics,.detail-metrics,.analysis-metrics,.labor-metrics{grid-template-columns:1fr 1fr}.labor-form{grid-template-columns:1fr 1fr}.labor-form .wide{grid-column:1/-1}.crew-card__body,.detail-grid{grid-template-columns:1fr}.members-panel{border-right:0;border-bottom:1px solid #24364e}.tasks,.detail-members{grid-template-columns:1fr}.project{grid-template-columns:4px minmax(0,1fr) auto 18px}.project__risk{display:none}.crew-manager-body{grid-template-columns:240px minmax(0,1fr)}}
@media(max-width:700px){.crew-manager{max-height:calc(100vh - 20px)}.crew-manager-body{display:block;overflow:auto}.crew-directory{max-height:220px;border-right:0;border-bottom:1px solid #2b4059}.crew-editor{overflow:visible}.crew-editor-grid,.member-picker__grid{grid-template-columns:1fr}.qualification-list>article,.availability-list>article{grid-template-columns:1fr 1fr}.crew-editor-empty{min-height:240px}}
@media(max-width:560px){.crew-page__top{padding:0 14px}.crew-page__top .brand small{display:none}.heading-tools{align-items:stretch;flex-direction:column}.heading-tools .search{width:100%}.view-tabs button{flex:1}.metrics,.analysis-metrics{grid-template-columns:1fr 1fr}.crew-card__counts{display:none}.detail-button{margin-left:auto}.task{grid-template-columns:1fr auto}.task__progress{grid-column:1/-1}.detail-task-table{overflow:auto}.detail-task-table__head,.detail-task-row{min-width:620px}.calendar-toolbar,.analysis-head{align-items:flex-start;flex-direction:column}.calendar-legend small{display:none}.analysis-notes{flex-direction:column}.manage-crews-button{width:100%}.crew-manager-modal{padding:10px}.crew-manager>header{padding:16px}.crew-editor{padding:16px}.crew-editor>footer{align-items:stretch;flex-direction:column}.crew-editor>footer .save-crew{width:100%}}
</style>
