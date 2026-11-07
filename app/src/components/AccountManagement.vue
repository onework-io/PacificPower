<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS,
  type AccountRole, type AccountStatus, type AccountSummary, type PermissionEffect,
} from '@/data/accounts'
import { accountRepository, type RegistrationRequest } from '@/lib/accountRepository'
import AuditLogView from '@/components/AuditLogView.vue'
import SystemStatusView from '@/components/SystemStatusView.vue'

const props = defineProps<{ permissions?: string[] }>()
defineEmits<{ back: [] }>()

const can = (permission: string) => !props.permissions || props.permissions.includes(permission)
const canCreate = computed(() => can('account.create'))
const canEdit = computed(() => can('account.edit'))
const canManagePermissions = computed(() => can('account.permission.manage'))

const accounts = ref(accountRepository.load())
const selectedId = ref(accounts.value[0]?.id ?? '')
const cloneAccount = (account: AccountSummary): AccountSummary => ({
  ...account,
  overrides: { ...account.overrides },
})
const draft = ref<AccountSummary | null>(accounts.value[0] ? cloneAccount(accounts.value[0]) : null)
const query = ref('')
const roleFilter = ref<'all' | AccountRole>('all')
const isNew = ref(false)
const message = ref(accountRepository.apiEnabled ? '正在連接帳號 API…' : '本機權限示範資料')
const saving = ref(false)
const registrationRequests = ref<RegistrationRequest[]>([])
const approvalRoles = ref<Record<string, AccountRole>>({})
const approvingId = ref('')
const view = ref<'accounts' | 'audit' | 'system'>('accounts')
const viewCopy = computed(() => view.value === 'accounts'
  ? { eyebrow: 'ACCESS CONTROL', title: '帳號與權限', description: '使用角色範本，再針對個別帳號允許或禁止功能。' }
  : view.value === 'audit'
    ? { eyebrow: 'AUDIT & COMPLIANCE', title: '操作紀錄', description: '集中檢視平台重要操作與資料異動差異。' }
    : { eyebrow: 'PLATFORM OPERATIONS', title: '系統狀態', description: '檢查 API、資料庫、即時連線與物件儲存設定。' })

const filtered = computed(() => accounts.value.filter((account) => {
  const keyword = query.value.trim().toLowerCase()
  return (roleFilter.value === 'all' || account.role === roleFilter.value)
    && (!keyword || `${account.displayName} ${account.email} ${account.department} ${account.crewName}`.toLowerCase().includes(keyword))
}))
const activeCount = computed(() => accounts.value.filter((account) => account.status === 'active').length)
const mfaCount = computed(() => accounts.value.filter((account) => account.mfaEnabled).length)
const groups = computed(() => [...new Set(PERMISSIONS.map((permission) => permission.module))])

function select(account: AccountSummary) {
  selectedId.value = account.id
  draft.value = cloneAccount(account)
  isNew.value = false
}

function newAccount() {
  if (!canCreate.value) return
  isNew.value = true
  selectedId.value = ''
  draft.value = {
    id: crypto.randomUUID(), email: '', displayName: '', role: 'worker', status: 'invited',
    department: '', crewName: '', mfaEnabled: false, overrides: {},
  }
}

function permissionEffect(code: string): PermissionEffect {
  return draft.value?.overrides[code] ?? 'inherit'
}

function setPermission(code: string, effect: PermissionEffect) {
  if (!draft.value) return
  if (effect === 'inherit') delete draft.value.overrides[code]
  else draft.value.overrides[code] = effect
}

function effectiveAllowed(code: string) {
  if (!draft.value) return false
  const override = draft.value.overrides[code]
  if (override) return override === 'allow'
  return PERMISSIONS.find((permission) => permission.code === code)?.roles.includes(draft.value.role) ?? false
}

