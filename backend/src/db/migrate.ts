import 'dotenv/config';
import { pool } from './pool.js';
import { runMigrations } from './runMigrations.js';

// CLI entry point: run from the backend directory with `npm run migrate`.
runMigrations()
  .then(async () => {
    await pool.end();
    console.log('Migrations complete.');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
