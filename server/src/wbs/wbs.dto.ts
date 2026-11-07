import { Type, Transform } from 'class-transformer'
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID,
  Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator'

const trimmed = () => Transform(({ value }) => typeof value === 'string' ? value.trim() : value)

export class CreateWbsTaskDto {
  @trimmed() @IsString() @Length(1, 120)
  stableKey!: string

  @trimmed() @IsString() @Length(1, 40)
  code!: string

  @IsInt() @Min(1)
  sequence!: number

  @trimmed() @IsString() @Length(1, 200)
  name!: string

  @trimmed() @IsString() @Length(1, 120)
  phase!: string

  @IsNumber() @Min(0.01) @Max(9999)
  durationDays!: number

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  weightPct?: number

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  progressPct?: number

  @IsOptional() @IsNumber() @Min(0)
  pinnedStartDay?: number | null

  @IsOptional() @IsNumber() @Min(0)
  lagDays?: number

  @IsOptional() @trimmed() @IsString() @MaxLength(160)
  modelPartKey?: string | null
}

export class UpdateWbsTaskDto {
  @IsOptional() @trimmed() @IsString() @Length(1, 40)
  code?: string

  @IsOptional() @IsInt() @Min(1)
  sequence?: number

  @IsOptional() @trimmed() @IsString() @Length(1, 200)
  name?: string

  @IsOptional() @trimmed() @IsString() @Length(1, 120)
  phase?: string

  @IsOptional() @IsNumber() @Min(0.01) @Max(9999)
  durationDays?: number

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  weightPct?: number | null

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  progressPct?: number

  @IsOptional() @IsNumber() @Min(0)
  pinnedStartDay?: number | null

  @IsOptional() @IsNumber() @Min(0)
  lagDays?: number

  @IsOptional() @trimmed() @IsString() @MaxLength(160)
  modelPartKey?: string | null
}

export class WbsPredecessorDto {
  @IsUUID()
  predecessorTaskId!: string

  @IsOptional() @IsIn(['FS'])
  relationType: 'FS' = 'FS'

  @IsOptional() @IsNumber() @Min(0) @Max(9999)
  lagDays = 0
}

export class ReplaceDependenciesDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => WbsPredecessorDto)
  predecessors!: WbsPredecessorDto[]
}

export class CreateWbsVersionDto {
  @IsIn(['manual', 'excel', 'copy', 'restore'])
  source!: 'manual' | 'excel' | 'copy' | 'restore'

  @IsOptional() @IsUUID()
  basedOnVersionId?: string

  @IsOptional() @IsUUID()
  sourceFileId?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  label?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(2000)
  changeNote?: string
}

export class WbsSnapshotTaskDto {
  @trimmed() @IsString() @Length(1, 120)
  stableKey!: string

  @trimmed() @IsString() @Length(1, 40)
  code!: string

  @IsInt() @Min(1)
  sequence!: number

  @trimmed() @IsString() @Length(1, 200)
  name!: string

  @trimmed() @IsString() @Length(1, 120)
  phase!: string

  @IsNumber() @Min(0.01) @Max(9999)
  durationDays!: number

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  weightPct?: number | null

  @IsOptional() @trimmed() @IsString() @MaxLength(160)
  modelPartKey?: string | null
}

export class WbsSnapshotDependencyDto {
  @trimmed() @IsString() @Length(1, 120)
  predecessorStableKey!: string

  @trimmed() @IsString() @Length(1, 120)
  successorStableKey!: string

  @IsIn(['FS'])
  relationType!: 'FS'

  @IsOptional() @IsNumber() @Min(0) @Max(9999)
  lagDays = 0
}

export class WbsSnapshotDto {
  @IsInt() @Min(1)
  schemaVersion!: number

  @IsOptional() @IsString()
  projectStart?: string | null

  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => WbsSnapshotTaskDto)
  tasks!: WbsSnapshotTaskDto[]

  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => WbsSnapshotDependencyDto)
  dependencies!: WbsSnapshotDependencyDto[]
}

export class UpdateWbsVersionDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  label?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(2000)
  changeNote?: string

  @IsOptional() @ValidateNested() @Type(() => WbsSnapshotDto)
  snapshot?: WbsSnapshotDto
}

export class RejectWbsVersionDto {
  @trimmed() @IsString() @Length(1, 2000)
  note!: string
}

export class ReplaceTaskAssignmentsDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  userIds!: string[]
}

export class CreateProgressReportDto {
  @IsNumber() @Min(0) @Max(100)
  progressPct!: number

  @IsOptional() @trimmed() @IsString() @MaxLength(2000)
  note?: string

  @IsOptional() @IsNumber() @Min(0) @Max(10000)
  actualHours?: number

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dataDate?: string
}

export class CreateDailyReportDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  reportDate!: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  crewName?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(80)
  weather?: string

  @trimmed() @IsString() @Length(1, 4000)
  workSummary!: string

  @IsOptional() @trimmed() @IsString() @MaxLength(4000)
  issues?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(4000)
  safetyNotes?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(4000)
  nextPlan?: string

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  taskIds?: string[]

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  laborEntryIds?: string[]
}

export class RejectDailyReportDto {
  @trimmed() @IsString() @Length(1, 500)
  reason!: string
}