async function save() {
  if (!draft.value) return
  if (isNew.value && !canCreate.value) return
  if (!isNew.value && !canEdit.value && !canManagePermissions.value) return
  saving.value = true
  try {
    const saved = !isNew.value && !canEdit.value
      ? (await accountRepository.persistPermissions(draft.value), draft.value)
      : await accountRepository.persist(draft.value, isNew.value, canManagePermissions.value)
    const index = accounts.value.findIndex((account) => account.id === saved.id || account.id === draft.value?.id)
    if (index >= 0) accounts.value[index] = saved
    else accounts.value.unshift(saved)
    selectedId.value = saved.id
    draft.value = cloneAccount(saved)
    isNew.value = false
    accountRepository.save(accounts.value)
    message.value = accountRepository.apiEnabled ? '帳號與權限已同步' : '帳號與權限已儲存於本機'
  } catch (error) {
    message.value = error instanceof Error ? `儲存失敗：${error.message}` : '儲存失敗'
  } finally { saving.value = false }
}

async function approveRegistration(request: RegistrationRequest) {
  approvingId.value = request.id
  try {
    const account = await accountRepository.approveRegistration(
      request.id,
      approvalRoles.value[request.id] ?? 'worker',
    )
    accounts.value.unshift(account)
    registrationRequests.value = registrationRequests.value.filter((item) => item.id !== request.id)
    select(account)
    message.value = `${request.displayName} 已核准並啟用`
  } catch (error) {
    message.value = error instanceof Error ? `核准失敗：${error.message}` : '核准失敗'
  } finally { approvingId.value = '' }
}

onMounted(async () => {
  if (!accountRepository.apiEnabled) return
  try {
    const [remote, requests] = await Promise.all([
      accountRepository.loadRemote(),
      canCreate.value ? accountRepository.loadRegistrationRequests() : Promise.resolve([]),
    ])
    registrationRequests.value = requests
    approvalRoles.value = Object.fromEntries(requests.map((request) => [request.id, request.suggestedRole ?? 'worker']))
    if (remote) {
      accounts.value = remote
      if (remote[0]) select(remote[0])
      message.value = '已連接正式帳號資料'
    }
  } catch (error) {
    message.value = error instanceof Error ? `帳號 API 未連線：${error.message}` : '帳號 API 未連線'
  }
})

const statusLabels: Record<AccountStatus, string> = {
  invited: '待啟用', active: '使用中', suspended: '暫停', locked: '已鎖定', disabled: '已停用',
}
</script>

