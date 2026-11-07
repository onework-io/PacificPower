import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { DATABASE, type Database } from '../database/database.module.js'
import {
  appUsers, organizationMembers, organizations, rolePermissions, userPermissionOverrides,
} from '../database/schema.js'
import type { AuthenticatedIdentity, RequestWithIdentity } from './auth.types.js'
import { bearerToken, header } from './auth.utils.js'

@Injectable()
export class AuthService {
  private jwks?: ReturnType<typeof createRemoteJWKSet>

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async authenticate(request: RequestWithIdentity, requestId: string): Promise<AuthenticatedIdentity> {
    const token = bearerToken(request)
    if (!token && this.config.get('ALLOW_DEV_IDENTITY') === 'true') {
      let organizationId = header(request, 'x-organization-id')
      const userId = header(request, 'x-user-id')
      if (!organizationId) {
        const [organization] = await this.db.select({ id: organizations.id }).from(organizations).limit(1)
        organizationId = organization?.id
      }
      if (!organizationId) throw new UnauthorizedException('No development organization exists')
      return { organizationId, userId, requestId }
    }
    if (!token) throw new UnauthorizedException('Bearer token is required')

    const subject = await this.verifySubject(token)
    const requestedOrganizationId = header(request, 'x-organization-id')
    const memberships = await this.db.select({
      userId: appUsers.id,
      organizationId: organizationMembers.organizationId,
      status: appUsers.status,
    }).from(appUsers)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, appUsers.id))
      .where(eq(appUsers.externalSubject, subject))
      .orderBy(asc(organizationMembers.createdAt))

    const membership = requestedOrganizationId
      ? memberships.find((item) => item.organizationId === requestedOrganizationId)
      : memberships[0]
    if (!membership) throw new UnauthorizedException('No organization membership is assigned to this account')
    if (membership.status !== 'active') throw new UnauthorizedException('Account is not active')

    return {
      organizationId: membership.organizationId,
      userId: membership.userId,
      externalSubject: subject,
      requestId,
    }
  }

  async profile(identity: AuthenticatedIdentity) {
    if (!identity.userId) throw new UnauthorizedException('A development user is not selected')
    const [account] = await this.db.select({
      id: appUsers.id,
      email: appUsers.email,
      displayName: appUsers.displayName,
      status: appUsers.status,
      organizationId: organizations.id,
      organizationCode: organizations.code,
      organizationName: organizations.name,
      role: organizationMembers.role,
    }).from(appUsers)
      .innerJoin(organizationMembers, and(
        eq(organizationMembers.userId, appUsers.id),
        eq(organizationMembers.organizationId, identity.organizationId),
      ))
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(appUsers.id, identity.userId))
      .limit(1)
    if (!account) throw new UnauthorizedException('Account profile was not found')

    const now = new Date()
    const [basePermissions, overrides, projectOverrides] = await Promise.all([
      this.db.select({ code: rolePermissions.permissionCode }).from(rolePermissions)
        .where(eq(rolePermissions.roleCode, account.role)),
      this.db.select({ code: userPermissionOverrides.permissionCode, effect: userPermissionOverrides.effect })
        .from(userPermissionOverrides)
        .where(and(
          eq(userPermissionOverrides.organizationId, identity.organizationId),
          eq(userPermissionOverrides.userId, identity.userId),
          eq(userPermissionOverrides.scopeType, 'organization'),
          or(isNull(userPermissionOverrides.expiresAt), gt(userPermissionOverrides.expiresAt, now)),
        )),
      this.db.select({
        projectId: userPermissionOverrides.projectId,
        code: userPermissionOverrides.permissionCode,
        effect: userPermissionOverrides.effect,
      }).from(userPermissionOverrides)
        .where(and(
          eq(userPermissionOverrides.organizationId, identity.organizationId),
          eq(userPermissionOverrides.userId, identity.userId),
          eq(userPermissionOverrides.scopeType, 'project'),
          or(isNull(userPermissionOverrides.expiresAt), gt(userPermissionOverrides.expiresAt, now)),
        )),
    ])
    const effective = new Set(basePermissions.map((permission) => permission.code))
    for (const override of overrides) {
      if (override.effect === 'deny') effective.delete(override.code)
      else effective.add(override.code)
    }
    return {
      ...account,
      permissions: [...effective].sort(),
      projectPermissionOverrides: projectOverrides
        .filter((override): override is typeof override & { projectId: string } => Boolean(override.projectId))
        .map((override) => ({ projectId: override.projectId, permissionCode: override.code, effect: override.effect })),
    }
  }

  private async verifySubject(token: string) {
    const baseUrl = this.config.get<string>('SUPABASE_URL')?.replace(/\/$/, '')
    if (!baseUrl) throw new UnauthorizedException('SUPABASE_URL is not configured')
    this.jwks ??= createRemoteJWKSet(new URL(`${baseUrl}/auth/v1/.well-known/jwks.json`))
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `${baseUrl}/auth/v1`,
        audience: 'authenticated',
      })
      if (!payload.sub) throw new UnauthorizedException('Token subject is missing')
      return payload.sub
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error
      throw new UnauthorizedException('Access token is invalid or expired')
    }
  }
}
