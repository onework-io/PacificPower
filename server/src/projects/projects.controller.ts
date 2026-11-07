import {
  BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe,
  Patch, Post, Put, Query, Req, Res,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { identityFromRequest } from '../auth/auth.utils.js'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import {
  AcknowledgeReportDto, ArchiveProjectDto, CreateCrewDispatchDto, CreateCrewDto, CreateLaborEntryDto, CreateProjectDto, CrewDispatchQuery, LaborEntryQuery, ListProjectsQuery,
  RecordReportExportDto, RejectLaborEntryDto, ReplaceCrewMembersDto, ReplaceMemberQualificationsDto, ReplaceMemberUnavailabilityDto, ReplaceProjectMembersDto, UpdateCrewDispatchDto, UpdateCrewDto, UpdateProjectDto,
} from './project.dto.js'
import { ProjectsService, type RequestIdentity } from './projects.service.js'

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  private identity(request: FastifyRequest & RequestWithIdentity): RequestIdentity {
    return identityFromRequest(request)
  }

  @Get()
  list(@Query() query: ListProjectsQuery, @Req() request: FastifyRequest & RequestWithIdentity) {
    return this.projects.list(query, this.identity(request))
  }

  @Post()
  async create(
    @Body() dto: CreateProjectDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 16) {
      throw new BadRequestException('Idempotency-Key must contain at least 16 characters')
    }
    const project = await this.projects.create(dto, idempotencyKey, this.identity(request))
    reply.status(201).header('etag', `W/"${project.version}"`)
    return project
  }

  @Get('crew-organization')
  crewOrganization(@Req() request: FastifyRequest & RequestWithIdentity) {
    return this.projects.crewOrganization(this.identity(request))
  }

  @Get('crews')
  crews(@Req() request: FastifyRequest & RequestWithIdentity) {
    return this.projects.listCrews(this.identity(request))
  }

  @Get('crews/member-catalog')
  crewMemberCatalog(@Req() request: FastifyRequest & RequestWithIdentity) {
    return this.projects.crewMemberCatalog(this.identity(request))
  }

  @Post('crews')
  createCrew(@Body() dto: CreateCrewDto, @Req() request: FastifyRequest & RequestWithIdentity) {
    return this.projects.createCrew(dto, this.identity(request))
  }

  @Patch('crews/:crewId')
  updateCrew(
    @Param('crewId', new ParseUUIDPipe()) crewId: string,
    @Body() dto: UpdateCrewDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.updateCrew(crewId, dto, this.identity(request)) }

  @Put('crews/:crewId/members')
  replaceCrewMembers(
    @Param('crewId', new ParseUUIDPipe()) crewId: string,
    @Body() dto: ReplaceCrewMembersDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.replaceCrewMembers(crewId, dto, this.identity(request)) }

  @Put('crews/members/:userId/qualifications')
  replaceMemberQualifications(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ReplaceMemberQualificationsDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.replaceMemberQualifications(userId, dto, this.identity(request)) }

  @Put('crews/members/:userId/unavailability')
  replaceMemberUnavailability(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ReplaceMemberUnavailabilityDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.replaceMemberUnavailability(userId, dto, this.identity(request)) }

  @Get('crew-dispatches')
  crewDispatches(
    @Query() query: CrewDispatchQuery,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.listCrewDispatches(query, this.identity(request)) }

  @Post('crew-dispatches')
  createCrewDispatch(
    @Body() dto: CreateCrewDispatchDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.createCrewDispatch(dto, this.identity(request)) }

  @Patch('crew-dispatches/:dispatchId')
  updateCrewDispatch(
    @Param('dispatchId', new ParseUUIDPipe()) dispatchId: string,
    @Body() dto: UpdateCrewDispatchDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.updateCrewDispatch(dispatchId, dto, this.identity(request)) }

  @Delete('crew-dispatches/:dispatchId')
  @HttpCode(204)
  async cancelCrewDispatch(
    @Param('dispatchId', new ParseUUIDPipe()) dispatchId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { await this.projects.cancelCrewDispatch(dispatchId, this.identity(request)) }

  @Get('labor-entries')
  laborEntries(@Query() query: LaborEntryQuery, @Req() request: FastifyRequest & RequestWithIdentity) {
    return this.projects.listLaborEntries(query, this.identity(request))
  }

  @Post('labor-entries')
  createLaborEntry(@Body() dto: CreateLaborEntryDto, @Req() request: FastifyRequest & RequestWithIdentity) {
    return this.projects.createLaborEntry(dto, this.identity(request))
  }

  @Post('labor-entries/:entryId/approve')
  approveLaborEntry(
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.reviewLaborEntry(entryId, 'approved', '', this.identity(request)) }

  @Post('labor-entries/:entryId/reject')
  rejectLaborEntry(
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() dto: RejectLaborEntryDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.reviewLaborEntry(entryId, 'rejected', dto.reason, this.identity(request)) }

  @Get(':projectId')
  async get(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const project = await this.projects.get(projectId, this.identity(request))
    reply.header('etag', `W/"${project.version}"`)
    return project
  }

  @Patch(':projectId')
  async update(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: UpdateProjectDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const project = await this.projects.update(projectId, dto, ifMatch, this.identity(request))
    reply.header('etag', `W/"${project.version}"`)
    return project
  }

  @Get(':projectId/members')
  members(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.listMembers(projectId, this.identity(request)) }

  @Put(':projectId/members')
  replaceMembers(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: ReplaceProjectMembersDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.replaceMembers(projectId, dto, this.identity(request)) }

  @Post(':projectId/report-exports')
  @HttpCode(201)
  recordReportExport(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: RecordReportExportDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.recordReportExport(projectId, dto, this.identity(request)) }

  @Get(':projectId/report-activity')
  reportActivity(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.reportActivity(projectId, this.identity(request)) }

  @Post(':projectId/report-acknowledgements')
  @HttpCode(201)
  acknowledgeReport(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: AcknowledgeReportDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.projects.acknowledgeReport(projectId, dto, this.identity(request)) }

  @Delete(':projectId')
  async archive(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: ArchiveProjectDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const project = await this.projects.archive(projectId, dto, ifMatch, this.identity(request))
    reply.header('etag', `W/"${project.version}"`)
    return project
  }

  @Post(':projectId/restore')
  @HttpCode(200)
  async restore(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const project = await this.projects.restore(projectId, ifMatch, this.identity(request))
    reply.header('etag', `W/"${project.version}"`)
    return project
  }
}
