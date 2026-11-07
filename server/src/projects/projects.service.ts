import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isUUID } from 'class-validator'
import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { DATABASE, type Database } from '../database/database.module.js'
import { AuthorizationService } from '../authz/authorization.service.js'
import {
  appUsers,
  auditLogs,
  crewDispatches,
  crews,
  idempotencyKeys,
  laborEntries,
  memberQualifications,
  memberUnavailability,
  modelSets,
  organizations,
  organizationMembers,
  projectMembers,
  projects,
  projectSettings,
  userPermissionOverrides,
  taskAssignments,
  wbsTasks,
} from '../database/schema.js'
import type {
  AcknowledgeReportDto, ArchiveProjectDto, CreateCrewDispatchDto, CreateCrewDto, CreateLaborEntryDto, CreateProjectDto, CrewDispatchQuery, LaborEntryQuery, ListProjectsQuery, RecordReportExportDto,
  ReplaceCrewMembersDto, ReplaceMemberQualificationsDto, ReplaceMemberUnavailabilityDto, ReplaceProjectMembersDto, UpdateCrewDispatchDto, UpdateCrewDto, UpdateProjectDto,
} from './project.dto.js'
import { presentProject } from './project.presenter.js'

export interface RequestIdentity {
  organizationId?: string
  userId?: string
  requestId?: string
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
  ) {}

  private async resolveIdentity(identity: RequestIdentity): Promise<RequestIdentity & { organizationId: string }> {
    if (identity.organizationId) return { ...identity, organizationId: identity.organizationId }
    if (this.config.get('ALLOW_DEV_IDENTITY') !== 'true') {
      throw new UnauthorizedException('Authenticated organization identity is required')
    }
    const [organization] = await this.db.select({ id: organizations.id }).from(organizations).limit(1)
    if (!organization) throw new UnauthorizedException('No organization exists; seed an organization first')
    return { ...identity, organizationId: organization.id }
  }

  private projectSelection() {
    return {
      ...getTableColumns(projects),
      managerName: appUsers.displayName,
      progressPct: sql<string>`coalesce((
        select ps.earned_pct from progress_snapshots ps
        where ps.project_id = ${projects.id}
        order by ps.data_date desc limit 1
      ), 0)`,
    }
  }

  async list(query: ListProjectsQuery, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.view')
    const conditions = [eq(projects.organizationId, identity.organizationId!)]
    if (identity.userId) {
      const [membership] = await this.db.select({ role: organizationMembers.role }).from(organizationMembers)
        .where(and(
          eq(organizationMembers.organizationId, identity.organizationId!),
          eq(organizationMembers.userId, identity.userId),
        )).limit(1)
      if (membership?.role !== 'admin') {
        conditions.push(sql`exists (
          select 1 from project_members pm
          where pm.project_id = ${projects.id} and pm.user_id = ${identity.userId}
        )`)
      }
    }
    conditions.push(query.includeArchived ? sql`true` : isNull(projects.deletedAt))
    if (query.status) conditions.push(eq(projects.status, query.status))
    if (query.q) {
      const pattern = `%${query.q}%`
      conditions.push(or(
        ilike(projects.code, pattern), ilike(projects.name, pattern),
        ilike(projects.clientName, pattern), ilike(projects.location, pattern),
      )!)
    }
    const rows = await this.db.select(this.projectSelection())
      .from(projects)
      .leftJoin(appUsers, eq(projects.managerId, appUsers.id))
      .where(and(...conditions))
      .orderBy(desc(projects.updatedAt))
      .limit(query.limit)
    return { items: rows.map(presentProject), nextCursor: null }
  }

  async get(projectId: string, rawIdentity: RequestIdentity, includeArchived = false) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.view', projectId)
    const filters = [eq(projects.id, projectId), eq(projects.organizationId, identity.organizationId!)]
    filters.push(includeArchived ? sql`true` : isNull(projects.deletedAt))
    const [row] = await this.db.select(this.projectSelection())
      .from(projects)
      .leftJoin(appUsers, eq(projects.managerId, appUsers.id))
      .where(and(...filters)).limit(1)
    if (!row) throw new NotFoundException('Project not found')
    return presentProject(row)
  }

  async crewOrganization(rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.view')
    const [organizationRole] = identity.userId
      ? await this.db.select({ role: organizationMembers.role }).from(organizationMembers).where(and(
        eq(organizationMembers.organizationId, identity.organizationId),
        eq(organizationMembers.userId, identity.userId),
      )).limit(1)
      : []
    const visibleProjectIds = organizationRole?.role === 'admin' || !identity.userId
      ? null
      : (await this.db.select({ id: projectMembers.projectId }).from(projectMembers)
        .where(eq(projectMembers.userId, identity.userId))).map((item) => item.id)
    if (visibleProjectIds && !visibleProjectIds.length) return { crews: [] }

    const projectFilter = visibleProjectIds ? inArray(projects.id, visibleProjectIds) : sql`true`
    const [members, memberships, assignments, crewProjects, laborTotals, crewDirectory] = await Promise.all([
      this.db.select({
        id: appUsers.id, displayName: appUsers.displayName, email: appUsers.email,
        crewName: appUsers.crewName, department: appUsers.department, role: organizationMembers.role,
      }).from(organizationMembers).innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
        .where(and(
          eq(organizationMembers.organizationId, identity.organizationId),
          eq(appUsers.status, 'active'),
          or(sql`length(trim(${appUsers.crewName})) > 0`, eq(organizationMembers.role, 'worker')),
        )).orderBy(asc(appUsers.crewName), asc(appUsers.displayName)),
      this.db.select({
        userId: projectMembers.userId, projectRole: projectMembers.role,
        projectId: projects.id, projectCode: projects.code, projectName: projects.name,
        clientName: projects.clientName, location: projects.location, status: projects.status,
        riskStatus: projects.riskStatus, crewName: projects.crewName,
        startDate: projects.startDate, endDate: projects.endDate,
      }).from(projectMembers).innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(and(
          eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt), projectFilter,
        )),
      this.db.select({
        userId: taskAssignments.userId, taskId: wbsTasks.id, taskCode: wbsTasks.code,
        taskName: wbsTasks.name, progressPct: wbsTasks.progressPct,
        sequence: wbsTasks.sequence, durationDays: wbsTasks.durationDays,
        pinnedStartDay: wbsTasks.pinnedStartDay, assignedAt: taskAssignments.assignedAt,
        assignmentEndsAt: taskAssignments.endsAt,
        projectId: projects.id, projectCode: projects.code, projectName: projects.name,
        projectStartDate: projects.startDate, projectEndDate: projects.endDate,
      }).from(taskAssignments)
        .innerJoin(wbsTasks, eq(wbsTasks.id, taskAssignments.taskId))
        .innerJoin(projects, eq(projects.id, wbsTasks.projectId))
        .where(and(
          eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt),
          isNull(wbsTasks.archivedAt), projectFilter,
        )).orderBy(asc(projects.code), asc(wbsTasks.sequence)),
      this.db.select({
        id: projects.id, code: projects.code, name: projects.name,
        clientName: projects.clientName, location: projects.location,
        status: projects.status, riskStatus: projects.riskStatus, crewName: projects.crewName,
        startDate: projects.startDate, endDate: projects.endDate,
      }).from(projects).where(and(
        eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt),
        sql`length(trim(${projects.crewName})) > 0`, projectFilter,
      )).orderBy(asc(projects.crewName), asc(projects.code)),
      this.db.select({
        crewName: laborEntries.crewName,
        hours: sql<string>`coalesce(sum(${laborEntries.people} * ${laborEntries.hours}), 0)`,
      }).from(laborEntries).innerJoin(projects, eq(projects.id, laborEntries.projectId))
        .where(and(
          eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt), projectFilter,
          eq(laborEntries.status, 'approved'),
          sql`length(trim(${laborEntries.crewName})) > 0`,
        )).groupBy(laborEntries.crewName),
      this.db.select({
        id: crews.id, code: crews.code, name: crews.name, trade: crews.trade,
        leaderUserId: crews.leaderUserId, status: crews.status,
        dailyCapacityHours: crews.dailyCapacityHours, notes: crews.notes,
      }).from(crews).where(and(
        eq(crews.organizationId, identity.organizationId), eq(crews.status, 'active'),
      )).orderBy(asc(crews.name)),
    ])

    const crewMap = new Map<string, {
      name: string
      members: Array<Record<string, unknown>>
      projects: Map<string, Record<string, unknown>>
      tasks: Array<Record<string, unknown>>
      metadata?: Record<string, unknown>
    }>()
    for (const directoryCrew of crewDirectory) {
      crewMap.set(directoryCrew.name, {
        name: directoryCrew.name, members: [], projects: new Map(), tasks: [],
        metadata: {
          id: directoryCrew.id, code: directoryCrew.code, trade: directoryCrew.trade,
          leaderUserId: directoryCrew.leaderUserId, status: directoryCrew.status,
          dailyCapacityHours: Number(directoryCrew.dailyCapacityHours), notes: directoryCrew.notes,
        },
      })
    }
    for (const project of crewProjects) {
      const crewName = project.crewName.trim()
      const crew = crewMap.get(crewName) ?? {
        name: crewName, members: [] as Array<Record<string, unknown>>,
        projects: new Map<string, Record<string, unknown>>(), tasks: [] as Array<Record<string, unknown>>,
      }
      crew.projects.set(project.id, {
        id: project.id, code: project.code, name: project.name,
        clientName: project.clientName, location: project.location,
        status: project.status, riskStatus: project.riskStatus, projectRole: null,
        startDate: project.startDate, endDate: project.endDate,
      })
      crewMap.set(crewName, crew)
    }
    for (const member of members) {
      const memberMemberships = memberships.filter((item) => item.userId === member.id)
      if (visibleProjectIds && !memberMemberships.length) continue
      const crewName = member.crewName.trim() || '未分組工班'
      const crew = crewMap.get(crewName) ?? {
        name: crewName, members: [] as Array<Record<string, unknown>>,
        projects: new Map<string, Record<string, unknown>>(), tasks: [] as Array<Record<string, unknown>>,
      }
      crew.members.push({
        id: member.id, displayName: member.displayName, email: member.email,
        department: member.department, role: member.role,
      })
      for (const membership of memberMemberships) {
        crew.projects.set(membership.projectId, {
          id: membership.projectId, code: membership.projectCode, name: membership.projectName,
          clientName: membership.clientName, location: membership.location,
          status: membership.status, riskStatus: membership.riskStatus,
          projectRole: membership.projectRole,
          startDate: membership.startDate, endDate: membership.endDate,
        })
      }
      crew.tasks.push(...assignments.filter((item) => item.userId === member.id).map((item) => ({
        id: item.taskId, code: item.taskCode, name: item.taskName,
        progressPct: Number(item.progressPct), projectId: item.projectId,
        projectCode: item.projectCode, projectName: item.projectName,
        assigneeId: member.id, assigneeName: member.displayName,
        sequence: item.sequence, durationDays: Number(item.durationDays),
        pinnedStartDay: item.pinnedStartDay === null ? null : Number(item.pinnedStartDay),
        assignedAt: item.assignedAt.toISOString(), assignmentEndsAt: item.assignmentEndsAt?.toISOString() ?? null,
        projectStartDate: item.projectStartDate, projectEndDate: item.projectEndDate,
      })))
      crewMap.set(crewName, crew)
    }
    return {
      crews: [...crewMap.values()].map((crew) => ({
        name: crew.name, members: crew.members, projects: [...crew.projects.values()], tasks: crew.tasks,
        laborHours: Number(laborTotals.find((item) => item.crewName.trim() === crew.name)?.hours ?? 0),
        metadata: crew.metadata ?? null,
      })),
    }
  }

  async listCrews(rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.dispatch')
    const [directory, members] = await Promise.all([
      this.db.select({
        id: crews.id, code: crews.code, name: crews.name, trade: crews.trade,
        leaderUserId: crews.leaderUserId, leaderName: appUsers.displayName,
        status: crews.status, dailyCapacityHours: crews.dailyCapacityHours,
        notes: crews.notes, version: crews.version,
      }).from(crews).leftJoin(appUsers, eq(appUsers.id, crews.leaderUserId))
        .where(eq(crews.organizationId, identity.organizationId)).orderBy(asc(crews.name)),
      this.db.select({
        id: appUsers.id, displayName: appUsers.displayName, email: appUsers.email,
        department: appUsers.department, crewName: appUsers.crewName,
      }).from(organizationMembers).innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
        .where(and(eq(organizationMembers.organizationId, identity.organizationId), eq(appUsers.status, 'active'))),
    ])
    return {
      crews: directory.map((crew) => ({
        ...crew, dailyCapacityHours: Number(crew.dailyCapacityHours),
        members: members.filter((member) => member.crewName.trim() === crew.name),
      })),
    }
  }

  async crewMemberCatalog(rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.dispatch')
    const [members, qualifications, unavailability] = await Promise.all([
      this.db.select({
        id: appUsers.id, displayName: appUsers.displayName, email: appUsers.email,
        department: appUsers.department, crewName: appUsers.crewName, role: organizationMembers.role,
      }).from(organizationMembers).innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
        .where(and(eq(organizationMembers.organizationId, identity.organizationId), eq(appUsers.status, 'active')))
        .orderBy(asc(appUsers.displayName)),
      this.db.select({
        id: memberQualifications.id, userId: memberQualifications.userId, name: memberQualifications.name,
        certificateNo: memberQualifications.certificateNo, issuedOn: memberQualifications.issuedOn,
        expiresOn: memberQualifications.expiresOn, notes: memberQualifications.notes,
      }).from(memberQualifications).where(eq(memberQualifications.organizationId, identity.organizationId))
        .orderBy(asc(memberQualifications.name)),
      this.db.select({
        id: memberUnavailability.id, userId: memberUnavailability.userId,
        startDate: memberUnavailability.startDate, endDate: memberUnavailability.endDate,
        type: memberUnavailability.type, reason: memberUnavailability.reason,
      }).from(memberUnavailability).where(eq(memberUnavailability.organizationId, identity.organizationId))
        .orderBy(asc(memberUnavailability.startDate)),
    ])
    const today = new Date()
    const warningDate = new Date(today)
    warningDate.setDate(warningDate.getDate() + 60)
    return {
      members: members.map((member) => ({
        ...member,
        qualifications: qualifications.filter((item) => item.userId === member.id).map((item) => ({
          ...item,
          status: item.expiresOn && item.expiresOn < today.toISOString().slice(0, 10)
            ? 'expired'
            : item.expiresOn && item.expiresOn <= warningDate.toISOString().slice(0, 10) ? 'expiring' : 'valid',
        })),
        unavailability: unavailability.filter((item) => item.userId === member.id),
      })),
    }
  }

  async createCrew(dto: CreateCrewDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.dispatch')
    if (dto.leaderUserId) await this.assertOrganizationUsers(identity.organizationId, [dto.leaderUserId])
    try {
      const [created] = await this.db.insert(crews).values({
        organizationId: identity.organizationId, code: dto.code, name: dto.name,
        trade: dto.trade ?? '', leaderUserId: dto.leaderUserId,
        dailyCapacityHours: String(dto.dailyCapacityHours), notes: dto.notes ?? '',
        createdBy: identity.userId, updatedBy: identity.userId,
      }).returning()
      await this.db.insert(auditLogs).values({
        organizationId: identity.organizationId, actorUserId: identity.userId,
        action: 'crew.created', resourceType: 'crew', resourceId: created!.id,
        afterData: created, requestId: identity.requestId,
      })
      return { ...created!, dailyCapacityHours: Number(created!.dailyCapacityHours), members: [] }
    } catch (error) {
      if (String(error).includes('unique')) throw new ConflictException('Crew code or name already exists')
      throw error
    }
  }

  async updateCrew(crewId: string, dto: UpdateCrewDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.dispatch')
    const [current] = await this.db.select().from(crews).where(and(
      eq(crews.id, crewId), eq(crews.organizationId, identity.organizationId),
    )).limit(1)
    if (!current) throw new NotFoundException('Crew not found')
    if (dto.leaderUserId) await this.assertOrganizationUsers(identity.organizationId, [dto.leaderUserId])
    const currentCrewMembers = dto.name && dto.name !== current.name
      ? await this.db.select({ id: appUsers.id }).from(organizationMembers)
        .innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId)).where(and(
          eq(organizationMembers.organizationId, identity.organizationId), eq(appUsers.crewName, current.name),
        ))
      : []
    try {
      const updated = await this.db.transaction(async (tx) => {
        const [row] = await tx.update(crews).set({
          code: dto.code, name: dto.name, trade: dto.trade,
          leaderUserId: dto.leaderUserId, status: dto.status,
          dailyCapacityHours: dto.dailyCapacityHours === undefined ? undefined : String(dto.dailyCapacityHours),
          notes: dto.notes, updatedBy: identity.userId,
          version: sql`${crews.version} + 1`, updatedAt: new Date(),
        }).where(eq(crews.id, crewId)).returning()
        if (dto.name && dto.name !== current.name) {
          if (currentCrewMembers.length) {
            await tx.update(appUsers).set({ crewName: dto.name, updatedAt: new Date() })
              .where(inArray(appUsers.id, currentCrewMembers.map((member) => member.id)))
          }
          await tx.update(projects).set({ crewName: dto.name, updatedAt: new Date() })
            .where(and(eq(projects.organizationId, identity.organizationId), eq(projects.crewName, current.name)))
          await tx.update(crewDispatches).set({ crewName: dto.name, updatedAt: new Date() })
            .where(and(eq(crewDispatches.organizationId, identity.organizationId), eq(crewDispatches.crewName, current.name)))
        }
        return row!
      })
      await this.db.insert(auditLogs).values({
        organizationId: identity.organizationId, actorUserId: identity.userId,
        action: 'crew.updated', resourceType: 'crew', resourceId: crewId,
        beforeData: current, afterData: updated, requestId: identity.requestId,
      })
      return { ...updated, dailyCapacityHours: Number(updated.dailyCapacityHours) }
    } catch (error) {
      if (String(error).includes('unique')) throw new ConflictException('Crew code or name already exists')
      throw error
    }
  }

  async replaceCrewMembers(crewId: string, dto: ReplaceCrewMembersDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.dispatch')
    if (dto.userIds.some((userId) => !isUUID(userId))) throw new BadRequestException('Invalid user id')
    const [crew] = await this.db.select().from(crews).where(and(
      eq(crews.id, crewId), eq(crews.organizationId, identity.organizationId),
    )).limit(1)
    if (!crew) throw new NotFoundException('Crew not found')
    await this.assertOrganizationUsers(identity.organizationId, dto.userIds)
    const currentMembers = await this.db.select({ id: appUsers.id }).from(organizationMembers)
      .innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId)).where(and(
        eq(organizationMembers.organizationId, identity.organizationId), eq(appUsers.crewName, crew.name),
      ))
    await this.db.transaction(async (tx) => {
      if (currentMembers.length) {
        await tx.update(appUsers).set({ crewName: '', updatedAt: new Date() })
          .where(inArray(appUsers.id, currentMembers.map((member) => member.id)))
      }
      if (dto.userIds.length) {
        await tx.update(appUsers).set({ crewName: crew.name, updatedAt: new Date() })
          .where(inArray(appUsers.id, dto.userIds))
      }
    })
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, actorUserId: identity.userId,
      action: 'crew.members.replaced', resourceType: 'crew', resourceId: crewId,
      afterData: { userIds: dto.userIds }, requestId: identity.requestId,
    })
    return this.listCrews(identity)
  }

  async replaceMemberQualifications(userId: string, dto: ReplaceMemberQualificationsDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.dispatch')
    await this.assertOrganizationUsers(identity.organizationId, [userId])
    for (const qualification of dto.qualifications) {
      if (!qualification || typeof qualification.name !== 'string' || !qualification.name.trim() || qualification.name.length > 120) {
        throw new BadRequestException('Qualification name is required and must not exceed 120 characters')
      }
      if (qualification.certificateNo !== undefined && (typeof qualification.certificateNo !== 'string' || qualification.certificateNo.length > 120)) {
        throw new BadRequestException('Invalid qualification certificate number')
      }
      if (qualification.notes !== undefined && (typeof qualification.notes !== 'string' || qualification.notes.length > 500)) {
        throw new BadRequestException('Invalid qualification notes')
      }
      if ((qualification.issuedOn && !/^\d{4}-\d{2}-\d{2}$/.test(qualification.issuedOn))
        || (qualification.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(qualification.expiresOn))) {
        throw new BadRequestException('Invalid qualification date')
      }
      if (qualification.issuedOn && qualification.expiresOn && qualification.expiresOn < qualification.issuedOn) {
        throw new BadRequestException('Qualification expiry date must be on or after issue date')
      }
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(memberQualifications).where(and(
        eq(memberQualifications.organizationId, identity.organizationId),
        eq(memberQualifications.userId, userId),
      ))
      if (dto.qualifications.length) {
        await tx.insert(memberQualifications).values(dto.qualifications.map((qualification) => ({
          organizationId: identity.organizationId, userId,
          name: qualification.name, certificateNo: qualification.certificateNo ?? '',
          issuedOn: qualification.issuedOn || null, expiresOn: qualification.expiresOn || null,
          notes: qualification.notes ?? '', createdBy: identity.userId, updatedBy: identity.userId,
        })))
      }
    })
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, actorUserId: identity.userId,
      action: 'crew.member_qualifications.replaced', resourceType: 'user', resourceId: userId,
      afterData: { qualifications: dto.qualifications }, requestId: identity.requestId,
    })
    return this.crewMemberCatalog(identity)
  }

  async replaceMemberUnavailability(userId: string, dto: ReplaceMemberUnavailabilityDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.dispatch')
    await this.assertOrganizationUsers(identity.organizationId, [userId])
    for (const period of dto.periods) {
      if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(period.endDate)
        || !['leave', 'training', 'medical', 'other'].includes(period.type)) {
        throw new BadRequestException('Invalid unavailability period')
      }
      if (period.endDate < period.startDate) throw new BadRequestException('Unavailability end date must be on or after start date')
      if (period.reason !== undefined && (typeof period.reason !== 'string' || period.reason.length > 500)) {
        throw new BadRequestException('Invalid unavailability reason')
      }
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(memberUnavailability).where(and(
        eq(memberUnavailability.organizationId, identity.organizationId), eq(memberUnavailability.userId, userId),
      ))
      if (dto.periods.length) {
        await tx.insert(memberUnavailability).values(dto.periods.map((period) => ({
          organizationId: identity.organizationId, userId, startDate: period.startDate, endDate: period.endDate,
          type: period.type, reason: period.reason ?? '', createdBy: identity.userId, updatedBy: identity.userId,
        })))
      }
    })
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, actorUserId: identity.userId,
      action: 'crew.member_unavailability.replaced', resourceType: 'user', resourceId: userId,
      afterData: { periods: dto.periods }, requestId: identity.requestId,
    })
    return this.crewMemberCatalog(identity)
  }

  private async assertOrganizationUsers(organizationId: string, userIds: string[]) {
    if (!userIds.length) return
    const rows = await this.db.select({ id: organizationMembers.userId }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, organizationId), inArray(organizationMembers.userId, userIds),
    ))
    if (rows.length !== new Set(userIds).size) throw new BadRequestException('One or more users do not belong to the organization')
  }

  private validateRequiredQualifications(requirements: Array<{ name: string; count: number }> | undefined) {
    if (!requirements) return undefined
    const normalized = requirements.map((item) => ({
      name: typeof item?.name === 'string' ? item.name.trim() : '', count: Number(item?.count),
    }))
    if (normalized.some((item) => !item.name || item.name.length > 120 || !Number.isInteger(item.count) || item.count < 1 || item.count > 500)) {
      throw new BadRequestException('Invalid required qualification')
    }
    const unique = new Map<string, { name: string; count: number }>()
    for (const item of normalized) unique.set(item.name.toLocaleLowerCase('zh-TW'), item)
    return [...unique.values()]
  }

  async listCrewDispatches(query: CrewDispatchQuery, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.view')
    const [organizationRole] = identity.userId
      ? await this.db.select({ role: organizationMembers.role }).from(organizationMembers).where(and(
        eq(organizationMembers.organizationId, identity.organizationId),
        eq(organizationMembers.userId, identity.userId),
      )).limit(1)
      : []
    const visibleProjectIds = organizationRole?.role === 'admin' || !identity.userId
      ? null
      : (await this.db.select({ id: projectMembers.projectId }).from(projectMembers)
        .where(eq(projectMembers.userId, identity.userId))).map((item) => item.id)
    if (visibleProjectIds && !visibleProjectIds.length) return { dispatches: [], warnings: [] }

    const conditions = [
      eq(crewDispatches.organizationId, identity.organizationId),
      ne(crewDispatches.status, 'cancelled'),
      visibleProjectIds ? inArray(crewDispatches.projectId, visibleProjectIds) : sql`true`,
    ]
    if (query.from) conditions.push(gte(crewDispatches.endDate, query.from))
    if (query.to) conditions.push(lte(crewDispatches.startDate, query.to))
    const rows = await this.db.select({
      id: crewDispatches.id, crewName: crewDispatches.crewName,
      projectId: crewDispatches.projectId, projectCode: projects.code, projectName: projects.name,
      taskId: crewDispatches.taskId, taskCode: wbsTasks.code, taskName: wbsTasks.name,
      startDate: crewDispatches.startDate, endDate: crewDispatches.endDate,
      plannedPeople: crewDispatches.plannedPeople, dailyHours: crewDispatches.dailyHours,
      status: crewDispatches.status, note: crewDispatches.note,
      requiredQualifications: crewDispatches.requiredQualifications, version: crewDispatches.version,
    }).from(crewDispatches)
      .innerJoin(projects, eq(projects.id, crewDispatches.projectId))
      .leftJoin(wbsTasks, eq(wbsTasks.id, crewDispatches.taskId))
      .where(and(...conditions)).orderBy(asc(crewDispatches.crewName), asc(crewDispatches.startDate))

    const crewMembers = await this.db.select({
      userId: appUsers.id, crewName: appUsers.crewName,
    }).from(organizationMembers).innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
      .where(and(
        eq(organizationMembers.organizationId, identity.organizationId), eq(appUsers.status, 'active'),
        sql`length(trim(${appUsers.crewName})) > 0`,
      ))
    const unavailable = crewMembers.length ? await this.db.select({
      userId: memberUnavailability.userId, startDate: memberUnavailability.startDate,
      endDate: memberUnavailability.endDate, type: memberUnavailability.type,
    }).from(memberUnavailability).where(and(
      eq(memberUnavailability.organizationId, identity.organizationId),
      inArray(memberUnavailability.userId, crewMembers.map((member) => member.userId)),
    )) : []
    const qualifications = crewMembers.length ? await this.db.select({
      userId: memberQualifications.userId, name: memberQualifications.name, expiresOn: memberQualifications.expiresOn,
    }).from(memberQualifications).where(and(
      eq(memberQualifications.organizationId, identity.organizationId),
      inArray(memberQualifications.userId, crewMembers.map((member) => member.userId)),
    )) : []
    const sizeByCrew = new Map<string, number>()
    for (const member of crewMembers) sizeByCrew.set(member.crewName.trim(), (sizeByCrew.get(member.crewName.trim()) ?? 0) + 1)
    const dispatches = rows.map((row) => ({
      ...row,
      plannedPeople: Number(row.plannedPeople), dailyHours: Number(row.dailyHours),
      crewSize: sizeByCrew.get(row.crewName.trim()) ?? 0,
      unavailablePeople: new Set(unavailable.filter((period) => {
        const member = crewMembers.find((item) => item.userId === period.userId)
        return member?.crewName.trim() === row.crewName.trim()
          && period.startDate <= row.endDate && period.endDate >= row.startDate
      }).map((period) => period.userId)).size,
    }))
    const warnings = dispatches.flatMap((dispatch) => {
      const overlapping = dispatches.filter((other) => other.id !== dispatch.id
        && other.crewName === dispatch.crewName
        && other.startDate <= dispatch.endDate && other.endDate >= dispatch.startDate)
      const peopleOnSamePeriod = dispatch.plannedPeople + overlapping.reduce((sum, item) => sum + item.plannedPeople, 0)
      const messages: Array<{ dispatchId: string; type: string; message: string }> = []
      if (overlapping.some((item) => item.projectId !== dispatch.projectId)) {
        messages.push({ dispatchId: dispatch.id, type: 'project_conflict', message: `${dispatch.crewName} 同期被安排至多個專案` })
      }
      if (dispatch.crewSize === 0) {
        messages.push({ dispatchId: dispatch.id, type: 'missing_members', message: `${dispatch.crewName} 尚未配置平台成員` })
      } else if (peopleOnSamePeriod > dispatch.crewSize - dispatch.unavailablePeople) {
        const availablePeople = Math.max(0, dispatch.crewSize - dispatch.unavailablePeople)
        messages.push({ dispatchId: dispatch.id, type: 'capacity', message: `${dispatch.crewName} 排定 ${peopleOnSamePeriod} 人，該期間實際可用 ${availablePeople} 人${dispatch.unavailablePeople ? `（${dispatch.unavailablePeople} 人不可派工）` : ''}` })
      }
      for (const requirement of dispatch.requiredQualifications ?? []) {
        const qualifiedUsers = new Set(qualifications.filter((qualification) => {
          const member = crewMembers.find((item) => item.userId === qualification.userId)
          if (member?.crewName.trim() !== dispatch.crewName.trim()) return false
          if (qualification.name.trim().toLocaleLowerCase('zh-TW') !== requirement.name.trim().toLocaleLowerCase('zh-TW')) return false
          if (qualification.expiresOn && qualification.expiresOn < dispatch.endDate) return false
          return !unavailable.some((period) => period.userId === qualification.userId
            && period.startDate <= dispatch.endDate && period.endDate >= dispatch.startDate)
        }).map((qualification) => qualification.userId))
        if (qualifiedUsers.size < requirement.count) {
          messages.push({ dispatchId: dispatch.id, type: 'qualification', message: `${dispatch.crewName} 需要「${requirement.name}」${requirement.count} 人，該期間僅 ${qualifiedUsers.size} 人資格有效且可出勤` })
        }
      }
      return messages
    })
    return { dispatches, warnings }
  }

  async createCrewDispatch(dto: CreateCrewDispatchDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.dispatch', dto.projectId)
    if (dto.endDate < dto.startDate) throw new BadRequestException('Dispatch end date must be on or after start date')
    const [project] = await this.db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.id, dto.projectId), eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt),
    )).limit(1)
    if (!project) throw new NotFoundException('Project not found')
    if (dto.taskId) {
      const [task] = await this.db.select({ id: wbsTasks.id }).from(wbsTasks).where(and(
        eq(wbsTasks.id, dto.taskId), eq(wbsTasks.projectId, dto.projectId), isNull(wbsTasks.archivedAt),
      )).limit(1)
      if (!task) throw new BadRequestException('Task does not belong to the selected project')
    }
    const requiredQualifications = this.validateRequiredQualifications(dto.requiredQualifications) ?? []
    const [created] = await this.db.insert(crewDispatches).values({
      organizationId: identity.organizationId, crewName: dto.crewName,
      projectId: dto.projectId, taskId: dto.taskId,
      startDate: dto.startDate, endDate: dto.endDate,
      plannedPeople: String(dto.plannedPeople), dailyHours: String(dto.dailyHours),
      note: dto.note ?? '', requiredQualifications, createdBy: identity.userId, updatedBy: identity.userId,
    }).returning()
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId: dto.projectId, actorUserId: identity.userId,
      action: 'crew.dispatch.created', resourceType: 'crew_dispatch', resourceId: created!.id,
      afterData: created, requestId: identity.requestId,
    })
    return { ...created!, plannedPeople: Number(created!.plannedPeople), dailyHours: Number(created!.dailyHours) }
  }

  async updateCrewDispatch(dispatchId: string, dto: UpdateCrewDispatchDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    const [current] = await this.db.select().from(crewDispatches).where(and(
      eq(crewDispatches.id, dispatchId), eq(crewDispatches.organizationId, identity.organizationId),
    )).limit(1)
    if (!current) throw new NotFoundException('Crew dispatch not found')
    await this.authz.assert(identity, 'labor.dispatch', current.projectId)
    const startDate = dto.startDate ?? current.startDate
    const endDate = dto.endDate ?? current.endDate
    if (endDate < startDate) throw new BadRequestException('Dispatch end date must be on or after start date')
    const requiredQualifications = this.validateRequiredQualifications(dto.requiredQualifications)
    const [updated] = await this.db.update(crewDispatches).set({
      startDate, endDate,
      plannedPeople: dto.plannedPeople === undefined ? undefined : String(dto.plannedPeople),
      dailyHours: dto.dailyHours === undefined ? undefined : String(dto.dailyHours),
      status: dto.status, note: dto.note, requiredQualifications, updatedBy: identity.userId,
      version: sql`${crewDispatches.version} + 1`, updatedAt: new Date(),
    }).where(eq(crewDispatches.id, dispatchId)).returning()
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId: current.projectId, actorUserId: identity.userId,
      action: 'crew.dispatch.updated', resourceType: 'crew_dispatch', resourceId: dispatchId,
      beforeData: current, afterData: updated, requestId: identity.requestId,
    })
    return { ...updated!, plannedPeople: Number(updated!.plannedPeople), dailyHours: Number(updated!.dailyHours) }
  }

  async cancelCrewDispatch(dispatchId: string, rawIdentity: RequestIdentity) {
    await this.updateCrewDispatch(dispatchId, { status: 'cancelled' }, rawIdentity)
  }

  async listLaborEntries(query: LaborEntryQuery, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.view', query.projectId)
    const conditions = [eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt)]
    if (query.projectId) conditions.push(eq(laborEntries.projectId, query.projectId))
    if (query.from) conditions.push(gte(laborEntries.workDate, query.from))
    if (query.to) conditions.push(lte(laborEntries.workDate, query.to))
    if (query.status) conditions.push(eq(laborEntries.status, query.status))
    const rows = await this.db.select({
      id: laborEntries.id, projectId: laborEntries.projectId,
      projectCode: projects.code, projectName: projects.name,
      taskId: laborEntries.taskId, taskCode: wbsTasks.code, taskName: wbsTasks.name,
      workDate: laborEntries.workDate, people: laborEntries.people, hours: laborEntries.hours,
      crewName: laborEntries.crewName, note: laborEntries.note, status: laborEntries.status,
      reportedBy: laborEntries.reportedBy, verifiedBy: laborEntries.verifiedBy,
      verifiedAt: laborEntries.verifiedAt, rejectionReason: laborEntries.rejectionReason,
      reporterName: sql<string | null>`(select u.display_name from app_users u where u.id = ${laborEntries.reportedBy})`,
      verifierName: sql<string | null>`(select u.display_name from app_users u where u.id = ${laborEntries.verifiedBy})`,
      createdAt: laborEntries.createdAt,
    }).from(laborEntries)
      .innerJoin(projects, eq(projects.id, laborEntries.projectId))
      .innerJoin(wbsTasks, eq(wbsTasks.id, laborEntries.taskId))
      .where(and(...conditions)).orderBy(desc(laborEntries.workDate), desc(laborEntries.createdAt))
    return {
      entries: rows.map((row) => ({
        ...row, people: Number(row.people), hours: Number(row.hours),
        totalHours: Number(row.people) * Number(row.hours),
      })),
    }
  }

  async createLaborEntry(dto: CreateLaborEntryDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'labor.report', dto.projectId)
    const [task] = await this.db.select({ id: wbsTasks.id }).from(wbsTasks)
      .innerJoin(projects, eq(projects.id, wbsTasks.projectId))
      .where(and(
        eq(wbsTasks.id, dto.taskId), eq(wbsTasks.projectId, dto.projectId),
        eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt), isNull(wbsTasks.archivedAt),
      )).limit(1)
    if (!task) throw new BadRequestException('Task does not belong to the selected project')
    const [created] = await this.db.insert(laborEntries).values({
      projectId: dto.projectId, taskId: dto.taskId, workDate: dto.workDate,
      people: String(dto.people), hours: String(dto.hours), crewName: dto.crewName ?? '', note: dto.note ?? '',
      status: 'pending', reportedBy: identity.userId,
    }).returning()
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId: dto.projectId, actorUserId: identity.userId,
      action: 'labor.entry.reported', resourceType: 'labor_entry', resourceId: created!.id,
      afterData: created, requestId: identity.requestId,
    })
    return { ...created!, people: Number(created!.people), hours: Number(created!.hours) }
  }

  async reviewLaborEntry(entryId: string, status: 'approved' | 'rejected', rejectionReason: string, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    const [current] = await this.db.select().from(laborEntries)
      .innerJoin(projects, eq(projects.id, laborEntries.projectId))
      .where(and(
        eq(laborEntries.id, entryId), eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt),
      )).limit(1)
    if (!current) throw new NotFoundException('Labor entry not found')
    await this.authz.assert(identity, 'labor.verify', current.labor_entries.projectId)
    if (current.labor_entries.status !== 'pending') throw new ConflictException('Labor entry has already been reviewed')
    const [updated] = await this.db.update(laborEntries).set({
      status, rejectionReason: status === 'rejected' ? rejectionReason : '',
      verifiedBy: identity.userId, verifiedAt: new Date(),
    }).where(and(eq(laborEntries.id, entryId), eq(laborEntries.status, 'pending'))).returning()
    if (!updated) throw new ConflictException('Labor entry has already been reviewed')
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId: updated.projectId, actorUserId: identity.userId,
      action: `labor.entry.${status}`, resourceType: 'labor_entry', resourceId: entryId,
      beforeData: current.labor_entries, afterData: updated, requestId: identity.requestId,
    })
    return { ...updated, people: Number(updated.people), hours: Number(updated.hours) }
  }

  async create(
    dto: CreateProjectDto,
    idempotencyKey: string,
    rawIdentity: RequestIdentity,
  ): Promise<ReturnType<typeof presentProject>> {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.create')
    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex')
    const [existing] = await this.db.select().from(idempotencyKeys).where(and(
      eq(idempotencyKeys.organizationId, identity.organizationId!),
      eq(idempotencyKeys.operation, 'create-project'),
      eq(idempotencyKeys.key, idempotencyKey),
    )).limit(1)
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictException('Idempotency key was already used with another request')
      if (existing.responseBody) return existing.responseBody as ReturnType<typeof presentProject>
    }

    try {
      const created = await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(projects).values({
          organizationId: identity.organizationId!,
          createdBy: identity.userId,
          code: dto.code,
          name: dto.name,
          description: dto.description ?? '',
          clientName: dto.clientName ?? '',
          location: dto.location ?? '',
          latitude: dto.latitude === undefined ? undefined : String(dto.latitude),
          longitude: dto.longitude === undefined ? undefined : String(dto.longitude),
          generatorModel: dto.generatorModel ?? '',
          crewName: dto.crewName ?? '',
          contractAmount: dto.contractAmount === undefined ? undefined : String(dto.contractAmount),
          status: dto.status,
          riskStatus: dto.riskStatus,
          startDate: dto.startDate,
          endDate: dto.endDate,
          managerId: dto.managerId,
        }).returning()
        if (!row) throw new Error('Project insert returned no row')
        await tx.insert(projectSettings).values({ projectId: row.id })
        await tx.insert(modelSets).values({ projectId: row.id, name: '主模型' })
        if (identity.userId) {
          const [creator] = await tx.select({ role: organizationMembers.role }).from(organizationMembers).where(and(
            eq(organizationMembers.organizationId, identity.organizationId!),
            eq(organizationMembers.userId, identity.userId),
          )).limit(1)
          if (creator && creator.role !== 'admin') {
            await tx.insert(projectMembers).values({
              projectId: row.id, userId: identity.userId,
              role: creator.role === 'planner' ? 'planner' : creator.role === 'worker' ? 'worker' : 'manager',
            })
          }
        }
        const response = presentProject({ ...row, managerName: null, progressPct: '0' })
        await tx.insert(auditLogs).values({
          organizationId: identity.organizationId, projectId: row.id, actorUserId: identity.userId,
          action: 'project.created', resourceType: 'project', resourceId: row.id,
          afterData: response, requestId: identity.requestId,
        })
        await tx.insert(idempotencyKeys).values({
          organizationId: identity.organizationId!, key: idempotencyKey,
          operation: 'create-project', requestHash, responseStatus: 201, responseBody: response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        return response
      })
      return created
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('Project code already exists')
      throw error
    }
  }

  async update(projectId: string, dto: UpdateProjectDto, ifMatch: string | undefined, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.edit', projectId)
    const expectedVersion = this.parseVersion(ifMatch)
    const before = await this.get(projectId, identity)
    const values = this.toDbValues(dto)
    if (Object.keys(values).length === 0) return before
    try {
      const [row] = await this.db.update(projects).set({
        ...values,
        version: sql`${projects.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(projects.id, projectId), eq(projects.organizationId, identity.organizationId!),
        eq(projects.version, expectedVersion), isNull(projects.deletedAt),
      )).returning()
      if (!row) throw new ConflictException('Project was changed by another user')
      const response = presentProject({ ...row, managerName: null, progressPct: String(before.progressPct) })
      await this.db.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'project.updated', resourceType: 'project', resourceId: projectId,
        beforeData: before, afterData: response, requestId: identity.requestId,
      })
      return response
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('Project code already exists')
      throw error
    }
  }

  async archive(projectId: string, dto: ArchiveProjectDto, ifMatch: string | undefined, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.archive', projectId)
    const expectedVersion = this.parseVersion(ifMatch)
    const before = await this.get(projectId, identity)
    const [row] = await this.db.update(projects).set({
      statusBeforeArchive: before.status,
      status: 'archived', deletedAt: new Date(), deletedBy: identity.userId,
      deletionReason: dto.reason ?? null, version: sql`${projects.version} + 1`, updatedAt: new Date(),
    }).where(and(
      eq(projects.id, projectId), eq(projects.organizationId, identity.organizationId!),
      eq(projects.version, expectedVersion), isNull(projects.deletedAt),
    )).returning()
    if (!row) throw new ConflictException('Project was changed by another user')
    const response = presentProject({ ...row, managerName: null, progressPct: String(before.progressPct) })
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action: 'project.archived', resourceType: 'project', resourceId: projectId,
      beforeData: before, afterData: response, requestId: identity.requestId,
    })
    return response
  }

  async listMembers(projectId: string, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.member.manage', projectId)
    await this.get(projectId, identity)
    const [accounts, assigned] = await Promise.all([
      this.db.select({
        id: appUsers.id, email: appUsers.email, displayName: appUsers.displayName,
        department: appUsers.department, crewName: appUsers.crewName,
        accountRole: organizationMembers.role,
      }).from(organizationMembers)
        .innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
        .where(and(
          eq(organizationMembers.organizationId, identity.organizationId),
          eq(appUsers.status, 'active'),
          inArray(organizationMembers.role, ['planner', 'manager', 'worker']),
        ))
        .orderBy(asc(appUsers.displayName)),
      this.db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)),
    ])
    const roles = new Map(assigned.map((member) => [member.userId, member.role]))
    return accounts.map((account) => ({ ...account, assignedRole: roles.get(account.id) ?? null }))
  }

  async replaceMembers(projectId: string, dto: ReplaceProjectMembersDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.member.manage', projectId)
    await this.get(projectId, identity)
    const allowedRoles = new Set(['planner', 'manager', 'worker', 'viewer'])
    if (dto.members.some((member) => !member || !isUUID(member.userId) || !allowedRoles.has(member.role))) {
      throw new BadRequestException('Project member payload is invalid')
    }
    const uniqueIds = [...new Set(dto.members.map((member) => member.userId))]
    if (uniqueIds.length !== dto.members.length) throw new ConflictException('Project member is duplicated')
    if (uniqueIds.length) {
      const valid = await this.db.select({ id: appUsers.id }).from(organizationMembers)
        .innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
        .where(and(
          eq(organizationMembers.organizationId, identity.organizationId),
          eq(appUsers.status, 'active'),
          inArray(organizationMembers.role, ['planner', 'manager', 'worker']),
          inArray(appUsers.id, uniqueIds),
        ))
      if (valid.length !== uniqueIds.length) throw new NotFoundException('One or more project members are unavailable')
    }
    await this.db.transaction(async (tx) => {
      const previousViewers = await tx.select({ userId: projectMembers.userId }).from(projectMembers).where(and(
        eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'viewer'),
      ))
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId))
      if (dto.members.length) await tx.insert(projectMembers).values(dto.members.map((member) => ({
        projectId, userId: member.userId, role: member.role,
      })))
      const viewerIds = dto.members.filter((member) => member.role === 'viewer').map((member) => member.userId)
      const affectedViewerIds = [...new Set([...previousViewers.map((item) => item.userId), ...viewerIds])]
      if (affectedViewerIds.length) {
        await tx.delete(userPermissionOverrides).where(and(
          eq(userPermissionOverrides.organizationId, identity.organizationId),
          inArray(userPermissionOverrides.userId, affectedViewerIds),
          eq(userPermissionOverrides.scopeType, 'project'),
          eq(userPermissionOverrides.projectId, projectId),
          eq(userPermissionOverrides.reason, 'owner_readonly_preset'),
        ))
      }
      if (viewerIds.length) {
        const allow = ['project.view', 'wbs.view', 'model.view', 'progress.view', 'report.project.view', 'report.export', 'report.contract_amount.view']
        const deny = ['project.edit', 'project.member.manage', 'wbs.edit', 'wbs.import', 'wbs.submit', 'wbs.approve', 'wbs.publish', 'model.upload', 'model.mapping.edit', 'model.publish', 'progress.report', 'progress.verify', 'photo.upload', 'ai.assistant.use', 'ai.progress.confirm', 'labor.dispatch', 'labor.report', 'labor.verify']
        await tx.insert(userPermissionOverrides).values(viewerIds.flatMap((userId) => [
          ...allow.map((permissionCode) => ({ organizationId: identity.organizationId, userId, permissionCode, effect: 'allow' as const, scopeType: 'project', projectId, reason: 'owner_readonly_preset', grantedBy: identity.userId })),
          ...deny.map((permissionCode) => ({ organizationId: identity.organizationId, userId, permissionCode, effect: 'deny' as const, scopeType: 'project', projectId, reason: 'owner_readonly_preset', grantedBy: identity.userId })),
        ]))
      }
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'project.members.updated', resourceType: 'project', resourceId: projectId,
        afterData: dto.members, requestId: identity.requestId,
      })
    })
    return this.listMembers(projectId, identity)
  }

  async recordReportExport(projectId: string, dto: RecordReportExportDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'report.export', projectId)
    await this.get(projectId, identity)
    const [entry] = await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action: `report.exported.${dto.format}`, resourceType: 'project_report', resourceId: projectId,
      afterData: { format: dto.format, dataDate: dto.dataDate ?? null }, requestId: identity.requestId,
    }).returning({ id: auditLogs.id, createdAt: auditLogs.createdAt })
    return { id: entry!.id, format: dto.format, createdAt: entry!.createdAt.toISOString() }
  }

  async reportActivity(projectId: string, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'report.project.view', projectId)
    await this.get(projectId, identity)
    const rows = await this.db.select({
      id: auditLogs.id, action: auditLogs.action, actorUserId: auditLogs.actorUserId,
      actorName: appUsers.displayName, actorEmail: appUsers.email,
      data: auditLogs.afterData, createdAt: auditLogs.createdAt,
    }).from(auditLogs)
      .leftJoin(appUsers, eq(appUsers.id, auditLogs.actorUserId))
      .where(and(
        eq(auditLogs.organizationId, identity.organizationId),
        eq(auditLogs.projectId, projectId),
        inArray(auditLogs.action, ['report.exported.csv', 'report.exported.pdf', 'report.acknowledged']),
      )).orderBy(desc(auditLogs.createdAt)).limit(30)
    return { items: rows.map((row) => ({
      ...row, actorName: row.actorName || row.actorEmail || '平台使用者',
      createdAt: row.createdAt.toISOString(),
    })) }
  }

  async acknowledgeReport(projectId: string, dto: AcknowledgeReportDto, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'report.project.view', projectId)
    await this.get(projectId, identity)
    const [entry] = await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action: 'report.acknowledged', resourceType: 'project_report', resourceId: projectId,
      afterData: { note: dto.note ?? '', dataDate: dto.dataDate ?? null }, requestId: identity.requestId,
    }).returning({ id: auditLogs.id, createdAt: auditLogs.createdAt })
    return { id: entry!.id, createdAt: entry!.createdAt.toISOString() }
  }

  async restore(projectId: string, ifMatch: string | undefined, rawIdentity: RequestIdentity) {
    const identity = await this.resolveIdentity(rawIdentity)
    await this.authz.assert(identity, 'project.restore', projectId)
    const expectedVersion = this.parseVersion(ifMatch)
    const [row] = await this.db.update(projects).set({
      status: sql`coalesce(${projects.statusBeforeArchive}, 'planning')`,
      statusBeforeArchive: null, deletedAt: null, deletedBy: null, deletionReason: null,
      version: sql`${projects.version} + 1`, updatedAt: new Date(),
    }).where(and(
      eq(projects.id, projectId), eq(projects.organizationId, identity.organizationId!),
      eq(projects.version, expectedVersion), isNotNull(projects.deletedAt),
    )).returning()
    if (!row) throw new ConflictException('Archived project was not found at the requested version')
    const response = presentProject({ ...row, managerName: null, progressPct: '0' })
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action: 'project.restored', resourceType: 'project', resourceId: projectId,
      afterData: response, requestId: identity.requestId,
    })
    return response
  }

  private parseVersion(ifMatch?: string) {
    if (!ifMatch) throw new HttpException('If-Match header is required', 428)
    const match = ifMatch.match(/^W\/"(\d+)"$/)
    if (!match?.[1]) throw new HttpException('If-Match must look like W/"7"', 428)
    return Number(match[1])
  }

  private toDbValues(dto: CreateProjectDto | UpdateProjectDto) {
    const mapping = {
      code: dto.code, name: dto.name, description: dto.description,
      clientName: dto.clientName, location: dto.location,
      latitude: dto.latitude === undefined ? undefined : String(dto.latitude),
      longitude: dto.longitude === undefined ? undefined : String(dto.longitude),
      generatorModel: dto.generatorModel, crewName: dto.crewName,
      contractAmount: dto.contractAmount === undefined ? undefined : String(dto.contractAmount),
      status: dto.status, riskStatus: dto.riskStatus,
      startDate: dto.startDate, endDate: dto.endDate, managerId: dto.managerId,
    }
    return Object.fromEntries(Object.entries(mapping).filter(([, value]) => value !== undefined))
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
  }
}
