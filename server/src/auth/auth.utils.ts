import { UnauthorizedException } from '@nestjs/common'
import type { RequestWithIdentity } from './auth.types.js'

export function header(request: RequestWithIdentity, name: string) {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export function bearerToken(request: RequestWithIdentity) {
  const authorization = header(request, 'authorization')
  if (!authorization) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  if (!match?.[1]) throw new UnauthorizedException('Authorization must use a Bearer token')
  return match[1]
}

export function identityFromRequest(request: RequestWithIdentity) {
  if (!request.pacificpowerIdentity) throw new UnauthorizedException('Authenticated identity is required')
  return request.pacificpowerIdentity
}
