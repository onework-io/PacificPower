const DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const CACHE_KEY = 'pacificpower-geocoding-cache-v1'
const MIN_REQUEST_INTERVAL_MS = 1_050

export interface GeocodingResult {
  lat: number
  lng: number
  displayName: string
}

interface NominatimResult {
  lat?: string
  lon?: string
  display_name?: string
}

let lastRequestAt = 0

function readCache(): Record<string, GeocodingResult> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, GeocodingResult>
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, GeocodingResult>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Cache failure must not block a user-triggered location lookup.
  }
}

function endpoint() {
  return import.meta.env.VITE_GEOCODING_ENDPOINT || DEFAULT_ENDPOINT
}

export async function geocodeTaiwanAddress(
  address: string,
  fetcher: typeof fetch = fetch,
): Promise<GeocodingResult | null> {
  const query = address.trim()
  if (!query) return null
  const cacheKey = query.toLocaleLowerCase('zh-TW')
  const cache = readCache()
  if (cache[cacheKey]) return cache[cacheKey]

  const delay = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now())
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  lastRequestAt = Date.now()

  const url = new URL(endpoint())
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('countrycodes', 'tw')
  url.searchParams.set('accept-language', 'zh-TW')

  const response = await fetcher(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`地址服務暫時無法使用（${response.status}）`)
  const [match] = await response.json() as NominatimResult[]
  if (!match?.lat || !match.lon) return null

  const result = {
    lat: Number(match.lat),
    lng: Number(match.lon),
    displayName: match.display_name || query,
  }
  if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) return null
  cache[cacheKey] = result
  writeCache(cache)
  return result
}
