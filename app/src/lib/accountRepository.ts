import { DEFAULT_ACCOUNTS, type AccountSummary } from '@/data/accounts'
import { API_BASE_URL, apiHeaders, apiRequest } from '@/lib/apiClient'

const STORAGE_KEY = 'pacificpower-account-data-v1'

interface ApiOverride { permissionCode: string; effect: 'allow' | 'deny' }
interface ApiAccount extends Omit<AccountSummary, 'overrides' | 'lastLoginAt'> {
  overrides: ApiOverride[]
  lastLoginAt?: string | null
}

export interface RegistrationRequest {
  id: string
  email: string
  displayName: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  preprovisioned?: boolean
  suggestedRole?: AccountSummary['role']
}

function copy(accounts: AccountSummary[]) {
  return accounts.map((account) => ({ ...account, overrides: { ...account.overrides } }))
}

function fromApi(account: ApiAccount): AccountSummary {
  return {
    ...account,
    lastLoginAt: account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('zh-TW') : undefined,
    overrides: Object.fromEntries(account.overrides.map((item) => [item.permissionCode, item.effect])),
  }
}

export const accountRepository = {
  get apiEnabled() { return Boolean(API_BASE_URL) },

  load(): AccountSummary[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? copy(JSON.parse(stored) as AccountSummary[]) : copy(DEFAULT_ACCOUNTS)
    } catch { return copy(DEFAULT_ACCOUNTS) }
  },

  save(accounts: AccountSummary[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts))
  },

  async loadRemote() {
    if (!API_BASE_URL) return null
    const accounts = await apiRequest<ApiAccount[]>('/accounts', { headers: await apiHeaders() })
    return accounts.map(fromApi)
  },

  async loadRegistrationRequests(): Promise<RegistrationRequest[]> {
    if (!API_BASE_URL) return []
    return apiRequest<RegistrationRequest[]>('/accounts/registration-requests', { headers: await apiHeaders() })
  },

  async approveRegistration(requestId: string, role: AccountSummary['role']): Promise<AccountSummary> {
    const account = await apiRequest<ApiAccount>(`/accounts/registration-requests/${requestId}/approve`, {
      method: 'POST', headers: await apiHeaders(), body: JSON.stringify({ role }),
    })
    return fromApi({ ...account, overrides: account.overrides ?? [] })
  },

  async persistPermissions(account: AccountSummary) {
    if (!API_BASE_URL) return
    const overrides = Object.entries(account.overrides).map(([permissionCode, effect]) => ({ permissionCode, effect }))
    await apiRequest(`/accounts/${account.id}/permissions`, {
      method: 'PUT', headers: await apiHeaders(), body: JSON.stringify({ overrides }),
    })
  },

  async persist(account: AccountSummary, isNew: boolean, savePermissions = true): Promise<AccountSummary> {
    if (!API_BASE_URL) return account
    const saved = isNew
      ? await apiRequest<ApiAccount>('/accounts', {
        method: 'POST', headers: await apiHeaders(), body: JSON.stringify({
          email: account.email, displayName: account.displayName, role: account.role,
          phone: account.phone, department: account.department, crewName: account.crewName,
        }),
      })
      : await apiRequest<ApiAccount>(`/accounts/${account.id}`, {
        method: 'PATCH', headers: await apiHeaders(), body: JSON.stringify({
          displayName: account.displayName, role: account.role, status: account.status,
          phone: account.phone, department: account.department, crewName: account.crewName,
        }),
      })
    const overrides = Object.entries(account.overrides).map(([permissionCode, effect]) => ({ permissionCode, effect }))
    if (savePermissions) await this.persistPermissions({ ...account, id: saved.id })
    return { ...account, ...fromApi({ ...saved, overrides }) }
  },
}
