import { API_BASE_URL, apiHeaders } from '@/lib/apiClient'

export interface PacificPowerLiveEvent {
  id: string
  type: string
  projectId: string | null
  resource: string
  method: string
  path: string
  requestId: string
  occurredAt: string
}

export type LiveConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'stopped'

export function subscribeLiveEvents(options: {
  projectId?: string
  onEvent: (event: PacificPowerLiveEvent) => void
  onStatus?: (status: LiveConnectionStatus) => void
}) {
  if (!API_BASE_URL) return () => undefined
  const controller = new AbortController()
  let stopped = false

  async function run() {
    let firstAttempt = true
    while (!stopped) {
      options.onStatus?.(firstAttempt ? 'connecting' : 'reconnecting')
      firstAttempt = false
      try {
        const headers = new Headers(await apiHeaders())
        headers.set('Accept', 'text/event-stream')
        headers.delete('Content-Type')
        const query = options.projectId ? `?projectId=${encodeURIComponent(options.projectId)}` : ''
        const response = await fetch(`${API_BASE_URL}/events/stream${query}`, {
          headers, signal: controller.signal, cache: 'no-store',
        })
        if (!response.ok || !response.body) throw new Error(`Live events unavailable (${response.status})`)
        options.onStatus?.('connected')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!stopped) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split(/\r?\n\r?\n/)
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            if (!frame || frame.startsWith(':')) continue
            const eventName = frame.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim()
            const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
            if (eventName !== 'change' || !data) continue
            try { options.onEvent(JSON.parse(data) as PacificPowerLiveEvent) } catch { /* ignore malformed event */ }
          }
        }
      } catch (error) {
        if (stopped || controller.signal.aborted) break
      }
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }

  void run()
  return () => {
    stopped = true
    controller.abort()
    options.onStatus?.('stopped')
  }
}
