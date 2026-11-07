<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { Session } from '@supabase/supabase-js'
import AuthGate from '@/components/AuthGate.vue'
import PartTree from '@/components/PartTree.vue'
import ViewerCanvas from '@/components/ViewerCanvas.vue'
import SplitPane from '@/components/SplitPane.vue'
import SchedulePanel from '@/components/gantt/SchedulePanel.vue'
import ProjectPortfolio from '@/components/ProjectPortfolio.vue'
import CrewOrganization from '@/components/CrewOrganization.vue'
import AccountManagement from '@/components/AccountManagement.vue'
import { useViewerStore } from '@/stores/viewer'
import { usePoiStore } from '@/stores/poi'
import { useCostStore } from '@/stores/cost'
import type { ProjectSummary } from '@/data/projects'
import { projectRepository } from '@/lib/projectRepository'
import { authConfigured, supabase } from '@/lib/supabase'
import { apiRequest } from '@/lib/apiClient'
import { PERMISSIONS_KEY, type PermissionSource } from '@/lib/permissions'
import { subscribeLiveEvents, type LiveConnectionStatus } from '@/lib/liveEvents'

interface AuthProfile {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'planner' | 'manager' | 'worker'
  permissions: string[]
  projectPermissionOverrides?: Array<{
    projectId: string
    permissionCode: string
    effect: 'allow' | 'deny'
  }>
}

const store = useViewerStore()
const poiStore = usePoiStore()
const costStore = useCostStore()
const page = ref<'portfolio' | 'workspace' | 'accounts' | 'crews'>('portfolio')
const crewTarget = ref<'overview' | 'calendar' | 'directory' | 'labor'>('overview')
const scheduleTarget = ref<'daily' | undefined>()
const projects = ref<ProjectSummary[]>(projectRepository.load())
const activeProject = ref<ProjectSummary>(projects.value[0])
const repositoryMessage = ref(projectRepository.apiEnabled ? '正在連接後端…' : '本機展示資料')
const authReady = ref(!authConfigured)
const authSession = ref<Session | null>(null)
const profileReady = ref(!authConfigured)
const authProfile = ref<AuthProfile | null>(null)
const profileMessage = ref('正在載入帳號權限…')
let stopAuthListener: (() => void) | undefined
let stopLiveEvents: (() => void) | undefined
let liveRefreshTimer: ReturnType<typeof setTimeout> | undefined
const liveRevision = ref(0)
const liveStatus = ref<LiveConnectionStatus>('stopped')
const projectSubtitle = computed(() => `${activeProject.value.model} · ${activeProject.value.location} · ${store.total} 個構件`)
const can = (permission: string) => !authConfigured || Boolean(authProfile.value?.permissions.includes(permission))
const effectivePermissions = computed<readonly string[] | undefined>(() => {
  if (!authConfigured) return undefined
  const effective = new Set(authProfile.value?.permissions ?? [])
  if (page.value === 'workspace') {
    for (const override of authProfile.value?.projectPermissionOverrides ?? []) {
      if (override.projectId !== activeProject.value.id) continue
      if (override.effect === 'allow') effective.add(override.permissionCode)
      else effective.delete(override.permissionCode)
    }
  }
  return [...effective]
})
provide(PERMISSIONS_KEY, effectivePermissions as PermissionSource)

function openAccounts() {
  if (can('account.view')) {
    page.value = 'accounts'
    connectLiveEvents()
  }
}

function openCrews(target: 'overview' | 'calendar' | 'directory' | 'labor' = 'overview') {
  if (can('project.view')) {
    crewTarget.value = target
    page.value = 'crews'
    connectLiveEvents()
  }
}

function openProjectFeature(projectId: string, feature: 'daily') {
  const project = projects.value.find((item) => item.id === projectId)
  if (!project || !can('project.view')) return
  openProject(project)
  scheduleTarget.value = feature
}

function openProjectById(projectId: string) {
  const project = projects.value.find((item) => item.id === projectId)
  if (project) openProject(project)
}

function openProject(project: ProjectSummary) {
  if (!can('project.view')) return
  scheduleTarget.value = undefined
  activeProject.value = project
  store.resetForProject()
  poiStore.loadProject(project.id)
  costStore.loadProject(project.id)
  page.value = 'workspace'
  connectLiveEvents(project.id)
}

