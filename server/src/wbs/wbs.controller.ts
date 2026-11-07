import {
  BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe,
  Patch, Post, Put, Query, Req, Res,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import { identityFromRequest } from '../auth/auth.utils.js'
import {
  CreateDailyReportDto, CreateProgressReportDto, CreateWbsTaskDto, CreateWbsVersionDto, RejectDailyReportDto, RejectWbsVersionDto,
  ReplaceDependenciesDto, ReplaceTaskAssignmentsDto, UpdateWbsTaskDto, UpdateWbsVersionDto,
} from './wbs.dto.js'
import { WbsService } from './wbs.service.js'

@Controller('projects/:projectId')
export class WbsController {
  constructor(@Inject(WbsService) private readonly wbs: WbsService) {}

  @Get('tasks')
  list(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.list(projectId, identityFromRequest(request)) }

  @Post('tasks')
  async create(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CreateWbsTaskDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const task = await this.wbs.create(projectId, dto, identityFromRequest(request))
    reply.status(201).header('etag', `W/"${task.version}"`)
    return task
  }

  @Patch('tasks/:taskId')
  async update(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: UpdateWbsTaskDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const task = await this.wbs.update(projectId, taskId, dto, ifMatch, identityFromRequest(request))
    reply.header('etag', `W/"${task.version}"`)
    return task
  }

  @Put('tasks/:taskId/dependencies')
  replaceDependencies(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: ReplaceDependenciesDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.replaceDependencies(projectId, taskId, dto, identityFromRequest(request)) }

  @Post('schedule/recalculate')
  recalculate(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.recalculate(projectId, identityFromRequest(request)) }

  @Get('field-work')
  fieldWork(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.fieldWork(projectId, identityFromRequest(request)) }

  @Put('tasks/:taskId/assignments')
  replaceTaskAssignments(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: ReplaceTaskAssignmentsDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.replaceTaskAssignments(projectId, taskId, dto, identityFromRequest(request)) }

  @Post('tasks/:taskId/progress-reports')
  createProgressReport(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: CreateProgressReportDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.createProgressReport(projectId, taskId, dto, identityFromRequest(request)) }

  @Post('progress-reports/:reportId/confirm')
  @HttpCode(200)
  confirmProgressReport(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.confirmProgressReport(projectId, reportId, identityFromRequest(request)) }

  @Get('daily-reports')
  dailyReports(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.listDailyReports(projectId, identityFromRequest(request)) }

  @Post('daily-reports')
  createDailyReport(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CreateDailyReportDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.createDailyReport(projectId, dto, identityFromRequest(request)) }

  @Post('daily-reports/:reportId/approve')
  approveDailyReport(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.reviewDailyReport(projectId, reportId, 'approved', '', identityFromRequest(request)) }

  @Post('daily-reports/:reportId/reject')
  rejectDailyReport(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @Body() dto: RejectDailyReportDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.reviewDailyReport(projectId, reportId, 'rejected', dto.reason, identityFromRequest(request)) }

  @Get('wbs/versions')
  listVersions(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.wbs.listVersions(projectId, identityFromRequest(request)) }

  @Post('wbs/versions')
  async createVersion(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CreateWbsVersionDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 16) {
      throw new BadRequestException('Idempotency-Key must contain at least 16 characters')
    }
    const version = await this.wbs.createVersion(projectId, dto, idempotencyKey, identityFromRequest(request))
    reply.status(201).header('etag', `W/"${version.version}"`)
    return version
  }

  @Get('wbs/versions/compare')
  compareVersions(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('from', new ParseUUIDPipe()) fromVersionId: string,
    @Query('to', new ParseUUIDPipe()) toVersionId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) {
    return this.wbs.compareVersions(projectId, fromVersionId, toVersionId, identityFromRequest(request))
  }

  @Get('wbs/versions/:versionId')
  async getVersion(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const version = await this.wbs.getVersion(projectId, versionId, identityFromRequest(request))
    reply.header('etag', `W/"${version.version}"`)
    return version
  }

  @Patch('wbs/versions/:versionId')
  async updateVersion(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Body() dto: UpdateWbsVersionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const version = await this.wbs.updateVersion(
      projectId, versionId, dto, ifMatch, identityFromRequest(request),
    )
    reply.header('etag', `W/"${version.version}"`)
    return version
  }

  @Delete('wbs/versions/:versionId')
  @HttpCode(204)
  async deleteVersion(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) {
    await this.wbs.deleteVersion(projectId, versionId, ifMatch, identityFromRequest(request))
  }

  @Post('wbs/versions/:versionId/submit')
  @HttpCode(200)
  async submitVersion(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const version = await this.wbs.submitVersion(projectId, versionId, ifMatch, identityFromRequest(request))
    reply.header('etag', `W/"${version.version}"`)
    return version
  }

  @Post('wbs/versions/:versionId/approve')
  @HttpCode(200)
  async approveVersion(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const version = await this.wbs.approveVersion(projectId, versionId, ifMatch, identityFromRequest(request))
    reply.header('etag', `W/"${version.version}"`)
    return version
  }

  @Post('wbs/versions/:versionId/publish')
  @HttpCode(200)
  async publishVersion(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const version = await this.wbs.publishVersion(projectId, versionId, ifMatch, identityFromRequest(request))
    reply.header('etag', `W/"${version.version}"`)
    return version
  }

  @Post('wbs/versions/:versionId/reject')
  @HttpCode(200)
  async rejectVersion(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Body() dto: RejectWbsVersionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const version = await this.wbs.rejectVersion(
      projectId, versionId, dto, ifMatch, identityFromRequest(request),
    )
    reply.header('etag', `W/"${version.version}"`)
    return version
  }
}
