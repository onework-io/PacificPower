import { Transform, Type } from 'class-transformer'
import {
  IsArray, IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length,
  MaxLength, ValidateIf, ValidateNested,
} from 'class-validator'

const roles = ['admin', 'planner', 'manager', 'worker'] as const
const statuses = ['invited', 'active', 'suspended', 'locked', 'disabled'] as const
const trimmed = () => Transform(({ value }) => typeof value === 'string' ? value.trim() : value)

export class CreateAccountDto {
  @trimmed() @IsEmail() @MaxLength(254)
  email!: string

  @trimmed() @IsString() @Length(1, 120)
  displayName!: string

  @IsIn(roles)
  role!: typeof roles[number]

  @IsOptional() @trimmed() @IsString() @MaxLength(40)
  phone?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  department?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  crewName?: string
}

export class UpdateAccountDto {
  @IsOptional() @trimmed() @IsString() @Length(1, 120)
  displayName?: string

  @IsOptional() @IsIn(roles)
  role?: typeof roles[number]

  @IsOptional() @IsIn(statuses)
  status?: typeof statuses[number]

  @IsOptional() @trimmed() @IsString() @MaxLength(40)
  phone?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  department?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  crewName?: string
}

export class PermissionOverrideDto {
  @IsString() @MaxLength(100)
  permissionCode!: string

  @IsIn(['allow', 'deny'])
  effect!: 'allow' | 'deny'

  @IsOptional() @IsIn(['organization', 'project', 'assigned_task'])
  scopeType: 'organization' | 'project' | 'assigned_task' = 'organization'

  @ValidateIf((value: PermissionOverrideDto) => value.scopeType === 'project') @IsUUID()
  projectId?: string

  @IsOptional() @IsDateString()
  expiresAt?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(500)
  reason?: string
}

export class SetAccountPermissionsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PermissionOverrideDto)
  overrides!: PermissionOverrideDto[]
}

export class ApproveRegistrationDto {
  @IsIn(roles)
  role!: typeof roles[number]

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  department?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  crewName?: string
}
