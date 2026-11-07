import { API_BASE_URL, apiHeaders, apiRequest } from '@/lib/apiClient'

export interface ApiWbsTask {
  id: string
  projectId: string
  stableKey: string
  code: string
  sequence: number
  name: string
  phase: string
  durationDays: number
  weightPct: number | null
  progressPct: number
  pinnedStartDay: number | null
  lagDays: number
  modelPartKey: string | null
  version: number
}

export interface ApiWbsDependency {
  predecessorTaskId: string
  successorTaskId: string
  relationType: string
  lagDays: number
}

export interface ApiWbsData {
  projectId: string
  tasks: ApiWbsTask[]
  dependencies: ApiWbsDependency[]
}

export type WbsVersionStatus = 'draft' | 'in_review' | 'published' | 'superseded' | 'rejected'

export interface ApiWbsVersion {
  id: string
  projectId: string
  versionNumber: number
  label: string
  status: WbsVersionStatus
  source: 'manual' | 'excel' | 'copy' | 'restore' | 'migration'
  changeNote: string
  createdBy: string | null
  submittedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  publishedAt: string | null
  version: number
  createdAt: string
}

export type WbsTaskPatch = Partial<Pick<ApiWbsTask,
  'name' | 'durationDays' | 'weightPct' | 'progressPct' | 'pinnedStartDay' | 'modelPartKey'
>>

export const wbsRepository = {
  get apiEnabled() { return Boolean(API_BASE_URL) },

  async load(projectId: string) {
    if (!API_BASE_URL) return null
    return apiRequest<ApiWbsData>(`/projects/${projectId}/tasks`, { headers: await apiHeaders() })
  },

  async update(projectId: string, task: ApiWbsTask, patch: WbsTaskPatch) {
    return apiRequest<ApiWbsTask>(`/projects/${projectId}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: await apiHeaders({ 'If-Match': `W/"${task.version}"` }),
      body: JSON.stringify(patch),
    })
  },

  async recalculate(projectId: string) {
    return apiRequest(`/projects/${projectId}/schedule/recalculate`, {
      method: 'POST', headers: await apiHeaders(),
    })
  },

  async listVersions(projectId: string) {
    return apiRequest<ApiWbsVersion[]>(`/projects/${projectId}/wbs/versions`, {
      headers: await apiHeaders(),
    })
  },

  async createVersion(projectId: string, label?: string) {
    return apiRequest<ApiWbsVersion>(`/projects/${projectId}/wbs/versions`, {
      method: 'POST',
      headers: await apiHeaders({ 'Idempotency-Key': crypto.randomUUID() }),
      body: JSON.stringify({ source: 'manual', label }),
    })
  },

  async submitVersion(projectId: string, version: ApiWbsVersion) {
    return this.transition(projectId, version, 'submit')
  },

  async approveVersion(projectId: string, version: ApiWbsVersion) {
    return this.transition(projectId, version, 'approve')
  },

  async publishVersion(projectId: string, version: ApiWbsVersion) {
    return this.transition(projectId, version, 'publish')
  },

  async rejectVersion(projectId: string, version: ApiWbsVersion, note: string) {
    return apiRequest<ApiWbsVersion>(`/projects/${projectId}/wbs/versions/${version.id}/reject`, {
      method: 'POST',
      headers: await apiHeaders({ 'If-Match': `W/"${version.version}"` }),
      body: JSON.stringify({ note }),
    })
  },

  async deleteVersion(projectId: string, version: ApiWbsVersion) {
    return apiRequest<void>(`/projects/${projectId}/wbs/versions/${version.id}`, {
      method: 'DELETE', headers: await apiHeaders({ 'If-Match': `W/"${version.version}"` }),
    })
  },

  async transition(projectId: string, version: ApiWbsVersion, action: 'submit' | 'approve' | 'publish') {
    return apiRequest<ApiWbsVersion>(`/projects/${projectId}/wbs/versions/${version.id}/${action}`, {
      method: 'POST', headers: await apiHeaders({ 'If-Match': `W/"${version.version}"` }),
    })
  },
}
