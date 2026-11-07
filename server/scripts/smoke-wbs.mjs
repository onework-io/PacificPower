import 'dotenv/config'
import postgres from 'postgres'

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1'
const suffix = Date.now().toString(36).toUpperCase()
const projectKey = `smoke-project-${suffix}`
const versionKey = `smoke-version-${suffix}`
const comparisonVersionKey = `smoke-comparison-version-${suffix}`
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false })
let projectId

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  })
  const body = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${JSON.stringify(body)}`)
  return body
}

try {
  const project = await request('/projects', {
    method: 'POST', headers: { 'Idempotency-Key': projectKey },
    body: JSON.stringify({ code: `TST-${suffix}`, name: 'WBS smoke test' }),
  })
  projectId = project.id
  const first = await request(`/projects/${projectId}/tasks`, {
    method: 'POST', body: JSON.stringify({
      stableKey: 'survey', code: '1.1', sequence: 1, name: '放樣', phase: '前置作業', durationDays: 2,
    }),
  })
  const second = await request(`/projects/${projectId}/tasks`, {
    method: 'POST', body: JSON.stringify({
      stableKey: 'foundation', code: '1.2', sequence: 2, name: '基座施工', phase: '土建', durationDays: 3,
    }),
  })
  await request(`/projects/${projectId}/tasks/${second.id}/dependencies`, {
    method: 'PUT', body: JSON.stringify({
      predecessors: [{ predecessorTaskId: first.id, relationType: 'FS', lagDays: 1 }],
    }),
  })
  const schedule = await request(`/projects/${projectId}/schedule/recalculate`, { method: 'POST' })
  const version = await request(`/projects/${projectId}/wbs/versions`, {
    method: 'POST', headers: { 'Idempotency-Key': versionKey },
    body: JSON.stringify({ source: 'manual', label: 'Smoke V1' }),
  })
  const edited = await request(`/projects/${projectId}/wbs/versions/${version.id}`, {
    method: 'PATCH', headers: { 'If-Match': `W/"${version.version}"` },
    body: JSON.stringify({
      label: 'Smoke V1 reviewed',
      snapshot: {
        ...version.snapshot,
        tasks: version.snapshot.tasks.map((task) => task.stableKey === 'foundation'
          ? { ...task, durationDays: 4 }
          : task),
      },
    }),
  })
  const submitted = await request(`/projects/${projectId}/wbs/versions/${version.id}/submit`, {
    method: 'POST', headers: { 'If-Match': `W/"${edited.version}"` },
  })
  const approved = await request(`/projects/${projectId}/wbs/versions/${version.id}/approve`, {
    method: 'POST', headers: { 'If-Match': `W/"${submitted.version}"` },
  })
  const published = await request(`/projects/${projectId}/wbs/versions/${version.id}/publish`, {
    method: 'POST', headers: { 'If-Match': `W/"${approved.version}"` },
  })
  const comparison = await request(`/projects/${projectId}/wbs/versions`, {
    method: 'POST', headers: { 'Idempotency-Key': comparisonVersionKey },
    body: JSON.stringify({ source: 'copy', basedOnVersionId: published.id, label: 'Temporary comparison' }),
  })
  const diff = await request(
    `/projects/${projectId}/wbs/versions/compare?from=${published.id}&to=${comparison.id}`,
  )
  const comparisonSubmitted = await request(`/projects/${projectId}/wbs/versions/${comparison.id}/submit`, {
    method: 'POST', headers: { 'If-Match': `W/"${comparison.version}"` },
  })
  const comparisonRejected = await request(`/projects/${projectId}/wbs/versions/${comparison.id}/reject`, {
    method: 'POST', headers: { 'If-Match': `W/"${comparisonSubmitted.version}"` },
    body: JSON.stringify({ note: 'Smoke test rejection' }),
  })
  await request(`/projects/${projectId}/wbs/versions/${comparison.id}`, {
    method: 'DELETE', headers: { 'If-Match': `W/"${comparisonRejected.version}"` },
  })
  const live = await request(`/projects/${projectId}/tasks`)
  const publishedDuration = live.tasks.find((task) => task.stableKey === 'foundation')?.durationDays
  if (
    published.status !== 'published' || comparisonRejected.status !== 'rejected'
    || publishedDuration !== 4 || diff.changed.length !== 0
  ) {
    throw new Error('Published WBS did not match its version snapshot')
  }
  console.log(
    `smoke=success projectDays=${schedule.projectDays} tasks=${live.tasks.length} `
      + `version=${published.versionNumber} status=${published.status} comparisonChanges=${diff.changed.length}`,
  )
} finally {
  if (projectId) await sql`delete from public.projects where id = ${projectId}`
  await sql`delete from public.idempotency_keys where key in (${projectKey}, ${versionKey}, ${comparisonVersionKey})`
  await sql.end({ timeout: 2 })
}
