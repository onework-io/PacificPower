import { createHash } from 'node:crypto'
import {
  BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException,
} from '@nestjs/common'
import { and, asc, desc, eq, inArray, isNull, max, or, sql } from 'drizzle-orm'
import type { AuthenticatedIdentity } from '../auth/auth.types.js'
import { AuthorizationService } from '../authz/authorization.service.js'
import { DATABASE, type Database } from '../database/database.module.js'
import {
  appUsers, auditLogs, dailyReportLaborEntries, dailyReports, dailyReportTasks, idempotencyKeys, laborEntries, modelParts,
  organizationMembers, progressSnapshots, progressUpdates, projectMembers, projects, taskAssignments, taskDependencies,
  wbsTasks, wbsVersionEvents, wbsVersions,
} from '../database/schema.js'
import type {
  CreateDailyReportDto, CreateProgressReportDto, CreateWbsTaskDto, CreateWbsVersionDto, RejectWbsVersionDto,
  ReplaceDependenciesDto, ReplaceTaskAssignmentsDto, UpdateWbsTaskDto, UpdateWbsVersionDto,
} from './wbs.dto.js'
import { calculateWbsSchedule, topologicalOrder } from './wbs.schedule.js'
import { diffWbsSnapshots, normalizeAndValidateSnapshot, type WbsSnapshot } from './wbs.version.js'

export interface PresentedTask {
  id: string
  projectId: string
  stableKey: string
  code: string
  sequence: number
  name: string
  phase: string
  durationDays: number
  weightPct: number | null
  progressPct: number
  pinnedStartDay: number | null
  lagDays: number
  modelPartKey: string | null
  version: number
}

