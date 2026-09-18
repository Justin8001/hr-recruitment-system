import 'dotenv/config';
import { app } from './app.js';
import { validateEnvironment } from './lib/environment.js';
validateEnvironment();
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

// Apply any pending DB migrations, seed the initial admin, then accept requests
Promise.all([import('./db/runMigrations.js'), import('./db/bootstrapAdmin.js')])
  .then(async ([{ runMigrations }, { bootstrapAdmin }]) => {
    await runMigrations();
    await bootstrapAdmin();
  })
  .then(() => {
    app.listen(port, () => console.log(`Server listening on port ${port}`));
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