function backToPortfolio() {
  page.value = 'portfolio'
  connectLiveEvents()
}

function connectLiveEvents(projectId?: string) {
  stopLiveEvents?.()
  stopLiveEvents = undefined
  if (!projectRepository.apiEnabled || !authProfile.value) return
  if (!projectId && !can('report.portfolio.view')) return
  stopLiveEvents = subscribeLiveEvents({
    projectId,
    onStatus: (status) => { liveStatus.value = status },
    onEvent: () => {
      liveRevision.value += 1
      if (page.value !== 'portfolio') return
      if (liveRefreshTimer) clearTimeout(liveRefreshTimer)
      liveRefreshTimer = setTimeout(() => { void loadRemoteProjects() }, 700)
    },
  })
}

async function updateProject(updated: ProjectSummary) {
  const desiredModelSource = updated.modelSource
  const desiredTemplateId = updated.modelTemplateId
  const pendingCover = updated.coverImage?.startsWith('data:') ? updated.coverImage : undefined
  let uploadWarning = ''
  try {
    updated = await projectRepository.update(updated)
    if (
      projectRepository.apiEnabled && desiredModelSource === 'pacificpower-template'
      && desiredTemplateId && !updated.activeModelVersionId
    ) {
      const applied = await projectRepository.applyModelTemplate(updated.id, desiredTemplateId)
      if (applied) {
        updated.version = applied.projectVersion
        updated.activeModelVersionId = applied.modelVersionId
        updated.modelSource = 'pacificpower-template'
        updated.modelTemplateId = desiredTemplateId
      }
    }
    if (projectRepository.apiEnabled && pendingCover) {
      try {
        updated.coverImage = await projectRepository.uploadCover(updated.id, pendingCover)
      } catch (error) {
        updated.coverImage = pendingCover
        const detail = error instanceof Error ? error.message : 'Storage 未設定'
        uploadWarning = `；封面暫存瀏覽器：${detail}`
      }
    }
    repositoryMessage.value = projectRepository.apiEnabled ? `已同步至後端${uploadWarning}` : '已儲存於本機'
  } catch (error) {
    repositoryMessage.value = error instanceof Error ? `同步失敗：${error.message}` : '後端同步失敗'
    return
  }
  const index = projects.value.findIndex((project) => project.id === updated.id)
  if (index < 0) return
  projects.value[index] = { ...updated }
  if (activeProject.value.id === updated.id) activeProject.value = projects.value[index]
  try {
    projectRepository.save(projects.value)
  } catch {
    // 儲存失敗不影響目前工作階段的編輯。
  }
}

async function createProject(draft: ProjectSummary) {
  try {
    const created = await projectRepository.create(draft)
    let templateMessage = ''
    if (projectRepository.apiEnabled && draft.modelSource === 'pacificpower-template' && draft.modelTemplateId) {
      try {
        const applied = await projectRepository.applyModelTemplate(created.id, draft.modelTemplateId)
        if (applied) {
          created.version = applied.projectVersion
          created.activeModelVersionId = applied.modelVersionId
          created.modelSource = 'pacificpower-template'
          created.modelTemplateId = draft.modelTemplateId
          templateMessage = `，已套用 ${applied.partCount} 個 3D 構件`
        }
      } catch (error) {
        templateMessage = error instanceof Error ? `；3D 模板套用失敗：${error.message}` : '；3D 模板套用失敗'
      }
    }
    if (projectRepository.apiEnabled && draft.coverImage?.startsWith('data:')) {
      try {
        created.coverImage = await projectRepository.uploadCover(created.id, draft.coverImage)
      } catch (error) {
        created.coverImage = draft.coverImage
        const detail = error instanceof Error ? error.message : 'Storage 未設定'
        templateMessage += `；封面暫存瀏覽器：${detail}`
      }
    }
    projects.value.unshift(created)
    activeProject.value = created
    projectRepository.save(projects.value)
    repositoryMessage.value = projectRepository.apiEnabled
      ? `專案已建立並同步${templateMessage}`
      : '專案已建立於本機'
  } catch (error) {
    repositoryMessage.value = error instanceof Error ? `建立失敗：${error.message}` : '專案建立失敗'
  }
}

