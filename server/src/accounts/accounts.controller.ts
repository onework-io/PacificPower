import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { identityFromRequest } from '../auth/auth.utils.js'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import { ApproveRegistrationDto, CreateAccountDto, SetAccountPermissionsDto, UpdateAccountDto } from './account.dto.js'
import { AccountsService, type AccountRequestIdentity } from './accounts.service.js'

@Controller('accounts')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  private identity(request: FastifyRequest & RequestWithIdentity): AccountRequestIdentity {
    return identityFromRequest(request)
  }

  @Get('catalog')
  catalog(@Req() request: FastifyRequest & RequestWithIdentity) { return this.accounts.catalog(this.identity(request)) }

  @Get()
  list(@Req() request: FastifyRequest & RequestWithIdentity) { return this.accounts.list(this.identity(request)) }

  @Get('registration-requests')
  registrations(@Req() request: FastifyRequest & RequestWithIdentity) {
    return this.accounts.listRegistrationRequests(this.identity(request))
  }

  @Post('registration-requests/:requestId/approve')
  approveRegistration(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() dto: ApproveRegistrationDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.accounts.approveRegistration(requestId, dto, this.identity(request)) }

  @Post()
  create(@Body() dto: CreateAccountDto, @Req() request: FastifyRequest & RequestWithIdentity) {
    return this.accounts.create(dto, this.identity(request))
  }

  @Patch(':userId')
  update(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: UpdateAccountDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.accounts.update(userId, dto, this.identity(request)) }

  @Put(':userId/permissions')
  setPermissions(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: SetAccountPermissionsDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.accounts.setPermissions(userId, dto, this.identity(request)) }
}
