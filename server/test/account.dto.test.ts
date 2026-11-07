import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { CreateAccountDto, SetAccountPermissionsDto } from '../src/accounts/account.dto.js'

describe('account DTO validation', () => {
  it('accepts the four PacificPower roles and trims account fields', async () => {
    for (const role of ['admin', 'planner', 'manager', 'worker']) {
      const dto = plainToInstance(CreateAccountDto, {
        email: `${role}@pacificpower.com.tw`, displayName: ' 測試帳號 ', role,
      })
      expect(await validate(dto)).toHaveLength(0)
      expect(dto.displayName).toBe('測試帳號')
    }
  })

  it('rejects unknown roles', async () => {
    const dto = plainToInstance(CreateAccountDto, {
      email: 'viewer@pacificpower.com.tw', displayName: 'Viewer', role: 'viewer',
    })
    expect((await validate(dto)).map((error) => error.property)).toContain('role')
  })

  it('requires a project id for project-scoped permission overrides', async () => {
    const dto = plainToInstance(SetAccountPermissionsDto, {
      overrides: [{ permissionCode: 'wbs.edit', effect: 'allow', scopeType: 'project' }],
    })
    const errors = await validate(dto)
    expect(errors[0]?.children?.[0]?.children?.map((error) => error.property)).toContain('projectId')
  })

  it('accepts allow/deny overrides with a valid expiry', async () => {
    const dto = plainToInstance(SetAccountPermissionsDto, {
      overrides: [{
        permissionCode: 'report.export', effect: 'deny', scopeType: 'organization',
        expiresAt: '2027-01-01T00:00:00.000Z', reason: 'temporary restriction',
      }],
    })
    expect(await validate(dto)).toHaveLength(0)
  })
})