async function archiveProject(project: ProjectSummary) {
  try {
    await projectRepository.archive(project)
    projects.value = projects.value.filter((item) => item.id !== project.id)
    if (projects.value.length) activeProject.value = projects.value[0]
    projectRepository.save(projects.value)
    repositoryMessage.value = projectRepository.apiEnabled ? '專案已封存' : '專案已從本機清單移除'
  } catch (error) {
    repositoryMessage.value = error instanceof Error ? `封存失敗：${error.message}` : '專案封存失敗'
  }
}

async function loadRemoteProjects() {
  if (!projectRepository.apiEnabled) return
  try {
    const remote = await projectRepository.loadRemote()
    if (remote) {
      projects.value = remote
      if (remote.length) activeProject.value = remote[0]
      repositoryMessage.value = remote.length ? '已連接正式專案資料' : '已連接正式資料庫，目前尚無專案'
    }
  } catch (error) {
    repositoryMessage.value = error instanceof Error ? `後端未連線，使用本機資料：${error.message}` : '後端未連線，使用本機資料'
  }
}

async function loadAuthProfile() {
  if (!authConfigured || !authSession.value) {
    authProfile.value = null
    profileReady.value = true
    return false
  }
  profileReady.value = false
  profileMessage.value = '正在載入帳號權限…'
  try {
    authProfile.value = await apiRequest<AuthProfile>('/auth/me')
    profileMessage.value = ''
    return true
  } catch (error) {
    authProfile.value = null
    const detail = error instanceof Error ? error.message : ''
    profileMessage.value = detail.includes('No organization membership')
      ? '帳號已完成登入，但尚未取得 PacificPower 平台權限。請等待管理員核准。'
      : `無法驗證平台權限${detail ? `：${detail}` : ''}`
    return false
  } finally {
    profileReady.value = true
  }
}

async function activateSession(session: Session | null) {
  authSession.value = session
  page.value = 'portfolio'
  if (session && await loadAuthProfile()) {
    await loadRemoteProjects()
    connectLiveEvents()
  }
  else if (!session) {
    authProfile.value = null
    profileReady.value = true
  }
}

onMounted(async () => {
  if (!authConfigured || !supabase) {
    authReady.value = true
    await loadRemoteProjects()
    return
  }
  const { data } = await supabase.auth.getSession()
  authSession.value = data.session
  authReady.value = true
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token === authSession.value?.access_token) return
    void activateSession(session)
  })
  stopAuthListener = () => listener.subscription.unsubscribe()
  if (data.session && await loadAuthProfile()) {
    await loadRemoteProjects()
    connectLiveEvents()
  }
})

onBeforeUnmount(() => {
  stopAuthListener?.()
  stopLiveEvents?.()
  if (liveRefreshTimer) clearTimeout(liveRefreshTimer)
})

async function signOut() {
  await supabase?.auth.signOut()
  page.value = 'portfolio'
}

const STORAGE_KEY = 'generator-layout-v2'
interface SavedLayout {
  layersOpen: boolean
  scheduleOpen: boolean
  splitRatio: number
}

function loadLayout(): SavedLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<SavedLayout>
    return {
      layersOpen: saved.layersOpen ?? true,
      scheduleOpen: saved.scheduleOpen ?? true,
      splitRatio: typeof saved.splitRatio === 'number' ? saved.splitRatio : 0.6,
    }
  } catch {
    return { layersOpen: true, scheduleOpen: true, splitRatio: 0.6 }
  }
}

const initialLayout = loadLayout()
const layersOpen = ref(initialLayout.layersOpen)
const scheduleOpen = ref(initialLayout.scheduleOpen)
const splitRatio = ref(initialLayout.splitRatio)

watch([layersOpen, scheduleOpen, splitRatio], () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      layersOpen: layersOpen.value,
      scheduleOpen: scheduleOpen.value,
      splitRatio: splitRatio.value,
    }))
  } catch {
    // 版面偏好無法儲存時仍可正常操作。
  }
})

function applyPreset(ratio: number) {
  scheduleOpen.value = true
  splitRatio.value = ratio
}
</script>

