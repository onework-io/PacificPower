import {
  bigint,
  boolean,
  date,
  doublePrecision,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  name: text('name').notNull(),
})

export const appUsers = pgTable('app_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalSubject: text('external_subject'),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  phone: text('phone'),
  department: text('department').notNull().default(''),
  crewName: text('crew_name').notNull().default(''),
  status: text('status').notNull().default('active'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const organizationMembers = pgTable('organization_members', {
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.organizationId, table.userId] })])

export const registrationRequests = pgTable('registration_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalSubject: text('external_subject').notNull(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  status: text('status').notNull().default('pending'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const roles = pgTable('roles', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull(),
})

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  bucket: text('bucket').notNull(),
  objectKey: text('object_key').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  sha256: text('sha256'),
  scanStatus: text('scan_status').notNull().default('pending'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('files_bucket_object_key_idx').on(table.bucket, table.objectKey)])

export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  module: text('module').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sensitive: boolean('sensitive').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const rolePermissions = pgTable('role_permissions', {
  roleCode: text('role_code').notNull(),
  permissionCode: text('permission_code').notNull(),
}, (table) => [primaryKey({ columns: [table.roleCode, table.permissionCode] })])

export const userPermissionOverrides = pgTable('user_permission_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').notNull(),
  permissionCode: text('permission_code').notNull(),
  effect: text('effect').notNull(),
  scopeType: text('scope_type').notNull().default('organization'),
  projectId: uuid('project_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  reason: text('reason').notNull().default(''),
  grantedBy: uuid('granted_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  clientName: text('client_name').notNull().default(''),
  location: text('location').notNull().default(''),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  generatorModel: text('generator_model').notNull().default(''),
  crewName: text('crew_name').notNull().default(''),
  contractAmount: numeric('contract_amount', { precision: 16, scale: 2 }),
  status: text('status').notNull().default('planning'),
  riskStatus: text('risk_status').notNull().default('normal'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  managerId: uuid('manager_id'),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
  deletionReason: text('deletion_reason'),
  statusBeforeArchive: text('status_before_archive'),
  activeModelVersionId: uuid('active_model_version_id'),
  activeWbsVersionId: uuid('active_wbs_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('projects_organization_code_idx').on(table.organizationId, table.code)])

export const projectMembers = pgTable('project_members', {
  projectId: uuid('project_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.projectId, table.userId] })])

export const crews = pgTable('crews', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  trade: text('trade').notNull().default(''),
  leaderUserId: uuid('leader_user_id'),
  status: text('status').notNull().default('active'),
  dailyCapacityHours: numeric('daily_capacity_hours', { precision: 10, scale: 2 }).notNull().default('8'),
  notes: text('notes').notNull().default(''),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('crews_organization_code_idx').on(table.organizationId, table.code),
  uniqueIndex('crews_organization_name_idx').on(table.organizationId, table.name),
])

export const memberQualifications = pgTable('member_qualifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  certificateNo: text('certificate_no').notNull().default(''),
  issuedOn: date('issued_on'),
  expiresOn: date('expires_on'),
  notes: text('notes').notNull().default(''),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const memberUnavailability = pgTable('member_unavailability', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  type: text('type').notNull().default('leave'),
  reason: text('reason').notNull().default(''),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const dailyReports = pgTable('daily_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  reportDate: date('report_date').notNull(),
  crewName: text('crew_name').notNull().default(''),
  weather: text('weather').notNull().default(''),
  workSummary: text('work_summary').notNull().default(''),
  issues: text('issues').notNull().default(''),
  safetyNotes: text('safety_notes').notNull().default(''),
  nextPlan: text('next_plan').notNull().default(''),
  status: text('status').notNull().default('pending'),
  reportedBy: uuid('reported_by'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projectImages = pgTable('project_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  fileId: uuid('file_id').notNull(),
  kind: text('kind').notNull().default('gallery'),
  caption: text('caption').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  dailyReportId: uuid('daily_report_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projectDocuments = pgTable('project_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  fileId: uuid('file_id').notNull(),
  category: text('category').notNull().default('other'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('active'),
  uploadedBy: uuid('uploaded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projectSettings = pgTable('project_settings', {
  projectId: uuid('project_id').primaryKey(),
  timezone: text('timezone').notNull().default('Asia/Taipei'),
})

export const wbsTasks = pgTable('wbs_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  stableKey: text('stable_key').notNull(),
  code: text('code').notNull(),
  sequence: integer('sequence').notNull(),
  name: text('name').notNull(),
  phase: text('phase').notNull(),
  durationDays: numeric('duration_days', { precision: 8, scale: 2 }).notNull().default('1'),
  weightPct: numeric('weight_pct', { precision: 7, scale: 4 }),
  progressPct: numeric('progress_pct', { precision: 7, scale: 4 }).notNull().default('0'),
  pinnedStartDay: numeric('pinned_start_day', { precision: 8, scale: 2 }),
  lagDays: numeric('lag_days', { precision: 8, scale: 2 }).notNull().default('0'),
  modelPartKey: text('model_part_key'),
  version: integer('version').notNull().default(1),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('wbs_tasks_project_stable_key_idx').on(table.projectId, table.stableKey),
  uniqueIndex('wbs_tasks_project_code_idx').on(table.projectId, table.code),
  uniqueIndex('wbs_tasks_project_sequence_idx').on(table.projectId, table.sequence),
])

export const taskDependencies = pgTable('task_dependencies', {
  predecessorTaskId: uuid('predecessor_task_id').notNull(),
  successorTaskId: uuid('successor_task_id').notNull(),
  relationType: text('relation_type').notNull().default('FS'),
  lagDays: numeric('lag_days', { precision: 8, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.predecessorTaskId, table.successorTaskId] })])

export const taskAssignments = pgTable('task_assignments', {
  taskId: uuid('task_id').notNull(),
  userId: uuid('user_id').notNull(),
  assignedBy: uuid('assigned_by'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.taskId, table.userId] })])

export const crewDispatches = pgTable('crew_dispatches', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  crewName: text('crew_name').notNull(),
  projectId: uuid('project_id').notNull(),
  taskId: uuid('task_id'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  plannedPeople: numeric('planned_people', { precision: 8, scale: 2 }).notNull().default('1'),
  dailyHours: numeric('daily_hours', { precision: 8, scale: 2 }).notNull().default('8'),
  status: text('status').notNull().default('planned'),
  note: text('note').notNull().default(''),
  requiredQualifications: jsonb('required_qualifications').$type<Array<{ name: string; count: number }>>().notNull().default([]),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const progressUpdates = pgTable('progress_updates', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  taskId: uuid('task_id').notNull(),
  dataDate: date('data_date').notNull(),
  progressPct: numeric('progress_pct', { precision: 7, scale: 4 }).notNull(),
  note: text('note').notNull().default(''),
  source: text('source').notNull().default('manual'),
  reportedBy: uuid('reported_by'),
  supersedesId: uuid('supersedes_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const laborEntries = pgTable('labor_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  taskId: uuid('task_id').notNull(),
  laborCategoryId: uuid('labor_category_id'),
  workDate: date('work_date').notNull(),
  people: numeric('people', { precision: 8, scale: 2 }).notNull().default('1'),
  hours: numeric('hours', { precision: 12, scale: 2 }).notNull(),
  crewName: text('crew_name').notNull().default(''),
  note: text('note').notNull().default(''),
  reportedBy: uuid('reported_by'),
  supersedesId: uuid('supersedes_id'),
  status: text('status').notNull().default('pending'),
  verifiedBy: uuid('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const dailyReportTasks = pgTable('daily_report_tasks', {
  dailyReportId: uuid('daily_report_id').notNull(),
  taskId: uuid('task_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.dailyReportId, table.taskId] })])

export const dailyReportLaborEntries = pgTable('daily_report_labor_entries', {
  dailyReportId: uuid('daily_report_id').notNull(),
  laborEntryId: uuid('labor_entry_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.dailyReportId, table.laborEntryId] })])

export const wbsVersions = pgTable('wbs_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  label: text('label').notNull(),
  status: text('status').notNull().default('draft'),
  source: text('source').notNull().default('manual'),
  basedOnVersionId: uuid('based_on_version_id'),
  sourceFileId: uuid('source_file_id'),
  snapshot: jsonb('snapshot').notNull().default({}),
  contentHash: text('content_hash'),
  changeSummary: jsonb('change_summary').notNull().default({}),
  changeNote: text('change_note').notNull().default(''),
  createdBy: uuid('created_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('wbs_versions_project_number_idx').on(table.projectId, table.versionNumber)])

export const wbsVersionEvents = pgTable('wbs_version_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  wbsVersionId: uuid('wbs_version_id').notNull(),
  projectId: uuid('project_id').notNull(),
  eventType: text('event_type').notNull(),
  actorUserId: uuid('actor_user_id'),
  note: text('note').notNull().default(''),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const modelSets = pgTable('model_sets', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull().default('主模型'),
})

export const modelTemplates = pgTable('model_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  generatorModel: text('generator_model').notNull().default(''),
  status: text('status').notNull().default('draft'),
  coverFileId: uuid('cover_file_id'),
  manifest: jsonb('manifest').notNull().default({}),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('model_templates_org_code_idx').on(table.organizationId, table.code)])

export const modelTemplateParts = pgTable('model_template_parts', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id').notNull(),
  partKey: text('part_key').notNull(),
  name: text('name').notNull(),
  groupName: text('group_name').notNull().default(''),
  kind: text('kind').notNull(),
  fileId: uuid('file_id'),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull().default(0),
  defaultWbsStableKey: text('default_wbs_stable_key'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('model_template_parts_template_key_idx').on(table.templateId, table.partKey)])

export const modelVersions = pgTable('model_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelSetId: uuid('model_set_id').notNull(),
  projectId: uuid('project_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  status: text('status').notNull().default('uploaded'),
  sourceFileId: uuid('source_file_id'),
  sourceTemplateId: uuid('source_template_id'),
  manifest: jsonb('manifest').notNull().default({}),
  errorMessage: text('error_message'),
  uploadedBy: uuid('uploaded_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('model_versions_set_number_idx').on(table.modelSetId, table.versionNumber)])

export const modelParts = pgTable('model_parts', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelVersionId: uuid('model_version_id').notNull(),
  projectId: uuid('project_id').notNull(),
  taskId: uuid('task_id'),
  partKey: text('part_key').notNull(),
  name: text('name').notNull(),
  groupName: text('group_name').notNull().default(''),
  kind: text('kind').notNull(),
  fileId: uuid('file_id'),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull().default(0),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('model_parts_version_key_idx').on(table.modelVersionId, table.partKey)])

export const pois = pgTable('pois', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  modelVersionId: uuid('model_version_id'),
  modelPartId: uuid('model_part_id'),
  positionX: doublePrecision('position_x').notNull(),
  positionY: doublePrecision('position_y').notNull(),
  positionZ: doublePrecision('position_z').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull().default(''),
  metadata: jsonb('metadata').notNull().default({}),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const progressSnapshots = pgTable('progress_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  dataDate: date('data_date').notNull(),
  plannedPct: numeric('planned_pct', { precision: 7, scale: 4 }).notNull().default('0'),
  earnedPct: numeric('earned_pct', { precision: 7, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('progress_snapshots_project_date_idx').on(table.projectId, table.dataDate)])

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  key: text('key').notNull(),
  operation: text('operation').notNull(),
  requestHash: text('request_hash').notNull(),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('idempotency_org_operation_key_idx').on(table.organizationId, table.operation, table.key)])

export const auditLogs = pgTable('audit_logs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  organizationId: uuid('organization_id'),
  projectId: uuid('project_id'),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  beforeData: jsonb('before_data'),
  afterData: jsonb('after_data'),
  requestId: text('request_id'),
  ipAddress: inet('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const notificationReadStates = pgTable('notification_read_states', {
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').notNull(),
  notificationKey: text('notification_key').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.organizationId, table.userId, table.notificationKey] })])

export const notificationPreferences = pgTable('notification_preferences', {
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').notNull(),
  enabledTypes: jsonb('enabled_types').$type<string[]>().notNull().default(['daily', 'labor', 'dispatch', 'qualification']),
  minimumSeverity: text('minimum_severity').notNull().default('warning'),
  realtimeEnabled: boolean('realtime_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.organizationId, table.userId] })])
