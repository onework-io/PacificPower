import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { DATABASE, type Database } from '../database/database.module.js'
import {
  organizationMembers,
  projectMembers,
  rolePermissions,
  userPermissionOverrides,
} from '../database/schema.js'

export interface AuthorizationIdentity {
  organizationId: string
  userId?: string
}

@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async assert(identity: AuthorizationIdentity, permissionCode: string, projectId?: string) {
    if (!identity.userId) {
      if (this.config.get('ALLOW_DEV_IDENTITY') === 'true') return
      throw new UnauthorizedException('Authenticated user identity is required')
    }

    const [membership] = await this.db.select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(
        eq(organizationMembers.organizationId, identity.organizationId),
        eq(organizationMembers.userId, identity.userId),
      ))
      .limit(1)
    if (!membership) throw new ForbiddenException('Organization membership is required')

    if (projectId && membership.role !== 'admin') {
      const [projectMembership] = await this.db.select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, identity.userId),
        ))
        .limit(1)
      if (!projectMembership) throw new ForbiddenException('Project membership is required')
    }

    const now = new Date()
    const overrides = await this.db.select({ effect: userPermissionOverrides.effect })
      .from(userPermissionOverrides)
      .where(and(
        eq(userPermissionOverrides.organizationId, identity.organizationId),
        eq(userPermissionOverrides.userId, identity.userId),
        eq(userPermissionOverrides.permissionCode, permissionCode),
        or(isNull(userPermissionOverrides.expiresAt), gt(userPermissionOverrides.expiresAt, now)),
        or(
          eq(userPermissionOverrides.scopeType, 'organization'),
          projectId ? and(
            eq(userPermissionOverrides.scopeType, 'project'),
            eq(userPermissionOverrides.projectId, projectId),
          ) : undefined,
        ),
      ))

    if (overrides.some((item) => item.effect === 'deny')) {
      throw new ForbiddenException(`Permission denied: ${permissionCode}`)
    }
    if (overrides.some((item) => item.effect === 'allow')) return

    const [basePermission] = await this.db.select({ role: rolePermissions.roleCode })
      .from(rolePermissions)
      .where(and(
        eq(rolePermissions.roleCode, membership.role),
        eq(rolePermissions.permissionCode, permissionCode),
      ))
      .limit(1)

    if (!basePermission) throw new ForbiddenException(`Missing permission: ${permissionCode}`)
  }
}
