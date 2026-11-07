import { describe, expect, it } from 'vitest'
import { registrationErrorMessage, validateRegistration } from './registration'

describe('帳號註冊驗證', () => {
  it('接受完整且安全的註冊資料', () => {
    expect(validateRegistration({
      displayName: '王小明', email: 'user@example.com', password: 'Secure123', confirmPassword: 'Secure123',
    })).toEqual({})
  })

  it('拒絕弱密碼與不同的確認密碼', () => {
    expect(validateRegistration({
      displayName: '', email: 'not-an-email', password: 'password', confirmPassword: 'different',
    })).toEqual({
      displayName: '請輸入姓名。',
      email: '請輸入有效的 Email。',
      password: '密碼需包含英文大寫、小寫與數字。',
      confirmPassword: '兩次輸入的密碼不同。',
    })
  })

  it('將常見 Supabase 錯誤轉為清楚提示', () => {
    expect(registrationErrorMessage('User already registered')).toContain('已註冊')
    expect(registrationErrorMessage('Email rate limit exceeded')).toContain('稍後')
  })
})
