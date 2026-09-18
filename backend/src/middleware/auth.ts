import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId: number;
  username: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header=req.headers.authorization;
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('hbc_session='))?.slice(12);
  const token=header?.startsWith('Bearer ')?header.slice(7):cookie;
  if(!token) return res.status(401).json({code:'AUTH_REQUIRED',error:'יש להתחבר למערכת'});
  try {
    const payload=jwt.verify(token,process.env.JWT_SECRET!,{algorithms:['HS256']}) as any;
    if(payload.purpose!=='session'||!Number.isSafeInteger(payload.userId)||typeof payload.username!=='string') throw new Error();
    req.user=payload as AuthPayload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'אין לך הרשאה לבצע פעולה זו' });
    }
    next();
  };
}
