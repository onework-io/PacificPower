import { describe, expect, it, vi } from 'vitest'
import { geocodeTaiwanAddress } from './geocoding'

describe('Taiwan address geocoding', () => {
  it('uses a Taiwan-only search and normalizes the result', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input))
      expect(url.searchParams.get('countrycodes')).toBe('tw')
      expect(url.searchParams.get('limit')).toBe('1')
      expect(url.searchParams.get('q')).toBe('台北市內湖區瑞光路 123 號')
      return new Response(JSON.stringify([{
        lat: '25.0761', lon: '121.5751', display_name: '台北市內湖區瑞光路123號, 臺灣',
      }]), { status: 200 })
    }) as unknown as typeof fetch

    await expect(geocodeTaiwanAddress(' 台北市內湖區瑞光路 123 號 ', fetcher)).resolves.toEqual({
      lat: 25.0761, lng: 121.5751, displayName: '台北市內湖區瑞光路123號, 臺灣',
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('returns null when no matching address is found', async () => {
    const fetcher = vi.fn(async () => new Response('[]', { status: 200 })) as unknown as typeof fetch
    await expect(geocodeTaiwanAddress('無法識別的測試地址', fetcher)).resolves.toBeNull()
  })
})