@Injectable()
export class WbsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
  ) {}

  async list(projectId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'wbs.view')
    const rows = await this.db.select().from(wbsTasks).where(and(
      eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt),
    )).orderBy(asc(wbsTasks.sequence))
    const taskIds = rows.map((row) => row.id)
    const dependencies = taskIds.length ? await this.db.select().from(taskDependencies).where(and(
      inArray(taskDependencies.predecessorTaskId, taskIds),
      inArray(taskDependencies.successorTaskId, taskIds),
    )) : []
    return {
      projectId,
      tasks: rows.map((row) => this.presentTask(row)),
      dependencies: dependencies.map((dependency) => ({
        predecessorTaskId: dependency.predecessorTaskId,
        successorTaskId: dependency.successorTaskId,
        relationType: dependency.relationType,
        lagDays: Number(dependency.lagDays),
      })),
    }
  }

  async create(projectId: string, dto: CreateWbsTaskDto, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'wbs.edit')
    try {
      const [row] = await this.db.insert(wbsTasks).values({
        projectId, stableKey: dto.stableKey, code: dto.code, sequence: dto.sequence,
        name: dto.name, phase: dto.phase, durationDays: String(dto.durationDays),
        weightPct: dto.weightPct === undefined ? undefined : String(dto.weightPct),
        progressPct: String(dto.progressPct ?? 0),
        pinnedStartDay: dto.pinnedStartDay == null ? null : String(dto.pinnedStartDay),
        lagDays: String(dto.lagDays ?? 0), modelPartKey: dto.modelPartKey ?? null,
      }).returning()
      if (!row) throw new Error('WBS task insert returned no row')
      const response = this.presentTask(row)
      await this.audit(identity, projectId, 'wbs.task.created', row.id, undefined, response)
      return response
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('WBS stable key, code or sequence already exists')
      throw error
    }
  }

  async update(
    projectId: string, taskId: string, dto: UpdateWbsTaskDto,
    ifMatch: string | undefined, identity: AuthenticatedIdentity,
  ) {
    const changesProgress = dto.progressPct !== undefined
    const changesPlan = Object.entries(dto).some(([field, value]) => field !== 'progressPct' && value !== undefined)
    if (changesPlan) await this.assertProject(projectId, identity, 'wbs.edit')
    if (changesProgress) await this.assertProject(projectId, identity, 'progress.verify')
    // An empty patch still requires normal WBS edit access instead of becoming an authorization bypass.
    if (!changesPlan && !changesProgress) await this.assertProject(projectId, identity, 'wbs.edit')
    const expectedVersion = this.parseVersion(ifMatch)
    const [beforeRow] = await this.db.select().from(wbsTasks).where(and(
      eq(wbsTasks.id, taskId), eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt),
    )).limit(1)
    if (!beforeRow) throw new NotFoundException('WBS task not found')
    const values = {
      code: dto.code,
      sequence: dto.sequence,
      name: dto.name,
      phase: dto.phase,
      durationDays: dto.durationDays === undefined ? undefined : String(dto.durationDays),
      weightPct: dto.weightPct === undefined ? undefined : (dto.weightPct === null ? null : String(dto.weightPct)),
      progressPct: dto.progressPct === undefined ? undefined : String(dto.progressPct),
      pinnedStartDay: dto.pinnedStartDay === undefined
        ? undefined : (dto.pinnedStartDay === null ? null : String(dto.pinnedStartDay)),
      lagDays: dto.lagDays === undefined ? undefined : String(dto.lagDays),
      modelPartKey: dto.modelPartKey,
    }
    const set = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
    if (!Object.keys(set).length) return this.presentTask(beforeRow)
    try {
      const [row] = await this.db.update(wbsTasks).set({
        ...set, version: sql`${wbsTasks.version} + 1`, updatedAt: new Date(),
      }).where(and(
        eq(wbsTasks.id, taskId), eq(wbsTasks.projectId, projectId),
        eq(wbsTasks.version, expectedVersion), isNull(wbsTasks.archivedAt),
      )).returning()
      if (!row) throw new ConflictException('WBS task was changed by another user')
      const before = this.presentTask(beforeRow)
      const response = this.presentTask(row)
      await this.audit(identity, projectId, 'wbs.task.updated', row.id, before, response)
      return response
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('WBS code or sequence already exists')
      throw error
    }
  }

  async fieldWork(projectId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'project.view')
    const [tasks, assignments, workers, reports, projectRole] = await Promise.all([
      this.db.select({
        id: wbsTasks.id, stableKey: wbsTasks.stableKey, code: wbsTasks.code,
        name: wbsTasks.name, phase: wbsTasks.phase, progressPct: wbsTasks.progressPct,
      }).from(wbsTasks).where(and(eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt)))
        .orderBy(asc(wbsTasks.sequence)),
      this.db.select({
        taskId: taskAssignments.taskId, userId: taskAssignments.userId,
        displayName: appUsers.displayName,
      }).from(taskAssignments).innerJoin(appUsers, eq(appUsers.id, taskAssignments.userId))
        .innerJoin(wbsTasks, eq(wbsTasks.id, taskAssignments.taskId))
        .where(eq(wbsTasks.projectId, projectId)),
      this.db.select({
        id: appUsers.id, displayName: appUsers.displayName, email: appUsers.email,
        crewName: appUsers.crewName,
      }).from(projectMembers).innerJoin(appUsers, eq(appUsers.id, projectMembers.userId))
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'worker')))
        .orderBy(asc(appUsers.displayName)),
      this.db.select({
        id: progressUpdates.id, taskId: progressUpdates.taskId, progressPct: progressUpdates.progressPct,
        note: progressUpdates.note, source: progressUpdates.source, reportedBy: progressUpdates.reportedBy,
        reporterName: appUsers.displayName, supersedesId: progressUpdates.supersedesId,
        dataDate: progressUpdates.dataDate, createdAt: progressUpdates.createdAt,
      }).from(progressUpdates).leftJoin(appUsers, eq(appUsers.id, progressUpdates.reportedBy))
        .where(eq(progressUpdates.projectId, projectId)).orderBy(desc(progressUpdates.createdAt)),
      identity.userId
        ? this.db.select({ role: projectMembers.role }).from(projectMembers).where(and(
          eq(projectMembers.projectId, projectId), eq(projectMembers.userId, identity.userId),
        )).limit(1)
        : Promise.resolve([]),
    ])
    const isWorker = projectRole[0]?.role === 'worker'
    const assignedTaskIds = new Set(assignments.filter((item) => item.userId === identity.userId).map((item) => item.taskId))
    const confirmed = new Set(reports.filter((report) => report.source === 'ai_confirmed' && report.supersedesId)
      .map((report) => report.supersedesId!))
    const latestByTask = new Map<string, typeof reports[number]>()
    for (const report of reports) {
      if (report.source !== 'manual' || latestByTask.has(report.taskId)) continue
      latestByTask.set(report.taskId, report)
    }
    return {
      workers,
      tasks: tasks.filter((task) => !isWorker || assignedTaskIds.has(task.id)).map((task) => {
        const taskAssignmentsList = assignments.filter((item) => item.taskId === task.id)
        const latest = latestByTask.get(task.id)
        return {
          ...task, progressPct: Number(task.progressPct),
          assignees: taskAssignmentsList.map(({ userId, displayName }) => ({ userId, displayName })),
          latestReport: latest ? {
            ...latest, progressPct: Number(latest.progressPct), confirmed: confirmed.has(latest.id),
            createdAt: latest.createdAt.toISOString(),
          } : null,
        }
      }),
    }
  }

  async replaceTaskAssignments(
    projectId: string, taskId: string, dto: ReplaceTaskAssignmentsDto, identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'labor.dispatch')
    const [task] = await this.db.select({ id: wbsTasks.id }).from(wbsTasks).where(and(
      eq(wbsTasks.id, taskId), eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt),
    )).limit(1)
    if (!task) throw new NotFoundException('WBS task not found')
    const userIds = [...new Set(dto.userIds)]
    if (userIds.length !== dto.userIds.length) throw new BadRequestException('Task assignee is duplicated')
    if (userIds.length) {
      const valid = await this.db.select({ id: projectMembers.userId }).from(projectMembers).where(and(
        eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'worker'),
        inArray(projectMembers.userId, userIds),
      ))
      if (valid.length !== userIds.length) throw new BadRequestException('Assignee must be a Worker in this project')
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(taskAssignments).where(eq(taskAssignments.taskId, taskId))
      if (userIds.length) await tx.insert(taskAssignments).values(userIds.map((userId) => ({
        taskId, userId, assignedBy: identity.userId,
      })))
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'task.assignments.updated', resourceType: 'wbs_task', resourceId: taskId,
        afterData: { userIds }, requestId: identity.requestId,
      })
    })
    return this.fieldWork(projectId, identity)
  }

  async createProgressReport(
    projectId: string, taskId: string, dto: CreateProgressReportDto, identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'progress.report')
    const [task] = await this.db.select({ id: wbsTasks.id }).from(wbsTasks).where(and(
      eq(wbsTasks.id, taskId), eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt),
    )).limit(1)
    if (!task) throw new NotFoundException('WBS task not found')
    const [member] = identity.userId ? await this.db.select({ role: projectMembers.role }).from(projectMembers).where(and(
      eq(projectMembers.projectId, projectId), eq(projectMembers.userId, identity.userId),
    )).limit(1) : []
    if (member?.role === 'worker') {
      const [assignment] = await this.db.select({ taskId: taskAssignments.taskId }).from(taskAssignments).where(and(
        eq(taskAssignments.taskId, taskId), eq(taskAssignments.userId, identity.userId!),
      )).limit(1)
      if (!assignment) throw new BadRequestException('Worker can only report an assigned task')
    }
    if (dto.actualHours !== undefined) await this.assertProject(projectId, identity, 'labor.report')
    const dataDate = dto.dataDate ?? new Date().toISOString().slice(0, 10)
    const [laborContext] = dto.actualHours !== undefined ? await this.db.select({
      crewName: sql<string>`coalesce(nullif(trim(${appUsers.crewName}), ''), ${projects.crewName}, '')`,
    }).from(projects).leftJoin(appUsers, eq(appUsers.id, identity.userId ?? '00000000-0000-0000-0000-000000000000'))
      .where(eq(projects.id, projectId)).limit(1) : []
    const [report] = await this.db.transaction(async (tx) => {
      const rows = await tx.insert(progressUpdates).values({
        projectId, taskId, dataDate, progressPct: String(dto.progressPct), note: dto.note ?? '',
        source: 'manual', reportedBy: identity.userId,
      }).returning()
      if (dto.actualHours !== undefined) await tx.insert(laborEntries).values({
        projectId, taskId, workDate: dataDate, hours: String(dto.actualHours),
        crewName: laborContext?.crewName ?? '', note: dto.note ?? '', reportedBy: identity.userId,
      })
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'progress.reported', resourceType: 'wbs_task', resourceId: taskId,
        afterData: dto, requestId: identity.requestId,
      })
      return rows
    })
    return report
  }

  async confirmProgressReport(projectId: string, reportId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'progress.verify')
    const [report] = await this.db.select().from(progressUpdates).where(and(
      eq(progressUpdates.id, reportId), eq(progressUpdates.projectId, projectId), eq(progressUpdates.source, 'manual'),
    )).limit(1)
    if (!report) throw new NotFoundException('Progress report not found')
    const [alreadyConfirmed] = await this.db.select({ id: progressUpdates.id }).from(progressUpdates).where(and(
      eq(progressUpdates.projectId, projectId), eq(progressUpdates.supersedesId, reportId),
      eq(progressUpdates.source, 'ai_confirmed'),
    )).limit(1)
    if (alreadyConfirmed) throw new ConflictException('Progress report was already confirmed')
    await this.db.transaction(async (tx) => {
      await tx.insert(progressUpdates).values({
        projectId, taskId: report.taskId, dataDate: report.dataDate, progressPct: report.progressPct,
        note: report.note, source: 'ai_confirmed', reportedBy: identity.userId, supersedesId: report.id,
      })
      await tx.update(wbsTasks).set({
        progressPct: report.progressPct, version: sql`${wbsTasks.version} + 1`, updatedAt: new Date(),
      }).where(and(eq(wbsTasks.id, report.taskId), eq(wbsTasks.projectId, projectId)))
      const [summary] = await tx.select({ earnedPct: sql<string>`coalesce(
        sum(coalesce(${wbsTasks.weightPct}, 0) * ${wbsTasks.progressPct}) /
          nullif(sum(coalesce(${wbsTasks.weightPct}, 0)), 0),
        avg(${wbsTasks.progressPct}), 0
      )` }).from(wbsTasks).where(and(eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt)))
      await tx.insert(progressSnapshots).values({
        projectId, dataDate: report.dataDate, plannedPct: '0', earnedPct: summary?.earnedPct ?? '0',
      }).onConflictDoUpdate({
        target: [progressSnapshots.projectId, progressSnapshots.dataDate],
        set: { earnedPct: summary?.earnedPct ?? '0', createdAt: new Date() },
      })
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'progress.confirmed', resourceType: 'progress_update', resourceId: reportId,
        afterData: { progressPct: Number(report.progressPct) }, requestId: identity.requestId,
      })
    })
    return { confirmed: true }
  }

  async listDailyReports(projectId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'progress.view')
    const rows = await this.db.select({
      id: dailyReports.id, projectId: dailyReports.projectId, reportDate: dailyReports.reportDate,
      crewName: dailyReports.crewName, weather: dailyReports.weather,
      workSummary: dailyReports.workSummary, issues: dailyReports.issues,
      safetyNotes: dailyReports.safetyNotes, nextPlan: dailyReports.nextPlan,
      status: dailyReports.status, reportedBy: dailyReports.reportedBy,
      reviewedBy: dailyReports.reviewedBy, reviewedAt: dailyReports.reviewedAt,
      rejectionReason: dailyReports.rejectionReason, createdAt: dailyReports.createdAt,
      reporterName: sql<string | null>`(select u.display_name from app_users u where u.id = ${dailyReports.reportedBy})`,
      reviewerName: sql<string | null>`(select u.display_name from app_users u where u.id = ${dailyReports.reviewedBy})`,
      photoCount: sql<number>`(select count(*)::int from project_images pi where pi.daily_report_id = ${dailyReports.id})`,
      progressCount: sql<number>`(select count(*)::int from daily_report_tasks drt where drt.daily_report_id = ${dailyReports.id})`,
      laborHours: sql<string>`coalesce((select sum(le.people * le.hours) from daily_report_labor_entries drle join labor_entries le on le.id = drle.labor_entry_id where drle.daily_report_id = ${dailyReports.id}), 0)`,
    }).from(dailyReports).where(eq(dailyReports.projectId, projectId))
      .orderBy(desc(dailyReports.reportDate), desc(dailyReports.createdAt))
    const reportIds = rows.map((row) => row.id)
    const linkedTasks = reportIds.length ? await this.db.select({
      dailyReportId: dailyReportTasks.dailyReportId, id: wbsTasks.id, code: wbsTasks.code,
      name: wbsTasks.name, progressPct: wbsTasks.progressPct,
    }).from(dailyReportTasks).innerJoin(wbsTasks, eq(wbsTasks.id, dailyReportTasks.taskId))
      .where(inArray(dailyReportTasks.dailyReportId, reportIds)).orderBy(asc(wbsTasks.sequence)) : []
    const linkedLabor = reportIds.length ? await this.db.select({
      dailyReportId: dailyReportLaborEntries.dailyReportId, id: laborEntries.id,
      taskId: laborEntries.taskId, crewName: laborEntries.crewName, people: laborEntries.people,
      hours: laborEntries.hours, note: laborEntries.note,
      taskCode: wbsTasks.code, taskName: wbsTasks.name,
    }).from(dailyReportLaborEntries)
      .innerJoin(laborEntries, eq(laborEntries.id, dailyReportLaborEntries.laborEntryId))
      .innerJoin(wbsTasks, eq(wbsTasks.id, laborEntries.taskId))
      .where(inArray(dailyReportLaborEntries.dailyReportId, reportIds))
      .orderBy(asc(wbsTasks.sequence)) : []
    return { reports: rows.map((row) => ({
      ...row,
      laborHours: Number(row.laborHours),
      tasks: linkedTasks.filter((item) => item.dailyReportId === row.id).map((item) => ({
        id: item.id, code: item.code, name: item.name, progressPct: Number(item.progressPct),
      })),
      laborEntries: linkedLabor.filter((item) => item.dailyReportId === row.id).map((item) => ({
        id: item.id, taskId: item.taskId, taskCode: item.taskCode, taskName: item.taskName,
        crewName: item.crewName, people: Number(item.people), hours: Number(item.hours),
        totalHours: Number(item.people) * Number(item.hours), note: item.note,
      })),
    })) }
  }

  async createDailyReport(projectId: string, dto: CreateDailyReportDto, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'progress.report')
    const taskIds = [...new Set(dto.taskIds ?? [])]
    const laborEntryIds = [...new Set(dto.laborEntryIds ?? [])]
    if (taskIds.length) {
      const tasks = await this.db.select({ id: wbsTasks.id }).from(wbsTasks).where(and(
        eq(wbsTasks.projectId, projectId), inArray(wbsTasks.id, taskIds), isNull(wbsTasks.archivedAt),
      ))
      if (tasks.length !== taskIds.length) throw new BadRequestException('One or more WBS tasks do not belong to this project')
    }
    if (laborEntryIds.length) {
      const entries = await this.db.select({ id: laborEntries.id }).from(laborEntries).where(and(
        eq(laborEntries.projectId, projectId), eq(laborEntries.workDate, dto.reportDate),
        eq(laborEntries.status, 'approved'), inArray(laborEntries.id, laborEntryIds),
      ))
      if (entries.length !== laborEntryIds.length) {
        throw new BadRequestException('Labor entries must be approved, on the report date, and belong to this project')
      }
    }
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(dailyReports).values({
        projectId, reportDate: dto.reportDate, crewName: dto.crewName ?? '', weather: dto.weather ?? '',
        workSummary: dto.workSummary, issues: dto.issues ?? '', safetyNotes: dto.safetyNotes ?? '',
        nextPlan: dto.nextPlan ?? '', status: 'pending', reportedBy: identity.userId,
      }).returning()
      if (taskIds.length) await tx.insert(dailyReportTasks).values(taskIds.map((taskId) => ({
        dailyReportId: created!.id, taskId,
      })))
      if (laborEntryIds.length) await tx.insert(dailyReportLaborEntries).values(laborEntryIds.map((laborEntryId) => ({
        dailyReportId: created!.id, laborEntryId,
      })))
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'daily_report.created', resourceType: 'daily_report', resourceId: created!.id,
        afterData: { ...created!, taskIds, laborEntryIds }, requestId: identity.requestId,
      })
      return created!
    })
  }

  async reviewDailyReport(
    projectId: string, reportId: string, status: 'approved' | 'rejected', rejectionReason: string,
    identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'progress.verify')
    const [current] = await this.db.select().from(dailyReports).where(and(
      eq(dailyReports.id, reportId), eq(dailyReports.projectId, projectId),
    )).limit(1)
    if (!current) throw new NotFoundException('Daily report not found')
    if (current.status !== 'pending') throw new ConflictException('Daily report has already been reviewed')
    const [updated] = await this.db.update(dailyReports).set({
      status, rejectionReason: status === 'rejected' ? rejectionReason : '',
      reviewedBy: identity.userId, reviewedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(dailyReports.id, reportId), eq(dailyReports.status, 'pending'))).returning()
    if (!updated) throw new ConflictException('Daily report has already been reviewed')
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action: `daily_report.${status}`, resourceType: 'daily_report', resourceId: reportId,
      beforeData: current, afterData: updated, requestId: identity.requestId,
    })
    return updated
  }

  async replaceDependencies(
    projectId: string, taskId: string, dto: ReplaceDependenciesDto, identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'wbs.edit')
    const taskRows = await this.db.select({ id: wbsTasks.id }).from(wbsTasks).where(and(
      eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt),
    ))
    const taskIds = taskRows.map((task) => task.id)
    const taskSet = new Set(taskIds)
    if (!taskSet.has(taskId)) throw new NotFoundException('WBS task not found')
    const uniquePredecessors = new Set(dto.predecessors.map((item) => item.predecessorTaskId))
    if (uniquePredecessors.size !== dto.predecessors.length) throw new ConflictException('Duplicate predecessor')
    for (const predecessor of dto.predecessors) {
      if (!taskSet.has(predecessor.predecessorTaskId)) throw new ConflictException('Predecessor belongs to another project')
      if (predecessor.predecessorTaskId === taskId) throw new ConflictException('A task cannot depend on itself')
    }
    const current = taskIds.length ? await this.db.select().from(taskDependencies).where(and(
      inArray(taskDependencies.predecessorTaskId, taskIds),
      inArray(taskDependencies.successorTaskId, taskIds),
    )) : []
    const edges = current
      .filter((edge) => edge.successorTaskId !== taskId)
      .map((edge) => [edge.predecessorTaskId, edge.successorTaskId] as const)
    edges.push(...dto.predecessors.map((edge) => [edge.predecessorTaskId, taskId] as const))
    this.assertAcyclic(taskIds, edges)

    await this.db.transaction(async (tx) => {
      await tx.delete(taskDependencies).where(eq(taskDependencies.successorTaskId, taskId))
      if (dto.predecessors.length) await tx.insert(taskDependencies).values(dto.predecessors.map((item) => ({
        predecessorTaskId: item.predecessorTaskId,
        successorTaskId: taskId,
        relationType: item.relationType,
        lagDays: String(item.lagDays),
      })))
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'wbs.dependencies.replaced', resourceType: 'wbs_task', resourceId: taskId,
        afterData: { predecessors: dto.predecessors }, requestId: identity.requestId,
      })
    })
    return { taskId, predecessors: dto.predecessors }
  }

  async recalculate(projectId: string, identity: AuthenticatedIdentity) {
    const data = await this.list(projectId, identity)
    try {
      return { projectId, ...calculateWbsSchedule(data.tasks, data.dependencies) }
    } catch (error) {
      if (error instanceof Error && error.message === 'WBS_DEPENDENCY_CYCLE') {
        throw new ConflictException('WBS dependencies contain a cycle')
      }
      throw error
    }
  }

  async listVersions(projectId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'wbs.view')
    const rows = await this.db.select().from(wbsVersions)
      .where(eq(wbsVersions.projectId, projectId)).orderBy(desc(wbsVersions.versionNumber))
    return rows.map(({ snapshot: _snapshot, ...row }) => row)
  }

  async createVersion(
    projectId: string, dto: CreateWbsVersionDto, idempotencyKey: string,
    identity: AuthenticatedIdentity,
  ): Promise<typeof wbsVersions.$inferSelect> {
    await this.assertProject(projectId, identity, 'wbs.edit')
    const operation = `create-wbs-version:${projectId}`
    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex')
    const [existing] = await this.db.select().from(idempotencyKeys).where(and(
      eq(idempotencyKeys.organizationId, identity.organizationId),
      eq(idempotencyKeys.operation, operation), eq(idempotencyKeys.key, idempotencyKey),
    )).limit(1)
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictException('Idempotency key was already used')
      if (existing.responseBody) return existing.responseBody as typeof wbsVersions.$inferSelect
    }

    let snapshot: unknown
    if (dto.basedOnVersionId) {
      const [base] = await this.db.select({ snapshot: wbsVersions.snapshot }).from(wbsVersions).where(and(
        eq(wbsVersions.id, dto.basedOnVersionId), eq(wbsVersions.projectId, projectId),
      )).limit(1)
      if (!base) throw new ConflictException('Source WBS version belongs to another project or does not exist')
      snapshot = base.snapshot
    } else {
      const live = await this.list(projectId, identity)
      const stableKeyById = new Map(live.tasks.map((task) => [task.id, task.stableKey]))
      snapshot = {
        schemaVersion: 1,
        tasks: live.tasks.map((task) => ({
          stableKey: task.stableKey, code: task.code, sequence: task.sequence, name: task.name,
          phase: task.phase, durationDays: task.durationDays, weightPct: task.weightPct,
          modelPartKey: task.modelPartKey,
        })),
        dependencies: live.dependencies.map((edge) => ({
          predecessorStableKey: stableKeyById.get(edge.predecessorTaskId),
          successorStableKey: stableKeyById.get(edge.successorTaskId),
          relationType: edge.relationType, lagDays: edge.lagDays,
        })),
      }
    }
    snapshot = this.validSnapshot(snapshot)
    const contentHash = this.snapshotHash(snapshot)
    const [numberRow] = await this.db.select({ value: max(wbsVersions.versionNumber) }).from(wbsVersions)
      .where(eq(wbsVersions.projectId, projectId))
    const versionNumber = Number(numberRow?.value ?? 0) + 1
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(wbsVersions).values({
          projectId, versionNumber, label: dto.label || `V${versionNumber}`, source: dto.source,
          basedOnVersionId: dto.basedOnVersionId, sourceFileId: dto.sourceFileId,
          snapshot: snapshot as Record<string, unknown>, contentHash,
          changeNote: dto.changeNote ?? '', createdBy: identity.userId,
        }).returning()
        if (!row) throw new Error('WBS version insert returned no row')
        await tx.insert(wbsVersionEvents).values({
          wbsVersionId: row.id, projectId, eventType: 'created', actorUserId: identity.userId,
          note: dto.changeNote ?? '', metadata: { source: dto.source },
        })
        await tx.insert(auditLogs).values({
          organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
          action: 'wbs.version.created', resourceType: 'wbs_version', resourceId: row.id,
          afterData: { versionNumber, label: row.label, source: row.source }, requestId: identity.requestId,
        })
        await tx.insert(idempotencyKeys).values({
          organizationId: identity.organizationId, key: idempotencyKey, operation, requestHash,
          responseStatus: 201, responseBody: row, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        return row
      })
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('Another WBS version was created; retry')
      throw error
    }
  }

  async getVersion(projectId: string, versionId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'wbs.view')
    const [row] = await this.db.select().from(wbsVersions).where(and(
      eq(wbsVersions.id, versionId), eq(wbsVersions.projectId, projectId),
    )).limit(1)
    if (!row) throw new NotFoundException('WBS version not found')
    return row
  }

  async updateVersion(
    projectId: string, versionId: string, dto: UpdateWbsVersionDto,
    ifMatch: string | undefined, identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'wbs.edit')
    const expectedVersion = this.parseVersion(ifMatch)
    const before = await this.getVersion(projectId, versionId, identity)
    if (!['draft', 'rejected'].includes(before.status)) {
      throw new ConflictException('Only draft or rejected WBS versions can be edited')
    }
    const snapshot = dto.snapshot === undefined ? undefined : this.validSnapshot(dto.snapshot)
    const values = {
      label: dto.label,
      changeNote: dto.changeNote,
      snapshot: snapshot as Record<string, unknown> | undefined,
      contentHash: snapshot === undefined ? undefined : this.snapshotHash(snapshot),
      status: before.status === 'rejected' ? 'draft' : undefined,
      submittedAt: before.status === 'rejected' ? null : undefined,
      approvedBy: before.status === 'rejected' ? null : undefined,
      approvedAt: before.status === 'rejected' ? null : undefined,
    }
    const set = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
    if (!Object.keys(set).length) return before
    const [row] = await this.db.update(wbsVersions).set({
      ...set, version: sql`${wbsVersions.version} + 1`, updatedAt: new Date(),
    }).where(and(
      eq(wbsVersions.id, versionId), eq(wbsVersions.projectId, projectId),
      eq(wbsVersions.version, expectedVersion),
    )).returning()
    if (!row) throw new ConflictException('WBS version was changed by another user')
    await this.recordVersionEvent(identity, projectId, row.id, 'updated', dto.changeNote ?? '')
    return row
  }

  async deleteVersion(
    projectId: string, versionId: string, ifMatch: string | undefined, identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'wbs.edit')
    const expectedVersion = this.parseVersion(ifMatch)
    const [row] = await this.db.select().from(wbsVersions).where(and(
      eq(wbsVersions.id, versionId), eq(wbsVersions.projectId, projectId),
    )).limit(1)
    if (!row) throw new NotFoundException('WBS version not found')
    if (!['draft', 'rejected'].includes(row.status)) {
      throw new ConflictException('Only draft or rejected WBS versions can be deleted')
    }
    const deleted = await this.db.transaction(async (tx) => {
      const [removed] = await tx.delete(wbsVersions).where(and(
        eq(wbsVersions.id, versionId), eq(wbsVersions.projectId, projectId),
        eq(wbsVersions.version, expectedVersion),
      )).returning({ id: wbsVersions.id })
      if (!removed) throw new ConflictException('WBS version was changed by another user')
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'wbs.version.deleted', resourceType: 'wbs_version', resourceId: versionId,
        beforeData: { versionNumber: row.versionNumber, label: row.label, status: row.status },
        requestId: identity.requestId,
      })
      return removed
    })
    return deleted
  }

  async submitVersion(
    projectId: string, versionId: string, ifMatch: string | undefined, identity: AuthenticatedIdentity,
  ) {
    return this.transitionVersion(projectId, versionId, ifMatch, identity, {
      permission: 'wbs.submit', allowed: ['draft', 'rejected'], eventType: 'submitted',
      values: { status: 'in_review', submittedAt: new Date(), approvedBy: null, approvedAt: null },
    })
  }

  async approveVersion(
    projectId: string, versionId: string, ifMatch: string | undefined, identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'wbs.approve')
    const row = await this.getVersion(projectId, versionId, identity)
    if (row.status !== 'in_review') throw new ConflictException('Only an in-review WBS version can be approved')
    if (row.createdBy && identity.userId && row.createdBy === identity.userId) {
      throw new ConflictException('The version creator cannot approve their own WBS version')
    }
    return this.transitionVersion(projectId, versionId, ifMatch, identity, {
      permission: 'wbs.approve', allowed: ['in_review'], eventType: 'approved',
      values: { approvedBy: identity.userId, approvedAt: new Date() },
    })
  }

  async rejectVersion(
    projectId: string, versionId: string, dto: RejectWbsVersionDto,
    ifMatch: string | undefined, identity: AuthenticatedIdentity,
  ) {
    return this.transitionVersion(projectId, versionId, ifMatch, identity, {
      permission: 'wbs.approve', allowed: ['in_review'], eventType: 'rejected', note: dto.note,
      values: { status: 'rejected', approvedBy: null, approvedAt: null, changeNote: dto.note },
    })
  }

  async publishVersion(
    projectId: string, versionId: string, ifMatch: string | undefined, identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'wbs.publish')
    const expectedVersion = this.parseVersion(ifMatch)
    const versionRow = await this.getVersion(projectId, versionId, identity)
    if (versionRow.status !== 'in_review' || !versionRow.approvedAt) {
      throw new ConflictException('The WBS version must be approved before publication')
    }
    const snapshot = this.validSnapshot(versionRow.snapshot)
    return this.db.transaction(async (tx) => {
      const [locked] = await tx.select({ version: wbsVersions.version }).from(wbsVersions).where(and(
        eq(wbsVersions.id, versionId), eq(wbsVersions.projectId, projectId),
        eq(wbsVersions.version, expectedVersion), eq(wbsVersions.status, 'in_review'),
      )).limit(1)
      if (!locked) throw new ConflictException('WBS version was changed by another user')

      const existingTasks = await tx.select().from(wbsTasks).where(eq(wbsTasks.projectId, projectId))
      const allTaskIds = existingTasks.map((task) => task.id)
      if (allTaskIds.length) {
        await tx.delete(taskDependencies).where(or(
          inArray(taskDependencies.predecessorTaskId, allTaskIds),
          inArray(taskDependencies.successorTaskId, allTaskIds),
        ))
        const stagingSequence = Math.max(
          0,
          ...existingTasks.map((task) => task.sequence),
          ...snapshot.tasks.map((task) => task.sequence),
        ) + 1
        if (stagingSequence + existingTasks.length > 2_147_483_647) {
          throw new ConflictException('WBS sequence values are too large to publish safely')
        }
        for (const [index, task] of existingTasks.entries()) {
          await tx.update(wbsTasks).set({
            code: `__publishing__${task.id}`, sequence: stagingSequence + index, archivedAt: new Date(),
          }).where(eq(wbsTasks.id, task.id))
        }
      }

      const existingByStableKey = new Map(existingTasks.map((task) => [task.stableKey, task]))
      const idByStableKey = new Map<string, string>()
      for (const task of snapshot.tasks) {
        const existing = existingByStableKey.get(task.stableKey)
        const values = {
          code: task.code, sequence: task.sequence, name: task.name, phase: task.phase,
          durationDays: String(task.durationDays),
          weightPct: task.weightPct == null ? null : String(task.weightPct),
          modelPartKey: task.modelPartKey ?? null, archivedAt: null, updatedAt: new Date(),
        }
        if (existing) {
          const [updated] = await tx.update(wbsTasks).set({
            ...values, version: sql`${wbsTasks.version} + 1`,
          }).where(eq(wbsTasks.id, existing.id)).returning({ id: wbsTasks.id })
          if (!updated) throw new Error('WBS task update returned no row')
          idByStableKey.set(task.stableKey, updated.id)
        } else {
          const [inserted] = await tx.insert(wbsTasks).values({
            projectId, stableKey: task.stableKey, ...values,
          }).returning({ id: wbsTasks.id })
          if (!inserted) throw new Error('WBS task insert returned no row')
          idByStableKey.set(task.stableKey, inserted.id)
        }
      }
      if (snapshot.dependencies.length) {
        await tx.insert(taskDependencies).values(snapshot.dependencies.map((edge) => ({
          predecessorTaskId: idByStableKey.get(edge.predecessorStableKey)!,
          successorTaskId: idByStableKey.get(edge.successorStableKey)!,
          relationType: edge.relationType, lagDays: String(edge.lagDays),
        })))
      }

      const [projectContent] = await tx.select({ activeModelVersionId: projects.activeModelVersionId })
        .from(projects).where(eq(projects.id, projectId)).limit(1)
      if (projectContent?.activeModelVersionId) {
        const activeParts = await tx.select({ id: modelParts.id, metadata: modelParts.metadata })
          .from(modelParts).where(eq(modelParts.modelVersionId, projectContent.activeModelVersionId))
        for (const part of activeParts) {
          const metadata = part.metadata as Record<string, unknown>
          const stableKey = typeof metadata.defaultWbsStableKey === 'string'
            ? metadata.defaultWbsStableKey : undefined
          await tx.update(modelParts).set({ taskId: stableKey ? (idByStableKey.get(stableKey) ?? null) : null })
            .where(eq(modelParts.id, part.id))
        }
      }

      const superseded = await tx.update(wbsVersions).set({
        status: 'superseded', version: sql`${wbsVersions.version} + 1`, updatedAt: new Date(),
      }).where(and(eq(wbsVersions.projectId, projectId), eq(wbsVersions.status, 'published')))
        .returning({ id: wbsVersions.id })
      if (superseded.length) await tx.insert(wbsVersionEvents).values(superseded.map((row) => ({
        wbsVersionId: row.id, projectId, eventType: 'superseded', actorUserId: identity.userId,
        metadata: { replacementVersionId: versionId },
      })))
      const [published] = await tx.update(wbsVersions).set({
        status: 'published', publishedAt: new Date(), version: sql`${wbsVersions.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(wbsVersions.id, versionId), eq(wbsVersions.projectId, projectId),
        eq(wbsVersions.version, expectedVersion),
      )).returning()
      if (!published) throw new ConflictException('WBS version was changed by another user')
      await tx.update(projects).set({ activeWbsVersionId: versionId, updatedAt: new Date() })
        .where(eq(projects.id, projectId))
      await tx.insert(wbsVersionEvents).values({
        wbsVersionId: versionId, projectId, eventType: 'published', actorUserId: identity.userId,
        metadata: { taskCount: snapshot.tasks.length, dependencyCount: snapshot.dependencies.length },
      })
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'wbs.version.published', resourceType: 'wbs_version', resourceId: versionId,
        afterData: { versionNumber: published.versionNumber, taskCount: snapshot.tasks.length },
        requestId: identity.requestId,
      })
      return published
    })
  }

  async compareVersions(
    projectId: string, fromVersionId: string, toVersionId: string, identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'wbs.view')
    const rows = await this.db.select().from(wbsVersions).where(and(
      eq(wbsVersions.projectId, projectId), inArray(wbsVersions.id, [fromVersionId, toVersionId]),
    ))
    const from = rows.find((row) => row.id === fromVersionId)
    const to = rows.find((row) => row.id === toVersionId)
    if (!from || !to) throw new NotFoundException('One or both WBS versions were not found')
    return {
      from: { id: from.id, versionNumber: from.versionNumber, label: from.label },
      to: { id: to.id, versionNumber: to.versionNumber, label: to.label },
      ...diffWbsSnapshots(from.snapshot, to.snapshot),
    }
  }

  private async transitionVersion(
    projectId: string, versionId: string, ifMatch: string | undefined, identity: AuthenticatedIdentity,
    transition: {
      permission: string
      allowed: string[]
      eventType: string
      note?: string
      values: Partial<typeof wbsVersions.$inferInsert>
    },
  ) {
    await this.assertProject(projectId, identity, transition.permission)
    const expectedVersion = this.parseVersion(ifMatch)
    const before = await this.getVersion(projectId, versionId, identity)
    if (!transition.allowed.includes(before.status)) throw new ConflictException('Invalid WBS version status transition')
    this.validSnapshot(before.snapshot)
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(wbsVersions).set({
        ...transition.values, version: sql`${wbsVersions.version} + 1`, updatedAt: new Date(),
      }).where(and(
        eq(wbsVersions.id, versionId), eq(wbsVersions.projectId, projectId),
        eq(wbsVersions.version, expectedVersion),
      )).returning()
      if (!row) throw new ConflictException('WBS version was changed by another user')
      await tx.insert(wbsVersionEvents).values({
        wbsVersionId: versionId, projectId, eventType: transition.eventType,
        actorUserId: identity.userId, note: transition.note ?? '', metadata: {},
      })
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: `wbs.version.${transition.eventType}`, resourceType: 'wbs_version', resourceId: versionId,
        beforeData: { status: before.status }, afterData: { status: row.status }, requestId: identity.requestId,
      })
      return row
    })
  }

  private async recordVersionEvent(
    identity: AuthenticatedIdentity, projectId: string, versionId: string, eventType: string, note: string,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.insert(wbsVersionEvents).values({
        wbsVersionId: versionId, projectId, eventType, actorUserId: identity.userId, note, metadata: {},
      })
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: `wbs.version.${eventType}`, resourceType: 'wbs_version', resourceId: versionId,
        afterData: { note }, requestId: identity.requestId,
      })
    })
  }

  private validSnapshot(value: unknown): WbsSnapshot {
    try {
      return normalizeAndValidateSnapshot(value)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid WBS snapshot')
    }
  }

  private snapshotHash(snapshot: unknown) {
    return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  }

  private async assertProject(
    projectId: string, identity: AuthenticatedIdentity, permission: string,
  ) {
    await this.authz.assert(identity, permission, projectId)
    const [project] = await this.db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.id, projectId), eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt),
    )).limit(1)
    if (!project) throw new NotFoundException('Project not found')
  }

  private presentTask(row: typeof wbsTasks.$inferSelect): PresentedTask {
    return {
      id: row.id, projectId: row.projectId, stableKey: row.stableKey, code: row.code,
      sequence: row.sequence, name: row.name, phase: row.phase,
      durationDays: Number(row.durationDays), weightPct: row.weightPct === null ? null : Number(row.weightPct),
      progressPct: Number(row.progressPct), pinnedStartDay: row.pinnedStartDay === null ? null : Number(row.pinnedStartDay),
      lagDays: Number(row.lagDays), modelPartKey: row.modelPartKey, version: row.version,
    }
  }

  private parseVersion(ifMatch?: string) {
    if (!ifMatch) throw new HttpException('If-Match header is required', 428)
    const match = ifMatch.match(/^W\/"(\d+)"$/)
    if (!match?.[1]) throw new HttpException('If-Match must look like W/"7"', 428)
    return Number(match[1])
  }

  private assertAcyclic(nodes: string[], edges: ReadonlyArray<readonly [string, string]>) {
    try {
      topologicalOrder(nodes, edges)
    } catch {
      throw new ConflictException('WBS dependencies contain a cycle')
    }
  }

  private async audit(
    identity: AuthenticatedIdentity, projectId: string, action: string, resourceId: string,
    beforeData?: unknown, afterData?: unknown,
  ) {
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action, resourceType: 'wbs_task', resourceId,
      beforeData: beforeData as Record<string, unknown> | undefined,
      afterData: afterData as Record<string, unknown> | undefined,
      requestId: identity.requestId,
    })
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
  }
}
