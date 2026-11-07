<script setup lang="ts">
import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { registrationErrorMessage, validateRegistration, type RegistrationErrors } from '@/lib/registration'

const mode = ref<'login' | 'register'>('login')
const displayName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const busy = ref(false)
const errorMessage = ref('')
const infoMessage = ref('')
const fieldErrors = ref<RegistrationErrors>({})

const passwordStrength = computed(() => {
  const value = password.value
  return [value.length >= 8, /[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value)]
    .filter(Boolean).length
})

function switchMode(next: 'login' | 'register') {
  mode.value = next
  password.value = ''
  confirmPassword.value = ''
  errorMessage.value = ''
  infoMessage.value = ''
  fieldErrors.value = {}
}

async function signIn() {
  if (!supabase || !email.value.trim() || !password.value) return
  busy.value = true
  errorMessage.value = ''
  infoMessage.value = ''
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value.trim().toLowerCase(), password: password.value,
  })
  if (error) errorMessage.value = error.message === 'Invalid login credentials'
    ? 'Email 或密碼錯誤。'
    : error.message
  busy.value = false
}

async function signUp() {
  if (!supabase) return
  fieldErrors.value = validateRegistration({
    displayName: displayName.value,
    email: email.value,
    password: password.value,
    confirmPassword: confirmPassword.value,
  })
  if (Object.keys(fieldErrors.value).length) return

  busy.value = true
  errorMessage.value = ''
  infoMessage.value = ''
  const { data, error } = await supabase.auth.signUp({
    email: email.value.trim().toLowerCase(),
    password: password.value,
    options: {
      data: { display_name: displayName.value.trim() },
      emailRedirectTo: window.location.origin,
    },
  })
  if (error) errorMessage.value = registrationErrorMessage(error.message)
  else {
    infoMessage.value = data.session
      ? '註冊完成。帳號需由 PacificPower 管理員設定組織與角色後才能使用專案功能。'
      : '註冊申請已送出，請至信箱完成 Email 驗證；之後仍需由管理員核准平台權限。'
    password.value = ''
    confirmPassword.value = ''
  }
  busy.value = false
}

async function resetPassword() {
  if (!supabase || !email.value.trim()) {
    errorMessage.value = '請先輸入 Email。'
    return
  }
  busy.value = true
  errorMessage.value = ''
  const { error } = await supabase.auth.resetPasswordForEmail(email.value.trim().toLowerCase(), {
    redirectTo: window.location.origin,
  })
  if (error) errorMessage.value = error.message
  else infoMessage.value = '密碼重設信已寄出，請檢查信箱。'
  busy.value = false
}
</script>

