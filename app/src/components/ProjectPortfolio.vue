<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LiveConnectionStatus } from '@/lib/liveEvents'
import {
  PACIFICPOWER_DATACENTER_TEMPLATE_ID,
  type ProjectStatus,
  type ProjectSummary,
} from '@/data/projects'
import LeafletProjectMap from '@/components/LeafletProjectMap.vue'
import AddressLocationPicker from '@/components/AddressLocationPicker.vue'
import ProjectMembersEditor from '@/components/ProjectMembersEditor.vue'
import { geocodeTaiwanAddress } from '@/lib/geocoding'
import { apiRequest } from '@/lib/apiClient'

const props = defineProps<{
  projects: ProjectSummary[]
  repositoryMessage?: string
  authEmail?: string
  permissions?: string[]
  liveRevision?: number
  liveStatus?: LiveConnectionStatus
}>()
const emit = defineEmits<{
  open: [project: ProjectSummary]
  update: [project: ProjectSummary]
  create: [project: ProjectSummary]
  archive: [project: ProjectSummary]
  accounts: []
  crews: [target?: 'overview' | 'calendar' | 'directory' | 'labor']
  openProjectFeature: [projectId: string, feature: 'daily']
  signOut: []
}>()

const view = ref<'map' | 'cards' | 'list'>('cards')
const query = ref('')
const status = ref<'全部' | ProjectStatus>('全部')
const selectedMapProject = ref<ProjectSummary | null>(props.projects[0] ?? null)
const editingDraft = ref<ProjectSummary | null>(null)
const imageError = ref('')
const isProcessingImage = ref(false)
const isCreating = ref(false)
const isLocating = ref(false)
const locationMessage = ref('')
const locationMessageKind = ref<'success' | 'error' | ''>('')
const notificationOpen = ref(false)
const notificationLoading = ref(false)
const notificationError = ref('')
const notificationFilter = ref('all')
const notificationSettingsOpen = ref(false)
const notificationSettingsSaving = ref(false)
type NotificationCategory = 'daily' | 'labor' | 'dispatch' | 'qualification'
type NotificationSeverity = 'critical' | 'warning' | 'info'
interface NotificationPreferences {
  enabledTypes: NotificationCategory[]
  minimumSeverity: NotificationSeverity
  realtimeEnabled: boolean
}
const notificationPreferences = ref<NotificationPreferences>({
  enabledTypes: ['daily', 'labor', 'dispatch', 'qualification'], minimumSeverity: 'warning', realtimeEnabled: true,
})
interface ActionNotification {
  id: string
  severity: NotificationSeverity
  category: NotificationCategory
  title: string
  detail: string
  target: 'calendar' | 'directory' | 'labor' | 'daily'
  projectId?: string
  read: boolean
}
const notifications = ref<ActionNotification[]>([])
const readNotificationKeys = ref(new Set<string>())
const enabledNotifications = computed(() => {
  const rank: Record<NotificationSeverity, number> = { info: 0, warning: 1, critical: 2 }
  const minimum = rank[notificationPreferences.value.minimumSeverity]
  return notifications.value.filter((item) => notificationPreferences.value.enabledTypes.includes(item.category) && rank[item.severity] >= minimum)
})
const unreadNotifications = computed(() => enabledNotifications.value.filter((item) => !item.read))
const visibleNotifications = computed(() => enabledNotifications.value.filter((item) => {
  if (notificationFilter.value === 'unread') return !item.read
  if (notificationFilter.value.startsWith('project:')) return item.projectId === notificationFilter.value.slice(8)
  return true
}))

async function loadNotifications() {
  if (notificationLoading.value) return
  notificationLoading.value = true
  notificationError.value = ''
  try {
    const [dispatchData, memberData, laborData, dailyData, readState, preferences] = await Promise.all([
      apiRequest<{
        dispatches: Array<{ id: string; projectId: string; projectCode: string; projectName: string; crewName: string }>
        warnings: Array<{ dispatchId: string; type: string; message: string }>
      }>('/projects/crew-dispatches'),
      can('labor.dispatch')
        ? apiRequest<{ members: Array<{ id: string; displayName: string; qualifications: Array<{ id: string; name: string; expiresOn: string | null; status: string }> }> }>('/projects/crews/member-catalog')
        : Promise.resolve({ members: [] }),
      can('labor.view')
        ? apiRequest<{ entries: Array<{ id: string; projectId: string; projectCode: string; taskCode: string; crewName: string; totalHours: number; status: string }> }>('/projects/labor-entries?status=pending')
        : Promise.resolve({ entries: [] }),
      can('progress.verify')
        ? Promise.all(props.projects.map(async (project) => ({
          project,
          data: await apiRequest<{ reports: Array<{ id: string; reportDate: string; crewName: string; reporterName: string | null; status: string }> }>(`/projects/${project.id}/daily-reports`),
        })))
        : Promise.resolve([]),
      apiRequest<{ readKeys: string[] }>('/notifications/read-state'),
      apiRequest<NotificationPreferences>('/notifications/preferences'),
    ])
    readNotificationKeys.value = new Set(readState.readKeys)
    notificationPreferences.value = preferences
    const dispatchNotifications = dispatchData.warnings.map((warning, index) => {
      const dispatch = dispatchData.dispatches.find((item) => item.id === warning.dispatchId)
      return {
        id: `dispatch-${warning.dispatchId}-${warning.type}-${index}`,
        category: 'dispatch' as const,
        severity: (warning.type === 'qualification' || warning.type === 'capacity' ? 'critical' : 'warning') as 'critical' | 'warning',
        title: warning.type === 'qualification' ? '派工資格不足' : warning.type === 'capacity' ? '可用人力不足' : warning.type === 'project_conflict' ? '跨專案調度衝突' : '工班尚未配置成員',
        detail: `${warning.message}${dispatch ? ` · ${dispatch.projectCode} ${dispatch.projectName}` : ''}`,
        target: 'calendar' as const,
        projectId: dispatch?.projectId,
      }
    })
    const qualificationNotifications = memberData.members.flatMap((member) => member.qualifications
      .filter((qualification) => qualification.status === 'expired' || qualification.status === 'expiring')
      .map((qualification) => ({
        id: `qualification-${member.id}-${qualification.id}`,
        category: 'qualification' as const,
        severity: (qualification.status === 'expired' ? 'critical' : 'warning') as 'critical' | 'warning',
        title: qualification.status === 'expired' ? '成員證照已到期' : '成員證照即將到期',
        detail: `${member.displayName} · ${qualification.name}${qualification.expiresOn ? ` · ${qualification.expiresOn}` : ''}`,
        target: 'directory' as const,
      projectId: undefined,
      })))
    const laborNotifications = laborData.entries.filter((entry) => entry.status === 'pending').map((entry) => ({
      id: `labor-${entry.id}`, category: 'labor' as const, severity: 'warning' as const, title: '人工時等待審核',
      detail: `${entry.projectCode} · ${entry.taskCode} · ${entry.crewName || '未指定工班'} · ${entry.totalHours} 人時`,
      target: 'labor' as const, projectId: entry.projectId,
    }))
    const dailyNotifications = dailyData.flatMap(({ project, data }) => data.reports
      .filter((report) => report.status === 'pending')
      .map((report) => ({
        id: `daily-${report.id}`, category: 'daily' as const, severity: 'warning' as const, title: '施工日報等待審核',
        detail: `${project.code} · ${report.reportDate} · ${report.crewName || report.reporterName || '現場回報'}`,
        target: 'daily' as const, projectId: project.id,
      })))
    notifications.value = [...dailyNotifications, ...laborNotifications, ...dispatchNotifications, ...qualificationNotifications]
      .map((item) => ({ ...item, read: readNotificationKeys.value.has(item.id) }))
  } catch (error) {
    notificationError.value = error instanceof Error ? error.message : '通知載入失敗'
  } finally {
    notificationLoading.value = false
  }
}

