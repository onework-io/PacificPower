import 'dotenv/config'
import postgres from 'postgres'

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1'
const suffix = Date.now().toString(36).toUpperCase()
const projectKey = `model-project-${suffix}`
const templateKey = `model-template-${suffix}`
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
  const templates = await request('/model-templates')
  const standard = templates.find((template) => template.code === 'pacificpower-dc250-v1')
  if (!standard || standard.partCount !== 30) throw new Error('PacificPower model template is incomplete')
  const project = await request('/projects', {
    method: 'POST', headers: { 'Idempotency-Key': projectKey },
    body: JSON.stringify({ code: `MDL-${suffix}`, name: 'Model template smoke test' }),
  })
  projectId = project.id
  const applied = await request(`/projects/${projectId}/models/apply-template`, {
    method: 'POST', headers: { 'Idempotency-Key': templateKey },
    body: JSON.stringify({ templateCode: 'pacificpower-dc250-v1' }),
  })
  const active = await request(`/projects/${projectId}/models/active`)
  if (applied.partCount !== 30 || active.parts.length !== 30 || active.activeVersion?.status !== 'published') {
    throw new Error('Applied model version is incomplete')
  }
  console.log(`smoke=success template=${standard.code} parts=${active.parts.length}`)
} finally {
  if (projectId) await sql`delete from public.projects where id = ${projectId}`
  await sql`delete from public.idempotency_keys where key in (${projectKey}, ${templateKey})`
  await sql.end({ timeout: 2 })
}
