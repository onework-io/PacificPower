import projectData from './projects.json'

export type ProjectStatus = '施工中' | '規劃中' | '待驗收' | '已完成'
export type ProjectModelSource = 'pacificpower-template' | 'project-model'

export const PACIFICPOWER_DATACENTER_TEMPLATE_ID = 'pacificpower-dc250-v1'

export interface ProjectSummary {
  id: string
  code: string
  name: string
  description: string
  client: string
  location: string
  model: string
  modelSource?: ProjectModelSource
  modelTemplateId?: string
  crew: string
  coverImage?: string
  status: ProjectStatus
  progress: number
  scheduleDelta: number
  budget: number
  spent: number
  startDate: string
  endDate: string
  manager: string
  risk: '正常' | '注意' | '高風險'
  updatedAt: string
  accent: string
  lat: number
  lng: number
  /** 後端 optimistic-locking 版本；本機 JSON 專案可省略。 */
  version?: number
  activeModelVersionId?: string | null
  activeWbsVersionId?: string | null
}

export interface ProjectDataFile {
  schemaVersion: number
  updatedAt: string
  projects: ProjectSummary[]
}

export const DEFAULT_PROJECT_DATA = projectData as ProjectDataFile
export const PROJECTS: ProjectSummary[] = DEFAULT_PROJECT_DATA.projects