<template>
  <div v-if="!authReady" class="auth-loading">正在確認登入狀態…</div>
  <AuthGate v-else-if="authConfigured && !authSession" />
  <div v-else-if="authConfigured && authSession && !profileReady" class="auth-loading">正在確認平台權限…</div>
  <main v-else-if="authConfigured && authSession && !authProfile" class="access-pending">
    <section><div class="access-pending__mark">A</div><p>ACCOUNT APPROVAL</p><h1>帳號等待核准</h1><span>{{ profileMessage }}</span><small>{{ authSession.user.email }}</small><button @click="signOut">登出</button></section>
  </main>
  <template v-else>
    <ProjectPortfolio
      v-if="page === 'portfolio'"
      :projects="projects"
      :repository-message="repositoryMessage"
      :auth-email="authSession?.user.email"
      :permissions="authProfile?.permissions"
      :live-revision="liveRevision"
      :live-status="liveStatus"
      @open="openProject"
      @update="updateProject"
      @create="createProject"
      @archive="archiveProject"
      @accounts="openAccounts"
      @crews="openCrews"
      @open-project-feature="openProjectFeature"
      @sign-out="signOut"
    />

    <CrewOrganization
      v-else-if="page === 'crews'"
      :permissions="authProfile?.permissions"
      :initial-target="crewTarget"
      @back="backToPortfolio"
      @open-project="openProjectById"
    />

    <AccountManagement v-else-if="page === 'accounts'" :permissions="authProfile?.permissions" @back="backToPortfolio" />

    <div v-else class="app" :class="{ 'is-layers-closed': !layersOpen }">
    <aside class="sidebar">
      <div class="sidebar__head">
        <div v-if="layersOpen" class="sidebar__heading">
          <button class="sidebar__back" @click="backToPortfolio">‹ 所有專案</button>
          <h1 class="sidebar__title">{{ activeProject.name }}</h1>
          <div class="sidebar__sub">{{ projectSubtitle }}</div>
        </div>
        <button
          class="sidebar__toggle"
          :aria-label="layersOpen ? '收合圖層' : '展開圖層'"
          :title="layersOpen ? '收合圖層' : '展開圖層'"
          @click="layersOpen = !layersOpen"
        >{{ layersOpen ? '‹' : '›' }}</button>
      </div>
      <PartTree v-show="layersOpen" />
      <div v-show="layersOpen" class="sidebar__foot">
        <button @click="store.showAll()">全部顯示</button>
        <button @click="store.isolatedId = null" :disabled="!store.isolatedId">取消隔離</button>
      </div>
      <button v-show="!layersOpen" class="sidebar__rail" title="展開構件圖層" @click="layersOpen = true">
        <span>圖層</span>
      </button>
    </aside>

    <main
      class="workspace"
      :class="{ 'is-compact-3d': scheduleOpen && splitRatio < 0.5 }"
    >
      <SplitPane v-model="splitRatio" :right-open="scheduleOpen">
        <template #left><ViewerCanvas /></template>
        <template #right><SchedulePanel :project-id="activeProject.id" :project="activeProject" :project-start="activeProject.startDate" :initial-tab="scheduleTarget" /></template>
      </SplitPane>

      <div class="workspace-brand"><img src="/branding/pisg-logo.png" alt="PISG — Power International Synergy Group" /><span>DATA CENTER · DIGITAL TWIN</span></div>
      <div class="layoutbar" aria-label="版面配置">
        <button class="layoutbar__project" title="返回專案總覽" @click="backToPortfolio">專案總覽</button>
        <span class="layoutbar__sep" />
        <button
          :class="{ 'is-on': layersOpen }"
          :aria-pressed="layersOpen"
          @click="layersOpen = !layersOpen"
        >圖層</button>
        <span class="layoutbar__sep" />
        <button
          :class="{ 'is-on': scheduleOpen && Math.abs(splitRatio - 0.7) < 0.02 }"
          title="3D 70%、排程 30%"
          @click="applyPreset(0.7)"
        >3D 優先</button>
        <button
          :class="{ 'is-on': scheduleOpen && Math.abs(splitRatio - 0.6) < 0.02 }"
          title="3D 60%、排程 40%"
          @click="applyPreset(0.6)"
        >並排</button>
        <button
          :class="{ 'is-on': scheduleOpen && Math.abs(splitRatio - 0.4) < 0.02 }"
          title="3D 40%、排程 60%"
          @click="applyPreset(0.4)"
        >排程優先</button>
        <span class="layoutbar__sep" />
        <button
          :class="{ 'is-on': scheduleOpen }"
          :aria-pressed="scheduleOpen"
          @click="scheduleOpen = !scheduleOpen"
        >{{ scheduleOpen ? '隱藏排程' : '顯示排程' }}</button>
      </div>
    </main>
    </div>
  </template>
