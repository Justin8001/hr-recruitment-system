import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getProvider } from '../providers/index.js';
import { encrypt } from '../lib/crypto.js';

const router = Router();

function frontendBase() {
  return (process.env.FRONTEND_URL ?? '*').replace(/\/+$/, '');
}

// Step 1 (authenticated): return the provider's authorization URL.
// Identity is carried to the public callback via a short-lived signed `state`.
router.get('/:provider/start', requireAuth, asyncHandler(async (req, res) => {
  const name = req.params.provider;
  const provider = getProvider(name);
  if (!provider) return res.status(404).json({ error: 'ספק לא מוכר' });
  if (!provider.isConfigured()) {
    return res.status(400).json({ error: 'הספק לא הוגדר בשרת (חסרים משתני סביבה)' });
  }
  const state = jwt.sign(
    { userId: req.user!.userId, provider: name },
    process.env.JWT_SECRET as string,
    { expiresIn: '10m' }
  );
  res.json({ url: provider.authUrl(state) });
}));

// Step 2 (public — browser redirect from the provider).
router.get('/:provider/callback', asyncHandler(async (req, res) => {
  const name = req.params.provider;
  const provider = getProvider(name);
  const redirectErr = (msg: string) =>
    res.redirect(`${frontendBase()}/?error=${encodeURIComponent(msg)}`);

  if (req.query.error) return redirectErr(String(req.query.error));
  if (!provider) return redirectErr('unknown_provider');

  const code = req.query.code ? String(req.query.code) : '';
  const state = req.query.state ? String(req.query.state) : '';
  if (!code || !state) return redirectErr('missing_code');

  let payload: any;
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET as string);
  } catch {
    return redirectErr('invalid_state');
  }
  if (payload.provider !== name) return redirectErr('state_mismatch');

  try {
    const tokens = await provider.exchangeCode(code);
    if (!tokens.refreshToken) {
      return redirectErr('no_refresh_token');
    }
    await pool.query(
      `INSERT INTO email_connections
         (user_id, provider, account_email, refresh_token_enc, access_token_enc, expires_at, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         account_email = EXCLUDED.account_email,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         access_token_enc = EXCLUDED.access_token_enc,
         expires_at = EXCLUDED.expires_at,
         scopes = EXCLUDED.scopes,
         connected_at = now()`,
      [
        payload.userId,
        name,
        tokens.accountEmail ?? null,
        encrypt(tokens.refreshToken),
        tokens.accessToken ? encrypt(tokens.accessToken) : null,
        tokens.expiresAt,
        tokens.scopes ?? null
      ]
    );
    res.redirect(`${frontendBase()}/?connected=${name}`);
  } catch (err: any) {
    console.error('OAuth callback failed:', err);
    redirectErr('connection_failed');
  }
}));

export default router;