<template>
  <main class="auth-gate">
    <section class="auth-card">
      <img class="pisg-brand-logo" src="/branding/pisg-logo.png" alt="PISG" />
      <p class="auth-eyebrow">PISG PROJECT CONTROL</p>
      <h1>{{ mode === 'login' ? '工程數位管理平台' : '申請 PacificPower 帳號' }}</h1>
      <p class="auth-lead">{{ mode === 'login'
        ? '登入後依帳號角色存取專案、WBS、3D 模型與現場進度。'
        : '完成 Email 驗證後，由管理員設定所屬組織、角色與專案權限。' }}</p>
      <div class="auth-tabs" role="tablist" aria-label="帳號操作">
        <button type="button" :class="{ active: mode === 'login' }" @click="switchMode('login')">登入</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="switchMode('register')">註冊</button>
      </div>
      <form v-if="mode === 'login'" @submit.prevent="signIn">
        <label>Email<input v-model="email" type="email" autocomplete="username" required /></label>
        <label>密碼<input v-model="password" type="password" autocomplete="current-password" required /></label>
        <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>
        <p v-if="infoMessage" class="auth-info">{{ infoMessage }}</p>
        <button class="auth-submit" type="submit" :disabled="busy">{{ busy ? '登入中…' : '登入' }}</button>
        <button class="auth-reset" type="button" :disabled="busy" @click="resetPassword">忘記密碼</button>
      </form>
      <form v-else @submit.prevent="signUp">
        <label>姓名<input v-model="displayName" type="text" autocomplete="name" required /><small v-if="fieldErrors.displayName">{{ fieldErrors.displayName }}</small></label>
        <label>Email<input v-model="email" type="email" autocomplete="email" required /><small v-if="fieldErrors.email">{{ fieldErrors.email }}</small></label>
        <label>密碼<input v-model="password" type="password" autocomplete="new-password" required /><small v-if="fieldErrors.password">{{ fieldErrors.password }}</small></label>
        <div class="strength" :data-score="passwordStrength"><i v-for="n in 4" :key="n"></i><span>至少 8 字元，包含英文大小寫與數字</span></div>
        <label>確認密碼<input v-model="confirmPassword" type="password" autocomplete="new-password" required /><small v-if="fieldErrors.confirmPassword">{{ fieldErrors.confirmPassword }}</small></label>
        <div class="approval-note"><strong>權限核准機制</strong><span>註冊不會自動取得任何專案資料；管理員核准後才可進入平台。</span></div>
        <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>
        <p v-if="infoMessage" class="auth-info">{{ infoMessage }}</p>
        <button class="auth-submit" type="submit" :disabled="busy">{{ busy ? '送出中…' : '建立帳號' }}</button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.auth-gate { min-height: 100%; display: grid; place-items: center; padding: 32px; background: radial-gradient(circle at 15% 10%, #3e4950 0, transparent 36%), linear-gradient(145deg, #1b2023, #272e32); }
.auth-card { width: min(430px, 100%); padding: 38px; border: 1px solid #47545c; border-radius: 18px; background: #252c30e8; box-shadow: 0 28px 80px #0008; }
.auth-brand { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 13px; color: #1b2022; background: var(--accent); font-size: 24px; font-weight: 900; }
.auth-eyebrow { margin: 22px 0 5px; color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .14em; }
h1 { margin: 0; font-size: 27px; }
.auth-lead { margin: 8px 0 28px; color: var(--muted); }
.auth-tabs { display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 20px; padding: 3px; border: 1px solid var(--line); border-radius: 9px; background: #1c2225; }
.auth-tabs button { border: 0; color: var(--muted); }
.auth-tabs button.active { color: #191e21; background: var(--accent); font-weight: 700; }
form, label { display: grid; gap: 8px; }
form { gap: 17px; }
label { color: #aebed2; font-size: 12px; font-weight: 600; }
label small { color: #fda4af; font-size: 10px; font-weight: 500; }
input { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 11px 12px; color: var(--text); background: #1c2225; outline: none; font: inherit; }
input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px #ffad7a1c; }
.auth-submit { min-height: 43px; border-color: var(--accent); color: #191e21; background: var(--accent); font-weight: 700; }
.auth-submit:disabled, .auth-reset:disabled { opacity: .55; cursor: default; }
.auth-reset { justify-self: center; border: 0; color: var(--muted); }
.auth-error, .auth-info { margin: -5px 0; padding: 9px 11px; border-radius: 7px; font-size: 12px; }
.auth-error { color: #fecdd3; background: #9f123944; }
.auth-info { color: #a7f3d0; background: #065f4644; }
.strength { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: -9px; }
.strength i { height: 3px; border-radius: 99px; background: #45525a; }
.strength[data-score="1"] i:nth-child(-n+1), .strength[data-score="2"] i:nth-child(-n+2) { background: #f59e0b; }
.strength[data-score="3"] i:nth-child(-n+3), .strength[data-score="4"] i:nth-child(-n+4) { background: #34d399; }
.strength span { grid-column: 1 / -1; color: #8b9ca6; font-size: 9px; }
.approval-note { display: grid; gap: 3px; padding: 10px 12px; border: 1px solid #445159; border-radius: 8px; color: #ffad7a; background: #2c3439; font-size: 10px; }
.approval-note span { color: #a7b4bb; }
</style>
