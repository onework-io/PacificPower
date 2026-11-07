import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { bearerToken, identityFromRequest } from '../src/auth/auth.utils.js'

describe('auth request helpers', () => {
  it('extracts a bearer token case-insensitively', () => {
    expect(bearerToken({ headers: { authorization: 'bearer access-token' } })).toBe('access-token')
  })

  it('rejects a non-bearer authorization header', () => {
    expect(() => bearerToken({ headers: { authorization: 'Basic abc' } }))
      .toThrow(UnauthorizedException)
  })

  it('returns the identity attached by the global guard', () => {
    const identity = { organizationId: 'org', userId: 'user', requestId: 'request' }
    expect(identityFromRequest({ headers: {}, pacificpowerIdentity: identity })).toBe(identity)
  })

  it('rejects a request without an attached identity', () => {
    expect(() => identityFromRequest({ headers: {} })).toThrow(UnauthorizedException)
  })
})
