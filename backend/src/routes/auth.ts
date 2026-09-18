import { requireAuth } from '../middleware/auth.js';
import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/* ---------- login rate limiting (in-memory, no extra deps) ---------- */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptRecord {
  failures: number;
  lockedUntil: number | null;
  lastAttempt: number;
}

const loginAttempts = new Map<string, AttemptRecord>();

// Prevent unbounded memory growth: prune stale entries occasionally
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of loginAttempts) {
    if ((rec.lockedUntil ?? rec.lastAttempt + LOCKOUT_MS) < now) loginAttempts.delete(key);
  }
}, 60 * 1000).unref();

function attemptKey(ip: string | undefined, username: string) {
  return `${ip ?? 'unknown'}|${username}`;
}

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || username.length>50 || password.length>200) {
    return res.status(400).json({ error: 'נדרשים שם משתמש וסיסמה' });
  }

  const key = attemptKey(req.ip, String(username));
  const record = loginAttempts.get(key);
  if (record?.lockedUntil && record.lockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      error: `יותר מדי ניסיונות התחברות כושלים. נסו שוב בעוד ${minutesLeft} דקות.`
    });
  }

  const result = await pool.query(
    'SELECT id, username, password_hash, role FROM users WHERE username = $1',
    [username]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    const rec = loginAttempts.get(key) ?? { failures: 0, lockedUntil: null, lastAttempt: Date.now() };
    rec.lastAttempt=Date.now();
    rec.failures += 1;
    if (rec.failures >= MAX_FAILED_ATTEMPTS) {
      rec.lockedUntil = Date.now() + LOCKOUT_MS;
      rec.failures = 0;
    }
    loginAttempts.set(key, rec);
    return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
  }

  loginAttempts.delete(key);

  await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]);

  const token = jwt.sign(
    { purpose:'session', userId: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET as string,
    { expiresIn: '8h' }
  );

  res.cookie('hbc_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api',maxAge:8*60*60*1000});
  res.json({ user: { id: user.id, username: user.username, role: user.role } });
}));

router.get('/me',requireAuth,(req,res)=>res.json({user:{id:req.user!.userId,username:req.user!.username,role:req.user!.role}}));
router.post('/logout',(_req,res)=>{res.clearCookie('hbc_session',{path:'/api',httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax'});res.status(204).end();});
export default router;
