import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { AuthorizationService } from '../authz/authorization.service.js'
import { DATABASE, type Database } from '../database/database.module.js'
import {
  appUsers, auditLogs, organizationMembers, organizations, permissions, rolePermissions,
  registrationRequests, roles, userPermissionOverrides,
} from '../database/schema.js'
import type { ApproveRegistrationDto, CreateAccountDto, SetAccountPermissionsDto, UpdateAccountDto } from './account.dto.js'

export interface AccountRequestIdentity {
  organizationId?: string
  userId?: string
  requestId?: string
}

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
  ) {}

  private async identity(raw: AccountRequestIdentity) {
    if (this.config.get('ALLOW_DEV_IDENTITY') !== 'true') {
      if (!raw.organizationId || !raw.userId) throw new UnauthorizedException('Authenticated identity is required')
      return { organizationId: raw.organizationId, userId: raw.userId, requestId: raw.requestId }
    }
    if (raw.organizationId) return { organizationId: raw.organizationId, userId: raw.userId, requestId: raw.requestId }
    const [organization] = await this.db.select({ id: organizations.id }).from(organizations).limit(1)
    if (!organization) throw new UnauthorizedException('No organization exists')
    return { organizationId: organization.id, userId: raw.userId, requestId: raw.requestId }
  }

  async catalog(raw: AccountRequestIdentity) {
    const identity = await this.identity(raw)
    await this.authz.assert(identity, 'account.view')
    const [roleRows, permissionRows, rolePermissionRows] = await Promise.all([
      this.db.select().from(roles).orderBy(asc(roles.sortOrder)),
      this.db.select().from(permissions).orderBy(asc(permissions.sortOrder)),
      this.db.select().from(rolePermissions),
    ])
    return { roles: roleRows, permissions: permissionRows, rolePermissions: rolePermissionRows }
  }

  async list(raw: AccountRequestIdentity) {
    const identity = await this.identity(raw)
    await this.authz.assert(identity, 'account.view')
    const members = await this.db.select({
      id: appUsers.id, email: appUsers.email, displayName: appUsers.displayName,
      phone: appUsers.phone, department: appUsers.department, crewName: appUsers.crewName,
      status: appUsers.status, mfaEnabled: appUsers.mfaEnabled, lastLoginAt: appUsers.lastLoginAt,
      version: appUsers.version, role: organizationMembers.role,
    }).from(organizationMembers)
      .innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, identity.organizationId))
      .orderBy(asc(appUsers.displayName))

    const overrides = await this.db.select().from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.organizationId, identity.organizationId))
    return members.map((member) => ({
      ...member,
      lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
      overrides: overrides.filter((item) => item.userId === member.id),
    }))
  }

  async listRegistrationRequests(raw: AccountRequestIdentity) {
    const identity = await this.identity(raw)
    await this.authz.assert(identity, 'account.create')
    const requests = await this.db.select({
      id: registrationRequests.id,
      email: registrationRequests.email,
      displayName: registrationRequests.displayName,
      status: registrationRequests.status,
      createdAt: registrationRequests.createdAt,
    }).from(registrationRequests)
      .where(eq(registrationRequests.status, 'pending'))
      .orderBy(desc(registrationRequests.createdAt))

    const invitedAccounts = await this.db.select({
      email: appUsers.email,
      role: organizationMembers.role,
    }).from(organizationMembers)
      .innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
      .where(and(
        eq(organizationMembers.organizationId, identity.organizationId),
        eq(appUsers.status, 'invited'),
      ))
    const invitedByEmail = new Map(invitedAccounts.map((account) => [account.email.toLowerCase(), account]))

    return requests.map((request) => {
      const invitation = invitedByEmail.get(request.email.toLowerCase())
      return {
        ...request,
        preprovisioned: Boolean(invitation),
        suggestedRole: invitation?.role,
      }
    })
  }

  async approveRegistration(requestId: string, dto: ApproveRegistrationDto, raw: AccountRequestIdentity) {
    const identity = await this.identity(raw)
    await this.authz.assert(identity, 'account.create')
    return this.db.transaction(async (tx) => {
      const [request] = await tx.select().from(registrationRequests)
        .where(and(eq(registrationRequests.id, requestId), eq(registrationRequests.status, 'pending')))
        .limit(1)
      if (!request) throw new NotFoundException('Pending registration request not found')
      const [invited] = await tx.select({ id: appUsers.id }).from(organizationMembers)
        .innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
        .where(and(
          eq(organizationMembers.organizationId, identity.organizationId),
          eq(appUsers.status, 'invited'),
          sql`lower(${appUsers.email}) = lower(${request.email})`,
        ))
        .limit(1)

      let user: typeof appUsers.$inferSelect | undefined
      if (invited) {
        ;[user] = await tx.update(appUsers).set({
          externalSubject: request.externalSubject,
          status: 'active',
          updatedAt: new Date(),
          version: sql`${appUsers.version} + 1`,
        }).where(eq(appUsers.id, invited.id)).returning()
        await tx.update(organizationMembers).set({ role: dto.role }).where(and(
          eq(organizationMembers.organizationId, identity.organizationId),
          eq(organizationMembers.userId, invited.id),
        ))
      } else {
        const [existing] = await tx.select({ id: appUsers.id }).from(appUsers)
          .where(sql`lower(${appUsers.email}) = lower(${request.email})`)
          .limit(1)
        if (existing) throw new ConflictException('Email already belongs to an existing account')

        ;[user] = await tx.insert(appUsers).values({
          externalSubject: request.externalSubject,
          email: request.email,
          displayName: request.displayName,
          status: 'active',
          department: dto.department ?? '',
          crewName: dto.crewName ?? '',
        }).returning()
        if (user) await tx.insert(organizationMembers).values({
          organizationId: identity.organizationId,
          userId: user.id,
          role: dto.role,
        })
      }
      if (!user) throw new Error('Account approval returned no user')
      await tx.update(registrationRequests).set({
        status: 'approved', reviewedBy: identity.userId, reviewedAt: new Date(), updatedAt: new Date(),
      }).where(eq(registrationRequests.id, requestId))
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, actorUserId: identity.userId,
        action: 'registration.approved', resourceType: 'account', resourceId: user.id,
        afterData: { email: user.email, role: dto.role, linkedInvitation: Boolean(invited) },
        requestId: identity.requestId,
      })
      const overrides = await tx.select().from(userPermissionOverrides).where(and(
        eq(userPermissionOverrides.organizationId, identity.organizationId),
        eq(userPermissionOverrides.userId, user.id),
      ))
      return { ...user, role: dto.role, overrides }
    })
  }

  async create(dto: CreateAccountDto, raw: AccountRequestIdentity) {
    const identity = await this.identity(raw)
    await this.authz.assert(identity, 'account.create')
    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx.insert(appUsers).values({
          email: dto.email.toLowerCase(), displayName: dto.displayName, status: 'invited',
          phone: dto.phone, department: dto.department ?? '', crewName: dto.crewName ?? '',
        }).returning()
        if (!user) throw new Error('Account insert returned no row')
        await tx.insert(organizationMembers).values({
          organizationId: identity.organizationId, userId: user.id, role: dto.role,
        })
        await tx.insert(auditLogs).values({
          organizationId: identity.organizationId, actorUserId: identity.userId,
          action: 'account.created', resourceType: 'account', resourceId: user.id,
          afterData: { email: user.email, displayName: user.displayName, role: dto.role },
          requestId: identity.requestId,
        })
        return { ...user, role: dto.role, overrides: [] }
      })
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        throw new ConflictException('Email already exists')
      }
      throw error
    }
  }

  async update(userId: string, dto: UpdateAccountDto, raw: AccountRequestIdentity) {
    const identity = await this.identity(raw)
    await this.authz.assert(identity, dto.status === 'disabled' ? 'account.disable' : 'account.edit')
    if (identity.userId === userId && dto.status === 'disabled') {
      throw new ConflictException('You cannot disable your own account')
    }

    const [member] = await this.db.select({ role: organizationMembers.role })
      .from(organizationMembers).where(and(
        eq(organizationMembers.organizationId, identity.organizationId),
        eq(organizationMembers.userId, userId),
      )).limit(1)
    if (!member) throw new NotFoundException('Account not found')

    if (member.role === 'admin' && dto.role && dto.role !== 'admin') {
      const [count] = await this.db.select({ value: sql<number>`count(*)` }).from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, identity.organizationId), eq(organizationMembers.role, 'admin')))
      if (Number(count?.value ?? 0) <= 1) throw new ConflictException('The last admin cannot be demoted')
    }

    return this.db.transaction(async (tx) => {
      const [user] = await tx.update(appUsers).set({
        displayName: dto.displayName, status: dto.status, phone: dto.phone,
        department: dto.department, crewName: dto.crewName,
        version: sql`${appUsers.version} + 1`, updatedAt: new Date(),
      }).where(eq(appUsers.id, userId)).returning()
      if (dto.role) await tx.update(organizationMembers).set({ role: dto.role }).where(and(
        eq(organizationMembers.organizationId, identity.organizationId),
        eq(organizationMembers.userId, userId),
      ))
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, actorUserId: identity.userId,
        action: 'account.updated', resourceType: 'account', resourceId: userId,
        afterData: { ...dto }, requestId: identity.requestId,
      })
      return { ...user, role: dto.role ?? member.role }
    })
  }

  async setPermissions(userId: string, dto: SetAccountPermissionsDto, raw: AccountRequestIdentity) {
    const identity = await this.identity(raw)
    await this.authz.assert(identity, 'account.permission.manage')
    return this.db.transaction(async (tx) => {
      await tx.delete(userPermissionOverrides).where(and(
        eq(userPermissionOverrides.organizationId, identity.organizationId),
        eq(userPermissionOverrides.userId, userId),
      ))
      if (dto.overrides.length) {
        await tx.insert(userPermissionOverrides).values(dto.overrides.map((override) => ({
          organizationId: identity.organizationId, userId,
          permissionCode: override.permissionCode, effect: override.effect,
          scopeType: override.scopeType, projectId: override.projectId,
          expiresAt: override.expiresAt ? new Date(override.expiresAt) : undefined,
          reason: override.reason ?? '', grantedBy: identity.userId,
        })))
      }
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, actorUserId: identity.userId,
        action: 'account.permissions.updated', resourceType: 'account', resourceId: userId,
        afterData: { overrides: dto.overrides }, requestId: identity.requestId,
      })
      return { userId, overrides: dto.overrides }
    })
  }
}
