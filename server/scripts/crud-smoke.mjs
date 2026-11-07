import postgres from 'postgres'

const apiBase = process.env.CRUD_TEST_API ?? 'http://127.0.0.1:3001/api/v1'
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const sql = postgres(connectionString, { max: 1 })
const suffix = Date.now().toString(36).toUpperCase()
const state = { projectId: null, crewId: null, accountId: null, fileIds: [], notificationKeys: [] }
const checks = []

const [admin] = await sql`
  select u.id as user_id, om.organization_id
  from app_users u
  join organization_members om on om.user_id = u.id
  where lower(u.email) = lower('carlyu@onework.io') and om.role = 'admin'
  limit 1
`
if (!admin) throw new Error('Admin account carlyu@onework.io was not found')

const baseHeaders = {
  'Content-Type': 'application/json',
  'X-Organization-Id': admin.organization_id,
  'X-User-Id': admin.user_id,
}

async function request(name, path, options = {}, expected = [200]) {
  const headers = { ...baseHeaders, ...(options.headers ?? {}) }
  if (options.body == null) delete headers['Content-Type']
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  })
  const raw = await response.text()
  let body = null
  if (raw) {
    try { body = JSON.parse(raw) } catch { body = raw }
  }
  if (!expected.includes(response.status)) {
    throw new Error(`${name}: expected ${expected.join('/')} but received ${response.status}: ${raw.slice(0, 500)}`)
  }
  checks.push({ name, status: response.status })
  return { body, etag: response.headers.get('etag') }
}

async function cleanup() {
  try {
    if (state.projectId) {
      await sql`delete from daily_report_tasks where daily_report_id in (select id from daily_reports where project_id = ${state.projectId})`
      await sql`delete from daily_report_labor_entries where daily_report_id in (select id from daily_reports where project_id = ${state.projectId})`
      await sql`update projects set active_model_version_id = null where id = ${state.projectId}`
      await sql`delete from projects where id = ${state.projectId}`
      await sql`delete from idempotency_keys where operation like ${'%' + state.projectId + '%'}`
    }
    if (state.crewId) await sql`delete from crews where id = ${state.crewId}`
    if (state.accountId) await sql`delete from app_users where id = ${state.accountId}`
    if (state.fileIds.length) await sql`delete from files where id in ${sql(state.fileIds)}`
    if (state.notificationKeys.length) await sql`delete from notification_read_states where notification_key in ${sql(state.notificationKeys)}`
  } finally {
    await sql.end()
  }
}

await sql`delete from daily_report_tasks where daily_report_id in (select id from daily_reports where project_id in (select id from projects where description = '自動化 CRUD 驗收，完成後清除'))`
await sql`delete from daily_report_labor_entries where daily_report_id in (select id from daily_reports where project_id in (select id from projects where description = '自動化 CRUD 驗收，完成後清除'))`
await sql`update projects set active_model_version_id = null where description = '自動化 CRUD 驗收，完成後清除'`
await sql`delete from projects where description = '自動化 CRUD 驗收，完成後清除'`
await sql`delete from crews where notes = 'CRUD 驗收更新'`
await sql`delete from app_users where email like 'crud-%@example.invalid'`

