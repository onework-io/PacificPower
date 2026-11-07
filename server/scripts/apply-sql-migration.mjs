import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import postgres from 'postgres'

const migrationPath = process.argv[2]
if (!migrationPath) throw new Error('Usage: node apply-sql-migration.mjs <migration.sql>')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const source = await readFile(resolve(migrationPath), 'utf8')
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false })
try {
  await sql.unsafe(source)
  process.stdout.write(`Applied ${migrationPath}\n`)
} finally {
  await sql.end()
}
