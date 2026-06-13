import bcrypt from 'bcrypt';
import { pool } from './pool.js';

/**
 * Creates an initial admin user from env vars, if it doesn't already exist.
 * Lets a fresh deployment (e.g. Render) self-seed an admin without running a
 * script against the database or exposing the DB connection string.
 *
 * Set BOOTSTRAP_ADMIN_USER and BOOTSTRAP_ADMIN_PASSWORD in the environment.
 * Upserts the admin on every startup: the password always matches the env var,
 * so there is never ambiguity about the login credentials. (Trade-off: an
 * in-app password change is reset on redeploy — remove these env vars once the
 * admin is set up if you want in-app changes to stick.)
 */
export async function bootstrapAdmin(): Promise<void> {
  const username = process.env.BOOTSTRAP_ADMIN_USER?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) return;

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
    [username, hash]
  );
  console.log(`Bootstrapped/updated admin user "${username}".`);
}