try {
  await request('Auth profile read', '/auth/me')
  const systemStatus = (await request('System status read', '/system/status')).body
  if (systemStatus.status !== 'operational' || systemStatus.services?.database?.status !== 'operational') {
    throw new Error('System status did not report an operational API and database')
  }
  const serializedStatus = JSON.stringify(systemStatus).toLowerCase()
  if (serializedStatus.includes('secret_access_key') || serializedStatus.includes('database_url') || serializedStatus.includes('password')) {
    throw new Error('System status exposed a secret-bearing configuration field')
  }
  const notificationKey = `crud-notification-${suffix}`
  state.notificationKeys.push(notificationKey)
  await request('Notification mark read', '/notifications/read-state', {
    method: 'PUT', body: JSON.stringify({ keys: [notificationKey], read: true }),
  })
  const notificationState = (await request('Notification read state', '/notifications/read-state')).body
  if (!notificationState.readKeys.includes(notificationKey)) throw new Error('Notification read state was not persisted')
  await request('Notification mark unread', '/notifications/read-state', {
    method: 'PUT', body: JSON.stringify({ keys: [notificationKey], read: false }),
  })
  const originalPreferences = (await request('Notification preferences read', '/notifications/preferences')).body
  await request('Notification preferences update', '/notifications/preferences', {
    method: 'PUT', body: JSON.stringify({ enabledTypes: ['daily'], minimumSeverity: 'critical', realtimeEnabled: false }),
  })
  const updatedPreferences = (await request('Notification preferences verify', '/notifications/preferences')).body
  if (updatedPreferences.enabledTypes.length !== 1 || updatedPreferences.enabledTypes[0] !== 'daily'
    || updatedPreferences.minimumSeverity !== 'critical' || updatedPreferences.realtimeEnabled !== false) {
    throw new Error('Notification preferences were not persisted')
  }
  await request('Notification preferences restore', '/notifications/preferences', {
    method: 'PUT', body: JSON.stringify({
      enabledTypes: originalPreferences.enabledTypes,
      minimumSeverity: originalPreferences.minimumSeverity,
      realtimeEnabled: originalPreferences.realtimeEnabled,
    }),
  })
  await request('Account catalog read', '/accounts/catalog')
  await request('Account list read', '/accounts')

  const account = (await request('Account create', '/accounts', {
    method: 'POST',
    body: JSON.stringify({
      email: `crud-${suffix.toLowerCase()}@example.invalid`, displayName: `CRUD 驗收帳號 ${suffix}`,
      role: 'manager', department: 'QA', crewName: `驗收工班 ${suffix}`,
    }),
  }, [201])).body
  state.accountId = account.id
  const updatedAccount = (await request('Account update', `/accounts/${account.id}`, {
    method: 'PATCH', body: JSON.stringify({ displayName: `CRUD 驗收帳號（已更新）${suffix}`, phone: '0900000000', status: 'active' }),
  })).body
  if (!updatedAccount.displayName.includes('已更新')) throw new Error('Account update was not persisted')
  await request('Account permission replace', `/accounts/${account.id}/permissions`, {
    method: 'PUT', body: JSON.stringify({ overrides: [{ permissionCode: 'project.view', effect: 'allow', scopeType: 'organization', reason: 'CRUD smoke test' }] }),
  })

  const crew = (await request('Crew create', '/projects/crews', {
    method: 'POST', body: JSON.stringify({ code: `QA${suffix}`.slice(0, 28), name: `驗收工班 ${suffix}`, trade: '機電', dailyCapacityHours: 16 }),
  }, [201])).body
  state.crewId = crew.id
  const updatedCrew = (await request('Crew update', `/projects/crews/${crew.id}`, {
    method: 'PATCH', body: JSON.stringify({ trade: '發電機安裝', notes: 'CRUD 驗收更新' }),
  })).body
  if (updatedCrew.trade !== '發電機安裝') throw new Error('Crew update was not persisted')
  await request('Crew member replace', `/projects/crews/${crew.id}/members`, {
    method: 'PUT', body: JSON.stringify({ userIds: [account.id] }),
  })
  await request('Member qualification replace', `/projects/crews/members/${account.id}/qualifications`, {
    method: 'PUT', body: JSON.stringify({ qualifications: [{ name: 'CRUD 測試證照', certificateNo: suffix, issuedOn: '2026-01-01', expiresOn: '2027-01-01' }] }),
  })
  await request('Member unavailability replace', `/projects/crews/members/${account.id}/unavailability`, {
    method: 'PUT', body: JSON.stringify({ periods: [{ startDate: '2026-11-01', endDate: '2026-11-01', type: 'training', reason: 'CRUD smoke test' }] }),
  })

  const project = (await request('Project create', '/projects', {
    method: 'POST', headers: { 'Idempotency-Key': `crud-project-${suffix}` },
    body: JSON.stringify({
      code: `QA_${suffix}`.slice(0, 36), name: `CRUD 驗收專案 ${suffix}`, description: '自動化 CRUD 驗收，完成後清除',
      clientName: 'PacificPower QA', location: '台北市', latitude: 25.033, longitude: 121.5654,
      generatorModel: 'RZ2000', crewName: crew.name, contractAmount: 1000000,
      status: 'planning', riskStatus: 'normal', startDate: '2026-11-01', endDate: '2026-11-30', managerId: admin.user_id,
    }),
  }, [201])).body
  state.projectId = project.id
  await request('Project list read', `/projects?q=${encodeURIComponent(project.code)}`)
  await request('Project detail read', `/projects/${project.id}`)
  const projectUpdated = (await request('Project update', `/projects/${project.id}`, {
    method: 'PATCH', headers: { 'If-Match': `W/"${project.version}"` },
    body: JSON.stringify({ name: `${project.name}（已更新）`, status: 'active', riskStatus: 'attention' }),
  })).body
  if (projectUpdated.status !== 'active') throw new Error('Project update was not persisted')
  await request('Project member replace', `/projects/${project.id}/members`, {
    method: 'PUT', body: JSON.stringify({ members: [{ userId: account.id, role: 'viewer' }] }),
  })
  await request('Project member read', `/projects/${project.id}/members`)
  const [viewerPreset] = await sql`
    select count(*)::int as count
    from user_permission_overrides
    where user_id = ${account.id} and project_id = ${project.id}
      and reason = 'owner_readonly_preset'
  `
  if (!viewerPreset || viewerPreset.count < 10) throw new Error('Owner read-only permission preset was not created')
  await request('Project member role update', `/projects/${project.id}/members`, {
    method: 'PUT', body: JSON.stringify({ members: [{ userId: account.id, role: 'worker' }] }),
  })
  const [clearedViewerPreset] = await sql`
    select count(*)::int as count
    from user_permission_overrides
    where user_id = ${account.id} and project_id = ${project.id}
      and reason = 'owner_readonly_preset'
  `
  if (!clearedViewerPreset || clearedViewerPreset.count !== 0) throw new Error('Owner read-only permission preset was not cleared')

  const task1 = (await request('WBS task create A', `/projects/${project.id}/tasks`, {
    method: 'POST', body: JSON.stringify({ stableKey: `qa-${suffix}-a`, code: 'QA-01', sequence: 1, name: 'CRUD 基礎工項', phase: '測試階段', durationDays: 2, weightPct: 50 }),
  }, [201])).body
  const task2 = (await request('WBS task create B', `/projects/${project.id}/tasks`, {
    method: 'POST', body: JSON.stringify({ stableKey: `qa-${suffix}-b`, code: 'QA-02', sequence: 2, name: 'CRUD 安裝工項', phase: '測試階段', durationDays: 3, weightPct: 50 }),
  }, [201])).body
  const taskUpdated = (await request('WBS task update', `/projects/${project.id}/tasks/${task1.id}`, {
    method: 'PATCH', headers: { 'If-Match': `W/"${task1.version}"` }, body: JSON.stringify({ durationDays: 2.5, modelPartKey: 'qa-part' }),
  })).body
  if (Number(taskUpdated.durationDays) !== 2.5) throw new Error('WBS task update was not persisted')
  await request('WBS dependency replace', `/projects/${project.id}/tasks/${task2.id}/dependencies`, {
    method: 'PUT', body: JSON.stringify({ predecessors: [{ predecessorTaskId: task1.id, relationType: 'FS', lagDays: 1 }] }),
  })
  await request('WBS list read', `/projects/${project.id}/tasks`)
  await request('Schedule recalculate', `/projects/${project.id}/schedule/recalculate`, { method: 'POST' }, [200, 201])
  await request('Task assignment replace', `/projects/${project.id}/tasks/${task1.id}/assignments`, {
    method: 'PUT', body: JSON.stringify({ userIds: [account.id] }),
  })
  await request('Field work read', `/projects/${project.id}/field-work`)

  const progress = (await request('Progress report create', `/projects/${project.id}/tasks/${task1.id}/progress-reports`, {
    method: 'POST', body: JSON.stringify({ progressPct: 35, note: 'CRUD 驗收進度', dataDate: '2026-11-01' }),
  }, [201])).body
  await request('Progress report confirm', `/projects/${project.id}/progress-reports/${progress.id}/confirm`, { method: 'POST' })

  const labor = (await request('Labor entry create', '/projects/labor-entries', {
    method: 'POST', body: JSON.stringify({ projectId: project.id, taskId: task1.id, workDate: '2026-11-01', people: 2, hours: 8, crewName: crew.name, note: 'CRUD 驗收人工時' }),
  }, [201])).body
  await request('Labor entry approve', `/projects/labor-entries/${labor.id}/approve`, { method: 'POST' }, [200, 201])
  await request('Labor entry list read', `/projects/labor-entries?projectId=${project.id}&status=approved`)

  const daily = (await request('Daily report create', `/projects/${project.id}/daily-reports`, {
    method: 'POST', body: JSON.stringify({
      reportDate: '2026-11-01', crewName: crew.name, weather: '晴', workSummary: 'CRUD 驗收施工內容',
      issues: '無', safetyNotes: '完成工具箱會議', nextPlan: '進行下一工項', taskIds: [task1.id], laborEntryIds: [labor.id],
    }),
  }, [201])).body
  const dailyList = (await request('Daily report linked read', `/projects/${project.id}/daily-reports`)).body
  const linked = dailyList.reports.find((item) => item.id === daily.id)
  if (linked?.tasks?.[0]?.id !== task1.id || linked?.laborEntries?.[0]?.id !== labor.id) throw new Error('Daily report links were not persisted')
  await request('Daily report photo list read', `/projects/${project.id}/daily-reports/${daily.id}/photos`)
  await request('Daily report approve', `/projects/${project.id}/daily-reports/${daily.id}/approve`, { method: 'POST' }, [200, 201])

  const draftVersion = (await request('WBS version draft create', `/projects/${project.id}/wbs/versions`, {
    method: 'POST', headers: { 'Idempotency-Key': `crud-wbs-draft-${suffix}` }, body: JSON.stringify({ source: 'manual', label: 'CRUD 可刪除草稿' }),
  }, [201])).body
  const draftUpdated = (await request('WBS version update', `/projects/${project.id}/wbs/versions/${draftVersion.id}`, {
    method: 'PATCH', headers: { 'If-Match': `W/"${draftVersion.version}"` }, body: JSON.stringify({ label: 'CRUD 已更新草稿', changeNote: '驗收版本修改' }),
  })).body
  await request('WBS version detail read', `/projects/${project.id}/wbs/versions/${draftVersion.id}`)
  await request('WBS version delete', `/projects/${project.id}/wbs/versions/${draftVersion.id}`, {
    method: 'DELETE', headers: { 'If-Match': `W/"${draftUpdated.version}"` },
  }, [204])
  let lifecycle = (await request('WBS version lifecycle create', `/projects/${project.id}/wbs/versions`, {
    method: 'POST', headers: { 'Idempotency-Key': `crud-wbs-life-${suffix}` }, body: JSON.stringify({ source: 'manual', label: 'CRUD 發布版本' }),
  }, [201])).body
  lifecycle = (await request('WBS version submit', `/projects/${project.id}/wbs/versions/${lifecycle.id}/submit`, { method: 'POST', headers: { 'If-Match': `W/"${lifecycle.version}"` } })).body
  lifecycle = (await request('WBS version approve', `/projects/${project.id}/wbs/versions/${lifecycle.id}/approve`, { method: 'POST', headers: { 'If-Match': `W/"${lifecycle.version}"`, 'X-User-Id': account.id } })).body
  await request('WBS version publish', `/projects/${project.id}/wbs/versions/${lifecycle.id}/publish`, { method: 'POST', headers: { 'If-Match': `W/"${lifecycle.version}"` } })
  await request('WBS version list read', `/projects/${project.id}/wbs/versions`)

  const dispatch = (await request('Crew dispatch create', '/projects/crew-dispatches', {
    method: 'POST', body: JSON.stringify({ crewName: crew.name, projectId: project.id, taskId: task1.id, startDate: '2026-11-02', endDate: '2026-11-03', plannedPeople: 2, dailyHours: 8, note: 'CRUD 驗收派工' }),
  }, [201])).body
  await request('Crew dispatch update', `/projects/crew-dispatches/${dispatch.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'confirmed', note: 'CRUD 驗收派工已確認' }),
  })
  await request('Crew dispatch list read', '/projects/crew-dispatches?from=2026-11-01&to=2026-11-30')
  await request('Crew dispatch delete/cancel', `/projects/crew-dispatches/${dispatch.id}`, { method: 'DELETE' }, [204])
  await request('Crew organization read', '/projects/crew-organization')
  await request('Crew directory read', '/projects/crews')

  const templates = (await request('Model template list read', '/model-templates')).body
  if (templates.length) {
    await request('Model template apply', `/projects/${project.id}/models/apply-template`, {
      method: 'POST', headers: { 'Idempotency-Key': `crud-model-${suffix}` }, body: JSON.stringify({ templateCode: templates[0].code }),
    }, [201])
  }
  const activeModel = (await request('Active model read', `/projects/${project.id}/models/active`)).body
  if (activeModel.parts.length) {
    const mappedModel = (await request('Model part mapping replace', `/projects/${project.id}/models/active/part-mappings`, {
      method: 'PUT', body: JSON.stringify({ mappings: [{ partId: activeModel.parts[0].id, taskId: task1.id }] }),
    })).body
    if (mappedModel.parts.find((part) => part.id === activeModel.parts[0].id)?.taskId !== task1.id) {
      throw new Error('Model part mapping was not persisted')
    }
    const mappedWbs = (await request('Mapped WBS primary part read', `/projects/${project.id}/tasks`)).body
    if (!mappedWbs.tasks.find((task) => task.id === task1.id)?.modelPartKey) {
      throw new Error('WBS primary model part was not synchronized')
    }
    await request('Model part mapping clear', `/projects/${project.id}/models/active/part-mappings`, {
      method: 'PUT', body: JSON.stringify({ mappings: [{ partId: activeModel.parts[0].id, taskId: null }] }),
    })
    const poi = (await request('POI create', `/projects/${project.id}/pois`, {
      method: 'POST', body: JSON.stringify({
        partKey: activeModel.parts[0].partKey, position: [1.25, 2.5, -0.75],
        title: 'CRUD 現場標記', url: '', note: 'POI 驗收',
      }),
    }, [201])).body
    const updatedPoi = (await request('POI update', `/projects/${project.id}/pois/${poi.id}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'CRUD 現場標記（已更新）', startSec: 30, endSec: 60 }),
    })).body
    if (!updatedPoi.title.includes('已更新') || updatedPoi.startSec !== 30) throw new Error('POI update was not persisted')
    const poiList = (await request('POI list read', `/projects/${project.id}/pois`)).body
    if (!poiList.some((item) => item.id === poi.id)) throw new Error('POI list did not include the created record')
    await request('POI delete', `/projects/${project.id}/pois/${poi.id}`, { method: 'DELETE' }, [204])
  }
  await request('Project cover read', `/projects/${project.id}/images/cover`)
  const reportExport = (await request('Project report export audit', `/projects/${project.id}/report-exports`, {
    method: 'POST', body: JSON.stringify({ format: 'csv', dataDate: '2026-11-15' }),
  }, [201])).body
  if (!reportExport.id || reportExport.format !== 'csv') throw new Error('Project report export audit was not recorded')
  await request('Project report acknowledgement', `/projects/${project.id}/report-acknowledgements`, {
    method: 'POST', body: JSON.stringify({ note: 'CRUD 查驗完成', dataDate: '2026-11-15' }),
  }, [201])
  const reportActivity = (await request('Project report activity read', `/projects/${project.id}/report-activity`)).body
  if (!reportActivity.items?.some((item) => item.action === 'report.acknowledged')) {
    throw new Error('Project report activity did not include the acknowledgement')
  }

  const latestProject = (await request('Project latest version read', `/projects/${project.id}`)).body
  const archived = (await request('Project archive', `/projects/${project.id}`, {
    method: 'DELETE', headers: { 'If-Match': `W/"${latestProject.version}"` }, body: JSON.stringify({ reason: 'CRUD smoke test' }),
  })).body
  await request('Archived project list read', `/projects?includeArchived=true&q=${encodeURIComponent(project.code)}`)
  await request('Project restore', `/projects/${project.id}/restore`, {
    method: 'POST', headers: { 'If-Match': `W/"${archived.version}"` },
  })

  console.log(JSON.stringify({ ok: true, total: checks.length, checks }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, total: checks.length, checks, error: error instanceof Error ? error.message : String(error) }, null, 2))
  process.exitCode = 1
} finally {
  await cleanup()
}
