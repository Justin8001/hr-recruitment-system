import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './pool.js';

/**
 * Forward-only migration runner: applies every .sql file in src/db/migrations
 * (sorted by name) that hasn't been recorded in schema_migrations yet.
 * Safe to call on every server start — already-applied files are skipped.
 *
 * Unlike the training-management-system, 001_init.sql here is the COMPLETE
 * schema, so a fresh database is fully bootstrapped by the migration runner
 * alone — there is no separate schema.sql to apply manually.
 */
export async function runMigrations(): Promise<void> {
  const dir = path.join(process.cwd(), 'src', 'db', 'migrations');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    console.warn(`Migrations directory not found at ${dir} — skipping migrations.`);
    return;
  }

  const applied = new Set(
    (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`migration applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`migration FAILED: ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
}
