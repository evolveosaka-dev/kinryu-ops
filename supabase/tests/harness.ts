// Runs the real migrations on an in-process Postgres (PGlite) with a minimal
// stand-in for Supabase's auth schema and roles, so RLS can be tested in CI
// without Docker.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

export interface TestDb {
  db: PGlite
  /** Create an auth user (fires the profile trigger) and return its id. */
  createUser(email: string, meta?: Record<string, string>): Promise<string>
  /** Run a query as the given user (or as anon when null) through RLS. */
  as<T>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>
  /** Run a query as superuser (bypasses RLS). */
  admin<T>(sql: string, params?: unknown[]): Promise<T[]>
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }

  const admin = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows

  return {
    db,
    admin,
    async createUser(email, meta = {}) {
      const rows = await admin<{ id: string }>(
        'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
        [email, JSON.stringify(meta)],
      )
      return rows[0]!.id
    },
    async as<T>(userId: string | null, sql: string, params: unknown[] = []) {
      return db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
        await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`)
        return (await tx.query<T>(sql, params)).rows
      })
    },
  }
}