function toggleNotifications() {
  notificationOpen.value = !notificationOpen.value
  if (notificationOpen.value) void loadNotifications()
}

async function setNotificationRead(keys: string[], read = true) {
  if (!keys.length) return
  notifications.value = notifications.value.map((item) => keys.includes(item.id) ? { ...item, read } : item)
  if (read) keys.forEach((key) => readNotificationKeys.value.add(key))
  else keys.forEach((key) => readNotificationKeys.value.delete(key))
  try {
    await apiRequest('/notifications/read-state', { method: 'PUT', body: JSON.stringify({ keys, read }) })
  } catch (error) {
    notifications.value = notifications.value.map((item) => keys.includes(item.id) ? { ...item, read: !read } : item)
    if (read) keys.forEach((key) => readNotificationKeys.value.delete(key))
    else keys.forEach((key) => readNotificationKeys.value.add(key))
    notificationError.value = error instanceof Error ? `通知狀態儲存失敗：${error.message}` : '通知狀態儲存失敗'
  }
}

function markAllNotificationsRead() {
  void setNotificationRead(unreadNotifications.value.map((item) => item.id))
}

function toggleNotificationType(type: NotificationCategory) {
  const enabled = notificationPreferences.value.enabledTypes
  notificationPreferences.value.enabledTypes = enabled.includes(type)
    ? enabled.filter((item) => item !== type)
    : [...enabled, type]
}

async function saveNotificationPreferences() {
  notificationSettingsSaving.value = true
  notificationError.value = ''
  try {
    notificationPreferences.value = await apiRequest<NotificationPreferences>('/notifications/preferences', {
      method: 'PUT', body: JSON.stringify(notificationPreferences.value),
    })
    notificationSettingsOpen.value = false
  } catch (error) {
    notificationError.value = error instanceof Error ? `通知偏好儲存失敗：${error.message}` : '通知偏好儲存失敗'
  } finally {
    notificationSettingsSaving.value = false
  }
}

function openNotification(item: ActionNotification) {
  if (!item.read) void setNotificationRead([item.id])
  notificationOpen.value = false
  if (item.target === 'daily' && item.projectId) emit('openProjectFeature', item.projectId, 'daily')
  else emit('crews', item.target as 'calendar' | 'directory' | 'labor')
}

let liveNotificationTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.liveRevision, (revision, previous) => {
  if (!revision || revision === previous) return
  if (!notificationPreferences.value.realtimeEnabled) return
  if (liveNotificationTimer) clearTimeout(liveNotificationTimer)
  liveNotificationTimer = setTimeout(() => { void loadNotifications() }, 500)
})
onMounted(() => { void loadNotifications() })
onBeforeUnmount(() => { if (liveNotificationTimer) clearTimeout(liveNotificationTimer) })

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return props.projects.filter((project) => {
    const matchesStatus = status.value === '全部' || project.status === status.value
    const haystack = `${project.code} ${project.name} ${project.client} ${project.location}`.toLowerCase()
    return matchesStatus && (!keyword || haystack.includes(keyword))
  })
})

const activeCount = computed(() => props.projects.filter((p) => p.status === '施工中').length)
const attentionCount = computed(() => props.projects.filter((p) => p.risk !== '正常').length)
const averageProgress = computed(() => props.projects.length
  ? Math.round(props.projects.reduce((sum, p) => sum + p.progress, 0) / props.projects.length)
  : 0)
const totalBudget = computed(() => props.projects.reduce((sum, p) => sum + p.budget, 0))
const can = (permission: string) => !props.permissions || props.permissions.includes(permission)

const money = (value: number) => new Intl.NumberFormat('zh-TW', {
  style: 'currency', currency: 'TWD', notation: 'compact', maximumFractionDigits: 1,
}).format(value)

function selectMapProject(project: ProjectSummary) {
  selectedMapProject.value = project
}

function editProject(project: ProjectSummary) {
  if (!can('project.edit')) return
  isCreating.value = false
  editingDraft.value = {
    ...project,
    modelSource: project.modelSource ?? 'pacificpower-template',
    modelTemplateId: project.modelSource === 'project-model'
      ? undefined
      : (project.modelTemplateId ?? PACIFICPOWER_DATACENTER_TEMPLATE_ID),
  }
  imageError.value = ''
  locationMessage.value = ''
  locationMessageKind.value = ''
}

function createProject() {
  if (!can('project.create')) return
  isCreating.value = true
  const now = new Date()
  const end = new Date(now)
  end.setMonth(end.getMonth() + 3)
  editingDraft.value = {
    id: crypto.randomUUID(),
    code: `AMP-${now.getFullYear()}-NEW`,
    name: '', description: '', client: '', location: '', model: '250 MW 資料中心',
    modelSource: 'pacificpower-template', modelTemplateId: PACIFICPOWER_DATACENTER_TEMPLATE_ID,
    crew: '', status: '規劃中', progress: 0, scheduleDelta: 0, budget: 0, spent: 0,
    startDate: now.toISOString().slice(0, 10).replaceAll('-', '/'),
    endDate: end.toISOString().slice(0, 10).replaceAll('-', '/'),
    manager: '尚未指派', risk: '正常', updatedAt: '剛剛', accent: '#43c7ff', lat: 23.7, lng: 120.96,
  }
  imageError.value = ''
  locationMessage.value = ''
  locationMessageKind.value = ''
}

function closeEditor() {
  editingDraft.value = null
  isCreating.value = false
  imageError.value = ''
  locationMessage.value = ''
  locationMessageKind.value = ''
}

function setDraftCoordinates(lat: number, lng: number) {
  if (!editingDraft.value) return
  editingDraft.value.lat = Number(lat.toFixed(6))
  editingDraft.value.lng = Number(lng.toFixed(6))
  locationMessage.value = `位置已設定：${editingDraft.value.lat}, ${editingDraft.value.lng}`
  locationMessageKind.value = 'success'
}

async function locateAddress() {
  if (!editingDraft.value?.location.trim() || isLocating.value) return
  isLocating.value = true
  locationMessage.value = ''
  locationMessageKind.value = ''
  try {
    const result = await geocodeTaiwanAddress(editingDraft.value.location)
    if (!result) {
      locationMessage.value = '找不到這個地址，請補充縣市、行政區與門牌，或直接在地圖點選位置。'
      locationMessageKind.value = 'error'
      return
    }
    setDraftCoordinates(result.lat, result.lng)
    locationMessage.value = `已定位：${result.displayName}。請確認地圖位置是否正確。`
  } catch (error) {
    locationMessage.value = error instanceof Error ? error.message : '地址定位失敗，請稍後再試。'
    locationMessageKind.value = 'error'
  } finally {
    isLocating.value = false
  }
}

function saveProject() {
  if (!editingDraft.value) return
  const updated = {
    ...editingDraft.value,
    name: editingDraft.value.name.trim(),
    client: editingDraft.value.client.trim(),
    location: editingDraft.value.location.trim(),
    model: editingDraft.value.model.trim(),
    crew: editingDraft.value.crew.trim(),
    description: editingDraft.value.description.trim(),
    modelTemplateId: editingDraft.value.modelSource === 'pacificpower-template'
      ? PACIFICPOWER_DATACENTER_TEMPLATE_ID
      : undefined,
  }
  if (isCreating.value) emit('create', updated)
  else emit('update', updated)
  if (selectedMapProject.value?.id === updated.id) selectedMapProject.value = updated
  closeEditor()
}