</template>

<style scoped>
.auth-loading { min-height: 100%; display: grid; place-items: center; color: var(--muted); background: var(--bg); }
.access-pending{min-height:100%;display:grid;place-items:center;padding:30px;background:radial-gradient(circle at 20% 10%,#164061 0,transparent 36%),#08111f}.access-pending section{width:min(460px,100%);display:grid;justify-items:center;padding:38px;border:1px solid #2b4161;border-radius:18px;background:#101c2eee;box-shadow:0 28px 80px #0008;text-align:center}.access-pending__mark{width:48px;height:48px;display:grid;place-items:center;border-radius:13px;color:#07121f;background:var(--accent);font-size:24px;font-weight:900}.access-pending p{margin:20px 0 5px;color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.15em}.access-pending h1{margin:0 0 10px}.access-pending span{color:#a4b5c9;line-height:1.7}.access-pending small{margin:14px 0 20px;color:#758aa4}.access-pending button{min-width:120px;border-color:#3b5575;color:#b7c8da}
.app {
  grid-template-columns: 268px minmax(0, 1fr);
  transition: grid-template-columns 180ms ease;
}
.app.is-layers-closed { grid-template-columns: 48px minmax(0, 1fr); }
.workspace { position: relative; min-width: 0; min-height: 0; }

.sidebar { overflow: hidden; }
.sidebar__head { display: flex; align-items: flex-start; gap: 8px; min-height: 61px; }
.sidebar__heading { flex: 1; min-width: 0; }
.sidebar__back { margin: -4px 0 7px; padding: 0; border: 0; color: var(--accent); font-size: 10px; }
.sidebar__back:hover { color: #fff; }
.sidebar__title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar__toggle {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 20px;
  line-height: 1;
}
.is-layers-closed .sidebar__head { justify-content: center; padding: 14px 9px 10px; }
.sidebar__rail {
  flex: 1;
  border: 0;
  border-radius: 0;
  padding: 18px 0;
  color: var(--muted);
  writing-mode: vertical-rl;
  letter-spacing: 0.25em;
}
.sidebar__rail:hover { background: #ffffff08; }

.sidebar__foot {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
}
.sidebar__foot button { flex: 1; }
.sidebar__foot button:disabled { opacity: 0.4; cursor: default; border-color: var(--line); color: var(--text); }

.workspace-brand { position:absolute;top:14px;left:16px;z-index:9;display:flex;align-items:center;gap:14px;padding:6px 10px;background:#232d32;border-left:3px solid #ff681b;border-radius:5px;max-width:calc(100% - 32px);pointer-events:none; }
.workspace-brand img { width:134px;height:auto;display:block; }
.workspace-brand span { color:#c2cbd0;font-size:9px;letter-spacing:.12em; }
@media(max-width:1000px){.workspace-brand span{display:none}}
.layoutbar {
  position: absolute;
  z-index: 8;
  top: 78px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  backdrop-filter: blur(8px);
  box-shadow: 0 5px 18px #0005;
  transition: top 160ms ease;
}
.workspace.is-compact-3d .layoutbar { top: 78px; }
.layoutbar button { border: 0; padding: 4px 9px; white-space: nowrap; }
.layoutbar button:hover { background: #ffffff12; }
.layoutbar button.is-on { background: var(--accent); color: #06121d; font-weight: 600; }
.layoutbar .layoutbar__project { color: var(--accent); font-weight: 600; }
.layoutbar .layoutbar__project:hover { background: #4cc2ff14; }
.layoutbar__sep { width: 1px; height: 20px; margin: 0 2px; background: var(--line); }

@media (max-width: 1100px) {
  .app,
  .app.is-layers-closed { grid-template-columns: 48px minmax(0, 1fr); }
  .app:not(.is-layers-closed) .sidebar {
    position: absolute;
    z-index: 20;
    inset: 0 auto 0 0;
    width: 268px;
    box-shadow: 8px 0 28px #0008;
  }
  .layoutbar,
  .workspace.is-compact-3d .layoutbar {
    top: 10px;
    left: 10px;
    max-width: calc(100% - 20px);
    overflow-x: auto;
  }
}
</style>