<template>
  <section class="accounts-page">
    <header class="accounts-top">
      <div class="brand"><div class="brand-mark">P</div><div><strong>PACIFICPOWER</strong><small>帳號與權限管理</small></div></div>
      <button class="back-button" @click="$emit('back')">← 返回專案總覽</button>
    </header>

    <main class="accounts-main">
      <div class="page-heading">
        <div><p>{{ viewCopy.eyebrow }}</p><h1>{{ viewCopy.title }}</h1><span>{{ viewCopy.description }}</span></div>
        <div class="heading-actions"><small>{{ view === 'accounts' ? message : view === 'audit' ? '唯讀稽核資料' : '每 30 秒自動更新' }}</small><template v-if="can('audit.view')"><button type="button" :class="{ active: view === 'accounts' }" @click="view = 'accounts'">帳號管理</button><button type="button" :class="{ active: view === 'audit' }" @click="view = 'audit'">操作紀錄</button><button type="button" :class="{ active: view === 'system' }" @click="view = 'system'">系統狀態</button></template><button v-if="view === 'accounts' && canCreate" class="primary" @click="newAccount">＋ 新增帳號</button></div>
      </div>

      <AuditLogView v-if="view === 'audit'" />
      <SystemStatusView v-if="view === 'system'" />

      <div v-if="view === 'accounts'" class="account-metrics">
        <article><span>全部帳號</span><strong>{{ accounts.length }}</strong></article>
        <article><span>使用中</span><strong>{{ activeCount }}</strong></article>
        <article><span>已啟用 MFA</span><strong>{{ mfaCount }}</strong></article>
        <article><span>角色範本</span><strong>4</strong></article>
      </div>

      <section v-if="view === 'accounts' && canCreate && registrationRequests.length" class="registration-queue">
        <div class="queue-heading"><div><strong>待審核註冊申請</strong><span>{{ registrationRequests.length }} 筆申請需要設定角色</span></div><b>{{ registrationRequests.length }}</b></div>
        <div class="queue-list">
          <article v-for="request in registrationRequests" :key="request.id">
            <i>{{ request.displayName.slice(0, 1) }}</i>
            <span><strong>{{ request.displayName }} <em v-if="request.preprovisioned">已預先設定</em></strong><small>{{ request.email }}</small></span>
            <select v-model="approvalRoles[request.id]"><option value="admin">Admin</option><option value="planner">Planner</option><option value="manager">Manager</option><option value="worker">Worker</option></select>
            <button type="button" :disabled="approvingId === request.id" @click="approveRegistration(request)">{{ approvingId === request.id ? '核准中…' : '核准帳號' }}</button>
          </article>
        </div>
      </section>

      <div v-if="view === 'accounts'" class="account-workspace">
        <aside class="account-list">
          <div class="list-tools"><input v-model="query" placeholder="搜尋姓名、Email 或工班" /><select v-model="roleFilter"><option value="all">全部角色</option><option value="admin">Admin</option><option value="planner">Planner</option><option value="manager">Manager</option><option value="worker">Worker</option></select></div>
          <button v-for="account in filtered" :key="account.id" class="account-row" :class="{ active: selectedId === account.id }" @click="select(account)">
            <i>{{ account.displayName.slice(0, 1) }}</i><span><strong>{{ account.displayName }}</strong><small>{{ account.email }}</small><em>{{ ROLE_LABELS[account.role] }}</em></span><b :data-status="account.status">{{ statusLabels[account.status] }}</b>
          </button>
          <div v-if="!filtered.length" class="empty-list">找不到符合條件的帳號</div>
        </aside>

        <form v-if="draft" class="account-editor" @submit.prevent="save">
          <div class="editor-head"><div><span>{{ isNew ? 'NEW ACCOUNT' : 'ACCOUNT SETTINGS' }}</span><h2>{{ isNew ? '新增帳號' : draft.displayName }}</h2></div><button v-if="isNew ? canCreate : (canEdit || canManagePermissions)" class="save" type="submit" :disabled="saving">{{ saving ? '儲存中…' : '儲存設定' }}</button></div>

          <section class="profile-section">
            <h3>帳號資料</h3>
            <p v-if="isNew" class="invitation-note">先建立待啟用帳號與權限。使用者以相同 Email 完成註冊後，Admin 核准即可啟用，原先設定的個別權限會保留。</p>
            <div class="form-grid">
              <label><span>姓名</span><input v-model.trim="draft.displayName" required maxlength="120" :disabled="!isNew && !canEdit" /></label>
              <label><span>Email</span><input v-model.trim="draft.email" required type="email" :disabled="!isNew" /></label>
              <label><span>部門</span><input v-model.trim="draft.department" maxlength="120" :disabled="!isNew && !canEdit" /></label>
              <label><span>工班</span><input v-model.trim="draft.crewName" maxlength="120" placeholder="Worker 可指定工班" :disabled="!isNew && !canEdit" /></label>
              <label><span>角色範本</span><select v-model="draft.role" :disabled="!isNew && !canEdit"><option value="admin">Admin 系統管理員</option><option value="planner">Planner 進度規劃員</option><option value="manager">Manager 專案管理者</option><option value="worker">Worker 現場人員</option></select></label>
              <label><span>帳號狀態</span><select v-model="draft.status" :disabled="isNew || !canEdit"><option value="invited">待啟用</option><option value="active">使用中</option><option value="suspended">暫停</option><option value="locked">已鎖定</option><option value="disabled">已停用</option></select></label>
            </div>
            <div class="role-note"><strong>{{ ROLE_LABELS[draft.role] }}</strong><span>{{ ROLE_DESCRIPTIONS[draft.role] }}</span><small>個別權限的「禁止」會優先於角色範本。</small></div>
          </section>

          <section class="permission-section">
            <div class="permission-heading"><div><h3>功能訪問權限</h3><p>繼承角色、個別允許或個別禁止。</p></div><div class="legend"><span class="allowed">● 有效允許</span><span class="denied">● 有效禁止</span></div></div>
            <div v-for="group in groups" :key="group" class="permission-group">
              <h4>{{ group }}</h4>
              <div class="permission-grid">
                <label v-for="permission in PERMISSIONS.filter((item) => item.module === group)" :key="permission.code" :class="{ denied: !effectiveAllowed(permission.code) }">
                  <span><strong>{{ permission.name }} <i v-if="permission.sensitive">敏感</i></strong><small>{{ permission.code }}</small></span>
                  <select :value="permissionEffect(permission.code)" :disabled="!canManagePermissions" @change="setPermission(permission.code, ($event.target as HTMLSelectElement).value as PermissionEffect)"><option value="inherit">繼承角色</option><option value="allow">個別允許</option><option value="deny">個別禁止</option></select>
                  <b>{{ effectiveAllowed(permission.code) ? '允許' : '禁止' }}</b>
                </label>
              </div>
            </div>
          </section>
        </form>
      </div>
    </main>
  </section>