function archiveEditingProject() {
  if (!editingDraft.value || isCreating.value) return
  if (!window.confirm(`確定要封存「${editingDraft.value.name}」嗎？資料可由後端管理功能還原。`)) return
  emit('archive', editingDraft.value)
  closeEditor()
}

function resizeCover(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('無法讀取圖片'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('圖片格式無法使用'))
      image.onload = () => {
        const maxWidth = 1200
        const maxHeight = 675
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) return reject(new Error('瀏覽器無法處理圖片'))
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.78))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

async function onCoverSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !editingDraft.value) return
  imageError.value = ''
  if (!file.type.startsWith('image/')) {
    imageError.value = '請選擇 JPG、PNG 或 WebP 圖片。'
    input.value = ''
    return
  }
  try {
    isProcessingImage.value = true
    editingDraft.value.coverImage = await resizeCover(file)
  } catch (error) {
    imageError.value = error instanceof Error ? error.message : '圖片處理失敗'
  } finally {
    isProcessingImage.value = false
    input.value = ''
  }
}

watch(filtered, (projects) => {
  if (!projects.length) selectedMapProject.value = null
  else if (!projects.some((project) => project.id === selectedMapProject.value?.id)) selectedMapProject.value = projects[0] ?? null
})

watch(() => props.projects, (projects) => {
  const selected = projects.find((project) => project.id === selectedMapProject.value?.id)
  selectedMapProject.value = selected ?? projects[0] ?? null
}, { deep: true })
</script>

