import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import candidateRoutes from './routes/candidates.js';
import settingsRoutes from './routes/settings.js';

const app = express();

// Behind a reverse proxy (e.g. Render) req.ip should reflect the real client IP
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.FRONTEND_URL ?? '*' }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/settings', settingsRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

// Apply any pending DB migrations, then start accepting requests
import('./db/runMigrations.js')
  .then(({ runMigrations }) => runMigrations())
  .then(() => {
    app.listen(port, () => console.log(`Server listening on port ${port}`));
  })
  .catch((err) => {
    console.error('Failed to run migrations on startup:', err);
    process.exit(1);
  });
