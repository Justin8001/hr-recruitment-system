import type { ErrorRequestHandler } from 'express';
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status :
    err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 :
    err.code === '23505' ? 409 : ['23503', '22007', '22P02', '22003', '22001'].includes(err.code) ? 400 : 500;
  const code = err instanceof HttpError ? err.code : status === 413 ? 'PAYLOAD_TOO_LARGE' :
    status === 409 ? 'DUPLICATE' : status === 400 ? 'INVALID_INPUT' : 'INTERNAL_ERROR';
  // Never log SQL parameters, CVs, tokens, request bodies or provider responses.
  console.error(JSON.stringify({ requestId: res.getHeader('X-Request-Id'), method: req.method, status, code }));
  res.status(status).json({ code, requestId: res.getHeader('X-Request-Id'),
    error: err instanceof HttpError ? err.message : status === 413 ? 'הבקשה גדולה מדי' :
      status === 409 ? 'קיימת רשומה עם אותם פרטים' : status === 400 ? 'נתונים לא תקינים' : 'שגיאה פנימית. יש למסור את מספר הפנייה לתמיכה.' });
};