</template>

<style scoped>
.accounts-page{min-height:100%;overflow:auto;background:radial-gradient(circle at 85% 0,#17324c 0,transparent 32%),#091321;color:#e8eef7}.accounts-top{position:sticky;z-index:10;top:0;height:70px;padding:0 clamp(24px,4vw,64px);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #263750;background:#0b1524ea;backdrop-filter:blur(18px)}.brand{display:flex;align-items:center;gap:12px}.brand-mark{width:36px;height:36px;display:grid;place-items:center;border:1px solid #4cc2ff66;border-radius:10px;background:#4cc2ff18;color:#4cc2ff;font-size:20px}.brand strong,.brand small{display:block}.brand small{color:#8294ae;font-size:10px}.back-button{color:#8acff1}.accounts-main{width:min(1500px,calc(100% - 48px));margin:auto;padding:38px 0 60px}.page-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.page-heading p{margin:0;color:#4cc2ff;font-size:10px;letter-spacing:.18em}.page-heading h1{margin:4px 0;font-size:30px}.page-heading span{color:#8fa1b9;font-size:13px}.heading-actions{display:flex;align-items:center;gap:12px}.heading-actions small{color:#7f93ad}.primary,.save{border:0;background:#4cc2ff;color:#07121e;font-weight:700}.account-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:25px 0}.account-metrics article{padding:15px 18px;border:1px solid #263750;border-radius:10px;background:#111d30}.account-metrics span{display:block;color:#7f92ac;font-size:10px}.account-metrics strong{display:block;margin-top:4px;font-size:23px}.registration-queue{margin:-8px 0 24px;border:1px solid #3e5877;border-radius:12px;background:#101d30;overflow:hidden}.queue-heading{display:flex;justify-content:space-between;align-items:center;padding:14px 17px;border-bottom:1px solid #2a3e59}.queue-heading div>*{display:block}.queue-heading span{margin-top:3px;color:#8295ad;font-size:10px}.queue-heading b{min-width:26px;padding:4px 8px;border-radius:99px;text-align:center;color:#06121d;background:#fbbf24}.queue-list article{display:grid;grid-template-columns:36px minmax(180px,1fr) 145px 100px;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #22344c}.queue-list article:last-child{border-bottom:0}.queue-list i{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;color:#8edaff;background:#21425d;font-style:normal}.queue-list span>*{display:block}.queue-list small{margin-top:3px;color:#8295ad}.queue-list select{height:35px;padding:0 8px;border:1px solid #30445f;border-radius:7px;color:#dce7f4;background:#101d30}.queue-list button{border-color:#4cc2ff;color:#4cc2ff}.account-workspace{display:grid;grid-template-columns:340px minmax(0,1fr);min-height:650px;border:1px solid #263750;border-radius:14px;background:#0e1929;overflow:hidden}.account-list{border-right:1px solid #263750;background:#0c1727}.list-tools{display:grid;grid-template-columns:1fr 100px;gap:7px;padding:14px;border-bottom:1px solid #263750}.list-tools input,.list-tools select,.form-grid input,.form-grid select,.permission-grid select{min-width:0;border:1px solid #30445f;border-radius:7px;background:#101d30;color:#dce7f4;outline:0}.list-tools input,.list-tools select{height:36px;padding:0 9px}.account-row{width:100%;display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:10px;padding:13px 14px;border:0;border-bottom:1px solid #1f2d42;border-radius:0;text-align:left}.account-row:hover,.account-row.active{background:#172940;color:inherit}.account-row.active{box-shadow:inset 3px 0 #4cc2ff}.account-row>i{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:#23445f;color:#83d7ff;font-style:normal}.account-row span>*{display:block}.account-row strong{font-size:12px}.account-row small{margin-top:2px;color:#8295ad;font-size:9px}.account-row em{margin-top:4px;color:#4cc2ff;font-size:8px;font-style:normal}.account-row>b{padding:3px 6px;border-radius:99px;background:#193c31;color:#74dfb2;font-size:8px}.account-row>b[data-status=disabled],.account-row>b[data-status=locked]{background:#4b1f29;color:#fda4af}.account-row>b[data-status=invited],.account-row>b[data-status=suspended]{background:#4a381b;color:#fcd77d}.empty-list{padding:50px 20px;text-align:center;color:#7f91a9}.account-editor{padding:24px;overflow:auto}.editor-head{display:flex;align-items:flex-start;justify-content:space-between}.editor-head>div>span{color:#4cc2ff;font-size:8px;letter-spacing:.16em}.editor-head h2{margin:4px 0 0}.save{padding:9px 15px}.profile-section,.permission-section{margin-top:20px;padding:18px;border:1px solid #293b55;border-radius:11px;background:#111d2f}.profile-section h3,.permission-section h3{margin:0 0 13px;font-size:14px}.form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.form-grid label>span{display:block;margin-bottom:5px;color:#8fa1b8;font-size:9px}.form-grid input,.form-grid select{width:100%;height:38px;padding:0 10px}.form-grid input:disabled{opacity:.55}.role-note{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin-top:14px;padding:11px 13px;border-radius:8px;background:#17283c}.role-note strong{color:#77d4ff;font-size:10px}.role-note span{font-size:10px}.role-note small{grid-column:1/-1;color:#8598b0;font-size:9px}.permission-heading{display:flex;justify-content:space-between;align-items:flex-start}.permission-heading h3{margin-bottom:3px}.permission-heading p{margin:0;color:#8194ad;font-size:10px}.legend{display:flex;gap:10px;font-size:9px}.legend .allowed{color:#6ee7b7}.legend .denied{color:#fb7185}.permission-group{margin-top:18px}.permission-group h4{margin:0 0 8px;color:#9fb1c7;font-size:10px;letter-spacing:.05em}.permission-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.permission-grid label{display:grid;grid-template-columns:1fr 105px 40px;align-items:center;gap:8px;padding:9px 10px;border:1px solid #2c4059;border-radius:8px;background:#14243a}.permission-grid label.denied{opacity:.72}.permission-grid span>*{display:block}.permission-grid strong{font-size:10px}.permission-grid strong i{display:inline;padding:1px 4px;border-radius:3px;background:#6a381f;color:#fdba74;font-size:7px;font-style:normal}.permission-grid small{margin-top:2px;color:#71849d;font-size:7px}.permission-grid select{height:30px;padding:0 6px;font-size:9px}.permission-grid b{color:#6ee7b7;font-size:9px}.permission-grid label.denied b{color:#fb7185}@media(max-width:1000px){.account-workspace{grid-template-columns:280px 1fr}.form-grid{grid-template-columns:1fr 1fr}.permission-grid{grid-template-columns:1fr}.queue-list article{grid-template-columns:36px 1fr 130px 96px}}@media(max-width:720px){.accounts-main{width:calc(100% - 24px)}.account-metrics{grid-template-columns:1fr 1fr}.account-workspace{grid-template-columns:1fr}.account-list{max-height:320px;border-right:0;border-bottom:1px solid #263750}.form-grid{grid-template-columns:1fr}.page-heading{align-items:flex-start;flex-direction:column}.heading-actions{width:100%;justify-content:space-between}.queue-list article{grid-template-columns:34px 1fr}.queue-list select,.queue-list button{grid-column:2}}
.queue-list strong em{display:inline;margin-left:6px;padding:2px 5px;border-radius:4px;background:#1d4c3d;color:#78e2b2;font-size:8px;font-style:normal}
.invitation-note{margin:-4px 0 14px;padding:9px 11px;border-left:3px solid #4cc2ff;border-radius:4px;background:#15283b;color:#9eb4cc;font-size:10px;line-height:1.6}
.form-grid select:disabled{opacity:.55}
.heading-actions button.active{border-color:#4cc2ff;background:#4cc2ff18;color:#8bdcff}
</style>
