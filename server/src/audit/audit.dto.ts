import { Transform } from 'class-transformer'
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator'

const trimmed = () => Transform(({ value }) => typeof value === 'string' ? value.trim() : value)

export class AuditLogQueryDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  action?: string

  @IsOptional() @IsUUID()
  projectId?: string

  @IsOptional() @IsUUID()
  actorUserId?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string

  @IsOptional() @trimmed() @IsString() @MaxLength(120)
  q?: string

  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  before?: number

  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100)
  limit = 30
}
