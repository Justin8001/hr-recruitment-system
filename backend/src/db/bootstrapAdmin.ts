import bcrypt from 'bcrypt';
import { pool } from './pool.js';

/**
 * Creates an initial admin user from env vars, if it doesn't already exist.
 * Lets a fresh deployment (e.g. Render) self-seed an admin without running a
 * script against the database or exposing the DB connection string.
 *
 * Set BOOTSTRAP_ADMIN_USER and BOOTSTRAP_ADMIN_PASSWORD in the environment.
 * Only creates the user when missing — never overwrites an existing password,
 * so in-app password changes survive redeploys.
 */
export async function bootstrapAdmin(): Promise<void> {
  const username = process.env.BOOTSTRAP_ADMIN_USER;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) return;

  const existing = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (existing.rows[0]) return;

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')`,
    [username, hash]
  );
  console.log(`Bootstrapped initial admin user "${username}".`);
}
