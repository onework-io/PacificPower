import 'dotenv/config'
import postgres from 'postgres'
import { PARTS } from '../../app/src/data/parts.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const sql = postgres(databaseUrl, { max: 1, prepare: false })

try {
  const organizations = await sql<{ id: string }[]>`select id from public.organizations order by created_at limit 1`
  const organization = organizations[0]
  if (!organization) throw new Error('No organization exists')

  await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into public.model_templates (
        organization_id, code, name, description, generator_model, status, manifest
      ) values (
        ${organization.id}, 'pacificpower-dc250-v1', 'PacificPower 250 MW 資料中心',
        '資料中心施工協調概念模板', '250MW-Facility', 'active',
        ${tx.json({
          schemaVersion: 1,
          assetMode: 'local-static',
          basePath: 'models',
          dracoDecoderPath: 'draco/',
          partCount: PARTS.length,
        })}
      )
      on conflict (organization_id, code) do update set
        name = excluded.name,
        description = excluded.description,
        generator_model = excluded.generator_model,
        status = 'active',
        manifest = excluded.manifest,
        version = public.model_templates.version + 1,
        updated_at = now()
      returning id
    `
    const template = rows[0]
    if (!template) throw new Error('Template upsert returned no row')
    await tx`delete from public.model_template_parts where template_id = ${template.id}`
    for (const part of PARTS) {
      await tx`
        insert into public.model_template_parts (
          template_id, part_key, name, group_name, kind, byte_size,
          default_wbs_stable_key, metadata
        ) values (
          ${template.id}, ${part.id}, ${part.name}, ${part.group}, ${part.kind}, ${part.bytes},
          ${part.installStepId ?? null},
          ${tx.json({ file: part.file, explodeDir: part.explodeDir ?? null })}
        )
      `
    }
  })
  console.log(`template=pacificpower-dc250-v1 parts=${PARTS.length}`)
} finally {
  await sql.end({ timeout: 2 })
}
