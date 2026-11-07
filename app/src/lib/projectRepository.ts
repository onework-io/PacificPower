import {
  PACIFICPOWER_DATACENTER_TEMPLATE_ID,
  DEFAULT_PROJECT_DATA,
  type ProjectDataFile,
  type ProjectSummary,
} from '@/data/projects'
import { API_BASE_URL, apiHeaders, apiRequest } from '@/lib/apiClient'

const STORAGE_KEY = 'pacificpower-project-data-json-v1'
const LEGACY_STORAGE_KEY = 'pacificpower-projects-v1'

interface ApiProject {
  id: string
  code: string
  name: string
  description: string
  clientName: string
  location: string
  latitude: number | null
  longitude: number | null
  generatorModel: string
  crewName: string
  contractAmount: number | null
  status: 'planning' | 'active' | 'inspection' | 'completed' | 'archived'
  riskStatus: 'normal' | 'attention' | 'high'
  startDate: string | null
  endDate: string | null
  managerName: string | null
  progressPct: number
  activeModelVersionId: string | null
  activeWbsVersionId: string | null
  version: number
  updatedAt: string
}

const statusFromApi = {
  planning: '規劃中', active: '施工中', inspection: '待驗收', completed: '已完成', archived: '已完成',
} as const
const statusToApi = {
  規劃中: 'planning', 施工中: 'active', 待驗收: 'inspection', 已完成: 'completed',
} as const
const riskFromApi = { normal: '正常', attention: '注意', high: '高風險' } as const
const riskToApi = { 正常: 'normal', 注意: 'attention', 高風險: 'high' } as const
const accents = ['#43c7ff', '#6ee7b7', '#a78bfa', '#fbbf24', '#fb7185']

function formatDate(value: string | null) {
  return value?.replaceAll('-', '/') ?? ''
}

function toApiDate(value: string) {
  return value ? value.replaceAll('/', '-') : undefined
}

function fromApi(project: ApiProject, index = 0): ProjectSummary {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    description: project.description,
    client: project.clientName,
    location: project.location,
    model: project.generatorModel,
    modelSource: project.activeModelVersionId ? 'pacificpower-template' : 'project-model',
    modelTemplateId: project.activeModelVersionId ? PACIFICPOWER_DATACENTER_TEMPLATE_ID : undefined,
    crew: project.crewName,
    status: statusFromApi[project.status],
    progress: project.progressPct,
    scheduleDelta: 0,
    budget: project.contractAmount ?? 0,
    spent: 0,
    startDate: formatDate(project.startDate),
    endDate: formatDate(project.endDate),
    manager: project.managerName ?? '尚未指派',
    risk: riskFromApi[project.riskStatus],
    updatedAt: new Date(project.updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    accent: accents[index % accents.length] ?? '#43c7ff',
    lat: project.latitude ?? 23.7,
    lng: project.longitude ?? 120.96,
    version: project.version,
    activeModelVersionId: project.activeModelVersionId,
    activeWbsVersionId: project.activeWbsVersionId,
  }
}

function toApi(project: ProjectSummary) {
  return {
    code: project.code.trim().toUpperCase(),
    name: project.name.trim(),
    description: project.description.trim(),
    clientName: project.client.trim(),
    location: project.location.trim(),
    latitude: project.lat,
    longitude: project.lng,
    generatorModel: project.model.trim(),
    crewName: project.crew.trim(),
    contractAmount: project.budget,
    status: statusToApi[project.status],
    riskStatus: riskToApi[project.risk],
    startDate: toApiDate(project.startDate),
    endDate: toApiDate(project.endDate),
  }
}

function copyProjects(projects: ProjectSummary[]) {
  return projects.map((project) => ({
    ...project,
    modelSource: project.modelSource ?? 'pacificpower-template',
    modelTemplateId: project.modelSource === 'project-model'
      ? undefined
      : (project.modelTemplateId ?? PACIFICPOWER_DATACENTER_TEMPLATE_ID),
  }))
}

function mergeWithDefaults(projects: ProjectSummary[]) {
  return copyProjects(DEFAULT_PROJECT_DATA.projects.map((fallback) => ({
    ...fallback,
    ...(projects.find((project) => project.id === fallback.id) ?? {}),
  })))
}

export function serializeProjectData(projects: ProjectSummary[]): string {
  const file: ProjectDataFile = {
    schemaVersion: DEFAULT_PROJECT_DATA.schemaVersion,
    updatedAt: new Date().toISOString(),
    projects: copyProjects(projects),
  }
  return JSON.stringify(file, null, 2)
}

