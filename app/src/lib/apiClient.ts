import { currentSession } from '@/lib/supabase'

export const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const API_ORGANIZATION_ID = String(import.meta.env.VITE_API_ORGANIZATION_ID ?? '')
const API_USER_ID = String(import.meta.env.VITE_API_USER_ID ?? '')

export async function apiHeaders(extra: Record<string, string> = {}) {
  const session = await currentSession()
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(API_ORGANIZATION_ID ? { 'X-Organization-Id': API_ORGANIZATION_ID } : {}),
    ...(!session?.access_token && API_USER_ID ? { 'X-User-Id': API_USER_ID } : {}),
    ...extra,
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? await apiHeaders())
  if (init.body == null) headers.delete('Content-Type')
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { message?: string; detail?: string }
    throw new Error(problem.detail ?? problem.message ?? `API request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
