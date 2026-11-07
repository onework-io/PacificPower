import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

const statuses = ['planning', 'active', 'inspection', 'completed'] as const
const risks = ['normal', 'attention', 'high'] as const
const trimmed = () => Transform(({ value }) => typeof value === 'string' ? value.trim() : value)

export class CreateProjectDto {
  @trimmed() @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{2,39}$/)
  code!: string

  @trimmed() @IsString() @Length(1, 120)
  name!: string

  @IsOptional() @trimmed() @IsString() @MaxLength(2000)
  description?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  clientName?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(200)
  location?: string

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  generatorModel?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  crewName?: string

  @IsOptional() @IsNumber() @Min(0)
  contractAmount?: number

  @IsOptional() @IsIn(statuses)
  status?: typeof statuses[number]

  @IsOptional() @IsIn(risks)
  riskStatus?: typeof risks[number]

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string

  @IsOptional() @IsUUID()
  managerId?: string
}

export class UpdateProjectDto {
  @IsOptional() @trimmed() @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{2,39}$/)
  code?: string

  @IsOptional() @trimmed() @IsString() @Length(1, 120)
  name?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(2000)
  description?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  clientName?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(200)
  location?: string

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  generatorModel?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  crewName?: string

  @IsOptional() @IsNumber() @Min(0)
  contractAmount?: number

  @IsOptional() @IsIn(statuses)
  status?: typeof statuses[number]

  @IsOptional() @IsIn(risks)
  riskStatus?: typeof risks[number]

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string

  @IsOptional() @IsUUID()
  managerId?: string
}

export class ListProjectsQuery {
  @IsOptional() @IsIn([...statuses, 'archived'])
  status?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(100)
  q?: string

  @IsOptional() @Transform(({ value }) => value === true || value === 'true')
  includeArchived = false

  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100)
  limit = 30
}

export class ArchiveProjectDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(500)
  reason?: string
}

export class ProjectMemberDto {
  @IsUUID()
  userId!: string

  @IsIn(['planner', 'manager', 'worker', 'viewer'])
  role!: 'planner' | 'manager' | 'worker' | 'viewer'
}

export class ReplaceProjectMembersDto {
  @IsArray() @ArrayMaxSize(500)
  members!: ProjectMemberDto[]
}

export class RecordReportExportDto {
  @IsIn(['csv', 'pdf'])
  format!: 'csv' | 'pdf'

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dataDate?: string
}

export class AcknowledgeReportDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(500)
  note?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dataDate?: string
}

export class CrewDispatchQuery {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string
}

export class CreateCrewDispatchDto {
  @trimmed() @IsString() @Length(1, 120)
  crewName!: string

  @IsUUID()
  projectId!: string

  @IsOptional() @IsUUID()
  taskId?: string

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate!: string

  @IsOptional() @IsNumber() @Min(0.5) @Max(500)
  plannedPeople = 1

  @IsOptional() @IsNumber() @Min(0.5) @Max(24)
  dailyHours = 8

  @IsOptional() @trimmed() @IsString() @MaxLength(500)
  note?: string

  @IsOptional() @IsArray() @ArrayMaxSize(20)
  requiredQualifications?: Array<{ name: string; count: number }>
}

export class UpdateCrewDispatchDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string

  @IsOptional() @IsNumber() @Min(0.5) @Max(500)
  plannedPeople?: number

  @IsOptional() @IsNumber() @Min(0.5) @Max(24)
  dailyHours?: number

  @IsOptional() @IsIn(['planned', 'confirmed', 'completed', 'cancelled'])
  status?: 'planned' | 'confirmed' | 'completed' | 'cancelled'

  @IsOptional() @trimmed() @IsString() @MaxLength(500)
  note?: string

  @IsOptional() @IsArray() @ArrayMaxSize(20)
  requiredQualifications?: Array<{ name: string; count: number }>
}

export class CreateCrewDto {
  @trimmed() @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,29}$/)
  code!: string

  @trimmed() @IsString() @Length(1, 120)
  name!: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  trade?: string

  @IsOptional() @IsUUID()
  leaderUserId?: string

  @IsOptional() @IsNumber() @Min(0.5) @Max(10000)
  dailyCapacityHours = 8

  @IsOptional() @trimmed() @IsString() @MaxLength(1000)
  notes?: string
}

export class UpdateCrewDto {
  @IsOptional() @trimmed() @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,29}$/)
  code?: string

  @IsOptional() @trimmed() @IsString() @Length(1, 120)
  name?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  trade?: string

  @IsOptional() @IsUUID()
  leaderUserId?: string

  @IsOptional() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive'

  @IsOptional() @IsNumber() @Min(0.5) @Max(10000)
  dailyCapacityHours?: number

  @IsOptional() @trimmed() @IsString() @MaxLength(1000)
  notes?: string
}

export class ReplaceCrewMembersDto {
  @IsArray() @ArrayMaxSize(500)
  userIds!: string[]
}

export class MemberQualificationDto {
  @trimmed() @IsString() @Length(1, 120)
  name!: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  certificateNo?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  issuedOn?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiresOn?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(500)
  notes?: string
}

export class ReplaceMemberQualificationsDto {
  @IsArray() @ArrayMaxSize(100)
  qualifications!: MemberQualificationDto[]
}

export class MemberUnavailabilityDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate!: string

  @IsIn(['leave', 'training', 'medical', 'other'])
  type!: 'leave' | 'training' | 'medical' | 'other'

  @IsOptional() @trimmed() @IsString() @MaxLength(500)
  reason?: string
}

export class ReplaceMemberUnavailabilityDto {
  @IsArray() @ArrayMaxSize(100)
  periods!: MemberUnavailabilityDto[]
}

export class LaborEntryQuery {
  @IsOptional() @IsUUID()
  projectId?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string

  @IsOptional() @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected'
}

export class CreateLaborEntryDto {
  @IsUUID()
  projectId!: string

  @IsUUID()
  taskId!: string

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  workDate!: string

  @IsNumber() @Min(0.5) @Max(500)
  people!: number

  @IsNumber() @Min(0.25) @Max(24)
  hours!: number

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  crewName?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(1000)
  note?: string
}

export class RejectLaborEntryDto {
  @trimmed() @IsString() @Length(1, 500)
  reason!: string
}
