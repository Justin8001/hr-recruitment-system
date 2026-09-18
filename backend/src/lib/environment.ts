export function validateEnvironment(env:NodeJS.ProcessEnv=process.env) {
  if(!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET)<32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  if(!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if(env.NODE_ENV==='production') {
    if(!env.FRONTEND_URL || new URL(env.FRONTEND_URL).protocol!=='https:') throw new Error('FRONTEND_URL must be an HTTPS origin');
  }
}
