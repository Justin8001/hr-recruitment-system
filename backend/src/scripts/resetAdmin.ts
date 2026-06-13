import 'dotenv/config';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';

/**
 * Resets (or creates) an admin user.
 *
 * Usage from the backend directory:
 *   npm run reset-admin                      → resets user "admin" with a generated password
 *   npm run reset-admin -- admin MyPass123   → resets user "admin" with the given password
 */
async function resetAdmin() {
  const username = process.argv[2] ?? 'admin';
  const password = process.argv[3] ?? crypto.randomBytes(9).toString('base64url');

  if (password.length < 6) {
    console.error('Password must be at least 6 characters long.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  const updated = await pool.query(
    `UPDATE users SET password_hash = $1, role = 'admin' WHERE username = $2 RETURNING id`,
    [hash, username]
  );

  if (updated.rows[0]) {
    console.log(`Updated: user "${username}" now has a new password and the admin role.`);
  } else {
    await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')`,
      [username, hash]
    );
    console.log(`Created a new admin user named "${username}".`);
  }

  console.log('');
  console.log(`  Username: ${username}`);
  console.log(`  Password: ${password}`);
  console.log('');
  console.log('It is recommended to change this password after logging in.');

  await pool.end();
}

resetAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
