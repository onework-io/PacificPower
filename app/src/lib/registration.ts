export interface RegistrationInput {
  displayName: string
  email: string
  password: string
  confirmPassword: string
}

export interface RegistrationErrors {
  displayName?: string
  email?: string
  password?: string
  confirmPassword?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateRegistration(input: RegistrationInput): RegistrationErrors {
  const errors: RegistrationErrors = {}
  if (!input.displayName.trim()) errors.displayName = '請輸入姓名。'
  if (!EMAIL_PATTERN.test(input.email.trim())) errors.email = '請輸入有效的 Email。'
  if (input.password.length < 8) errors.password = '密碼至少需要 8 個字元。'
  else if (!/[a-z]/.test(input.password) || !/[A-Z]/.test(input.password) || !/\d/.test(input.password)) {
    errors.password = '密碼需包含英文大寫、小寫與數字。'
  }
  if (!input.confirmPassword) errors.confirmPassword = '請再次輸入密碼。'
  else if (input.confirmPassword !== input.password) errors.confirmPassword = '兩次輸入的密碼不同。'
  return errors
}

export function registrationErrorMessage(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return '此 Email 已註冊，請直接登入或使用忘記密碼。'
  }
  if (normalized.includes('rate limit')) return '嘗試次數過多，請稍後再試。'
  if (normalized.includes('password')) return '密碼不符合安全規則。'
  return message
}
