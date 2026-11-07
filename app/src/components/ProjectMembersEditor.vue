<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { apiHeaders, apiRequest } from '@/lib/apiClient'

type AccountRole = 'planner' | 'manager' | 'worker'
type MemberRole = AccountRole | 'viewer'

interface ProjectMemberCandidate {
  id: string
  email: string
  displayName: string
  department: string
  crewName: string
  accountRole: AccountRole
  assignedRole: MemberRole | null
}

const props = defineProps<{ projectId: string }>()
const members = ref<ProjectMemberCandidate[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const error = ref('')
const assignedCount = computed(() => members.value.filter((member) => member.assignedRole).length)

const roleLabel: Record<MemberRole, string> = {
  planner: 'Planner 規劃', manager: 'Manager 管理', worker: 'Worker 現場', viewer: '業主唯讀',
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    members.value = await apiRequest<ProjectMemberCandidate[]>(`/projects/${props.projectId}/members`, {
      headers: await apiHeaders(),
    })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法讀取專案成員'
  } finally {
    loading.value = false
  }
}

function toggle(member: ProjectMemberCandidate, checked: boolean) {
  member.assignedRole = checked ? member.accountRole : null
  message.value = ''
}

async function save() {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    members.value = await apiRequest<ProjectMemberCandidate[]>(`/projects/${props.projectId}/members`, {
      method: 'PUT',
      headers: await apiHeaders(),
      body: JSON.stringify({
        members: members.value
          .filter((member) => member.assignedRole)
          .map((member) => ({ userId: member.id, role: member.assignedRole })),
      }),
    })
    message.value = `已儲存 ${assignedCount.value} 位專案成員`
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '專案成員儲存失敗'
  } finally {
    saving.value = false
  }
}

watch(() => props.projectId, () => { void load() })
onMounted(() => { void load() })
</script>

<template>
  <section class="members-editor">
    <header>
      <div><span>PROJECT MEMBERS</span><strong>專案成員與職責</strong></div>
      <small>已指派 {{ assignedCount }} 人</small>
    </header>
    <p>指定專案職責；「業主唯讀」只開放此專案的 3D、WBS、進度與總覽報表，不能修改或回報資料。</p>
    <div v-if="loading" class="state">讀取可用帳號…</div>
    <div v-else-if="members.length" class="member-list">
      <article v-for="member in members" :key="member.id" :class="{ active: member.assignedRole }">
        <input
          type="checkbox"
          :checked="Boolean(member.assignedRole)"
          :aria-label="`指派 ${member.displayName}`"
          @change="toggle(member, ($event.target as HTMLInputElement).checked)"
        />
        <div><strong>{{ member.displayName }}</strong><small>{{ member.email }}<template v-if="member.department"> · {{ member.department }}</template><template v-if="member.crewName"> · {{ member.crewName }}</template></small></div>
        <select v-model="member.assignedRole" :disabled="!member.assignedRole" :aria-label="`${member.displayName} 專案角色`">
          <option value="planner">Planner 規劃</option>
          <option value="manager">Manager 管理</option>
          <option value="worker">Worker 現場</option>
          <option value="viewer">業主唯讀</option>
        </select>
        <em>{{ roleLabel[member.accountRole] }}</em>
      </article>
    </div>
    <div v-else class="state">目前沒有可指派的 Planner、Manager 或 Worker 帳號。</div>
    <div class="members-editor__footer">
      <span v-if="error" class="error">{{ error }}</span><span v-else class="success">{{ message }}</span>
      <button type="button" :disabled="loading || saving" @click="save">{{ saving ? '儲存中…' : '儲存成員設定' }}</button>
    </div>
  </section>
</template>

<style scoped>
.members-editor{margin-top:18px;padding:14px;border:1px solid #293b55;border-radius:10px;background:#0c1728}.members-editor header{display:flex;align-items:end;justify-content:space-between;gap:16px}.members-editor header span,.members-editor header strong{display:block}.members-editor header span{color:#4cc2ff;font-size:8px;letter-spacing:.16em}.members-editor header strong{margin-top:3px;font-size:13px}.members-editor header small,.members-editor>p,.state{color:#7f91aa;font-size:9px}.members-editor>p{margin:8px 0 11px;line-height:1.55}.member-list{display:grid;gap:6px;max-height:230px;overflow:auto}.member-list article{display:grid;grid-template-columns:auto minmax(0,1fr) 130px auto;align-items:center;gap:9px;padding:8px 10px;border:1px solid #253750;border-radius:7px;background:#0a1423}.member-list article.active{border-color:#4cc2ff66;background:#10243a}.member-list strong,.member-list small{display:block}.member-list strong{font-size:10px}.member-list small{margin-top:2px;overflow:hidden;color:#71859f;font-size:8px;text-overflow:ellipsis;white-space:nowrap}.member-list select{width:100%;padding:5px 6px;border:1px solid #36506d;border-radius:5px;background:#101d30;color:#dce8f5;font-size:9px}.member-list select:disabled{opacity:.45}.member-list em{color:#617690;font-size:8px;font-style:normal}.state{padding:18px;text-align:center;border:1px dashed #2c405a;border-radius:7px}.members-editor__footer{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:10px}.members-editor__footer span{margin-right:auto;font-size:9px}.members-editor__footer button{padding:6px 10px;border-color:#4cc2ff77;color:#8edcff;font-size:9px}.error{color:#fb7185}.success{color:#6ee7b7}@media(max-width:620px){.member-list article{grid-template-columns:auto 1fr}.member-list select,.member-list em{grid-column:2}}
</style>
