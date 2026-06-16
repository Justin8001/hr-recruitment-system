import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import candidateRoutes from './routes/candidates.js';
import clientRoutes from './routes/clients.js';
import jobRoutes from './routes/jobs.js';
import settingsRoutes from './routes/settings.js';
import oauthRoutes from './routes/oauth.js';
import connectionRoutes from './routes/connections.js';
import scanRoutes from './routes/scan.js';

const app = express();

// Behind a reverse proxy (e.g. Render) req.ip should reflect the real client IP
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.FRONTEND_URL ?? '*' }));
// 25mb to accommodate base64-encoded CV uploads on the analyze endpoint.
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/scan', scanRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

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
