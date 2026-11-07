import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ currentSession: vi.fn(async () => null) }))

import { apiRequest } from './apiClient'

describe('apiRequest headers', () => {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('removes JSON content type for requests without a body', async () => {
    await apiRequest('/schedule/recalculate', { method: 'POST' })
    const init = fetchMock.mock.calls[0]![1]!
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)
  })

  it('keeps JSON content type when a body is present', async () => {
    await apiRequest('/daily-reports', { method: 'POST', body: JSON.stringify({ ok: true }) })
    const init = fetchMock.mock.calls[0]![1]!
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })
})
