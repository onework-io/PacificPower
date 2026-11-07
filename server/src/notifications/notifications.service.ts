import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { AuthenticatedIdentity } from '../auth/auth.types.js'
import { AuthorizationService } from '../authz/authorization.service.js'
import { DATABASE, type Database } from '../database/database.module.js'
import { notificationPreferences, notificationReadStates } from '../database/schema.js'
import type { UpdateNotificationPreferencesDto, UpdateNotificationReadStateDto } from './notification.dto.js'

const DEFAULT_TYPES = ['daily', 'labor', 'dispatch', 'qualification']

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
  ) {}

  async listReadState(identity: AuthenticatedIdentity) {
    await this.authz.assert(identity, 'project.view')
    const userId = this.requireUser(identity)
    const rows = await this.db.select({ key: notificationReadStates.notificationKey, readAt: notificationReadStates.readAt })
      .from(notificationReadStates).where(and(
        eq(notificationReadStates.organizationId, identity.organizationId),
        eq(notificationReadStates.userId, userId),
      )).orderBy(desc(notificationReadStates.updatedAt)).limit(1000)
    return { readKeys: rows.map((row) => row.key), items: rows.map((row) => ({ key: row.key, readAt: row.readAt.toISOString() })) }
  }

  async updateReadState(dto: UpdateNotificationReadStateDto, identity: AuthenticatedIdentity) {
    await this.authz.assert(identity, 'project.view')
    const userId = this.requireUser(identity)
    const keys = [...new Set(dto.keys.map((key) => key.trim()).filter(Boolean))]
    if (keys.some((key) => key.length > 240)) throw new BadRequestException('Invalid notification key')
    if (!keys.length) return { readKeys: [] }
    if (dto.read) {
      const now = new Date()
      await this.db.insert(notificationReadStates).values(keys.map((notificationKey) => ({
        organizationId: identity.organizationId, userId, notificationKey, readAt: now, updatedAt: now,
      }))).onConflictDoUpdate({
        target: [notificationReadStates.organizationId, notificationReadStates.userId, notificationReadStates.notificationKey],
        set: { readAt: now, updatedAt: now },
      })
    } else {
      await this.db.delete(notificationReadStates).where(and(
        eq(notificationReadStates.organizationId, identity.organizationId),
        eq(notificationReadStates.userId, userId),
        inArray(notificationReadStates.notificationKey, keys),
      ))
    }
    return { readKeys: keys, read: dto.read }
  }

  async getPreferences(identity: AuthenticatedIdentity) {
    await this.authz.assert(identity, 'project.view')
    const userId = this.requireUser(identity)
    const [row] = await this.db.select().from(notificationPreferences).where(and(
      eq(notificationPreferences.organizationId, identity.organizationId),
      eq(notificationPreferences.userId, userId),
    )).limit(1)
    return row ? {
      enabledTypes: row.enabledTypes,
      minimumSeverity: row.minimumSeverity,
      realtimeEnabled: row.realtimeEnabled,
      updatedAt: row.updatedAt.toISOString(),
    } : { enabledTypes: DEFAULT_TYPES, minimumSeverity: 'warning', realtimeEnabled: true, updatedAt: null }
  }

  async updatePreferences(dto: UpdateNotificationPreferencesDto, identity: AuthenticatedIdentity) {
    await this.authz.assert(identity, 'project.view')
    const userId = this.requireUser(identity)
    const enabledTypes = [...new Set(dto.enabledTypes)]
    const now = new Date()
    const [row] = await this.db.insert(notificationPreferences).values({
      organizationId: identity.organizationId, userId, enabledTypes,
      minimumSeverity: dto.minimumSeverity, realtimeEnabled: dto.realtimeEnabled, updatedAt: now,
    }).onConflictDoUpdate({
      target: [notificationPreferences.organizationId, notificationPreferences.userId],
      set: { enabledTypes, minimumSeverity: dto.minimumSeverity, realtimeEnabled: dto.realtimeEnabled, updatedAt: now },
    }).returning()
    return {
      enabledTypes: row!.enabledTypes,
      minimumSeverity: row!.minimumSeverity,
      realtimeEnabled: row!.realtimeEnabled,
      updatedAt: row!.updatedAt.toISOString(),
    }
  }

  private requireUser(identity: AuthenticatedIdentity) {
    if (!identity.userId) throw new BadRequestException('A signed-in user is required')
    return identity.userId
  }
}
