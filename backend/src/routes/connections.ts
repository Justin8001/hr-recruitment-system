import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getProvider } from '../providers/index.js';
import { isConfigured as geminiConfigured } from '../lib/gemini.js';

const router = Router();

router.use(requireAuth);

// Which providers the current user has connected, plus which are available to connect.
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT provider, account_email, connected_at
     FROM email_connections WHERE user_id = $1`,
    [req.user!.userId]
  );
  const available = {
    google: !!getProvider('google')?.isConfigured(),
    microsoft: !!getProvider('microsoft')?.isConfigured()
  };
  res.json({ connections: result.rows, available, aiConfigured: geminiConfigured() });
}));

router.delete('/:provider', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM email_connections WHERE user_id = $1 AND provider = $2', [
    req.user!.userId,
    req.params.provider
  ]);
  res.status(204).end();
}));

export default router;