<template>
  <section class="portfolio">
    <header class="portfolio__top">
      <div class="brand">
        <img class="pisg-brand-logo" src="/branding/pisg-logo.png" alt="PISG" />
        <div><strong>PISG DIGITAL TWIN</strong><small>工程數位管理平台</small></div>
      </div>
      <div class="portfolio__actions">
        <div class="notification-wrap">
          <button class="icon-button" :class="{ active: notificationOpen }" :title="props.liveStatus === 'connected' ? '通知 · 即時連線中' : '通知'" aria-label="通知" @click="toggleNotifications">●<i :class="`live--${props.liveStatus ?? 'stopped'}`" /><b v-if="unreadNotifications.length">{{ unreadNotifications.length > 99 ? '99+' : unreadNotifications.length }}</b></button>
          <section v-if="notificationOpen" class="notification-panel">
            <header><div><span>ACTION CENTER</span><h2>工程待辦中心</h2></div><div class="notification-head-actions"><button title="通知偏好設定" aria-label="通知偏好設定" @click="notificationSettingsOpen = !notificationSettingsOpen">⚙</button><button aria-label="關閉通知" @click="notificationOpen = false">×</button></div></header>
            <div class="notification-summary"><span><b>{{ unreadNotifications.length }}</b> 未讀</span><span><b>{{ enabledNotifications.filter(item => item.severity === 'critical').length }}</b> 立即處理</span><button :disabled="!unreadNotifications.length" @click="markAllNotificationsRead">全部標記已讀</button></div>
            <div class="notification-filters"><select v-model="notificationFilter"><option value="all">全部通知</option><option value="unread">僅顯示未讀</option><option v-for="project in props.projects" :key="project.id" :value="`project:${project.id}`">{{ project.code }} · {{ project.name }}</option></select><small>已讀狀態會同步至帳號</small></div>
            <section v-if="notificationSettingsOpen" class="notification-settings">
              <div><strong>接收類型</strong><small>選擇與目前職責相關的工程通知</small></div>
              <div class="notification-type-grid"><label v-for="option in ([['daily','施工日報'],['labor','人工時'],['dispatch','工班調度'],['qualification','人員資格']] as const)" :key="option[0]"><input type="checkbox" :checked="notificationPreferences.enabledTypes.includes(option[0])" @change="toggleNotificationType(option[0])" />{{ option[1] }}</label></div>
              <label class="notification-setting-row"><span><strong>最低嚴重程度</strong><small>低於設定的項目不顯示</small></span><select v-model="notificationPreferences.minimumSeverity"><option value="info">全部</option><option value="warning">需要注意以上</option><option value="critical">僅立即處理</option></select></label>
              <label class="notification-setting-row"><span><strong>即時更新</strong><small>資料異動時自動重新整理通知</small></span><input v-model="notificationPreferences.realtimeEnabled" type="checkbox" /></label>
              <div class="notification-setting-actions"><button @click="notificationSettingsOpen = false">取消</button><button class="save" :disabled="notificationSettingsSaving" @click="saveNotificationPreferences">{{ notificationSettingsSaving ? '儲存中…' : '儲存偏好' }}</button></div>
            </section>
            <div v-else-if="notificationLoading" class="notification-state">正在彙整日報、人工時、派工與資格狀態…</div>
            <div v-else-if="notificationError" class="notification-state error">{{ notificationError }}<button @click="loadNotifications">重新載入</button></div>
            <div v-else-if="visibleNotifications.length" class="notification-list">
              <button v-for="item in visibleNotifications" :key="item.id" :class="[`severity--${item.severity}`, { read: item.read }]" @click="openNotification(item)">
                <i>{{ item.severity === 'critical' ? '!' : '⚠' }}</i><span><strong>{{ item.title }}<em v-if="!item.read">未讀</em></strong><small>{{ item.detail }}</small></span><b>›</b>
              </button>
            </div>
            <div v-else class="notification-state success"><strong>{{ notifications.length ? '此篩選條件沒有通知' : '目前沒有待處理事項' }}</strong><span>{{ notifications.length ? '可切換為「全部通知」查看其他項目。' : '日報、人工時、調度及資格狀態皆正常。' }}</span></div>
            <footer><button @click="notificationOpen = false; emit('crews', 'labor')">人工時審核</button><button @click="notificationOpen = false; emit('crews', 'calendar')">調度行事曆 →</button></footer>
          </section>
        </div>
        <button v-if="can('account.view')" class="account-admin-button" title="帳號與權限管理" @click="emit('accounts')">帳號權限</button>
        <div class="user">
          <span>{{ authEmail ? authEmail.slice(0, 1).toUpperCase() : '林' }}</span>
          <div><strong>{{ authEmail || '林志宏' }}</strong><small>{{ authEmail ? '已登入' : '專案管理部' }}</small></div>
        </div>
        <button v-if="authEmail" class="account-admin-button" title="登出" @click="emit('signOut')">登出</button>
      </div>
    </header>

    <main class="portfolio__main">
      <div class="heading-row">
        <div>
          <p class="eyebrow">PROJECT PORTFOLIO</p>
          <h1>專案總覽</h1>
          <p>跨專案掌握施工進度、成本與現場風險</p>
        </div>
        <div class="heading-actions">
          <span class="repository-state">{{ repositoryMessage }}</span>
          <button v-if="can('project.view')" class="crew-button" @click="emit('crews')"><span>♟</span> 工班組織</button>
          <button v-if="can('project.create')" class="primary-button" @click="createProject"><span>＋</span> 建立新專案</button>
        </div>
      </div>

      <div class="metrics">
        <article><span>進行中專案</span><strong>{{ activeCount }}</strong><small>共 {{ projects.length }} 個專案</small></article>
        <article><span>平均執行進度</span><strong>{{ averageProgress }}%</strong><small>依 WBS 權重計算</small></article>
        <article><span>專案總預算</span><strong>{{ can('report.contract_amount.view') ? money(totalBudget) : '—' }}</strong><small>{{ can('report.contract_amount.view') ? '本期專案組合' : '無查看權限' }}</small></article>
        <article class="metric--alert"><span>需要關注</span><strong>{{ attentionCount }}</strong><small>工期或現場風險</small></article>
      </div>

      <div class="toolbar">
        <label class="search"><span>⌕</span><input v-model="query" placeholder="搜尋專案名稱、編號、業主或地點" /></label>
        <div class="status-tabs">
          <button v-for="item in (['全部', '施工中', '規劃中', '待驗收', '已完成'] as const)" :key="item" :class="{ active: status === item }" @click="status = item">{{ item }}</button>
        </div>
        <div class="view-switch" aria-label="顯示方式">
          <button :class="{ active: view === 'map' }" title="台灣地圖" @click="view = 'map'"><span class="view-icon">⌖</span> 地圖</button>
          <button :class="{ active: view === 'cards' }" title="卡片檢視" @click="view = 'cards'"><span class="view-icon">▦</span> 卡片</button>
          <button :class="{ active: view === 'list' }" title="列表檢視" @click="view = 'list'"><span class="view-icon">☷</span> 列表</button>
        </div>
      </div>

      <div v-if="filtered.length && selectedMapProject && view === 'map'" class="map-view">
        <section class="taiwan-map" aria-label="台灣專案分布地圖">
          <LeafletProjectMap :projects="filtered" :selected-id="selectedMapProject.id" @select="selectMapProject" />
          <div class="map-label"><span>TAIWAN PROJECT MAP</span><strong>{{ filtered.length }} 個專案據點</strong></div>
          <div class="map-legend"><span><i class="legend--active" />施工中</span><span><i class="legend--plan" />規劃／驗收</span><span><i class="legend--risk" />高風險</span></div>
        </section>

        <aside class="map-detail">
          <div class="map-detail__head">
            <div><span>{{ selectedMapProject.code }}</span><h2>{{ selectedMapProject.name }}</h2><p>{{ selectedMapProject.client }} · {{ selectedMapProject.location }}</p></div>
            <div class="map-detail__actions"><b class="status" :data-status="selectedMapProject.status">{{ selectedMapProject.status }}</b><button v-if="can('project.edit')" title="編輯專案設定" @click="editProject(selectedMapProject)">設定</button></div>
          </div>
          <p class="map-detail__description">{{ selectedMapProject.description || '尚未填寫專案描述。' }}</p>
          <div class="map-detail__progress"><div><span>總體進度</span><strong>{{ selectedMapProject.progress }}%</strong></div><div class="progress"><i :style="{ width: `${selectedMapProject.progress}%`, background: selectedMapProject.accent }" /></div></div>
          <div class="map-detail__metrics">
            <div><span>園區／設備規模</span><strong>{{ selectedMapProject.model }}</strong></div><div><span>負責工班</span><strong>{{ selectedMapProject.crew }}</strong></div>
            <div><span>承攬金額</span><strong>{{ can('report.contract_amount.view') ? money(selectedMapProject.budget) : '無查看權限' }}</strong></div><div><span>成本執行率</span><strong>{{ can('report.contract_amount.view') ? `${(selectedMapProject.budget > 0 ? Math.round(selectedMapProject.spent / selectedMapProject.budget * 100) : 0)}%` : '—' }}</strong></div>
            <div><span>專案經理</span><strong>{{ selectedMapProject.manager }}</strong></div><div><span>工期狀態</span><strong :class="{ danger: selectedMapProject.scheduleDelta > 3 }">{{ selectedMapProject.scheduleDelta > 0 ? `落後 ${selectedMapProject.scheduleDelta} 天` : selectedMapProject.scheduleDelta < 0 ? `超前 ${Math.abs(selectedMapProject.scheduleDelta)} 天` : '符合計畫' }}</strong></div>
          </div>
          <div class="map-detail__risk" :data-risk="selectedMapProject.risk"><span>風險狀態</span><strong>● {{ selectedMapProject.risk }}</strong><small>最後更新：{{ selectedMapProject.updatedAt }}</small></div>
          <button class="open-project" @click="emit('open', selectedMapProject)">進入專案工作區 <span>→</span></button>
        </aside>
      </div>

      <div v-else-if="filtered.length && view === 'cards'" class="project-grid">
        <article v-for="project in filtered" :key="project.id" class="project-card" tabindex="0" @click="emit('open', project)" @keydown.enter="emit('open', project)">
          <div class="project-card__visual" :style="{ '--project-accent': project.accent }">
            <img v-if="project.coverImage" class="project-card__cover" :src="project.coverImage" :alt="`${project.name} 封面`" />
            <template v-else><div class="project-card__grid" /><div class="project-card__machine"><i /><i /><i /></div></template>
            <span class="status" :data-status="project.status">{{ project.status }}</span>
            <span class="project-card__code">{{ project.code }}</span>
          </div>
          <div class="project-card__body">
            <div class="project-title"><div><h2>{{ project.name }}</h2><p>{{ project.client }} · {{ project.location }}</p></div><div class="project-title__actions"><button v-if="can('project.edit')" title="編輯專案設定" aria-label="編輯專案設定" @click.stop="editProject(project)">⚙</button><button aria-label="開啟專案">›</button></div></div>
            <p class="project-description">{{ project.description || '尚未填寫專案描述。' }}</p>
            <div class="progress-row"><span>總體進度</span><strong>{{ project.progress }}%</strong></div>
            <div class="progress"><i :style="{ width: `${project.progress}%`, background: project.accent }" /></div>
            <dl>
              <div><dt>園區／設備規模</dt><dd>{{ project.model }}</dd></div>
              <div><dt>負責工班</dt><dd>{{ project.crew }}</dd></div>
              <div><dt>承攬金額</dt><dd>{{ can('report.contract_amount.view') ? money(project.budget) : '無查看權限' }}</dd></div>
              <div><dt>預定完工</dt><dd>{{ project.endDate }}</dd></div>
            </dl>
          </div>
          <footer><span class="risk" :data-risk="project.risk">● {{ project.risk }}</span><span>更新於 {{ project.updatedAt }}</span></footer>
        </article>
      </div>

      <div v-else-if="filtered.length" class="project-list">
        <div class="project-list__head"><span>專案</span><span>狀態</span><span>總體進度</span><span>工期</span><span>預算／已執行</span><span>負責人</span><span /></div>
        <div v-for="project in filtered" :key="project.id" class="project-row" role="button" tabindex="0" @click="emit('open', project)" @keydown.enter="emit('open', project)">
          <span class="project-row__name"><i :style="{ background: project.accent }" /><span><strong>{{ project.name }}</strong><small>{{ project.code }} · {{ project.client }}</small></span></span>
          <span><b class="status" :data-status="project.status">{{ project.status }}</b></span>
          <span class="row-progress"><i><b :style="{ width: `${project.progress}%`, background: project.accent }" /></i><strong>{{ project.progress }}%</strong></span>
          <span :class="{ danger: project.scheduleDelta > 3 }">{{ project.scheduleDelta > 0 ? `落後 ${project.scheduleDelta} 天` : project.scheduleDelta < 0 ? `超前 ${Math.abs(project.scheduleDelta)} 天` : '符合計畫' }}</span>
          <span>{{ can('report.contract_amount.view') ? money(project.budget) : '無查看權限' }}<small v-if="can('report.contract_amount.view')">已執行 {{ (project.budget > 0 ? Math.round(project.spent / project.budget * 100) : 0) }}%</small></span>
          <span>{{ project.manager }}<small>{{ project.crew }}</small></span>
          <button v-if="can('project.edit')" class="row-edit" title="編輯專案設定" aria-label="編輯專案設定" @click.stop="editProject(project)">⚙</button>
        </div>
      </div>

      <div v-else class="empty-state">
        <template v-if="projects.length === 0">
          <strong>正式資料庫尚無專案</strong>
          <p>建立第一個 PacificPower 專案後，即可設定專屬 WBS、3D 與版本流程。</p>
          <button v-if="can('project.create')" class="primary-button" @click="createProject"><span>＋</span> 建立第一個專案</button>
        </template>
        <template v-else>
          <strong>找不到符合條件的專案</strong>
          <p>請調整搜尋關鍵字或專案狀態。</p>
        </template>
      </div>
    </main>

    <div v-if="editingDraft" class="modal-backdrop" @click.self="closeEditor">
      <form class="project-editor" @submit.prevent="saveProject">
        <div class="project-editor__head"><div><span>{{ isCreating ? 'NEW PROJECT' : 'PROJECT SETTINGS' }}</span><h2>{{ isCreating ? '建立新專案' : '專案設定' }}</h2></div><button type="button" aria-label="關閉" @click="closeEditor">×</button></div>
        <div class="cover-editor">
          <div class="cover-editor__preview" :style="editingDraft.coverImage ? { backgroundImage: `url(${editingDraft.coverImage})` } : { '--preview-accent': editingDraft.accent }"><span v-if="!editingDraft.coverImage">PROJECT IMAGE</span></div>
          <div><strong>專案卡片封面</strong><p>圖片會自動縮小並上傳至 private Storage；尚未設定 Storage 時會暫存於瀏覽器。</p><label class="cover-upload"><input type="file" accept="image/jpeg,image/png,image/webp" @change="onCoverSelected" />{{ isProcessingImage ? '處理中…' : '選擇圖片' }}</label><button v-if="editingDraft.coverImage" type="button" class="cover-remove" @click="editingDraft.coverImage = undefined">移除圖片</button><small v-if="imageError" class="field-error">{{ imageError }}</small></div>
        </div>
        <section class="model-source-editor">
          <div class="model-source-editor__head">
            <div><span>3D MODEL SOURCE</span><strong>專案初始 3D</strong></div>
            <small>可先使用平台目前的 PacificPower 資料中心模型，之後再發布專案專屬版本。</small>
          </div>
          <div class="model-source-options">
            <label :class="{ active: editingDraft.modelSource === 'pacificpower-template' }">
              <input v-model="editingDraft.modelSource" type="radio" value="pacificpower-template" />
              <i class="model-source-options__icon">A</i>
              <span><strong>PacificPower 資料中心 3D</strong><small>套用目前 250 MW 園區、17 個施工分組與 WBS 對應</small></span>
              <b>建議</b>
            </label>
            <label :class="{ active: editingDraft.modelSource === 'project-model' }">
              <input v-model="editingDraft.modelSource" type="radio" value="project-model" />
              <i class="model-source-options__icon">3D</i>
              <span><strong>使用專案專屬模型</strong><small>保留空白模型空間，進入專案後上傳並發布 GLB 版本</small></span>
            </label>
          </div>
          <p v-if="editingDraft.modelSource === 'pacificpower-template'" class="model-source-editor__notice">儲存後，系統會建立此專案自己的模型版本，並帶入 資料中心 3D 的 17 個施工分組；GLB 資產可共用，但版本與 WBS 對應彼此獨立。</p>
        </section>
        <div class="editor-grid">
          <label><span>專案編號</span><input v-model.trim="editingDraft.code" required maxlength="40" pattern="[A-Z0-9][A-Z0-9_-]{2,39}" /></label>
          <label><span>專案名稱</span><input v-model="editingDraft.name" required maxlength="80" /></label>
          <label><span>業主</span><input v-model="editingDraft.client" required maxlength="80" /></label>
          <div class="editor-grid__wide address-editor">
            <label><span>施工地址</span><span class="address-editor__input"><input v-model="editingDraft.location" required maxlength="200" autocomplete="street-address" placeholder="例如：台北市內湖區瑞光路 123 號" @keydown.enter.prevent="locateAddress" /><button type="button" :disabled="isLocating || !editingDraft.location.trim()" @click="locateAddress">{{ isLocating ? '定位中…' : '從地址定位' }}</button></span></label>
            <AddressLocationPicker :lat="editingDraft.lat" :lng="editingDraft.lng" @change="setDraftCoordinates" />
            <small :class="['location-message', locationMessageKind]">{{ locationMessage || '可拖曳標記或點擊地圖微調；地址查詢會送至 OpenStreetMap Nominatim。' }}</small>
          </div>
          <label><span>承攬金額（NT$）</span><input v-model.number="editingDraft.budget" type="number" min="0" step="10000" required /></label>
          <label><span>工班</span><input v-model="editingDraft.crew" required maxlength="60" /></label>
          <label class="editor-grid__wide"><span>園區／設備規模</span><input v-model="editingDraft.model" required maxlength="80" /></label>
          <label class="editor-grid__wide"><span>專案描述</span><textarea v-model="editingDraft.description" rows="4" maxlength="300" placeholder="說明專案目標、工作範圍或重要施工條件…" /></label>
        </div>
        <div class="project-editor__count">{{ editingDraft.description.length }} / 300</div>
        <ProjectMembersEditor
          v-if="!isCreating && can('project.member.manage')"
          :project-id="editingDraft.id"
        />
        <div class="project-editor__actions"><button v-if="!isCreating && can('project.archive')" type="button" class="archive-button" @click="archiveEditingProject">封存專案</button><span class="editor-action-spacer" /><button type="button" @click="closeEditor">取消</button><button class="save-button" type="submit">{{ isCreating ? '建立專案' : '儲存變更' }}</button></div>
      </form>
    </div>

  </section>
