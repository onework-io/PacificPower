import type { Poi } from '@/data/pois'
import { API_BASE_URL, apiHeaders, apiRequest } from '@/lib/apiClient'

export interface ApiPoi extends Poi {
  projectId: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export const poiRepository = {
  get apiEnabled() { return Boolean(API_BASE_URL) },

  async list(projectId: string) {
    return apiRequest<ApiPoi[]>(`/projects/${projectId}/pois`, { headers: await apiHeaders() })
  },

  async create(projectId: string, poi: Omit<Poi, 'id'>) {
    return apiRequest<ApiPoi>(`/projects/${projectId}/pois`, {
      method: 'POST', headers: await apiHeaders(), body: JSON.stringify({
        partKey: poi.partId,
        position: poi.position,
        title: poi.title,
        url: poi.url,
        startSec: poi.startSec,
        endSec: poi.endSec,
        note: poi.note,
      }),
    })
  },

  async update(projectId: string, id: string, patch: Partial<Poi>) {
    return apiRequest<ApiPoi>(`/projects/${projectId}/pois/${id}`, {
      method: 'PATCH', headers: await apiHeaders(), body: JSON.stringify({
        ...(patch.partId === undefined ? {} : { partKey: patch.partId }),
        ...(patch.position === undefined ? {} : { position: patch.position }),
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.url === undefined ? {} : { url: patch.url }),
        ...(!('startSec' in patch) ? {} : { startSec: patch.startSec ?? null }),
        ...(!('endSec' in patch) ? {} : { endSec: patch.endSec ?? null }),
        ...(patch.note === undefined ? {} : { note: patch.note }),
      }),
    })
  },

  async remove(projectId: string, id: string) {
    await apiRequest<void>(`/projects/${projectId}/pois/${id}`, {
      method: 'DELETE', headers: await apiHeaders(),
    })
  },
}