export function parseProjectData(json: string): ProjectSummary[] {
  const parsed = JSON.parse(json) as ProjectDataFile | ProjectSummary[]
  const projects = Array.isArray(parsed) ? parsed : parsed.projects
  if (!Array.isArray(projects)) throw new Error('Invalid project JSON')
  return mergeWithDefaults(projects).map(project=>{
    // Preserve project identity and all PMIS/model bindings; migrate only former default labels.
    if(project.id!==DEFAULT_PROJECT_DATA.projects[0]?.id)return project
    const legacy={"code": "PP-DC250-CONCEPT", "name": "250 MW 資料中心建設", "description": "工作內容依 PISG Rev1.3-H4 前期評估草案；來源 50 MW 與既有 250 MW 園區模型容量差異待確認。T0、基地及授權人員待確認。", "model": "250 MW 園區 · 200 MW IT（假設）"}
    const updated={...project}
    for(const key of ['code','name','description','model'] as const){if(updated[key]===legacy[key])updated[key]=DEFAULT_PROJECT_DATA.projects[0]![key]}
    return updated
  })
}

/**
 * 本機 JSON Repository。
 * 現階段以匯入的 projects.json 為初始資料，更新後將完整 JSON 文件覆寫到 localStorage。
 * 未來接後端時，只需以 API Repository 實作相同的 load/save 介面。
 */
export const projectRepository = {
  get apiEnabled() { return Boolean(API_BASE_URL) },

  load(): ProjectSummary[] {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return parseProjectData(saved)

      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacy) {
        const migrated = parseProjectData(legacy)
        this.save(migrated)
        return migrated
      }
    } catch {
      // JSON 損壞或儲存空間不可用時，回到唯讀的內建 JSON。
    }
    return copyProjects(DEFAULT_PROJECT_DATA.projects)
  },

  save(projects: ProjectSummary[]): void {
    localStorage.setItem(STORAGE_KEY, serializeProjectData(projects))
  },

  async loadRemote(): Promise<ProjectSummary[] | null> {
    if (!API_BASE_URL) return null
    const page = await apiRequest<{ items: ApiProject[] }>('/projects', { headers: await apiHeaders() })
    return Promise.all(page.items.map(async (project, index) => {
      const summary = fromApi(project, index)
      try {
        const result = await this.getCover(project.id)
        summary.coverImage = result?.url
      } catch {
        // 封面載入失敗不阻擋專案清單。
      }
      return summary
    }))
  },

  async create(project: ProjectSummary): Promise<ProjectSummary> {
    if (!API_BASE_URL) return project
    const created = await apiRequest<ApiProject>('/projects', {
      method: 'POST',
      headers: await apiHeaders({ 'Idempotency-Key': crypto.randomUUID() }),
      body: JSON.stringify(toApi(project)),
    })
    return { ...project, ...fromApi(created), coverImage: project.coverImage }
  },

  async update(project: ProjectSummary): Promise<ProjectSummary> {
    if (!API_BASE_URL || !project.version) return project
    const updated = await apiRequest<ApiProject>(`/projects/${project.id}`, {
      method: 'PATCH',
      headers: await apiHeaders({ 'If-Match': `W/"${project.version}"` }),
      body: JSON.stringify(toApi(project)),
    })
    return { ...project, ...fromApi(updated), coverImage: project.coverImage }
  },

  async archive(project: ProjectSummary): Promise<void> {
    if (!API_BASE_URL || !project.version) return
    await apiRequest(`/projects/${project.id}`, {
      method: 'DELETE',
      headers: await apiHeaders({ 'If-Match': `W/"${project.version}"` }),
      body: JSON.stringify({ reason: '由專案總覽封存' }),
    })
  },

  async applyModelTemplate(projectId: string, templateCode: string) {
    if (!API_BASE_URL) return null
    return apiRequest<{ projectVersion: number; modelVersionId: string; partCount: number }>(
      `/projects/${projectId}/models/apply-template`,
      {
        method: 'POST',
        headers: await apiHeaders({ 'Idempotency-Key': crypto.randomUUID() }),
        body: JSON.stringify({ templateCode }),
      },
    )
  },

  async getCover(projectId: string) {
    if (!API_BASE_URL) return null
    const result = await apiRequest<{
      cover: { fileId: string; url: string; mimeType: string; byteSize: number } | null
    }>(`/projects/${projectId}/images/cover`, { headers: await apiHeaders() })
    return result.cover
  },

  async uploadCover(projectId: string, dataUrl: string) {
    if (!API_BASE_URL) return dataUrl
    const blob = await fetch(dataUrl).then((response) => response.blob())
    const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
    const prepared = await apiRequest<{
      fileId: string
      uploadUrl: string
      headers: Record<string, string>
    }>(`/projects/${projectId}/images/cover/upload-url`, {
      method: 'POST', headers: await apiHeaders(),
      body: JSON.stringify({ fileName: `project-cover.${extension}`, mimeType: blob.type, byteSize: blob.size }),
    })
    const uploaded = await fetch(prepared.uploadUrl, { method: 'PUT', headers: prepared.headers, body: blob })
    if (!uploaded.ok) throw new Error(`Storage upload failed (${uploaded.status})`)
    const completed = await apiRequest<{
      cover: { url: string } | null
    }>(`/projects/${projectId}/images/cover/complete`, {
      method: 'POST', headers: await apiHeaders(), body: JSON.stringify({ fileId: prepared.fileId }),
    })
    return completed.cover?.url ?? dataUrl
  },
}
