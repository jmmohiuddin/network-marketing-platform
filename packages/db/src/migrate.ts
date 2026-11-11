import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))
const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/
const RESETTABLE_DATABASE = /^nmp_/
// Arbitrary constant: serialises concurrent migrators on one database.
const MIGRATION_LOCK_KEY = 4_117_001

export interface MigrateOptions {
  /** Drop and recreate the public and audit schemas first. Only allowed on databases named nmp_*. */
  reset?: boolean
}

interface MigrationFile {
  version: string
  name: string
  sql: string
  checksum: string
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort()
  const files: MigrationFile[] = []
  for (const name of names) {
    const version = MIGRATION_FILE.exec(name)?.[1]
    if (version === undefined) throw new Error(`Migration file name must look like 0001_name.sql: ${name}`)
    if (files.some((file) => file.version === version)) throw new Error(`Duplicate migration version ${version}`)
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
    files.push({ version, name, sql, checksum: createHash('sha256').update(sql).digest('hex') })
  }
  return files
}

async function resetSchemas(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name')
  const database = rows[0]?.name ?? ''
  if (!RESETTABLE_DATABASE.test(database)) {
    throw new Error(`Refusing to reset database "${database}": only databases named nmp_* can be reset`)
  }
  await client.query('DROP SCHEMA IF EXISTS audit CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public')
}

async function applyMigration(client: pg.Client, file: MigrationFile): Promise<void> {
  await client.query('BEGIN')
  try {
    await client.query(file.sql)
    await client.query('INSERT INTO schema_migration (version, name, checksum) VALUES ($1, $2, $3)', [
      file.version,
      file.name,
      file.checksum,
    ])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw new Error(`Migration ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}

/** Applies pending migrations in order, one transaction each. Returns the file names applied by this call. */
export async function migrate(databaseUrl: string, options: MigrateOptions = {}): Promise<string[]> {
  const files = await loadMigrationFiles()
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    if (options.reset === true) await resetSchemas(client)
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migration',
    )
    const applied = new Map(rows.map((row) => [row.version, row.checksum]))
    const newlyApplied: string[] = []
    for (const file of files) {
      const appliedChecksum = applied.get(file.version)
      if (appliedChecksum === undefined) {
        await applyMigration(client, file)
        newlyApplied.push(file.name)
      } else if (appliedChecksum !== file.checksum) {
        throw new Error(`Migration ${file.name} was changed after it was applied; migrations are forward-only`)
      }
    }
    return newlyApplied
  } finally {
    // Closing the connection also releases the advisory lock.
    await client.end()
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.MIGRATE_DATABASE_URL
  if (databaseUrl === undefined || databaseUrl === '') throw new Error('MIGRATE_DATABASE_URL is not set')
  const applied = await migrate(databaseUrl, { reset: process.argv.includes('--reset') })
  process.stdout.write(applied.length === 0 ? 'Schema is up to date\n' : `Applied:\n${applied.join('\n')}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