</template>

<style scoped>
.portfolio {
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
  -webkit-overflow-scrolling: touch;
  background: radial-gradient(circle at 82% 0%, #343e43 0, transparent 34%), #1d2225;
  color: #e8eef7;
}
.portfolio__top { position: sticky; z-index: 10; top: 0; height: 70px; padding: 0 clamp(24px, 4vw, 64px); display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #3d4950; background: #1e2428e8; backdrop-filter: blur(18px); }
.brand, .portfolio__actions, .user { display: flex; align-items: center; }
.brand { gap: 12px; letter-spacing: .08em; }.brand__mark { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid #ffad7a66; border-radius: 10px; background: linear-gradient(145deg, #ffad7a33, #ffad7a08); color: #ffad7a; font-size: 20px; }.brand strong,.brand small,.user strong,.user small { display:block; }.brand small,.user small { color:#98a7af; font-size:10px; font-weight:400; letter-spacing:.04em; }
.portfolio__actions { gap: 18px; }.icon-button { border: 0; color: #ffad7a; }.user { gap: 9px; }.user>span { width:32px;height:32px;display:grid;place-items:center;border-radius:50%;background:#3c474d;color:#ffad7a; }.user strong{font-size:12px}
.notification-wrap{position:relative}.notification-wrap>.icon-button{position:relative;width:34px;height:34px;padding:0;border-radius:8px;background:#282f33}.notification-wrap>.icon-button.active{background:#364147}.notification-wrap>.icon-button>b{position:absolute;right:-6px;top:-6px;min-width:17px;height:17px;display:grid;place-items:center;padding:0 4px;border:2px solid #1e2428;border-radius:99px;background:#ef4444;color:#fff;font-size:7px}.notification-panel{position:absolute;z-index:1200;right:0;top:45px;width:min(420px,calc(100vw - 28px));max-height:min(650px,calc(100vh - 90px));display:flex;flex-direction:column;border:1px solid #53626b;border-radius:13px;overflow:hidden;background:linear-gradient(145deg,#2c3439,#202629);box-shadow:0 24px 70px #000c}.notification-panel>header{display:flex;align-items:flex-start;justify-content:space-between;padding:17px 18px;border-bottom:1px solid #435057}.notification-panel>header span{color:#ffad7a;font-size:7px;letter-spacing:.16em}.notification-panel>header h2{margin:3px 0 0;font-size:17px}.notification-panel>header>button{width:26px;height:26px;padding:0;border:0;color:#98a7b0;font-size:20px}.notification-summary{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #424e55;background:#1e2428}.notification-summary span{padding:9px 16px;color:#90a0a9;font-size:8px}.notification-summary span+span{border-left:1px solid #424e55}.notification-summary b{margin-right:4px;color:#fb7185;font-size:13px}.notification-summary span+span b{color:#fbbf24}.notification-list{overflow:auto;padding:8px}.notification-list>button{width:100%;display:grid;grid-template-columns:25px minmax(0,1fr) 12px;align-items:center;gap:9px;padding:10px;border:0;border-bottom:1px solid #3c474e;border-radius:7px;background:transparent;text-align:left}.notification-list>button:hover{background:#ffffff08;color:inherit}.notification-list>button>i{width:24px;height:24px;display:grid;place-items:center;border-radius:7px;background:#f59e0b18;color:#fbbf24;font-size:10px;font-style:normal;font-weight:800}.notification-list>button.severity--critical>i{background:#ef44441a;color:#fb7185}.notification-list strong,.notification-list small{display:block}.notification-list strong{font-size:9px}.notification-list small{margin-top:3px;color:#8597a1;font-size:7px;line-height:1.5}.notification-list>button>b{color:#ffad7a}.notification-state{min-height:170px;display:grid;place-content:center;justify-items:center;gap:5px;padding:24px;color:#8597a1;font-size:9px;text-align:center}.notification-state.error{color:#fb7185}.notification-state.error button{margin-top:6px}.notification-state.success strong{color:#a7f3d0}.notification-state.success span{color:#8597a1}.notification-panel>footer{padding:10px 14px;border-top:1px solid #424e55;background:#1e2428;text-align:right}.notification-panel>footer button{border:0;color:#ffad7a;font-size:8px}
.notification-wrap>.icon-button>i{position:absolute;left:5px;bottom:5px;width:6px;height:6px;border-radius:50%;background:#738793;box-shadow:0 0 0 2px #282f33;font-style:normal;transition:background .2s,box-shadow .2s}.notification-wrap>.icon-button>i.live--connected{background:#22c55e;box-shadow:0 0 0 2px #282f33,0 0 8px #22c55e}.notification-wrap>.icon-button>i.live--connecting,.notification-wrap>.icon-button>i.live--reconnecting{background:#f59e0b;box-shadow:0 0 0 2px #282f33,0 0 6px #f59e0b}
.notification-summary{grid-template-columns:1fr 1fr auto;align-items:center}.notification-summary>button{margin-right:10px;border:0;color:#ffad7a;font-size:8px}.notification-summary>button:disabled{opacity:.4}.notification-filters{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid #424e55}.notification-filters select{min-width:0;max-width:220px;height:29px;padding:0 7px;border:1px solid #49575f;border-radius:6px;color:#bdd0e5;background:#262d31;font-size:8px}.notification-filters small{color:#768a96;font-size:7px}.notification-list>button.read{opacity:.58}.notification-list strong em{display:inline-block;margin-left:6px;padding:2px 5px;border-radius:99px;color:#ffad7a;background:#47545c;font-size:6px;font-style:normal}
.notification-head-actions{display:flex;gap:3px}.notification-head-actions button{width:26px;height:26px;padding:0;border:0;color:#98a7b0;font-size:15px}.notification-head-actions button:last-child{font-size:20px}.notification-settings{overflow:auto;padding:14px 16px;background:#22292d}.notification-settings>div:first-child strong,.notification-settings>div:first-child small{display:block}.notification-settings>div:first-child small,.notification-setting-row small{margin-top:3px;color:#8496a0;font-size:7px}.notification-type-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:12px 0}.notification-type-grid label{display:flex;align-items:center;gap:7px;padding:8px;border:1px solid #45525a;border-radius:7px;color:#b8c8da;font-size:8px}.notification-type-grid input,.notification-setting-row>input{accent-color:#ffad7a}.notification-setting-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 2px;border-top:1px solid #3a454b}.notification-setting-row span strong,.notification-setting-row span small{display:block}.notification-setting-row select{height:30px;padding:0 7px;border:1px solid #49575f;border-radius:6px;color:#bdd0e5;background:#262d31;font-size:8px}.notification-setting-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:10px}.notification-setting-actions button{font-size:8px}.notification-setting-actions .save{border-color:#ffad7a;background:#ffad7a;color:#1a1f22}
.account-admin-button{padding:6px 10px;border-color:#516069;color:#ffad7a;font-size:10px}
.portfolio__main { width: min(1500px, calc(100% - 48px)); margin: 0 auto; padding: 42px 0 max(84px, env(safe-area-inset-bottom)); }
.heading-row { display:flex; justify-content:space-between; align-items:flex-end; gap:24px; }.eyebrow { margin:0 0 4px!important; color:#ffad7a!important; font-size:11px; letter-spacing:.18em; }.heading-row h1 { margin:0; font-size:32px; line-height:1.25; }.heading-row p { margin:8px 0 0;color:#a7b4bb;font-size:14px; }.heading-actions{display:flex;gap:9px;align-items:center}.repository-state{color:#95a5ae;font-size:10px;white-space:nowrap}.crew-button{padding:10px 14px;border-color:#5a6b74;background:#2a3237;color:#ffad7a;font-weight:600}.crew-button:hover{border-color:#ffad7a;background:#364046;color:#ffad7a}.primary-button { padding:10px 16px;border:0;background:var(--accent);color:#1a1f22;font-weight:700;box-shadow:0 8px 26px #ffad7a22; }.primary-button:hover { color:#1a1f22;background:#ffad7a; }
.metrics { display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0; }.metrics article { position:relative;padding:18px 20px;border:1px solid #3d4950;border-radius:12px;background:linear-gradient(140deg,#2b3338,#242b2f);overflow:hidden; }.metrics article::after { content:'';position:absolute;right:-22px;bottom:-28px;width:90px;height:90px;border-radius:50%;background:#ffad7a0b; }.metrics span,.metrics small { display:block;color:#a6b3ba; }.metrics strong { display:block;margin:6px 0 1px;font-size:25px;color:#fff; }.metrics small{font-size:10px}.metrics .metric--alert strong{color:#fbbf24}
.toolbar { display:flex;align-items:center;gap:14px;margin-bottom:18px; }.search { flex:1;max-width:420px;height:40px;display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid #404d54;border-radius:8px;background:#262d31;color:#96a6af; }.search input { width:100%;border:0;outline:0;background:transparent;color:#dbe4f0;font:inherit; }.status-tabs { display:flex;gap:3px;margin-left:auto;padding:3px;border:1px solid #3d4950;border-radius:8px;background:#242a2e; }.status-tabs button,.view-switch button { border:0; }.status-tabs button.active,.view-switch button.active { background:#424e55;color:#ffad7a; }.view-switch{display:flex;padding:3px;border:1px solid #3d4950;border-radius:8px;background:#242a2e}.view-switch button{display:flex;align-items:center;gap:5px;padding:5px 10px;white-space:nowrap}.view-icon{font-size:14px}
.map-view{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(340px,.8fr);min-height:520px;border:1px solid #3d4950;border-radius:14px;background:#22292d;overflow:hidden}.taiwan-map{position:relative;min-height:520px;overflow:hidden;background:#21272b}.map-label{position:absolute;z-index:500;left:18px;top:18px;padding:9px 12px;border:1px solid #516069;border-radius:8px;background:#1e2427dc;box-shadow:0 8px 24px #0008;pointer-events:none}.map-label span,.map-label strong{display:block}.map-label span{color:#ffad7a;font-size:8px;letter-spacing:.18em}.map-label strong{margin-top:4px;font-size:12px}.map-legend{position:absolute;z-index:500;left:18px;bottom:18px;display:flex;gap:12px;padding:7px 10px;border:1px solid #4c5a62;border-radius:7px;background:#1e2427dc;color:#b0bcc3;font-size:8px;box-shadow:0 6px 18px #0008;pointer-events:none}.map-legend span{display:flex;align-items:center;gap:5px}.map-legend i{width:7px;height:7px;border-radius:50%}.legend--active{background:#ffad7a}.legend--plan{background:#a78bfa}.legend--risk{background:#fb7185}
.map-detail{display:flex;flex-direction:column;padding:26px;border-left:1px solid #3d4950;background:linear-gradient(155deg,#2b3438,#252b2f)}.map-detail__head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.map-detail__head>div:first-child>span{color:#ffad7a;font-size:9px;letter-spacing:.12em}.map-detail__head h2{margin:5px 0 4px;font-size:20px;line-height:1.35}.map-detail__head p{margin:0;color:#9cabb3;font-size:11px}.map-detail__actions{display:flex;align-items:center;gap:7px}.map-detail__actions button{padding:3px 8px;border-color:#51616a;color:#ffad7a;font-size:9px}.map-detail__description{min-height:36px;margin:14px 0 0;padding-left:10px;border-left:2px solid #ffad7a66;color:#bbc5ca;font-size:11px;line-height:1.65}.map-detail__progress{margin-top:18px;padding:15px 16px;border:1px solid #414e55;border-radius:10px;background:#21282b}.map-detail__progress>div:first-child{display:flex;align-items:flex-end;justify-content:space-between;color:#99a8b1}.map-detail__progress strong{color:#fff;font-size:26px;line-height:1}.map-detail__progress .progress{margin-bottom:0}.map-detail__metrics{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:18px;border:1px solid #3d4950;border-radius:10px;overflow:hidden;background:#3d4950}.map-detail__metrics div{padding:13px;background:#262d32}.map-detail__metrics span,.map-detail__metrics strong{display:block}.map-detail__metrics span{color:#8597a1;font-size:9px}.map-detail__metrics strong{margin-top:3px;font-size:11px}.map-detail__risk{display:grid;grid-template-columns:1fr auto;align-items:center;margin-top:16px;padding:11px 13px;border-radius:8px;background:#2c353a;color:#92a2ab;font-size:9px}.map-detail__risk strong{color:#6ee7b7}.map-detail__risk[data-risk='注意'] strong{color:#fbbf24}.map-detail__risk[data-risk='高風險'] strong{color:#fb7185}.map-detail__risk small{grid-column:1/-1;margin-top:3px}.open-project{margin-top:auto;padding:11px 14px;border-color:#ffad7a88;background:#ffad7a12;color:#ffad7a;font-weight:700}.open-project span{float:right;font-size:17px}.open-project:hover{background:#ffad7a;color:#1a1f22}
.project-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px; }.project-card { border:1px solid #3d4950;border-radius:13px;background:#252b2f;overflow:hidden;cursor:pointer;transition:transform .18s,border-color .18s,box-shadow .18s;outline:0; }.project-card:hover,.project-card:focus-visible { transform:translateY(-3px);border-color:#ffad7a88;box-shadow:0 16px 36px #0005; }.project-card__visual { position:relative;height:142px;overflow:hidden;background:linear-gradient(135deg,#272e32,#2f373c); }.project-card__visual::after{content:'';position:absolute;inset:auto 0 0;height:65%;background:linear-gradient(transparent,#252b2fdd)}.project-card__cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .35s ease}.project-card:hover .project-card__cover{transform:scale(1.04)}.project-card__grid{position:absolute;inset:0;opacity:.18;background-image:linear-gradient(#ffad7a44 1px,transparent 1px),linear-gradient(90deg,#ffad7a44 1px,transparent 1px);background-size:22px 22px;transform:perspective(200px) rotateX(56deg) scale(1.4);transform-origin:center bottom}.project-card__machine{position:absolute;left:50%;top:55%;width:126px;height:42px;transform:translate(-50%,-50%);border:1px solid var(--project-accent);background:color-mix(in srgb,var(--project-accent) 12%,transparent);box-shadow:0 0 34px color-mix(in srgb,var(--project-accent) 20%,transparent)}.project-card__machine i{position:absolute;bottom:100%;width:20px;height:22px;border:1px solid var(--project-accent);border-bottom:0}.project-card__machine i:nth-child(1){left:14px}.project-card__machine i:nth-child(2){left:52px;height:32px}.project-card__machine i:nth-child(3){right:14px;height:26px}.project-card__code{position:absolute;z-index:2;left:16px;bottom:10px;color:#d7e5f3;font-size:10px;letter-spacing:.08em;text-shadow:0 2px 7px #000}.status{display:inline-flex;width:max-content;padding:3px 8px;border-radius:999px;background:#45525a;color:#cbd5e1;font-size:10px;font-weight:600}.project-card__visual>.status{position:absolute;z-index:3;right:12px;top:12px}.status[data-status='施工中']{background:#47545c;color:#ffad7a}.status[data-status='規劃中']{background:#713f12;color:#fde68a}.status[data-status='待驗收']{background:#4c1d95;color:#ddd6fe}.status[data-status='已完成']{background:#14532d;color:#bbf7d0}
.project-card__body{padding:16px}.project-title{display:flex;gap:10px;justify-content:space-between}.project-title h2{margin:0;font-size:15px}.project-title p{margin:3px 0 0;color:#98a7af;font-size:11px}.project-title__actions{display:flex;gap:5px}.project-title button{width:28px;height:28px;padding:0;border-radius:50%;font-size:17px}.project-description{display:-webkit-box;min-height:34px;margin:10px 0 0;overflow:hidden;color:#a5b2ba;font-size:10px;line-height:1.65;-webkit-box-orient:vertical;-webkit-line-clamp:2}.progress-row{display:flex;justify-content:space-between;margin-top:14px;color:#a7b4bb;font-size:11px}.progress-row strong{color:#ffad7a}.progress{height:5px;margin:6px 0 14px;border-radius:99px;background:#39444a;overflow:hidden}.progress i{display:block;height:100%;border-radius:inherit}.project-card dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0}.project-card dl div{min-width:0}.project-card dt{color:#8395a0;font-size:9px}.project-card dd{margin:1px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}.danger{color:#fb7185!important}.project-card footer{display:flex;justify-content:space-between;padding:9px 16px;border-top:1px solid #394349;color:#8496a1;font-size:9px}.risk[data-risk='正常']{color:#6ee7b7}.risk[data-risk='注意']{color:#fbbf24}.risk[data-risk='高風險']{color:#fb7185}
.project-list{overflow:hidden;border:1px solid #3d4950;border-radius:12px;background:#252b2f}.project-list__head,.project-row{display:grid;grid-template-columns:minmax(260px,2fr) .7fr 1fr .8fr 1.1fr 1fr 32px;align-items:center;gap:16px}.project-list__head{padding:10px 18px;background:#2b3438;color:#8798a2;font-size:9px;text-transform:uppercase;letter-spacing:.08em}.project-row{width:100%;padding:13px 18px;border:0;border-top:1px solid #394349;border-radius:0;text-align:left;cursor:pointer}.project-row:hover{background:#2c353a;color:inherit}.project-row__name{display:flex;align-items:center;gap:12px}.project-row__name>i{width:4px;height:34px;border-radius:4px}.project-row strong,.project-row small{display:block}.project-row small{margin-top:2px;color:#94a3ac;font-size:9px}.row-progress{display:flex;align-items:center;gap:9px}.row-progress>i{width:72px;height:5px;background:#3b464c;border-radius:99px;overflow:hidden}.row-progress b{display:block;height:100%}.row-edit{width:28px;height:28px;padding:0;border-radius:50%;color:#ffad7a}.empty-state{padding:80px;text-align:center;border:1px dashed #47545c;border-radius:12px;color:#b0bbc2}.empty-state strong{font-size:16px}.empty-state p{color:#8496a0}
.modal-backdrop{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:20px;background:#14181ab8;backdrop-filter:blur(8px)}.project-editor{width:min(560px,100%);padding:24px;border:1px solid #52616a;border-radius:14px;background:linear-gradient(145deg,#2c353a,#232a2e);box-shadow:0 28px 80px #000b}.project-editor__head{display:flex;justify-content:space-between;align-items:flex-start}.project-editor__head span{color:#ffad7a;font-size:9px;letter-spacing:.16em}.project-editor__head h2{margin:4px 0 0;font-size:22px}.project-editor__head button{width:30px;height:30px;padding:0;border:0;font-size:24px;color:#a5b2ba}.project-editor__project{display:flex;align-items:center;gap:10px;margin:20px 0;padding:12px;border:1px solid #414d54;border-radius:9px;background:#21272a}.project-editor__project>i{width:4px;height:34px;border-radius:4px}.project-editor__project strong,.project-editor__project small{display:block}.project-editor__project small{margin-top:2px;color:#94a3ac;font-size:9px}.project-editor label{display:block;margin-bottom:7px;color:#afbdd0;font-size:11px}.project-editor textarea{width:100%;resize:vertical;min-height:130px;padding:12px;border:1px solid #48565e;border-radius:8px;outline:0;background:#1f2529;color:#e2eaf5;font:inherit;line-height:1.7}.project-editor textarea:focus{border-color:#ffad7a;box-shadow:0 0 0 3px #ffad7a14}.project-editor__count{text-align:right;margin-top:4px;color:#8395a0;font-size:9px}.project-editor__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.project-editor__actions button{padding:8px 16px}.editor-action-spacer{flex:1}.project-editor__actions .archive-button{border-color:#7f1d1d;color:#fca5a5}.project-editor__actions .save-button{border-color:#ffad7a;background:#ffad7a;color:#1a1f22;font-weight:700}.project-editor__actions .save-button:hover{background:#ffad7a;color:#1a1f22}
.project-editor{width:min(720px,100%);max-height:calc(100vh - 40px);overflow:auto}.cover-editor{display:grid;grid-template-columns:210px 1fr;gap:18px;align-items:center;margin:20px 0;padding:14px;border:1px solid #414d54;border-radius:10px;background:#21272a}.cover-editor__preview{height:116px;display:grid;place-items:center;border:1px solid #505f68;border-radius:8px;background-color:#2a3236;background-image:linear-gradient(135deg,color-mix(in srgb,var(--preview-accent,#ffad7a) 18%,transparent),transparent),repeating-linear-gradient(135deg,#ffffff05 0 1px,transparent 1px 12px);background-size:cover;background-position:center;overflow:hidden}.cover-editor__preview span{color:#8899a3;font-size:9px;letter-spacing:.16em}.cover-editor strong{display:block}.cover-editor p{margin:4px 0 10px;color:#94a3ac;font-size:9px}.project-editor .cover-upload{display:inline-flex;margin:0 7px 0 0;padding:6px 10px;border:1px solid #576872;border-radius:6px;color:#ffad7a;cursor:pointer}.cover-upload input{display:none}.cover-remove{padding:6px 10px;color:#fda4af;font-size:10px}.field-error{display:block;margin-top:6px;color:#fb7185}.editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.project-editor .editor-grid label{display:block;margin:0;color:#afbdd0;font-size:10px}.editor-grid label>span{display:block;margin-bottom:6px}.editor-grid input,.editor-grid textarea{width:100%;padding:9px 11px;border:1px solid #48565e;border-radius:8px;outline:0;background:#1f2529;color:#e2eaf5;font:inherit}.editor-grid input:focus,.editor-grid textarea:focus{border-color:#ffad7a;box-shadow:0 0 0 3px #ffad7a14}.project-editor .editor-grid textarea{min-height:92px;resize:vertical;line-height:1.6}.editor-grid__wide{grid-column:1/-1}.address-editor{display:grid;gap:8px}.address-editor__input{display:flex!important;gap:8px;margin:0!important}.address-editor__input input{flex:1}.address-editor__input button{flex:0 0 auto;padding:8px 12px;border-color:#5d6e78;color:#ffad7a}.address-editor__input button:disabled{opacity:.45;cursor:not-allowed}.location-message{display:block;color:#8698a2;font-size:8px;line-height:1.5}.location-message.success{color:#6ee7b7}.location-message.error{color:#fb7185}
.model-source-editor{margin:0 0 20px;padding:14px;border:1px solid #414d54;border-radius:10px;background:#21272a}.model-source-editor__head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:11px}.model-source-editor__head span,.model-source-editor__head strong{display:block}.model-source-editor__head span{color:#ffad7a;font-size:8px;letter-spacing:.16em}.model-source-editor__head strong{margin-top:3px;font-size:13px}.model-source-editor__head small{max-width:330px;color:#94a3ac;font-size:9px;text-align:right}.model-source-options{display:grid;grid-template-columns:1fr 1fr;gap:9px}.project-editor .model-source-options label{position:relative;display:grid;grid-template-columns:34px 1fr;align-items:center;gap:10px;margin:0;padding:11px;border:1px solid #48565e;border-radius:8px;background:#1e2326;cursor:pointer}.project-editor .model-source-options label.active{border-color:#ffad7a;background:#2a3237;box-shadow:0 0 0 2px #ffad7a10}.model-source-options input{position:absolute;opacity:0;pointer-events:none}.model-source-options__icon{width:34px;height:34px;display:grid;place-items:center;border:1px solid #60727c;border-radius:8px;background:#343e44;color:#ffad7a;font-size:10px;font-style:normal;font-weight:800}.model-source-options span strong,.model-source-options span small{display:block}.model-source-options span strong{font-size:10px;color:#ffad7a}.model-source-options span small{margin-top:3px;color:#94a3ac;font-size:8px;line-height:1.45}.model-source-options b{position:absolute;right:7px;top:6px;padding:2px 5px;border-radius:99px;background:#ffad7a1a;color:#ffad7a;font-size:7px}.model-source-editor__notice{margin:10px 0 0;padding:8px 10px;border-left:2px solid #ffad7a;background:#ffad7a0a;color:#aab6bd;font-size:9px;line-height:1.55}
@media(max-width:1100px){.project-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics{grid-template-columns:repeat(2,1fr)}.status-tabs{overflow:auto}.project-list{overflow-x:auto}.project-list__head,.project-row{min-width:980px}.map-view{grid-template-columns:1.25fr .85fr}}
@media(max-width:720px){.portfolio__main{width:calc(100% - 28px);padding-top:24px}.heading-row{align-items:flex-start}.heading-actions{flex-direction:column-reverse;align-items:stretch}.primary-button{font-size:0}.primary-button span{font-size:18px}.metrics{grid-template-columns:1fr 1fr}.toolbar{flex-wrap:wrap}.search{max-width:none;flex-basis:100%}.status-tabs{margin-left:0;flex:1}.view-switch{width:100%}.view-switch button{flex:1;justify-content:center}.project-grid{grid-template-columns:1fr}.user div{display:none}.notification-panel{position:fixed;right:14px;top:64px}.map-view{grid-template-columns:1fr}.taiwan-map{min-height:480px}.map-detail{border-left:0;border-top:1px solid #3d4950}.open-project{margin-top:20px}.cover-editor,.editor-grid,.model-source-options{grid-template-columns:1fr}.editor-grid__wide{grid-column:auto}.model-source-editor__head{align-items:flex-start;flex-direction:column}.model-source-editor__head small{text-align:left}}
</style>
